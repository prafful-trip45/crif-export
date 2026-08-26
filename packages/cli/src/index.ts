#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { convert } from '../../core/src/core/pipeline.js';
import type { FileMeta, FormatId } from '../../core/src/core/types.js';
import { getFormat, listFormats } from '../../core/src/formats/index.js';

const program = new Command();

program
  .name('crif-export')
  .description('Convert NBFC customer data (Excel) into CRIF Highmark bureau submission files.')
  .version('0.1.0');

program
  .command('formats')
  .description('List supported bureau formats')
  .action(() => {
    for (const f of listFormats()) {
      console.log(`  ${chalk.cyan(f.id.padEnd(18))} ${f.label}`);
    }
  });

program
  .command('convert', { isDefault: true })
  .description('Convert an Excel workbook to a bureau submission file')
  .requiredOption('-f, --format <id>', 'bureau format id (see `crif-export formats`)')
  .requiredOption('-i, --in <file>', 'input Excel workbook (.xlsx)')
  .option('-o, --out <file>', 'output file path (default: derived from input + format extension)')
  .requiredOption('-m, --member-id <id>', 'submitting member / MFI / NBF id')
  .option('--member-name <name>', 'submitting member name (MFI)')
  .option('--reporting-date <ddmmyyyy>', 'reporting / cycle date (DDMMYYYY)', today())
  .option('--creation-date <ddmmyyyy>', 'file creation date (DDMMYYYY)', today())
  .option('--password <pw>', 'reporting password (MFI/Consumer)')
  .option('--report <file>', 'also write the multi-sheet workbook report (.xlsx, one sheet per segment + sorting)')
  .option('--allow-warnings', 'emit the file even with non-blocking warnings', false)
  .option('--bypass-errors', 'force generation and emit the file even with validation errors (rejection risk)', false)
  .action(async (opts) => {
    const formatId = opts.format as FormatId;
    let format;
    try {
      format = getFormat(formatId);
    } catch {
      console.error(chalk.red(`Unknown format "${formatId}". Run \`crif-export formats\`.`));
      process.exit(2);
    }

    const buf = readFileSync(opts.in);
    const meta: FileMeta = {
      memberId: opts.memberId,
      memberName: opts.memberName,
      reportingDate: parseDate(opts.reportingDate),
      creationDate: parseDate(opts.creationDate),
      password: opts.password,
    };

    const result = await convert(buf, format, meta, {
      allowWarnings: opts.allowWarnings,
      bypassErrors: opts.bypassErrors,
      report: Boolean(opts.report),
    });
    printReport(result.report);

    if (!result.output) {
      console.error(chalk.red(`\n✗ ${result.report.errors.length} error(s) — output file NOT written.`));
      process.exit(1);
    }

    const out = opts.out ?? defaultOut(opts.in, format.outputExtension);
    writeFileSync(out, result.output);
    console.log(
      chalk.green(
        `\n✓ Wrote ${out} (${result.output.length} bytes, ${result.counts?.borrowerCount} borrowers, ${result.counts?.accountCount} accounts).`,
      ),
    );
    if (result.reportWorkbook) {
      writeFileSync(opts.report, result.reportWorkbook);
      console.log(chalk.green(`✓ Wrote ${opts.report} (multi-sheet workbook report).`));
    }
    if (result.report.warnings.length) {
      console.log(chalk.yellow(`  with ${result.report.warnings.length} warning(s).`));
    }
  });

program.parseAsync();

function printReport(report: { issues: Array<{ severity: string; sheet: string; rowNumber: number; fieldKey: string; message: string }> }) {
  if (report.issues.length === 0) {
    console.log(chalk.green('✓ Validation passed — no issues.'));
    return;
  }
  const bySheet = new Map<string, typeof report.issues>();
  for (const i of report.issues) {
    if (!bySheet.has(i.sheet)) bySheet.set(i.sheet, []);
    bySheet.get(i.sheet)!.push(i);
  }
  for (const [sheet, issues] of bySheet) {
    console.log(chalk.bold(`\n[${sheet}]`));
    for (const i of issues) {
      const tag = i.severity === 'error' ? chalk.red('ERROR') : chalk.yellow('WARN ');
      console.log(`  ${tag} row ${i.rowNumber} · ${i.fieldKey}: ${i.message}`);
    }
  }
}

function today(): string {
  const d = new Date();
  return (
    String(d.getDate()).padStart(2, '0') +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getFullYear())
  );
}

function parseDate(s: string): Date {
  return new Date(Date.UTC(+s.slice(4, 8), +s.slice(2, 4) - 1, +s.slice(0, 2)));
}

function defaultOut(input: string, ext: string): string {
  const base = basename(input, extname(input));
  return join(process.cwd(), base + ext);
}

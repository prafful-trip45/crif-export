import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import type { FileMeta } from '../packages/core/src/core/types.js';
import { commercialUcrfFlat } from '../packages/core/src/formats/commercial-ucrf-flat.js';

/**
 * Real-world Commercial "Master Sheet" -> CRIF Commercial UCRF .txt + workbook report.
 *
 * Source pair: training-references/crif-reporting-io/
 *   in : client-commercial-data-input-1.xlsx ("Master Sheet" — one flat borrower row)
 *   out: client-commercial-data-input-1-output-file.txt
 *
 * The flat row explodes into HD/BS/AS/RS/CR/GS/SS/CD/TS (empty GS/SS/CD filler rows
 * are always emitted, mirroring the accountant working file). Three values diverge
 * from the hand-made client golden (all confirmed intentional):
 *   - Credit Type: we MAP the input ("Aggregation…" -> 5200, or code 300 passthrough)
 *     rather than the accountant's blanket 5200.
 *   - RS line1: golden keeps a trailing ", "; we trim it.
 *   - CR wilful-default DATE: golden stamps "0" in a date slot; we leave it blank.
 * The client golden also collapses the empty GS/SS/CD lines; we keep them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fix = (f: string) => join(here, 'fixtures/commercial-flat', f);

const META: FileMeta = {
  memberId: 'NBFCHE3014',
  reportingDate: new Date(Date.UTC(2026, 0, 31)), // 31012026
  creationDate: new Date(Date.UTC(2026, 2, 26)), // 26032026
};

describe('Commercial UCRF flat (Master Sheet) golden', () => {
  it('explodes the flat row into HD/BS/AS/RS/CR/GS/SS/CD/TS', async () => {
    const buf = readFileSync(fix('input-corrected.xlsx'));
    const result = await convert(buf, commercialUcrfFlat, META);

    expect(result.report.errors).toEqual([]);
    const out = result.outputText!.split('\r\n');

    expect(out[0]).toBe('HD|NBFCHE3014||26032026|31012026|01|');
    expect(out[1]).toBe('BS|HO||APL Infotech Limited||||AACCA3994L|||||12|06|06|||||||||||||');
    expect(out[2]).toBe(
      "AS|01||D' Building, Shivsagar Estate, 6th Floor, Dr. Annie Besant Road,Worli|||Mumbai|Maharashtra|20|400018|079|||||||",
    );
    expect(out[3]).toBe(
      'RS|999999999|2|51||||Mr|HEMANT KUMAR RUIA|01|||24021958|AADPR8349A||||||||||||Mimraj Building, 405, Kalbadevi Road|||Mumbai|Maharashtra|20|400002|079|2222015336||||||',
    );
    expect(out[4]).toBe(
      'CR|24020500002081||28062010|120000000|INR|5200||05|120000000|94510000||||0001||0|||||||||01|||||||||0||00|||||||',
    );
    expect(out[5]).toBe('GS|||||||||||||||||||||||||||||||||||||');
    expect(out[6]).toBe('SS|||||||'); // no INR currency default on empty SS
    expect(out[7]).toBe('CD|||||||');
    expect(out[8]).toBe('TS|1|1|');
    expect(result.outputText!.endsWith('TS|1|1|\r\n')).toBe(true);
  });

  it('matches the client golden after applying the documented divergences', async () => {
    const buf = readFileSync(fix('input-corrected.xlsx'));
    const golden = readFileSync(fix('golden-output.txt')).toString('latin1');
    const result = await convert(buf, commercialUcrfFlat, META);

    // Transform the hand-made client golden (6 lines) into our expected output:
    //   - normalize the RS line1 trailing comma + the wilful-date "0", and
    //   - insert the empty GS/SS/CD filler lines our converter always emits.
    const expected = golden
      .replace('Kalbadevi Road,  |', 'Kalbadevi Road|')
      .replace('|0|0|00|', '|0||00|')
      .replace(
        '\r\nTS|1|1|',
        '\r\nGS|||||||||||||||||||||||||||||||||||||\r\nSS|||||||\r\nCD|||||||\r\nTS|1|1|',
      );

    expect(result.outputText!).toBe(expected);
  });

  it('builds the multi-sheet workbook report (sheets + sorting)', async () => {
    const buf = readFileSync(fix('input-corrected.xlsx'));
    const result = await convert(buf, commercialUcrfFlat, META, { report: true });
    expect(result.reportWorkbook).toBeInstanceOf(Buffer);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.reportWorkbook! as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'HD', 'BS', 'AS', 'RS', 'CR', 'GS', 'SS', 'CD', 'TS', 'sorting',
    ]);

    // The sorting sheet lists every record in upload order with its Final Formula.
    const sorting = wb.getWorksheet('sorting')!;
    const tags = (sorting.getColumn(3).values as unknown[]).slice(2).filter(Boolean);
    expect(tags).toEqual(['HD', 'BS', 'AS', 'RS', 'CR', 'GS', 'SS', 'CD', 'TS']);
    // The HD Final Formula equals the .txt header line.
    expect(sorting.getCell('D2').value).toBe('HD|NBFCHE3014||26032026|31012026|01|');
  });

  it('sample 2: header from flags, Credit Type code 300 passthrough (not the accountant 5200)', async () => {
    const buf = readFileSync(fix('input-2.xlsx'));
    const result = await convert(buf, commercialUcrfFlat, {
      memberId: 'NBF0000806',
      reportingDate: new Date(Date.UTC(2026, 2, 15)), // 15032026
      creationDate: new Date(Date.UTC(2026, 2, 26)), // 26032026
    });

    expect(result.report.errors).toEqual([]);
    const out = result.outputText!.split('\r\n');
    expect(out[0]).toBe('HD|NBF0000806||26032026|15032026|01|');
    expect(out[4]).toBe(
      'CR|24020500002081||28062010|120000000|INR|300||05|120000000|94510000||||0001||0|||||||||01|||||||||0||00|||||||',
    );
    expect(out[8]).toBe('TS|1|1|');
  });

  it('reads Member ID / Reporting / Creation date from the Master Sheet header cells (overriding flags)', async () => {
    // Fill B5/B6/B7 in memory and pass deliberately-wrong flags; the sheet must win.
    const src = new ExcelJS.Workbook();
    await src.xlsx.load(readFileSync(fix('input-2.xlsx')) as unknown as ArrayBuffer);
    const ws = src.getWorksheet('Master Sheet')!;
    ws.getCell('B5').value = 'NB12345001';
    ws.getCell('B6').value = '15032026';
    ws.getCell('B7').value = '26032026';
    const written = await src.xlsx.writeBuffer();
    const buf = new Uint8Array(written as ArrayBuffer).buffer;

    const result = await convert(buf, commercialUcrfFlat, {
      memberId: 'FLAG_SHOULD_LOSE',
      reportingDate: new Date(Date.UTC(2000, 0, 1)),
      creationDate: new Date(Date.UTC(2000, 1, 2)),
    });
    expect(result.outputText!.split('\r\n')[0]).toBe('HD|NB12345001||26032026|15032026|01|');
  });

  it('rejects a Credit Type that is absent from the lookup sheet', async () => {
    const buf = readFileSync(fix('input-loan-unmatched.xlsx')); // Credit Type = "Loan"
    const result = await convert(buf, commercialUcrfFlat, META);

    const issue = result.report.errors.find((e) => e.fieldKey === 'creditType');
    expect(issue).toBeDefined();
    expect(issue!.rule).toBe('lookup');
    expect(issue!.message).toMatch(/Credit Type "Loan" not found/);
    expect(result.output).toBeUndefined();
  });
});

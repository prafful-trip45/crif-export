import { assemble, computeCounts } from '../encoding/engine.js';
import { groupByBorrower } from '../input/grouper.js';
import { readFlatHeaderOverrides, readWorkbook } from '../input/workbook-reader.js';
import { toBuffer } from '../output/file-writer.js';
import { writeReport } from '../output/report-writer.js';
import { validate } from '../validation/validator.js';
import type { ConvertResult } from './result.js';
import type { FileMeta, FormatSpec } from './types.js';

export interface ConvertOptions {
  /** Emit the data file even when only warnings (never errors) are present. */
  allowWarnings?: boolean;
  /** Force emission of the data file even if there are blocking validation errors. */
  bypassErrors?: boolean;
  /**
   * Also produce the multi-sheet workbook report (accountant working-file style:
   * one sheet per segment + a `sorting` sheet). Returned as `result.report`Buffer
   * via `reportWorkbook`.
   */
  report?: boolean;
}

/**
 * Full conversion: read workbook -> group by borrower -> validate -> (if ok)
 * encode + emit. On validation failure the data file is suppressed unless bypassErrors
 * is set, and the issues report is always returned.
 */
export async function convert(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
  meta: FileMeta,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const rows = await readWorkbook(buffer, format, meta);
  const borrowers = groupByBorrower(rows);
  const report = validate(format, borrowers);
  const counts = computeCounts(format, borrowers);

  if (!report.ok && !options.allowWarnings && !options.bypassErrors) {
    return { report, counts };
  }

  // Flat formats may carry file-level header values (Member ID / dates) in the
  // sheet itself; a non-blank sheet cell overrides the corresponding meta flag.
  const overrides = await readFlatHeaderOverrides(buffer, format);
  const effectiveMeta: FileMeta = { ...meta, ...overrides };

  const text = assemble(format, borrowers, effectiveMeta);
  const output = toBuffer(format, text);
  const reportWorkbook = options.report ? await writeReport(format, borrowers, effectiveMeta) : undefined;
  return { report, output, outputText: text, counts, reportWorkbook };
}

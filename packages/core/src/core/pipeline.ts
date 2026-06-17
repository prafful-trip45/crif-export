import { assemble, computeCounts } from '../encoding/engine.js';
import { groupByBorrower } from '../input/grouper.js';
import { readWorkbook } from '../input/workbook-reader.js';
import { toBuffer } from '../output/file-writer.js';
import { validate } from '../validation/validator.js';
import type { ConvertResult } from './result.js';
import type { FileMeta, FormatSpec } from './types.js';

export interface ConvertOptions {
  /** Emit the data file even when only warnings (never errors) are present. */
  allowWarnings?: boolean;
}

/**
 * Full conversion: read workbook -> group by borrower -> validate -> (if ok)
 * encode + emit. On validation failure the data file is suppressed and only the
 * report is returned.
 */
export async function convert(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
  meta: FileMeta,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const rows = await readWorkbook(buffer, format);
  const borrowers = groupByBorrower(rows);
  const report = validate(format, borrowers);
  const counts = computeCounts(format, borrowers);

  if (!report.ok && !options.allowWarnings) {
    return { report, counts };
  }

  const text = assemble(format, borrowers, meta);
  const output = toBuffer(format, text);
  return { report, output, outputText: text, counts };
}

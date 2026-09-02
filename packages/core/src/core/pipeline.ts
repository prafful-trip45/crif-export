import { assemble, computeCounts } from '../encoding/engine.js';
import { groupByBorrower } from '../input/grouper.js';
import { readFlatHeaderOverrides, readWorkbook } from '../input/workbook-reader.js';
import { toBuffer } from '../output/file-writer.js';
import { writeReport } from '../output/report-writer.js';
import { validate } from '../validation/validator.js';
import type { ConvertResult } from './result.js';
import type { FileMeta, FormatSpec } from './types.js';

/**
 * The stages of a conversion, in the order they run. Front-ends that show live
 * progress report against these; `done` fires once, after the last stage.
 */
export type ConvertPhase =
  | 'reading'
  | 'mapping'
  | 'validating'
  | 'encoding'
  | 'writing'
  | 'done';

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
  /**
   * Called as each stage completes, with whatever detail that stage produced (row
   * counts, error totals…). Awaited, so a UI callback can yield to the event loop
   * and actually repaint between stages — the pipeline itself is otherwise a single
   * synchronous burst. Optional; the CLI/web/worker pass nothing.
   */
  onPhase?: (phase: ConvertPhase, detail?: string) => void | Promise<void>;
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
  const phase = async (p: ConvertPhase, detail?: string) => {
    await options.onPhase?.(p, detail);
  };
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

  const rows = await readWorkbook(buffer, format, meta);
  await phase('reading', plural(rows.length, 'row'));

  const borrowers = groupByBorrower(rows);
  const counts = computeCounts(format, borrowers);
  await phase('mapping', plural(counts.segmentCount, 'segment'));

  const report = validate(format, borrowers);
  await phase('validating', plural(report.errors.length, 'error'));

  // A parsing failure means the source value could not be translated safely. It
  // must be corrected in the Master Sheet; bypass is only for ordinary bureau
  // validation errors where the operator deliberately accepts the rejection risk.
  if (
    !report.ok &&
    (report.hasNonBypassableErrors || (!options.allowWarnings && !options.bypassErrors))
  ) {
    await phase('done');
    return { report, counts };
  }

  // Flat formats may carry file-level header values (Member ID / dates) in the
  // sheet itself; a non-blank sheet cell overrides the corresponding meta flag.
  const overrides = await readFlatHeaderOverrides(buffer, format);
  const effectiveMeta: FileMeta = { ...meta, ...overrides };

  const text = assemble(format, borrowers, effectiveMeta);
  await phase('encoding', format.fileEncoding.toUpperCase());

  const output = toBuffer(format, text);
  const reportWorkbook = options.report ? await writeReport(format, borrowers, effectiveMeta) : undefined;
  await phase('writing', 'done');
  await phase('done');
  return { report, output, outputText: text, counts, reportWorkbook };
}

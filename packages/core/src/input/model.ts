import type { TypedRow } from '../core/types.js';

/** A single parsed segment row from a sheet, after coercion to typed values. */
export interface SegmentRow {
  /** Segment tag (= source sheet name). */
  tag: string;
  sheet: string;
  /** Borrower join key (`A/c No.` column). */
  acNo: string;
  /** Sort order within the borrower group (`Flag` column); falls back to spec flag. */
  flag: number;
  /** 1-based Excel row number, for error reporting. */
  rowNumber: number;
  values: TypedRow;
  /**
   * Issues raised while reading/mapping this row (e.g. a flat-explode lookup that
   * failed). Surfaced verbatim by the validator so the report shows them.
   */
  readerIssues?: Array<{ fieldKey: string; message: string; severity?: 'error' | 'warning' }>;
  /**
   * Wire field key -> source spreadsheet column letter it was read from ("AF").
   * Lets the validator point a blank/invalid field back at the exact cell the user
   * edits, including for fields DERIVED from a free-text column (state/PIN <- address).
   */
  sourceColumns?: Record<string, string>;
}

/** All segment rows sharing one `A/c No.`, i.e. one borrower's full record. */
export interface Borrower {
  acNo: string;
  segments: SegmentRow[];
}

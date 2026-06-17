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
}

/** All segment rows sharing one `A/c No.`, i.e. one borrower's full record. */
export interface Borrower {
  acNo: string;
  segments: SegmentRow[];
}

import type { Borrower, SegmentRow } from './model.js';

/**
 * Group flat segment rows into per-borrower records by the `A/c No.` join key,
 * preserving first-seen borrower order. Within each borrower, segments are sorted
 * by `flag` (then stable by original order) so the assembler emits them in the
 * correct sequence (e.g. Commercial 1=BS,2=AS,3=RS,4=CR,7=CD).
 */
export function groupByBorrower(rows: SegmentRow[]): Borrower[] {
  const order: string[] = [];
  const byAcNo = new Map<string, SegmentRow[]>();

  for (const row of rows) {
    let bucket = byAcNo.get(row.acNo);
    if (!bucket) {
      bucket = [];
      byAcNo.set(row.acNo, bucket);
      order.push(row.acNo);
    }
    bucket.push(row);
  }

  return order.map((acNo) => {
    const segments = byAcNo.get(acNo)!;
    const sorted = segments
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (a.s.flag - b.s.flag) || (a.i - b.i))
      .map((x) => x.s);
    return { acNo, segments: sorted };
  });
}

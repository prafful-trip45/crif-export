import type {
  FileMeta,
  FormatSpec,
  SegmentSpec,
  TrailerCounts,
  TypedRow,
} from '../core/types.js';
import type { Borrower } from '../input/model.js';
import { encodeCodedField } from './strategies/coded-field.js';
import { encodeConcatenated } from './strategies/concatenated.js';
import { encodeFixedWidth } from './strategies/fixed-width.js';
import { encodePipeDelimited } from './strategies/pipe-delimited.js';

/** Encode one segment record to its string form by its declared strategy. */
export function encodeSegment(seg: SegmentSpec, row: TypedRow): string {
  switch (seg.encoding) {
    case 'fixed-width':
      return encodeFixedWidth(seg, row);
    case 'pipe-delimited':
      return encodePipeDelimited(seg, row);
    case 'coded-field':
      return encodeCodedField(seg, row);
    case 'concatenated':
      return encodeConcatenated(seg, row);
  }
}

/** Count accounts/addresses/segments across all borrowers for the trailer. */
export function computeCounts(format: FormatSpec, borrowers: Borrower[]): TrailerCounts {
  const accountTags = new Set(
    format.body.filter((s) => /account|credit|act/i.test(s.tag) || ['CR', 'ACTCRD', 'TL'].includes(s.tag)).map((s) => s.tag),
  );
  const addressTags = new Set(['AS', 'PA', 'ADRCRD']);
  let accountCount = 0;
  let addressCount = 0;
  let segmentCount = 0;
  for (const b of borrowers) {
    for (const seg of b.segments) {
      segmentCount += 1;
      if (accountTags.has(seg.tag)) accountCount += 1;
      if (addressTags.has(seg.tag)) addressCount += 1;
    }
  }
  return {
    borrowerCount: borrowers.length,
    accountCount,
    addressCount,
    segmentCount,
  };
}

/**
 * Assemble the full output: header record, then each borrower's segments in
 * spec order, then the trailer (with computed counts). Records are joined by the
 * format's line ending; for `single-physical-line` (MFI) there is no separator.
 */
export function assemble(format: FormatSpec, borrowers: Borrower[], meta: FileMeta): string {
  const records: string[] = [];

  // Header
  const header = encodeSegment(format.header, format.buildHeaderRow(meta));

  // Body — group by borrower, segments already ordered by the grouper.
  const bodyRecords: string[] = [];
  const bodyOrder = new Map(format.body.map((s, i) => [s.tag, i] as const));
  for (const borrower of borrowers) {
    const ordered = [...borrower.segments].sort((a, b) => {
      if (a.flag !== b.flag) return a.flag - b.flag;
      return (bodyOrder.get(a.tag) ?? 0) - (bodyOrder.get(b.tag) ?? 0);
    });
    for (const seg of ordered) {
      const spec = format.body.find((s) => s.tag === seg.tag);
      if (!spec) continue;
      bodyRecords.push(encodeSegment(spec, seg.values));
    }
  }

  // Glue the header onto the first body record (flat Consumer): line 0 = header+rec0.
  if (format.glueHeaderToFirstRecord && bodyRecords.length > 0) {
    bodyRecords[0] = header + bodyRecords[0];
    records.push(...bodyRecords);
  } else {
    records.push(header, ...bodyRecords);
  }

  // Trailer (unless the format omits it)
  if (!format.omitTrailer) {
    const counts = computeCounts(format, borrowers);
    records.push(encodeSegment(format.trailer, format.buildTrailerRow(counts, meta)));
  }

  if (format.physicalLayout === 'single-physical-line') {
    return records.join('') + format.lineEnding;
  }
  // One line per record; trailing line ending included to match CRIF samples
  // where the final record is followed by CRLF... (overridable per format).
  return records.join(format.lineEnding);
}

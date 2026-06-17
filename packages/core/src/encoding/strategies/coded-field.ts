import type { SegmentSpec, TypedRow } from '../../core/types.js';
import { formatValue } from '../formatters/value.js';

/**
 * Consumer UCRF-12 self-describing encoding. The record begins with a 7-byte
 * segment header:
 *
 *     [tag(2)][version(2)][codedHeaderSuffix(3 = subtype 1 + recType 2)]
 *
 * e.g. "PN03" + "N01", "TL04" + "T00". Then for every PRESENT field:
 *
 *     [fieldTag(2)][length(2)][value]
 *
 * Fields are concatenated with no delimiter. Absent optional fields are omitted
 * entirely — the scheme is self-describing, so the reader walks tag+length.
 *
 * `length` is the actual byte length of the (already formatted) value, written
 * as a 2-digit number. Values longer than 99 bytes are not representable and are
 * rejected by the length validation rule before we get here.
 */
export function encodeCodedField(seg: SegmentSpec, row: TypedRow): string {
  let out = seg.tag + (seg.version ?? '') + (seg.codedHeaderSuffix ?? '');
  for (const field of seg.fields) {
    if (field.key === '_tag' || field.key.startsWith('_')) continue;
    const raw = formatValue(field, row[field.key]);
    if (raw === '') continue; // omit absent optionals
    const code = field.code ?? '';
    const len = String(raw.length).padStart(2, '0');
    out += code + len + raw;
  }
  return out;
}

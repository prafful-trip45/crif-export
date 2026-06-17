import type { SegmentSpec, TypedRow } from '../../core/types.js';
import { defaultPad, fit, formatValue } from '../formatters/value.js';

/**
 * Fixed-width encoding: each field is formatted then padded/truncated to its
 * exact `length`, concatenated with no separators. Used for the Consumer 185-char
 * `TUDF` header / `**TRLR`, and the MFI `HDR` / `TRL` records.
 *
 * `tag` is NOT emitted separately here — the tag is modelled as the first field
 * (a literal default), so the whole record is one positional layout.
 */
export function encodeFixedWidth(seg: SegmentSpec, row: TypedRow): string {
  let out = '';
  for (const field of seg.fields) {
    const raw = formatValue(field, row[field.key]);
    const width = field.length ?? raw.length;
    const { side, char } = defaultPad(field);
    out += fit(raw, width, side, char).text;
  }
  return out;
}

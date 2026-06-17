import type { SegmentSpec, TypedRow } from '../../core/types.js';
import { defaultPad, fit, formatValue } from '../formatters/value.js';

/**
 * Real-world CRIF Consumer "Data Submission Form" output encoding.
 *
 * Each consumer record is a pure concatenation of its formatted field values in
 * a fixed order — NO segment markers, NO field tags, NO length prefixes, NO
 * delimiters. Verified byte-for-byte against the production sample
 * 024FP02726-15052026-19052026-113111-F1.txt.
 *
 * Most fields are emitted as their raw formatted value (variable width). A field
 * MAY declare a fixed `length`, in which case it is padded/truncated to that
 * width (used only where the layout demands a fixed slot). Blank optional fields
 * with no `length` and no `default` contribute nothing.
 */
export function encodeConcatenated(seg: SegmentSpec, row: TypedRow): string {
  let out = '';
  for (const field of seg.fields) {
    if (field.key === '_tag' || field.key.startsWith('_')) continue;
    const raw = formatValue(field, row[field.key]);
    if (field.length) {
      const { side, char } = defaultPad(field);
      out += fit(raw, field.length, side, char).text;
    } else {
      out += raw;
    }
  }
  return out;
}

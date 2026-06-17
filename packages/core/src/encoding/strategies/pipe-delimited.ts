import type { SegmentSpec, TypedRow } from '../../core/types.js';
import { formatValue } from '../formatters/value.js';

/**
 * Pipe-delimited encoding: format each field and join with `|`. Blank optional
 * fields emit an empty token so pipe positions are preserved. The segment tag is
 * the first token (modelled as a field with a literal default), e.g.
 * `BS|110000||ABC PVT.LTD|...`. Used for all Commercial segments and the MFI
 * body segments (CNSCRD / ADRCRD / ACTCRD).
 */
export function encodePipeDelimited(seg: SegmentSpec, row: TypedRow): string {
  return seg.fields.map((f) => formatValue(f, row[f.key])).join('|');
}

import type { FieldSpec, FieldValue } from '../../core/types.js';
import { formatDdmmccyy, formatDdmmyyyy } from './date.js';

/**
 * Turn a typed field value into its raw string form according to the field's
 * type — independent of how it will be laid out (padded / delimited / coded).
 * Returns the empty string for blank values (default applied by caller).
 */
export function formatValue(spec: FieldSpec, value: FieldValue): string {
  if (value === undefined || value === null || value === '') {
    return spec.default ?? '';
  }
  switch (spec.type) {
    case 'date-ddmmyyyy':
      return value instanceof Date ? formatDdmmyyyy(value) : String(value);
    case 'date-ddmmccyy':
      return value instanceof Date ? formatDdmmccyy(value) : String(value);
    case 'numeric':
      return typeof value === 'number' ? numericToString(value) : String(value).trim();
    case 'enum':
    case 'string':
    default:
      return String(value);
  }
}

/** Render a numeric without scientific notation or trailing-zero noise. */
function numericToString(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Keep up to 12 significant decimal digits, strip trailing zeros.
  return String(n);
}

/** Left/right pad (or right-truncate) a string to an exact width. */
export function fit(
  raw: string,
  width: number,
  side: 'left' | 'right',
  padChar: string,
): { text: string; truncated: boolean } {
  if (raw.length === width) return { text: raw, truncated: false };
  if (raw.length > width) {
    return { text: raw.slice(0, width), truncated: true };
  }
  const fill = padChar.repeat(width - raw.length);
  return { text: side === 'left' ? fill + raw : raw + fill, truncated: false };
}

/** Default pad side/char per field type when the spec does not specify. */
export function defaultPad(spec: FieldSpec): { side: 'left' | 'right'; char: string } {
  const side = spec.pad ?? (spec.type === 'numeric' ? 'left' : 'right');
  const char = spec.padChar ?? (spec.type === 'numeric' ? '0' : ' ');
  return { side, char };
}

import type { FieldSpec, FieldValue } from '../../core/types.js';
import { formatDdmmccyy, formatDdmmyyyy } from './date.js';

/**
 * Typographic characters accountants' sheets are full of (Word autocorrect turns
 * "-" into "\u2013" and straight quotes into curly ones), mapped to the ASCII the
 * bureau expects.
 */
const LATIN1_FOLD: Record<string, string> = {
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-',
  '\u2212': '-', '\u2022': '-', '\u00b7': '-',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"', '\u2033': '"',
  '\u2026': '...', '\u20b9': 'Rs.', '\u2044': '/',
};

/**
 * Fold a value into characters that survive the latin1 output encoding.
 *
 * Output is written with `Buffer.from(text, 'latin1')`, which keeps only the LOW
 * BYTE of each code unit — so an en dash (U+2013) silently becomes 0x13, a control
 * byte that corrupts the record. (Seen in the field: instance_1.xlsx row 23's
 * address "SARVODAY SOCIETY \u2013 1" shipped a raw 0x13 to CRIF.)
 *
 * Characters U+0000-U+00FF round-trip unchanged and are left exactly as they are,
 * so this is a no-op for every value that was already encodable. Anything above
 * that is folded to ASCII: the table first, then NFKD to strip diacritics (é -> e),
 * and finally a space for scripts with no ASCII equivalent — a space is padding the
 * bureau already tolerates, whereas a truncated low byte is not.
 */
export function toLatin1Safe(s: string): string {
  if (!/[^\u0000-\u00ff]/.test(s)) return s; // fast path: already encodable
  return s.replace(/[^\u0000-\u00ff]/g, (ch) => {
    const mapped = LATIN1_FOLD[ch];
    if (mapped !== undefined) return mapped;
    const stripped = ch.normalize('NFKD').replace(/[^\u0020-\u00ff]/g, '');
    return stripped || ' ';
  });
}

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
      return toLatin1Safe(String(value));
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

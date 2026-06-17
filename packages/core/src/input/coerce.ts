import type { FieldSpec, FieldValue } from '../core/types.js';
import { parseCrifDate } from '../encoding/formatters/date.js';

/** Excel-cell-ish raw value as read from a workbook. */
export type RawCell = string | number | boolean | Date | null | undefined;

/**
 * Coerce a raw cell into the typed value the field expects, BEFORE validation
 * (so date rules see a real Date, not an Excel serial or a string). Anything
 * unparseable is passed through as a trimmed string for the validator to flag.
 */
export function coerceCell(spec: FieldSpec, raw: RawCell): FieldValue {
  if (raw === null || raw === undefined || raw === '') return undefined;

  switch (spec.type) {
    case 'date-ddmmyyyy':
    case 'date-ddmmccyy': {
      if (raw instanceof Date) return raw;
      if (typeof raw === 'number') return excelSerialToDate(raw);
      const s = String(raw).trim();
      // Accept already-formatted DDMMYYYY, or common date strings.
      const crif = parseCrifDate(s);
      if (crif) return crif;
      const dmy = parseDmySlash(s);
      if (dmy) return dmy;
      return s; // leave for validator to reject
    }
    case 'numeric': {
      if (typeof raw === 'number') return raw;
      const n = Number(String(raw).trim());
      return Number.isNaN(n) ? String(raw).trim() : n;
    }
    case 'enum':
    case 'string':
    default:
      return String(raw).trim();
  }
}

/** Excel stores dates as serial days since 1899-12-30 (UTC). */
export function excelSerialToDate(serial: number): Date {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

/** Parse DD/MM/YYYY or DD-MM-YYYY into a UTC Date. */
function parseDmySlash(s: string): Date | null {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.getUTCDate() === dd ? d : null;
}

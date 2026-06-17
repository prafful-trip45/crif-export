/** Date formatters. CRIF uses DDMMYYYY (Consumer/Commercial) and DDMMCCYY (MFI). */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a JS Date as DDMMYYYY (e.g. 30 Apr 2024 -> "30042024"). */
export function formatDdmmyyyy(d: Date): string {
  return pad2(d.getUTCDate()) + pad2(d.getUTCMonth() + 1) + String(d.getUTCFullYear()).padStart(4, '0');
}

/**
 * Format a JS Date as DDMMCCYY. In CRIF's notation CC = century digits, YY =
 * year digits, so this is also a full 4-digit year (DD MM CCYY), identical
 * digit layout to DDMMYYYY — kept as a distinct type for spec clarity/validation.
 */
export function formatDdmmccyy(d: Date): string {
  return formatDdmmyyyy(d);
}

/** Parse a DDMMYYYY / DDMMCCYY string into a UTC Date, or null if invalid. */
export function parseCrifDate(s: string): Date | null {
  if (!/^\d{8}$/.test(s)) return null;
  const dd = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const yyyy = Number(s.slice(4, 8));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCDate() !== dd || d.getUTCMonth() !== mm - 1) return null;
  return d;
}

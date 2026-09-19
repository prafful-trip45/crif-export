/** Stateless field-format predicates used by the validator. */

/**
 * Commercial UCRF V3.10 Annexure D Part-C (Identifier Validation, p.67): PAN is
 * "the standard 10-character alphanumeric PAN structure" with "the absence of
 * special or non-printable characters". That structure is five letters, four
 * digits, one letter — the trailing letter is a checksum character, so a PAN
 * that is 10 alphanumerics in any other arrangement is still malformed.
 *
 * Anchored at both ends, so a value carrying a stray space, punctuation or a
 * non-printable byte fails here rather than reaching the encoder.
 */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PIN_RE = /^\d{6}$/;
export const AADHAAR_RE = /^\d{12}$/;
/** Indian mobile/landline: 10 digits, optionally with STD prefix — accept 6-15 digits. */
export const PHONE_RE = /^\d{6,15}$/;
/**
 * Consumer UCRF-12 V3.73 EC/01: exactly one "@", at least one "." after it, no
 * consecutive dots, and the domain may not begin or end with "-" or ".". CRIF
 * rejects the whole EC segment when the address fails this.
 */
export const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

export function isPan(v: string): boolean {
  return PAN_RE.test(v);
}
export function isPin(v: string): boolean {
  return PIN_RE.test(v);
}
export function isPhone(v: string): boolean {
  return PHONE_RE.test(v.replace(/[\s\-]/g, ''));
}
export function isAadhaar(v: string): boolean {
  return AADHAAR_RE.test(v);
}
export function isEmail(v: string): boolean {
  return v.length <= 70 && !v.includes('..') && EMAIL_RE.test(v);
}

/** Map a field key to a known format-validator, or undefined if none applies. */
export function formatRuleFor(key: string): ((v: string) => boolean) | undefined {
  const k = key.toLowerCase();
  // Every PAN-bearing field across the commercial and consumer specs, not just the
  // borrower's. The commercial wire spec names them per segment — `pan` (BS field 8),
  // `rsPan` (RS field 14, Related Person) and `gsPan` (GS field 13, Guarantor) — and
  // the flat Master Sheet carries the related person's as `relatedPan` before explode()
  // renames it. An exact `k === 'pan'` test silently skipped all three of the non-
  // borrower keys, so a malformed guarantor PAN reached CRIF and came back a rejection.
  // V3.10 marks the field "Reject Record" at BS/RS and "Reject Field" at GS.
  if (k === 'pan' || k.endsWith('pan')) return isPan;
  if (k.includes('pincode') || k === 'pin') return isPin;
  if (k === 'uid' || k === 'aadhaar' || k === 'aadhar') return isAadhaar;
  if ((k.includes('mobile') || k.includes('phone') || k.includes('telephone')) && !k.includes('type')) return isPhone;
  if (k === 'email' || k.startsWith('email')) return isEmail;
  return undefined;
}

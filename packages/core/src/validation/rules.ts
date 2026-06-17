/** Stateless field-format predicates used by the validator. */

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PIN_RE = /^\d{6}$/;
export const AADHAAR_RE = /^\d{12}$/;
/** Indian mobile/landline: 10 digits, optionally with STD prefix — accept 6-15 digits. */
export const PHONE_RE = /^\d{6,15}$/;

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

/** Map a field key to a known format-validator, or undefined if none applies. */
export function formatRuleFor(key: string): ((v: string) => boolean) | undefined {
  const k = key.toLowerCase();
  if (k === 'pan') return isPan;
  if (k.includes('pincode') || k === 'pin') return isPin;
  if (k === 'uid' || k === 'aadhaar' || k === 'aadhar') return isAadhaar;
  if (k.includes('mobile') || k.includes('phone') || k.includes('telephone')) return isPhone;
  return undefined;
}

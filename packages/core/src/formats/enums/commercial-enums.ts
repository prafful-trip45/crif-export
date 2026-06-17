/**
 * Commercial UCRF coded values. These are the commonly used subsets; extend from
 * the CRIF "Commercial UCRF - V3.9" PDF appendices as needed. Validation only
 * checks membership when an enum is attached to a field.
 */

/** Currency codes (ISO-ish, CRIF uses 3-letter). */
export const CURRENCY = {
  INR: 'Indian Rupee',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'Pound Sterling',
} as const;

/** Information type on the header (01 = full/standard submission). */
export const INFO_TYPE = {
  '01': 'Standard submission',
  '02': 'Correction',
} as const;

/**
 * Indian state / union-territory numeric codes used across CRIF formats.
 * (Two-digit; subset shown — complete in the spec PDF Appendix.)
 */
export const STATE_CODE = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '19': 'West Bengal',
  '21': 'Odisha',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
} as const;

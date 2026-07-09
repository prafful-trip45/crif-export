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

/** Information type on the header. V3.9 used 01/02; V3.10 (§7.1) uses the reporting-cycle
 * codes ME (Month End), W1/W2/W3 (weekly), DL (daily). */
export const INFO_TYPE = {
  '01': 'Standard submission',
  '02': 'Correction',
  ME: 'Month End',
  W1: 'Week 1',
  W2: 'Week 2',
  W3: 'Week 3',
  DL: 'Daily',
} as const;

/**
 * Indian state / union-territory numeric codes — CRIF Commercial UCRF V3.9
 * catalogue 8.6 (authoritative). Two-digit codes.
 *
 * NOTE: earlier this table used a DIFFERENT (wrong) numbering (UP=09, Gujarat=24);
 * the values below match the spec PDF and the production goldens (Gujarat=11,
 * Maharashtra=20, Uttar Pradesh=33). See the `crif-commercial-format` skill.
 */
export const STATE_CODE = {
  '01': 'Andaman and Nicobar Islands',
  '02': 'Andhra Pradesh',
  '03': 'Arunachal Pradesh',
  '04': 'Assam',
  '05': 'Bihar',
  '06': 'Chandigarh',
  '07': 'Chhattisgarh',
  '08': 'Dadra and Nagar Haveli and Daman and Diu', // V3.10 combines 08 & 09 (both still accepted)
  '09': 'Daman and Diu',
  '10': 'Goa',
  '11': 'Gujarat',
  '12': 'Haryana',
  '13': 'Himachal Pradesh',
  '14': 'Jammu and Kashmir',
  '15': 'Jharkhand',
  '16': 'Karnataka',
  '17': 'Kerala',
  '18': 'Lakshadweep',
  '19': 'Madhya Pradesh',
  '20': 'Maharashtra',
  '21': 'Manipur',
  '22': 'Meghalaya',
  '23': 'Mizoram',
  '24': 'Nagaland',
  '25': 'New Delhi',
  '26': 'Orissa',
  '27': 'Puducherry',
  '28': 'Punjab',
  '29': 'Rajasthan',
  '30': 'Sikkim',
  '31': 'Tamil Nadu',
  '32': 'Tripura',
  '33': 'Uttar Pradesh',
  '34': 'Uttarakhand',
  '35': 'West Bengal',
  '36': 'Telangana',
  '37': 'Ladakh', // V3.10 addition
  '77': 'Foreign address', // V3.10 addition
} as const;

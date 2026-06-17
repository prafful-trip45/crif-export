/** Consumer UCRF-12 V3.73 coded values (subset; extend from the spec Appendices). */

export const GENDER = { '1': 'Male', '2': 'Female', '3': 'Transgender' } as const;

/** ID types (ID segment field 01). */
export const ID_TYPE = {
  '01': 'PAN',
  '02': 'Passport',
  '03': 'Voter ID',
  '04': 'Driving Licence',
  '05': 'UID (Aadhaar)',
  '06': 'Ration Card',
  '07': 'CKYC',
} as const;

/** Phone types (PT segment). */
export const PHONE_TYPE = {
  '01': 'Mobile',
  '02': 'Home',
  '03': 'Office',
  '04': 'Other',
} as const;

/** Account / loan type (TL segment field 04) — common subset of Appendix D. */
export const ACCOUNT_TYPE = {
  '01': 'Auto Loan',
  '02': 'Housing Loan',
  '03': 'Property Loan',
  '04': 'Loan Against Shares',
  '05': 'Personal Loan',
  '06': 'Consumer Loan',
  '07': 'Gold Loan',
  '08': 'Education Loan',
  '10': 'Credit Card',
  '13': 'Business Loan',
} as const;

/** Account ownership indicator (TL field 05). */
export const OWNERSHIP = {
  '1': 'Individual',
  '2': 'Authorised User',
  '3': 'Guarantor',
  '4': 'Joint',
  '5': 'Deceased',
} as const;

/** Numeric state codes (Consumer PA segment field 06). */
export const STATE_CODE = {
  '27': 'Maharashtra',
  '07': 'Delhi',
  '29': 'Karnataka',
  '33': 'Tamil Nadu',
  '09': 'Uttar Pradesh',
  '19': 'West Bengal',
  '24': 'Gujarat',
  '32': 'Kerala',
} as const;

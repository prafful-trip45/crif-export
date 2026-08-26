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
  '12': 'Commercial Vehicle Loan',
  '13': 'Business Loan',
  '51': 'Business Loan - Priority',
  '52': 'Business Loan - General',
} as const;

/** Account ownership indicator (TL field 05). */
export const OWNERSHIP = {
  '1': 'Individual',
  '2': 'Authorised User',
  '3': 'Guarantor',
  '4': 'Joint',
  '5': 'Deceased',
} as const;

/** Numeric state codes (Consumer PA segment field 06 - Census/GST standard). */
export const STATE_CODE = {
  '01': 'Jammu and Kashmir',
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
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh',
  '99': 'Other',
} as const;

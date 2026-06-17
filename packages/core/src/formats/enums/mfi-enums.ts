/** MFI CDF V2.0 coded value tables (CRIF Highmark CDF layout). */

export const GENDER = { F: 'Female', M: 'Male', T: 'Transgender' } as const;

export const MARITAL_STATUS = {
  M01: 'Married',
  M02: 'Separated',
  M03: 'Divorced',
  M04: 'Widowed',
  M05: 'Unmarried',
  M06: 'Untagged',
} as const;

export const RELATIONSHIP = {
  K01: 'Father',
  K02: 'Husband',
  K03: 'Mother',
  K04: 'Wife',
  K05: 'Son',
  K06: 'Daughter',
  K07: 'Brother',
  K08: 'Sister',
  K09: 'Father-in-law',
  K10: 'Mother-in-law',
  K11: 'Son-in-law',
  K12: 'Daughter-in-law',
  K13: 'Brother-in-law',
  K14: 'Sister-in-law',
  K15: 'Other',
} as const;

export const RELIGION = {
  R01: 'Hindu',
  R02: 'Muslim',
  R03: 'Christian',
  R04: 'Sikh',
  R05: 'Buddhist',
  R06: 'Jain',
  R07: 'Bahai',
  R08: 'Others',
  R09: 'Religion not stated',
} as const;

export const LOAN_CATEGORY = {
  T01: 'JLG Group',
  T02: 'JLG Individual',
  T03: 'Individual',
  T04: 'SHG Group',
} as const;

export const ACCOUNT_STATUS = {
  S01: 'Submitted/Pending',
  S02: 'Approved (not disbursed)',
  S03: 'Declined',
  S04: 'Current/Active',
  S05: 'Delinquent',
  S06: 'Written Off',
  S07: 'Closed',
  S08: 'Restructured (COVID-19)',
  S09: 'Restructured & Closed',
  S10: 'Settled',
  S11: 'Post Write Off Settled',
  S12: 'Post Write Off Closed',
  S15: 'Cancelled',
} as const;

export const REPAYMENT_FREQUENCY = {
  F01: 'Weekly',
  F02: 'Biweekly',
  F03: 'Monthly',
  F04: 'Bimonthly',
  F05: 'Quarterly',
  F06: 'Semi-annually',
  F07: 'Annually',
  F08: 'Single Payment (bullet/balloon)',
  F10: 'Other',
} as const;

export const INSURANCE_TYPE = {
  L01: 'Life',
  L02: 'Credit',
  L03: 'Health/Medical',
  L04: 'Property',
  L05: 'Liability',
  L10: 'Other',
} as const;

export const ORG_STRUCTURE = { S01: 'Member-based', S02: 'Account-based' } as const;

/** Two-letter Indian state/UT codes used in MFI ADRCRD. */
export const STATE_CODE_ALPHA = {
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CG: 'Chhattisgarh',
  GA: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  HP: 'Himachal Pradesh',
  JK: 'Jammu & Kashmir',
  JH: 'Jharkhand',
  KA: 'Karnataka',
  KL: 'Kerala',
  MP: 'Madhya Pradesh',
  MH: 'Maharashtra',
  MN: 'Manipur',
  ML: 'Meghalaya',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OR: 'Odisha',
  PB: 'Punjab',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TN: 'Tamil Nadu',
  TS: 'Telangana',
  TR: 'Tripura',
  UK: 'Uttarakhand',
  UP: 'Uttar Pradesh',
  WB: 'West Bengal',
  AN: 'Andaman & Nicobar',
  CH: 'Chandigarh',
  DN: 'Dadra & Nagar Haveli',
  DD: 'Daman & Diu',
  DL: 'Delhi',
  LD: 'Lakshadweep',
  PY: 'Puducherry',
} as const;

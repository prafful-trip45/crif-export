import type { FieldSpec, FormatSpec, SegmentSpec, TypedRow } from '../core/types.js';
import { formatDdmmccyy } from '../encoding/formatters/date.js';

/**
 * Per the CDF V2.0 rules, several fields became mandatory for all NEW disbursals
 * on or after 1-Apr-2022. We treat an account as a new disbursal when its
 * Date Opened/Disbursed is on/after that cutoff.
 */
const NEW_DISBURSAL_CUTOFF = Date.UTC(2022, 3, 1);
function isNewDisbursal(row: TypedRow): boolean {
  const d = row.disbursedDate;
  if (d instanceof Date) return d.getTime() >= NEW_DISBURSAL_CUTOFF;
  // disbursedDate may already be a DDMMCCYY string at validation time.
  if (typeof d === 'string' && /^\d{8}$/.test(d)) {
    return Date.UTC(+d.slice(4, 8), +d.slice(2, 4) - 1, +d.slice(0, 2)) >= NEW_DISBURSAL_CUTOFF;
  }
  return false;
}
import {
  ACCOUNT_STATUS,
  GENDER,
  LOAN_CATEGORY,
  MARITAL_STATUS,
  ORG_STRUCTURE,
  RELATIONSHIP,
  REPAYMENT_FREQUENCY,
  STATE_CODE_ALPHA,
} from './enums/mfi-enums.js';

/**
 * MFI CDF V2.0 (CRIF Highmark). One single physical line:
 *   HDR<fixed-width> + CNSCRD|... + ADRCRD|... + ACTCRD|... + TRL<fixed-width>
 *
 * Header/trailer are fixed-width (positional). Body segments are pipe-delimited
 * and concatenated directly with no separator (the next segment's tag is its own
 * marker). Field widths verified against the provided golden .CDF.
 */

// --- fixed-width header / trailer fields ---
const fw = (key: string, label: string, length: number, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  type: 'string',
  length,
  pad: 'right',
  padChar: ' ',
  mandatory: false,
  ...extra,
});

const HDR: SegmentSpec = {
  tag: 'HDR',
  encoding: 'fixed-width',
  cardinality: 'header',
  fields: [
    fw('_segId', 'Segment Identifier', 3, { default: 'HDR', mandatory: true }),
    fw('_fileName', 'Submission File Name', 5, { default: 'HMMFI', mandatory: true }),
    fw('version', 'Layout Version', 3, { default: '1.9', mandatory: true }),
    fw('memberId', 'Submitting MFI ID', 10, { mandatory: true }),
    fw('memberName', 'Submitting MFI Name', 30, { mandatory: true }),
    fw('branchId', 'Submitting Branch ID', 10),
    { key: 'reportingDate', label: 'Reported Date', type: 'date-ddmmccyy', length: 8, mandatory: true },
    { key: 'creationDate', label: 'File Creation Date', type: 'date-ddmmccyy', length: 8, mandatory: true },
    fw('orgStructure', 'Org Member Structure Indicator', 3, { enum: ORG_STRUCTURE }),
    fw('password', 'Password', 30, { mandatory: true }),
    fw('vendorId', 'System Vendor Identifier', 30, { default: 'INHOUSE' }),
    fw('vendorVersion', 'Vendor System Version', 30, { default: 'INHOUSE' }),
    fw('hdrReserved', 'Reserved', 1),
  ],
};

const TRL: SegmentSpec = {
  tag: 'TRL',
  encoding: 'fixed-width',
  cardinality: 'trailer',
  fields: [
    fw('_segId', 'Segment Identifier', 3, { default: 'TRL', mandatory: true }),
    fw('_fileName', 'Submission File Name', 5, { default: 'HMMFI', mandatory: true }),
    fw('version', 'Layout Version', 3, { default: '1.9', mandatory: true }),
    fw('memberId', 'Submitting MFI ID', 10, { mandatory: true }),
    fw('trlReserved', 'Reserved', 20),
  ],
};

// --- pipe-delimited body fields ---
const tag = (t: string): FieldSpec => ({ key: '_tag', type: 'string', mandatory: true, default: t });
const p = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  type: 'string',
  mandatory: false,
  ...extra,
});
const pReq = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  ...p(key, label, extra),
  mandatory: true,
});
const pDate = (key: string, label: string, mandatory = false): FieldSpec => ({
  key,
  label,
  type: 'date-ddmmccyy',
  mandatory,
});

// 56 tokens incl tag (verified against golden)
const CNSCRD: SegmentSpec = {
  tag: 'CNSCRD',
  encoding: 'pipe-delimited',
  flag: 1,
  cardinality: 'one-per-borrower',
  fields: [
    tag('CNSCRD'),
    pReq('memberIdentifier', 'Member Identifier'), // 1
    pReq('branchIdentifier', 'Branch Identifier'), // 2
    pReq('kendraIdentifier', 'Kendra/Centre Identifier'), // 3
    p('groupIdentifier', 'Group Identifier'), // 4
    pReq('memberName1', 'Member Name 1'), // 5
    p('memberName2', 'Member Name 2'), // 6
    p('memberName3', 'Member Name 3'), // 7
    p('alternateName', 'Alternate Name'), // 8
    pDate('birthDate', 'Member Birth Date', true), // 9
    pReq('age', 'Member Age', { type: 'numeric' }), // 10
    pReq('ageAsOnDate', 'Age as on (years)', { type: 'numeric' }), // 11
    pReq('gender', 'Gender', { type: 'enum', enum: GENDER }), // 12
    pReq('maritalStatus', 'Marital Status', { type: 'enum', enum: MARITAL_STATUS }), // 13
    pReq('keyPersonName', "Key Person's Name"), // 14
    pReq('keyPersonRelationship', "Key Person's Relationship", { type: 'enum', enum: RELATIONSHIP }), // 15
    p('relName1', 'Relationship Name 1'), // 16
    p('relType1', 'Relationship Type 1', { enum: RELATIONSHIP }), // 17
    p('relName2', 'Relationship Name 2'), // 18
    p('relType2', 'Relationship Type 2', { enum: RELATIONSHIP }), // 19
    p('relName3', 'Relationship Name 3'), // 20
    p('relType3', 'Relationship Type 3', { enum: RELATIONSHIP }), // 21
    p('relName4', 'Relationship Name 4'), // 22
    p('relType4', 'Relationship Type 4', { enum: RELATIONSHIP }), // 23
    p('nomineeName', 'Nominee Name'), // 24
    p('nomineeRelationship', 'Nominee Relationship', { enum: RELATIONSHIP }), // 25
    p('nomineeAge', 'Nominee Age', { type: 'numeric' }), // 26
    p('voterId', 'Voter ID'), // 27
    p('uid', 'UID (Aadhaar)'), // 28
    p('pan', 'PAN'), // 29
    p('rationCard', 'Ration Card'), // 30
    p('otherId1Type', 'Other ID 1 Type'), // 31
    p('otherId1Value', 'Other ID 1 Value'), // 32
    p('otherId2Type', 'Other ID 2 Type'), // 33
    p('otherId2Value', 'Other ID 2 Value'), // 34
    p('otherId3Type', 'Other ID 3 Type'), // 35
    p('otherId3Value', 'Other ID 3 Value'), // 36
    p('tel1Type', 'Telephone 1 Type'), // 37
    p('tel1Number', 'Telephone 1 Number'), // 38
    p('tel2Type', 'Telephone 2 Type'), // 39
    p('tel2Number', 'Telephone 2 Number'), // 40
    p('povertyIndex', 'Poverty Index', { type: 'numeric' }), // 41
    p('assetOwnership', 'Asset Ownership Indicator'), // 42
    p('numDependents', 'Number of Dependents', { type: 'numeric' }), // 43
    p('bankName', 'Bank Name'), // 44
    p('bankBranch', 'Bank Branch'), // 45
    p('bankAccount', 'Bank Account #'), // 46
    p('occupation', 'Occupation'), // 47
    p('monthlyFamilyIncome', 'Total Monthly Family Income', { type: 'numeric' }), // 48
    p('monthlyFamilyExpenses', 'Monthly Family Expenses', { type: 'numeric' }), // 49
    p('religion', 'Religion'), // 50
    p('caste', 'Caste'), // 51
    p('groupLeaderInd', 'Group Leader Indicator'), // 52
    p('centerLeaderInd', 'Center Leader Indicator'), // 53
    p('emailId', 'Email ID'), // 54
    p('cnsReserved', 'Reserved'), // 55
  ],
};

// 9 tokens incl tag (verified against golden)
const ADRCRD: SegmentSpec = {
  tag: 'ADRCRD',
  encoding: 'pipe-delimited',
  flag: 2,
  cardinality: 'one-per-borrower',
  fields: [
    tag('ADRCRD'),
    pReq('permanentAddress', 'Permanent Address'), // 1
    pReq('permanentState', 'Permanent State Code', { enum: STATE_CODE_ALPHA }), // 2
    pReq('permanentPin', 'Permanent PIN Code'), // 3
    pReq('currentAddress', 'Current Address'), // 4
    pReq('currentState', 'Current State Code', { enum: STATE_CODE_ALPHA }), // 5
    pReq('currentPin', 'Current PIN Code'), // 6
    p('adrDummy', 'Dummy'), // 7
    p('adrReserved', 'Reserved'), // 8
  ],
};

// 38 tokens incl tag (verified against golden)
const ACTCRD: SegmentSpec = {
  tag: 'ACTCRD',
  encoding: 'pipe-delimited',
  flag: 3,
  cardinality: 'many',
  fields: [
    tag('ACTCRD'),
    pReq('uniqueAccountRef', 'Unique Account Reference Number'), // 1
    pReq('accountNumber', 'Account Number'), // 2
    pReq('actBranchIdentifier', 'Branch Identifier'), // 3
    pReq('actKendraIdentifier', 'Kendra/Centre Identifier'), // 4
    p('loanOfficer', 'Loan Officer'), // 5
    pDate('dateOfAccountInfo', 'Date of Account Information', true), // 6
    pReq('loanCategory', 'Loan Category', { type: 'enum', enum: LOAN_CATEGORY }), // 7
    p('actGroupIdentifier', 'Group Identifier'), // 8
    p('loanCycleId', 'Loan Cycle ID'), // 9
    pReq('loanPurpose', 'Loan Purpose'), // 10
    pReq('accountStatus', 'Account Status', { type: 'enum', enum: ACCOUNT_STATUS }), // 11
    pDate('applicationDate', 'Application Date'), // 12
    pDate('sanctionedDate', 'Sanctioned Date'), // 13
    pDate('disbursedDate', 'Date Opened/Disbursed', true), // 14
    pDate('closedDate', 'Date Closed'), // 15
    pDate('lastPaymentDate', 'Date of Last Payment'), // 16
    p('appliedAmount', 'Applied For Amount', { type: 'numeric' }), // 17
    pReq('sanctionedAmount', 'Loan Amount Sanctioned', { type: 'numeric' }), // 18
    pReq('disbursedAmount', 'Total Amount Disbursed', { type: 'numeric' }), // 19
    p('numInstallments', 'Number of Installments', { type: 'numeric', mandatory: isNewDisbursal }), // 20
    p('repaymentFrequency', 'Repayment Frequency', { enum: REPAYMENT_FREQUENCY, mandatory: isNewDisbursal }), // 21
    p('installmentAmount', 'Installment Amount', { type: 'numeric', mandatory: isNewDisbursal }), // 22
    pReq('currentBalance', 'Current Balance', { type: 'numeric' }), // 23
    pReq('amountOverdue', 'Amount Overdue', { type: 'numeric' }), // 24
    p('dpd', 'Days Past Due'), // 25
    p('writeOffAmount', 'Write Off Amount', { type: 'numeric' }), // 26
    pDate('writeOffDate', 'Date Write-Off'), // 27
    p('writeOffReason', 'Write-off Reason'), // 28
    p('meetingsHeld', 'No. of Meetings Held', { type: 'numeric' }), // 29
    p('meetingsMissed', 'No. of Meetings Missed', { type: 'numeric' }), // 30
    p('insuranceIndicator', 'Insurance Indicator'), // 31
    p('insuranceType', 'Type of Insurance'), // 32
    p('sumAssured', 'Sum Assured', { type: 'numeric' }), // 33
    p('meetingDay', 'Agreed Meeting Day'), // 34
    p('meetingTime', 'Agreed Meeting Time'), // 35
    p('actDummy', 'Dummy'), // 36
    p('actReserved', 'Reserved'), // 37
  ],
};

export const mfiCdf: FormatSpec = {
  id: 'mfi-cdf',
  label: 'MFI CDF V2.0',
  version: '2.0',
  outputExtension: '.CDF',
  physicalLayout: 'single-physical-line',
  lineEnding: '\r\n',
  fileEncoding: 'latin1',
  header: HDR,
  body: [CNSCRD, ADRCRD, ACTCRD],
  trailer: TRL,
  buildHeaderRow: (meta): TypedRow => ({
    _segId: 'HDR',
    _fileName: 'HMMFI',
    version: (meta.version as string) ?? '1.9',
    memberId: meta.memberId,
    memberName: meta.memberName ?? '',
    branchId: (meta.branchId as string) ?? '',
    reportingDate: formatDdmmccyy(meta.reportingDate),
    creationDate: formatDdmmccyy(meta.creationDate),
    orgStructure: (meta.orgStructure as string) ?? '',
    password: meta.password ?? '',
    vendorId: (meta.vendorId as string) ?? 'INHOUSE',
    vendorVersion: (meta.vendorVersion as string) ?? 'INHOUSE',
    hdrReserved: '',
  }),
  buildTrailerRow: (_counts, meta): TypedRow => ({
    _segId: 'TRL',
    _fileName: 'HMMFI',
    version: (meta.version as string) ?? '1.9',
    memberId: meta.memberId,
    trlReserved: '',
  }),
};

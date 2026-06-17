import type { FieldSpec, FormatSpec, SegmentSpec, TypedRow } from '../core/types.js';
import { formatDdmmyyyy } from '../encoding/formatters/date.js';

/**
 * Consumer UCRF-12 — REAL-WORLD "Data Submission Form" output profile.
 *
 * Verified byte-for-byte against the production sample pair:
 *   in : NB94430001-15052026-19052026-125412-F1-Text.Tap.xlsx ("Data Submission Form" sheet)
 *   out: 024FP02726-15052026-19052026-113111-F1.txt
 *
 * Physical layout: 146-byte TUDF header glued onto the first consumer record
 * (line 0 = header + record0), then one consumer record per CRLF-separated line.
 * No trailer. Each record is a pure CONCATENATION of formatted field values —
 * no segment markers, field tags, length prefixes, or delimiters.
 *
 * The 24-field record order below reconstructs both sample lines exactly from the
 * input sheet columns (A,B,C,D,P,X,Y,Z,AA,AB,AH,AI,AJ,AK,AL,AM,AP,AQ,AR,AS,AT,AZ,BB,BG).
 */

const GENDER = { '1': 'Female', '2': 'Male', '3': 'Transgender' } as const;

const c = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  type: 'string',
  mandatory: false,
  ...extra,
});

/** One consumer record = concatenated fields in this exact order. */
const RECORD: SegmentSpec = {
  tag: 'REC',
  encoding: 'concatenated',
  flag: 1,
  cardinality: 'one-per-borrower',
  fields: [
    c('consumerName', 'Consumer Name', { mandatory: true }), // PN/01 (col A)
    c('dateOfBirth', 'Date of Birth', { type: 'date-ddmmyyyy', mandatory: true }), // PN/07 (B)
    c('gender', 'Gender', { type: 'enum', enum: GENDER, mandatory: true }), // PN/08 (C)
    c('pan', 'Income Tax ID Number'), // ID/01 (D)
    c('mobile', 'Telephone No.Mobile'), // PT/01 (P)
    c('addressLine1', 'Address Line 1', { mandatory: true }), // PA/01 (X)
    c('stateCode', 'State Code 1'), // PA/06 (Y)
    c('pinCode', 'PIN Code 1'), // PA/07 (Z)
    c('addressCategory', 'Address Category 1'), // PA/08 (AA)
    c('residenceCode', 'Residence Code 1'), // PA/09 (AB)
    c('memberCode', 'Current/New Member Code', { mandatory: true }), // TL/01 (AH)
    c('memberShortName', 'Current/New Member Short Name'), // TL/02 (AI)
    c('accountNumber', 'Curr/New Account No', { mandatory: true }), // TL/03 (AJ)
    c('accountType', 'Account Type'), // TL/04 (AK)
    c('ownershipIndicator', 'Ownership Indicator'), // TL/05 (AL)
    c('dateOpened', 'Date Opened/Disbursed', { type: 'date-ddmmyyyy' }), // TL/08 (AM)
    c('dateReported', 'Date Reported', { type: 'date-ddmmyyyy' }), // TL/11 (AP)
    c('highCredit', 'High Credit/Sanctioned Amt', { type: 'numeric' }), // TL/12 (AQ)
    c('currentBalance', 'Current Balance', { type: 'numeric' }), // TL/13 (AR)
    c('amountOverdue', 'Amt Overdue', { type: 'numeric' }), // TL/14 (AS)
    c('daysPastDue', 'No of Days Past Due', { type: 'numeric' }), // TL/15 (AT)
    c('suitFiled', 'Suit Filed / Wilful Default'), // TL/21 (AZ)
    c('assetClassification', 'Asset Classification'), // TL/26 (BB)
    c('rateOfInterest', 'Rate of Interest'), // TL/38 (BG)
  ],
};

/** 146-byte fixed-width TUDF header (per spec; populated from the input form). */
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

const TUDF: SegmentSpec = {
  tag: 'TUDF',
  encoding: 'fixed-width',
  cardinality: 'header',
  fields: [
    fw('_recordType', 'Record Type', 4, { default: 'TUDF', mandatory: true }),
    fw('version', 'Version', 2, { default: '12', mandatory: true }),
    fw('memberId', 'Reporting Member / Processor ID', 30, { mandatory: true }),
    fw('memberShortName', 'Reporting Member Short Name', 16),
    fw('cycleId', 'Cycle Identification', 2),
    { key: 'reportingDate', label: 'Date Reported & Certified', type: 'date-ddmmyyyy', length: 8, pad: 'right', padChar: ' ', mandatory: true },
    fw('password', 'Reporting Password', 30, { mandatory: true }),
    fw('authMethod', 'Authentication Method', 1, { default: 'A' }),
    fw('futureUse', 'Future Use', 5, { default: '00000' }),
    fw('memberData', 'Member Data', 48),
  ],
};

/** Unused (omitted), present to satisfy the FormatSpec shape. */
const NO_TRAILER: SegmentSpec = { tag: 'NONE', encoding: 'fixed-width', cardinality: 'trailer', fields: [] };

export const consumerUcrf12Flat: FormatSpec = {
  id: 'consumer-ucrf12-flat',
  label: 'Consumer UCRF-12 (Data Submission Form)',
  version: '3.73',
  outputExtension: '.txt',
  physicalLayout: 'one-line-per-record',
  lineEnding: '\r\n',
  fileEncoding: 'latin1',
  glueHeaderToFirstRecord: true,
  omitTrailer: true,
  flatInput: { sheet: 'Data Submission Form', labelRow: 10, firstDataRow: 11 },
  header: TUDF,
  body: [RECORD],
  trailer: NO_TRAILER,
  buildHeaderRow: (meta): TypedRow => ({
    _recordType: 'TUDF',
    version: '12',
    memberId: meta.memberId,
    memberShortName: (meta.memberShortName as string) ?? '',
    cycleId: (meta.cycleId as string) ?? '',
    reportingDate: formatDdmmyyyy(meta.reportingDate),
    password: meta.password ?? '',
    authMethod: (meta.authMethod as string) ?? 'A',
    futureUse: '00000',
    memberData: '',
  }),
  buildTrailerRow: (): TypedRow => ({}),
};

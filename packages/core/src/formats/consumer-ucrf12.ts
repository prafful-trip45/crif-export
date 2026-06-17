import type { FieldSpec, FormatSpec, SegmentSpec, TypedRow } from '../core/types.js';
import { formatDdmmyyyy } from '../encoding/formatters/date.js';
import { ACCOUNT_TYPE, GENDER, ID_TYPE, PHONE_TYPE, STATE_CODE } from './enums/consumer-enums.js';

/**
 * Consumer UCRF-12 V3.73 (CRIF Highmark).
 *
 * - TUDF header: 146-char fixed-width.
 * - Body segments (PN, ID, PT, PA, TL): self-describing coded-field encoding —
 *   7-byte segment header `[tag(2)][version(2)][subtype(1)][recType(2)]` then
 *   `[fieldTag(2)][len(2)][value]` TLV fields. Absent optional fields omitted.
 * - File ends with the `ES02` End-of-Subject marker + `**TRLR` literal.
 *
 * Field tags + the 7-byte header verified to decode the golden sample cleanly:
 *   PN03N01 0111Mahima Jain 0708 05051986 0801 1
 *   ID03I01 0102 01 0210 XXXX0000X
 *   PT03T01 0110 9999999999 0302 01
 *   PA03A01 0111 AXIS CENTRA 0304 PUNE 0602 27 0706 110450 0802 01
 *   TL04T00 1011 0COP0000XXX 0208 CRIFHIGH 0317 ABCD123456789DCBA ...
 */

// coded-field: `code` is the 2-digit field tag.
const c = (code: string, key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  code,
  key,
  label,
  type: 'string',
  mandatory: false,
  ...extra,
});

const PN: SegmentSpec = {
  tag: 'PN',
  version: '03',
  codedHeaderSuffix: 'N01',
  encoding: 'coded-field',
  flag: 1,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'name', 'Consumer Name', { mandatory: true, maxLength: 99 }),
    c('07', 'dateOfBirth', 'Date of Birth', { type: 'date-ddmmyyyy', mandatory: true }),
    c('08', 'gender', 'Gender', { type: 'enum', enum: GENDER }),
  ],
};

const ID: SegmentSpec = {
  tag: 'ID',
  version: '03',
  codedHeaderSuffix: 'I01',
  encoding: 'coded-field',
  flag: 2,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'idType', 'ID Type', { type: 'enum', enum: ID_TYPE }),
    c('02', 'idNumber', 'ID Number', { maxLength: 30 }),
  ],
};

const PT: SegmentSpec = {
  tag: 'PT',
  version: '03',
  codedHeaderSuffix: 'T01',
  encoding: 'coded-field',
  flag: 3,
  cardinality: 'optional-per-borrower',
  fields: [
    c('01', 'phoneNumber', 'Telephone Number'),
    c('03', 'phoneType', 'Telephone Type', { type: 'enum', enum: PHONE_TYPE }),
  ],
};

const PA: SegmentSpec = {
  tag: 'PA',
  version: '03',
  codedHeaderSuffix: 'A01',
  encoding: 'coded-field',
  flag: 4,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'addressLine1', 'Address Line 1', { mandatory: true, maxLength: 99 }),
    c('03', 'city', 'City/Town'),
    c('06', 'stateCode', 'State Code', { type: 'enum', enum: STATE_CODE }),
    c('07', 'pinCode', 'PIN Code'),
    c('08', 'addressCategory', 'Address Category'),
  ],
};

const TL: SegmentSpec = {
  tag: 'TL',
  version: '04',
  codedHeaderSuffix: 'T00',
  encoding: 'coded-field',
  flag: 5,
  cardinality: 'many',
  fields: [
    c('10', 'memberId', 'Member Short Name / ID', { mandatory: true }),
    c('02', 'bureau', 'Bureau Code', { default: 'CRIFHIGH' }),
    c('03', 'accountNumber', 'Account Number', { mandatory: true, maxLength: 30 }),
    c('04', 'accountType', 'Account Type', { type: 'enum', enum: ACCOUNT_TYPE }),
    c('05', 'ownershipIndicator', 'Ownership Indicator'),
    c('08', 'dateOpened', 'Date Opened/Disbursed', { type: 'date-ddmmyyyy' }),
    c('09', 'dateLastPayment', 'Date of Last Payment', { type: 'date-ddmmyyyy' }),
    c('11', 'dateReported', 'Date Reported and Certified', { type: 'date-ddmmyyyy' }),
    c('12', 'highCreditAmount', 'High Credit / Sanctioned Amount', { type: 'numeric' }),
    c('13', 'currentBalance', 'Current Balance', { type: 'numeric' }),
    c('14', 'amountOverdue', 'Amount Overdue', { type: 'numeric' }),
    c('15', 'paymentHistory', 'Payment History'),
    c('26', 'suitFiledStatus', 'Suit Filed / Wilful Default Status'),
  ],
};

/**
 * The TUDF header is one fixed-width 146-char record (positions verified against
 * the golden). Modelled as fixed-width fields; the trailing fillers pad to 146.
 */
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
    fw('memberId', 'Member / Processor User ID', 30, { mandatory: true }),
    fw('memberShortName', 'Member Short Name', 16, { default: 'CRIFHIGH' }),
    fw('cycleId', 'Cycle Identification', 2),
    { key: 'reportingDate', label: 'Date Reported & Certified', type: 'date-ddmmyyyy', length: 8, pad: 'right', padChar: ' ', mandatory: true },
    fw('password', 'Reporting Password', 30, { mandatory: true }),
    fw('authMethod', 'Authentication Method', 1, { default: 'L' }),
    fw('futureUse', 'Future Use', 5, { default: '00000' }),
    fw('memberData', 'Member Data', 48),
  ],
};

/** Trailer = End-of-Subject marker `ES02` + `**TRLR`. */
const TRLR: SegmentSpec = {
  tag: 'TRLR',
  encoding: 'fixed-width',
  cardinality: 'trailer',
  fields: [fw('_marker', 'End marker', 10, { default: 'ES02**TRLR', mandatory: true })],
};

export const consumerUcrf12: FormatSpec = {
  id: 'consumer-ucrf12',
  label: 'Consumer UCRF-12 V3.73',
  version: '3.73',
  outputExtension: '.txt',
  physicalLayout: 'one-line-per-record',
  lineEnding: '\r\n',
  fileEncoding: 'latin1',
  header: TUDF,
  body: [PN, ID, PT, PA, TL],
  trailer: TRLR,
  buildHeaderRow: (meta): TypedRow => ({
    _recordType: 'TUDF',
    version: '12',
    memberId: meta.memberId,
    memberShortName: (meta.memberShortName as string) ?? 'CRIFHIGH',
    cycleId: (meta.cycleId as string) ?? '',
    reportingDate: formatDdmmyyyy(meta.reportingDate),
    password: meta.password ?? '',
    authMethod: (meta.authMethod as string) ?? 'L',
    futureUse: '00000',
    memberData: '',
  }),
  buildTrailerRow: (): TypedRow => ({ _marker: 'ES02**TRLR' }),
};

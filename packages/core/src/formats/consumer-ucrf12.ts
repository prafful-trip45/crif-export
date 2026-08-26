import type {
  FieldSpec,
  FieldValue,
  FileMeta,
  FlatExplodeContext,
  FormatSpec,
  SegmentSeed,
  SegmentSpec,
  TypedRow,
} from '../core/types.js';
import { formatDdmmyyyy } from '../encoding/formatters/date.js';
import { GENDER, ID_TYPE, PHONE_TYPE, STATE_CODE } from './enums/consumer-enums.js';

/**
 * Consumer UCRF-12 V3.73 / Canonical TUDF (CRIF Highmark).
 *
 * - TUDF header: 146-char fixed-width.
 * - Body segments (PN, ID, PT, EC, PA, TL): self-describing coded-field encoding —
 *   7-byte segment header `[tag(2)][version(2)][subtype(1)][recType(2)]` then
 *   `[fieldTag(2)][len(2)][value]` TLV fields.
 * - Each subject ends with the `ES02**` End-of-Subject marker.
 * - File ends with the `TRLR` literal (combined with final ES -> `ES02**TRLR`).
 */

// Helper for coded-field TLV spec
const c = (code: string, key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  code,
  key,
  label,
  type: 'string',
  mandatory: false,
  ...extra,
});

/** PN: Personal Name Segment (PN03N01) */
const PN: SegmentSpec = {
  tag: 'PN',
  version: '03',
  codedHeaderSuffix: 'N01',
  encoding: 'coded-field',
  flag: 1,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'name', 'Consumer Name / Surname', { mandatory: true, maxLength: 99, aliases: ['name1'] }),
    c('02', 'name2', 'First Name', { maxLength: 99 }),
    c('03', 'name3', 'Middle Name', { maxLength: 99 }),
    c('07', 'dateOfBirth', 'Date of Birth', { type: 'date-ddmmyyyy', mandatory: true }),
    c('08', 'gender', 'Gender', { type: 'enum', enum: GENDER }),
  ],
};

/** ID: Identification Segment (ID03I01) */
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

/** PT: Telephone Segment (PT03T01) */
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

/** EC: Email Contact Segment (EC03C01) */
const EC: SegmentSpec = {
  tag: 'EC',
  version: '03',
  codedHeaderSuffix: 'C01',
  encoding: 'coded-field',
  flag: 4,
  cardinality: 'optional-per-borrower',
  fields: [
    c('01', 'email', 'Email ID'),
  ],
};

/** PA: Address Segment (PA03A01) */
const PA: SegmentSpec = {
  tag: 'PA',
  version: '03',
  codedHeaderSuffix: 'A01',
  encoding: 'coded-field',
  flag: 5,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'addressLine1', 'Address Line 1', { mandatory: true, maxLength: 99 }),
    c('02', 'addressLine2', 'Address Line 2', { maxLength: 99 }),
    c('03', 'city', 'City/Town / Address Line 3', { maxLength: 99, aliases: ['addressLine3'] }),
    c('06', 'stateCode', 'State Code', { type: 'enum', enum: STATE_CODE }),
    c('07', 'pinCode', 'PIN Code'),
    c('08', 'addressCategory', 'Address Category'),
    c('09', 'residenceCode', 'Residence Code'),
  ],
};

/** TL: Account / Trade Line Segment (TL04T00) */
const TL: SegmentSpec = {
  tag: 'TL',
  version: '04',
  codedHeaderSuffix: 'T00',
  encoding: 'coded-field',
  flag: 6,
  cardinality: 'many',
  fields: [
    c('10', 'memberId', 'Member Short Name / ID', { mandatory: true }),
    c('02', 'memberShortName', 'Member Short Name'),
    c('03', 'accountNumber', 'Account Number', { mandatory: true, maxLength: 30 }),
    c('04', 'accountType', 'Account Type'),
    c('05', 'ownershipIndicator', 'Ownership Indicator'),
    c('08', 'dateOpened', 'Date Opened/Disbursed', { type: 'date-ddmmyyyy' }),
    c('09', 'dateLastPayment', 'Date of Last Payment', { type: 'date-ddmmyyyy' }),
    c('11', 'dateReported', 'Date Reported and Certified', { type: 'date-ddmmyyyy' }),
    c('12', 'highCreditAmount', 'High Credit / Sanctioned Amount', { mandatory: true, type: 'numeric' }),
    c('13', 'currentBalance', 'Current Balance', { mandatory: true, type: 'numeric' }),
    c('14', 'amountOverdue', 'Amount Overdue', { type: 'numeric' }),
    c('21', 'suitFiledStatus', 'Suit Filed / Wilful Default Status', { mandatory: true }),
    c('26', 'assetClassification', 'Asset Classification', { mandatory: true }),
    c('38', 'rateOfInterest', 'Rate of Interest', { mandatory: true, type: 'numeric' }),
    c('39', 'repaymentTenure', 'Repayment Tenure'),
  ],
};

/** ES: End of Subject Marker (ES02**) */
const ES: SegmentSpec = {
  tag: 'ES',
  encoding: 'fixed-width',
  flag: 7,
  cardinality: 'one-per-borrower',
  fields: [
    { key: '_marker', label: 'End Marker', type: 'string', length: 6, default: 'ES02**', mandatory: true },
  ],
};

/** Fixed-width TUDF header field helper. */
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

/** 146-char fixed-width TUDF header. */
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
    fw('password', 'Reporting Password', 30),
    fw('authMethod', 'Authentication Method', 1, { default: 'L' }),
    fw('futureUse', 'Future Use', 5, { default: '00000' }),
    fw('memberData', 'Member Data', 48),
  ],
};

/** File trailer `TRLR`. */
const TRLR: SegmentSpec = {
  tag: 'TRLR',
  encoding: 'fixed-width',
  cardinality: 'trailer',
  fields: [fw('_marker', 'End marker', 4, { default: 'TRLR', mandatory: true })],
};

/** Name splitter helper: breaks "FIRST MIDDLE LAST" or "SURNAME FIRST" into up to 3 name parts. */
function splitConsumerName(rawName: string): { name1: string; name2?: string; name3?: string } {
  const parts = rawName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name1: '' };
  if (parts.length === 1) return { name1: parts[0]! };
  if (parts.length === 2) return { name1: parts[0]!, name2: parts[1]! };
  return { name1: parts[0]!, name2: parts[1]!, name3: parts.slice(2).join(' ') };
}

/** Address splitter helper: splits a single long address string into chunks of max 40 chars. */
function splitConsumerAddress(rawAddr: string): { addressLine1: string; addressLine2?: string; addressLine3?: string } {
  const clean = rawAddr.trim();
  const c1 = clean.slice(0, 40).trim();
  const c2 = clean.slice(40, 80).trim();
  const c3 = clean.slice(80, 120).trim();
  return {
    addressLine1: c1,
    addressLine2: c2 || undefined,
    addressLine3: c3 || undefined,
  };
}

/** Columns mapping for "Data Submission Form" flat sheet. */
const CONSUMER_COLUMNS: Record<string, string> = {
  A: 'consumerName',
  B: 'dateOfBirth',
  C: 'gender',
  D: 'pan',
  P: 'mobile',
  V: 'email',
  X: 'address',
  Y: 'stateCode',
  Z: 'pinCode',
  AA: 'addressCategory',
  AB: 'residenceCode',
  AH: 'memberCode',
  AI: 'memberShortName',
  AJ: 'accountNumber',
  AK: 'accountType',
  AL: 'ownershipIndicator',
  AM: 'dateOpened',
  AN: 'dateLastPayment',
  AP: 'dateReported',
  AQ: 'highCredit',
  AR: 'currentBalance',
  AS: 'amountOverdue',
  AT: 'daysPastDue',
  AZ: 'suitFiled',
  BB: 'assetClassification',
  BG: 'rateOfInterest',
  BH: 'repaymentTenure',
  BI: 'emiAmount',
};

export const consumerUcrf12: FormatSpec = {
  id: 'consumer-tudf',
  label: 'Consumer TUDF Format',
  version: '3.73',
  outputExtension: '.tudf',
  physicalLayout: 'single-physical-line',
  lineEnding: '',
  fileEncoding: 'latin1',
  flatExplode: {
    sheet: 'Data Submission Form',
    firstDataRow: 11,
    headerRow: 10,
    columns: CONSUMER_COLUMNS,
    headerCells: {
      A6: 'memberName',
      B6: 'memberShortName',
      C6: 'cycleId',
      D6: 'reportingDate',
      E6: 'password',
    },
    explode: (row: Record<string, FieldValue>, ctx: FlatExplodeContext): SegmentSeed[] => {
      const rawName = String(row.consumerName ?? '');
      const rawAddr = String(row.address ?? '');
      const nameParts = splitConsumerName(rawName);
      const addrParts = splitConsumerAddress(rawAddr);

      const pnIssues: Array<{ fieldKey: string; message: string }> = [];
      if (rawName && rawName !== rawName.trim()) {
        pnIssues.push({
          fieldKey: 'consumerName',
          message: `Consumer Name "${rawName}" has leading/trailing whitespace. Clean extra spaces to prevent byte misalignment.`,
        });
      }

      const paIssues: Array<{ fieldKey: string; message: string }> = [];
      if (rawAddr && rawAddr !== rawAddr.trim()) {
        paIssues.push({
          fieldKey: 'address',
          message: 'Address Line 1 has leading/trailing whitespace. Clean extra spaces to prevent byte misalignment.',
        });
      }

      const tlIssues: Array<{ fieldKey: string; message: string }> = [];
      if (!row.suitFiled || String(row.suitFiled).trim() === '') {
        tlIssues.push({
          fieldKey: 'suitFiled',
          message: 'Mandatory field "Suit Filed / Wilful Default" (Column AZ) is blank. Fill "00" (No Suit Filed) to prevent CRIF portal rejection.',
        });
      }
      if (!row.rateOfInterest || String(row.rateOfInterest).trim() === '') {
        tlIssues.push({
          fieldKey: 'rateOfInterest',
          message: 'Mandatory field "Rate of Interest" (Column BG) is blank. Fill sanctioned interest rate to prevent CRIF portal rejection.',
        });
      }

      const seeds: SegmentSeed[] = [];

      // 1. PN: Personal Name
      seeds.push({
        tag: 'PN',
        flag: 1,
        values: {
          name: nameParts.name1,
          name2: nameParts.name2,
          name3: nameParts.name3,
          dateOfBirth: row.dateOfBirth,
          gender: row.gender,
        },
        issues: pnIssues.length > 0 ? pnIssues : undefined,
      });

      // 2. ID: Identification (PAN)
      if (row.pan) {
        seeds.push({
          tag: 'ID',
          flag: 2,
          values: {
            idType: '01',
            idNumber: row.pan,
          },
        });
      }

      // 3. PT: Telephone (Mobile)
      if (row.mobile) {
        seeds.push({
          tag: 'PT',
          flag: 3,
          values: {
            phoneNumber: row.mobile,
            phoneType: '01',
          },
        });
      }

      // 4. EC: Email (optional)
      seeds.push({
        tag: 'EC',
        flag: 4,
        values: {
          email: row.email ?? '',
        },
      });

      // 5. PA: Address
      seeds.push({
        tag: 'PA',
        flag: 5,
        values: {
          addressLine1: addrParts.addressLine1,
          addressLine2: addrParts.addressLine2,
          addressLine3: addrParts.addressLine3,
          stateCode: row.stateCode,
          pinCode: row.pinCode,
          addressCategory: row.addressCategory ?? '01',
          residenceCode: row.residenceCode,
        },
        issues: paIssues.length > 0 ? paIssues : undefined,
      });

      // 6. TL: Trade Line
      const memberCode = ctx.meta?.memberId || row.memberCode || '';
      const memberShortName = ctx.meta?.memberShortName || row.memberShortName || '';
      seeds.push({
        tag: 'TL',
        flag: 6,
        values: {
          memberId: memberCode,
          memberShortName: memberShortName,
          accountNumber: row.accountNumber,
          accountType: row.accountType,
          ownershipIndicator: row.ownershipIndicator ?? '1',
          dateOpened: row.dateOpened,
          dateLastPayment: row.dateLastPayment,
          dateReported: row.dateReported,
          highCreditAmount: row.highCredit,
          currentBalance: row.currentBalance,
          amountOverdue: row.amountOverdue && String(row.amountOverdue) !== '0' ? row.amountOverdue : '',
          suitFiledStatus: row.suitFiled ? String(row.suitFiled).trim() : '',
          assetClassification: row.assetClassification ? String(row.assetClassification).trim() : '01',
          rateOfInterest: row.rateOfInterest ? String(row.rateOfInterest).trim() : '',
          repaymentTenure: row.repaymentTenure,
        },
        issues: tlIssues.length > 0 ? tlIssues : undefined,
      });

      // 7. ES: End of Subject Marker
      seeds.push({
        tag: 'ES',
        flag: 7,
        values: {
          _marker: 'ES02**',
        },
      });

      return seeds;
    },
  },
  header: TUDF,
  body: [PN, ID, PT, EC, PA, TL, ES],
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
  buildTrailerRow: (): TypedRow => ({ _marker: 'TRLR' }),
};

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

/**
 * TL: Account / Trade Line Segment (TL04T001).
 *
 * NOTE the 4-character subtype: every other segment's tag is 3 chars (`N01`,
 * `I01`, `T01`, `C01`, `A01`) but the spec requires `T001` for TL (V3.73 p.20,
 * "Segment Tag ... F 04 ... Must contain the value T001"), making this segment
 * header 8 bytes rather than 7. Field tag 01 is the Reporting Member Code (fixed
 * 10) and must equal the member id in the TUDF header; tag 10 is Date Closed.
 *
 * Getting either wrong desynchronises the whole segment, and the two errors used
 * to cancel out: `T00` + tag `10` + len `11` + `0`-prefixed id encodes to the same
 * bytes as `T001` + tag `01` + len `10` + id. That coincidence held only while the
 * member id was passed in 11 chars — with the real 10-char id the desktop app
 * sends, CRIF reads tag 01 with length 00 and then hits garbage.
 */
const TL: SegmentSpec = {
  tag: 'TL',
  version: '04',
  codedHeaderSuffix: 'T001',
  encoding: 'coded-field',
  flag: 6,
  cardinality: 'many',
  fields: [
    c('01', 'memberId', 'Current/New Reporting Member Code', { mandatory: true }),
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
    // 15 and 26 are an either/or pair (V3.73 p.30): neither present -> Reject Record;
    // both present -> Days Past Due takes precedence. The sheet always carries DPD
    // (col AT, "0" for a current account), so 26 is required only when 15 is absent.
    c('15', 'daysPastDue', 'Number of Days Past Due', { type: 'numeric' }),
    // "When Available" (p.29): required only if the account has actually been
    // classified (suit filed / wilful default). A blank means not classified.
    c('21', 'suitFiledStatus', 'Suit Filed / Wilful Default Status'),
    c('26', 'assetClassification', 'Asset Classification', {
      mandatory: (v) => v.daysPastDue === undefined || v.daysPastDue === null || String(v.daysPastDue).trim() === '',
    }),
    // "When Available" (p.33): omitted when the accountant has no rate. Never
    // invented, never 0.0 (an explicit Reject-Field value). Pre-formatted by the
    // explode as digits.digits, e.g. "12.00", the shape CRIF's own sample uses.
    c('38', 'rateOfInterest', 'Rate of Interest'),
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
    // No spec default: 'CRIFHIGH' is CRIF's own sample short name, and a default
    // here shipped it in real headers whenever a form carried no header block.
    fw('memberShortName', 'Member Short Name', 16),
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

/**
 * Header-text mapping for the "Data Submission Form": the row-10 label -> input key.
 *
 * Real accountant files come in at least three shapes — the canonical form (tab
 * "Data Submission Form", labels on row 10), a form shifted up two rows on a
 * "Sheet1" tab with "Address 1"/"Address 2" labels (consumer_input_failing.xlsx),
 * and a bare export with labels on ROW 1 of a tab named "Consumer"
 * (consumer-debugging-aug-14). Fixed column letters only fit the first; with
 * labels the reader locates the header row and the data tab by content, and
 * `CONSUMER_COLUMNS` below is just the fallback for a key no label matched.
 * Labels are matched by folded prefix, so "Email ID 1" cannot bleed into "Email
 * ID 2" and "Current/New Member Code" stays distinct from "...Member Short Name".
 */
const CONSUMER_COLUMN_HEADERS: Record<string, string> = {
  'Consumer Name': 'consumerName',
  'Date of Birth': 'dateOfBirth',
  'Gender': 'gender',
  'Income Tax ID Number': 'pan',
  'Telephone No.Mobile': 'mobile',
  'Email ID 1': 'email',
  'Address Line 1': 'address',
  'Address 1': 'address',
  'State Code 1': 'stateCode',
  'PIN Code 1': 'pinCode',
  'Address Category 1': 'addressCategory',
  'Residence Code 1': 'residenceCode',
  'Current/New Member Code': 'memberCode',
  'Current/New Member Short Name': 'memberShortName',
  'Curr/New Account No': 'accountNumber',
  'Account Type': 'accountType',
  'Ownership Indicator': 'ownershipIndicator',
  'Date Opened/Disbursed': 'dateOpened',
  'Date of Last Payment': 'dateLastPayment',
  'Date Reported': 'dateReported',
  'High Credit/Sanctioned Amt': 'highCredit',
  'Current Balance': 'currentBalance',
  'Amt Overdue': 'amountOverdue',
  'No of Days Past Due': 'daysPastDue',
  'Suit Filed / Wilful Default': 'suitFiled',
  'Asset Classification': 'assetClassification',
  'Rate of Interest': 'rateOfInterest',
  'RepaymentTenure': 'repaymentTenure',
  'EMI Amount': 'emiAmount',
};

/** Fallback column letters for the canonical "Data Submission Form" layout. */
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
    columnHeaders: CONSUMER_COLUMN_HEADERS,
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

      const tlIssues: NonNullable<SegmentSeed['issues']> = [];

      // Suit Filed (tag 21) is "When Available": a blank is a legitimate "not
      // classified", so it is omitted, not blocked — but say so, because a suit or
      // wilful default that IS known must be reported.
      const suitFiled = row.suitFiled ? String(row.suitFiled).trim() : '';
      if (!suitFiled) {
        tlIssues.push({
          fieldKey: 'suitFiled',
          severity: 'warning',
          message: 'Suit Filed / Wilful Default (Column AZ) is blank — omitted (not classified). Enter 00 to state "No suit filed" explicitly, or 01/02/03 if a suit or wilful default exists.',
          reference: 'Consumer UCRF-12 V3.73 §TL tag 21 (When Available), p.29',
        });
      }

      // Rate of Interest (tag 38) is "When Available". Blank -> the tag is omitted;
      // never substitute a number. 0 is an explicit Reject-Field value, and the
      // format is digits.digits with at most 4 before / 3 after the point.
      const roiRaw = row.rateOfInterest === undefined || row.rateOfInterest === null ? '' : String(row.rateOfInterest).trim().replace(/%$/, '').trim();
      let rateOfInterest = '';
      if (!roiRaw) {
        tlIssues.push({
          fieldKey: 'rateOfInterest',
          severity: 'warning',
          message: 'Rate of Interest (Column BG) is blank — omitted. Leave it blank until the client supplies the sanctioned rate; do not enter 0.',
          reference: 'Consumer UCRF-12 V3.73 §TL tag 38 (When Available), p.33',
        });
      } else if (!/^\d+(\.\d+)?$/.test(roiRaw)) {
        tlIssues.push({
          fieldKey: 'rateOfInterest',
          rule: 'parse',
          message: `Rate of Interest "${roiRaw}" is not a number. Enter the annual rate as digits, e.g. 12 or 12.5, without the % sign.`,
          reference: 'Consumer UCRF-12 V3.73 §TL tag 38, p.33',
        });
      } else {
        const [intPart, decPart = ''] = roiRaw.split('.');
        if (Number(roiRaw) === 0) {
          tlIssues.push({
            fieldKey: 'rateOfInterest',
            rule: 'enum',
            message: 'Rate of Interest is 0, which CRIF rejects (Reject Field). Leave the cell blank if the rate is not known.',
            reference: 'Consumer UCRF-12 V3.73 §TL tag 38, p.33',
          });
        } else if (intPart!.replace(/^0+(?=\d)/, '').length > 4) {
          tlIssues.push({
            fieldKey: 'rateOfInterest',
            rule: 'parse',
            message: `Rate of Interest "${roiRaw}" has more than 4 digits before the decimal point.`,
            reference: 'Consumer UCRF-12 V3.73 §TL tag 38, p.33',
          });
        } else {
          rateOfInterest = `${intPart!.replace(/^0+(?=\d)/, '')}.${decPart.slice(0, 3).padEnd(2, '0')}`;
        }
      }

      // Days Past Due (tag 15): reported as-is, 0 for a current account, capped at
      // 900 as the spec instructs. It pairs with Asset Classification (tag 26):
      // at least one must be present, and DPD takes precedence when both are.
      const dpdRaw = row.daysPastDue === undefined || row.daysPastDue === null ? '' : String(row.daysPastDue).trim();
      const daysPastDue = /^\d+$/.test(dpdRaw) ? String(Math.min(Number(dpdRaw), 900)) : '';
      const assetClassification = row.assetClassification ? String(row.assetClassification).trim() : '';

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

      // 4. EC: Email — a "When Available" segment (V3.73 p.14). With no email there
      // is nothing to report, so the segment is omitted entirely; emitting a bare
      // `EC03C01` with zero fields is what CRIF rejects as "field count issue in the
      // EC Segment".
      const email = String(row.email ?? '').trim();
      if (email) {
        seeds.push({
          tag: 'EC',
          flag: 4,
          values: {
            email,
          },
        });
      }

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
      // Member id: the CRIF-assigned id from the flag replaces the raw id the accountant
      // typed (e.g. NB94430001 -> 024FP02726). Short name: no such translation exists,
      // so the sheet's own value wins and the flag is only a fallback — the same
      // precedence the header uses, so TL/02 and the TUDF header can never disagree.
      const memberCode = ctx.meta?.memberId || row.memberCode || '';
      const memberShortName = row.memberShortName || ctx.meta?.memberShortName || '';
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
          daysPastDue,
          suitFiledStatus: suitFiled,
          assetClassification,
          rateOfInterest,
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
    // No invented default: 'CRIFHIGH' is the short name in CRIF's own sample file,
    // and it shipped in real headers whenever a form's header block wasn't found.
    memberShortName: (meta.memberShortName as string) ?? '',
    cycleId: (meta.cycleId as string) ?? '',
    reportingDate: formatDdmmyyyy(meta.reportingDate),
    password: meta.password ?? '',
    authMethod: (meta.authMethod as string) ?? 'L',
    futureUse: '00000',
    memberData: '',
  }),
  buildTrailerRow: (): TypedRow => ({ _marker: 'TRLR' }),
};

import type {
  FieldSpec,
  FieldValue,
  FlatExplodeContext,
  FormatSpec,
  SegmentSpec,
  SegmentSeed,
  TypedRow,
} from '../core/types.js';
import { formatDdmmyyyy } from '../encoding/formatters/date.js';

/**
 * Consumer UCRF-12 — REAL-WORLD "Data Submission Form" → CANONICAL coded-field TLV.
 *
 * Unlike `consumer-ucrf12-flat` (which emits the concatenated profile), this reads
 * the same flat Data Submission Form but produces the canonical CRIF coded-field
 * TLV upload: a 146-char TUDF header glued onto a single physical line of
 * back-to-back consumer records, each `PN ID PT EC PA TL` + `ES02**`, ending with
 * `ES02**TRLR`.
 *
 * Verified byte-for-byte against the production pair:
 *   in : consumer-input-2.xlsx  ("Data Submission Form" sheet, data from row 11)
 *   out: consumer-output-2.txt
 *
 * Each record's 7-byte segment header is `[tag(2)][version(2)][subtype+recType(3)]`
 * then `[fieldTag(2)][len(2)][value]` TLV fields (absent/blank fields omitted).
 * Decoded record 0:
 *   PN03N01 01·PATEL 02·SAGAR 07·14091989 08·2
 *   ID03I01 01·01 02·BGIPP2916D
 *   PT03T01 01·9428997590 03·01
 *   EC03C01 (no fields)
 *   PA03A01 01·"34 RAMVIHAR SOCIETY" 02·" NARAYAN…GUJA" 03·"RAT" 06·24 07·380007 08·01
 *   TL04T00 10·0024FP00865 02·CAPTREE 03·1282100014 04·05 05·1 08·29112024 11·31052026
 *           12·1400000 13·1396932 21·00 26·01 38·15 39·36
 */

// coded-field field: `code` is the 2-digit field tag.
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
    c('01', 'name1', 'Consumer Name 1'),
    c('02', 'name2', 'Consumer Name 2'),
    c('03', 'name3', 'Consumer Name 3'),
    c('07', 'dateOfBirth', 'Date of Birth', { type: 'date-ddmmyyyy' }),
    c('08', 'gender', 'Gender'),
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
    c('01', 'idType', 'ID Type'),
    c('02', 'idNumber', 'ID Number'),
  ],
};

const PT: SegmentSpec = {
  tag: 'PT',
  version: '03',
  codedHeaderSuffix: 'T01',
  encoding: 'coded-field',
  flag: 3,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'phoneNumber', 'Telephone Number'),
    // key avoids the "phone" substring so the global phone-number format rule
    // (validation/rules.ts) doesn't reject the 2-digit type code.
    c('03', 'ptType', 'Telephone Type'),
  ],
};

// Email Contact segment — always emitted (empty in this sample), no fields.
const EC: SegmentSpec = {
  tag: 'EC',
  version: '03',
  codedHeaderSuffix: 'C01',
  encoding: 'coded-field',
  flag: 4,
  cardinality: 'one-per-borrower',
  fields: [],
};

const PA: SegmentSpec = {
  tag: 'PA',
  version: '03',
  codedHeaderSuffix: 'A01',
  encoding: 'coded-field',
  flag: 5,
  cardinality: 'one-per-borrower',
  fields: [
    c('01', 'addressLine1', 'Address Line 1'),
    c('02', 'addressLine2', 'Address Line 2'),
    c('03', 'addressLine3', 'Address Line 3'),
    c('04', 'addressLine4', 'Address Line 4'),
    c('06', 'stateCode', 'State Code'),
    c('07', 'pinCode', 'PIN Code'),
    c('08', 'addressCategory', 'Address Category'),
  ],
};

const TL: SegmentSpec = {
  tag: 'TL',
  version: '04',
  codedHeaderSuffix: 'T00',
  encoding: 'coded-field',
  flag: 6,
  cardinality: 'one-per-borrower',
  fields: [
    c('10', 'tlMemberCode', 'Member Code'),
    c('02', 'tlShortName', 'Member Short Name'),
    c('03', 'accountNumber', 'Account Number'),
    c('04', 'accountType', 'Account Type'),
    c('05', 'ownershipIndicator', 'Ownership Indicator'),
    c('08', 'dateOpened', 'Date Opened/Disbursed', { type: 'date-ddmmyyyy' }),
    c('11', 'dateReported', 'Date Reported', { type: 'date-ddmmyyyy' }),
    c('12', 'highCredit', 'High Credit/Sanctioned Amt', { type: 'numeric' }),
    c('13', 'currentBalance', 'Current Balance', { type: 'numeric' }),
    c('14', 'amountOverdue', 'Amount Overdue', { type: 'numeric' }),
    c('21', 'suitFiled', 'Suit Filed / Wilful Default'),
    c('26', 'assetClassification', 'Asset Classification'),
    c('38', 'rateOfInterest', 'Rate of Interest'),
    c('39', 'repaymentTenure', 'Repayment Tenure'),
  ],
};

// End-of-Subject marker, emitted as the LAST segment per consumer: `ES02**`.
// The final record's `**` runs into the `TRLR` literal → `...ES02**TRLR`.
const ES: SegmentSpec = {
  tag: 'ES',
  encoding: 'concatenated',
  flag: 7,
  cardinality: 'one-per-borrower',
  fields: [c('', 'esMarker', 'End of Subject', { default: 'ES02**' })],
};

/** 146-char fixed-width TUDF header (identical layout to consumer-ucrf12). */
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
    fw('memberShortName', 'Member Short Name', 16),
    fw('cycleId', 'Cycle Identification', 2),
    { key: 'reportingDate', label: 'Date Reported & Certified', type: 'date-ddmmyyyy', length: 8, pad: 'right', padChar: ' ', mandatory: true },
    fw('password', 'Reporting Password', 30, { default: 'None' }),
    fw('authMethod', 'Authentication Method', 1, { default: 'L' }),
    fw('futureUse', 'Future Use', 5, { default: '00000' }),
    fw('memberData', 'Member Data', 48, { default: 'None' }),
  ],
};

/** Trailer = `TRLR` (the final consumer's `ES02**` supplies the leading `ES02**`). */
const TRLR: SegmentSpec = {
  tag: 'TRLR',
  encoding: 'concatenated',
  cardinality: 'trailer',
  fields: [c('', 'marker', 'Trailer', { default: 'TRLR', mandatory: true })],
};

const str = (v: FieldValue): string => (v == null ? '' : String(v).trim());

/**
 * Data Submission Form account-type code -> CRIF TL/04 code. The form uses its own
 * legend (e.g. 12), which CRIF re-codes (12 -> 05 "Personal Loan"). Verified entries
 * only; an unknown numeric code passes through unchanged (extend as the legend grows).
 */
const ACCOUNT_TYPE_MAP: Record<string, string> = {
  '12': '05',
};
const mapAccountType = (v: FieldValue): string => {
  const s = str(v);
  return ACCOUNT_TYPE_MAP[s] ?? s;
};

/** Split a consumer name into up to 3 whitespace tokens (PN 01/02/03). */
function splitName(name: string): { name1: string; name2: string; name3: string } {
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    name1: parts[0] ?? '',
    name2: parts[1] ?? '',
    name3: parts.slice(2).join(' '),
  };
}

/**
 * Split an address into PA tags 01/02/03. Each tag holds up to 40 chars; if a
 * comma falls within the first 40, break right after the LAST such comma (and drop
 * that one comma); otherwise take a full 40. All other characters (incl. other
 * commas) are preserved. Verified byte-for-byte against the production output:
 *   "34 RAMVIHAR SOCIETY, NARAYAN…"      -> "34 RAMVIHAR SOCIETY" | " NARAYAN…GUJA" | "RAT"
 *   "29/30, V T NAGAR ROAD , KESHAV …"   -> "29/30, V T NAGAR ROAD , KESHAV NAGAR " | " MAHUVA…"
 */
const MAX_ADDR_TAGS = 4;
function splitAddress(addr: string): {
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  addressLine4: string;
} {
  const lines: string[] = [];
  let s = addr;
  for (let tag = 0; tag < MAX_ADDR_TAGS && s.length > 0; tag++) {
    const last = tag === MAX_ADDR_TAGS - 1; // last tag takes the remainder, no wrapping
    if (s.length <= 40) {
      lines.push(s);
      s = '';
      break;
    }
    const window = s.slice(0, 40);
    const comma = window.lastIndexOf(',');
    if (!last && comma >= 0) {
      lines.push(s.slice(0, comma)); // up to (not incl.) the comma
      s = s.slice(comma + 1); // drop that comma
    } else {
      lines.push(s.slice(0, 40));
      s = s.slice(40);
    }
  }
  return {
    addressLine1: lines[0] ?? '',
    addressLine2: lines[1] ?? '',
    addressLine3: lines[2] ?? '',
    addressLine4: lines[3] ?? '',
  };
}

/** Source column-letter -> stable key for the Data Submission Form. */
const COLUMNS: Record<string, string> = {
  A: 'consumerName',
  B: 'dateOfBirth',
  C: 'gender',
  D: 'pan',
  P: 'mobile',
  X: 'addressLine1',
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
  AP: 'dateReported',
  AQ: 'highCredit',
  AR: 'currentBalance',
  AS: 'amountOverdue',
  AZ: 'suitFiled',
  BB: 'assetClassification',
  BG: 'rateOfInterest',
  BH: 'repaymentTenure',
};

/** ddmmyyyy passthrough: the form already stores 8-digit DDMMYYYY strings. */
const date = (v: FieldValue): string => {
  const s = str(v);
  return /^\d{8}$/.test(s) ? s : s;
};

function explode(input: Record<string, FieldValue>, ctx: FlatExplodeContext): SegmentSeed[] {
  const memberId = (ctx.meta?.memberId as string) ?? '';
  const nm = splitName(str(input.consumerName));
  const addr = splitAddress(str(input.addressLine1));

  const seeds: SegmentSeed[] = [];

  seeds.push({
    tag: 'PN',
    flag: 1,
    values: {
      name1: nm.name1,
      name2: nm.name2,
      name3: nm.name3,
      dateOfBirth: date(input.dateOfBirth),
      gender: str(input.gender),
    } as TypedRow,
  });

  // ID: type 01 (Income Tax ID / PAN) when a PAN is present.
  const pan = str(input.pan);
  seeds.push({
    tag: 'ID',
    flag: 2,
    values: { idType: pan ? '01' : '', idNumber: pan } as TypedRow,
  });

  // PT: mobile + type 01 (mobile).
  const mobile = str(input.mobile);
  seeds.push({
    tag: 'PT',
    flag: 3,
    values: { phoneNumber: mobile, ptType: mobile ? '01' : '' } as TypedRow,
  });

  // EC: always emitted, empty.
  seeds.push({ tag: 'EC', flag: 4, values: {} as TypedRow });

  seeds.push({
    tag: 'PA',
    flag: 5,
    values: {
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2,
      addressLine3: addr.addressLine3,
      addressLine4: addr.addressLine4,
      stateCode: str(input.stateCode),
      pinCode: str(input.pinCode),
      addressCategory: str(input.addressCategory),
    } as TypedRow,
  });

  seeds.push({
    tag: 'TL',
    flag: 6,
    values: {
      tlMemberCode: '0' + memberId, // CRIF-assigned id, zero-prefixed (11 chars)
      tlShortName: str(input.memberShortName),
      accountNumber: str(input.accountNumber),
      accountType: mapAccountType(input.accountType),
      ownershipIndicator: str(input.ownershipIndicator),
      dateOpened: date(input.dateOpened),
      dateReported: date(input.dateReported),
      highCredit: str(input.highCredit),
      currentBalance: str(input.currentBalance),
      amountOverdue: str(input.amountOverdue),
      suitFiled: str(input.suitFiled),
      assetClassification: str(input.assetClassification),
      rateOfInterest: str(input.rateOfInterest),
      repaymentTenure: str(input.repaymentTenure),
    } as TypedRow,
  });

  seeds.push({ tag: 'ES', flag: 7, values: { esMarker: 'ES02**' } as TypedRow });

  return seeds;
}

export const consumerUcrf12FlatTlv: FormatSpec = {
  id: 'consumer-ucrf12-flat-tlv',
  label: 'Consumer UCRF-12 (TLV)',
  version: '3.73',
  outputExtension: '.txt',
  physicalLayout: 'single-physical-line',
  lineEnding: '',
  fileEncoding: 'latin1',
  glueHeaderToFirstRecord: true,
  header: TUDF,
  body: [PN, ID, PT, EC, PA, TL, ES],
  trailer: TRLR,
  flatExplode: {
    sheet: 'Data Submission Form',
    firstDataRow: 11,
    headerRow: 10,
    columns: COLUMNS,
    explode,
    // File-level header values the accountant fills in the form's top rows.
    // memberId is deliberately NOT read from the sheet: the sheet holds the raw
    // member id (NB…) while the output needs the CRIF-assigned id from the flag.
    headerCells: {
      B6: 'memberShortName',
      C6: 'cycleId',
      D6: 'reportingDate',
    },
  },
  buildHeaderRow: (meta): TypedRow => ({
    _recordType: 'TUDF',
    version: '12',
    memberId: meta.memberId,
    memberShortName: (meta.memberShortName as string) ?? '',
    cycleId: (meta.cycleId as string) ?? 'NB',
    reportingDate: formatDdmmyyyy(meta.reportingDate),
    password: 'None',
    authMethod: 'L',
    futureUse: '00000',
    memberData: 'None',
  }),
  buildTrailerRow: (): TypedRow => ({ marker: 'TRLR' }),
};

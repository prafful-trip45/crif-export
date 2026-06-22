import type {
  FieldValue,
  FlatExplodeContext,
  FormatSpec,
  SegmentSpec,
  SegmentSeed,
  TypedRow,
} from '../core/types.js';
import { formatDdmmyyyy } from '../encoding/formatters/date.js';
import { coerceCell } from '../input/coerce.js';
import { commercialUcrf } from './commercial-ucrf.js';

/**
 * Commercial UCRF V3.9 — REAL-WORLD "Master Sheet" input profile.
 *
 * Accountants maintain ONE flat row per borrower (borrower + related-person +
 * guarantor + security + cheque-dishonour columns side by side) plus a
 * "Credit Type Code" lookup sheet. This profile reads that row and explodes it
 * into the canonical Commercial segments (BS/AS/RS/CR/GS/SS/CD), reusing the
 * existing `commercial-ucrf` pipe-delimited segment specs for encoding — only the
 * INPUT shape differs.
 *
 * Verified against the production pair in training-references/crif-reporting-io:
 *   in : client-commercial-data-input-1.xlsx  ("Master Sheet")
 *   out: client-commercial-data-input-1-output-file.txt
 *
 * Header member-id / dates / branch / DUNS / currency etc. are NOT in the flat
 * sheet; they come from CLI flags + the defaults below (see DEFAULTS).
 */

/** Accountant-supplied constants that are not present in the flat Master Sheet. */
const DEFAULTS = {
  memberBranchCode: 'HO', // BS
  officeLocationType: '01', // AS
  countryCode: '079', // AS / RS phone area / country
  relationshipDuns: '999999999', // RS
  currencyCode: 'INR', // CR
} as const;

/* ---------- input-legend -> CRIF code maps (anchored to the golden sample) ----------
 *
 * The Master Sheet may carry EITHER the legend number ("2") OR the legend label
 * ("Public Limited") — accountants use both. Each table is therefore defined as
 * `code -> [number, ...labels]`, and `buildLegend` inverts it into a lookup that
 * accepts the number or any label (normalized) and yields the CRIF code.
 */

interface LegendEntry {
  code: string;
  num: string;
  labels: string[];
}

function buildLegend(entries: LegendEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) {
    m.set(e.num, e.code);
    m.set(e.code, e.code); // already-CRIF-coded value passes through
    for (const l of e.labels) m.set(normalize(l), e.code);
  }
  return m;
}

/** Input "Borrowers Legal Constitution" -> CRIF code (golden 2/Public Limited -> 12). */
const LEGAL_CONSTITUTION = buildLegend([
  { code: '11', num: '1', labels: ['Private Limited'] },
  { code: '12', num: '2', labels: ['Public Limited'] },
  { code: '13', num: '3', labels: ['Business Entities Created by Statute'] },
  { code: '14', num: '4', labels: ['Proprietorship'] },
  { code: '15', num: '5', labels: ['Partnership'] },
  { code: '16', num: '6', labels: ['Trust'] },
  { code: '17', num: '7', labels: ['HUF'] },
  { code: '18', num: '8', labels: ['Co-operative Society'] },
  { code: '19', num: '9', labels: ['Association of Persons'] },
  { code: '20', num: '10', labels: ['Government'] },
  { code: '21', num: '11', labels: ['Self Help Group'] },
]);

/** Input "Relationship Type" -> CRIF RS code (golden 7/Promoter Director -> 51). */
const RELATIONSHIP_TYPE = buildLegend([
  { code: '45', num: '1', labels: ['Shareholder'] },
  { code: '46', num: '2', labels: ['Holding Company'] },
  { code: '47', num: '3', labels: ['Subsidiary Company'] },
  { code: '48', num: '4', labels: ['Proprietor'] },
  { code: '49', num: '5', labels: ['Partner'] },
  { code: '50', num: '6', labels: ['Trustee'] },
  { code: '51', num: '7', labels: ['Promoter Director'] },
  { code: '52', num: '8', labels: ['Nominee Director'] },
  { code: '53', num: '9', labels: ['Independent Director'] },
  { code: '54', num: '10', labels: ['Individual Member of SHG'] },
  { code: '55', num: '11', labels: ['Other Director'] },
  { code: '56', num: '12', labels: ['Others'] },
  { code: '57', num: '13', labels: ['Karta (HUF)', 'Karta'] },
]);

/** Input "Asset Classification" -> CRIF CR code (golden Standard -> 0001). */
const ASSET_CLASSIFICATION = buildLegend([
  { code: '0001', num: '1', labels: ['Standard'] },
  { code: '0002', num: '2', labels: ['Sub-standard', 'Substandard'] },
  { code: '0003', num: '3', labels: ['Loss'] },
  { code: '0004', num: '4', labels: ['SMA 0', 'SMA0', 'SMA 0 - Principal or interest payment not overdue for more than 30 days but account showing signs of incipient stress.'] },
  { code: '0005', num: '5', labels: ['SMA 1', 'SMA1', 'SMA 1 - Principal or interest payment overdue between 31-60 days'] },
  { code: '0006', num: '6', labels: ['SMA 2', 'SMA2', 'NA', 'Not applicable'] },
  { code: '0007', num: '7', labels: ['Doubtful -1', 'Doubtful-1'] },
  { code: '0008', num: '8', labels: ['Doubtful -2', 'Doubtful-2'] },
  { code: '0009', num: '9', labels: ['Doubtful -3', 'Doubtful-3'] },
  { code: '0010', num: '10', labels: ['Non-Performing Assets (NPA)', 'NPA'] },
  { code: '0011', num: '11', labels: ['ARC Loan'] },
  { code: '0012', num: '12', labels: ['1 Day Past Due'] },
  { code: '0013', num: '13', labels: ['2 Days Past Due'] },
  { code: '0000', num: '14', labels: ['0 Day Past Due'] },
]);

/** Input "Account Status" -> CRIF CR code (golden Open -> 01). */
const ACCOUNT_STATUS = buildLegend([
  { code: '01', num: '1', labels: ['Open'] },
  { code: '02', num: '2', labels: ['Closed By Paym', 'Closed By Payment', 'Closed'] },
  { code: '03', num: '3', labels: ['Settled & Closed'] },
  { code: '04', num: '4', labels: ['Restructured'] },
  { code: '05', num: '5', labels: ['Written Off', 'Written-Off'] },
  { code: '06', num: '6', labels: ['Settled Post Write Off'] },
  { code: '07', num: '7', labels: ['Invoked'] },
  { code: '08', num: '8', labels: ['Devolved'] },
  { code: '09', num: '9', labels: ['Restructured Due to Natural Calamity'] },
  { code: '10', num: '10', labels: ['Sold to ARC'] },
  { code: '11', num: '11', labels: ['Purchase from Bank'] },
  { code: '12', num: '12', labels: ['Restructured & Closed'] },
]);

/** Input "Repayment Frequency" -> CRIF code (golden On Demand -> 05). */
const REPAYMENT_FREQUENCY = buildLegend([
  { code: '01', num: '1', labels: ['Monthly'] },
  { code: '02', num: '2', labels: ['Quarterly'] },
  { code: '03', num: '3', labels: ['Half yearly', 'Half-yearly'] },
  { code: '04', num: '4', labels: ['Annual'] },
  { code: '05', num: '5', labels: ['On Demand'] },
  { code: '06', num: '6', labels: ['Bullet'] },
  { code: '07', num: '7', labels: ['Rolling'] },
  { code: '08', num: '8', labels: ['Others'] },
]);

/** Gender text -> CRIF code + courtesy prefix (RS / GS individuals). */
const GENDER_CODE: Record<string, string> = { male: '01', female: '02', transgender: '03' };
const GENDER_PREFIX: Record<string, string> = { male: 'Mr', female: 'Ms', transgender: '' };

/* ---------- small value helpers ---------- */

const str = (v: FieldValue): string => (v === undefined || v === null ? '' : String(v).trim());

/** Some inputs come in either as a number ("1") or text label; key by leading number. */
const codeKey = (v: FieldValue): string => {
  const s = str(v);
  const m = /^\s*(\d+)/.exec(s);
  return m ? m[1]! : s;
};

/** Map a legend value (number OR label) via a table; undefined if unrecognized. */
function mapLegend(table: Map<string, string>, v: FieldValue): string | undefined {
  const s = str(v);
  if (s === '') return undefined;
  return table.get(codeKey(v)) ?? table.get(normalize(s)) ?? undefined;
}

/** Normalize a label for tolerant matching (lowercase, collapse spaces, drop quotes). */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[“”„‘’]/g, '');
}

/** Zero-pad a small numeric legend to 2 digits (Business Category / Industry). */
function pad2Legend(v: FieldValue): string {
  const s = codeKey(v);
  return s === '' ? '' : s.padStart(2, '0');
}

/** Parse a date-ish input cell to DDMMYYYY (Date, Excel serial, or string). */
function ddmmyyyy(v: FieldValue): string {
  if (v === undefined || v === '') return '';
  const coerced = coerceCell({ key: 'd', type: 'date-ddmmyyyy', mandatory: false }, v as never);
  return coerced instanceof Date ? formatDdmmyyyy(coerced) : str(v);
}

/** Whole-rupee string (drop any decimals / scientific noise). */
function rupees(v: FieldValue): string {
  const s = str(v);
  if (s === '') return '';
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Math.round(n)) : s;
}

/**
 * Split a free-text "<street…>, <City> - <PIN>. <COUNTRY>" string into the AS/RS
 * sub-fields CRIF expects. Tuned to the accountant convention in the sample:
 *   "D' Building, … Besant Road,Worli, Mumbai - 400018. INDIA"
 *      -> line1="D' Building, … Besant Road,Worli", city="Mumbai", pin="400018"
 *   "Mimraj Building, 405, Kalbadevi Road, Mumbai 400002"
 *      -> line1="Mimraj Building, 405, Kalbadevi Road", city="Mumbai", pin="400002"
 * `line1` is kept VERBATIM (commas/spacing preserved) up to the comma before the
 * city; the trailing "<City> - <PIN>. COUNTRY" tail is removed. District/state are
 * derived from the city (the flat sheet carries no separate state column).
 */
function splitAddress(raw: FieldValue): {
  line1: string;
  city: string;
  stateName: string;
  stateCode: string;
  pinCode: string;
} {
  let s = str(raw);
  let pinCode = '';
  let city = '';

  // Drop a trailing country word (INDIA / India.) and stray punctuation.
  s = s.replace(/[.,\s]*india\.?\s*$/i, '').trim();

  const pinMatch = /(\d{6})\b/.exec(s);
  if (pinMatch) {
    pinCode = pinMatch[1]!;
    // Tail from the last comma before the PIN is "<City> - <PIN>"; line1 precedes it.
    const beforePin = s.slice(0, pinMatch.index);
    const lastComma = beforePin.lastIndexOf(',');
    if (lastComma >= 0) {
      city = stripCityPin(beforePin.slice(lastComma + 1));
      s = beforePin.slice(0, lastComma).replace(/[\s,]+$/, '');
    } else {
      city = stripCityPin(beforePin);
      s = '';
    }
  }

  const st = cityToState(city);
  return { line1: s.trim(), city, stateName: st.name, stateCode: st.code, pinCode };
}

/** Remove a trailing " - 400018" / " 400018" PIN tail and dashes from a city token. */
function stripCityPin(token: string): string {
  return token.replace(/[\s\-]*\d{6}\s*$/, '').replace(/[\s\-]+$/, '').trim();
}

/* ---------- the flat-row -> segments mapping ---------- */

/** Stable keys for the columns we read from the Master Sheet. */
const COLUMNS: Record<string, string> = {
  // Borrower
  A: 'borrowerName',
  B: 'pan',
  C: 'legalConstitution',
  D: 'businessCategory',
  E: 'businessIndustryType',
  F: 'address',
  G: 'contactNo',
  H: 'accountNumber',
  I: 'sanctionDate',
  J: 'sanctionedAmount',
  K: 'creditType',
  L: 'repaymentFrequency',
  M: 'drawingPower',
  N: 'currentBalance',
  P: 'assetClassification',
  Q: 'amountOverdue',
  R: 'accountStatus',
  S: 'wilfulDefault',
  T: 'suitFiledStatus',
  U: 'suitReferenceNumber',
  V: 'suitAmount',
  W: 'dateOfSuit',
  // Related person
  X: 'relationshipType',
  Y: 'relatedName',
  Z: 'relatedGender',
  AA: 'relatedDob',
  AB: 'relatedPan',
  AC: 'relatedAddress',
  AD: 'relatedContact',
};

function explode(input: Record<string, FieldValue>, ctx: FlatExplodeContext): SegmentSeed[] {
  const seeds: SegmentSeed[] = [];
  const issues: SegmentSeed['issues'] = [];

  // ---- BS (borrower) ----
  seeds.push({
    tag: 'BS',
    flag: 1,
    values: row({
      _tag: 'BS',
      memberBranchCode: DEFAULTS.memberBranchCode,
      borrowerName: str(input.borrowerName),
      pan: str(input.pan),
      legalConstitution: mapLegend(LEGAL_CONSTITUTION, input.legalConstitution) ?? '',
      businessCategory: pad2Legend(input.businessCategory),
      businessIndustryType: pad2Legend(input.businessIndustryType),
    }),
  });

  // ---- AS (borrower address) ----
  // The Master-Sheet address embeds the city but not the state; CRIF wants the
  // state name in the District field and the 2-digit code in State (derived from
  // the city). Country here carries the telephone area code per the sample.
  const ba = splitAddress(input.address);
  seeds.push({
    tag: 'AS',
    flag: 2,
    values: row({
      _tag: 'AS',
      officeLocationType: DEFAULTS.officeLocationType,
      addressLine1: ba.line1,
      cityTown: ba.city,
      district: ba.stateName,
      stateCode: ba.stateCode,
      pinCode: ba.pinCode,
      country: DEFAULTS.countryCode,
    }),
  });

  // ---- RS (related person) — only when a related person is present ----
  if (str(input.relatedName) !== '') {
    const g = str(input.relatedGender).toLowerCase();
    const ra = splitAddress(input.relatedAddress);
    seeds.push({
      tag: 'RS',
      flag: 3,
      values: row({
        _tag: 'RS',
        relationshipDuns: DEFAULTS.relationshipDuns,
        relatedType: '2', // Resident Indian Individual (individual related person)
        relationship: mapLegend(RELATIONSHIP_TYPE, input.relationshipType) ?? '',
        namePrefix: GENDER_PREFIX[g] ?? '',
        fullName: str(input.relatedName),
        gender: GENDER_CODE[g] ?? '',
        dateOfBirth: ddmmyyyy(input.relatedDob),
        rsPan: str(input.relatedPan),
        rsAddressLine1: ra.line1,
        rsCity: ra.city,
        rsDistrict: ra.stateName,
        rsStateCode: ra.stateCode,
        rsPinCode: ra.pinCode,
        rsCountry: DEFAULTS.countryCode,
        rsMobile: str(input.relatedContact),
      }),
    });
  }

  // ---- CR (credit facility) ----
  const creditType = resolveCreditType(input.creditType, ctx, issues);
  seeds.push({
    tag: 'CR',
    flag: 4,
    values: row({
      _tag: 'CR',
      accountNumber: str(input.accountNumber),
      sanctionDate: ddmmyyyy(input.sanctionDate),
      sanctionedAmount: rupees(input.sanctionedAmount),
      currencyCode: DEFAULTS.currencyCode,
      creditType,
      repaymentFrequency: mapLegend(REPAYMENT_FREQUENCY, input.repaymentFrequency) ?? '',
      // Drawing Power: use the input value, else fall back to the sanctioned amount
      // (the accountant convention seen in the sample).
      drawingPower: rupees(input.drawingPower) || rupees(input.sanctionedAmount),
      currentBalance: rupees(input.currentBalance),
      assetClassification: mapLegend(ASSET_CLASSIFICATION, input.assetClassification) ?? '',
      amountOverdue: rupees(input.amountOverdue) || '0',
      accountStatus: mapLegend(ACCOUNT_STATUS, input.accountStatus) ?? '',
      // Wilful-default status 0 = No; suit-filed status 00 = none. (The hand-made
      // golden also stamps "0" in the wilful-default DATE slot; we leave it blank
      // as that field is a real date — the only intentional 1-token divergence.)
      wilfulDefaultStatus: wilfulCode(input.wilfulDefault) || '0',
      suitFiledStatus: '00',
    }),
  });

  // GS (guarantor), SS (security), CD (cheque-dishonour) are ALWAYS emitted as
  // empty filler records per borrower, mirroring the accountant working file's
  // segment sheets (HD/BS/AS/RS/CR/GS/SS/CD/TS). Guarantor/security/cheque columns
  // exist in the Master Sheet but are blank for this borrower; wire them when populated.
  seeds.push({ tag: 'GS', flag: 5, values: row({ _tag: 'GS' }) });
  seeds.push({ tag: 'SS', flag: 6, values: row({ _tag: 'SS' }) });
  seeds.push({ tag: 'CD', flag: 7, values: row({ _tag: 'CD' }) });

  // Attach mapping issues to the CR seed (where they originate).
  if (issues.length) {
    const cr = seeds.find((s) => s.tag === 'CR');
    if (cr) cr.issues = issues;
  }
  return seeds;
}

/** Resolve Credit Type text via the workbook's "Credit Type Code" lookup. */
function resolveCreditType(
  v: FieldValue,
  ctx: FlatExplodeContext,
  issues: NonNullable<SegmentSeed['issues']>,
): string {
  const s = str(v);
  if (s === '') return '';
  if (/^\d+$/.test(s)) return s; // already a code
  const key = s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[“”„‘’]/g, '');
  const code = ctx.lookups.creditType?.get(key);
  if (code) return code;
  issues.push({
    fieldKey: 'creditType',
    message: `Credit Type "${s}" not found in the "Credit Type Code" lookup sheet — add it or correct the source value`,
  });
  return '';
}

/** Wilful Default Yes/No -> CRIF code (0 = No, 1 = Yes). */
function wilfulCode(v: FieldValue): string {
  const s = str(v).toLowerCase();
  if (s === '' ) return '';
  if (s === 'no' || s === 'n' || s === '0') return '0';
  if (s === 'yes' || s === 'y' || s === '1') return '1';
  return s;
}

/**
 * City -> { state code, state name } for the metros the Master Sheet uses (the
 * flat sheet has no separate state column). The codes follow the CLIENT's CIBIL
 * commercial state table (e.g. Maharashtra = 20, per the golden sample), which is
 * NOT the same numbering as `STATE_CODE` in commercial-enums. Extend as needed.
 */
const CITY_STATE: Record<string, { code: string; name: string }> = {
  mumbai: { code: '20', name: 'Maharashtra' },
  pune: { code: '20', name: 'Maharashtra' },
  nagpur: { code: '20', name: 'Maharashtra' },
  ahmedabad: { code: '11', name: 'Gujarat' },
  surat: { code: '11', name: 'Gujarat' },
  delhi: { code: '07', name: 'Delhi' },
  'new delhi': { code: '07', name: 'Delhi' },
  bengaluru: { code: '10', name: 'Karnataka' },
  bangalore: { code: '10', name: 'Karnataka' },
  chennai: { code: '23', name: 'Tamil Nadu' },
  kolkata: { code: '33', name: 'West Bengal' },
  hyderabad: { code: '36', name: 'Telangana' },
};
function cityToState(city: string): { code: string; name: string } {
  return CITY_STATE[city.toLowerCase()] ?? { code: '', name: '' };
}

/** Build a TypedRow from a sparse object (undefined keys stay blank). */
function row(values: Record<string, FieldValue>): TypedRow {
  return values as TypedRow;
}

/**
 * Body segments reuse the canonical commercial specs, EXCEPT SS: the flat profile
 * emits an empty `SS|||||||` filler (the accountant working file does not stamp the
 * INR currency default on an empty security segment), so drop SS's currency default.
 */
const FLAT_BODY: SegmentSpec[] = commercialUcrf.body.map((seg) =>
  seg.tag !== 'SS'
    ? seg
    : {
        ...seg,
        fields: seg.fields.map((f) =>
          f.key === 'ssCurrency' ? { ...f, default: undefined } : f,
        ),
      },
);

export const commercialUcrfFlat: FormatSpec = {
  ...commercialUcrf,
  id: 'commercial-ucrf-flat',
  label: 'Commercial UCRF',
  body: FLAT_BODY,
  // Real CRIF Commercial files end the final TS line with a trailing CRLF.
  trailingLineEnding: true,
  flatExplode: {
    sheet: 'Master Sheet',
    firstDataRow: 11,
    columns: COLUMNS,
    explode,
    // Accountant fills these top-of-sheet cells; a non-blank value overrides the
    // matching CLI flag. A5/A6/A7 hold the labels; B5/B6/B7 the values.
    headerCells: { B5: 'memberId', B6: 'reportingDate', B7: 'creationDate' },
  },
};

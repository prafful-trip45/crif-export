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
import { STATE_CODE } from './enums/commercial-enums.js';

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
  officeDuns: '999999999', // AS — Borrower Office DUNS is always 999999999
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

/**
 * CRIF Commercial UCRF V3.9 catalogue 8.2 (authoritative — NOT the dropdown position).
 * `num` = the Master-Sheet dropdown number; `code` = the CRIF wire code.
 * See the `crif-commercial-format` skill.
 */
const LEGAL_CONSTITUTION = buildLegend([
  { code: '11', num: '1', labels: ['Private Limited', 'Pvt Ltd', 'Pvt. Ltd.', 'Private Ltd', 'Pvt Limited'] },
  { code: '12', num: '2', labels: ['Public Limited', 'Public Ltd', 'Pub Ltd'] },
  { code: '20', num: '3', labels: ['Business Entities Created by Statute'] },
  { code: '30', num: '4', labels: ['Proprietorship', 'Proprietor', 'Sole Proprietorship'] },
  { code: '40', num: '5', labels: ['Partnership', 'Partnership Firm', 'Partner', 'LLP'] },
  { code: '50', num: '6', labels: ['Trust'] },
  { code: '55', num: '7', labels: ['HUF', 'Hindu Undivided Family'] },
  { code: '60', num: '8', labels: ['Co-operative Society', 'Cooperative Society'] },
  { code: '70', num: '9', labels: ['Association of Persons'] },
  { code: '80', num: '10', labels: ['Government'] },
  { code: '85', num: '11', labels: ['Self Help Group', 'SHG'] },
  { code: '90', num: '12', labels: ['Individual'] }, // V3.10 addition
]);

/**
 * CRIF Commercial UCRF V3.9 catalogue 8.7 (authoritative). The Master-Sheet dropdown
 * number differs from the wire code (e.g. dropdown "7. Promoter Director" -> 51).
 */
const RELATIONSHIP_TYPE = buildLegend([
  { code: '10', num: '1', labels: ['Shareholder'] },
  { code: '11', num: '2', labels: ['Holding Company'] },
  { code: '12', num: '3', labels: ['Subsidiary Company'] },
  { code: '20', num: '4', labels: ['Proprietor'] },
  { code: '30', num: '5', labels: ['Partner'] },
  { code: '40', num: '6', labels: ['Trustee'] },
  { code: '51', num: '7', labels: ['Promoter Director'] },
  { code: '52', num: '8', labels: ['Nominee Director', 'Nominee'] },
  { code: '53', num: '9', labels: ['Independent Director'] },
  { code: '54', num: '10', labels: ['Director - Since Resigned', 'Director Since Resigned'] },
  { code: '55', num: '11', labels: ['Individual Member of SHG'] },
  { code: '56', num: '12', labels: ['Other Director'] },
  { code: '60', num: '13', labels: ['Others'] },
  { code: '70', num: '14', labels: ['Karta (HUF)', 'Karta'] },
]);

/**
 * CRIF Commercial UCRF V3.9 catalogue 8.10 (authoritative, non-sequential). `num` is
 * the Master-Sheet dropdown number; `code` is the CRIF code (e.g. "6. SMA 2" -> 0008).
 */
const ASSET_CLASSIFICATION = buildLegend([
  { code: '0001', num: '1', labels: ['Standard'] },
  { code: '0002', num: '2', labels: ['Sub-standard', 'Substandard'] },
  { code: '0004', num: '3', labels: ['Loss'] },
  { code: '0006', num: '4', labels: ['SMA 0', 'SMA0'] },
  { code: '0007', num: '5', labels: ['SMA 1', 'SMA1'] },
  { code: '0008', num: '6', labels: ['SMA 2', 'SMA2', 'NA', 'Not applicable'] },
  { code: '0009', num: '7', labels: ['Doubtful -1', 'Doubtful-1'] },
  { code: '0010', num: '8', labels: ['Doubtful -2', 'Doubtful-2'] },
  { code: '0011', num: '9', labels: ['Doubtful -3', 'Doubtful-3'] },
  { code: '0012', num: '10', labels: ['Non-Performing Assets (NPA)', 'NPA'] },
  { code: '0013', num: '11', labels: ['ARC Loan'] },
  { code: '1001', num: '12', labels: ['1 Day Past Due'] },
  { code: '1002', num: '13', labels: ['2 Days Past Due'] },
  { code: '1000', num: '14', labels: ['0 Day Past Due'] },
]);

/** Business Category (8.3) & Business/Industry Type (8.4): code = dropdown position. */
const BUSINESS_CATEGORY = buildLegend([
  // V3.10 (8.2) dropped the old 01 MSME / 02 SME codes and added 08 Retail / 09 Agri.
  // Legacy sheets still type "MSME"/"SME": per the client, MSME now maps to Micro (03);
  // SME is treated as Small (04) — confirm if that differs.
  { code: '03', num: '3', labels: ['Micro', 'MSME'] },
  { code: '04', num: '4', labels: ['Small', 'SME'] },
  { code: '05', num: '5', labels: ['Medium'] },
  { code: '06', num: '6', labels: ['Large'] },
  { code: '07', num: '7', labels: ['Others'] },
  { code: '08', num: '8', labels: ['Retail'] },
  { code: '09', num: '9', labels: ['Agri', 'Agriculture'] },
]);
const BUSINESS_INDUSTRY = buildLegend([
  { code: '01', num: '1', labels: ['Manufacturing', 'Manfuacture', 'Manufacture'] },
  { code: '02', num: '2', labels: ['Distribution'] },
  { code: '03', num: '3', labels: ['Wholesale'] },
  { code: '04', num: '4', labels: ['Trading'] },
  { code: '05', num: '5', labels: ['Broking'] },
  { code: '06', num: '6', labels: ['Service Provider'] },
  { code: '07', num: '7', labels: ['Importing'] },
  { code: '08', num: '8', labels: ['Exporting'] },
  { code: '09', num: '9', labels: ['Agriculture'] },
  { code: '10', num: '10', labels: ['Dealers'] },
  { code: '11', num: '11', labels: ['Others'] },
]);

/** Guarantor Type / Related Type dropdown -> code (1-4, from the sheet legend). */
const RELATED_TYPE = buildLegend([
  { code: '01', num: '1', labels: ['Business Entity Registered in India', 'Business registred in india', 'Business Entity Registered India'] },
  { code: '02', num: '2', labels: ['Resident Indian Individual', 'Resident India Individual', 'Individual', 'Business Entity/ Indian Individual', 'Business Entity / Indian Individual'] },
  { code: '03', num: '3', labels: ['Business Entity Registered Outside India'] },
  { code: '04', num: '4', labels: ['Foreign/ Non-Resident Indian Individual', 'Foreign Non-Resident Indian Individual'] },
]);

/** Location Type (8.5) — Borrower Office Location Type. */
const LOCATION_TYPE = buildLegend([
  { code: '01', num: '1', labels: ['Registered office address', 'Registered office', 'Registered Office'] },
  { code: '02', num: '2', labels: ['Branch / Regional Office', 'Branch', 'Regional Office'] },
  { code: '03', num: '3', labels: ['Warehouse'] },
  { code: '04', num: '4', labels: ['Plant / Factory Address', 'Plant', 'Factory'] },
  { code: '05', num: '5', labels: ['Others', 'Other'] },
  { code: '06', num: '6', labels: ['Mortgage Property address', 'Mortgage Property'] },
]);

/** Security Type (8.14): accepts the dropdown number or a label -> 3-digit code. */
const SECURITY_TYPE = buildLegend([
  { code: '001', num: '1', labels: ['Cash/ Bullion/ Bank Deposits', 'Cash', 'Bullion', 'Bank Deposits'] },
  { code: '002', num: '2', labels: ['Shares/ Bonds/ Securities', 'Shares', 'Share', 'Bonds', 'Securities'] },
  { code: '003', num: '3', labels: ['Inventory (Raw Material, WIP and Finished Goods)', 'Inventory'] },
  { code: '004', num: '4', labels: ['Accounts Receivable'] },
  { code: '005', num: '5', labels: ['Other Current Assets'] },
  { code: '006', num: '6', labels: ['Plant & Machinery and Equipment', 'Plant & Machinery', 'Machinery'] },
  { code: '007', num: '7', labels: ['Land & Buildings', 'Land', 'Building', 'Buildings'] },
  { code: '008', num: '8', labels: ['Other Fixed Assets'] },
  { code: '009', num: '9', labels: ['Other Assets'] },
  { code: '010', num: '10', labels: ['Aggregate of all Current Assets'] },
  { code: '011', num: '11', labels: ['Aggregate of all Fixed Assets'] },
]);

/** Security Classification (8.15): dropdown 1-8 -> CRIF code (collateral is 21-24). */
const SECURITY_CLASS = buildLegend([
  { code: '01', num: '1', labels: ['Primary - First Charge', 'Primary – First Charge'] },
  { code: '02', num: '2', labels: ['Primary - Second Charge', 'Primary – Second Charge'] },
  { code: '03', num: '3', labels: ['Primary - Third Charge', 'Primary – Third Charge'] },
  { code: '04', num: '4', labels: ['Primary - Parri Passu', 'Primary – Parri Passu'] },
  { code: '21', num: '5', labels: ['Collateral - First Charge', 'Collateral – First Charge'] },
  { code: '22', num: '6', labels: ['Collateral - Second Charge', 'Collateral – Second Charge'] },
  { code: '23', num: '7', labels: ['Collateral - Third Charge', 'Collateral – Third Charge'] },
  { code: '24', num: '8', labels: ['Collateral - Parri Passu', 'Collateral – Parri Passu'] },
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

/** Gender text -> CRIF code + courtesy prefix (RS / GS individuals). V3.9 uses title-case
 * (`Mr`/`Ms`); V3.10 upper-cases it (`MR`/`MS`) — selected via FlatOpts.prefixUpper. */
const GENDER_CODE: Record<string, string> = { male: '01', female: '02', transgender: '03' };
const GENDER_PREFIX: Record<string, string> = { male: 'Mr', female: 'Ms', transgender: '' };
const GENDER_PREFIX_UPPER: Record<string, string> = { male: 'MR', female: 'MS', transgender: '' };

/**
 * Per-version behaviour toggles. V3.9 (the legacy accountant convention) vs V3.10 (the
 * current bureau convention seen in the POC-verified 9-July file).
 */
interface FlatOpts {
  /** RS/GS courtesy prefix: upper-case (MR/MS) in V3.10, title-case (Mr/Ms) in V3.9. */
  prefixUpper: boolean;
  /** GS Related-Type: zero-padded ("02") in V3.9, bare ("2") in V3.10. */
  gsRelTypePadded: boolean;
  /** Drawing Power falls back to the Sanctioned Amount when blank (V3.9) or stays 0 (V3.10). */
  drawingPowerFallback: boolean;
  /** Wilful-default DATE slot: literal "0" (V3.9) or blank (V3.10). */
  wilfulDateZero: boolean;
}
const V39_OPTS: FlatOpts = { prefixUpper: false, gsRelTypePadded: true, drawingPowerFallback: true, wilfulDateZero: true };
const V310_OPTS: FlatOpts = { prefixUpper: true, gsRelTypePadded: false, drawingPowerFallback: false, wilfulDateZero: false };

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

/** Normalize a label for tolerant matching: lowercase, collapse spaces, drop quotes,
 * and standardize dash spacing so "Primary-First" == "Primary – First". */
function normalize(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[“”„‘’]/g, '')
    .replace(/\s*[-–—]\s*/g, '-');
}

/** Zero-pad a small numeric legend to 2 digits; blank for non-numeric ("NA"). */
function pad2Legend(v: FieldValue): string {
  const s = codeKey(v);
  return /^\d+$/.test(s) ? s.padStart(2, '0') : '';
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse the messy free-text dates accountants type — "04th June 2025", "4 Jun 2025",
 * "June 4, 2025", "20-06-1987", "20/06/1987" — into DDMMYYYY. Returns '' if unparseable.
 * (Excel serials / Date objects are handled by `coerceCell` before this is reached.)
 */
function looseDate(s: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const cleaned = s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').trim();

  // <day> <month-name> <year>  |  <month-name> <day> <year>
  const named = /^(\d{1,2})\s+([a-z]{3,})\s+(\d{4})$|^([a-z]{3,})\s+(\d{1,2})\s+(\d{4})$/i.exec(cleaned);
  if (named) {
    const day = Number(named[1] ?? named[5]);
    const mon = MONTHS[(named[2] ?? named[4] ?? '').slice(0, 3).toLowerCase()];
    const year = Number(named[3] ?? named[6]);
    if (mon && day >= 1 && day <= 31) return `${pad(day)}${pad(mon)}${year}`;
  }
  // DD-MM-YYYY / DD/MM/YYYY (and 2-digit year)
  const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(cleaned);
  if (numeric) {
    const day = Number(numeric[1]);
    const mon = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${pad(day)}${pad(mon)}${year}`;
  }
  return '';
}

/** Parse a date-ish input cell to DDMMYYYY (Date, Excel serial, or free text). */
function ddmmyyyy(v: FieldValue): string {
  const s = strNA(v);
  if (s === '') return '';
  const coerced = coerceCell({ key: 'd', type: 'date-ddmmyyyy', mandatory: false }, v as never);
  if (coerced instanceof Date) return formatDdmmyyyy(coerced);
  return looseDate(s) || s;
}

/** Whole-rupee string; non-numeric junk ("No", "-", "NA", …) collapses to blank. */
function rupees(v: FieldValue): string {
  const s = strNA(v);
  if (s === '') return '';
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Math.round(n)) : '';
}

/** Placeholders accountants type for an empty cell (treated as blank everywhere). */
const BLANK_PLACEHOLDER = /^(na|n\.?\/?a|null|nil|none|-+)$/i;
function isBlankPlaceholder(s: string): boolean {
  return s === '' || BLANK_PLACEHOLDER.test(s);
}

/** `str`, but maps the common empty-cell placeholders ("NA", "-", "N/A", …) to blank. */
function strNA(v: FieldValue): string {
  const s = str(v);
  return isBlankPlaceholder(s) ? '' : s;
}

/** Zero-pad a small numeric legend to 3 digits (Security Type 001–011); blank for "NA". */
function pad3Legend(v: FieldValue): string {
  const s = codeKey(v);
  return /^\d+$/.test(s) ? s.padStart(3, '0') : '';
}

/** GS Related-Type: V3.9 keeps the padded code ("02"); V3.10 drops the pad ("2"). */
function gsRelType(code: string, opts: FlatOpts): string {
  if (code === '' || opts.gsRelTypePadded || !/^\d+$/.test(code)) return code;
  return String(Number(code));
}

/**
 * Resolve an address into the CRIF sub-fields, preferring explicit City/State/PIN
 * columns (future template) over values parsed from the free-text address. `state`
 * may be a state name or a 2-digit code.
 */
function resolveAddress(
  raw: FieldValue,
  city?: FieldValue,
  state?: FieldValue,
  pin?: FieldValue,
): { line1: string; city: string; stateName: string; stateCode: string; pinCode: string } {
  const parsed = splitAddress(raw);
  let stateName = parsed.stateName;
  let stateCode = parsed.stateCode;
  const st = strNA(state);
  if (st !== '') {
    const byName = STATE_LOOKUP.find((x) => x.needle === st.toLowerCase());
    const byCode = (STATE_CODE as Record<string, string>)[st];
    if (byName) {
      stateName = byName.name;
      stateCode = byName.code;
    } else if (byCode) {
      stateName = byCode;
      stateCode = st;
    } else {
      stateName = st;
      stateCode = '';
    }
  }
  return {
    line1: parsed.line1,
    city: strNA(city) || parsed.city,
    stateName,
    stateCode,
    pinCode: strNA(pin) || parsed.pinCode,
  };
}

/* ---------- state lookup (CRIF catalogue 8.6, name -> code) ---------- */

/** Canonical state names sorted longest-first so "Uttar Pradesh" wins over any
 * shorter partial; a few common spelling aliases fold onto the canonical name. */
const STATE_ALIASES: Record<string, string> = {
  odisha: 'Orissa',
  delhi: 'New Delhi',
  pondicherry: 'Puducherry',
  uttaranchal: 'Uttarakhand',
  // common accountant misspellings seen in real Master Sheets
  gujrat: 'Gujarat',
  maharastra: 'Maharashtra',
  karnatka: 'Karnataka',
};
const STATE_LOOKUP: Array<{ needle: string; name: string; code: string }> = (() => {
  const out: Array<{ needle: string; name: string; code: string }> = [];
  for (const [code, name] of Object.entries(STATE_CODE)) out.push({ needle: name.toLowerCase(), name, code });
  for (const [alias, canonical] of Object.entries(STATE_ALIASES)) {
    const hit = out.find((s) => s.name === canonical);
    if (hit) out.push({ needle: alias, name: hit.name, code: hit.code });
  }
  return out.sort((a, b) => b.needle.length - a.needle.length);
})();

/** Find the last-occurring known state name in a free-text address. */
function findState(lower: string): { name: string; code: string; index: number } | undefined {
  let best: { name: string; code: string; index: number } | undefined;
  for (const s of STATE_LOOKUP) {
    const re = new RegExp(`\\b${s.needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = re.exec(lower);
    if (m && (!best || m.index > best.index)) best = { name: s.name, code: s.code, index: m.index };
  }
  return best;
}

/**
 * City -> { state code, state name } fallback for sheets whose address text carries
 * the CITY but no STATE name (e.g. "…Worli, Mumbai - 400018. INDIA"). Codes are the
 * CRIF 8.6 state codes. Extend as needed.
 */
const CITY_STATE: Record<string, { code: string; name: string }> = {
  mumbai: { code: '20', name: 'Maharashtra' },
  pune: { code: '20', name: 'Maharashtra' },
  nagpur: { code: '20', name: 'Maharashtra' },
  ahmedabad: { code: '11', name: 'Gujarat' },
  surat: { code: '11', name: 'Gujarat' },
  vadodara: { code: '11', name: 'Gujarat' },
  bengaluru: { code: '16', name: 'Karnataka' },
  bangalore: { code: '16', name: 'Karnataka' },
  chennai: { code: '31', name: 'Tamil Nadu' },
  kolkata: { code: '35', name: 'West Bengal' },
  hyderabad: { code: '36', name: 'Telangana' },
};

/** Strip a trailing country word + a " - <PIN>" / " <PIN>" tail from a city token. */
function cleanCityToken(token: string): string {
  return token
    .replace(/[.,\s]*india\.?\s*$/i, '')
    .replace(/[\s\-]*\d{6}\s*$/, '')
    .replace(/[\s,\-]+$/, '')
    .trim();
}

/**
 * Parse a free-text address into the AS/RS/GS sub-fields. Two accountant conventions
 * are supported and detected by whether a STATE NAME appears in the text:
 *   - state IS in the text  ("…Rampur Uttar Pradesh 244927"): Line 1 keeps the FULL
 *     address; city = the comma-segment (else word) immediately before the state.
 *   - state is NOT in the text ("…Worli, Mumbai - 400018. INDIA"): the older
 *     "<street>, <City> - <PIN>. COUNTRY" form — Line 1 is the street portion (tail
 *     stripped), city from the PIN tail, state via CITY_STATE lookup.
 */
function splitAddress(raw: FieldValue): {
  line1: string;
  city: string;
  stateName: string;
  stateCode: string;
  pinCode: string;
} {
  const full = str(raw);
  if (isBlankPlaceholder(full)) {
    return { line1: '', city: '', stateName: '', stateCode: '', pinCode: '' };
  }
  const st = findState(full.toLowerCase());
  if (st) {
    const pinCode = /(\d{6})\b/.exec(full)?.[1] ?? '';
    const before = full.slice(0, st.index).replace(/[\s,\-]+$/, '');
    const lastComma = before.lastIndexOf(',');
    const city = (lastComma >= 0 ? before.slice(lastComma + 1) : before.split(/\s+/).pop() ?? '').trim();
    return { line1: full, city, stateName: st.name, stateCode: st.code, pinCode };
  }

  // Older "<street>, <City> - <PIN>. COUNTRY" form: strip the tail off Line 1.
  let s = full.replace(/[.,\s]*india\.?\s*$/i, '').trim();
  let city = '';
  const pinMatch = /(\d{6})\b/.exec(s);
  const pinCode = pinMatch?.[1] ?? '';
  if (pinMatch) {
    const beforePin = s.slice(0, pinMatch.index);
    const lastComma = beforePin.lastIndexOf(',');
    if (lastComma >= 0) {
      city = cleanCityToken(beforePin.slice(lastComma + 1));
      s = beforePin.slice(0, lastComma).replace(/[\s,]+$/, '');
    } else {
      city = cleanCityToken(beforePin);
      s = '';
    }
  }
  const looked = CITY_STATE[city.toLowerCase()];
  return {
    line1: s.trim(),
    city,
    stateName: looked?.name ?? '',
    stateCode: looked?.code ?? '',
    pinCode,
  };
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

/**
 * Header-driven mapping (label prefix -> stable key). Master Sheets vary in column
 * POSITION between accountant templates (e.g. a single vs double "Asset
 * Classification" column shifts everything after it, and the related-person block
 * lands one column over), but the header LABELS are stable. Matching by header text
 * makes one profile read both layouts. Header cells carry an embedded legend after
 * the label, so the reader matches by normalized prefix (longest match wins, which
 * is the legend-bearing column that actually holds the data).
 */
const COLUMN_HEADERS: Record<string, string> = {
  "Borrower's Name": 'borrowerName',
  "Borrower's PAN": 'pan',
  'Borrowers Legal Constitution': 'legalConstitution',
  'Business Category': 'businessCategory',
  'Business/ Industry Type': 'businessIndustryType',
  "Borrower's Address with PIN Code": 'address',
  "Borrower's Contact No.": 'contactNo',
  "Borrower's Account Number": 'accountNumber',
  'Facility / Loan Activation / Sanction Date': 'sanctionDate',
  'Sanctioned Amount/ Notional Amount of Contract': 'sanctionedAmount',
  'Credit Type': 'creditType',
  'Repayment Frequency': 'repaymentFrequency',
  'Drawing Power': 'drawingPower',
  'Current Balance / Limit Utilized': 'currentBalance',
  'Asset Classification': 'assetClassification',
  'Amount Overdue / Limit Overdue': 'amountOverdue',
  'Account Status': 'accountStatus',
  'Wilful Default Status': 'wilfulDefault',
  'Suit Filed Status': 'suitFiledStatus',
  'Suit Reference Number': 'suitReferenceNumber',
  'Suit Amount in Rupees': 'suitAmount',
  'Date of Suit': 'dateOfSuit',
  // Related person
  'Relationship Type': 'relationshipType',
  "Related Person's Name": 'relatedName',
  "Related Person's Gender": 'relatedGender',
  "Related Person's Date of Birth": 'relatedDob',
  "Related Person's PAN": 'relatedPan',
  "Related Person's Address with PIN Code": 'relatedAddress',
  "Related Person's Contact No": 'relatedContact',
  // Security (unique headers — safe to match by label)
  'Value of Security': 'securityValue',
  'Type of Security': 'securityType',
  'Security Classification': 'securityClass',
  // Optional explicit address columns (future template; absent in the 1 Jul sheets)
  "Borrower's City": 'borrowerCity',
  "Borrower's State": 'borrowerState',
  "Borrower's PIN": 'borrowerPin',
  // Expanded template (July 26): extra columns that carry the value/code directly.
  // "Company Registration Number" / "Date of Incorporation" also repeat for the related
  // person, but the header matcher breaks ties toward the FIRST (borrower) column, so
  // these bind to the borrower's.
  'Company Registration Number': 'companyRegNumber',
  'Date of Incorporation': 'dateOfIncorporation',
  'CIN': 'cin',
  'CLASS OF ACTIVITY': 'classOfActivity',
  'Borrower Office DUNS Number': 'officeDuns',
  'STATE CODE': 'borrowerState',
  'Location Type': 'locationType',
};

function explode(
  input: Record<string, FieldValue>,
  ctx: FlatExplodeContext,
  opts: FlatOpts = V39_OPTS,
): SegmentSeed[] {
  const seeds: SegmentSeed[] = [];
  const issues: SegmentSeed['issues'] = [];
  const prefixMap = opts.prefixUpper ? GENDER_PREFIX_UPPER : GENDER_PREFIX;

  // ---- BS (borrower) ----
  seeds.push({
    tag: 'BS',
    flag: 1,
    values: row({
      _tag: 'BS',
      memberBranchCode: DEFAULTS.memberBranchCode,
      borrowerName: str(input.borrowerName),
      pan: str(input.pan),
      companyRegNumber: strNA(input.companyRegNumber),
      dateOfIncorporation: ddmmyyyy(input.dateOfIncorporation),
      cin: strNA(input.cin),
      legalConstitution: mapLegend(LEGAL_CONSTITUTION, input.legalConstitution) ?? '',
      businessCategory: mapLegend(BUSINESS_CATEGORY, input.businessCategory) ?? '',
      businessIndustryType: mapLegend(BUSINESS_INDUSTRY, input.businessIndustryType) ?? '',
      classOfActivity1: strNA(input.classOfActivity),
    }),
  });

  // ---- AS (borrower address) ----
  // Address Line 1 keeps the full text; City / State (District field) / State-code /
  // PIN are extracted from it (or from explicit columns when the template has them).
  // Country carries the telephone STD code per the sample.
  const ba = resolveAddress(input.address, input.borrowerCity, input.borrowerState, input.borrowerPin);
  seeds.push({
    tag: 'AS',
    flag: 2,
    values: row({
      _tag: 'AS',
      officeLocationType: mapLegend(LOCATION_TYPE, input.locationType) || DEFAULTS.officeLocationType,
      officeDunsNumber: strNA(input.officeDuns) || DEFAULTS.officeDuns,
      addressLine1: ba.line1,
      cityTown: ba.city,
      // District carries the CITY, not the state — a state name (e.g. "Karnataka")
      // only drives the 2-digit State code, it never goes in District.
      district: ba.city,
      stateCode: ba.stateCode,
      pinCode: ba.pinCode,
      country: DEFAULTS.countryCode,
      mobileNumber: strNA(input.contactNo),
    }),
  });

  // ---- RS (related person) — only when a related person is present ----
  if (strNA(input.relatedName) !== '') {
    const g = str(input.relatedGender).toLowerCase();
    const ra = resolveAddress(input.relatedAddress);
    seeds.push({
      tag: 'RS',
      flag: 3,
      values: row({
        _tag: 'RS',
        relationshipDuns: DEFAULTS.relationshipDuns,
        relatedType: '2', // Resident Indian Individual (individual related person)
        relationship: mapLegend(RELATIONSHIP_TYPE, input.relationshipType) ?? '',
        namePrefix: prefixMap[g] ?? '',
        fullName: strNA(input.relatedName),
        gender: GENDER_CODE[g] ?? '',
        dateOfBirth: ddmmyyyy(input.relatedDob),
        rsPan: strNA(input.relatedPan),
        rsAddressLine1: ra.line1,
        rsCity: ra.city,
        rsDistrict: ra.city,
        rsStateCode: ra.stateCode,
        rsPinCode: ra.pinCode,
        rsCountry: DEFAULTS.countryCode,
        rsMobile: strNA(input.relatedContact),
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
      drawingPower: opts.drawingPowerFallback
        ? rupees(input.drawingPower) || rupees(input.sanctionedAmount)
        : rupees(input.drawingPower) || '0',
      currentBalance: rupees(input.currentBalance),
      assetClassification: mapLegend(ASSET_CLASSIFICATION, input.assetClassification) ?? '',
      amountOverdue: rupees(input.amountOverdue) || '0',
      accountStatus: mapLegend(ACCOUNT_STATUS, input.accountStatus) ?? '',
      // Wilful-default status 0 = No; the DATE slot is likewise a literal "0" (both
      // goldens do this — FLAT_BODY relaxes that field to string); suit-filed 00 = none.
      wilfulDefaultStatus: wilfulCode(input.wilfulDefault) || '0',
      wilfulDefaultDate: opts.wilfulDateZero ? '0' : '',
      suitFiledStatus: '00',
    }),
  });

  // ---- GS (guarantors) — one per populated guarantor block ----
  // Guarantor blocks repeat side-by-side with identical headers, so read them
  // positionally from the raw row (up to 3 in the standard template, 1 in the OD
  // template with a Contact column). Empty/"NA" blocks emit nothing.
  for (const gtor of readGuarantorBlocks(ctx.rawCells)) {
    const name = strNA(gtor.fullName) || strNA(gtor.entityName);
    if (name === '') continue;
    const g = strNA(gtor.gender).toLowerCase();
    const ga = resolveAddress(gtor.address);
    seeds.push({
      tag: 'GS',
      flag: 5,
      values: row({
        _tag: 'GS',
        gsDuns: DEFAULTS.relationshipDuns,
        gsRelatedType: gsRelType(mapLegend(RELATED_TYPE, gtor.type) ?? '', opts),
        gsNamePrefix: prefixMap[g] ?? '',
        gsFullName: name,
        gsGender: GENDER_CODE[g] ?? '',
        gsDateOfBirth: ddmmyyyy(gtor.dob),
        gsPan: strNA(gtor.pan),
        gsAddressLine1: ga.line1,
        gsCity: ga.city,
        gsDistrict: ga.city,
        gsStateCode: ga.stateCode,
        gsPinCode: ga.pinCode,
        gsCountry: DEFAULTS.countryCode,
        gsMobile: strNA(gtor.contact),
      }),
    });
  }

  // ---- SS (security) — only when a REAL security is present ----
  // A zero/blank value with an "NA" type/class means "no security" — emit nothing
  // (some sheets stamp "0"/"NA" rather than leaving the cells empty).
  const secValue = rupees(input.securityValue);
  const secType = mapLegend(SECURITY_TYPE, input.securityType) ?? pad3Legend(input.securityType);
  const hasSecurity = secType !== '' || (secValue !== '' && secValue !== '0');
  if (hasSecurity) {
    seeds.push({
      tag: 'SS',
      flag: 6,
      values: row({
        _tag: 'SS',
        securityValue: secValue,
        ssCurrency: DEFAULTS.currencyCode,
        securityType: secType,
        securityClassification: mapLegend(SECURITY_CLASS, input.securityClass) ?? '',
      }),
    });
  }

  // Attach mapping issues to the CR seed (where they originate).
  if (issues.length) {
    const cr = seeds.find((s) => s.tag === 'CR');
    if (cr) cr.issues = issues;
  }
  return seeds;
}

/** A guarantor sub-block read positionally from the raw row (fields by sub-header). */
interface GuarantorBlock {
  type: FieldValue;
  entityName: FieldValue;
  fullName: FieldValue;
  dob: FieldValue;
  pan: FieldValue;
  gender: FieldValue;
  address: FieldValue;
  contact: FieldValue;
}

/**
 * Detect the side-by-side guarantor blocks. Each block starts at a "Guarantor Type"
 * column and runs until the next one (or the first non-guarantor column). Within a
 * block the columns are mapped by their own (unique) sub-headers, so both templates
 * work — the 3-block layout (Entity/Name/DOB/PAN/Aadhaar/Gender/Address) and the
 * 1-block OD layout (Entity/Name/Gender/Address/Contact).
 */
function readGuarantorBlocks(rawCells: FlatExplodeContext['rawCells']): GuarantorBlock[] {
  if (!rawCells) return [];
  const isType = (h: string) => normalize(h).startsWith('guarantor type');
  const starts = rawCells.filter((c) => isType(c.header)).map((c) => c.col);
  if (starts.length === 0) return [];
  const blocks: GuarantorBlock[] = [];
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!;
    const to = i + 1 < starts.length ? starts[i + 1]! : Infinity;
    const blk: GuarantorBlock = {
      type: undefined, entityName: undefined, fullName: undefined, dob: undefined,
      pan: undefined, gender: undefined, address: undefined, contact: undefined,
    };
    for (const c of rawCells) {
      if (c.col < from || c.col >= to) continue;
      const h = normalize(c.header);
      if (h.startsWith('guarantor type')) blk.type = c.value;
      else if (h.startsWith('guarantor entity name')) blk.entityName = c.value;
      else if (h.startsWith('full name')) blk.fullName = c.value;
      else if (h.includes('date of birth')) blk.dob = c.value;
      else if (h.includes('pan')) blk.pan = c.value;
      // Gender header varies ("Gender" or "Male 01 Female 02 … Gender") — match anywhere.
      else if (h.includes('gender')) blk.gender = c.value;
      else if (h.includes('address')) blk.address = c.value;
      else if (h.includes('contact')) blk.contact = c.value;
    }
    blocks.push(blk);
  }
  return blocks;
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

/** Build a TypedRow from a sparse object (undefined keys stay blank). */
function row(values: Record<string, FieldValue>): TypedRow {
  return values as TypedRow;
}

/**
 * Body segments reuse the canonical commercial specs, EXCEPT SS: the flat profile
 * emits an empty `SS|||||||` filler (the accountant working file does not stamp the
 * INR currency default on an empty security segment), so drop SS's currency default.
 */
const FLAT_BODY: SegmentSpec[] = commercialUcrf.body.map((seg) => {
  if (seg.tag === 'SS') {
    return {
      ...seg,
      fields: seg.fields.map((f) => (f.key === 'ssCurrency' ? { ...f, default: undefined } : f)),
    };
  }
  if (seg.tag === 'CR') {
    // The golden stamps a literal "0" (not a date) in the wilful-default DATE slot;
    // relax that field to a plain string so the placeholder passes validation.
    return {
      ...seg,
      fields: seg.fields.map((f) =>
        f.key === 'wilfulDefaultDate' ? { ...f, type: 'string' as const } : f,
      ),
    };
  }
  return seg;
});

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
    headerRow: 10,
    columns: COLUMNS,
    columnHeaders: COLUMN_HEADERS,
    explode,
    // Accountant fills these top-of-sheet cells; a non-blank value overrides the
    // matching CLI flag. A5/A6/A7 hold the labels; B5/B6/B7 the values.
    headerCells: { B5: 'memberId', B6: 'reportingDate', B7: 'creationDate' },
  },
};

/**
 * HD "Reporting cycle" (V3.10 §7.1 field 6) derived from the reporting/cycle date's
 * day-of-month. Per the spec the weekly incremental submissions are "as on" the 9th
 * (W1), 16th (W2) and 23rd (W3), with the month-end submission = ME:
 *   day ≤ 9 → W1 · 10–16 → W2 · 17–23 → W3 · 24–end → ME
 */
export function reportingCycleCode(reportingDate: Date): string {
  const day = reportingDate.getUTCDate();
  if (day <= 9) return 'W1';
  if (day <= 16) return 'W2';
  if (day <= 23) return 'W3';
  return 'ME';
}

/**
 * Commercial UCRF **V3.10** profile — same mapping engine as the V3.9 flat format, with
 * the current bureau conventions: HD Reporting cycle derived from the reporting date
 * (W1/W2/W3/ME), upper-case RS/GS prefixes, unpadded GS Related-Type, Drawing Power
 * as-entered (no sanctioned-amount fallback), and a blank wilful-default date. Verified
 * against `commercial_output_9July_Final.txt`.
 */
export const commercialUcrfFlatV310: FormatSpec = {
  ...commercialUcrfFlat,
  id: 'commercial-ucrf-flat-v310',
  label: 'Commercial UCRF V3.10',
  version: '3.10',
  // HD Reporting-cycle code derived from the reporting date (W1=9th, W2=16th, W3=23rd,
  // ME=month-end); an explicit meta.infoType (e.g. DL/DC/AH/RR) still overrides.
  buildHeaderRow: (meta) => ({
    ...commercialUcrfFlat.buildHeaderRow!(meta),
    infoType: (meta.infoType as string) || reportingCycleCode(meta.reportingDate),
  }),
  flatExplode: {
    ...commercialUcrfFlat.flatExplode!,
    explode: (input, ctx) => explode(input, ctx, V310_OPTS),
  },
};

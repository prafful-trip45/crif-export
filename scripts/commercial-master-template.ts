/**
 * Commercial "Master Sheet" input template with the address and phone split into
 * their own columns, dropdowns for every coded field, and in-sheet checks, so the
 * accountant cannot type the mistakes the free-text sheets let through (a misspelt
 * state, a locality in City, a landline in Mobile, the same account number twice).
 *
 * The headers are the ones `commercial-ucrf-flat(-v310)` matches by text, so a filled
 * copy converts with no column mapping. Guarantor blocks sit last: the converter reads
 * each block positionally from its "Guarantor Type" column to the end of the row.
 *
 * Build: npm run make:templates  (writes templates/commercial-master-sheet.xlsx)
 */
import ExcelJS from 'exceljs';
import { STATE_CODE } from '../packages/core/src/formats/enums/commercial-enums.js';

/** Header row the converter looks for, and the first / last row the checks cover. */
export const HEADER_ROW = 10;
export const FIRST_DATA_ROW = 11;
const LAST_DATA_ROW = 1010;

type Kind =
  | 'text'
  | 'pan'
  | 'pin'
  | 'mobile'
  | 'std'
  | 'landline'
  | 'date'
  | 'amount'
  | 'account'
  | 'city'
  | { list: string };

interface Column {
  header: string;
  kind: Kind;
  group: string;
  required?: boolean;
  width?: number;
  note?: string;
}

/* ---------- dropdown values (each one is a label the converter maps to its CRIF code) ---------- */

const LISTS: Record<string, string[]> = {
  constitution: [
    'Private Limited', 'Public Limited', 'Business Entities Created by Statute', 'Proprietorship',
    'Partnership', 'Trust', 'Hindu Undivided Family', 'Co-operative Society', 'Association of Persons',
    'Government', 'Self Help Group', 'Individual',
  ],
  category: ['Micro', 'Small', 'Medium', 'Large', 'Others', 'Retail', 'Agri'],
  industry: [
    'Manufacturing', 'Distribution', 'Wholesale', 'Trading', 'Broking', 'Service Provider',
    'Importing', 'Exporting', 'Agriculture', 'Dealers', 'Others',
  ],
  location: ['Registered Office', 'Branch / Regional Office', 'Warehouse', 'Plant / Factory Address', 'Others', 'Mortgage Property'],
  state: Object.values(STATE_CODE).filter((s) => s !== 'Daman and Diu'),
  repayment: ['Monthly', 'Quarterly', 'Half yearly', 'Annual', 'On Demand', 'Bullet', 'Rolling', 'Others'],
  asset: [
    'Standard', 'Sub-standard', 'Loss', 'SMA 0', 'SMA 1', 'SMA 2', 'Doubtful-1', 'Doubtful-2', 'Doubtful-3',
    'NPA', 'ARC Loan', '0 Day Past Due', '1 Day Past Due', '2 Days Past Due',
  ],
  accountStatus: [
    'Open', 'Closed By Payment', 'Settled & Closed', 'Restructured', 'Written Off', 'Settled Post Write Off',
    'Invoked', 'Devolved', 'Restructured Due to Natural Calamity', 'Sold to ARC', 'Purchase from Bank',
    'Restructured & Closed',
  ],
  yesNo: ['No', 'Yes'],
  relationship: [
    'Shareholder', 'Holding Company', 'Subsidiary Company', 'Proprietor', 'Partner', 'Trustee',
    'Promoter Director', 'Nominee Director', 'Independent Director', 'Director - Since Resigned',
    'Individual Member of SHG', 'Other Director', 'Others', 'Karta (HUF)',
  ],
  gender: ['Male', 'Female', 'Transgender'],
  guarantorType: [
    'Business Entity Registered in India', 'Resident Indian Individual',
    'Business Entity Registered Outside India', 'Foreign/ Non-Resident Indian Individual',
  ],
  securityType: [
    'Cash/ Bullion/ Bank Deposits', 'Shares/ Bonds/ Securities', 'Inventory (Raw Material, WIP and Finished Goods)',
    'Accounts Receivable', 'Other Current Assets', 'Plant & Machinery and Equipment', 'Land & Buildings',
    'Other Fixed Assets', 'Other Assets', 'Aggregate of all Current Assets', 'Aggregate of all Fixed Assets',
  ],
  securityClass: [
    'Primary - First Charge', 'Primary - Second Charge', 'Primary - Third Charge', 'Primary - Parri Passu',
    'Collateral - First Charge', 'Collateral - Second Charge', 'Collateral - Third Charge', 'Collateral - Parri Passu',
  ],
};

/** CRIF Credit Type catalogue — the converter resolves the description via this sheet. */
export const CREDIT_TYPES: Array<[string, string]> = [
  ['0100', 'Cash credit'],
  ['0200', 'Overdraft'],
  ['0300', 'Demand loan'],
  ['0310', 'Loan extended through credit cards'],
  ['0410', 'Medium term loan (period above 1 year and up to 3 years)'],
  ['0420', 'Long term loan (period above 3 years)'],
  ['0500', 'Packing credit (all export pre-shipment finance)'],
  ['0610', 'Export bills purchased'],
  ['0620', 'Export bills discounted'],
  ['0630', 'Export bills advanced against'],
  ['0640', 'Advances against export cash incentives and duty draw-back claims'],
  ['0710', 'Inland bills purchased'],
  ['0720', 'Inland bills discounted'],
  ['0800', 'Advances against import bills'],
  ['0900', 'Foreign currency cheques TCS/DDS/TTS/MTS purchased'],
  ['1000', 'Lease finance'],
  ['1100', 'Hire purchase'],
  ['2000', 'Bank guarantee'],
  ['2100', 'Deferred payment guarantee'],
  ['3000', 'Letters of credit'],
  ['3100', 'Corporate credit card'],
  ['4000', 'Commercial vehicle loan'],
  ['4100', 'Equipment financing (construction office medical)'],
  ['5000', 'Unsecured business loan'],
  ['5100', 'Short term loan (less than 1 year)'],
  ['5200', 'Aggregation of all fund based facilities'],
  ['5300', 'Aggregation of all non fund based facilities'],
  ['5400', 'Facilities interchange between fund & non fund based'],
  ['5500', 'Derivatives'],
  ['5600', 'Plain vanilla forex forward contracts'],
  ['5700', 'Plain vanila int rate swap(all including INR as coupon)'],
  ['5800', 'Plain vanila foreign currency option (including INR cross currency)'],
  ['5900', 'Complex int rate derv with optionalities'],
  ['6000', 'Any complex derivative loan involving foreign currency with option'],
  ['6100', 'Contracts on past performance - imports'],
  ['6200', 'Contracts on past performance - exports'],
  ['9000', 'Aggregate of all borrowings due to filing of suit'],
  ['9001', 'Auto Loan'],
  ['9002', 'Property Loan'],
  ['9003', 'Gold Loan'],
  ['9004', 'Loan Against Shares/Securities'],
  ['9005', 'HealthCare Finance'],
  ['9006', 'Infrastructure Finance'],
  ['9007', 'Factoring with Recourse (Seller)'],
  ['9008', 'Commercial Paper'],
  ['9009', 'NCD - Non Convertible Debentures'],
  ['9010', 'Unhedged Foreign Currency Exposure'],
  ['9011', 'Payment Account (Point of Sale & Payment Gateways)'],
  ['9012', 'Current Loan'],
  ['9013', 'ARC - Secured Loan (refer Annex. B for validations)'],
  ['9014', 'ARC - Unsecured Loan (refer Annex. B for validations)'],
  ['9020', 'Seller Financing'],
  ['9021', 'GECL Loan'],
  ['9022', 'Mudra Term Loan'],
  ['9023', 'Mudra Working Capital'],
  ['9024', 'Temporary Overdraft'],
  ['9026', 'Factoring without Recourse (Buyer)'],
  ['9027', 'Overdraft against FD'],
  ['9028', 'Overdraft against Shares / Securities'],
  ['9029', 'Overdraft against Collateral'],
  ['9030', 'Merchant Acquiring'],
  ['9031', 'Government Sponsored Loan'],
  ['9032', 'Working Capital Loan'],
  ['9033', '3-Wheeler Loan'],
  ['9036', 'Credit Exposures converted to debt/equity securities due to restructuring'],
  ['9999', 'Others'],
];

/* ---------- columns ---------- */

/** Address + phone block, identical for every party so each person is entered the same way. */
function addressColumns(prefix: string, group: string, required: boolean): Column[] {
  return [
    { header: `${prefix} Address Line 1`, kind: 'text', group, required, width: 34, note: 'House / flat / plot no., building name. No city, state or PIN here.' },
    { header: `${prefix} Address Line 2`, kind: 'text', group, width: 30, note: 'Street, road, area, locality.' },
    { header: `${prefix} Address Line 3`, kind: 'text', group, width: 24, note: 'Landmark (optional).' },
    { header: `${prefix} City`, kind: 'city', group, required, width: 16, note: 'City or town only, e.g. "Hyderabad" — not the locality ("Madhapur") or the state.' },
    { header: `${prefix} District`, kind: 'text', group, width: 16, note: 'Optional. Leave blank to repeat the city.' },
    { header: `${prefix} State`, kind: { list: 'state' }, group, required, width: 20, note: 'Pick from the list.' },
    { header: `${prefix} PIN Code`, kind: 'pin', group, required, width: 10, note: '6 digits.' },
    { header: `${prefix} Mobile`, kind: 'mobile', group, width: 13, note: '10-digit mobile, no +91 or 0. Landlines go in the Landline columns.' },
    { header: `${prefix} Landline STD Code`, kind: 'std', group, width: 10, note: 'With the leading 0, e.g. 040.' },
    { header: `${prefix} Landline Number`, kind: 'landline', group, width: 13, note: 'Without the STD code, e.g. 43728111.' },
  ];
}

function guarantorColumns(n: number): Column[] {
  const group = `GUARANTOR ${n}`;
  return [
    { header: 'Guarantor Type', kind: { list: 'guarantorType' }, group, width: 22, note: 'Start of a guarantor block. Leave the whole block blank if there is no guarantor.' },
    { header: 'Guarantor Entity Name (if company)', kind: 'text', group, width: 26, note: 'Only for a business-entity guarantor.' },
    { header: 'Full Name (if individual)', kind: 'text', group, width: 24, note: 'Only for an individual guarantor.' },
    { header: "Guarantor's Date of Birth", kind: 'date', group, width: 12 },
    { header: "Guarantor's PAN", kind: 'pan', group, width: 12 },
    { header: "Guarantor's Gender", kind: { list: 'gender' }, group, width: 11 },
    ...addressColumns("Guarantor's", group, false),
  ];
}

export const COLUMNS: Column[] = [
  { header: "Borrower's Name", kind: 'text', group: 'BORROWER', required: true, width: 30 },
  { header: "Borrower's PAN", kind: 'pan', group: 'BORROWER', required: true, width: 12, note: '10 characters, e.g. AAACV6672N. The 4th letter must fit the constitution (C company, F firm, P proprietor).' },
  { header: 'Borrowers Legal Constitution', kind: { list: 'constitution' }, group: 'BORROWER', required: true, width: 22 },
  { header: 'Business Category', kind: { list: 'category' }, group: 'BORROWER', required: true, width: 12 },
  { header: 'Business/ Industry Type', kind: { list: 'industry' }, group: 'BORROWER', required: true, width: 16 },
  { header: 'CLASS OF ACTIVITY', kind: 'text', group: 'BORROWER', width: 10, note: 'NIC code, e.g. 85102.' },
  { header: 'Location Type', kind: { list: 'location' }, group: 'BORROWER', width: 18, note: 'Blank = Registered Office.' },
  ...addressColumns("Borrower's", 'BORROWER ADDRESS', true),
  { header: "Borrower's Account Number", kind: 'account', group: 'ACCOUNT', required: true, width: 18, note: 'Must be unique in the sheet: one row per loan account.' },
  { header: 'Facility / Loan Activation / Sanction Date', kind: 'date', group: 'ACCOUNT', required: true, width: 12 },
  { header: 'Sanctioned Amount/ Notional Amount of Contract', kind: 'amount', group: 'ACCOUNT', required: true, width: 14 },
  { header: 'Credit Type', kind: { list: 'creditType' }, group: 'ACCOUNT', required: true, width: 26 },
  { header: 'Repayment Frequency', kind: { list: 'repayment' }, group: 'ACCOUNT', required: true, width: 12 },
  { header: 'Drawing Power', kind: 'amount', group: 'ACCOUNT', width: 12, note: 'Only for Cash credit, Overdraft, Corporate credit card and Temporary Overdraft.' },
  { header: 'Current Balance / Limit Utilized (Only Principal Outstanding)', kind: 'amount', group: 'ACCOUNT', required: true, width: 14 },
  { header: 'Asset Classification', kind: { list: 'asset' }, group: 'ACCOUNT', required: true, width: 14 },
  { header: 'Amount Overdue / Limit Overdue', kind: 'amount', group: 'ACCOUNT', width: 12 },
  { header: 'Account Status', kind: { list: 'accountStatus' }, group: 'ACCOUNT', required: true, width: 14 },
  { header: 'Wilful Default Status', kind: { list: 'yesNo' }, group: 'ACCOUNT', width: 10 },
  { header: 'Date Classified as Wilful Default', kind: 'date', group: 'ACCOUNT', width: 12, note: 'Required when Wilful Default Status is Yes.' },
  { header: 'Relationship Type', kind: { list: 'relationship' }, group: 'RELATED PERSON', width: 18 },
  { header: "Related Person's Name", kind: 'text', group: 'RELATED PERSON', width: 26 },
  { header: "Related Person's Gender", kind: { list: 'gender' }, group: 'RELATED PERSON', width: 11 },
  { header: "Related Person's Date of Birth", kind: 'date', group: 'RELATED PERSON', width: 12 },
  { header: "Related Person's PAN", kind: 'pan', group: 'RELATED PERSON', width: 12 },
  ...addressColumns("Related Person's", 'RELATED PERSON', false),
  { header: 'Value of Security', kind: 'amount', group: 'SECURITY', width: 12 },
  { header: 'Type of Security', kind: { list: 'securityType' }, group: 'SECURITY', width: 22 },
  { header: 'Security Classification', kind: { list: 'securityClass' }, group: 'SECURITY', width: 22 },
  ...guarantorColumns(1),
  ...guarantorColumns(2),
];

const GROUP_FILL: Record<string, string> = {
  BORROWER: 'FFDDEBF7',
  'BORROWER ADDRESS': 'FFE2EFDA',
  ACCOUNT: 'FFFFF2CC',
  'RELATED PERSON': 'FFFCE4D6',
  SECURITY: 'FFEDEDED',
  'GUARANTOR 1': 'FFE4DFEC',
  'GUARANTOR 2': 'FFE4DFEC',
};

/* ---------- builder ---------- */

const colLetter = (n: number): string => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const NO_PIPE = (c: string) => `ISERROR(FIND("|",${c}))`;

/** Data-validation rule per column kind. Formulas are relative to the first data row. */
function validationFor(kind: Kind, c: string, col: string, listRefs: Record<string, string>): ExcelJS.DataValidation {
  const stop = { allowBlank: true, showErrorMessage: true, errorStyle: 'stop' } as const;
  if (typeof kind === 'object') {
    return { ...stop, type: 'list', formulae: [listRefs[kind.list]!], errorTitle: 'Pick from the list', error: 'Choose a value from the dropdown.' };
  }
  switch (kind) {
    case 'pan':
      return { ...stop, type: 'custom', formulae: [`AND(LEN(${c})=10,EXACT(${c},UPPER(${c})),ISNUMBER(--MID(${c},6,4)),ISERROR(--LEFT(${c},1)))`], errorTitle: 'PAN', error: 'PAN is 10 characters: 5 capital letters, 4 digits, 1 capital letter (e.g. AAACV6672N).' };
    case 'pin':
      return { ...stop, type: 'custom', formulae: [`AND(LEN(${c})=6,ISNUMBER(--${c}),LEFT(${c},1)<>"0")`], errorTitle: 'PIN code', error: 'PIN code is exactly 6 digits.' };
    case 'mobile':
      return { ...stop, type: 'custom', formulae: [`AND(LEN(${c})=10,ISNUMBER(--${c}),--LEFT(${c},1)>=6)`], errorTitle: 'Mobile', error: 'Enter a 10-digit mobile starting with 6, 7, 8 or 9 (no +91 or 0). Landlines go in the Landline columns.' };
    case 'std':
      return { ...stop, type: 'custom', formulae: [`AND(LEFT(${c},1)="0",LEN(${c})>=3,LEN(${c})<=5,ISNUMBER(--${c}))`], errorTitle: 'STD code', error: 'STD code starts with 0 and has 3-5 digits (e.g. 040).' };
    case 'landline':
      return { ...stop, type: 'custom', formulae: [`AND(LEN(${c})>=6,LEN(${c})<=8,ISNUMBER(--${c}))`], errorTitle: 'Landline', error: 'Landline number without the STD code: 6-8 digits.' };
    case 'date':
      return { ...stop, type: 'date', operator: 'between', formulae: [new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(2100, 11, 31))], errorTitle: 'Date', error: 'Enter a date (DD/MM/YYYY).' };
    case 'amount':
      return { ...stop, type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], errorTitle: 'Amount', error: 'Enter a number in rupees, without commas or text.' };
    case 'account':
      return { ...stop, type: 'custom', formulae: [`AND(COUNTIF($${col}$${FIRST_DATA_ROW}:$${col}$${LAST_DATA_ROW},${c})=1,${NO_PIPE(c)})`], errorTitle: 'Account number', error: 'This account number is already in the sheet. Each loan account must appear once.' };
    case 'city':
      return { ...stop, type: 'custom', formulae: [`AND(${NO_PIPE(c)},ISERROR(FIND(",",${c})),LEN(TRIM(${c}))-LEN(SUBSTITUTE(TRIM(${c})," ",""))<=2)`], errorTitle: 'City', error: 'City or town only (at most 3 words, no commas) — put the locality in Address Line 2.' };
    case 'text':
    default:
      return { ...stop, type: 'custom', formulae: [NO_PIPE(c)], errorTitle: 'Invalid character', error: 'The "|" character is not allowed (it is the bureau file separator).' };
  }
}

/** Red-fill rule per kind for values that slip past data validation (it does not check pasted cells). */
function highlightFor(kind: Kind, c: string, col: string): string | undefined {
  const filled = `LEN(${c})>0`;
  if (typeof kind === 'object') return undefined;
  switch (kind) {
    case 'pan':
      return `AND(${filled},NOT(AND(LEN(${c})=10,EXACT(${c},UPPER(${c})),ISNUMBER(--MID(${c},6,4)))))`;
    case 'pin':
      return `AND(${filled},NOT(AND(LEN(${c})=6,ISNUMBER(--${c}))))`;
    case 'mobile':
      return `AND(${filled},NOT(AND(LEN(${c})=10,ISNUMBER(--${c}),--LEFT(${c},1)>=6)))`;
    case 'account':
      return `AND(${filled},COUNTIF($${col}$${FIRST_DATA_ROW}:$${col}$${LAST_DATA_ROW},${c})>1)`;
    case 'city':
      return `AND(${filled},OR(ISNUMBER(FIND(",",${c})),LEN(TRIM(${c}))-LEN(SUBSTITUTE(TRIM(${c})," ",""))>2))`;
    case 'text':
      return `AND(${filled},ISNUMBER(FIND("|",${c})))`;
    default:
      return undefined;
  }
}

export async function buildCommercialMasterTemplate(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'crif-export';

  /* Instructions */
  const inst = wb.addWorksheet('Instructions');
  inst.getColumn(1).width = 120;
  inst.getColumn(1).alignment = { wrapText: true, vertical: 'top' };
  const lines: Array<[string, boolean?]> = [
    ['CRIF Commercial Master Sheet — how to fill', true],
    [''],
    ['1. Fill the "Master Sheet" tab from row 11: one row per loan account. Do not change the headers in row 10.'],
    ['2. Fill Member ID, Reporting / Cycle Date and Date of Creation in cells B5, B6 and B7 of the Master Sheet.'],
    ['3. Red headers are required. Coded columns have a dropdown: pick a value, do not type codes.'],
    [''],
    ['Addresses (borrower, related person and each guarantor)', true],
    ['• Address Line 1: house / flat / plot number and building. Address Line 2: street and locality. Line 3: landmark.'],
    ['• City: the city or town only — "Hyderabad", not "Hitech City Madhapur Hyderabad" and not the state.'],
    ['• State: pick from the list. PIN Code: 6 digits. Do not repeat city, state or PIN inside the address lines.'],
    ['• Mobile: 10 digits, no +91 or 0. A landline goes in "Landline STD Code" (e.g. 040) and "Landline Number" (e.g. 43728111).'],
    ['• When the same person is both the Related Person and a Guarantor, copy the address cells across — do not retype them.'],
    [''],
    ['Accounts', true],
    ['• Each account number must appear once. Two loans to the same borrower are two rows with two different account numbers.'],
    ['• Amounts in whole rupees, no commas. Dates as dates (DD/MM/YYYY).'],
    ['• Drawing Power only for Cash credit, Overdraft, Corporate credit card and Temporary Overdraft.'],
    [''],
    ['Checks', true],
    ['• The sheet blocks invalid entries as you type and shades pasted values that break a rule in red. Fix every red cell before converting.'],
    ['• The "|" character is not allowed anywhere: it is the separator in the bureau file.'],
    ['• Guarantor blocks: leave a block completely blank if there is no guarantor. Use "Guarantor Entity Name" for a company, "Full Name" for a person.'],
  ];
  for (const [text, bold] of lines) {
    const r = inst.addRow([text]);
    if (bold) r.font = { bold: true, size: lines[0]![0] === text ? 14 : 11 };
  }

  /* Master Sheet */
  const ws = wb.addWorksheet('Master Sheet');
  ws.getCell('A1').value = 'CRIF Commercial Master Sheet (split-address template)';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'One row per loan account from row 11. See the Instructions tab. Red headers are required.';
  ws.getCell('A5').value = 'Member ID';
  ws.getCell('A6').value = 'Reporting / Cycle Date';
  ws.getCell('A7').value = 'Date of Creation & Certification';
  for (const a of ['A5', 'A6', 'A7']) ws.getCell(a).font = { bold: true };
  ws.getCell('B5').numFmt = '@';
  ws.getCell('B6').numFmt = 'dd/mm/yyyy';
  ws.getCell('B7').numFmt = 'dd/mm/yyyy';
  for (const a of ['B5', 'B6', 'B7']) {
    ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    ws.getCell(a).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  }

  /* Lists + Credit Type Code sheets, referenced by the dropdowns */
  const listRefs: Record<string, string> = {};
  const lists = wb.addWorksheet('Lists');
  Object.entries(LISTS).forEach(([name, values], i) => {
    const col = colLetter(i + 1);
    lists.getCell(`${col}1`).value = name;
    lists.getCell(`${col}1`).font = { bold: true };
    values.forEach((v, j) => (lists.getCell(`${col}${j + 2}`).value = v));
    lists.getColumn(i + 1).width = 30;
    listRefs[name] = `Lists!$${col}$2:$${col}$${values.length + 1}`;
  });
  const ct = wb.addWorksheet('Credit Type Code');
  ct.addRow(['#', 'Code', 'Description']).font = { bold: true };
  CREDIT_TYPES.forEach(([code, desc], i) => ct.addRow([i + 1, code, desc]));
  ct.getColumn(2).numFmt = '@';
  ct.getColumn(3).width = 70;
  listRefs.creditType = `'Credit Type Code'!$C$2:$C$${CREDIT_TYPES.length + 1}`;

  const groupRow = ws.getRow(HEADER_ROW - 1);
  const headerRow = ws.getRow(HEADER_ROW);
  let groupStart = 1;
  COLUMNS.forEach((c, i) => {
    const n = i + 1;
    const col = colLetter(n);
    const first = `${col}${FIRST_DATA_ROW}`;
    const fill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL[c.group] ?? 'FFEDEDED' } };

    const h = headerRow.getCell(n);
    h.value = c.header;
    h.font = { bold: true, color: { argb: c.required ? 'FFC00000' : 'FF000000' } };
    h.fill = fill;
    h.alignment = { wrapText: true, vertical: 'top' };
    h.border = { bottom: { style: 'thin' } };
    if (c.note) h.note = c.note;
    ws.getColumn(n).width = c.width ?? 14;

    // Text format keeps leading zeros (account numbers, STD codes) and stops Excel
    // turning a PAN or a long number into something else.
    if (c.kind === 'date') ws.getColumn(n).numFmt = 'dd/mm/yyyy';
    else if (c.kind === 'amount') ws.getColumn(n).numFmt = '0';
    else ws.getColumn(n).numFmt = '@';

    const range = `${first}:${col}${LAST_DATA_ROW}`;
    (ws as unknown as { dataValidations: { add(ref: string, dv: ExcelJS.DataValidation): void } }).dataValidations.add(
      range,
      validationFor(c.kind, first, col, listRefs),
    );
    const bad = highlightFor(c.kind, first, col);
    if (bad) {
      ws.addConditionalFormatting({
        ref: range,
        rules: [{ type: 'expression', priority: 1, formulae: [bad], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } } }],
      });
    }

    // Group band above the headers.
    const next = COLUMNS[i + 1];
    if (!next || next.group !== c.group) {
      ws.mergeCells(HEADER_ROW - 1, groupStart, HEADER_ROW - 1, n);
      const g = groupRow.getCell(groupStart);
      g.value = c.group;
      g.font = { bold: true };
      g.alignment = { horizontal: 'center' };
      g.fill = fill;
      groupStart = n + 1;
    }
  });
  headerRow.height = 48;
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: HEADER_ROW }];

  lists.state = 'hidden';
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  return wb;
}

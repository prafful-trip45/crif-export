import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import type { FileMeta, FormatSpec } from '../packages/core/src/core/types.js';
import { commercialUcrfFlatV310 } from '../packages/core/src/formats/commercial-ucrf-flat.js';
import { buildCommercialMasterTemplate, COLUMNS, FIRST_DATA_ROW, HEADER_ROW } from '../scripts/commercial-master-template.js';

/**
 * Address / phone / account data-quality checks on the Commercial Master Sheet, using
 * the defects seen in the 14-Oct-2026 sheet (NB72060001): a misspelt state that left
 * the state name in City, locality runs in City, a landline in the Mobile field, one
 * person typed twice with two spellings, and two account numbers reported twice.
 */

const META: FileMeta = {
  memberId: 'NB72060001',
  reportingDate: new Date(Date.UTC(2026, 9, 9)),
  creationDate: new Date(Date.UTC(2026, 9, 14)),
};

/** Token position of a wire field in a segment line. */
function tokenIndex(format: FormatSpec, tag: string, key: string): number {
  const i = format.body.find((s) => s.tag === tag)!.fields.findIndex((f) => f.key === key);
  expect(i, `${tag}.${key}`).toBeGreaterThan(0);
  return i;
}

function linesOf(text: string, tag: string): string[][] {
  return text.split('\r\n').filter((l) => l.startsWith(`${tag}|`)).map((l) => l.split('|'));
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;
}

/* ---------- older single-address-column sheet (the 14-Oct layout) ---------- */

const LEGACY_HEADERS = [
  "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
  'Business/ Industry Type', 'CLASS OF ACTIVITY', "Borrower's Address with PIN Code", 'STATE CODE',
  'Location Type', "Borrower's Contact No.", "Borrower's Account Number",
  'Facility / Loan Activation / Sanction Date', 'Sanctioned Amount/ Notional Amount of Contract',
  'Credit Type', 'Repayment Frequency', 'Current Balance / Limit Utilized', 'Asset Classification',
  'Account Status', 'Relationship Type', "Related Person's Name", "Related Person's Gender",
  "Related Person's Date of Birth", "Related Person's PAN", "Related Person's Address with PIN Code",
  "Related Person's Contact No",
  'Guarantor Type', 'Full Name If Individual Gaurantor', 'Gaurantor Date of Birth', 'Gaurantor Pan No',
  'Gender If Individual Gaurantor', "Individual Guarantor's Address Full address with pin code",
];

function legacyRow(v: Partial<Record<string, string>>): string[] {
  const base: Record<string, string> = {
    'Borrowers Legal Constitution': '11', 'Business Category': '03', 'Business/ Industry Type': '06',
    'CLASS OF ACTIVITY': '85102', 'STATE CODE': '36', 'Location Type': '01',
    'Facility / Loan Activation / Sanction Date': '01092026', 'Credit Type': '5000',
    'Repayment Frequency': '01', 'Asset Classification': '0001', 'Account Status': '01',
    'Relationship Type': '51', "Related Person's Gender": '01', "Related Person's Date of Birth": '01031978',
    'Guarantor Type': '2', 'Gaurantor Date of Birth': '01031978', 'Gender If Individual Gaurantor': '01',
  };
  return LEGACY_HEADERS.map((h) => v[h] ?? base[h] ?? '');
}

async function legacyWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Master Sheet');
  ws.addRow(LEGACY_HEADERS);
  ws.addRow(legacyRow({
    "Borrower's Name": 'BS DISTRIBUTORS', "Borrower's PAN": 'AAFPB0286J', 'Borrowers Legal Constitution': '40',
    "Borrower's Address with PIN Code": 'Opp Keshava Nethralaya Katha No 334, B G K Building Approva Hotel Road, Northeren Extension Hassan, Karanataka India 573201',
    'STATE CODE': '', "Borrower's Contact No.": '9986498002', "Borrower's Account Number": '066002000099999',
    'Sanctioned Amount/ Notional Amount of Contract': '3000000', 'Current Balance / Limit Utilized': '3000000',
    'Relationship Type': '30', "Related Person's Name": 'Bydaralli Swamy Harish', "Related Person's PAN": 'ADFPH1677J',
    "Related Person's Address with PIN Code": 'Kunu Hai Nilaya Bhagath Singh Road, Jayangare Near Ground Floor, Hassan, Karnataka India 573201',
    "Related Person's Contact No": '9866498002',
  }));
  for (const [amount, date] of [['1000000', '27082026'], ['500000', '01102026']] as const) {
    ws.addRow(legacyRow({
      "Borrower's Name": 'SOMARA WELNESS PRIVATE LIMITED', "Borrower's PAN": 'ABACS6602C',
      "Borrower's Address with PIN Code": 'H NO 1178 Siri Nilayam Adjacent to RNR Auditorium Lotus Pond, Road No 12 Banjara Hills, Hyderabad, Telangana India 500034',
      "Borrower's Contact No.": '9704443214', "Borrower's Account Number": '86602011000840',
      'Facility / Loan Activation / Sanction Date': date,
      'Sanctioned Amount/ Notional Amount of Contract': amount, 'Current Balance / Limit Utilized': amount,
      "Related Person's Name": 'Saurabh Kumar', "Related Person's PAN": 'AYMPK5753E',
      "Related Person's Address with PIN Code": 'F NO 202, SUNSREE RESIDENCY CHAITANYA ENCLAVE, KHAJAGUDA HYDEREBAD, TELANGANA INDIA 500075',
      "Related Person's Contact No": '9704443214',
      'Full Name If Individual Gaurantor': 'Saurabh Kumar', 'Gaurantor Pan No': 'AYMPK5753E',
      "Individual Guarantor's Address Full address with pin code": 'F NO 202, SUNSREE RESIDENCY CHAITANYA ENCLAVE, KHAJAGUDA HYDERABAD, TELANGANA INDIA 500075',
    }));
  }
  ws.addRow(legacyRow({
    "Borrower's Name": 'VIRINCHI LIMITED', "Borrower's PAN": 'AAACV6672N', 'Borrowers Legal Constitution': '12',
    "Borrower's Address with PIN Code": '8 2 672 5 6 4th Floor Ilyas, Mohammed Khan Estate Road No1 Banjara Hills, Hyderabad, Telangana India 500034',
    "Borrower's Contact No.": '9849022028', "Borrower's Account Number": '1983201000162',
    'Sanctioned Amount/ Notional Amount of Contract': '5000000', 'Current Balance / Limit Utilized': '896577',
    "Related Person's Name": 'Maddala Veera Srinivasa Rao', "Related Person's PAN": 'ABOPS9467L',
    "Related Person's Address with PIN Code": 'Flat no 301 Shanti Kuteer, Road No 2 Jubilee Hills, Hyderabad, Telangana India 500045',
    "Related Person's Contact No": '04043728111',
  }));
  return toBuffer(wb);
}

describe('Commercial Master Sheet address quality (older single-column sheet)', () => {
  it('reads a misspelt state, and flags it, locality-in-City, landlines, re-typed people and repeated accounts', async () => {
    const result = await convert(await legacyWorkbook(), commercialUcrfFlatV310, META, { allowWarnings: true, bypassErrors: true });
    const warnings = result.report.warnings.map((w) => w.message);
    const errors = result.report.errors;

    // "Karanataka" is read as Karnataka (the PIN 573201 agrees) instead of becoming the City.
    expect(warnings.some((m) => /State "Karanataka" in the address looks misspelt; read as Karnataka \(16\)/.test(m))).toBe(true);
    const as = linesOf(result.outputText!, 'AS');
    const city = tokenIndex(commercialUcrfFlatV310, 'AS', 'cityTown');
    const state = tokenIndex(commercialUcrfFlatV310, 'AS', 'stateCode');
    expect(as[0]![city]).not.toBe('Karanataka');
    expect(as[0]![state]).toBe('16');
    expect(warnings.some((m) => /City "Northeren Extension Hassan" looks like it includes the locality/.test(m))).toBe(true);

    // Partnership (40) with an individual's PAN.
    expect(warnings.some((m) => /PAN AAFPB0286J is not a firm PAN \(4th letter should be "F", found "P"\)/.test(m))).toBe(true);

    // Same PAN as related person and guarantor, typed with two spellings of the city.
    expect(warnings.some((m) => /PAN AYMPK5753E is both the Related Person and a Guarantor, but the two addresses differ/.test(m))).toBe(true);
    expect(warnings.some((m) => /"HYDEREBAD" looks like a misspelling of "Hyderabad"/.test(m))).toBe(true);

    // Landline in the Mobile field.
    expect(warnings.some((m) => /Related Person contact "04043728111" looks like a landline/.test(m))).toBe(true);

    // The repeated SOMARA account is a blocking error naming both rows.
    const dup = errors.filter((e) => e.rule === 'duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toMatch(/Account number 86602011000840 is reported more than once \(rows 3 and 4\)/);
    expect(dup[0]!.column).toBe('K');
  });

  it('keeps line breaks typed inside a cell out of the file, and refuses a "|" in a value', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master Sheet');
    ws.addRow(LEGACY_HEADERS);
    ws.addRow(legacyRow({
      "Borrower's Name": 'ELICO LIMITED', "Borrower's PAN": 'AAACE5140L', 'Borrowers Legal Constitution': '12',
      "Borrower's Address with PIN Code": 'B 90 APIE,\nSanathnagar Industrial estate Extension,\r\nHyderabad, Telangana India 500018',
      "Borrower's Contact No.": '9949035745', "Borrower's Account Number": '10558726624',
      'Sanctioned Amount/ Notional Amount of Contract': '5000000', 'Current Balance / Limit Utilized': '3131085',
    }));
    const ok = await convert(await toBuffer(wb), commercialUcrfFlatV310, META, { allowWarnings: true });
    expect(ok.report.errors).toEqual([]);
    const line1 = linesOf(ok.outputText!, 'AS')[0]![tokenIndex(commercialUcrfFlatV310, 'AS', 'addressLine1')];
    expect(line1).toBe('B 90 APIE, Sanathnagar Industrial estate Extension, Hyderabad, Telangana India 500018');

    ws.getCell('A2').value = 'ELICO | LIMITED';
    const bad = await convert(await toBuffer(wb), commercialUcrfFlatV310, META, { allowWarnings: true, bypassErrors: true });
    const pipe = bad.report.errors.find((e) => /contains "\|"/.test(e.message));
    expect(pipe?.bypassable).toBe(false);
    expect(bad.outputText).toBeUndefined();
  });
});

/* ---------- split-address template ---------- */

async function filledTemplate(rows: Array<Record<string, string | number | Date>>): Promise<ArrayBuffer> {
  const wb = await buildCommercialMasterTemplate();
  const ws = wb.getWorksheet('Master Sheet')!;
  ws.getCell('B5').value = 'NB72060001';
  // Guarantor sub-headers repeat per block; address them as "<header>#<block>".
  const colOf = new Map<string, number>();
  const seen = new Map<string, number>();
  COLUMNS.forEach((c, i) => {
    if (c.header === 'Guarantor Type') seen.set('block', (seen.get('block') ?? 0) + 1);
    const key = c.group.startsWith('GUARANTOR') ? `${c.header}#${seen.get('block')}` : c.header;
    colOf.set(key, i + 1);
  });
  rows.forEach((values, r) => {
    for (const [header, value] of Object.entries(values)) {
      const col = colOf.get(header);
      expect(col, header).toBeDefined();
      ws.getCell(FIRST_DATA_ROW + r, col!).value = value;
    }
  });
  return toBuffer(wb);
}

const VIRINCHI = {
  "Borrower's Name": 'VIRINCHI LIMITED',
  "Borrower's PAN": 'AAACV6672N',
  'Borrowers Legal Constitution': 'Public Limited',
  'Business Category': 'Small',
  'Business/ Industry Type': 'Service Provider',
  'CLASS OF ACTIVITY': '85102',
  "Borrower's Address Line 1": '8-2-672/5/6, 4th Floor, Ilyas Mohammed Khan Estate',
  "Borrower's Address Line 2": 'Road No 1, Banjara Hills',
  "Borrower's City": 'Hyderabad',
  "Borrower's State": 'Telangana',
  "Borrower's PIN Code": '500034',
  "Borrower's Mobile": '9849022028',
  "Borrower's Account Number": '1983201000162',
  'Facility / Loan Activation / Sanction Date': new Date(Date.UTC(2025, 10, 20)),
  'Sanctioned Amount/ Notional Amount of Contract': 5000000,
  'Credit Type': 'Unsecured business loan',
  'Repayment Frequency': 'Monthly',
  'Current Balance / Limit Utilized (Only Principal Outstanding)': 896577,
  'Asset Classification': 'Standard',
  'Amount Overdue / Limit Overdue': 0,
  'Account Status': 'Open',
  'Wilful Default Status': 'No',
  'Relationship Type': 'Promoter Director',
  "Related Person's Name": 'Maddala Veera Srinivasa Rao',
  "Related Person's Gender": 'Male',
  "Related Person's Date of Birth": new Date(Date.UTC(1968, 0, 1)),
  "Related Person's PAN": 'ABOPS9467L',
  "Related Person's Address Line 1": 'Flat No 301, Shanti Kuteer Womens Co-operative Housing Society',
  "Related Person's Address Line 2": 'Road No 2, Jubilee Hills, Khairatabad',
  "Related Person's City": 'Hyderabad',
  "Related Person's State": 'Telangana',
  "Related Person's PIN Code": '500045',
  "Related Person's Landline STD Code": '040',
  "Related Person's Landline Number": '43728111',
  'Guarantor Type#1': 'Resident Indian Individual',
  'Full Name (if individual)#1': 'Viswanath Kompella',
  "Guarantor's Date of Birth#1": new Date(Date.UTC(1967, 11, 2)),
  "Guarantor's PAN#1": 'AEOPK0077P',
  "Guarantor's Gender#1": 'Male',
  "Guarantor's Address Line 1#1": 'Plot No 76-78, Balamrai House Building Society',
  "Guarantor's Address Line 2#1": '6th Cross, Mahendra Hills East, Maredpally',
  "Guarantor's City#1": 'Secunderabad',
  "Guarantor's State#1": 'Telangana',
  "Guarantor's PIN Code#1": '500026',
};

describe('Commercial Master Sheet split-address template', () => {
  it('builds a Master Sheet the converter reads by header, with dropdowns and checks on the data rows', async () => {
    const wb = await buildCommercialMasterTemplate();
    const ws = wb.getWorksheet('Master Sheet')!;
    expect(ws.getCell(HEADER_ROW, 1).value).toBe("Borrower's Name");
    const model = (ws as unknown as { dataValidations: { model: Record<string, ExcelJS.DataValidation> } }).dataValidations.model;
    const state = COLUMNS.findIndex((c) => c.header === "Borrower's State") + 1;
    const stateCol = ws.getColumn(state).letter;
    expect(model[`${stateCol}${FIRST_DATA_ROW}:${stateCol}1010`]?.type).toBe('list');
    const acct = ws.getColumn(COLUMNS.findIndex((c) => c.header === "Borrower's Account Number") + 1).letter;
    expect(model[`${acct}${FIRST_DATA_ROW}:${acct}1010`]?.formulae[0]).toMatch(/^AND\(COUNTIF\(/);
  });

  it('converts a filled template with no errors or warnings, every address part in its own field', async () => {
    const buffer = await filledTemplate([
      VIRINCHI,
      {
        ...VIRINCHI,
        "Borrower's Name": 'BLUE CLOUD SOFTECH SOLUTIONS LIMITED',
        "Borrower's PAN": 'AAJCA4880A',
        "Borrower's Address Line 1": 'Plot No 38, 5th Floor, Software Units Layout',
        "Borrower's Address Line 2": 'Hitech City, Madhapur',
        "Borrower's District": 'Rangareddy',
        "Borrower's PIN Code": '500081',
        "Borrower's Account Number": '923020008159762',
        'Credit Type': 'ARC - Secured Loan (refer Annex. B for validations)',
        'Guarantor Type#1': 'Business Entity Registered in India',
        'Full Name (if individual)#1': '',
        'Guarantor Entity Name (if company)#1': 'ITTB SOFTWARE PRIVATE LIMITED',
        "Guarantor's PAN#1": 'AAGCI7512L',
        "Guarantor's Gender#1": '',
        "Guarantor's Date of Birth#1": '',
        "Guarantor's City#1": 'Hyderabad',
        "Guarantor's PIN Code#1": '500073',
        'Guarantor Type#2': 'Resident Indian Individual',
        'Full Name (if individual)#2': 'Tejesh Kumar Kodali',
        "Guarantor's PAN#2": 'ABZPK0052E',
        "Guarantor's Gender#2": 'Male',
        "Guarantor's Address Line 1#2": 'Flat No C 408, Jayabheri Orange County',
        "Guarantor's Address Line 2#2": 'Financial District, Gachibowli',
        "Guarantor's City#2": 'Hyderabad',
        "Guarantor's District#2": 'Rangareddy',
        "Guarantor's State#2": 'Telangana',
        "Guarantor's PIN Code#2": '500032',
        "Guarantor's Mobile#2": '9966099999',
      },
    ]);
    const result = await convert(buffer, commercialUcrfFlatV310, META);
    expect(result.report.errors.map((e) => e.message)).toEqual([]);
    expect(result.report.warnings.map((w) => w.message)).toEqual([]);
    const f = commercialUcrfFlatV310;
    const out = result.outputText!;

    const as = linesOf(out, 'AS');
    expect(as).toHaveLength(2);
    const at = (line: string[], tag: string, key: string) => line[tokenIndex(f, tag, key)];
    expect(at(as[0]!, 'AS', 'addressLine1')).toBe('8-2-672/5/6, 4th Floor, Ilyas Mohammed Khan Estate');
    expect(at(as[0]!, 'AS', 'addressLine2')).toBe('Road No 1, Banjara Hills');
    expect(at(as[0]!, 'AS', 'cityTown')).toBe('Hyderabad');
    expect(at(as[0]!, 'AS', 'district')).toBe('Hyderabad');
    expect(at(as[0]!, 'AS', 'stateCode')).toBe('36');
    expect(at(as[0]!, 'AS', 'pinCode')).toBe('500034');
    expect(at(as[0]!, 'AS', 'mobileNumber')).toBe('9849022028');
    expect(at(as[1]!, 'AS', 'district')).toBe('Rangareddy');

    // Landline goes to the telephone fields, not Mobile.
    const rs = linesOf(out, 'RS')[0]!;
    expect(at(rs, 'RS', 'rsMobile')).toBe('');
    expect(at(rs, 'RS', 'rsTelAreaCode')).toBe('040');
    expect(at(rs, 'RS', 'rsTelNumber')).toBe('43728111');
    expect(at(rs, 'RS', 'rsAddressLine2')).toBe('Road No 2, Jubilee Hills, Khairatabad');

    // Credit type descriptions from the template's dropdown resolve to their codes.
    const cr = linesOf(out, 'CR');
    expect(at(cr[0]!, 'CR', 'creditType')).toBe('5000');
    expect(at(cr[1]!, 'CR', 'creditType')).toBe('9013');

    // Guarantor blocks: one person, then a company + a person on the second borrower.
    const gs = linesOf(out, 'GS');
    expect(gs.map((g) => at(g, 'GS', 'gsFullName'))).toEqual(['Viswanath Kompella', 'ITTB SOFTWARE PRIVATE LIMITED', 'Tejesh Kumar Kodali']);
    expect(at(gs[0]!, 'GS', 'gsCity')).toBe('Secunderabad');
    expect(at(gs[0]!, 'GS', 'gsAddressLine2')).toBe('6th Cross, Mahendra Hills East, Maredpally');
    expect(at(gs[1]!, 'GS', 'gsStateCode')).toBe('36'); // blank State -> PIN circle
    expect(at(gs[2]!, 'GS', 'gsDistrict')).toBe('Rangareddy');
    expect(at(gs[2]!, 'GS', 'gsMobile')).toBe('9966099999');
  });

  it('flags a PIN from another state and a City that holds the locality', async () => {
    const buffer = await filledTemplate([
      { ...VIRINCHI, "Borrower's City": 'Hitech City Madhapur Hyderabad', "Borrower's State": 'Andhra Pradesh' },
    ]);
    const result = await convert(buffer, commercialUcrfFlatV310, META, { allowWarnings: true });
    const warnings = result.report.warnings.map((w) => w.message);
    expect(warnings).toContain(
      'Borrower address: PIN 500034 belongs to Telangana (36) but the state is Andhra Pradesh (02). Correct the PIN or the state.',
    );
    expect(warnings.some((m) => /City "Hitech City Madhapur Hyderabad" looks like it includes the locality/.test(m))).toBe(true);
    const flagged = result.report.warnings.find((w) => /PIN 500034/.test(w.message))!;
    expect(flagged.column).toBe(ws_col("Borrower's Address Line 1"));
  });
});

function ws_col(header: string): string {
  let n = COLUMNS.findIndex((c) => c.header === header) + 1;
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

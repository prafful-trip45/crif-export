import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import type { FileMeta } from '../packages/core/src/core/types.js';
import { commercialUcrfFlat, commercialUcrfFlatV310 } from '../packages/core/src/formats/commercial-ucrf-flat.js';

/**
 * Real-world Commercial "Master Sheet" -> CRIF Commercial UCRF .txt + workbook report.
 *
 * Source pair: training-references/crif-reporting-io/
 *   in : client-commercial-data-input-1.xlsx ("Master Sheet" — one flat borrower row)
 *   out: client-commercial-data-input-1-output-file.txt
 *
 * The flat row explodes into HD/BS/AS/RS/CR/GS/SS/CD/TS (empty GS/SS/CD filler rows
 * are always emitted, mirroring the accountant working file). Three values diverge
 * from the hand-made client golden (all confirmed intentional):
 *   - Credit Type: we MAP the input ("Aggregation…" -> 5200, or code 300 passthrough)
 *     rather than the accountant's blanket 5200.
 *   - RS line1: golden keeps a trailing ", "; we trim it.
 *   - CR wilful-default DATE: golden stamps "0" in a date slot; we leave it blank.
 * The client golden also collapses the empty GS/SS/CD lines; we keep them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fix = (f: string) => join(here, 'fixtures/commercial-flat', f);

const META: FileMeta = {
  memberId: 'NBFCHE3014',
  reportingDate: new Date(Date.UTC(2026, 0, 31)), // 31012026
  creationDate: new Date(Date.UTC(2026, 2, 26)), // 26032026
};

describe('Commercial UCRF flat (Master Sheet) golden', () => {
  it('explodes the flat row into HD/BS/AS/RS/CR/TS (segments emitted only when populated)', async () => {
    const buf = readFileSync(fix('input-corrected.xlsx'));
    const result = await convert(buf, commercialUcrfFlat, META);

    expect(result.report.errors).toEqual([]);
    const out = result.outputText!.split('\r\n');

    expect(out[0]).toBe('HD|NBFCHE3014||26032026|31012026|01|');
    expect(out[1]).toBe('BS|HO||APL Infotech Limited||||AACCA3994L|||||12|06|06|||||||||||||');
    // "<street>, <City> - <PIN>. COUNTRY" form (no state name in the text) -> Line 1 is
    // the street portion; District holds the CITY (Mumbai), state only drives the code.
    expect(out[2]).toBe(
      "AS|01||D' Building, Shivsagar Estate, 6th Floor, Dr. Annie Besant Road,Worli|||Mumbai|Mumbai|20|400018|079|||||||",
    );
    expect(out[3]).toBe(
      'RS||2|51||||Mr|HEMANT KUMAR RUIA|01|||24021958|AADPR8349A||||||||||||Mimraj Building, 405, Kalbadevi Road|||Mumbai|Mumbai|20|400002|079|2222015336||||||',
    );
    // Wilful-default DATE slot is a literal "0" (matches the client golden).
    expect(out[4]).toBe(
      'CR|24020500002081||28062010|120000000|INR|5200||05|120000000|94510000||||0001||0|||||||||01|||||||||0|0|00|||||||',
    );
    // No guarantor / security / cheque data on this row -> no GS/SS/CD filler lines.
    expect(out[5]).toBe('TS|1|1|');
    expect(result.outputText!.endsWith('TS|1|1|\r\n')).toBe(true);
  });

  it('matches the client golden after applying the one documented divergence', async () => {
    const buf = readFileSync(fix('input-corrected.xlsx'));
    const golden = readFileSync(fix('golden-output.txt')).toString('latin1');
    const result = await convert(buf, commercialUcrfFlat, META);

    // Documented divergences from the hand-made client golden, now that District=city:
    // trim the RS line-1 trailing comma, leave blank DUNS in RS, and use the CITY (Mumbai) in District.
    const expected = golden
      .replace('Kalbadevi Road,  |', 'Kalbadevi Road|')
      .replace('RS|999999999|', 'RS||')
      .replaceAll('Mumbai|Maharashtra|20', 'Mumbai|Mumbai|20');

    expect(result.outputText!).toBe(expected);
  });

  it('builds the multi-sheet workbook report (populated segments + sorting)', async () => {
    const buf = readFileSync(fix('input-corrected.xlsx'));
    const result = await convert(buf, commercialUcrfFlat, META, { report: true });
    expect(result.reportWorkbook).toBeInstanceOf(Buffer);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.reportWorkbook! as unknown as ArrayBuffer);
    // One sheet per format segment (GS/SS/CD sheets exist but are empty this row).
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'HD', 'BS', 'AS', 'RS', 'CR', 'GS', 'SS', 'CD', 'TS', 'sorting',
    ]);

    // The sorting sheet lists every record in upload order with its Final Formula.
    const sorting = wb.getWorksheet('sorting')!;
    const tags = (sorting.getColumn(3).values as unknown[]).slice(2).filter(Boolean);
    expect(tags).toEqual(['HD', 'BS', 'AS', 'RS', 'CR', 'TS']);
    // The HD Final Formula equals the .txt header line.
    expect(sorting.getCell('D2').value).toBe('HD|NBFCHE3014||26032026|31012026|01|');
  });

  it('sample 2: header from flags, Credit Type code 300 passthrough (not the accountant 5200)', async () => {
    const buf = readFileSync(fix('input-2.xlsx'));
    const result = await convert(buf, commercialUcrfFlat, {
      memberId: 'NBF0000806',
      reportingDate: new Date(Date.UTC(2026, 2, 15)), // 15032026
      creationDate: new Date(Date.UTC(2026, 2, 26)), // 26032026
    });

    expect(result.report.errors).toEqual([]);
    const out = result.outputText!.split('\r\n');
    expect(out[0]).toBe('HD|NBF0000806||26032026|15032026|01|');
    expect(out[4]).toBe(
      'CR|24020500002081||28062010|120000000|INR|300||05|120000000|94510000||||0001||0|||||||||01|||||||||0|0|00|||||||',
    );
    expect(out[5]).toBe('TS|1|1|');
  });

  it('reads Member ID / Reporting / Creation date from the Master Sheet header cells (overriding flags)', async () => {
    // Fill B5/B6/B7 in memory and pass deliberately-wrong flags; the sheet must win.
    const src = new ExcelJS.Workbook();
    await src.xlsx.load(readFileSync(fix('input-2.xlsx')) as unknown as ArrayBuffer);
    const ws = src.getWorksheet('Master Sheet')!;
    ws.getCell('B5').value = 'NB12345001';
    ws.getCell('B6').value = '15032026';
    ws.getCell('B7').value = '26032026';
    const written = await src.xlsx.writeBuffer();
    const buf = new Uint8Array(written as ArrayBuffer).buffer;

    const result = await convert(buf, commercialUcrfFlat, {
      memberId: 'FLAG_SHOULD_LOSE',
      reportingDate: new Date(Date.UTC(2000, 0, 1)),
      creationDate: new Date(Date.UTC(2000, 1, 2)),
    });
    expect(result.outputText!.split('\r\n')[0]).toBe('HD|NB12345001||26032026|15032026|01|');
  });

  /**
   * Portal regression (15 Jul 2026): all 73 records of the 9-July submission were
   * rejected with "RS.gender ... not as per the catalogue value". The sheet's dropdown
   * emits the CRIF CODE ("01"/"02"), but the gender map was keyed on the LABEL
   * ("male"/"female") alone, so every lookup missed and emitted blank — taking the
   * courtesy prefix with it. Gender now resolves through buildLegend like every other
   * coded column (code passthrough + number + label).
   */
  it('maps gender from the sheet code ("01"/"02"), not just the label', async () => {
    const buf = readFileSync(
      join(here, '../training-references/crif-reporting-io/NEW_CIC Commercial Master Sheet_09.07.2026 - Copy.xlsx'),
    );
    // allowWarnings: this sheet also carries unrelated data defects (no Registered
    // Office address, shifted guarantor block) that now correctly block the write.
    // We're asserting the ENCODING here, so bypass the gate to inspect the segments.
    const result = await convert(
      buf,
      commercialUcrfFlatV310,
      { memberId: 'NB89580001', reportingDate: new Date(Date.UTC(2026, 6, 15)), creationDate: new Date(Date.UTC(2026, 6, 9)) },
      { allowWarnings: true },
    );

    const rs = result.outputText!.split('\r\n').filter((l) => l.startsWith('RS|'));
    expect(rs).toHaveLength(73);
    // Not one blank gender — that blank is exactly what the portal rejected.
    expect(rs.filter((l) => l.split('|')[9] === '')).toHaveLength(0);
    // Real per-row values, not a constant: a male and a female row from the sheet.
    expect(rs[0]!.split('|').slice(7, 10)).toEqual(['MR', 'Sanjay Nirmal Yadav', '01']);
    expect(rs[3]!.split('|').slice(7, 10)).toEqual(['MS', 'Kaveri Deepak Patil', '02']);
  });

  /**
   * Portal regression (15 Jul 2026): ~30 records rejected with "RS.stateunionTerritory
   * ... does not contain a valid catalogue code". The V3.10 catalogue name for code 08 is
   * the merged "Dadra and Nagar Haveli and Daman and Diu", but sheets write the short
   * pre-merger forms with an ampersand ("Dadra & Nagar Haveli", "dadra& nagar haveli").
   * The needle was matched literally, so every "&" spelling missed and emitted blank.
   * State matching now folds "&"->"and" and ignores separators on both sides.
   */
  it('resolves state codes across "&"/"and"/spacing spelling variants', async () => {
    const buf = readFileSync(
      join(here, '../training-references/crif-reporting-io/NEW_CIC Commercial Master Sheet_09.07.2026 - Copy.xlsx'),
    );
    const result = await convert(
      buf,
      commercialUcrfFlatV310,
      { memberId: 'NB89580001', reportingDate: new Date(Date.UTC(2026, 6, 15)), creationDate: new Date(Date.UTC(2026, 6, 9)) },
      { allowWarnings: true }, // see above — asserting encoding, not this sheet's data quality
    );
    const lines = result.outputText!.split('\r\n');

    // Every borrower address resolves to a state code.
    expect(lines.filter((l) => l.startsWith('AS|') && l.split('|')[8] === '')).toHaveLength(0);

    // The ampersand/spacing spellings this sheet uses must all resolve. Asserting on the
    // CODES rather than a blank-count: this reference file is edited by the client between
    // batches, so a hardcoded count breaks on data churn instead of on a real regression.
    const rsCodes = lines.filter((l) => l.startsWith('RS|')).map((l) => l.split('|')[30]);
    expect(new Set(rsCodes.filter(Boolean))).toEqual(new Set(['08', '09', '11', '33']));
    // Any row still blank must be one that genuinely names no state — never a spelling
    // variant we failed to read. (A state name we can't parse would be the regression.)
    const rsBlank = lines.filter((l) => l.startsWith('RS|') && l.split('|')[30] === '');
    for (const l of rsBlank) {
      expect(l, 'blank state on a row that DOES name a known state = parser regression')
        .not.toMatch(/gujarat|uttar\s*pradesh|daman|nagar haveli/i);
    }
  });

  it('folds state spelling variants to the right catalogue code', async () => {
    const mk = async (addr: string) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Master Sheet');
      ws.addRow([
        "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
        'Business/ Industry Type', "Borrower's Address with PIN Code", "Borrower's Contact No.",
        "Borrower's Account Number", 'Facility / Loan Activation / Sanction Date',
        'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
        'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
      ]);
      ws.addRow(['T Ltd', 'AAAAA1111A', '30', '03', '06', addr, '9999999999', 'A1',
        '01012024', '100000', '5000', '5000', '0001', '01']);
      return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;
    };
    const codeFor = async (addr: string) => {
      const r = await convert(await mk(addr), commercialUcrfFlat, META);
      return r.outputText!.split('\r\n').find((l) => l.startsWith('AS|'))!.split('|')[8];
    };

    // Every spelling of the same UT lands on one code...
    expect(await codeFor('X, Vapi, Dadra & Nagar Haveli-396230')).toBe('08');
    expect(await codeFor('X, Vapi, dadra& nagar haveli-396230')).toBe('08');
    expect(await codeFor('X, Vapi, Dadra And Nagar Haveli-396230')).toBe('08');
    expect(await codeFor('X, Sultanpur, Uttarpradesh-228001')).toBe('33');
    // ...and folding must not match a state inside a longer city word ("goa" in "Goalpara").
    expect(await codeFor('Shop 1, Goalpara, Assam-781001')).toBe('04');
  });

  /**
   * Portal regression (15 Jul 2026): rows 14/65 were rejected with "AS.pinCode 577158 ...
   * does not contain a valid catalogue code". The address ends "Gidc Vapi, Gujarat-396195"
   * — the PIN was correct in the sheet. The parser used /(\d{6})\b/, which against the
   * earlier 7-digit run "Plot No-1577158" matched its LAST six digits and invented a
   * Karnataka PIN. The PIN is now the last standalone 6-digit run, never a slice of a
   * longer number.
   */
  it('reads the trailing PIN, not six digits out of a longer plot number', async () => {
    const mk = async (addr: string) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Master Sheet');
      ws.addRow([
        "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
        'Business/ Industry Type', "Borrower's Address with PIN Code", "Borrower's Contact No.",
        "Borrower's Account Number", 'Facility / Loan Activation / Sanction Date',
        'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
        'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
      ]);
      ws.addRow(['T Ltd', 'AAAAA1111A', '30', '03', '06', addr, '9999999999', 'A1',
        '01012024', '100000', '5000', '5000', '0001', '01']);
      return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;
    };
    const pinFor = async (addr: string) => {
      const r = await convert(await mk(addr), commercialUcrfFlat, META, { allowWarnings: true });
      return r.outputText!.split('\r\n').find((l) => l.startsWith('AS|'))!.split('|')[9];
    };

    // The real row-14 address: a 7-digit plot number precedes the true PIN.
    expect(await pinFor('X-Creative Textile Mill, Plot No-1577158, 2Nd Phase,Gidc Vapi, Gujarat-396195')).toBe('396195');
    // Discriminating case: a 7-digit number AFTER the true PIN. "last 6 digits" would slice
    // the plot number; only "last STANDALONE 6-digit run" keeps the real PIN.
    expect(await pinFor('Survey 396230, Khanvel, Plot No 1234567, Gujarat')).toBe('396230');
    // A 6-digit run glued to a 7th digit is not a PIN — no half-match.
    expect(await pinFor('Shop 5, Khanvel, Gujarat 3962301')).toBe('');
    // Plain trailing PIN still works, with and without a preceding number.
    expect(await pinFor('Shop 4, Vapi, Gujarat-396191')).toBe('396191');
    expect(await pinFor('Plot 12345678, Vapi, Gujarat 396191')).toBe('396191');
    // A 5-digit typo is NOT silently padded or half-matched — it stays absent.
    expect(await pinFor('Shop 4, Vapi, Gujarat-96195')).toBe('');
  });

  it('maps gender from a label sheet too (legend accepts code OR label)', async () => {
    const result = await convert(readFileSync(fix('input-corrected.xlsx')), commercialUcrfFlat, META);
    const rs = result.outputText!.split('\r\n').find((l) => l.startsWith('RS|'))!;
    expect(rs.split('|')[9]).toMatch(/^0[123]$/);
  });

  it('rejects a Credit Type that is absent from the lookup sheet', async () => {
    const buf = readFileSync(fix('input-loan-unmatched.xlsx')); // Credit Type = "Loan"
    const result = await convert(buf, commercialUcrfFlat, META);

    const issue = result.report.errors.find((e) => e.fieldKey === 'creditType');
    expect(issue).toBeDefined();
    expect(issue!.rule).toBe('lookup');
    expect(issue!.message).toMatch(/Credit Type "Loan" not found/);
    expect(result.output).toBeUndefined();
  });

  it('rejects a date that is well-formed but not a real calendar date', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master Sheet');
    ws.addRow([
      "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
      'Business/ Industry Type', "Borrower's Address with PIN Code", "Borrower's Contact No.",
      "Borrower's Account Number", 'Facility / Loan Activation / Sanction Date',
      'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
      'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
    ]);
    // 31 February: eight digits, so a shape-only check passes it straight through to a
    // Date field the bureau rejects (V3.10 §7.5 field 4, p.33).
    ws.addRow([
      'First Ltd', 'AAAAA1111A', '30', '03', '06', 'Rampur, Uttar Pradesh 244927', '9999999999',
      'A1', '31022026', '100000', '5000', '5000', '0001', '01',
    ]);
    const buffer = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;
    const result = await convert(buffer, commercialUcrfFlatV310, META, { allowWarnings: true });

    const dateIssue = result.report.errors.find((i) => i.rule === 'date');
    expect(dateIssue).toBeDefined();
    expect(dateIssue!.message).toMatch(/not a real calendar date/);
  });

  it('caps Borrower Name at the 125 characters V3.10 allows', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master Sheet');
    ws.addRow([
      "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
      'Business/ Industry Type', "Borrower's Address with PIN Code", "Borrower's Contact No.",
      "Borrower's Account Number", 'Facility / Loan Activation / Sanction Date',
      'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
      'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
    ]);
    // V3.10 §7.2 field 4 (p.21): max 125, failure outcome "Reject record".
    ws.addRow([
      'A'.repeat(126), 'AAAAA1111A', '30', '03', '06', 'Rampur, Uttar Pradesh 244927',
      '9999999999', 'A1', '01012024', '100000', '5000', '5000', '0001', '01',
    ]);
    const buffer = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;
    const result = await convert(buffer, commercialUcrfFlatV310, META, { allowWarnings: true });

    const lenIssue = result.report.errors.find((i) => i.fieldKey === 'borrowerName' && i.rule === 'length');
    expect(lenIssue).toBeDefined();
    expect(lenIssue!.message).toMatch(/exceeds max 125/);

    // Exactly 125 is fine — the cap is inclusive.
    const ok = new ExcelJS.Workbook();
    const okWs = ok.addWorksheet('Master Sheet');
    okWs.addRow((ws.getRow(1).values as unknown[]).slice(1));
    okWs.addRow(['A'.repeat(125), ...(ws.getRow(2).values as unknown[]).slice(2)]);
    const okBuf = new Uint8Array((await ok.xlsx.writeBuffer()) as ArrayBuffer).buffer;
    const okResult = await convert(okBuf, commercialUcrfFlatV310, META, { allowWarnings: true });
    expect(okResult.report.errors.filter((i) => i.fieldKey === 'borrowerName')).toHaveLength(0);
  });

  it('blames the State column, not the address, when the State cell holds an invalid code', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master Sheet');
    ws.addRow([
      "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
      'Business/ Industry Type', "Borrower's Address with PIN Code", 'STATE CODE',
      "Borrower's Contact No.", "Borrower's Account Number",
      'Facility / Loan Activation / Sanction Date',
      'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
      'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
    ]);
    // The address resolves perfectly well on its own (Ghaziabad + PIN); only the
    // explicit State cell is junk.
    ws.addRow([
      'First Ltd', 'AAAAA1111A', '30', '03', '06', 'No. 4, Ravi Kanta, Ghaziabad - 201002',
      '99', '9999999999', 'A1', '01012024', '100000', '5000', '5000', '0001', '01',
    ]);
    const buffer = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;

    const result = await convert(buffer, commercialUcrfFlatV310, META, {
      allowWarnings: true,
      bypassErrors: true,
    });

    // The finding names the State column and its bad value...
    const stateIssue = result.report.errors.find((i) => i.fieldKey === 'stateCode');
    expect(stateIssue).toBeDefined();
    expect(stateIssue!.rule).toBe('enum');
    expect(stateIssue!.message).toMatch(/State "99" is not a recognised/);

    // ...and does NOT masquerade as an unparseable address, which would send the
    // operator to a cell that is correct.
    expect(result.report.issues.filter((i) => i.rule === 'parse')).toHaveLength(0);
  });

  it('reports every unresolved Master Sheet state up front and never bypasses those parsing errors', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master Sheet');
    ws.addRow([
      "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
      'Business/ Industry Type', "Borrower's Address with PIN Code", "Borrower's Contact No.",
      "Borrower's Account Number", 'Facility / Loan Activation / Sanction Date',
      'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
      'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
    ]);
    for (const name of ['First Ltd', 'Second Ltd']) {
      ws.addRow([
        name, 'AAAAA1111A', '30', '03', '06', 'Unit 7, Unknown Place', '9999999999', 'A1',
        '01012024', '100000', '5000', '5000', '0001', '01',
      ]);
    }
    const buffer = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;

    const result = await convert(buffer, commercialUcrfFlatV310, META, {
      allowWarnings: true,
      bypassErrors: true,
    });

    const stateErrors = result.report.errors.filter(
      (issue) => issue.rule === 'parse' && issue.fieldKey === 'address',
    );
    expect(stateErrors).toHaveLength(2);
    expect(stateErrors.every((issue) => issue.bypassable === false)).toBe(true);
    // §8.5 is State in V3.10 (8.6 is Type of Relationship), and the citation carries
    // the printed page so the operator can open the spec at the right place.
    expect(stateErrors.every((issue) => issue.reference === 'CRIF Commercial UCRF V3.10 §8.5 State, p. 49')).toBe(true);
    expect(result.report.errors.every((issue) => Boolean(issue.reference))).toBe(true);
    expect(result.output).toBeUndefined();
  });
});

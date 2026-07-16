import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';
import type { FileMeta, FormatId } from '../packages/core/src/core/types.js';

/**
 * PRE-ROLLOUT GATE — validate every real-world reference file in
 * training-references/ before shipping a build. Catches the class of bug where
 * the unit goldens pass but a different real customer file breaks (e.g. a
 * renamed tab, a shifted layout, a format that maps by fixed column letters).
 *
 * Three kinds of check, driven by the manifest below:
 *   1. golden  — convert with the file's KNOWN-CORRECT meta and assert the output
 *                matches the paired .txt BYTE-FOR-BYTE.
 *   2. smoke   — convert and assert it produces output with ZERO validation
 *                errors (used where we don't have the exact CRIF-assigned meta to
 *                reproduce the paired output, but the file must still convert).
 *   3. reject  — a deliberately WRONG input that MUST be rejected (throw, or a
 *                report with errors / no output). Guards against silently
 *                producing garbage from malformed data.
 *
 * Keep this manifest in sync with training-references/. The companion
 * /validate-references skill regenerates the file list and flags drift.
 */
const here = dirname(fileURLToPath(import.meta.url));
const REF = join(here, '..', 'training-references', 'crif-reporting-io');
const ref = (f: string) => join(REF, f);

type Check =
  | { kind: 'golden'; input: string; output: string; format: FormatId; meta: FileMeta }
  | { kind: 'smoke'; input: string; format: FormatId; meta: FileMeta }
  | { kind: 'reject'; input: string; format: FormatId; meta: FileMeta; why: string }
  /**
   * 4. known-defects — a REAL customer file that carries data defects the bureau
   *    portal rejects. It must fail our validation for exactly the listed field keys
   *    (a superset is drift worth reviewing; a subset means a rule silently stopped
   *    firing). Distinct from `reject`, which covers deliberately-malformed inputs.
   */
  | { kind: 'known-defects'; input: string; format: FormatId; meta: FileMeta; fields: string[]; why: string };

const META_DEFAULT: FileMeta = {
  memberId: 'NB1234567',
  reportingDate: new Date(Date.UTC(2026, 0, 31)),
  creationDate: new Date(Date.UTC(2026, 2, 26)),
};

const CHECKS: Check[] = [
  // --- byte-exact goldens (proven meta lifted from the dedicated golden specs) ---
  {
    kind: 'golden',
    input: 'client-input-consumer-input-1.xlsx',
    output: 'client-output-consumer-output-1.txt',
    format: 'consumer-ucrf12-flat',
    meta: {
      memberId: '024FP02726', // CRIF-assigned id (replaces the sheet's NB94430001)
      reportingDate: new Date(Date.UTC(2026, 0, 1)), // overridden by sheet D6 = 15042026
      creationDate: new Date(Date.UTC(2026, 3, 17)), // 17042026
    },
  },

  // --- smoke: must convert cleanly (no exact paired meta to byte-reproduce) ---
  // The previously-FAILING file: data on "Sheet1", not "Data Submission Form".
  // This is the regression guard for the sheet-resolution fix.
  { kind: 'smoke', input: 'consumer_input_failing.xlsx', format: 'consumer-ucrf12-flat', meta: META_DEFAULT },
  { kind: 'smoke', input: 'consumer-input-2.xlsx', format: 'consumer-ucrf12-flat', meta: META_DEFAULT },
  { kind: 'smoke', input: 'client-input-commercial-2.xlsx', format: 'commercial-ucrf-flat', meta: META_DEFAULT },
  {
    kind: 'known-defects',
    input: 'Captree_commercial_input.xlsx',
    format: 'commercial-ucrf-flat',
    meta: META_DEFAULT,
    fields: ['relationship'],
    why: 'Relationship Type column is blank for every row; the paired accepted output has it populated on all 19 RS lines, so the sheet is missing data the portal demands.',
  },
  // 1 Jul batch: exercises guarantor (GS) + security (SS) blocks and both guarantor
  // layouts. Smoke-only — the paired .txt outputs are hand-finalized (inconsistent
  // relationship codes / address casing / stray whitespace) so they are NOT byte-
  // reproducible; see the crif-commercial-format skill and COMMERCIAL_FLAT_PIPELINE.md.
  { kind: 'smoke', input: 'commercial_input_1Jul.xlsx', format: 'commercial-ucrf-flat', meta: META_DEFAULT },
  {
    kind: 'known-defects',
    input: 'commercial_input_1Jul_OD_Loan.xlsx',
    format: 'commercial-ucrf-flat',
    meta: META_DEFAULT,
    fields: ['assetClassification', 'relationship'],
    why: 'Hand-finalized OD sheet (see the crif-commercial-format skill): identical rows carry different codes and several rows omit Asset Classification / Relationship entirely.',
  },
  // 31 March + 30 June: very messy real sheets ("-" placeholders, "PVT LTD", natural
  // dates like "04th June 2025", jumbled guarantor cells). Smoke-only — the paired
  // outputs are hand-curated; the value here is that they now convert with ZERO errors.
  { kind: 'smoke', input: 'commercial_input_31March.xlsx', format: 'commercial-ucrf-flat', meta: META_DEFAULT },
  { kind: 'smoke', input: 'commercial_input_30June.xlsx', format: 'commercial-ucrf-flat', meta: META_DEFAULT },
  // 9 Jul NEW_CIC sheet: two borrowers write comma-less addresses with no state name
  // ("…Near Modern English School Vapi 396191") — guards the splitAddress fallback
  // that used to leave Address Line 1 blank (2 validation errors, file not generated).
  {
    kind: 'known-defects',
    input: 'NEW_CIC Commercial Data Master Sheet_09.07.2026.xlsx',
    format: 'commercial-ucrf-flat-v310',
    meta: META_DEFAULT,
    // '' = the borrower-level Registered Office rule (no single field to blame).
    fields: ['', 'assetClassification', 'relationship'],
    why: 'The 9-July batch the portal rejected 73/73 (see training-references/portal-submission-report/). 55 borrowers have no Location Type 01 address; the guarantor block is shifted a column in the source sheet. Must never validate clean again.',
  },
];

const err = (r: any) => (r.report?.issues ?? []).filter((i: any) => i.severity === 'error');

describe('reference-files pre-rollout validation', () => {
  // Every manifest input must exist — a renamed/removed reference is itself a failure.
  for (const c of CHECKS) {
    it(`exists: ${c.input}`, () => {
      expect(existsSync(ref(c.input))).toBe(true);
    });
  }

  for (const c of CHECKS) {
    if (c.kind === 'golden') {
      it(`golden (byte-exact): ${c.input} → ${c.output}`, async () => {
        const result: any = await convert(readFileSync(ref(c.input)), getFormat(c.format), c.meta);
        expect(err(result)).toEqual([]);
        expect(existsSync(ref(c.output))).toBe(true);
        const expected = readFileSync(ref(c.output), 'latin1');
        expect(result.outputText).toBe(expected);
      });
    } else if (c.kind === 'smoke') {
      it(`smoke (0 errors): ${c.input}`, async () => {
        const result: any = await convert(readFileSync(ref(c.input)), getFormat(c.format), c.meta);
        const errors = err(result);
        expect(errors, `validation errors: ${errors.map((e: any) => e.message).join('; ')}`).toEqual([]);
        expect(String(result.outputText ?? '').length).toBeGreaterThan(0);
      });
    } else if (c.kind === 'known-defects') {
      it(`known defects blocked: ${c.input}`, async () => {
        const result: any = await convert(readFileSync(ref(c.input)), getFormat(c.format), c.meta);
        const errors = err(result);
        // The whole point: this file must NOT sail through as it did on 9 July.
        expect(errors.length, `expected ${c.why}`).toBeGreaterThan(0);
        expect(result.output, 'a file with portal-fatal defects must not be written').toBeUndefined();
        // Pin the exact rules; drift in either direction is worth a human look.
        expect([...new Set(errors.map((e: any) => e.fieldKey))].sort()).toEqual([...c.fields].sort());
      });
    }
  }

  // Expanded July-26 template: headers on ROW 1 (not row 10) with extra explicit code
  // columns. Guards dynamic header-row detection + the new column wiring. (This sheet has
  // one deliberately-invalid PAN row, so it isn't a clean-smoke file — convert with
  // allowWarnings and assert the mapping worked.)
  it('reads the expanded July-26 template (row-1 headers + explicit code columns)', async () => {
    const buf = readFileSync(ref('Commercial work for July 26.xlsx'));
    const result: any = await convert(buf, getFormat('commercial-ucrf-flat'), META_DEFAULT, { allowWarnings: true });
    const out: string[] = (result.outputText ?? '').split('\r\n');
    const bs = out.filter((l) => l.startsWith('BS'));
    expect(bs.length).toBe(2); // both borrowers read despite headers on row 1
    // explicit columns wired: DOI, PAN, company-reg, CIN, constitution/cat/industry, class-of-activity
    // ("MSME" -> 03 Micro per V3.10, "Manufacture" -> 01)
    expect(bs[0]).toContain('|01042025|AABCV2179A|5824|U78300KA2024FTC187880|||11|03|01|5046|');
    // "PARTNER" -> 40, "SMALL" -> 04, "Trading" -> 04
    expect(bs[1]).toContain('|40|04|04|5046|');
    // AS: explicit STATE ("Maharashtra" -> code 20; District holds the city, not the state)
    // + Office DUNS (default 999999999) + Location Type ("Registered office" -> 01)
    expect(out.find((l) => l.startsWith('AS'))).toContain('AS|01|999999999|');
    expect(out.find((l) => l.startsWith('AS'))).toContain('|20|');
    // SS: label security type/class -> codes ("Cash" -> 001, "Primary-First charge" -> 01)
    expect(out.find((l) => l.startsWith('SS'))).toBe('SS|50000|INR|001|01|||');
  });

  // V3.10 profile vs the POC-verified 9-July golden. Reproduces it exactly except two
  // known non-reproducible artifacts: an input typo (guarantor name "Manjula" vs the
  // golden's "Manjula HY") and the golden's AS Line-1 dropping "Girinagar" (its own RS/GS
  // keep it). Guards the V3.10 conventions (ME info-type, MS prefix, unpadded GS relType,
  // drawing-power as-entered, blank wilful-date, District=city, Office DUNS, MSME->03).
  it('V3.10 profile reproduces the 9-July golden (modulo input typo + AS Line-1 artifact)', async () => {
    const buf = readFileSync(ref('commercial_input_9July_Final.xlsx'));
    const result: any = await convert(buf, getFormat('commercial-ucrf-flat-v310'), {
      memberId: 'NB51840001',
      reportingDate: new Date(Date.UTC(2026, 5, 30)), // 30062026
      creationDate: new Date(Date.UTC(2026, 6, 9)), // 09072026
    });
    expect(err(result)).toEqual([]);
    const out: string[] = (result.outputText ?? '').split('\r\n');
    expect(out[0]).toBe('HD|NB51840001||09072026|30062026|ME|'); // ME info-type
    expect(out[1]).toBe('BS|HO||MLT CORPORATE SOLUTIONS PVT LTD||||AAQCM0381D|||||11|03|06|60204||||||||||||');
    // District = city (Bengaluru), Office DUNS default, state code 16.
    expect(out[2]).toBe('AS|01|999999999|[#7, Old No. 15/1, 80 ft Road, 2nd Phase, Girinagar|||Bengaluru|Bengaluru|16|560085|079|9900737072||||||');
    expect(out[4]).toBe('CR|1947555888||04062025|3500000|INR|0410||01|0|1922993||||0001||0|||||||||01|||||||||0||00|||||||'); // drawing-power 0, wilful blank
    // One GS, unpadded relType (2), upper-case prefix (MS). Name reflects the input cell.
    expect(out[5]).toBe('GS|999999999|2||||MS|Manjula|02|||20061987|BAEPB5560K|||||||||||[#7, Old No. 15/1, 80 ft Road, 2nd Phase, Girinagar|||Bengaluru|Bengaluru|16|560085|079|||||||');
    expect(out[6]).toBe('TS|1|1|');
  });

  /**
   * Regression for the 15-July portal rejection (73/73 borrowers), replayed against the
   * exact sheet that produced it. See training-references/portal-submission-report/.
   *
   * Both blocking rules are pinned to the counts the source data predicts, so a future
   * change that silently stops emitting either one fails here rather than at the bureau:
   *   - 55 borrowers carry only Location Type 03/04 (no Registered Office) -> portal's
   *     "not a single valid address found" record-reject.
   *   - 18 rows report Wilful Default Status 1 with no classification date (the Master
   *     Sheet merges both CRIF fields into one 0/1 column) -> V3.10 §7.5 field 36.
   * The portal reported 54 address rejects to our 55: it stops at the first fatal reject
   * per borrower, so its counts are a floor, not an exact match.
   */
  it('blocks the 15-July rejection batch: no Registered Office (55) + wilful-default date (18)', async () => {
    const buf = readFileSync(ref('NEW_CIC Commercial Data Master Sheet_09.07.2026.xlsx'));
    const result: any = await convert(buf, getFormat('commercial-ucrf-flat-v310'), META_DEFAULT);
    // Blocking: no output may be generated for a batch the bureau would reject.
    expect(result.output).toBeUndefined();
    const errors = err(result);
    expect(errors.filter((e: any) => e.message.includes('Registered Office'))).toHaveLength(55);
    expect(errors.filter((e: any) => e.message.includes('Wilful Default Status'))).toHaveLength(18);
  });

  // Regression: an expanded template whose header row is NOT the canonical top block, so
  // the fixed B5/B6/B7 header-cell addresses land on DATA (e.g. B6/B7 are PANs). Those
  // must NOT be taken as reporting/creation dates (a non-date there previously crashed
  // formatDdmmyyyy with "getUTCDate is not a function"), and B5 (a column header) must
  // NOT hijack the Member ID.
  it('does not crash when header-cell addresses land on data (member-id/date guard)', async () => {
    const buf = readFileSync(ref('CIC Commercial Data Master Sheet.xlsx'));
    const meta: FileMeta = {
      memberId: 'NB51840001',
      reportingDate: new Date(Date.UTC(2026, 6, 7)), // 07072026
      creationDate: new Date(Date.UTC(2026, 6, 1)), // 01072026
    };
    const result: any = await convert(buf, getFormat('commercial-ucrf-flat-v310'), meta, { allowWarnings: true });
    const out: string[] = (result.outputText ?? '').split('\r\n');
    // HD member id comes from meta, not from B5 ("Borrower's PAN"); dates from meta, not B6/B7
    // PANs. Reporting date 07072026 (7th) derives the cycle code W1.
    expect(out[0]).toBe('HD|NB51840001||01072026|07072026|W1|');
    expect(out.filter((l) => l.startsWith('BS')).length).toBeGreaterThan(0);
  });

  // HD Reporting-cycle code is derived from the reporting date (V3.10). The bureau's
  // reporting date is always one of four fixed points: 9th→W1, 16th→W2, 23rd→W3, and the
  // LAST calendar day of the month→ME (regardless of whether that's the 28/29/30/31).
  it('derives the HD reporting-cycle code from the reporting date (exact + month-end)', async () => {
    const buf = readFileSync(ref('commercial_input_9July_Final.xlsx'));
    // [year, month(0-based), day, expectedCode]
    const cases: Array<[number, number, number, string]> = [
      // exact canonical weekly dates
      [2026, 6, 9, 'W1'], // 09 Jul
      [2026, 6, 16, 'W2'], // 16 Jul
      [2026, 6, 23, 'W3'], // 23 Jul
      // month-end = last day, whatever the month length
      [2026, 6, 31, 'ME'], // Jul has 31
      [2026, 3, 30, 'ME'], // Apr has 30
      [2026, 1, 28, 'ME'], // Feb 2026 (non-leap) has 28
      [2024, 1, 29, 'ME'], // Feb 2024 (leap) has 29
      // a non-last day of a 31-day month is NOT month-end (falls to nearest bucket)
      [2026, 6, 30, 'ME'], // 30th ≥24 → ME by fallback
      [2026, 6, 5, 'W1'], // <9 → W1 by fallback
      [2026, 6, 20, 'W3'], // 17–23 → W3 by fallback
    ];
    for (const [y, mo, day, code] of cases) {
      const r: any = await convert(buf, getFormat('commercial-ucrf-flat-v310'), {
        memberId: 'NB1', reportingDate: new Date(Date.UTC(y, mo, day)), creationDate: new Date(Date.UTC(y, mo, day)),
      }, { allowWarnings: true });
      expect(r.outputText.split('|')[5]).toBe(code); // HD field 6 = reporting cycle
    }
  });

  // --- CATCH WRONG INPUTS: synthetic malformed workbooks must be rejected. ---
  describe('wrong inputs are rejected (not silently mis-converted)', () => {
    const buildWb = async (fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> => {
      const wb = new ExcelJS.Workbook();
      fill(wb.addWorksheet('Sheet1'));
      return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    };

    it('an empty workbook does not yield valid output', async () => {
      const buf = await buildWb(() => {});
      let rejected = false;
      try {
        const r: any = await convert(buf, getFormat('consumer-ucrf12-flat'), META_DEFAULT);
        rejected = err(r).length > 0 || String(r.outputText ?? '').length === 0;
      } catch {
        rejected = true;
      }
      expect(rejected, 'empty workbook should error or produce no output').toBe(true);
    });

    it('a workbook with unrelated columns is rejected by the header-matched commercial format', async () => {
      const buf = await buildWb((ws) => {
        ws.getRow(1).values = ['Foo', 'Bar', 'Baz'];
        ws.getRow(2).values = ['1', '2', '3'];
      });
      let rejected = false;
      try {
        const r: any = await convert(buf, getFormat('commercial-ucrf-flat'), META_DEFAULT);
        rejected = err(r).length > 0 || String(r.outputText ?? '').length === 0;
      } catch (e: any) {
        // The content-based sheet resolver throws a clear "columns not found" error.
        rejected = /not found|columns|sheet/i.test(String(e.message));
      }
      expect(rejected, 'garbage columns should be rejected, not silently converted').toBe(true);
    });

    it('a corrupt (non-xlsx) buffer is rejected', async () => {
      const buf = Buffer.from('this is not a spreadsheet', 'utf8');
      await expect(convert(buf, getFormat('consumer-ucrf12-flat'), META_DEFAULT)).rejects.toBeTruthy();
    });
  });
});

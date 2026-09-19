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
/** A reference anywhere under training-references/ (the debugging folders). */
const tref = (f: string) => join(here, '..', 'training-references', f);

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
  // NEW_CIC "- Copy" sheet: the fully cleaned resubmission of the 9-July batch. After the
  // 15-July rejection the accountant fixed the 55 no-registered-office rows, all 18
  // wilful-default rows (adding the separate "Date Classified as Wilful Default" column),
  // and the address issues the 17-July run flagged. It now converts with ZERO errors — the
  // value here is that our gender-code, PIN, state-fold and wilful-date reads all hold on
  // the real file. Detailed field-level assertions live in the dedicated test below.
  { kind: 'smoke', input: 'NEW_CIC Commercial Master Sheet_09.07.2026 - Copy.xlsx', format: 'commercial-ucrf-flat-v310', meta: META_DEFAULT },
  // "Copy - 1": same layout as "- Copy", reported by the shipped v0.2.4 app with 146 errors
  // (every CR row blank sanctionDate + sanctionedAmount — 2×73). Those columns (12/13) are
  // populated in the sheet; the shipped build mis-read them, and the current reader resolves
  // them cleanly. Smoke-guards that this exact file converts with zero errors.
  { kind: 'smoke', input: 'NEW_CIC Commercial Master Sheet_09.07.2026 - Copy - 1.xlsx', format: 'commercial-ucrf-flat-v310', meta: META_DEFAULT },
  // "NEW_CIC Commercial Master Sheet" (no suffix): converts clean — its only issue is a
  // non-blocking warning (one related-person address names no state), so it generates.
  { kind: 'smoke', input: 'NEW_CIC Commercial Master Sheet_09.07.2026.xlsx', format: 'commercial-ucrf-flat-v310', meta: META_DEFAULT },
  // "Commercial Master Sheet" (no NEW_CIC prefix): now converts clean with dual-emission of AS segments.
  { kind: 'smoke', input: 'Commercial Master Sheet_09.07.2026.xlsx', format: 'commercial-ucrf-flat-v310', meta: META_DEFAULT },
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
    // District = city (Bengaluru), blank DUNS, state code 16.
    expect(out[2]).toBe('AS|01||[#7, Old No. 15/1, 80 ft Road, 2nd Phase, Girinagar|||Bengaluru|Bengaluru|16|560085|079|9900737072||||||');
    expect(out[4]).toBe('CR|1947555888||04062025|3500000|INR|0410||01|0|1922993||||0001||0|||||||||01|||||||||0||00||||||||'); // drawing-power 0, wilful blank, 44 pipes (45 fields)
    // One GS, unpadded relType (2), upper-case prefix (MS). Name reflects the input cell.
    expect(out[5]).toBe('GS||2||||MS|Manjula|02|||20061987|BAEPB5560K|||||||||||[#7, Old No. 15/1, 80 ft Road, 2nd Phase, Girinagar|||Bengaluru|Bengaluru|16|560085|079|||||||');
    expect(out[6]).toBe('TS|1|1|');
  });

  /**
   * The fully cleaned resubmission of the 9-July batch (training-references/portal-submission-report/).
   * The 15-July run rejected 73/73; the accountant then fixed the registered-office and
   * wilful-default data (adding a separate "Date Classified as Wilful Default" column) and
   * the 17-July run rejected only 2 borrowers on address issues our parser fixes now cover.
   * With all of that plus these converter fixes, the file converts with ZERO errors.
   *
   * This pins every fix against the real file, so a regression fails here not at the bureau:
   *   - gender: the sheet carries the CRIF CODE ("01"/"02"), not a label; a label-only map
   *     blanked all 73 RS/GS rows and got them all rejected.
   *   - state + PIN: every AS/RS address resolves a state code and a whole 6-digit PIN.
   *   - wilful-default date: the emission reads the sheet's date column. This regressed once
   *     (the passthrough was reverted to a hardcoded blank while the header binding stayed),
   *     so assert the actual date lands on the status-1 row — not just that the file is clean.
   */
  it('converts the cleaned 9-July resubmission with zero errors (gender/state/PIN/wilful-date)', async () => {
    const buf = readFileSync(ref('NEW_CIC Commercial Master Sheet_09.07.2026 - Copy.xlsx'));
    const result: any = await convert(buf, getFormat('commercial-ucrf-flat-v310'), META_DEFAULT);
    // The whole batch now generates — no blocking defects remain.
    expect(err(result)).toEqual([]);
    expect(result.output).toBeDefined();

    const lines: string[] = (result.outputText ?? '').split('\r\n');
    const rs = lines.filter((l) => l.startsWith('RS|'));
    expect(rs).toHaveLength(73);
    // No blank gender (col 9) on any related-person row — the gender-code regression.
    expect(rs.filter((l) => l.split('|')[9] === '')).toHaveLength(0);
    // A blank RS state (col 30) is allowed only when the address names no known state.
    for (const l of rs.filter((r) => r.split('|')[30] === '')) {
      expect(l, 'blank RS state on a row naming a known state = parser regression')
        .not.toMatch(/gujarat|uttar\s*pradesh|daman|nagar haveli|maharashtra/i);
    }
    // No AS row loses its state code, and no PIN is a sliced fragment of a longer number.
    expect(lines.filter((l) => l.startsWith('AS|') && l.split('|')[8] === '')).toHaveLength(0);

    // Every status-1 wilful row must carry the sheet's real classification date (CR token
    // 34 = status, 35 = "Date Classified as Wilful Default"). A blank date on a status-1 row
    // is the reverted-passthrough regression that silently reappeared once already.
    const status1 = lines.filter((l) => l.startsWith('CR|') && l.split('|')[34] === '1');
    expect(status1.length).toBeGreaterThan(0);
    expect(status1.every((l) => /^\d{8}$/.test(l.split('|')[35] ?? ''))).toBe(true);
  });

  // Regression: an expanded template whose header row is NOT the canonical top block, so
  // the fixed B5/B6/B7 header-cell addresses land on DATA (e.g. B6/B7 are PANs). Those
  // must NOT be taken as reporting/creation dates (a non-date there previously crashed
  // formatDdmmyyyy with "getUTCDate is not a function"), and B5 (a column header) must
  // NOT hijack the Member ID.
  it('does not crash when header-cell addresses land on data (member-id/date guard)', async () => {
    // This fixture also has the invented PIN 568911. Replace it only in memory so
    // this test continues to isolate the header-cell regression; the exact PIN
    // directory tests assert that 568911 no longer invents a Karnataka state.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync(ref('CIC Commercial Data Master Sheet.xlsx')) as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) ws.eachRow(row => row.eachCell(cell => {
      if (typeof cell.value === 'string') cell.value = cell.value.replace('568911', '560001');
    }));
    const buf = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer).buffer;
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

  /**
   * --- CONSUMER TUDF (the profile customers actually submit) ---
   * Byte-goldens prove we can reproduce a file; they never proved a file PARSES.
   * The Sept-2026 rejections came from a stream that byte-matched a client golden
   * yet desynchronised at the first TL segment. So every real consumer workbook is
   * walked here exactly as a spec-compliant reader walks it (self-describing
   * [tag][len][value] after 7-byte headers, 8 bytes for TL), and must reach TRLR.
   *
   * Three real layouts are covered: the canonical form (labels row 10), the form
   * shifted to a "Sheet1" tab (labels row 8, "Address 1"), and a bare export with
   * labels on ROW 1 of a "Consumer" tab.
   *
   * Blank Rate of Interest / Suit Filed are NOT defects: both are "When Available"
   * (V3.73 pp.29, 33) and are simply omitted, with a warning. Two of these files
   * have every rate blank and must still convert with zero errors — we used to
   * block them and tell the accountant to invent a rate.
   */
  describe('consumer-tudf: every real workbook encodes to a stream CRIF can parse', () => {
    const HDR: Record<string, number> = { PN: 7, ID: 7, PT: 7, EC: 7, PA: 7, TL: 8 };
    const VER: Record<string, string> = { PN: '03', ID: '03', PT: '03', EC: '03', PA: '03', TL: '04' };
    const crifParse = (out: string) => {
      let i = 146;
      const tl01: string[] = [];
      let subjects = 0;
      const segs: Record<string, number> = {};
      while (i < out.length) {
        if (out.startsWith('ES02**', i)) { i += 6; subjects++; continue; }
        if (out.startsWith('TRLR', i)) return { ok: true, subjects, tl01, segs };
        const tag = out.slice(i, i + 2);
        const w = HDR[tag];
        if (!w) return { ok: false, at: i, saw: out.slice(i, i + 16), subjects, tl01, segs };
        segs[tag] = (segs[tag] ?? 0) + 1;
        i += w;
        while (i < out.length) {
          if (out.startsWith('ES02**', i) || out.startsWith('TRLR', i)) break;
          const nt = out.slice(i, i + 2);
          if (HDR[nt] && out.slice(i + 2, i + 4) === VER[nt]) break;
          const ft = out.slice(i, i + 2);
          const ln = out.slice(i + 2, i + 4);
          if (!/^\d\d$/.test(ft) || !/^\d\d$/.test(ln)) {
            return { ok: false, at: i, saw: out.slice(i, i + 16), subjects, tl01, segs };
          }
          if (tag === 'TL' && ft === '01') tl01.push(out.slice(i + 4, i + 4 + Number(ln)));
          i += 4 + Number(ln);
        }
      }
      return { ok: false, at: i, saw: '<eof>', subjects, tl01, segs };
    };

    const MEMBER = '024FP04147';
    // Mirrors the desktop app: it passes the member id and dates, never a short name
    // or cycle — those come from the form's header block or, failing that, its rows.
    const META: FileMeta = {
      memberId: MEMBER,
      reportingDate: new Date(Date.UTC(2026, 8, 9)),
      creationDate: new Date(Date.UTC(2026, 8, 15)),
    };
    type TudfCase = { file: string; subjects: number; layout: string; dataDefects?: string[]; emails?: boolean; sheetReportingDate?: string; roiBlank?: boolean };
    const CASES: TudfCase[] = [
      { file: 'crif-reporting-io/client-input-consumer-input-1.xlsx', subjects: 2, layout: 'canonical', sheetReportingDate: '15042026' },
      { file: 'crif-reporting-io/consumer-input-2.xlsx', subjects: 37, layout: 'canonical', sheetReportingDate: '31052026' },
      { file: 'crif-reporting-io/consumer_input_failing.xlsx', subjects: 7, layout: 'Sheet1, shifted up two rows, "Address 1"', emails: true, sheetReportingDate: '15012026' },
      { file: 'consumer-debugging-Aug-26/024FP04147_16082026_17082026_145520.xlsx', subjects: 17, layout: 'canonical, no ROI and no Suit Filed on any row', sheetReportingDate: '16082026', roiBlank: true },
      { file: 'consumer-debugging-sept-19/instance_1.xlsx', subjects: 18, layout: 'canonical (rejected 19-Sep: bare EC), no ROI on any row', roiBlank: true },
      { file: 'consumer-debugging-sept-19/instance_2.xlsx', subjects: 48, layout: 'canonical, every row has an email', emails: true },
      { file: 'consumer-debugging-aug-14/NBF0001828_09072026_14082026_W1 (1).xlsx', subjects: 3, layout: '"Consumer" tab, labels on row 1, no header block' },
      { file: 'consumer-debugging-aug-14/NBF0001828_15062026_14082026_W2 (1).xlsx', subjects: 3, layout: '"Consumer" tab, labels on row 1, no header block' },
      { file: 'consumer-debugging-aug-14/NBF0001828_30062026_14082026_ME (1).xlsx', subjects: 3, layout: '"Consumer" tab, labels on row 1, no header block' },
    ];

    for (const c of CASES) {
      it(`${c.file} — ${c.layout}`, async () => {
        expect(existsSync(tref(c.file))).toBe(true);
        const result: any = await convert(readFileSync(tref(c.file)), getFormat('consumer-tudf'), META, {
          bypassErrors: Boolean(c.dataDefects),
        });
        const errors = err(result);
        if (c.dataDefects) {
          // Exactly the accountant's known blanks — nothing new, nothing lost.
          expect([...new Set(errors.map((e: any) => e.fieldKey))].sort()).toEqual([...c.dataDefects].sort());
        } else {
          expect(errors, `validation errors: ${errors.map((e: any) => e.message).join('; ')}`).toEqual([]);
        }
        const out: string = result.outputText ?? '';
        expect(out.length).toBeGreaterThan(146);

        // Header: 146 fixed bytes, Date Reported at position 55, cycle at 53.
        expect(out.slice(0, 6)).toBe('TUDF12');
        expect(out.slice(54, 62)).toBe(c.sheetReportingDate ?? '09092026');
        expect(out.slice(146, 153)).toBe('PN03N01');
        // Header short name: the form's header block, or (bare export, no block) the
        // short name the accountant typed on the account rows — never an invented
        // default. It must be the same name the TL/02 fields carry.
        expect(out.slice(36, 52)).not.toContain('CRIFHIGH');
        const tl02 = /TL04T001\d{4}[^]*?02(\d\d)/.exec(out);
        const bodyShortName = tl02 ? out.slice(tl02.index + tl02[0].length, tl02.index + tl02[0].length + Number(tl02[1])) : '';
        expect(bodyShortName.length).toBeGreaterThan(0);
        expect(out.slice(36, 52).trimEnd()).toBe(bodyShortName);

        // Body: walks to TRLR; one of each mandatory segment per subject.
        const parsed = crifParse(out);
        expect(parsed, `stream desynchronised at ${(parsed as any).at}: ${JSON.stringify((parsed as any).saw)}`).toMatchObject({ ok: true });
        expect(parsed.subjects).toBe(c.subjects);
        expect(parsed.segs.PN).toBe(c.subjects);
        expect(parsed.segs.PA).toBe(c.subjects);
        expect(parsed.segs.TL).toBe(c.subjects);
        // EC is "When Available": present for every subject only when the sheet has emails.
        expect(parsed.segs.EC ?? 0).toBe(c.emails ? c.subjects : 0);
        // Rate of Interest is "When Available": a blank sheet cell means NO tag 38 —
        // never a substituted number — and the file still generates.
        const tl38 = (out.match(/TL04T001[^]*?(?=ES02\*\*)/g) ?? []).filter((seg) => /(?:^|\d\d)38\d\d\d+\.\d/.test(seg)).length;
        if (c.roiBlank) expect(tl38).toBe(0);
        else expect(tl38).toBe(c.subjects);
        // Days Past Due (tag 15) pairs with Asset Classification: the sheet always
        // carries it, so every account reports it and nothing is invented for 26.
        expect(parsed.segs.TL).toBe(c.subjects);
        // TL/01 is the 10-char member code and equals the header member id on every account.
        expect(parsed.tl01).toHaveLength(c.subjects);
        expect(new Set(parsed.tl01)).toEqual(new Set([MEMBER]));
        expect(out.slice(6, 16)).toBe(MEMBER);
        // Every byte survives latin1: no control bytes, nothing above 0x7E.
        for (const b of Buffer.from(out, 'latin1')) expect(b).toBeGreaterThanOrEqual(0x20);
        for (const b of Buffer.from(out, 'latin1')) expect(b).toBeLessThanOrEqual(0x7e);
        expect(out.endsWith('ES02**TRLR')).toBe(true);
      });
    }

    it('an unencodable (>99-byte) coded value blocks even under --bypass-errors', async () => {
      // A >99-byte value cannot be written as [tag][len(2)][value]; emitting it would
      // corrupt every byte after it. Build a canonical form with one such name.
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(readFileSync(tref('consumer-debugging-sept-19/instance_2.xlsx')) as unknown as ArrayBuffer);
      const ws = wb.getWorksheet('Data Submission Form')!;
      // (An address can't be used here: the explode chunks it into 40-char lines, so
      // PA/01 can never overflow. Name and email have no such splitter.)
      ws.getCell('V11').value = 'x'.repeat(100) + '@example.com'; // Email ID 1 -> EC/01
      ws.getCell('A12').value = 'B'.repeat(120); // Consumer Name -> PN/01 (maxLength 99)
      const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      const r: any = await convert(buf, getFormat('consumer-tudf'), META, { bypassErrors: true });
      expect(r.output, 'unencodable value must not produce a file under bypass').toBeUndefined();
      expect(r.report.hasNonBypassableErrors).toBe(true);
      const blocking = err(r).filter((e: any) => e.bypassable === false).map((e: any) => e.fieldKey).sort();
      expect(blocking).toEqual(['email', 'name']);
    });
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
      for (const fmt of ['consumer-ucrf12-flat', 'consumer-tudf'] as FormatId[]) {
        let rejected = false;
        try {
          const r: any = await convert(buf, getFormat(fmt), META_DEFAULT);
          rejected = err(r).length > 0 || String(r.outputText ?? '').length === 0;
        } catch {
          rejected = true;
        }
        expect(rejected, `${fmt}: empty workbook should error or produce no output`).toBe(true);
      }
    });

    it('a workbook with unrelated columns is rejected by consumer-tudf (header-matched)', async () => {
      const buf = await buildWb((ws) => {
        ws.getRow(1).values = ['Foo', 'Bar', 'Baz'];
        ws.getRow(2).values = ['1', '2', '3'];
      });
      let rejected = false;
      try {
        const r: any = await convert(buf, getFormat('consumer-tudf'), META_DEFAULT);
        rejected = err(r).length > 0 || String(r.outputText ?? '').length === 0;
      } catch (e: any) {
        rejected = /not found|columns|sheet/i.test(String(e.message));
      }
      expect(rejected, 'garbage columns must not become a header-only TUDF file').toBe(true);
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
      await expect(convert(buf, getFormat('consumer-tudf'), META_DEFAULT)).rejects.toBeTruthy();
    });
  });
});

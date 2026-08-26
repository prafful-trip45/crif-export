/**
 * Generates consumer-debug-aug14-report.docx in the training-references/consumer-debugging-aug-14 dir.
 * Run: node scripts/generate-consumer-debug-report.cjs
 *
 * Re-audited 14 Aug 2026 against raw Excel cell data (exceljs parse) and .txt output files.
 * Corrections vs. previous report:
 *   - Error 1 revised: State Code col 25 is "08" in ALL 3 Excel files. W1 .txt shows "RAJASTHAN"
 *     because the engine used to read the Address 1 string (col 24) which embeds the state name.
 *   - Error 3 removed: ME file col 52 (Suit Filed) is "00" in all rows.
 *   - NEW Error 3: Gender enum conflict between consumer-ucrf12-flat.ts and consumer-enums.ts.
 *   - NEW Error 4: STATE_CODE enum in consumer-enums.ts is missing Rajasthan (08).
 *   - Warning 4 (Address) retained. Payment Frequency inconsistency added.
 */
'use strict';

const {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, convertInchesToTwip,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ── helpers ──────────────────────────────────────────────────────────────────

const bold = (text) => new TextRun({ text, bold: true });
const normal = (text) => new TextRun({ text });
const red = (text) => new TextRun({ text, bold: true, color: 'C0392B' });
const orange = (text) => new TextRun({ text, bold: true, color: 'D35400' });
const green = (text) => new TextRun({ text, bold: true, color: '27AE60' });
const blue = (text) => new TextRun({ text, bold: true, color: '1A5276' });
const code = (text) => new TextRun({ text, font: 'Courier New', size: 18 });

const h2 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });

const p = (...runs) => new Paragraph({ children: runs, spacing: { after: 120 } });
const bullet = (...runs) => new Paragraph({ children: runs, bullet: { level: 0 }, spacing: { after: 80 } });

const HR = new Paragraph({
  border: { bottom: { color: 'AAAAAA', space: 1, style: BorderStyle.SINGLE, size: 6 } },
  spacing: { before: 200, after: 200 },
});

// ── table helpers ─────────────────────────────────────────────────────────────

function cell(text, opts = {}) {
  const { bg, bold: isBold, color } = opts;
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold: isBold, color })],
      alignment: AlignmentType.LEFT,
    })],
    shading: bg ? { fill: bg, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function headerRow(labels, bg = '2C3E50') {
  return new TableRow({
    children: labels.map(l => cell(l, { bg, bold: true, color: 'FFFFFF' })),
    tableHeader: true,
  });
}

function dataRow(cells, altBg) {
  return new TableRow({
    children: cells.map((v) => {
      const bg = altBg ? 'F2F4F4' : 'FDFEFE';
      return typeof v === 'object' && v._cell ? v : cell(v, { bg });
    }),
  });
}

function table(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      headerRow(headers),
      ...rows.map((r, i) => dataRow(r, i % 2 === 1)),
    ],
  });
}

// ── document ──────────────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22 },
      },
    },
  },
  sections: [{
    properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.1), right: convertInchesToTwip(1.1) } } },
    children: [

      // ── Title ──────────────────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: 'Consumer UCRF-12 — Error Analysis (Re-audited v2)', bold: true, size: 36, color: '1A252F' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Member: NBF0001828 (KOVIDFIN)  |  Date: 14 August 2026', size: 20, color: '555555' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Re-audit v2: raw Excel cell parse (ExcelJS) + .txt output cross-check', size: 18, italics: true, color: '777777' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),

      HR,

      // ── Files checked ──────────────────────────────────────────────────────
      h2('Files Checked'),
      bullet(bold('W1: '), code('NBF0001828_09072026_14082026_W1 (1).xlsx'), normal(' — Weekly 1  |  Report date: 09 Jul 2026')),
      bullet(bold('W2: '), code('NBF0001828_15062026_14082026_W2 (1).xlsx'), normal(' — Weekly 2  |  Report date: 15 Jun 2026')),
      bullet(bold('ME: '), code('NBF0001828_30062026_14082026_ME (1).xlsx'), normal(' — Month-End  |  Report date: 30 Jun 2026')),
      bullet(bold('TXT outputs: '), code('NBF0001828_09072026_14082026_W1.txt'), normal(', W2.txt, ME.txt')),

      // ── Borrowers ──────────────────────────────────────────────────────────
      h2('Borrowers (3 per file)'),
      table(
        ['Row', 'Consumer Name', 'PAN', 'Date of Birth', 'Account No', 'Gender (col 3)'],
        [
          ['2', 'Naresh Gupta', 'ABXPG5076G', '05021970', 'KFPL-5', '2'],
          ['3', 'AJAY KUMAR PANDYA', 'ADVPP9357P', '02011966', 'KFPL-1', '2'],
          ['4', 'PRADEEP KUMAR PANDYA', 'ADRPP0704E', '11071963', 'KFPL-2', '2'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 200 } }),
      HR,

      // ── Error Summary ──────────────────────────────────────────────────────
      h2('Error & Warning Summary'),
      table(
        ['#', 'Error / Warning', 'W1', 'W2', 'ME', 'Severity', 'Layer'],
        [
          ['1', 'State code emitted as word "RAJASTHAN" in W1 .txt output — engine field mapping bug', '✗ TXT BUG', '✓ OK', '✓ OK', 'HIGH', 'Engine'],
          ['2', 'Mobile — leading space (Ajay Kumar Pandya, col 16)', '✗ ERROR', '✗ ERROR', '✗ ERROR', 'MEDIUM', 'Excel Data'],
          ['3', 'Gender enum inverted in consumer-ucrf12-flat.ts (line 20) vs. spec', 'WARN', 'WARN', 'WARN', 'MEDIUM', 'Engine Code'],
          ['4', 'STATE_CODE enum missing Rajasthan (08) — silent validation bypass', 'WARN', 'WARN', 'WARN', 'LOW', 'Engine Code'],
          ['5', 'Address format inconsistent across W1 / W2 / ME cycles', 'WARN', 'WARN', 'WARN', 'LOW', 'Excel Data'],
          ['6', 'Payment Frequency col 65: Row 2 = "09", Rows 3-4 = "08" across all cycles', 'WARN', 'WARN', 'WARN', 'LOW', 'Excel Data'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 100 } }),
      p(blue('RETRACTION: '), normal('Previous report Error 3 ("Suit Filed blank in ME") is RETRACTED. Raw cell parse confirms col 52 = "00" in ALL rows in all 3 files.')),

      new Paragraph({ text: '', spacing: { after: 200 } }),
      HR,

      // ── Error 1 ────────────────────────────────────────────────────────────
      h2('Error 1 — W1 .txt: State Code Emitted as "RAJASTHAN" (Engine Layer)'),
      p(red('Severity: HIGH (Blocking)'), normal(' | Affected output: W1.txt only — all 3 borrowers | Root cause: Engine field mapping')),
      p(normal('Raw Excel inspection (ExcelJS cell parse) shows '), bold('col 25 (State Code 1) = "08"'), normal(' in ALL three Excel files. The error is NOT in the Excel data. In the W1.txt output the engine writes the literal word "RAJASTHAN" in the state code position. W2.txt and ME.txt correctly emit "08".')),
      p(normal('Most likely cause: For the W1 cycle the engine read the state name from the embedded address text (col 24 contains "... KOTA RAJASTHAN") rather than the dedicated State Code 1 field (col 25). The fix must ensure the engine always reads col 25 directly.')),

      table(
        ['Row', 'Consumer', 'Col 25 Excel', 'W1 .txt State', 'W2 .txt State', 'ME .txt State'],
        [
          ['2', 'Naresh Gupta', '08 (OK)', 'RAJASTHAN (ERROR)', '08 (OK)', '08 (OK)'],
          ['3', 'AJAY KUMAR PANDYA', '08 (OK)', 'RAJASTHAN (ERROR)', '08 (OK)', '08 (OK)'],
          ['4', 'PRADEEP KUMAR PANDYA', '08 (OK)', 'RAJASTHAN (ERROR)', '08 (OK)', '08 (OK)'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 100 } }),
      p(bold('Fix: '), normal('Fix the engine state code field resolver. Always use col 25 (State Code 1) directly — never fall back to parsing the address string. Regenerate and resubmit W1.')),
      p(bold('Cross-Note: '), normal('The STATE_CODE enum in consumer-enums.ts does not include Rajasthan (08) — see Error 4. This may have caused silent validation bypass and the fallback to the full state name.')),

      HR,

      // ── Error 2 ────────────────────────────────────────────────────────────
      h2('Error 2 — Mobile Number: Leading Space (Ajay Kumar Pandya)'),
      p(orange('Severity: MEDIUM'), normal(' | Files: W1, W2, ME — Row 3 only | Column: Telephone No.Mobile (col 16)')),
      p(normal('The mobile number for Ajay Kumar Pandya has a leading space across all 3 files (confirmed by raw ExcelJS cell parse):')),
      bullet(code('" 9829035739"'), normal(' — col 16, row 3 (11 chars — leading space present)')),
      bullet(code('"9587200882"'), normal(' — Naresh Gupta, correct (10 chars, no space)')),
      bullet(code('"9829038739"'), normal(' — Pradeep Kumar Pandya, correct (10 chars, no space)')),
      p(normal('Consumer UCRF-12 is a concatenated no-delimiter format. A leading space shifts all subsequent bytes by 1, corrupting field alignment. In W2.txt this causes the mobile to run into the address: '), code('"982903573930-A, VALLABH NAGAR…"'), normal(' is the visible symptom.')),
      p(bold('Fix: '), normal('Remove the leading space from col 16, row 3 in all 3 Excel files. Correct value: '), code('"9829035739"'), normal(' (10 digits, no prefix).')),

      HR,

      // ── Error 3 ────────────────────────────────────────────────────────────
      h2('Error 3 — Gender Enum Inverted in consumer-ucrf12-flat.ts'),
      p(orange('Severity: MEDIUM'), normal(' | Affects: All 3 files, all rows | Type: Engine code bug')),
      p(normal('All 3 borrowers have Gender code "2" (col 3). Two engine source files define this code differently:')),

      table(
        ['File', 'Code 1 maps to', 'Code 2 maps to'],
        [
          ['consumer-ucrf12-flat.ts line 20', 'Female (WRONG per spec)', 'Male (WRONG per spec)'],
          ['consumer-enums.ts line 3', 'Male (correct)', 'Female (correct)'],
          ['CRIF Consumer UCRF-12 V3.73 Appendix', '1 = Male', '2 = Female'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 100 } }),
      p(normal('The spec defines 1 = Male, 2 = Female. All 3 borrowers coded "2" are Female. consumer-ucrf12-flat.ts has the enum inverted — it maps 1 = Female, 2 = Male — which would incorrectly label Female borrowers as Male in any validation path using that local enum.')),
      p(bold('Fix: '), normal('Correct consumer-ucrf12-flat.ts line 20 to: '), code("const GENDER = { '1': 'Male', '2': 'Female', '3': 'Transgender' }"), normal('. Aligns with spec and consumer-enums.ts.')),

      HR,

      // ── Error 4 ────────────────────────────────────────────────────────────
      h2('Error 4 — STATE_CODE Enum Missing Rajasthan (08) in consumer-enums.ts'),
      p(orange('Severity: MEDIUM'), normal(' | Affects: All 3 files, all rows | Type: Incomplete enum / validation gap')),
      p(normal('The STATE_CODE enum in consumer-enums.ts contains only 8 states and does NOT include Rajasthan (code 08). All 3 borrowers are in Rajasthan. The missing entry means:')),
      bullet(normal('Engine-level enum validation silently passes "08" without verifying it against a known list.')),
      bullet(normal('Any UI dropdown or validation step that uses this enum will not recognise "08" as Rajasthan.')),

      table(
        ['Code', 'State', 'In consumer-enums.ts?'],
        [
          ['27', 'Maharashtra', 'Yes'],
          ['07', 'Delhi', 'Yes'],
          ['29', 'Karnataka', 'Yes'],
          ['33', 'Tamil Nadu', 'Yes'],
          ['09', 'Uttar Pradesh', 'Yes'],
          ['19', 'West Bengal', 'Yes'],
          ['24', 'Gujarat', 'Yes'],
          ['32', 'Kerala', 'Yes'],
          ['08', 'Rajasthan', 'MISSING'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 100 } }),
      p(bold('Fix: '), normal("Add '08': 'Rajasthan' to the STATE_CODE enum in consumer-enums.ts. Ideally extend to all 36 state/UT codes from the CRIF Consumer UCRF-12 Appendix B.")),

      HR,

      // ── Warning 5 ──────────────────────────────────────────────────────────
      h2('Warning 5 — Address Inconsistency Across Cycles'),
      p(normal('Severity: LOW (Data Quality) | Affects: All 3 files')),
      p(normal('The same borrowers have slightly different address strings across submission cycles. No hard bureau rejection, but may cause matching issues or split credit history.')),

      table(
        ['Borrower', 'W1 Address (col 24)', 'W2 Address (col 24)', 'ME Address (col 24)'],
        [
          ['Naresh Gupta', 'KA 10 SABARMATI COLONY...', 'KA-10 SABARMATI COLONY... (hyphen added)', 'KA-10 SABARMATI COLONY... (same as W2)'],
          ['AJAY KUMAR PANDYA', '30 A VALLABH NAGAR KOTA RAJASTHAN', '30-A, VALLABH NAGAR, KOTA RAJASTHAN', '30-A, VALLABH NAGAR, KOTA (RAJASTHAN)'],
          ['PRADEEP KUMAR PANDYA', 'FLAT NO. 20 206 SECOND FLOOR... JAIPUR RAJASTHAN', 'Flat No.-20, ... Jaipur Rajasthan', 'Flat No.-20, ... Jaipur'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 100 } }),
      p(bold('Fix: '), normal('Standardize address to one consistent canonical form across all submission cycles.')),

      HR,

      // ── Warning 6 ──────────────────────────────────────────────────────────
      h2('Warning 6 — Payment Frequency (col 65) Cross-Row Inconsistency'),
      p(normal('Severity: LOW | Affects: All 3 files — Row 2 vs Rows 3-4')),
      p(normal('Payment Frequency (col 65) differs across borrowers within the same file, consistently across all 3 cycles:')),

      table(
        ['Row', 'Consumer', 'Col 65 (all 3 files)', 'Likely Meaning'],
        [
          ['2', 'Naresh Gupta', '"09"', '09 = confirm per CRIF Appendix E'],
          ['3', 'AJAY KUMAR PANDYA', '"08"', '08 = confirm per CRIF Appendix E'],
          ['4', 'PRADEEP KUMAR PANDYA', '"08"', '08 = confirm per CRIF Appendix E'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 100 } }),
      p(normal('All 3 loans are Account Type 05 (Personal Loan). If all share the same repayment schedule the codes should match. Confirm with the lending team whether this difference is intentional (different EMI schedules) or a data-entry error.')),

      HR,

      // ── Retracted finding ─────────────────────────────────────────────────
      h2('RETRACTED — Previous Error 3: Suit Filed Blank in ME File'),
      p(blue('Status: RETRACTED — finding not confirmed by raw data')),
      p(normal('The previous report stated col 52 (Suit Filed / Wilful Default) was blank in the ME file. ExcelJS raw cell parse of the current ME file confirms this field is correctly populated:')),
      bullet(code('"00"'), normal(' — Naresh Gupta, row 2: Suit Filed = 00 (OK)')),
      bullet(code('"00"'), normal(' — AJAY KUMAR PANDYA, row 3: Suit Filed = 00 (OK)')),
      bullet(code('"00"'), normal(' — PRADEEP KUMAR PANDYA, row 4: Suit Filed = 00 (OK)')),
      p(normal('This field is correctly filled in all 3 files. The previous finding was likely due to a visual rendering artefact rather than actual empty cell content.')),

      HR,

      // ── Fields Confirmed OK ────────────────────────────────────────────────
      h2('Fields Confirmed OK (All 3 Files)'),
      table(
        ['Field', 'Values Observed', 'Status'],
        [
          ['PAN Numbers (col 4)', 'ABXPG5076G, ADVPP9357P, ADRPP0704E', 'Valid 10-char PAN'],
          ['Date of Birth (col 2)', '05021970, 02011966, 11071963', 'DDMMYYYY format OK'],
          ['Gender code (col 3)', '2 — all rows', 'Valid code (= Female per canonical spec)'],
          ['Account Type (col 37)', '05 — Personal Loan', 'Valid enum'],
          ['Ownership Indicator (col 38)', '1 — Individual', 'Valid'],
          ['Asset Classification (col 54)', '01 — Standard / Performing', 'Valid'],
          ['PIN Code 1 (col 26)', '324006, 324007, 302019', '6-digit format OK'],
          ['Address Category 1 (col 27)', '02', 'Valid code'],
          ['Residence Code 1 (col 28)', '01', 'Valid code'],
          ['State Code 1 — Excel col 25', '"08" in all 3 files', 'Numeric Rajasthan code in Excel'],
          ['Date Opened (col 39)', '10062026, 26032019, 06082019', 'DDMMYYYY format OK'],
          ['Date Reported (col 42)', '09072026, 15062026, 30062026', 'Cycle dates correct'],
          ['High Credit / Sanctioned Amt (col 43)', '6000000, 9000000', 'Numeric, non-zero'],
          ['Suit Filed / Wilful Default (col 52)', '"00" — all rows, all 3 files', 'No suit filed'],
          ['Member Code (col 34)', 'NBF0001828', 'Consistent across files'],
          ['Member Short Name (col 35)', 'KOVIDFIN', 'Consistent'],
          ['Rate of Interest (col 59)', '18 (Naresh Gupta), 12 (Pandyas)', 'Numeric'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 200 } }),
      HR,

      // ── Action Items ────────────────────────────────────────────────────────
      h2('Action Items'),
      table(
        ['#', 'Layer', 'File(s)', 'Row', 'Column / Location', 'Fix Required'],
        [
          ['1', 'Engine', 'W1.txt (re-generate)', 'All', 'State Code field mapping', 'Fix resolver — read col 25 directly, never fall back to address text. Regenerate W1.'],
          ['2', 'Excel Data', 'W1, W2, ME', 'Row 3', 'Col 16 — Telephone No.Mobile', 'Remove leading space. Correct value: "9829035739" (10 digits).'],
          ['3', 'Engine Code', 'consumer-ucrf12-flat.ts', 'Line 20', 'GENDER enum', "Fix: { '1': 'Male', '2': 'Female', '3': 'Transgender' } to match spec and consumer-enums.ts."],
          ['4', 'Engine Code', 'consumer-enums.ts', 'STATE_CODE', 'Line 48+', "Add '08': 'Rajasthan'. Extend to full 36-state list per CRIF Appendix B."],
          ['5', 'Excel Data', 'W1, W2, ME', 'All rows', 'Col 24 — Address 1', 'Standardize address format consistently across all cycles.'],
          ['6', 'Excel Data', 'W1, W2, ME', 'Row 2 vs 3-4', 'Col 65 — Payment Frequency', 'Confirm "09" vs "08" is intentional with the lending team. Align if not.'],
        ]
      ),

      new Paragraph({ text: '', spacing: { after: 300 } }),

      // ── Footer ──────────────────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: 'Generated by crif-export audit engine  |  14 August 2026  |  Re-audit v2 (raw ExcelJS parse + .txt cross-check)', size: 16, italics: true, color: '999999' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200 },
      }),
    ],
  }],
});

// ── write file ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'training-references', 'consumer-debugging-aug-14', 'Consumer-Error-Report-Aug14.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('Written:', outPath);
}).catch(console.error);

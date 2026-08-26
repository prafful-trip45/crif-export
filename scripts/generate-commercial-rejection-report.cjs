/**
 * Generates Commercial-Rejection-Report-Aug2026.docx in training-references/rejection-august
 * Run: node scripts/generate-commercial-rejection-report.cjs
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

const h1 = (text) => new Paragraph({
  children: [new TextRun({ text, bold: true, size: 28, color: '1A252F' })],
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 300, after: 150 },
});

const h2 = (text) => new Paragraph({
  children: [new TextRun({ text, bold: true, size: 24, color: '2C3E50' })],
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 120 },
});

const p = (...runs) => new Paragraph({ children: runs, spacing: { after: 120 } });
const bullet = (...runs) => new Paragraph({ children: runs, bullet: { level: 0 }, spacing: { after: 80 } });

const HR = new Paragraph({
  border: { bottom: { color: 'BDC3C7', space: 1, style: BorderStyle.SINGLE, size: 6 } },
  spacing: { before: 200, after: 200 },
});

// ── table helpers ─────────────────────────────────────────────────────────────

function cell(text, opts = {}) {
  const { bg, bold: isBold, color, width } = opts;
  const runs = typeof text === 'string' ? [new TextRun({ text, bold: isBold, color })] : text;
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({
      children: runs,
      alignment: AlignmentType.LEFT,
    })],
    shading: bg ? { fill: bg, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
  });
}

function headerRow(labels, bg = '1A5276') {
  return new TableRow({
    children: labels.map(l => cell(l, { bg, bold: true, color: 'FFFFFF' })),
    tableHeader: true,
  });
}

function dataRow(cells, altBg) {
  return new TableRow({
    children: cells.map((v) => {
      const bg = altBg ? 'F4F6F7' : 'FFFFFF';
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

// ── document creation ─────────────────────────────────────────────────────────

async function main() {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
          },
        },
      },
      children: [
        // Title Block
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'CRIF Commercial Bureau Export — Audit & Rejection Report', bold: true, size: 32, color: '1A252F' }),
          ],
          spacing: { after: 60 },
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Accountant & Operations Action Plan | Cycle: June 2026 (W1)', italic: true, size: 22, color: '7F8C8D' }),
          ],
          spacing: { after: 240 },
        }),

        HR,

        // Executive Summary Box
        h2('1. Executive Submission Summary'),
        p(normal('The Commercial Bureau Submission file ('), code('NBF0001828_Commercial_09062026_14082026_222042_W1.txt'), normal(') was processed by the CRIF High Mark portal. Below is the submission summary:')),

        table(
          ['Parameter', 'Value', 'Details'],
          [
            ['Member Name', 'KOVID FINANCE PRIVATE LIMITED', 'Member ID: NBF0001828'],
            ['Reported Cycle Date', '09-06-2026', 'Submission Batch W1'],
            ['Total Input Records', '2 Borrower Records', 'Master Sheet: Commercial Loan - 20260709.xlsx'],
            ['Accepted Records', '1 Record (50.0%)', 'Record 1: ABHAY CONSTRUCTION'],
            ['Rejected Records', '1 Record (50.0%)', 'Record 2: RIDHIRAJ BUILDERS AND PROMOTER LLP'],
          ]
        ),

        HR,

        // Detailed Breakdown per Record
        h2('2. Record-by-Record Analysis'),

        p(bold('Record #1: ABHAY CONSTRUCTION (Account: KFPL-4)')),
        p(
          green('✔ Record Level Status: ACCEPTED BY BUREAU'),
          normal(' — Borrower, Address, Related Person, and Facility segments were successfully loaded.')
        ),
        p(
          orange('⚠ Field-Level Warnings (Non-Blocking):'),
          normal(' Bureau flagged 3 missing/default catalogue fields on the Credit Facility (CR) segment:')
        ),
        bullet(bold('Drawing Power: '), normal('Reported as 0 for Unsecured Business Loan (Credit Type 5000). Bureau expects drawing power to be blank for non-revolving facilities.')),
        bullet(bold('Asset Based Security Coverage: '), normal('Blank in file. Bureau expects code "03" (Unsecured) for unsecured loans.')),
        bullet(bold('Transaction Type Code: '), normal('Blank in file. Bureau expects code "01" (Borrowing/Loan).')),

        p(bold('Record #2: RIDHIRAJ BUILDERS AND PROMOTER LLP (Account: KFPL-3)')),
        p(
          red('✖ Record Level Status: REJECTED BY BUREAU (100% Data Loss)'),
          normal(' — Bureau rejected the entire borrower record.')
        ),
        p(bold('Bureau Error Message: '), red('The Record is rejected as no valid Registered Address found / State Code invalid.')),

        HR,

        // Root Cause & Action Required for Accountant
        h2('3. Action Plan for Accountant & Operations'),

        p(normal('To ensure 100% acceptance on the next submission, please perform the following corrections:')),

        table(
          ['#', 'Issue Identified', 'Excel Cell Location / Value', 'Corrective Action Required'],
          [
            [
              '1',
              'Typo in State Name in Address string (CRITICAL)',
              'Master Sheet Row 10 (Col F):\n"66, First Floor SLC Tower, Amarpali Marg Vaishali Nagar, Jaipur, Rajastha 302021"',
              'Correct "Rajastha" to "Rajasthan" in the Excel address cell. State code 29 cannot be parsed when misspelled.',
            ],
            [
              '2',
              'Drawing Power for Unsecured Loans',
              'Master Sheet Row 9 & 10 (Col M):\nBlank / 0',
              'Leave Drawing Power blank for Term Loans / Unsecured Business Loans (Credit Type 5000). Only populate for Overdrafts / Cash Credit.',
            ],
            [
              '3',
              'Security Coverage Code',
              'Master Sheet Security Block:\nBlank',
              'For Unsecured Business Loans, security coverage should be identified as "Unsecured" (Code 03).',
            ],
            [
              '4',
              'Transaction Type Code',
              'System Auto-fill',
              'Software exporter will automatically tag standard loans with Transaction Type "01" (Borrowing/Loan).',
            ],
          ]
        ),

        HR,

        // System Software Fixes Summary
        h2('4. Exporter System Improvements'),
        p(normal('The CRIF Exporter software is also being updated with automated safeguards to prevent future human typos:')),
        bullet(bold('Fuzzy State Name Matching: '), normal('Added alias for "rajastha" -> "Rajasthan" (Code 29) so single-letter typos are automatically resolved.')),
        bullet(bold('Non-Revolving Drawing Power Handling: '), normal('Automatic suppression of Drawing Power for non-revolving credit types (5000, 410, 420).')),
        bullet(bold('Catalogue Defaults: '), normal('Automatic emission of default Security Coverage (03) and Transaction Type (01) when left blank.')),

        HR,

        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Report generated automatically by CRIF Bureau Exporter Audit Tool.', italic: true, size: 18, color: '95A5A6' }),
          ],
        }),
      ],
    }],
  });

  const outPath = path.join(__dirname, '../training-references/rejection-august/Commercial-Rejection-Audit-Report-Aug2026.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log('Successfully generated DOCX report at:', outPath);
}

main().catch(console.error);

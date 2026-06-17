/**
 * Generate input Excel templates (one sheet per segment) for every registered
 * format. Each sheet has: A/c No. | Flag | <field labels...>. Members fill rows
 * and feed the workbook back to the converter.
 *
 * Run: npm run make:templates
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { FORMATS } from '../packages/core/src/formats/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'templates');
mkdirSync(outDir, { recursive: true });

for (const format of Object.values(FORMATS)) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'crif-export';

  const inst = wb.addWorksheet('Instructions');
  inst.addRow([`${format.label} — input template`]);
  inst.addRow(['One sheet per segment. Fill data rows under the header.']);
  inst.addRow(['A/c No. = borrower join key (same value links all of a borrower\'s segments).']);
  inst.addRow(['Flag = segment order within the borrower (lower first). Pre-filled per sheet.']);
  inst.getRow(1).font = { bold: true, size: 14 };

  for (const seg of format.body) {
    const ws = wb.addWorksheet(seg.sheet ?? seg.tag);
    const dataFields = seg.fields.filter((f) => f.key !== '_tag' && !f.key.startsWith('_'));
    const headers = ['A/c No.', 'Flag', ...dataFields.map((f) => f.label ?? f.key)];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    });
    // Mark mandatory fields with a note row hint via comment.
    dataFields.forEach((f, i) => {
      const mandatory = typeof f.mandatory === 'function' ? true : f.mandatory;
      if (mandatory) headerRow.getCell(3 + i).font = { bold: true, color: { argb: 'FFB22222' } };
    });
    // Pre-fill Flag default for convenience.
    ws.getColumn(2).numFmt = '0';
    ws.columns.forEach((col) => {
      col.width = 18;
    });
  }

  const file = join(outDir, `${format.id}-input.xlsx`);
  await wb.xlsx.writeFile(file);
  console.log(`wrote ${file}`);
}

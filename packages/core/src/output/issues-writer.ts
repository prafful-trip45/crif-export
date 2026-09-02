import ExcelJS from 'exceljs';
import type { ValidationReport, ValidationIssue } from '../core/result.js';

/**
 * Write a single-sheet, indexed workbook of every validation issue — the thing an
 * accountant fixes against. One row per issue with a stable "#" index, the source
 * spreadsheet Row + Column (the exact cell to edit, including for fields DERIVED from
 * a free-text address), Severity, Field, and the full Message. Errors are listed before
 * warnings so the blocking items are at the top.
 *
 * `column` is the source-cell letter the offending value came from; blank when the
 * issue is a borrower-level cross-segment rule with no single source cell.
 */
export async function writeIssuesWorkbook(report: ValidationReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'crif-export';
  const ws = wb.addWorksheet('Issues');

  const columns = [
    { header: '#', key: 'n', width: 6 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Sheet', key: 'sheet', width: 8 },
    { header: 'Row', key: 'row', width: 6 },
    { header: 'Column', key: 'column', width: 8 },
    { header: 'Cell', key: 'cell', width: 8 },
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Message', key: 'message', width: 90 },
    { header: 'Reference', key: 'reference', width: 58 },
  ];
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'I1' };

  // Errors first (blocking), then warnings; preserve original order within each group.
  const ordered: ValidationIssue[] = [
    ...report.issues.filter((i) => i.severity === 'error'),
    ...report.issues.filter((i) => i.severity !== 'error'),
  ];

  ordered.forEach((i, idx) => {
    // A1-style cell reference when we know both the column and a real (>0) row.
    const cell = i.column && i.rowNumber > 0 ? `${i.column}${i.rowNumber}` : '';
    const row = ws.addRow({
      n: idx + 1,
      severity: i.severity,
      sheet: i.sheet,
      row: i.rowNumber > 0 ? i.rowNumber : '',
      column: i.column ?? '',
      cell,
      field: i.fieldLabel ?? i.fieldKey,
      message: i.message,
      reference: i.reference ?? '',
    });
    row.getCell('message').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('reference').alignment = { wrapText: true, vertical: 'top' };
    if (i.severity === 'error') row.getCell('severity').font = { color: { argb: 'FFC0392B' }, bold: true };
    else row.getCell('severity').font = { color: { argb: 'FFB9770E' } };
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

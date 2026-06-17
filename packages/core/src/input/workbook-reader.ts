import ExcelJS from 'exceljs';
import type { FormatSpec, SegmentSpec } from '../core/types.js';
import { coerceCell, type RawCell } from './coerce.js';
import type { SegmentRow } from './model.js';

/**
 * Column header names treated as the borrower join-key control column.
 * Deliberately narrow: must NOT collide with a real data field like
 * "Account Number" (a CR field), so we only accept the "A/c No." spellings.
 */
const AC_NO_HEADERS = ['a/c no.', 'a/c no', 'acno', 'a/c number', 'borrower id', 'borrower key'];
const FLAG_HEADERS = ['flag'];

/**
 * Read a workbook (one sheet per segment) into flat typed SegmentRows.
 *
 * For each body segment in the format, find the matching sheet (by `sheet`/`tag`),
 * read row 1 as headers, map each header to a FieldSpec by label or key, and
 * coerce data cells. The `A/c No.` column is the borrower join key; `Flag` gives
 * the in-borrower sort order (falling back to the segment's spec `flag`).
 *
 * Formula cells contribute their computed result (`cell.result`), not the formula.
 */
export async function readWorkbook(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
): Promise<SegmentRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const rows: SegmentRow[] = [];
  for (const seg of format.body) {
    const sheetName = seg.sheet ?? seg.tag;
    const ws = findSheet(wb, sheetName);
    if (!ws) continue; // optional segment sheet may be absent
    rows.push(...readSheet(ws, seg));
  }
  return rows;
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const lc = name.toLowerCase();
  return wb.worksheets.find((w) => w.name.toLowerCase() === lc);
}

function readSheet(ws: ExcelJS.Worksheet, seg: SegmentSpec): SegmentRow[] {
  const headerRow = ws.getRow(1);
  const headerMap = new Map<number, string>(); // colIndex -> normalized header
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headerMap.set(col, normalize(String(cellRaw(cell) ?? '')));
  });

  // Resolve which column carries each field, and the control columns.
  const fieldCol = new Map<string, number>(); // fieldKey -> col
  let acNoCol = 0;
  let flagCol = 0;
  for (const [col, header] of headerMap) {
    if (AC_NO_HEADERS.includes(header)) {
      acNoCol = col;
      continue;
    }
    if (FLAG_HEADERS.includes(header)) {
      flagCol = col;
      continue;
    }
    const field = seg.fields.find(
      (f) => normalize(f.label ?? '') === header || normalize(f.key) === header,
    );
    if (field) fieldCol.set(field.key, col);
  }

  const out: SegmentRow[] = [];
  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (isBlankRow(row, headerMap)) continue;

    const acNo = acNoCol ? String(cellRaw(row.getCell(acNoCol)) ?? '').trim() : `row${r}`;
    const flagRaw = flagCol ? cellRaw(row.getCell(flagCol)) : undefined;
    const flag = flagRaw != null && flagRaw !== '' ? Number(flagRaw) : (seg.flag ?? 0);

    const values: Record<string, ReturnType<typeof coerceCell>> = {};
    for (const field of seg.fields) {
      const col = fieldCol.get(field.key);
      const raw = col ? cellRaw(row.getCell(col)) : undefined;
      values[field.key] = coerceCell(field, raw);
    }

    out.push({
      tag: seg.tag,
      sheet: ws.name,
      acNo,
      flag: Number.isFinite(flag) ? flag : (seg.flag ?? 0),
      rowNumber: r,
      values,
    });
  }
  return out;
}

/** Pull the underlying value of a cell, preferring a formula's computed result. */
function cellRaw(cell: ExcelJS.Cell): RawCell {
  const v = cell.value as unknown;
  if (v == null) return undefined;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return o.result as RawCell; // formula cell
    if ('text' in o) return o.text as RawCell; // rich text / hyperlink
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
    }
    if (v instanceof Date) return v;
  }
  return v as RawCell;
}

function isBlankRow(row: ExcelJS.Row, headerMap: Map<number, string>): boolean {
  for (const col of headerMap.keys()) {
    const raw = cellRaw(row.getCell(col));
    if (raw !== undefined && String(raw).trim() !== '') return false;
  }
  return true;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[“”„‘’]/g, '');
}

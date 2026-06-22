import ExcelJS from 'exceljs';
import type { FieldValue, FlatExplodeContext, FormatSpec, SegmentSpec } from '../core/types.js';
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
  // Real-world flat "Master Sheet": one borrower row explodes into many segments.
  if (format.flatExplode) return readFlatExplodeWorkbook(buffer, format);
  // Flat-form formats (one row per consumer) use a dedicated reader.
  if (format.flatInput) return readFlatWorkbook(buffer, format);

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

/**
 * Read a single flat sheet (real CRIF "Data Submission Form"): a label row maps
 * columns to the single body record's field labels, and each subsequent row is
 * one consumer record. Each row becomes its own borrower (acNo = row number).
 */
export async function readFlatWorkbook(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
): Promise<SegmentRow[]> {
  const { sheet, labelRow, firstDataRow } = format.flatInput!;
  const seg = format.body[0]!;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = findSheet(wb, sheet);
  if (!ws) throw new Error(`Input sheet "${sheet}" not found`);

  // Map each label cell -> the field whose label matches.
  const fieldByCol = new Map<number, string>();
  ws.getRow(labelRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = normalize(String(cellRaw(cell) ?? ''));
    const field = seg.fields.find((f) => normalize(f.label ?? '') === header || normalize(f.key) === header);
    if (field) fieldByCol.set(col, field.key);
  });

  const rows: SegmentRow[] = [];
  for (let r = firstDataRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: Record<string, ReturnType<typeof coerceCell>> = {};
    let any = false;
    for (const [col, key] of fieldByCol) {
      const field = seg.fields.find((f) => f.key === key)!;
      const raw = cellRaw(row.getCell(col));
      const v = coerceCell(field, raw);
      values[key] = v;
      if (v !== undefined && String(v).trim() !== '') any = true;
    }
    if (!any) continue; // skip blank rows
    rows.push({ tag: seg.tag, sheet: ws.name, acNo: `r${r}`, flag: seg.flag ?? 0, rowNumber: r, values });
  }
  return rows;
}

/**
 * Read a real-world flat "Master Sheet" where each borrower occupies ONE row with
 * borrower / related-person / guarantor / security / cheque columns side by side,
 * and explode each row into the per-segment records the format declares. All the
 * format-specific mapping (legend codes, address parsing, lookups) lives in the
 * format's `flatExplode.explode` callback; this reader only wires columns + the
 * "Credit Type Code" auxiliary lookup, then collects the produced seeds.
 */
export async function readFlatExplodeWorkbook(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
): Promise<SegmentRow[]> {
  const { sheet, firstDataRow, columns, explode } = format.flatExplode!;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = findSheet(wb, sheet);
  if (!ws) throw new Error(`Input sheet "${sheet}" not found`);

  const lookups = { creditType: readCreditTypeLookup(wb) };

  const colToKey = new Map<number, string>();
  for (const [letter, key] of Object.entries(columns)) colToKey.set(colLetterToNumber(letter), key);

  const rows: SegmentRow[] = [];
  for (let r = firstDataRow; r <= ws.rowCount; r++) {
    const wsRow = ws.getRow(r);
    const input: Record<string, FieldValue> = {};
    let any = false;
    for (const [col, key] of colToKey) {
      const raw = cellRaw(wsRow.getCell(col));
      const v = normalizeRaw(raw);
      input[key] = v;
      if (v !== undefined && String(v).trim() !== '') any = true;
    }
    if (!any) continue; // skip blank rows

    const ctx: FlatExplodeContext = { rowNumber: r, lookups };
    const seeds = explode(input, ctx);
    for (const seed of seeds) {
      rows.push({
        tag: seed.tag,
        sheet: seed.tag,
        acNo: `r${r}`,
        flag: seed.flag,
        rowNumber: r,
        values: seed.values,
        readerIssues: seed.issues,
      });
    }
  }
  return rows;
}

/**
 * Read the file-level header overrides an accountant fills in the flat sheet's top
 * rows (e.g. Member ID / Reporting Date / Creation Date), per `flatExplode.headerCells`.
 * Returns a partial FileMeta; blank cells are omitted so the CLI flag wins.
 */
export async function readFlatHeaderOverrides(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
): Promise<Partial<Record<string, FieldValue>>> {
  const cells = format.flatExplode?.headerCells ?? format.flatInput?.headerCells;
  const sheet = format.flatExplode?.sheet ?? format.flatInput?.sheet;
  if (!cells || !sheet) return {};

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = findSheet(wb, sheet);
  if (!ws) return {};

  const out: Record<string, FieldValue> = {};
  for (const [addr, key] of Object.entries(cells)) {
    const raw = cellRaw(ws.getCell(addr));
    const v = normalizeRaw(raw);
    if (v === undefined || String(v).trim() === '') continue;
    if (key === 'reportingDate' || key === 'creationDate') {
      const d = coerceCell({ key, type: 'date-ddmmyyyy', mandatory: false }, v as RawCell);
      out[key] = d;
    } else {
      out[key] = String(v).trim();
    }
  }
  return out;
}

/**
 * Read the "Credit Type Code" auxiliary sheet (Description -> Code), if present.
 * Keys are normalized (lowercased, collapsed whitespace) for tolerant matching.
 */
function readCreditTypeLookup(wb: ExcelJS.Workbook): Map<string, string> {
  const map = new Map<string, string>();
  const ws = findSheet(wb, 'Credit Type Code');
  if (!ws) return map;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const code = String(cellRaw(row.getCell(2)) ?? '').trim(); // col B = Code
    const desc = normalize(String(cellRaw(row.getCell(3)) ?? '')); // col C = Description
    if (code && desc && /^\d+$/.test(code)) map.set(desc, code);
  });
  return map;
}

/** A-only-ish raw value: Dates stay Date, numbers stay number, else trimmed string. */
function normalizeRaw(raw: RawCell): FieldValue {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return String(raw);
  return String(raw).trim();
}

/** "A" -> 1, "Z" -> 26, "AA" -> 27, ... */
function colLetterToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
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

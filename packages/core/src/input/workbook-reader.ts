import ExcelJS from 'exceljs';
import type { FieldSpec, FieldValue, FileMeta, FlatExplodeContext, FormatSpec, SegmentSpec } from '../core/types.js';
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
  meta?: FileMeta,
): Promise<SegmentRow[]> {
  // Real-world flat "Master Sheet": one borrower row explodes into many segments.
  if (format.flatExplode) return readFlatExplodeWorkbook(buffer, format, meta);
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
 *
 * The configured `sheet` / `labelRow` are HINTS, not hard requirements: real
 * accountant files routinely rename the tab ("Sheet1") and shift the form up or
 * down a few rows. So we (1) fall back to the workbook's single/first sheet when
 * the named tab is absent, and (2) auto-detect the label row by scanning for the
 * row whose cells match the most body-field labels. `firstDataRow` follows from
 * the detected label row. This keeps the canonical reference file working while
 * tolerating renamed/reshuffled variants.
 */
export async function readFlatWorkbook(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
): Promise<SegmentRow[]> {
  const { sheet, labelRow } = format.flatInput!;
  const seg = format.body[0]!;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = resolveSheet(wb, sheet);

  // Locate the column-label row by best match against the body field labels,
  // preferring the configured `labelRow` when it ties. The data starts the row
  // after the labels.
  const detectedLabelRow = detectLabelRow(ws, seg, labelRow);
  const firstDataRow = detectedLabelRow + 1;

  // Map each label cell -> the field whose label/key/alias matches.
  const fieldByCol = new Map<number, string>();
  ws.getRow(detectedLabelRow).eachCell({ includeEmpty: false }, (cell, col) => {
    const field = matchField(seg.fields, normalize(String(cellRaw(cell) ?? '')));
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
  meta?: FileMeta,
): Promise<SegmentRow[]> {
  const { sheet, firstDataRow, columns, columnHeaders, headerRow, explode } = format.flatExplode!;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  // The named tab ("Master Sheet") is a hint, not a hard requirement: accountants
  // routinely rename it, leave the default "Sheet1", or add extra tabs. Find the
  // Master Sheet by CONTENT (which sheet's header row holds the expected fields)
  // when the name doesn't match, rather than failing or guessing the first tab.
  const ws = resolveFlatExplodeSheet(wb, format.flatExplode!);

  // The header row is a HINT, not a fixed position — templates vary (labels on row 10
  // in the classic Master Sheet, row 1 in the newer expanded one). Detect it by
  // scanning for the row that best matches the expected header labels; data starts on
  // the next row. Falls back to the configured position for letter-only formats.
  const preferredHeaderRow = headerRow ?? firstDataRow - 1;
  const effHeaderRow = columnHeaders
    ? detectHeaderRow(ws, Object.keys(columnHeaders), preferredHeaderRow)
    : preferredHeaderRow;
  const effFirstDataRow = columnHeaders ? effHeaderRow + 1 : firstDataRow;

  const lookups = { creditType: readCreditTypeLookup(wb) };

  // Resolve the column->key mapping. Header-driven mapping (match the header row
  // text) takes precedence so one profile adapts to shifted layouts; fixed
  // letter columns are the fallback for keys not covered by a header match.
  const colToKey = new Map<number, string>();
  for (const [letter, key] of Object.entries(columns)) colToKey.set(colLetterToNumber(letter), key);
  if (columnHeaders) {
    // Header cells often carry an embedded legend after the label
    // ("Account Status 1. Open 2. Closed ..."), so match by normalized PREFIX:
    // the first column whose header starts with the (normalized) key text wins.
    // Fold a header for matching: normalize() + drop spaces around "/" so
    // "Business / Industry Type" and "Business/ Industry Type" compare equal.
    const foldHeader = (s: string): string => normalize(s).replace(/\s*\/\s*/g, '/');
    const hdrRow = ws.getRow(effHeaderRow);
    const normHeaders: Array<{ col: number; text: string }> = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const text = foldHeader(String(cellRaw(hdrRow.getCell(c)) ?? ''));
      if (text) normHeaders.push({ col: c, text });
    }
    // Prefer the LEGEND-BEARING column (longest header that starts with the key):
    // some sheets split a field into a bare-label column (often blank) plus a
    // legend-bearing column that actually holds the data — match the latter.
    const findHeaderCol = (key: string): number | undefined => {
      const k = foldHeader(key);
      let best: { col: number; len: number } | undefined;
      for (const h of normHeaders) {
        if (h.text === k || h.text.startsWith(k)) {
          if (!best || h.text.length > best.len) best = { col: h.col, len: h.text.length };
        }
      }
      return best?.col;
    };
    // Header keys override any letter mapping: clear letter-mapped cols first so a
    // shifted layout can't leave a stale (wrong-column) binding behind.
    for (const key of Object.values(columnHeaders)) {
      for (const [col, k] of colToKey) if (k === key) colToKey.delete(col);
    }
    for (const [text, key] of Object.entries(columnHeaders)) {
      const col = findHeaderCol(text);
      if (col !== undefined) colToKey.set(col, key);
    }
  }

  // Header row text (for positional block detection of repeated header groups,
  // e.g. multiple guarantor blocks the flat `input` map can't represent).
  const headerTexts = new Map<number, string>();
  {
    const hdrRow = ws.getRow(effHeaderRow);
    for (let c = 1; c <= ws.columnCount; c++) {
      const text = String(cellRaw(hdrRow.getCell(c)) ?? '').trim();
      if (text) headerTexts.set(c, text);
    }
  }

  const rows: SegmentRow[] = [];
  for (let r = effFirstDataRow; r <= ws.rowCount; r++) {
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

    const rawCells: Array<{ col: number; header: string; value: FieldValue }> = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      rawCells.push({ col: c, header: headerTexts.get(c) ?? '', value: normalizeRaw(cellRaw(wsRow.getCell(c))) });
    }

    const ctx: FlatExplodeContext = { rowNumber: r, lookups, meta, rawCells };
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
 *
 * The configured `headerCells` are fixed addresses (correct for the canonical
 * layout). When a form is shifted those addresses come up blank, so for the flat
 * single-record path we additionally detect the TUDF header block by label and
 * fill in any keys the fixed addresses didn't supply. The sheet name is a hint:
 * we fall back to the single/first sheet just like the data reader.
 */
export async function readFlatHeaderOverrides(
  buffer: Buffer | ArrayBuffer,
  format: FormatSpec,
): Promise<Partial<Record<string, FieldValue>>> {
  const cells = format.flatExplode?.headerCells ?? format.flatInput?.headerCells;
  const sheet = format.flatExplode?.sheet ?? format.flatInput?.sheet;
  if (!sheet) return {};

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = format.flatInput ? resolveSheet(wb, sheet) : findSheet(wb, sheet);
  if (!ws) return {};

  const out: Record<string, FieldValue> = {};
  const set = (key: string, v: FieldValue): void => {
    if (v === undefined || String(v).trim() === '') return;
    if (key === 'reportingDate' || key === 'creationDate') {
      out[key] = coerceCell({ key, type: 'date-ddmmyyyy', mandatory: false }, v as RawCell);
    } else {
      out[key] = String(v).trim();
    }
  };

  // Configured fixed-address cells take precedence (canonical layout).
  for (const [addr, key] of Object.entries(cells ?? {})) set(key, normalizeRaw(cellRaw(ws.getCell(addr))));

  // Flat path: backfill any header keys the fixed addresses missed by locating the
  // form's TUDF header block (label row + value row directly below) by its known
  // CRIF column labels. Handles forms shifted left/up where the configured cell
  // addresses no longer line up.
  if (format.flatInput) {
    for (const [key, v] of Object.entries(detectFlatHeaderValues(ws))) {
      if (!(key in out)) set(key, v);
    }
  }

  return out;
}

/**
 * The CRIF "Data Submission Form" TUDF header block uses these fixed column
 * labels (normalized) -> FileMeta key. We deliberately do NOT backfill memberId:
 * the output member id is the CRIF-assigned id supplied via the flag, not the raw
 * id typed in the sheet (see flatInput docs in types.ts).
 */
const FLAT_HEADER_LABEL_TO_META: Record<string, string> = {
  'short name': 'memberShortName',
  'date reported': 'reportingDate',
  'reporting password': 'password',
};

/**
 * Detect the TUDF header value row (the row directly under the row carrying the
 * known CRIF header labels) and pull file-level header values from it by matched
 * column. Returns FileMeta-keyed values; only short name / reporting date /
 * password are mapped.
 */
function detectFlatHeaderValues(ws: ExcelJS.Worksheet): Record<string, FieldValue> {
  const labels = Object.keys(FLAT_HEADER_LABEL_TO_META);
  // Find the row matching the most known header labels (scan only near the top).
  let best = { row: 0, score: 0 };
  const lastRow = Math.min(ws.rowCount, 50);
  for (let r = 1; r <= lastRow; r++) {
    let score = 0;
    const seen = new Set<string>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      const h = normalize(String(cellRaw(cell) ?? ''));
      if (labels.includes(h) && !seen.has(h)) {
        seen.add(h);
        score++;
      }
    });
    if (score > best.score) best = { row: r, score };
  }
  if (best.score === 0) return {};

  const metaByCol = new Map<number, string>();
  ws.getRow(best.row).eachCell({ includeEmpty: false }, (cell, col) => {
    const metaKey = FLAT_HEADER_LABEL_TO_META[normalize(String(cellRaw(cell) ?? ''))];
    if (metaKey) metaByCol.set(col, metaKey);
  });

  const valueRow = ws.getRow(best.row + 1);
  const out: Record<string, FieldValue> = {};
  for (const [col, metaKey] of metaByCol) out[metaKey] = normalizeRaw(cellRaw(valueRow.getCell(col)));
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

/**
 * Resolve the input sheet for a flat single-record workbook. The named tab is a
 * hint: when it isn't present, fall back to the workbook's only sheet (or its
 * first sheet) rather than failing — accountants routinely leave the default
 * "Sheet1" name. Throws only when the workbook has no sheets at all, and the
 * message lists what was actually present.
 */
function resolveSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const named = findSheet(wb, name);
  if (named) return named;
  const fallback = wb.worksheets[0];
  if (!fallback) throw new Error(`Input sheet "${name}" not found and the workbook has no sheets`);
  return fallback;
}

/**
 * Count how many of the format's expected header labels appear in a given row,
 * using the same fold/prefix matching the column resolver uses ("Account Status
 * 1. Open 2. Closed…" still matches the "Account Status" label). Returns 0 for a
 * row that holds none of them — i.e. not a data-header row.
 */
function scoreHeaderRow(ws: ExcelJS.Worksheet, row: number, labels: string[]): number {
  const fold = (s: string): string => normalize(s).replace(/\s*\/\s*/g, '/');
  const hdr = ws.getRow(row);
  const cells: string[] = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    const t = fold(String(cellRaw(hdr.getCell(c)) ?? ''));
    if (t) cells.push(t);
  }
  let hits = 0;
  for (const label of labels) {
    const k = fold(label);
    if (cells.some((t) => t === k || t.startsWith(k))) hits++;
  }
  return hits;
}

/**
 * Best header-label match for a sheet, scanning the top rows rather than trusting
 * a single configured row number: an accountant's file may push the header down
 * (extra title rows) or pull it up. Returns the highest hit count found in the
 * first `maxScan` rows — that's how well this sheet matches the expected fields.
 */
function bestHeaderScore(ws: ExcelJS.Worksheet, labels: string[], maxScan = 25): number {
  const last = Math.min(ws.rowCount, maxScan);
  let best = 0;
  for (let r = 1; r <= last; r++) {
    const hits = scoreHeaderRow(ws, r, labels);
    if (hits > best) best = hits;
  }
  return best;
}

/**
 * The 1-based row that holds the column headers. Scans the top rows and picks the
 * best label match, biasing to `preferred` on ties so the classic layout is unchanged
 * while an expanded/shifted template (headers on row 1) is still located. Falls back
 * to `preferred` when nothing matches.
 */
function detectHeaderRow(ws: ExcelJS.Worksheet, labels: string[], preferred: number, maxScan = 25): number {
  const last = Math.min(ws.rowCount, maxScan);
  let best = { row: preferred, score: -1 };
  for (let r = 1; r <= last; r++) {
    const score = scoreHeaderRow(ws, r, labels);
    if (score > best.score || (score === best.score && r === preferred)) best = { row: r, score };
  }
  return best.score > 0 ? best.row : preferred;
}

/**
 * First worksheet that has any rows; falls back to the very first sheet. Callers
 * must pass a non-empty array (guarded upstream), so `sheets[0]` is defined.
 */
function firstNonEmptySheet(sheets: ExcelJS.Worksheet[]): ExcelJS.Worksheet {
  return sheets.find((w) => w.rowCount > 0) ?? sheets[0]!;
}

/**
 * Resolve the input sheet for a flat-EXPLODE workbook (e.g. the commercial
 * "Master Sheet" or the consumer "Data Submission Form"). The tab NAME is just a
 * hint — accountants rename it or leave the default "Sheet1", and a workbook may
 * carry extra tabs (a "Credit Type Code" lookup, notes, a cover). Strategy:
 *   1. If a tab literally named `spec.sheet` exists, use it (keeps the canonical
 *      output byte-identical to the golden fixtures).
 *   2. If the format identifies columns by HEADER TEXT (`columnHeaders`), scan
 *      every sheet and pick the one whose header row best matches those labels —
 *      that sheet IS the data sheet, regardless of tab name or header-row offset.
 *      If none matches enough fields, throw a clear error naming the tabs seen.
 *   3. If the format identifies columns by FIXED LETTER only (no `columnHeaders`,
 *      e.g. the consumer TLV profile), there is no header text to match against,
 *      so fall back to the first non-empty sheet (matching the single-record
 *      reader's behaviour) rather than failing.
 */
function resolveFlatExplodeSheet(
  wb: ExcelJS.Workbook,
  spec: NonNullable<FormatSpec['flatExplode']>,
): ExcelJS.Worksheet {
  const named = findSheet(wb, spec.sheet);
  if (named) return named;

  const sheets = wb.worksheets;
  if (sheets.length === 0) {
    throw new Error(`Input sheet "${spec.sheet}" not found and the workbook has no sheets`);
  }

  // Letter-mapped formats have no header text to match — fall back to first sheet.
  const labels = Object.keys(spec.columnHeaders ?? {});
  if (labels.length === 0) return firstNonEmptySheet(sheets);

  // Header-text formats: pick the sheet whose rows best match the expected labels.
  // Require at least a few hits to rule out an unrelated tab (lookup/notes/cover)
  // while tolerating sheets that omit a few optional columns.
  const MIN_HITS = Math.min(3, labels.length);
  let best: { ws: ExcelJS.Worksheet; hits: number } | undefined;
  for (const ws of sheets) {
    const hits = bestHeaderScore(ws, labels);
    if (!best || hits > best.hits) best = { ws, hits };
  }
  if (best && best.hits >= MIN_HITS) return best.ws;

  const seen = sheets.map((w) => `"${w.name}"`).join(', ');
  throw new Error(
    `Input sheet "${spec.sheet}" not found, and none of the workbook's sheets ` +
      `(${seen}) contain the expected "${spec.sheet}" columns ` +
      `(looked for fields like ${labels.slice(0, 3).map((l) => `"${l}"`).join(', ')}). ` +
      `Rename the data tab to "${spec.sheet}" or check the header row.`,
  );
}

/**
 * Find the 1-based row that holds the column labels by scoring each row on how
 * many cells match a body field's label/key. The configured `preferredRow` wins
 * ties (and is required to be a positive match), so the canonical layout is
 * unchanged while shifted forms are still located. Falls back to `preferredRow`
 * when nothing matches (the downstream mapping will then surface empty output).
 */
function detectLabelRow(ws: ExcelJS.Worksheet, seg: SegmentSpec, preferredRow: number): number {
  let best = { row: preferredRow, score: -1 };
  const lastRow = Math.min(ws.rowCount, 200); // labels live near the top; cap the scan
  for (let r = 1; r <= lastRow; r++) {
    const score = countLabelMatches(ws.getRow(r), seg);
    // Strictly-greater keeps the FIRST best row; bias toward preferredRow on ties.
    if (score > best.score || (score === best.score && r === preferredRow)) best = { row: r, score };
  }
  return best.score > 0 ? best.row : preferredRow;
}

/** How many of `seg`'s fields are named by some cell in `row` (label/key/alias). */
function countLabelMatches(row: ExcelJS.Row, seg: SegmentSpec): number {
  const matched = new Set<string>();
  row.eachCell({ includeEmpty: false }, (cell) => {
    const header = normalize(String(cellRaw(cell) ?? ''));
    if (!header) return;
    const field = matchField(seg.fields, header);
    if (field) matched.add(field.key);
  });
  return matched.size;
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
    const field = matchField(seg.fields, header);
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

/**
 * Find the field a column header names: matches the field's `label`, `key`, or any
 * `aliases` entry (all normalized). `header` must already be normalized.
 */
function matchField(fields: FieldSpec[], header: string): FieldSpec | undefined {
  return fields.find(
    (f) =>
      normalize(f.label ?? '') === header ||
      normalize(f.key) === header ||
      (f.aliases ?? []).some((a) => normalize(a) === header),
  );
}

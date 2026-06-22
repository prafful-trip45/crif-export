import ExcelJS from 'exceljs';
import { encodeSegment } from '../encoding/engine.js';
import { formatValue } from '../encoding/formatters/value.js';
import { computeCounts } from '../encoding/engine.js';
import type { FileMeta, FormatSpec, SegmentSpec, TypedRow } from '../core/types.js';
import type { Borrower } from '../input/model.js';

/**
 * Write the accountant-style multi-sheet WORKBOOK report (mirrors
 * client-commercial-working-data-accounting-1.xlsx):
 *   - one sheet per segment (HD, BS, AS, RS, CR, GS, SS, CD, TS) with the columns
 *     `A/c No. | Flag | Segment Identifier | <fields…> | Filler | Final Formula`
 *     (header/trailer sheets drop the A/c No. + Flag control columns), and
 *   - a `sorting` sheet listing every emitted record (HD, then each borrower's
 *     body segments in flag order, then TS) with its assembled `Final Formula`.
 *
 * The `Final Formula` cell is the exact pipe-delimited record the .txt emits, so
 * the workbook and the .txt are always consistent.
 */
export async function writeReport(
  format: FormatSpec,
  borrowers: Borrower[],
  meta: FileMeta,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'crif-export';

  const bodyOrder = new Map(format.body.map((s, i) => [s.tag, i] as const));
  const counts = computeCounts(format, borrowers);

  // Assemble structured records, keyed by segment, plus the flat sorting list.
  const headerRow = format.buildHeaderRow(meta);
  const trailerRow = format.buildTrailerRow(counts, meta);

  type Rec = { acNo: string; acIndex: number; flag: number; values: TypedRow; formula: string };
  const bySeg = new Map<string, Rec[]>();
  const sorting: Array<{ acIndex: number | ''; flag: number | ''; tag: string; formula: string }> = [];

  // Header
  const headerFormula = encodeSegment(format.header, headerRow);
  bySeg.set(format.header.tag, [{ acNo: '', acIndex: 0, flag: 0, values: headerRow, formula: headerFormula }]);
  sorting.push({ acIndex: '', flag: '', tag: format.header.tag, formula: headerFormula });

  // Body, grouped per borrower in flag order
  borrowers.forEach((borrower, bi) => {
    const ordered = [...borrower.segments].sort((a, b) => {
      if (a.flag !== b.flag) return a.flag - b.flag;
      return (bodyOrder.get(a.tag) ?? 0) - (bodyOrder.get(b.tag) ?? 0);
    });
    for (const seg of ordered) {
      const spec = format.body.find((s) => s.tag === seg.tag);
      if (!spec) continue;
      const formula = encodeSegment(spec, seg.values);
      const rec: Rec = { acNo: borrower.acNo, acIndex: bi + 1, flag: seg.flag, values: seg.values, formula };
      if (!bySeg.has(seg.tag)) bySeg.set(seg.tag, []);
      bySeg.get(seg.tag)!.push(rec);
      sorting.push({ acIndex: bi + 1, flag: seg.flag, tag: seg.tag, formula });
    }
  });

  // Trailer
  if (!format.omitTrailer) {
    const trailerFormula = encodeSegment(format.trailer, trailerRow);
    bySeg.set(format.trailer.tag, [{ acNo: '', acIndex: 0, flag: 0, values: trailerRow, formula: trailerFormula }]);
    sorting.push({ acIndex: '', flag: '', tag: format.trailer.tag, formula: trailerFormula });
  }

  // ---- One sheet per segment, in spec order: header, body…, trailer ----
  const allSegs: SegmentSpec[] = [format.header, ...format.body, ...(format.omitTrailer ? [] : [format.trailer])];
  for (const spec of allSegs) {
    const isControl = spec.cardinality !== 'header' && spec.cardinality !== 'trailer';
    const ws = wb.addWorksheet(spec.tag);
    const dataFields = spec.fields.filter((f) => f.key !== '_tag');

    // Header row
    const headers = isControl ? ['A/c No.', 'Flag', 'Segment Identifier'] : ['Segment Identifier'];
    for (const f of dataFields) headers.push(f.label ?? f.key);
    headers.push('Final Formula');
    const hr = ws.addRow(headers);
    hr.font = { bold: true };

    // Data rows
    for (const rec of bySeg.get(spec.tag) ?? []) {
      const cells: Array<string | number> = isControl
        ? [rec.acIndex || '', rec.flag, spec.tag]
        : [spec.tag];
      for (const f of dataFields) cells.push(formatValue(f, rec.values[f.key]));
      cells.push(rec.formula);
      ws.addRow(cells);
    }
    ws.columns.forEach((c) => {
      c.width = 18;
    });
  }

  // ---- sorting sheet ----
  const sortWs = wb.addWorksheet('sorting');
  sortWs.addRow(['A/c No.', 'Flag', 'Segment Identifier', 'Final Formula']).font = { bold: true };
  for (const s of sorting) sortWs.addRow([s.acIndex, s.flag, s.tag, s.formula]);
  sortWs.columns.forEach((c) => {
    c.width = 18;
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

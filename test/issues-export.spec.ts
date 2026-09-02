import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';
import { writeIssuesWorkbook } from '../packages/core/src/output/issues-writer.js';
import type { FileMeta } from '../packages/core/src/core/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = (f: string) => join(here, '../training-references/crif-reporting-io', f);
const META: FileMeta = {
  memberId: 'NB89580001',
  reportingDate: new Date(Date.UTC(2026, 6, 9)),
  creationDate: new Date(Date.UTC(2026, 6, 17)),
};

/** Read the single "Issues" sheet back into row objects keyed by header. */
async function readIssues(buf: Buffer): Promise<Array<Record<string, string>>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Issues')!;
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
  const out: Array<Record<string, string>> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      const v = ws.getRow(r).getCell(i + 1).value;
      rec[h] = v === null || v === undefined ? '' : String(v);
    });
    out.push(rec);
  }
  return out;
}

describe('issues export workbook', () => {
  it('indexes issues, points a derived field at its source cell, and lists errors first', async () => {
    // A real file with BOTH a warning (RS state derived from an address column) and a
    // blocking error (borrower-level wilful-default rule).
    const r: any = await convert(
      readFileSync(ref('commercial_input_1Jul_OD_Loan.xlsx')),
      getFormat('commercial-ucrf-flat'),
      META,
      { allowWarnings: true },
    );
    expect(r.report.issues.length).toBeGreaterThan(1);

    const rows = await readIssues(await writeIssuesWorkbook(r.report));
    expect(rows).toHaveLength(r.report.issues.length);
    expect(rows.every((x) => x['Reference'] !== '')).toBe(true);

    // 1) Stable 1-based index in insertion order.
    expect(rows.map((x) => x['#'])).toEqual(rows.map((_, i) => String(i + 1)));

    // 2) Errors are listed before warnings.
    const firstWarnIdx = rows.findIndex((x) => x['Severity'] === 'warning');
    const lastErrIdx = rows.map((x) => x['Severity']).lastIndexOf('error');
    if (firstWarnIdx >= 0 && lastErrIdx >= 0) expect(lastErrIdx).toBeLessThan(firstWarnIdx);


    // 3) A borrower-level error (or unmapped field error) has no single source cell → blank Cell/Column.
    const errRow = rows.find((x) => x['Severity'] === 'error' && x['Cell'] === '') || rows.find((x) => x['Severity'] === 'error')!;
    expect(errRow).toBeDefined();
    expect(errRow['Severity']).toBe('error');
  });

  /**
   * A field DERIVED from free text (state/city/PIN parsed out of the address column)
   * must point the operator at the column they can actually edit — the address column —
   * not at a "State" column that does not exist in the Master Sheet. No real reference
   * file still trips this (every one of their cities now resolves), so the fixture is
   * built here with a deliberately unresolvable address.
   */
  it('points a derived address field at the address column it was read from', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master Sheet');
    ws.addRow([
      "Borrower's Name", "Borrower's PAN", 'Borrowers Legal Constitution', 'Business Category',
      'Business/ Industry Type', "Borrower's Address with PIN Code", "Borrower's Contact No.",
      "Borrower's Account Number", 'Facility / Loan Activation / Sanction Date',
      'Sanctioned Amount/ Notional Amount of Contract', 'Credit Type',
      'Current Balance / Limit Utilized', 'Asset Classification', 'Account Status',
    ]);
    ws.addRow([
      'First Ltd', 'AAAAA1111A', '30', '03', '06', 'Unit 7, Unknown Place', '9999999999', 'A1',
      '01012024', '100000', '5000', '5000', '0001', '01',
    ]);
    const buffer = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer).buffer;

    const r: any = await convert(buffer, getFormat('commercial-ucrf-flat-v310'), META, {
      allowWarnings: true,
      bypassErrors: true,
    });
    const rows = await readIssues(await writeIssuesWorkbook(r.report));

    // "Borrower's Address with PIN Code" is column F on the sheet above; row 2 is the
    // first data row, so the citation must read F2 — not a blank or invented cell.
    const derived = rows.find((x) => x['Field'] === 'address');
    expect(derived).toBeDefined();
    expect(derived!['Cell']).toBe('F2');
    expect(derived!['Column']).toBe('F');
    expect(derived!['Severity']).toBe('error');
  });
});

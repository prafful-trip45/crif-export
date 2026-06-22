import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';
import type { FormatSpec } from '../packages/core/src/core/types.js';
import { commercialUcrf } from '../packages/core/src/formats/commercial-ucrf.js';

// The per-segment Commercial UCRF spec is no longer in the user-facing registry
// (only the flat profiles are exposed), but it remains the source of truth for
// the encoding engine; reference it directly for the one-sheet-per-segment e2e.
const SPECS: Record<string, FormatSpec> = { 'commercial-ucrf': commercialUcrf };
const specFor = (id: string): FormatSpec => SPECS[id] ?? getFormat(id as never);

/** Build an in-memory xlsx with one sheet per segment, headers = field labels. */
async function buildWorkbook(
  formatId: 'commercial-ucrf' | 'mfi-cdf' | 'consumer-ucrf12',
  sheets: Record<string, Array<Record<string, unknown> & { _acNo: string; _flag: number }>>,
): Promise<Buffer> {
  const format = specFor(formatId);
  const wb = new ExcelJS.Workbook();
  for (const seg of format.body) {
    const ws = wb.addWorksheet(seg.tag);
    const dataFields = seg.fields.filter((f) => f.key !== '_tag' && !f.key.startsWith('_'));
    ws.addRow(['A/c No.', 'Flag', ...dataFields.map((f) => f.label ?? f.key)]);
    for (const row of sheets[seg.tag] ?? []) {
      ws.addRow([row._acNo, row._flag, ...dataFields.map((f) => (row[f.key] ?? '') as string)]);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Full pipeline (workbook → bureau file)', () => {
  it('converts a clean Commercial workbook into a valid file', async () => {
    const buf = await buildWorkbook('commercial-ucrf', {
      BS: [{ _acNo: 'A1', _flag: 1, memberBranchCode: '110000', borrowerName: 'ACME PVT LTD', pan: 'AACCT1331J' }],
      AS: [{ _acNo: 'A1', _flag: 2, addressLine1: '12 MG Road', cityTown: 'Pune', stateCode: '27', pinCode: '411001' }],
      CR: [{ _acNo: 'A1', _flag: 4, accountNumber: '900001', sanctionDate: '14092013', sanctionedAmount: 5000000, currencyCode: 'INR' }],
    });

    const result = await convert(buf, specFor('commercial-ucrf'), {
      memberId: 'NBF9000001',
      reportingDate: new Date(Date.UTC(2024, 3, 30)),
      creationDate: new Date(Date.UTC(2024, 3, 30)),
    });

    expect(result.report.ok).toBe(true);
    expect(result.outputText).toBeDefined();
    const lines = result.outputText!.split('\r\n');
    expect(lines[0]).toBe('HD|NBF9000001||30042024|30042024|01|');
    expect(lines.some((l) => l.startsWith('BS|110000||ACME PVT LTD|'))).toBe(true);
    expect(lines.some((l) => l.startsWith('CR|900001||14092013|5000000|INR|'))).toBe(true);
    expect(lines.at(-1)).toBe('TS|1|1|');
  });

  it('collects validation errors and suppresses the file when a mandatory field is blank', async () => {
    const buf = await buildWorkbook('commercial-ucrf', {
      // borrowerName (mandatory) omitted; CR sanctionDate omitted
      BS: [{ _acNo: 'A1', _flag: 1, memberBranchCode: '110000', pan: 'AACCT1331J' }],
      AS: [{ _acNo: 'A1', _flag: 2, addressLine1: '12 MG Road' }],
      CR: [{ _acNo: 'A1', _flag: 4, accountNumber: '900001', sanctionedAmount: 5000000, currencyCode: 'INR' }],
    });

    const result = await convert(buf, specFor('commercial-ucrf'), {
      memberId: 'NBF9000001',
      reportingDate: new Date(),
      creationDate: new Date(),
    });

    expect(result.report.ok).toBe(false);
    expect(result.output).toBeUndefined();
    const keys = result.report.errors.map((e) => e.fieldKey);
    expect(keys).toContain('borrowerName');
    expect(keys).toContain('sanctionDate');
  });

  it('flags an invalid PAN', async () => {
    const buf = await buildWorkbook('commercial-ucrf', {
      BS: [{ _acNo: 'A1', _flag: 1, borrowerName: 'X LTD', pan: 'NOTAPAN123' }],
      AS: [{ _acNo: 'A1', _flag: 2, addressLine1: 'addr' }],
      CR: [{ _acNo: 'A1', _flag: 4, accountNumber: '1', sanctionDate: '01012020', sanctionedAmount: 1, currencyCode: 'INR' }],
    });
    const result = await convert(buf, specFor('commercial-ucrf'), {
      memberId: 'M', reportingDate: new Date(), creationDate: new Date(),
    });
    expect(result.report.errors.some((e) => e.fieldKey === 'pan' && e.rule === 'format')).toBe(true);
  });
});

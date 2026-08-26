import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { convert, getFormat } from '../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('Consumer TUDF format (.tudf) generation', () => {
  it('converts consumer-input-2.xlsx into valid TUDF format with 0 errors', async () => {
    const xlsx = readFileSync(join(here, '../training-references/crif-reporting-io/consumer-input-2.xlsx'));
    const res = await convert(xlsx, getFormat('consumer-tudf'), {
      memberId: '0024FP00865',
      memberShortName: 'CAPTREE',
      creationDate: new Date('2026-05-31'),
      reportingDate: new Date('2026-05-31'),
    });

    expect(res.report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(res.outputText).toBeDefined();
    const out = res.outputText!;

    // 1. Header (146 chars fixed-width)
    expect(out.startsWith('TUDF12')).toBe(true);
    expect(out).toContain('0024FP00865');
    expect(out).toContain('CAPTREE');

    // 2. Tagged TLV segments
    expect(out).toContain('PN03N01');
    expect(out).toContain('ID03I01');
    expect(out).toContain('PT03T01');
    expect(out).toContain('EC03C01');
    expect(out).toContain('PA03A01');
    expect(out).toContain('TL04T00');
    expect(out).toContain('ES02**');
    expect(out.endsWith('ES02**TRLR')).toBe(true);

    // 3. Continuous physical line without newlines
    expect(out).not.toContain('\n');
    expect(out).not.toContain('\r');
  });

  it('validates 024FP04147_16082026_17082026_145520.xlsx and generates complete .tudf file when fields are populated', async () => {
    const rawXlsx = readFileSync(join(here, '../training-references/consumer-debugging-Aug-26/024FP04147_16082026_17082026_145520.xlsx'));
    
    // 1. Convert with raw file (expect validation to catch missing ROI if mandatory or allowWarnings)
    const resRaw = await convert(rawXlsx, getFormat('consumer-tudf'), {
      memberId: '024FP04147',
      memberShortName: 'VINZOLCFL',
      creationDate: new Date('2026-08-20'),
      reportingDate: new Date('2026-08-16'),
    }, { allowWarnings: true });

    expect(resRaw.outputText).toBeDefined();
    expect(resRaw.outputText!.startsWith('TUDF12')).toBe(true);
    expect(resRaw.outputText!).toContain('024FP04147');
    expect(resRaw.outputText!).toContain('VINZOLCFL');
    expect(resRaw.outputText!.endsWith('ES02**TRLR')).toBe(true);

    // 2. Fix Excel by populating Col AZ (Suit Filed = 00) and Col BG (Rate of Interest = 18)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rawXlsx as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Data Submission Form')!;
    for (let r = 11; r <= ws.rowCount; r++) {
      ws.getCell(r, 52).value = '00'; // AZ: Suit Filed
      ws.getCell(r, 59).value = '18'; // BG: Rate of Interest
    }
    const fixedBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    const resFixed = await convert(fixedBuffer, getFormat('consumer-tudf'), {
      memberId: '024FP04147',
      memberShortName: 'VINZOLCFL',
      creationDate: new Date('2026-08-20'),
      reportingDate: new Date('2026-08-16'),
    });

    console.log('Fixed errors:', resFixed.report.issues.filter((i) => i.severity === 'error'));
    expect(resFixed.report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(resFixed.outputText).toBeDefined();
    const fixedOut = resFixed.outputText!;

    // Check that all 17 borrowers have PN, ID, PT, PA, TL, and ES segments
    const pnMatches = fixedOut.match(/PN03N01/g) || [];
    const tlMatches = fixedOut.match(/TL04T00/g) || [];
    const esMatches = fixedOut.match(/ES02\*\*/g) || [];
    expect(pnMatches.length).toBe(17);
    expect(tlMatches.length).toBe(17);
    expect(esMatches.length).toBe(17);
    expect(fixedOut.endsWith('ES02**TRLR')).toBe(true);
  });
});

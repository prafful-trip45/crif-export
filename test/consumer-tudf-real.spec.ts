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
      // The real CRIF id is 10 chars. It used to be written here as '0024FP00865'
      // — the spurious leading zero was an artefact of the old TL mis-encoding.
      memberId: '024FP00865',
      memberShortName: 'CAPTREE',
      creationDate: new Date('2026-05-31'),
      reportingDate: new Date('2026-05-31'),
    });

    expect(res.report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(res.outputText).toBeDefined();
    const out = res.outputText!;

    // 1. Header (146 chars fixed-width)
    expect(out.startsWith('TUDF12')).toBe(true);
    expect(out).toContain('024FP00865');
    expect(out).toContain('CAPTREE');

    // 2. Tagged TLV segments
    expect(out).toContain('PN03N01');
    expect(out).toContain('ID03I01');
    expect(out).toContain('PT03T01');
    // EC is "When Available" (V3.73 p.14) — this sheet has no Email ID (col V), so
    // the segment must be absent. A bare `EC03C01` with no field is the field-count
    // error CRIF rejected 024FP04147_09092026_14092026_163716_W1.tudf for.
    expect(out).not.toContain('EC03C01');
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

/**
 * Regressions for the two defects behind CRIF's 19-Sep-2026 rejection of
 * 024FP04147_09092026_14092026_163716_W1.tudf. The rejected bytes are checked in at
 * training-references/consumer-debugging-sept-19/ alongside the source workbook.
 */
describe('Consumer TUDF — Sept-2026 rejection regressions', () => {
  const xlsx = () =>
    readFileSync(join(here, '../training-references/consumer-debugging-sept-19/instance_1.xlsx'));
  const meta = {
    memberId: '024FP04147',
    memberShortName: 'VINZOLCFL',
    creationDate: new Date('2026-09-14'),
    reportingDate: new Date('2026-09-09'),
  };

  it('omits the EC segment entirely when the sheet has no Email ID', async () => {
    const res = await convert(xlsx(), getFormat('consumer-tudf'), meta, { bypassErrors: true });
    const out = res.outputText!;

    // Column V is blank for every row, and EC is "When Available" (V3.73 p.14).
    // CRIF rejected the submitted file for "a field count issue in the EC Segment
    // (the email ID was not provided; only the segment was provided)".
    expect(out).not.toContain('EC03C01');
    // The rest of the subject is untouched — 18 borrowers, each still fully formed.
    expect(out.match(/PN03N01/g)!.length).toBe(18);
    expect(out.match(/ES02\*\*/g)!.length).toBe(18);
  });

  it('folds non-latin1 punctuation instead of truncating it to a control byte', async () => {
    const res = await convert(xlsx(), getFormat('consumer-tudf'), meta, { bypassErrors: true });
    const bytes = Buffer.from(res.outputText!, 'latin1');

    // Row 23's address reads "SARVODAY SOCIETY <en dash> 1". Buffer.from(s,'latin1')
    // keeps only the low byte, so U+2013 used to ship as a raw 0x13 (DC3).
    expect(res.outputText!).toContain('SARVODAY SOCIETY - 1');
    expect(res.outputText!).not.toContain('\u2013');
    for (const b of bytes) expect(b).toBeGreaterThanOrEqual(0x20);
  });

  /**
   * Walks the output exactly as a spec-compliant reader does. The stream is
   * self-describing, so a single wrong segment-header width or field tag
   * desynchronises everything after it — which is precisely how the TL bug hid.
   */
  function crifParse(out: string) {
    const HDR: Record<string, number> = { PN: 7, ID: 7, PT: 7, EC: 7, PA: 7, TL: 8 };
    const VER: Record<string, string> = { PN: '03', ID: '03', PT: '03', EC: '03', PA: '03', TL: '04' };
    const isDigits = (v: string) => /^\d{2}$/.test(v);
    let i = 146;
    const memberCodes: string[] = [];
    let segments = 0;
    while (i < out.length) {
      if (out.startsWith('ES02**', i)) { i += 6; continue; }
      if (out.startsWith('TRLR', i)) return { ok: true, segments, memberCodes };
      const tag = out.slice(i, i + 2);
      const width = HDR[tag];
      if (!width) return { ok: false, at: i, saw: out.slice(i, i + 16), segments, memberCodes };
      i += width;
      segments += 1;
      while (i < out.length) {
        if (out.startsWith('ES02**', i) || out.startsWith('TRLR', i)) break;
        const nt = out.slice(i, i + 2);
        if (HDR[nt] && out.slice(i + 2, i + 4) === VER[nt]) break;
        const ft = out.slice(i, i + 2);
        const ln = out.slice(i + 2, i + 4);
        if (!isDigits(ft) || !isDigits(ln)) {
          return { ok: false, at: i, saw: out.slice(i, i + 16), segments, memberCodes };
        }
        const val = out.slice(i + 4, i + 4 + Number(ln));
        if (tag === 'TL' && ft === '01') memberCodes.push(val);
        i += 4 + Number(ln);
      }
    }
    return { ok: false, at: i, saw: '<end of stream>', segments, memberCodes };
  }

  it('emits a TL segment a spec-compliant reader can walk to TRLR', async () => {
    const res = await convert(xlsx(), getFormat('consumer-tudf'), meta, { bypassErrors: true });
    const parsed = crifParse(res.outputText!);

    // The TL subtype is `T001` (4 chars, V3.73 p.20) where every other segment
    // uses 3, and the member code is field tag 01 (tag 10 is Date Closed). With
    // `T00` + tag `10` this used to desync at the first TL and never reach TRLR.
    expect(parsed).toMatchObject({ ok: true });
    expect(res.outputText!).toContain('TL04T0010110024FP04147');
    // Tag 01 is fixed length 10 and must equal the header member id.
    expect(new Set(parsed.memberCodes)).toEqual(new Set(['024FP04147']));
    expect(parsed.memberCodes).toHaveLength(18);
  });

  it('places Date Reported at header position 55 (CRIF header check)', async () => {
    const res = await convert(xlsx(), getFormat('consumer-tudf'), meta, { bypassErrors: true });
    const header = res.outputText!.slice(0, 146);
    expect(header.slice(54, 62)).toBe('09092026'); // 1-based position 55
    expect(header).toHaveLength(146);
  });
});

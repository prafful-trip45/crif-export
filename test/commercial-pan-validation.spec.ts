import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import type { FileMeta } from '../packages/core/src/core/types.js';
import { commercialUcrfFlat } from '../packages/core/src/formats/commercial-ucrf-flat.js';
import { formatRuleFor, isPan } from '../packages/core/src/validation/rules.js';

/**
 * PAN format validation across the whole Commercial cohort.
 *
 * V3.10 Annexure D Part-C (p.67) requires "the standard 10-character alphanumeric
 * PAN structure" with "the absence of special or non-printable characters" for
 * EVERY PAN-bearing field, not just the borrower's:
 *   - BS field 8  (`pan`)     Required Conditionally, failure -> Reject Record
 *   - RS field 14 (`rsPan`)   Required Conditionally, failure -> Reject Record
 *   - GS field 13 (`gsPan`)   Optional,               failure -> Reject Field
 *
 * The validator dispatches format rules with `formatRuleFor(field.key)`, which
 * matched the exact key `pan` only. `rsPan` and `gsPan` fell straight through, so a
 * malformed related-person or guarantor PAN was written to the wire unchecked and
 * came back as a bureau rejection. These tests pin all three.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fix = (f: string) => join(here, 'fixtures/commercial-flat', f);

const META: FileMeta = {
  memberId: 'NBFCHE3014',
  reportingDate: new Date(Date.UTC(2026, 0, 31)),
  creationDate: new Date(Date.UTC(2026, 2, 26)),
};

/** Master Sheet cells, from the real template layout (headers on row 10, data row 11). */
const CELL = {
  borrowerPan: 'B11',
  relatedPan: 'AB11',
  guarantorType: 'AE11',
  guarantorName: 'AI11',
  guarantorDob: 'AJ11',
  guarantorPan: 'AK11',
  guarantorGender: 'AM11',
  guarantorAddress: 'AN11',
} as const;

/** Load the known-good fixture and overwrite individual Master Sheet cells. */
async function sheetWith(edits: Record<string, string>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  // Cast as elsewhere in the suite: @types/node and ExcelJS disagree on Buffer's
  // type parameter, and the bytes are identical either way.
  await wb.xlsx.load(readFileSync(fix('input-corrected.xlsx')) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Master Sheet')!;
  for (const [addr, value] of Object.entries(edits)) ws.getCell(addr).value = value;
  // `convert` takes `Buffer | ArrayBuffer`; ExcelJS already hands back an ArrayBuffer,
  // so pass it straight through rather than round-tripping via Buffer.from (whose
  // NonSharedBuffer return type does not satisfy the Buffer parameter under strict TS).
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const panErrors = (report: { errors: { fieldKey?: string; rule?: string; message: string }[] }) =>
  report.errors.filter(e => e.rule === 'format' && /pan/i.test(e.fieldKey ?? ''));

describe('PAN format rule', () => {
  it('accepts the 5-letter/4-digit/1-letter structure and nothing else', () => {
    expect(isPan('AACCA3994L')).toBe(true); // borrower PAN from the golden
    expect(isPan('AADPR8349A')).toBe(true); // related-person PAN from the golden

    expect(isPan('AACCA3994')).toBe(false); // 9 chars
    expect(isPan('AACCA3994LL')).toBe(false); // 11 chars
    expect(isPan('aacca3994l')).toBe(false); // lower case
    expect(isPan('AACC3A994L')).toBe(false); // digits in the letter block
    expect(isPan('1ACCA3994L')).toBe(false); // leading digit
    expect(isPan('AACCA-994L')).toBe(false); // special character
    expect(isPan('AACCA3994L ')).toBe(false); // trailing space
    expect(isPan('AACCA\t994L')).toBe(false); // non-printable
  });

  it('is dispatched for every PAN-bearing field key in the cohort, not just the borrower', () => {
    // The bug: these three fell through to `undefined` and were never checked.
    for (const key of ['pan', 'rsPan', 'gsPan', 'relatedPan']) {
      expect(formatRuleFor(key), `no format rule dispatched for "${key}"`).toBe(isPan);
    }
  });

  it('does not capture non-PAN keys that merely contain "pan"', () => {
    for (const key of ['companyRegNumber', 'rsCompanyRegNumber', 'gsCompanyRegNumber']) {
      expect(formatRuleFor(key)).not.toBe(isPan);
    }
  });
});

describe('Commercial Master Sheet: PAN validation end to end', () => {
  it('converts the unmodified fixture with no PAN errors', async () => {
    const result = await convert(readFileSync(fix('input-corrected.xlsx')), commercialUcrfFlat, META);
    expect(panErrors(result.report)).toEqual([]);
    expect(result.report.errors).toEqual([]);
  });

  it('blocks a malformed BORROWER PAN (BS field 8 — Reject Record)', async () => {
    const buf = await sheetWith({ [CELL.borrowerPan]: 'AACCA399L' }); // 9 chars
    const result = await convert(buf, commercialUcrfFlat, META);

    const errs = panErrors(result.report);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.fieldKey).toBe('pan');
    expect(errs[0]?.message).toContain('AACCA399L');
  });

  it('blocks a malformed RELATED PERSON PAN (RS field 14 — Reject Record)', async () => {
    const buf = await sheetWith({ [CELL.relatedPan]: 'AADP8349A' }); // 9 chars
    const result = await convert(buf, commercialUcrfFlat, META);

    const errs = panErrors(result.report);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some(e => e.fieldKey === 'rsPan' || e.fieldKey === 'relatedPan')).toBe(true);
    expect(errs.some(e => e.message.includes('AADP8349A'))).toBe(true);
  });

  it('blocks a malformed GUARANTOR PAN (GS field 13 — Reject Field)', async () => {
    const buf = await sheetWith({
      [CELL.guarantorType]: '2', // Resident Indian Individual
      [CELL.guarantorName]: 'SUNITA DEVI',
      [CELL.guarantorDob]: '01011980',
      [CELL.guarantorGender]: 'FEMALE',
      [CELL.guarantorAddress]: '12 MG Road, Mumbai - 400001',
      [CELL.guarantorPan]: 'ABCD1234EF', // letters/digits right count, wrong structure
    });
    const result = await convert(buf, commercialUcrfFlat, META);

    const errs = panErrors(result.report);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some(e => e.fieldKey === 'gsPan')).toBe(true);
    expect(errs.some(e => e.message.includes('ABCD1234EF'))).toBe(true);
  });

  it('accepts a well-formed guarantor PAN on the same row shape', async () => {
    const buf = await sheetWith({
      [CELL.guarantorType]: '2',
      [CELL.guarantorName]: 'SUNITA DEVI',
      [CELL.guarantorDob]: '01011980',
      [CELL.guarantorGender]: 'FEMALE',
      [CELL.guarantorAddress]: '12 MG Road, Mumbai - 400001',
      [CELL.guarantorPan]: 'AAMCV4474E',
    });
    const result = await convert(buf, commercialUcrfFlat, META);

    expect(panErrors(result.report)).toEqual([]);
    expect(result.outputText).toContain('AAMCV4474E');
  });
});

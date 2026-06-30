import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';
import type { FileMeta, FormatId } from '../packages/core/src/core/types.js';

/**
 * PRE-ROLLOUT GATE — validate every real-world reference file in
 * training-references/ before shipping a build. Catches the class of bug where
 * the unit goldens pass but a different real customer file breaks (e.g. a
 * renamed tab, a shifted layout, a format that maps by fixed column letters).
 *
 * Three kinds of check, driven by the manifest below:
 *   1. golden  — convert with the file's KNOWN-CORRECT meta and assert the output
 *                matches the paired .txt BYTE-FOR-BYTE.
 *   2. smoke   — convert and assert it produces output with ZERO validation
 *                errors (used where we don't have the exact CRIF-assigned meta to
 *                reproduce the paired output, but the file must still convert).
 *   3. reject  — a deliberately WRONG input that MUST be rejected (throw, or a
 *                report with errors / no output). Guards against silently
 *                producing garbage from malformed data.
 *
 * Keep this manifest in sync with training-references/. The companion
 * /validate-references skill regenerates the file list and flags drift.
 */
const here = dirname(fileURLToPath(import.meta.url));
const REF = join(here, '..', 'training-references', 'crif-reporting-io');
const ref = (f: string) => join(REF, f);

type Check =
  | { kind: 'golden'; input: string; output: string; format: FormatId; meta: FileMeta }
  | { kind: 'smoke'; input: string; format: FormatId; meta: FileMeta }
  | { kind: 'reject'; input: string; format: FormatId; meta: FileMeta; why: string };

const META_DEFAULT: FileMeta = {
  memberId: 'NB1234567',
  reportingDate: new Date(Date.UTC(2026, 0, 31)),
  creationDate: new Date(Date.UTC(2026, 2, 26)),
};

const CHECKS: Check[] = [
  // --- byte-exact goldens (proven meta lifted from the dedicated golden specs) ---
  {
    kind: 'golden',
    input: 'client-input-consumer-input-1.xlsx',
    output: 'client-output-consumer-output-1.txt',
    format: 'consumer-ucrf12-flat',
    meta: {
      memberId: '024FP02726', // CRIF-assigned id (replaces the sheet's NB94430001)
      reportingDate: new Date(Date.UTC(2026, 0, 1)), // overridden by sheet D6 = 15042026
      creationDate: new Date(Date.UTC(2026, 3, 17)), // 17042026
    },
  },

  // --- smoke: must convert cleanly (no exact paired meta to byte-reproduce) ---
  // The previously-FAILING file: data on "Sheet1", not "Data Submission Form".
  // This is the regression guard for the sheet-resolution fix.
  { kind: 'smoke', input: 'consumer_input_failing.xlsx', format: 'consumer-ucrf12-flat', meta: META_DEFAULT },
  { kind: 'smoke', input: 'consumer-input-2.xlsx', format: 'consumer-ucrf12-flat', meta: META_DEFAULT },
  { kind: 'smoke', input: 'client-input-commercial-2.xlsx', format: 'commercial-ucrf-flat', meta: META_DEFAULT },
  { kind: 'smoke', input: 'Captree_commercial_input.xlsx', format: 'commercial-ucrf-flat', meta: META_DEFAULT },
];

const err = (r: any) => (r.report?.issues ?? []).filter((i: any) => i.severity === 'error');

describe('reference-files pre-rollout validation', () => {
  // Every manifest input must exist — a renamed/removed reference is itself a failure.
  for (const c of CHECKS) {
    it(`exists: ${c.input}`, () => {
      expect(existsSync(ref(c.input))).toBe(true);
    });
  }

  for (const c of CHECKS) {
    if (c.kind === 'golden') {
      it(`golden (byte-exact): ${c.input} → ${c.output}`, async () => {
        const result: any = await convert(readFileSync(ref(c.input)), getFormat(c.format), c.meta);
        expect(err(result)).toEqual([]);
        expect(existsSync(ref(c.output))).toBe(true);
        const expected = readFileSync(ref(c.output), 'latin1');
        expect(result.outputText).toBe(expected);
      });
    } else if (c.kind === 'smoke') {
      it(`smoke (0 errors): ${c.input}`, async () => {
        const result: any = await convert(readFileSync(ref(c.input)), getFormat(c.format), c.meta);
        const errors = err(result);
        expect(errors, `validation errors: ${errors.map((e: any) => e.message).join('; ')}`).toEqual([]);
        expect(String(result.outputText ?? '').length).toBeGreaterThan(0);
      });
    }
  }

  // --- CATCH WRONG INPUTS: synthetic malformed workbooks must be rejected. ---
  describe('wrong inputs are rejected (not silently mis-converted)', () => {
    const buildWb = async (fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> => {
      const wb = new ExcelJS.Workbook();
      fill(wb.addWorksheet('Sheet1'));
      return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    };

    it('an empty workbook does not yield valid output', async () => {
      const buf = await buildWb(() => {});
      let rejected = false;
      try {
        const r: any = await convert(buf, getFormat('consumer-ucrf12-flat'), META_DEFAULT);
        rejected = err(r).length > 0 || String(r.outputText ?? '').length === 0;
      } catch {
        rejected = true;
      }
      expect(rejected, 'empty workbook should error or produce no output').toBe(true);
    });

    it('a workbook with unrelated columns is rejected by the header-matched commercial format', async () => {
      const buf = await buildWb((ws) => {
        ws.getRow(1).values = ['Foo', 'Bar', 'Baz'];
        ws.getRow(2).values = ['1', '2', '3'];
      });
      let rejected = false;
      try {
        const r: any = await convert(buf, getFormat('commercial-ucrf-flat'), META_DEFAULT);
        rejected = err(r).length > 0 || String(r.outputText ?? '').length === 0;
      } catch (e: any) {
        // The content-based sheet resolver throws a clear "columns not found" error.
        rejected = /not found|columns|sheet/i.test(String(e.message));
      }
      expect(rejected, 'garbage columns should be rejected, not silently converted').toBe(true);
    });

    it('a corrupt (non-xlsx) buffer is rejected', async () => {
      const buf = Buffer.from('this is not a spreadsheet', 'utf8');
      await expect(convert(buf, getFormat('consumer-ucrf12-flat'), META_DEFAULT)).rejects.toBeTruthy();
    });
  });
});

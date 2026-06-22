import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';

/**
 * Real-world Consumer "Data Submission Form" pair shipped in-repo under
 * training-references/. The converter must reproduce the production .txt
 * byte-for-byte from the .xlsx input.
 *
 * Key real-world behaviours asserted here:
 *  - 155-byte TUDF header (no version, no password) carrying TWO dates:
 *    creation date (17042026) then reporting date (15042026).
 *  - Each record's member code is the CRIF-assigned id (024FP02726), NOT the
 *    raw member id typed in the sheet (NB94430001).
 */
const REF_DIR = join(__dirname, '..', 'training-references', 'crif-reporting-io');
const INPUT = join(REF_DIR, 'client-input-consumer-input-1.xlsx');
const OUTPUT = join(REF_DIR, 'client-output-consumer-output-1.txt');

describe('Consumer flat — real in-repo reference pair', () => {
  it('reproduces the production .txt byte-for-byte', async () => {
    // Realistic invocation: the accountant supplies only the CRIF-assigned member
    // id and the creation date; short name + reporting date + password come from
    // the form's own header row (R6) via flatInput.headerCells.
    const buf = readFileSync(INPUT);
    const result = await convert(buf, getFormat('consumer-ucrf12-flat'), {
      memberId: '024FP02726', // CRIF-assigned id (replaces the sheet's NB94430001)
      reportingDate: new Date(Date.UTC(2026, 0, 1)), // overridden by sheet D6 = 15042026
      creationDate: new Date(Date.UTC(2026, 3, 17)), // 17042026 (not in the sheet)
    });

    expect(result.report.ok).toBe(true);

    const expected = readFileSync(OUTPUT, 'latin1');
    expect(result.outputText).toBe(expected);
  });
});

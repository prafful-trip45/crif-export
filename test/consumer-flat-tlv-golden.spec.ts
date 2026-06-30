import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';

/**
 * Real-world Consumer "Data Submission Form" → CANONICAL coded-field TLV pair.
 * The converter must reproduce the production .txt byte-for-byte from the .xlsx.
 *
 * Key behaviours asserted here (distinct from the concatenated consumer-ucrf12-flat):
 *  - 146-char TUDF header (version 12, cycle "NB", password/memberData "None"),
 *    glued onto a single physical line of back-to-back records.
 *  - Each record = PN/ID/PT/EC/PA/TL coded-field segments + ES02**, file ends ES02**TRLR.
 *  - PN name split into 01/02/03 tokens; PA address wrapped at 40 chars with the
 *    comma-break rule into 01..04; TL/10 = "0" + CRIF-assigned member id.
 *  - Account-type 12 → 05 translation.
 */
const REF_DIR = join(__dirname, '..', 'training-references', 'crif-reporting-io');
const INPUT = join(REF_DIR, 'consumer-input-2.xlsx');
const OUTPUT = join(REF_DIR, 'consumer-output-2.txt');

describe('Consumer flat TLV — real in-repo reference pair', () => {
  it('reproduces the production .txt byte-for-byte', async () => {
    const buf = readFileSync(INPUT);
    const result = await convert(buf, getFormat('consumer-ucrf12-flat-tlv'), {
      memberId: '024FP00865', // CRIF-assigned id (replaces the sheet's NB46070001)
      reportingDate: new Date(Date.UTC(2026, 0, 1)), // overridden by sheet D6 = 31052026
      creationDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(result.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.report.ok).toBe(true);

    const expected = readFileSync(OUTPUT, 'latin1');
    expect(result.outputText).toBe(expected);
  });
});

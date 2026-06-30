import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';

/**
 * Resilience: a REAL accountant "Data Submission Form" that diverges from the
 * canonical reference in three ways at once, none of which should break conversion:
 *
 *   1. Tab renamed to the default "Sheet1" (not "Data Submission Form").
 *   2. Form shifted up two rows (labels on row 8, data from row 9; header block
 *      values on row 6 in shifted columns), so the hardcoded labelRow/headerCells
 *      no longer line up — the reader must auto-detect the label + header rows.
 *   3. The address column is labelled "Address 1", not "Address Line 1" (alias),
 *      and dates are typed as plain numbers (15012026), not DDMMYYYY text.
 *
 * Before the fix this threw `Input sheet "Data Submission Form" not found`; the
 * file is a perfectly valid submission form on a renamed tab.
 */
const INPUT = join(__dirname, '..', 'training-references', 'crif-reporting-io', 'consumer_input_failing.xlsx');

describe('Consumer flat — resilient reader (renamed tab / shifted layout / aliases)', () => {
  it('converts a renamed-tab, shifted, alias-labelled form with no errors', async () => {
    const buf = readFileSync(INPUT);
    const result = await convert(buf, getFormat('consumer-ucrf12-flat'), {
      memberId: '024FP02726', // CRIF-assigned id (replaces the sheet's raw 019FP11566)
      creationDate: new Date(Date.UTC(2026, 3, 17)),
      // Deliberately WRONG reporting date: the form's own value (D6 = 15012026)
      // must override it, proving the shifted header block was auto-detected.
      reportingDate: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(result.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.report.ok).toBe(true);

    const lines = (result.outputText ?? '').split('\r\n');
    expect(lines).toHaveLength(7); // 7 consumer records, one per data row (9..15)

    const header = lines[0] ?? '';
    // TUDF header (glued onto record 0): CRIF-assigned member id, plus short name
    // and reporting date auto-detected from the shifted header block (not the flag).
    expect(header.startsWith('TUDF024FP02726')).toBe(true);
    expect(header).toContain('venus-barter'); // short name from the form's B6
    expect(header).toContain('15012026'); // reporting date (numeric) from the form's D6 wins over the flag

    // "Address 1" alias bound: the first record carries the real address, so the
    // mandatory addressLine1 rule is satisfied (no blank-mandatory error above).
    expect(header).toContain('Ozone Desire');
  });
});

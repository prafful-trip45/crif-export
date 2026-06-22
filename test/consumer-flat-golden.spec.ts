import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';

const DATA_DIR = join(homedir(), 'Downloads', 'Data Submission Format');
const INPUT = join(DATA_DIR, 'NB94430001-15052026-19052026-125412-F1-Text.Tap.xlsx');
const OUTPUT = join(DATA_DIR, '024FP02726-15052026-19052026-113111-F1.txt');

// The production output's BODY lines (the format-defined part), which our
// converter must reproduce exactly. The per-record member code is the
// CRIF-assigned id (024FP02726), NOT the raw member id typed in the sheet.
const EXPECTED_REC0 =
  'Dhaval Navnitkumar Patel200619782AIDPP2356F982582222526/B, Keshavbag Society, Sabarmati, Ramnagar, Ahmedabad243800050101024FP02726ADARSHCAPDNP0105111062020150520265000000500000000000109';
const EXPECTED_REC1 =
  'Upendra Chinubhai Shah300119582AIOPS3732M98250051533, Nandi Hill Satellite Road Opp. I.S.R.O Ahmedabad City Ambawadi Vistar Ahmedabad Gujarat243800150101024FP02726ADARSHCAPUCS010510710202515052026110000001100000000000109';

const maybe = existsSync(INPUT) ? describe : describe.skip;

maybe('Consumer flat (Data Submission Form) — real pair', () => {
  it('reproduces each consumer record byte-for-byte from the real input', async () => {
    const buf = readFileSync(INPUT);
    const result = await convert(buf, getFormat('consumer-ucrf12-flat'), {
      memberId: '024FP02726', // CRIF-assigned id (replaces the sheet's NB94430001)
      memberShortName: 'ADARSHCAP',
      reportingDate: new Date(Date.UTC(2026, 4, 15)), // 15052026
      creationDate: new Date(Date.UTC(2026, 4, 15)),
    });

    expect(result.report.ok).toBe(true);
    const text = result.outputText!;
    const lines = text.split('\r\n');

    // Line 0 = 155-byte TUDF header + record0; line 1 = record1.
    const header = lines[0]!.slice(0, 155);
    const rec0 = lines[0]!.slice(155);
    expect(header.length).toBe(155);
    expect(header.startsWith('TUDF024FP02726')).toBe(true);
    expect(rec0).toBe(EXPECTED_REC0);
    expect(lines[1]).toBe(EXPECTED_REC1);
  });

  it('reference: the production output file exists', () => {
    expect(existsSync(OUTPUT)).toBe(true);
  });
});

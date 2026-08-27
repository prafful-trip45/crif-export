import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { convert, getFormat } from '../packages/core/src/index.js';

describe('Commercial Aug 27 State Code Check', () => {
  it('checks state code resolution for Commercial Loan_Final.xlsx', async () => {
    const xlsx = readFileSync('./training-references/commercial-debugging-aug-27/Commercial Loan_Final.xlsx');
    const format = getFormat('commercial-ucrf-flat-v310');
    const res = await convert(xlsx, format, {
      memberId: 'NBFKOVI906',
      creationDate: new Date('2026-08-27'),
      reportingDate: new Date('2026-08-23'),
    }, { allowWarnings: true });

    console.log('=== CONVERSION RESULT ===');
    console.log('OK:', res.report.ok);
    console.log('Output:\n' + res.outputText);
  });
});

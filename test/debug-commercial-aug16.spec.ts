import { readFileSync } from 'node:fs';
import { convert, getFormat } from '../packages/core/src/index.js';
import { compareOutputs } from '../packages/core/src/output/comparator.js';
import { describe, it } from 'vitest';

describe('Debug commercial aug 16', () => {
  it('analyzes commercial rejection', async () => {
    const xlsx = readFileSync('./training-references/commercial-debugging-aug-16/CIC Commercial Data Master Sheet16th August, 2026.xlsx');
    const rejectedTxt = readFileSync('./training-references/commercial-debugging-aug-16/NBF0000708_Commercial_16082026_20082026_144816_W2.txt', 'utf8');

    const formatV310 = getFormat('commercial-ucrf-flat-v310');
    const resV310 = await convert(xlsx, formatV310, {
      memberId: 'NBF0000708',
      creationDate: new Date('2026-08-20'),
      reportingDate: new Date('2026-08-16'),
    }, { allowWarnings: true });

    console.log('=== V3.10 CONVERSION REPORT ===');
    console.log('Report OK:', resV310.report.ok);
    console.log('Issues:', JSON.stringify(resV310.report.issues, null, 2));

    console.log('=== V3.10 GENERATED OUTPUT ===');
    console.log(resV310.outputText);

    const formatV39 = getFormat('commercial-ucrf-flat');
    const resV39 = await convert(xlsx, formatV39, {
      memberId: 'NBF0000708',
      creationDate: new Date('2026-08-20'),
      reportingDate: new Date('2026-08-16'),
    }, { allowWarnings: true });

    const cmpV310 = compareOutputs(formatV310, resV310.outputText || '', rejectedTxt, { ignoreLineEndings: true });
    console.log('=== CMP V3.10 vs REJECTED ===');
    console.log('Match:', cmpV310.match);
    console.log('Summary:', cmpV310.summary);
    console.log('Diffs:', cmpV310.diffs.length);
    console.log(cmpV310.diffs.slice(0, 15));

    const cmpV39 = compareOutputs(formatV39, resV39.outputText || '', rejectedTxt, { ignoreLineEndings: true });
    console.log('=== CMP V3.9 vs REJECTED ===');
    console.log('Match:', cmpV39.match);
    console.log('Summary:', cmpV39.summary);
    console.log('Diffs:', cmpV39.diffs.length);
    console.log(cmpV39.diffs.slice(0, 15));
  });
});

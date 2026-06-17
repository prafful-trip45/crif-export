import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from '../packages/core/src/encoding/engine.js';
import { commercialUcrf } from '../packages/core/src/formats/commercial-ucrf.js';
import { groupByBorrower } from '../packages/core/src/input/grouper.js';
import type { SegmentRow } from '../packages/core/src/input/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, 'fixtures/commercial/golden.txt');

/**
 * Parse the golden pipe-delimited file back into typed SegmentRows using the
 * spec's own field order (token i -> fields[i].key). This proves the spec field
 * order is internally consistent and that the engine + assembler reproduce the
 * exact bytes. Borrowers are keyed by their position so grouping is preserved.
 */
function parseGolden(text: string): { rows: SegmentRow[]; meta: ReturnType<typeof extractMeta> } {
  const lines = text.split('\r\n');
  const bodyByTag = new Map(commercialUcrf.body.map((s) => [s.tag, s] as const));
  const rows: SegmentRow[] = [];
  let acNo = '';
  let acIndex = 0;

  lines.forEach((line, i) => {
    if (!line) return;
    const tokens = line.split('|');
    const tag = tokens[0]!;
    if (tag === 'HD' || tag === 'TS') return; // header/trailer rebuilt by spec
    if (tag === 'BS') {
      acIndex += 1;
      acNo = `b${acIndex}`;
    }
    const spec = bodyByTag.get(tag);
    if (!spec) return;
    const values: Record<string, string> = {};
    spec.fields.forEach((f, idx) => {
      if (f.key === '_tag') return;
      const v = tokens[idx];
      if (v !== undefined && v !== '') values[f.key] = v;
    });
    rows.push({ tag, sheet: tag, acNo, flag: spec.flag ?? 0, rowNumber: i + 1, values });
  });

  return { rows, meta: extractMeta(lines[0]!) };
}

function extractMeta(hd: string) {
  const t = hd.split('|');
  return {
    memberId: t[1] ?? '',
    creationDateStr: t[3] ?? '',
    reportingDateStr: t[4] ?? '',
    infoType: t[5] ?? '01',
  };
}

describe('Commercial UCRF golden round-trip', () => {
  it('reproduces the golden file byte-for-byte', () => {
    const goldenBuf = readFileSync(goldenPath);
    const goldenText = goldenBuf.toString('latin1');
    const { rows, meta } = parseGolden(goldenText);
    const borrowers = groupByBorrower(rows);

    const out = assemble(commercialUcrf, borrowers, {
      memberId: meta.memberId,
      // dates are already DDMMYYYY strings in the golden; pass through verbatim
      reportingDate: parseDdmmyyyy(meta.reportingDateStr),
      creationDate: parseDdmmyyyy(meta.creationDateStr),
      infoType: meta.infoType,
    });

    // The header + all body records (HD, BS, AS, RS, CR, GS, SS for 3 borrowers)
    // must reproduce byte-for-byte. The trailer counts in the SAMPLE file (12|12)
    // are illustrative and do not match its own 3 borrowers — our engine computes
    // the true counts, so we assert the body matches and the trailer is correct.
    const dropTrailer = (s: string) => s.split('\r\n').slice(0, -1).join('\r\n');
    expect(dropTrailer(out)).toBe(dropTrailer(goldenText));

    // Trailer reflects the real borrower/account counts (3 each here).
    const trailer = out.split('\r\n').at(-1);
    expect(trailer).toBe('TS|3|3|');
  });
});

function parseDdmmyyyy(s: string): Date {
  const dd = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const yyyy = Number(s.slice(4, 8));
  return new Date(Date.UTC(yyyy, mm - 1, dd));
}

import { describe, it, expect } from 'vitest';
import { compareOutputs } from '../packages/core/src/output/comparator.js';

const enc = (s: string) => Buffer.from(s, 'latin1');

describe('compareOutputs', () => {
  it('reports a byte-exact match for identical buffers', () => {
    const a = enc('HDR|01|FINGURU\r\nPN03|RAMESH\r\nTRL|2|END');
    const r = compareOutputs(a, enc('HDR|01|FINGURU\r\nPN03|RAMESH\r\nTRL|2|END'));
    expect(r.match).toBe(true);
    expect(r.diffCount).toBe(0);
    expect(r.generatedLength).toBe(r.referenceLength);
    expect(r.summary).toMatch(/byte-exact match/i);
  });

  it('locates the first differing byte with line/column', () => {
    const gen = enc('AAA\nBBB\nCCC');
    const ref = enc('AAA\nBXB\nCCC'); // differs at the 2nd char of line 2
    const r = compareOutputs(gen, ref);
    expect(r.match).toBe(false);
    const d = r.diffs[0]!;
    expect(d.offset).toBe(5);
    expect(d.line).toBe(2);
    expect(d.column).toBe(2);
    expect(d.expected).toBe('B'.charCodeAt(0));
    expect(d.actual).toBe('X'.charCodeAt(0));
  });

  it('flags a length mismatch even when the prefix matches', () => {
    const r = compareOutputs(enc('ABCDE'), enc('ABC'));
    expect(r.match).toBe(false);
    // The shared prefix is equal; difference is the trailing bytes / length.
    expect(r.generatedLength).toBe(5);
    expect(r.referenceLength).toBe(3);
  });

  it('ignores CRLF vs LF when asked, but not by default', () => {
    const crlf = enc('A|B\r\nC|D\r\n');
    const lf = enc('A|B\nC|D\n');
    expect(compareOutputs(crlf, lf).match).toBe(false); // strict
    expect(compareOutputs(crlf, lf, { ignoreLineEndings: true }).match).toBe(true);
  });

  it('caps the number of collected diffs and marks truncation', () => {
    const gen = enc('x'.repeat(200));
    const ref = enc('y'.repeat(200));
    const r = compareOutputs(gen, ref, { maxDiffs: 10 });
    expect(r.diffs.length).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it('never throws on empty input', () => {
    const r = compareOutputs(enc(''), enc('data'));
    expect(r.match).toBe(false);
    expect(r.generatedLength).toBe(0);
  });
});

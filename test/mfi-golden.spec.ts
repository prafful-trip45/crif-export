import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble, encodeSegment } from '../packages/core/src/encoding/engine.js';
import { mfiCdf } from '../packages/core/src/formats/mfi-cdf.js';
import { groupByBorrower } from '../packages/core/src/input/grouper.js';
import type { SegmentRow } from '../packages/core/src/input/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = readFileSync(join(here, 'fixtures/mfi/golden.CDF')).toString('latin1').replace(/\r\n$/, '');

/** Locate the byte offsets of each marker to slice the single-line file. */
function slices(text: string) {
  const cns = text.indexOf('CNSCRD');
  const adr = text.indexOf('ADRCRD');
  const act = text.indexOf('ACTCRD');
  const trl = text.lastIndexOf('TRL');
  return {
    header: text.slice(0, cns),
    cnscrd: text.slice(cns, adr),
    adrcrd: text.slice(adr, act),
    actcrd: text.slice(act, trl),
    trailer: text.slice(trl),
  };
}

function pipeRowFromGolden(seg: typeof mfiCdf.body[number], chunk: string): SegmentRow {
  const tokens = chunk.split('|');
  const values: Record<string, string> = {};
  seg.fields.forEach((f, i) => {
    if (f.key === '_tag') return;
    const v = tokens[i];
    if (v !== undefined && v !== '') values[f.key] = v;
  });
  return { tag: seg.tag, sheet: seg.tag, acNo: 'b1', flag: seg.flag ?? 0, rowNumber: 1, values };
}

describe('MFI CDF golden', () => {
  it('fixed-width segments have consistent declared widths', () => {
    const widthOf = (s: typeof mfiCdf.header) => s.fields.reduce((n, f) => n + (f.length ?? 0), 0);
    expect(widthOf(mfiCdf.header)).toBe(171);
    expect(widthOf(mfiCdf.trailer)).toBe(41);
  });

  it('reproduces the header byte-for-byte', () => {
    const { header } = slices(golden);
    const meta = parseHeaderMeta(header);
    const out = encodeSegment(mfiCdf.header, mfiCdf.buildHeaderRow(meta));
    expect(out).toBe(header);
  });

  it('reproduces the trailer byte-for-byte', () => {
    const { trailer } = slices(golden);
    const out = encodeSegment(mfiCdf.trailer, mfiCdf.buildTrailerRow(
      { borrowerCount: 1, accountCount: 1, addressCount: 1, segmentCount: 3 },
      { memberId: 'MFI0000XXX', version: '1.9', reportingDate: new Date(), creationDate: new Date() },
    ));
    expect(out).toBe(trailer);
  });

  it('reproduces each pipe-delimited body segment byte-for-byte', () => {
    const s = slices(golden);
    const [cns, adr, act] = mfiCdf.body;
    expect(encodeSegment(cns!, pipeRowFromGolden(cns!, s.cnscrd).values)).toBe(s.cnscrd);
    expect(encodeSegment(adr!, pipeRowFromGolden(adr!, s.adrcrd).values)).toBe(s.adrcrd);
    expect(encodeSegment(act!, pipeRowFromGolden(act!, s.actcrd).values)).toBe(s.actcrd);
  });

  it('assembles the full single-line file byte-for-byte', () => {
    const s = slices(golden);
    const [cns, adr, act] = mfiCdf.body;
    const rows = [
      pipeRowFromGolden(cns!, s.cnscrd),
      pipeRowFromGolden(adr!, s.adrcrd),
      pipeRowFromGolden(act!, s.actcrd),
    ];
    const borrowers = groupByBorrower(rows);
    const meta = parseHeaderMeta(s.header);
    const out = assemble(mfiCdf, borrowers, meta).replace(/\r\n$/, '');
    expect(out).toBe(golden);
  });
});

function parseHeaderMeta(h: string) {
  // Slice fixed widths matching the spec.
  return {
    version: h.slice(8, 11),
    memberId: h.slice(11, 21),
    memberName: h.slice(21, 51).trimEnd(),
    branchId: h.slice(51, 61).trimEnd(),
    reportingDate: parseDate(h.slice(61, 69)),
    creationDate: parseDate(h.slice(69, 77)),
    orgStructure: h.slice(77, 80).trimEnd(),
    password: h.slice(80, 110).trimEnd(),
    vendorId: h.slice(110, 140).trimEnd(),
    vendorVersion: h.slice(140, 170).trimEnd(),
  };
}

function parseDate(s: string): Date {
  return new Date(Date.UTC(+s.slice(4, 8), +s.slice(2, 4) - 1, +s.slice(0, 2)));
}

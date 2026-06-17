import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeSegment } from '../packages/core/src/encoding/engine.js';
import { consumerUcrf12 } from '../packages/core/src/formats/consumer-ucrf12.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = readFileSync(join(here, 'fixtures/consumer/golden.txt')).toString('latin1');
const lines = golden.split('\r\n');
const header146 = lines[0]!.slice(0, 146);
const body = golden.slice(146).replace(/\r\n/g, ''); // continuous segment stream

const seg = (tag: string) => consumerUcrf12.body.find((s) => s.tag === tag)!;

describe('Consumer UCRF-12 coded-field encoding', () => {
  it('TUDF header is exactly 146 fixed-width chars', () => {
    const width = consumerUcrf12.header.fields.reduce((n, f) => n + (f.length ?? 0), 0);
    expect(width).toBe(146);
  });

  it('reproduces the 146-char TUDF header byte-for-byte', () => {
    const out = encodeSegment(consumerUcrf12.header, {
      _recordType: 'TUDF',
      version: '12',
      memberId: 'COP0000XXX',
      memberShortName: 'CRIFHIGH',
      cycleId: '',
      reportingDate: '30042024',
      password: 'ABC9081975',
      authMethod: 'L',
      futureUse: '00000',
      memberData: '',
    });
    expect(out).toBe(header146);
  });

  it('encodes the PN segment to the golden bytes', () => {
    const out = encodeSegment(seg('PN'), { name: 'Mahima Jain', dateOfBirth: '05051986', gender: '1' });
    expect(out).toBe('PN03N010111Mahima Jain07080505198608011');
  });

  it('encodes the PA segment to the golden bytes', () => {
    const out = encodeSegment(seg('PA'), {
      addressLine1: 'AXIS CENTRA',
      city: 'PUNE',
      stateCode: '27',
      pinCode: '110450',
      addressCategory: '01',
    });
    expect(out).toBe('PA03A010111AXIS CENTRA0304PUNE0602270706110450080201');
  });

  it('encodes the PT segment to the golden bytes (sans trailing pad)', () => {
    const out = encodeSegment(seg('PT'), { phoneNumber: '9999999999', phoneType: '01' });
    expect(out).toBe('PT03T0101109999999999030201');
  });

  it('round-trips PN, PA, PT bytes that appear in the golden body stream', () => {
    expect(body).toContain('PN03N010111Mahima Jain07080505198608011');
    expect(body).toContain('PA03A010111AXIS CENTRA0304PUNE0602270706110450080201');
    expect(body.endsWith('ES02**TRLR')).toBe(true);
  });
});

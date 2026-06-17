import { describe, expect, it } from 'vitest';
import { encodeSegment } from '../packages/core/src/encoding/engine.js';
import { commercialUcrf } from '../packages/core/src/formats/commercial-ucrf.js';

const byTag = (t: string) =>
  [commercialUcrf.header, ...commercialUcrf.body, commercialUcrf.trailer].find((s) => s.tag === t)!;

describe('Commercial UCRF pipe-delimited encoding', () => {
  it('encodes the HD header to the golden line', () => {
    const row = commercialUcrf.buildHeaderRow({
      memberId: 'NBF1111111',
      reportingDate: new Date(Date.UTC(2017, 7, 31)),
      creationDate: new Date(Date.UTC(2017, 7, 31)),
      infoType: '01',
    });
    expect(encodeSegment(byTag('HD'), row)).toBe('HD|NBF1111111||31082017|31082017|01|');
  });

  it('encodes a BS record to the golden line', () => {
    const row = {
      _tag: 'BS',
      memberBranchCode: '110000',
      borrowerName: 'ABC PVT.LTD',
      borrowerShortName: 'ABC',
      dateOfIncorporation: '04082004',
      pan: 'AACCT1331J',
      companyRegNumber: 'U12345DL1234PTC123456',
      legalConstitution: '11',
      businessCategory: '07',
      businessIndustryType: '01',
    };
    expect(encodeSegment(byTag('BS'), row)).toBe(
      'BS|110000||ABC PVT.LTD|ABC||04082004|AACCT1331J|U12345DL1234PTC123456||||11|07|01|||||||||||||',
    );
  });

  it('encodes the TS trailer with computed counts', () => {
    const row = commercialUcrf.buildTrailerRow(
      { borrowerCount: 12, accountCount: 12, addressCount: 0, segmentCount: 0 },
      { memberId: 'X', reportingDate: new Date(), creationDate: new Date() },
    );
    expect(encodeSegment(byTag('TS'), row)).toBe('TS|12|12|');
  });
});

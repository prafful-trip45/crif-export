/** Generate the offline PIN/state index from the Department of Posts CSV.
 * Usage: node scripts/import-india-pincodes.mjs /path/to/pincode.csv
 * CSV parser is supplied by the existing ExcelJS dependency.
 */
import { parseFile } from '@fast-csv/parse';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2];
if (!source) throw new Error('Pass the downloaded Department of Posts pincode.csv');
const codes = {
  'ANDAMAN AND NICOBAR ISLANDS': '01', 'ANDHRA PRADESH': '02', 'ARUNACHAL PRADESH': '03',
  ASSAM: '04', BIHAR: '05', CHANDIGARH: '06', CHHATTISGARH: '07',
  'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU': '08',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': '08', 'DADRA AND NAGAR HAVELI': '08',
  'DAMAN AND DIU': '08', GOA: '10', GUJARAT: '11', HARYANA: '12',
  'HIMACHAL PRADESH': '13', 'JAMMU AND KASHMIR': '14', JHARKHAND: '15',
  KARNATAKA: '16', KERALA: '17', LAKSHADWEEP: '18', 'MADHYA PRADESH': '19',
  MAHARASHTRA: '20', MANIPUR: '21', MEGHALAYA: '22', MIZORAM: '23', NAGALAND: '24',
  DELHI: '25', ODISHA: '26', ORISSA: '26', PUDUCHERRY: '27', PUNJAB: '28',
  RAJASTHAN: '29', SIKKIM: '30', 'TAMIL NADU': '31', TRIPURA: '32',
  'UTTAR PRADESH': '33', UTTARAKHAND: '34', 'WEST BENGAL': '35', TELANGANA: '36', LADAKH: '37',
};
const byState = new Map();
const byPin = new Map();
let offices = 0;
let missingStateRows = 0;
for await (const record of parseFile(source, { headers: true, ignoreEmpty: true, trim: true })) {
  const pin = record.pincode;
  const state = record.statename?.toUpperCase().replaceAll('&', 'AND').replace(/\s+/g, ' ').trim();
  const code = codes[state];
  if (!/^[1-9]\d{5}$/.test(pin ?? '') || (!code && state !== 'NA')) {
    throw new Error(`Unrecognised source row: PIN=${pin}, state=${state}. Review before importing.`);
  }
  offices++;
  if (!byPin.has(pin)) byPin.set(pin, new Set());
  if (state === 'NA') { missingStateRows++; continue; }
  if (!byState.has(code)) byState.set(code, new Set());
  byState.get(code).add(pin);
  byPin.get(pin).add(code);
}
// Refuse partial downloads and incomplete state coverage. All 36 current states/UTs
// must be present. Preserve EVERY state associated with a shared PIN.
if (offices < 150000 || byPin.size < 19000 || byState.size !== 36) {
  throw new Error(`Incomplete directory: ${offices} offices, ${byPin.size} PINs, ${byState.size} states/UTs`);
}
const data = {
  source: 'https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month',
  publisher: 'Department of Posts, Ministry of Communications, Government of India',
  license: 'Government Open Data License - India',
  retrieved: new Date().toISOString().slice(0, 10),
  sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
  officeCount: offices,
  pinCount: byPin.size,
  stateCount: byState.size,
  sharedPinCount: [...byPin.values()].filter(states => states.size > 1).length,
  missingStateRows,
  pinsWithoutState: [...byPin].filter(([, states]) => states.size === 0).map(([pin]) => pin).sort(),
  pinsByCommercialState: Object.fromEntries([...byState].sort(([a], [b]) => a.localeCompare(b))
    .map(([code, pins]) => [code, [...pins].sort().join(' ')])),
};
writeFileSync(new URL('../packages/core/src/formats/enums/india-pincodes.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log({ offices, pins: data.pinCount, states: data.stateCount, sharedPins: data.sharedPinCount });

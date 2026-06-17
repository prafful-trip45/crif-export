import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convert } from '../packages/core/src/core/pipeline.js';
import { getFormat } from '../packages/core/src/formats/index.js';

const fmt = getFormat('mfi-cdf');

async function workbook(disbursedDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const add = (tag: string, row: Record<string, unknown>) => {
    const seg = fmt.body.find((s) => s.tag === tag)!;
    const df = seg.fields.filter((f) => f.key !== '_tag' && !f.key.startsWith('_'));
    const ws = wb.addWorksheet(tag);
    ws.addRow(['A/c No.', 'Flag', ...df.map((f) => f.label ?? f.key)]);
    ws.addRow(['M1', seg.flag ?? 0, ...df.map((f) => (row[f.key] ?? '') as string)]);
  };
  add('CNSCRD', {
    memberIdentifier: '123', branchIdentifier: 'BR', kendraIdentifier: 'KN', memberName1: 'Asha',
    birthDate: '01011990', age: 32, ageAsOnDate: 34, gender: 'F', maritalStatus: 'M01',
    keyPersonName: 'Ram', keyPersonRelationship: 'K02',
  });
  add('ADRCRD', {
    permanentAddress: 'Vellore', permanentState: 'TN', permanentPin: '635851',
    currentAddress: 'Vellore', currentState: 'TN', currentPin: '635851',
  });
  // ACTCRD WITHOUT installments/frequency/installmentAmount
  add('ACTCRD', {
    uniqueAccountRef: '456', accountNumber: '456', actBranchIdentifier: 'BR', actKendraIdentifier: 'KN',
    dateOfAccountInfo: '30042024', loanCategory: 'T02', loanPurpose: 'Loan', accountStatus: 'S04',
    disbursedDate, sanctionedAmount: 35000, disbursedAmount: 35000, currentBalance: 1845, amountOverdue: 0,
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('MFI conditional-mandatory (new disbursals from 1-Apr-2022)', () => {
  it('requires installments/frequency/installmentAmount for a 2024 disbursal', async () => {
    const buf = await workbook('30042024');
    const r = await convert(buf, fmt, { memberId: 'MFI0000XXX', reportingDate: new Date(), creationDate: new Date() });
    const keys = r.report.errors.map((e) => e.fieldKey);
    expect(keys).toContain('numInstallments');
    expect(keys).toContain('repaymentFrequency');
    expect(keys).toContain('installmentAmount');
  });

  it('does NOT require them for a pre-2022 disbursal', async () => {
    const buf = await workbook('15032021');
    const r = await convert(buf, fmt, { memberId: 'MFI0000XXX', reportingDate: new Date(), creationDate: new Date() });
    const keys = r.report.errors.map((e) => e.fieldKey);
    expect(keys).not.toContain('numInstallments');
    expect(keys).not.toContain('repaymentFrequency');
    expect(keys).not.toContain('installmentAmount');
  });
});

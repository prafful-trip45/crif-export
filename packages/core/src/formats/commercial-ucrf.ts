import type { FieldSpec, FormatSpec, SegmentSpec, TypedRow } from '../core/types.js';
import { formatDdmmyyyy } from '../encoding/formatters/date.js';
import { CURRENCY, INFO_TYPE } from './enums/commercial-enums.js';

/**
 * Commercial UCRF V3.9 (pipe-delimited).
 *
 * Each record is `TAG|f1|f2|...`. The tag is the first pipe token, modelled as a
 * field with a literal default so the pipe-delimited strategy emits it naturally.
 * Field order below reproduces the CRIF "Copy of Commercial_format__file.xlsx"
 * column order and the provided golden sample exactly.
 *
 * Golden reference lines:
 *   HD|NBF1111111||31082017|31082017|01|
 *   BS|110000||ABC PVT.LTD|ABC||04082004|AACCT1331J|U12345DL1234PTC123456||||11|07|01|||||||||||||
 *   AS|01|999999999|6652/7, Block ,09 Dev Nagar|||New Delhi||25|110005|079|||||||
 *   CR|300003||14092013|17370000|INR|4000||01|0|456912||||0001|31082017|0|||||||||01|31082017||||||||0|||||||||
 *   TS|12|12|
 */

const tag = (t: string): FieldSpec => ({ key: '_tag', type: 'string', mandatory: true, default: t });
const opt = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  type: 'string',
  mandatory: false,
  ...extra,
});
const req = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  type: 'string',
  mandatory: true,
  ...extra,
});
const date = (key: string, label: string, mandatory = false): FieldSpec => ({
  key,
  label,
  type: 'date-ddmmyyyy',
  mandatory,
});

const HD: SegmentSpec = {
  tag: 'HD',
  encoding: 'pipe-delimited',
  flag: 0,
  cardinality: 'header',
  fields: [
    tag('HD'),
    req('memberId', 'Member ID'),
    opt('prevMemberId', 'Previous Member ID'),
    date('creationDate', 'Date of Creation & Certification of Input File', true),
    date('reportingDate', 'Reporting / Cycle Date', true),
    req('infoType', 'Information Type', { type: 'enum', enum: INFO_TYPE, default: '01' }),
    opt('hdFiller', 'Filler'),
  ],
};

const BS: SegmentSpec = {
  tag: 'BS',
  encoding: 'pipe-delimited',
  flag: 1,
  cardinality: 'one-per-borrower',
  // Token order verified against golden BS (28 tokens). The CRIF template's
  // human column order differs from the wire order; the wire order is canonical.
  fields: [
    tag('BS'), // 0
    opt('memberBranchCode', 'Member Branch Code'), // 1
    opt('prevMemberBranchCode', 'Previous Member Branch Code'), // 2
    req('borrowerName', 'Borrower Name'), // 3
    opt('borrowerShortName', 'Borrower Short Name'), // 4
    opt('bsReserved5', 'Reserved'), // 5 (empty in golden)
    date('dateOfIncorporation', 'Date of Incorporation'), // 6
    opt('pan', 'PAN'), // 7
    opt('companyRegNumber', 'Company Registration Number'), // 8 (CIN/registration)
    opt('cin', 'CIN'), // 9
    opt('tin', 'TIN'), // 10
    opt('serviceTaxNo', 'Service Tax #'), // 11
    opt('legalConstitution', 'Borrowers Legal Constitution'), // 12
    opt('businessCategory', 'Business Category'), // 13
    opt('businessIndustryType', 'Business/ Industry Type'), // 14
    opt('classOfActivity1', 'Class of Activity 1'), // 15
    opt('classOfActivity2', 'Class of Activity 2'), // 16
    opt('classOfActivity3', 'Class of Activity 3'), // 17
    opt('sicCode', 'SIC Code'), // 18
    opt('salesFigure', 'Sales Figure', { type: 'numeric' }), // 19
    opt('financialYear', 'Financial Year'), // 20
    opt('numberOfEmployees', 'Number of Employees', { type: 'numeric' }), // 21
    opt('creditRating', 'Credit Rating'), // 22
    opt('assessmentAgency', 'Assessment Agency / Authority'), // 23
    date('creditRatingAsOn', 'Credit Rating As On'), // 24
    date('creditRatingExpiry', 'Credit Rating Expiry Date'), // 25
    opt('otherId', 'Other ID'), // 26
    opt('bsFiller', 'Filler'), // 27
  ],
};

const AS: SegmentSpec = {
  tag: 'AS',
  encoding: 'pipe-delimited',
  flag: 2,
  cardinality: 'one-per-borrower',
  fields: [
    tag('AS'),
    opt('officeLocationType', 'Borrower Office Location Type'),
    opt('officeDunsNumber', 'Borrower Office DUNS Number'),
    req('addressLine1', 'Address Line 1'),
    opt('addressLine2', 'Address Line 2'),
    opt('addressLine3', 'Address Line 3'),
    opt('cityTown', 'City/Town'),
    opt('district', 'District'),
    opt('stateCode', 'State/Union Territory'),
    opt('pinCode', 'Pin Code'),
    opt('country', 'Country'),
    opt('mobileNumber', 'Mobile Number(s)'),
    opt('telAreaCode', 'Telephone Area Code'),
    opt('telNumber', 'Telephone Number(s)'),
    opt('faxAreaCode', 'Fax Area Code'),
    opt('faxNumber', 'Fax Number(s)'),
    opt('asFiller', 'Filler'),
    opt('asFiller2', 'Filler'), // pad to golden 18-token width
  ],
};

const RS: SegmentSpec = {
  tag: 'RS',
  encoding: 'pipe-delimited',
  flag: 3,
  cardinality: 'many',
  fields: [
    tag('RS'),
    opt('relationshipDuns', 'Relationship DUNS Number'),
    opt('relatedType', 'Related Type'),
    opt('relationship', 'Relationship'),
    opt('businessEntityName', 'Business Entity Name'),
    opt('rsBusinessCategory', 'Business Category'),
    opt('rsBusinessIndustryType', 'Business / Industry Type'),
    opt('namePrefix', 'Individual Name Prefix'),
    opt('fullName', 'Full Name'),
    opt('gender', 'Gender'),
    opt('rsCompanyRegNumber', 'Company Registration Number'),
    date('rsDateOfIncorporation', 'Date of Incorporation'),
    date('dateOfBirth', 'Date of Birth'),
    opt('rsPan', 'PAN'),
    opt('voterId', 'Voter ID'),
    opt('passportNumber', 'Passport Number'),
    opt('drivingLicence', 'Driving Licence ID'),
    opt('uid', 'UID'),
    opt('rationCard', 'Ration Card No'),
    opt('rsCin', 'CIN'),
    opt('din', 'DIN'),
    opt('rsTin', 'TIN'),
    opt('rsServiceTax', 'Service Tax #'),
    opt('rsOtherId', 'Other ID'),
    opt('percentControl', 'Percentage of Control'),
    opt('rsAddressLine1', 'Address Line 1'),
    opt('rsAddressLine2', 'Address Line 2'),
    opt('rsAddressLine3', 'Address Line 3'),
    opt('rsCity', 'City/Town'),
    opt('rsDistrict', 'District'),
    opt('rsStateCode', 'State/Union Territory'),
    opt('rsPinCode', 'Pin Code'),
    opt('rsCountry', 'Country'),
    opt('rsMobile', 'Mobile Number(s)'),
    opt('rsTelNumber', 'Telephone Number(s)'),
    opt('rsTelAreaCode', 'Telephone Area Code'),
    opt('rsFaxNumber', 'Fax Number(s)'),
    opt('rsFaxAreaCode', 'Fax Area Code'),
    opt('rsFiller', 'Filler'),
    opt('rsFiller2', 'Filler'), // pad to golden 40-token width
  ],
};

const CR: SegmentSpec = {
  tag: 'CR',
  encoding: 'pipe-delimited',
  flag: 4,
  cardinality: 'many',
  fields: [
    tag('CR'),
    req('accountNumber', 'Account Number'),
    opt('prevAccountNumber', 'Previous Account Number'),
    date('sanctionDate', 'Facility / Loan Activation / Sanction Date', true),
    req('sanctionedAmount', 'Sanctioned Amount/ Notional Amount of Contract', { type: 'numeric' }),
    req('currencyCode', 'Currency Code', { type: 'enum', enum: CURRENCY, default: 'INR' }),
    opt('creditType', 'Credit Type'),
    opt('tenure', 'Tenure / Weighted Average maturity period of Contracts'),
    opt('repaymentFrequency', 'Repayment Frequency'),
    opt('drawingPower', 'Drawing Power', { type: 'numeric' }),
    opt('currentBalance', 'Current Balance / Limit Utilized /Mark to Market', { type: 'numeric' }),
    opt('notionalOutstanding', 'Notional Amount of Out-standing Restructured Contracts', { type: 'numeric' }),
    date('loanExpiryDate', 'Loan Expiry / Maturity Date'),
    date('loanRenewalDate', 'Loan Renewal Date'),
    opt('assetClassification', 'Asset Classification/Number of days past due NDPD'),
    date('assetClassificationDate', 'Asset Classification Date'),
    opt('amountOverdue', 'Amount Overdue / Limit Overdue', { type: 'numeric' }),
    opt('overdueBucket01', 'Overdue Bucket 01 ( 1 - 30 days)', { type: 'numeric' }),
    opt('overdueBucket02', 'Overdue Bucket 02 ( 31 - 60 days)', { type: 'numeric' }),
    opt('overdueBucket03', 'Overdue Bucket 03 ( 61 - 90 days)', { type: 'numeric' }),
    opt('overdueBucket04', 'Overdue Bucket 04 (91 - 180 days)', { type: 'numeric' }),
    opt('overdueBucket05', 'Overdue Bucket 05 (Above 180 days)', { type: 'numeric' }),
    opt('highCredit', 'High Credit', { type: 'numeric' }),
    opt('installmentAmount', 'Installment Amount', { type: 'numeric' }),
    opt('lastRepaidAmount', 'Last Repaid Amount', { type: 'numeric' }),
    opt('accountStatus', 'Account Status'),
    date('accountStatusDate', 'Account Status Date'),
    opt('writtenOffAmount', 'Written Off Amount', { type: 'numeric' }),
    opt('settledAmount', 'Settled Amount', { type: 'numeric' }),
    opt('restructureReason', 'Major reasons for Restructuring'),
    opt('npaAmount', 'Amount of Contracts Classified as NPA', { type: 'numeric' }),
    opt('assetSecurityCoverage', 'Asset based Security coverage'),
    opt('guaranteeCoverage', 'Guarantee Coverage'),
    opt('bankRemarkCode', 'Bank Remark Code'),
    opt('wilfulDefaultStatus', 'Wilful Default Status'),
    date('wilfulDefaultDate', 'Date Classified as Wilful Default'),
    opt('suitFiledStatus', 'Suit Filed Status'),
    opt('suitReferenceNumber', 'Suit Reference Number'),
    opt('suitAmount', 'Suit Amount in Rupees', { type: 'numeric' }),
    date('dateOfSuit', 'Date of Suit'),
    opt('disputeId', 'Dispute ID No.'),
    opt('transactionTypeCode', 'Transaction Type Code'),
    opt('otherBk', 'OTHER_BK'),
    opt('ufceAmount', 'UFCE (Amount)', { type: 'numeric' }),
  ],
};

const GS: SegmentSpec = {
  tag: 'GS',
  encoding: 'pipe-delimited',
  flag: 5,
  cardinality: 'many',
  fields: [
    tag('GS'),
    opt('gsDuns', 'Guarantor DUNS Number'),
    opt('gsRelatedType', 'Related Type'),
    opt('gsBusinessCategory', 'Business Category'),
    opt('gsBusinessIndustryType', 'Business / Industry Type'),
    opt('gsNamePrefix', 'Individual Name Prefix'),
    opt('gsFullName', 'Full Name'),
    opt('gsGender', 'Gender'),
    opt('gsCompanyRegNumber', 'Company Registration Number'),
    date('gsDateOfIncorporation', 'Date of Incorporation'),
    date('gsDateOfBirth', 'Date of Birth'),
    opt('gsPan', 'PAN'),
    opt('gsVoterId', 'Voter ID'),
    opt('gsPassport', 'Passport Number'),
    opt('gsDrivingLicence', 'Driving Licence ID'),
    opt('gsUid', 'UID'),
    opt('gsRationCard', 'Ration Card No'),
    opt('gsAddressLine1', 'Address Line 1'),
    opt('gsAddressLine2', 'Address Line 2'),
    opt('gsAddressLine3', 'Address Line 3'),
    opt('gsCity', 'City/Town'),
    opt('gsDistrict', 'District'),
    opt('gsStateCode', 'State/Union Territory'),
    opt('gsPinCode', 'Pin Code'),
    opt('gsCountry', 'Country'),
    opt('gsMobile', 'Mobile Number(s)'),
    opt('gsTelNumber', 'Telephone Number(s)'),
    opt('gsTelAreaCode', 'Telephone Area Code'),
    opt('gsFaxNumber', 'Fax Number(s)'),
    opt('gsFaxAreaCode', 'Fax Area Code'),
    opt('gsPercentControl', 'Percentage of Control'),
    opt('gsCin', 'CIN'),
    opt('gsDin', 'DIN'),
    opt('gsTin', 'TIN'),
    opt('gsServiceTax', 'Service Tax #'),
    opt('gsOtherId', 'Other ID'),
    opt('gsFiller', 'Filler'),
    opt('gsFiller2', 'Filler'), // pad to golden 38-token width
  ],
};

const SS: SegmentSpec = {
  tag: 'SS',
  encoding: 'pipe-delimited',
  flag: 6,
  cardinality: 'many',
  fields: [
    tag('SS'),
    opt('securityValue', 'Value of Security', { type: 'numeric' }),
    opt('ssCurrency', 'Currency', { type: 'enum', enum: CURRENCY, default: 'INR' }),
    opt('securityType', 'Type of Security'),
    opt('securityClassification', 'Security Classification'),
    opt('securityDate', 'Date of Valuation'),
    opt('ssFiller', 'Filler'),
    opt('ssFiller2', 'Filler'), // pad to golden 8-token width
  ],
};

const CD: SegmentSpec = {
  tag: 'CD',
  encoding: 'pipe-delimited',
  flag: 7,
  cardinality: 'many',
  fields: [
    tag('CD'),
    date('dateOfDishonour', 'Date of Dishonour'),
    opt('dishonourAmount', 'Amount', { type: 'numeric' }),
    opt('instrumentNumber', 'Instrument / Cheque Number'),
    opt('timesDishonoured', 'Number of times dishonoured', { type: 'numeric' }),
    date('chequeIssueDate', 'Cheque Issue Date'),
    opt('reasonForDishonour', 'Reason for Dishonour'),
    opt('cdFiller', 'Filler'),
  ],
};

const TS: SegmentSpec = {
  tag: 'TS',
  encoding: 'pipe-delimited',
  flag: 99,
  cardinality: 'trailer',
  fields: [
    tag('TS'),
    req('borrowerCount', 'Total Borrower Count', { type: 'numeric' }),
    req('accountCount', 'Total Account Count', { type: 'numeric' }),
    opt('tsFiller', 'Filler'),
  ],
};

export const commercialUcrf: FormatSpec = {
  id: 'commercial-ucrf',
  label: 'Commercial UCRF V3.9',
  version: '3.9',
  outputExtension: '.txt',
  physicalLayout: 'one-line-per-record',
  lineEnding: '\r\n',
  fileEncoding: 'latin1',
  header: HD,
  body: [BS, AS, RS, CR, GS, SS, CD],
  trailer: TS,
  buildHeaderRow: (meta): TypedRow => ({
    _tag: 'HD',
    memberId: meta.memberId,
    prevMemberId: '',
    creationDate: formatDdmmyyyy(meta.creationDate),
    reportingDate: formatDdmmyyyy(meta.reportingDate),
    infoType: (meta.infoType as string) ?? '01',
    hdFiller: '',
  }),
  buildTrailerRow: (counts): TypedRow => ({
    _tag: 'TS',
    borrowerCount: counts.borrowerCount,
    accountCount: counts.accountCount,
    tsFiller: '',
  }),
};

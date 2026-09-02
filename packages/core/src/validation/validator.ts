import { ValidationReport, type ValidationIssue } from '../core/result.js';
import type { FieldSpec, FormatSpec, SegmentSpec } from '../core/types.js';
import { formatValue } from '../encoding/formatters/value.js';
import type { Borrower, SegmentRow } from '../input/model.js';
import { formatRuleFor } from './rules.js';

/**
 * Walk every borrower -> segment -> field and accumulate row/field-level issues
 * (never throw-on-first). Also checks per-borrower cardinality against the spec.
 */
export function validate(format: FormatSpec, borrowers: Borrower[]): ValidationReport {
  const report = new ValidationReport();
  const specByTag = new Map(format.body.map((s) => [s.tag, s] as const));

  // Empty-input guard: a workbook that yields no borrower data (wrong file, wrong
  // sheet, or an empty sheet) would otherwise emit a header-only file with NO
  // errors — something a user could unknowingly submit to the bureau. Treat zero
  // records as a blocking error rather than a silent empty submission.
  const totalSegments = borrowers.reduce((n, b) => n + b.segments.length, 0);
  if (borrowers.length === 0 || totalSegments === 0) {
    report.add({
      severity: 'error',
      sheet: '',
      acNo: '',
      rowNumber: 0,
      fieldKey: '',
      rule: 'empty-input',
      message:
        'No records found in the input. Check that the data is on the expected ' +
        'sheet with the correct column headers — nothing was read.',
      reference: `${format.label} v${format.version} input workbook layout`,
      value: undefined,
    });
    return report;
  }

  for (const borrower of borrowers) {
    const tagCounts = new Map<string, number>();
    for (const seg of borrower.segments) {
      tagCounts.set(seg.tag, (tagCounts.get(seg.tag) ?? 0) + 1);
      const spec = specByTag.get(seg.tag);
      if (!spec) continue;
      validateRow(report, format, spec, seg);
    }
    checkCardinality(report, format, borrower, tagCounts);

    for (const message of format.checkBorrower?.(borrower.segments) ?? []) {
      const first = borrower.segments[0];
      report.add({
        severity: 'error',
        sheet: first?.sheet ?? '',
        acNo: borrower.acNo,
        rowNumber: first?.rowNumber ?? 0,
        fieldKey: '',
        rule: 'portal-mandatory',
        message,
        reference: referenceFor(format, undefined, undefined, 'portal-mandatory', message),
        value: undefined,
      });
    }
  }

  return report;
}

function validateRow(report: ValidationReport, format: FormatSpec, spec: SegmentSpec, row: SegmentRow): void {
  // Surface issues raised while reading/mapping the row (e.g. an unmatched lookup).
  for (const ri of row.readerIssues ?? []) {
    report.add({
      severity: ri.severity ?? 'error',
      sheet: row.sheet,
      acNo: row.acNo,
      rowNumber: row.rowNumber,
      column: row.sourceColumns?.[ri.fieldKey],
      fieldKey: ri.fieldKey,
      rule: ri.rule ?? 'lookup',
      message: ri.message,
      reference: ri.reference ?? referenceFor(format, spec, undefined, ri.rule ?? 'lookup', ri.message),
      value: row.values[ri.fieldKey],
      bypassable: ri.blocksBypass ? false : undefined,
    });
  }

  for (const field of spec.fields) {
    const value = row.values[field.key];
    const raw = formatValue(field, value);
    const present = raw !== '';

    const mandatory =
      typeof field.mandatory === 'function' ? field.mandatory(row.values) : field.mandatory;

    if (mandatory && !present) {
      const severity = field.mandatorySeverity ?? 'error';
      report.add(issue(format, spec, row, field, 'mandatory', severity, `Required field "${label(field)}" is blank`, value));
      continue;
    }
    if (!present) continue;

    // enum membership
    if (field.enum && !(raw in field.enum)) {
      report.add(
        issue(format, spec, row, field, 'enum', 'error', `Value "${raw}" is not an allowed code for "${label(field)}"`, value),
      );
    }

    // date parseability (coerce already tried; a leftover non-8-digit string fails)
    if ((field.type === 'date-ddmmyyyy' || field.type === 'date-ddmmccyy') && !/^\d{8}$/.test(raw)) {
      report.add(issue(format, spec, row, field, 'date', 'error', `Value "${raw}" is not a valid date (expected DDMMYYYY)`, value));
    }

    // format rules (PAN/PIN/phone/Aadhaar) keyed off field key
    const rule = formatRuleFor(field.key);
    if (rule && !rule(raw)) {
      report.add(issue(format, spec, row, field, 'format', 'error', `Value "${raw}" has an invalid format for "${label(field)}"`, value));
    }

    // length: over-length is an error for fixed-width/coded; a warning-cap for pipe maxLength
    const cap = field.length ?? field.maxLength;
    if (spec.encoding !== 'pipe-delimited' && field.length && raw.length > field.length) {
      report.add(
        issue(format, spec, row, field, 'length', 'error', `Value "${raw}" exceeds fixed width ${field.length} for "${label(field)}"`, value),
      );
    } else if (field.maxLength && raw.length > field.maxLength) {
      report.add(
        issue(format, spec, row, field, 'length', 'error', `Value length ${raw.length} exceeds max ${field.maxLength} for "${label(field)}"`, value),
      );
    } else if (spec.encoding === 'coded-field' && raw.length > 99) {
      report.add(
        issue(format, spec, row, field, 'length', 'error', `Coded field "${label(field)}" value length ${raw.length} exceeds 99`, value),
      );
    }
    void cap;
  }
}

function checkCardinality(
  report: ValidationReport,
  format: FormatSpec,
  borrower: Borrower,
  counts: Map<string, number>,
): void {
  for (const spec of format.body) {
    const n = counts.get(spec.tag) ?? 0;
    const fail =
      (spec.cardinality === 'one-per-borrower' && n !== 1) ||
      (spec.cardinality === 'optional-per-borrower' && n > 1);
    if (fail) {
      const first = borrower.segments[0];
      report.add({
        severity: 'error',
        sheet: spec.sheet ?? spec.tag,
        acNo: borrower.acNo,
        rowNumber: first?.rowNumber ?? 0,
        fieldKey: spec.tag,
        rule: 'cardinality',
        message: `Borrower ${borrower.acNo}: expected ${spec.cardinality} for segment ${spec.tag}, found ${n}`,
        reference: referenceFor(format, spec, undefined, 'cardinality'),
        value: n,
      });
    }
  }
}

function label(field: FieldSpec): string {
  return field.label ?? field.key;
}

function issue(
  format: FormatSpec,
  spec: SegmentSpec,
  row: SegmentRow,
  field: FieldSpec,
  rule: ValidationIssue['rule'],
  severity: ValidationIssue['severity'],
  message: string,
  value: unknown,
): ValidationIssue {
  return {
    severity,
    sheet: row.sheet,
    acNo: row.acNo,
    rowNumber: row.rowNumber,
    column: row.sourceColumns?.[field.key],
    fieldKey: field.key,
    fieldLabel: field.label,
    rule,
    message,
    reference: referenceFor(format, spec, field, rule),
    value,
  };
}

/**
 * V3.10 section catalogue — heading text and the PRINTED page it starts on, read
 * off "Commercial UCRF - V3.10-Delimited_13th April 2026.pdf" (contents page 2,
 * confirmed against each body heading). Cite from this table rather than from
 * memory: the Section-8 numbering shifted by one from V3.9, and State in
 * particular is 8.5 — 8.6 is Type of Relationship.
 */
const V310_SECTIONS: Record<string, { title: string; page: number }> = {
  '7.1': { title: 'Header Segment (HD)', page: 19 },
  '7.2': { title: 'Borrower Segment (BS)', page: 21 },
  '7.3': { title: 'Address Segment (AS)', page: 25 },
  '7.4': { title: 'Relationship Segment (RS)', page: 27 },
  '7.5': { title: 'Credit Facility Segment (CR)', page: 33 },
  '7.6': { title: 'Guarantor Segment (GS)', page: 40 },
  '7.7': { title: 'Security Segment (SS)', page: 45 },
  '7.8': { title: 'Dishonour of Cheques Segment (CD)', page: 46 },
  '7.9': { title: 'File Closure Segment (TS)', page: 47 },
  '8.1': { title: 'Legal Constitution', page: 48 },
  '8.2': { title: 'Business Category', page: 48 },
  '8.3': { title: 'Business / Industry Type', page: 48 },
  '8.4': { title: 'Location Type', page: 49 },
  '8.5': { title: 'State', page: 49 },
  '8.6': { title: 'Type of Relationship', page: 50 },
  '8.7': { title: 'Currency Code', page: 50 },
  '8.8': { title: 'Credit Type', page: 54 },
  '8.9': { title: 'Asset Classification / Days Past Due', page: 56 },
  '8.10': { title: 'Account Status', page: 56 },
  '8.11': { title: 'Suit Filed Status', page: 57 },
  '8.12': { title: 'Transaction Type Code', page: 57 },
  '8.13': { title: 'Tangible Security Type', page: 57 },
  '8.14': { title: 'Tangible Security Classification', page: 58 },
  '8.15': { title: 'Country Code / Nationality', page: 58 },
  '8.16': { title: 'Tangible Security Coverage', page: 61 },
  '8.17': { title: 'Guarantee Coverage', page: 61 },
  '8.18': { title: 'Repayment Frequency', page: 61 },
  '8.19': { title: 'Assessment Agency / Authority', page: 62 },
  '8.20': { title: 'Reason for Inward Cheque Dishonour', page: 62 },
};

/** Segment tag -> the §7 section that defines its field layout. */
const V310_SEGMENT_SECTION: Record<string, string> = {
  HD: '7.1',
  BS: '7.2',
  AS: '7.3',
  RS: '7.4',
  CR: '7.5',
  GS: '7.6',
  SS: '7.7',
  CD: '7.8',
  TS: '7.9',
};

/**
 * Coded field -> the §8 catalogue whose codes it must draw from. Keyed on the
 * field key's distinguishing suffix so the per-segment variants (`stateCode`,
 * `rsStateCode`, `gsStateCode`) all land on the same catalogue.
 */
const V310_FIELD_CATALOGUE: Array<[RegExp, string]> = [
  [/stateCode$/i, '8.5'],
  [/locationType$/i, '8.4'],
  [/(^|[a-z])constitution$/i, '8.1'],
  [/businessCategory$/i, '8.2'],
  [/(business|industry)Type$/i, '8.3'],
  [/relationshipType$/i, '8.6'],
  [/^relationship$/i, '8.6'],
  [/currency/i, '8.7'],
  [/creditType$/i, '8.8'],
  [/assetClassification$/i, '8.9'],
  [/accountStatus$/i, '8.10'],
  [/suitFiled/i, '8.11'],
  [/transactionType$/i, '8.12'],
  [/securityType$/i, '8.13'],
  [/securityClassification$/i, '8.14'],
  [/(country|nationality)/i, '8.15'],
  [/securityCoverage$/i, '8.16'],
  [/guaranteeCoverage$/i, '8.17'],
  [/repaymentFrequency$/i, '8.18'],
  [/assessmentAgency$/i, '8.19'],
  [/dishonourReason$/i, '8.20'],
];

const V310_DOC = 'CRIF Commercial UCRF V3.10';

/** "§7.3 Address Segment (AS), p. 25" — section, heading and printed page. */
function sectionRef(section: string, extra?: string): string {
  const s = V310_SECTIONS[section];
  if (!s) return '';
  return `§${section} ${s.title}, p. ${s.page}${extra ? ` — ${extra}` : ''}`;
}

/**
 * A full citation an operator can look up, e.g.
 * "CRIF Commercial UCRF V3.10 §8.5 State, p. 49; §7.3 Address Segment (AS), p. 25".
 * The document name is named once; further sections follow bare.
 */
function citeV310(sections: Array<[string, string?]>): string {
  const parts = sections.map(([section, extra]) => sectionRef(section, extra)).filter(Boolean);
  return parts.length ? `${V310_DOC} ${parts.join('; ')}` : V310_DOC;
}

/**
 * A human-readable source locator for the bureau rule that produced an issue.
 * For Commercial V3.10 this resolves to a numbered section, its heading and the
 * printed page in the spec PDF, so the operator can open the page and read the
 * rule. Keep it conservative: only cite a section recorded in `V310_SECTIONS`;
 * for every other format cite the exact segment/field layout rather than
 * inventing a section number.
 */
function referenceFor(
  format: FormatSpec,
  spec?: SegmentSpec,
  field?: FieldSpec,
  rule?: ValidationIssue['rule'],
  message?: string,
): string {
  const key = field?.key ?? '';
  const tag = spec?.tag ?? '';
  const commercialV310 = format.id === 'commercial-ucrf-v310' || format.id === 'commercial-ucrf-flat-v310';

  if (commercialV310) {
    if (rule === 'portal-mandatory' && /registered office/i.test(message ?? '')) {
      return citeV310([['7.3'], ['8.4']]);
    }
    if (key === 'wilfulDefaultStatus' || key === 'wilfulDefaultDate' || /wilful default/i.test(message ?? '')) {
      return citeV310([['7.5', 'CR fields 35–36, Wilful Default Status and Date']]);
    }
    // A coded field is governed by its Section-8 catalogue; cite that first, and
    // the segment layout alongside it so the field's position is findable too.
    const catalogue = V310_FIELD_CATALOGUE.find(([re]) => re.test(key))?.[1];
    if (catalogue) {
      const segment = V310_SEGMENT_SECTION[tag];
      return citeV310(segment ? [[catalogue], [segment]] : [[catalogue]]);
    }
    // A parse failure on an address-derived value points at the State catalogue —
    // that is what the reader was trying to resolve out of the free-text address.
    if (rule === 'parse') return citeV310([['8.5']]);
    const segment = V310_SEGMENT_SECTION[tag];
    if (segment) {
      return citeV310([[segment, field ? `field “${label(field)}”` : undefined]]);
    }
  }

  const fieldText = field ? `, field “${label(field)}”` : '';
  const segmentText = tag ? `, ${tag} segment` : '';
  const formatName = format.label.includes(format.version) ? format.label : `${format.label} v${format.version}`;
  return `${formatName}${segmentText}${fieldText} field layout`;
}

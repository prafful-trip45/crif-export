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
      validateRow(report, spec, seg);
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
        value: undefined,
      });
    }
  }

  return report;
}

function validateRow(report: ValidationReport, spec: SegmentSpec, row: SegmentRow): void {
  // Surface issues raised while reading/mapping the row (e.g. an unmatched lookup).
  for (const ri of row.readerIssues ?? []) {
    report.add({
      severity: 'error',
      sheet: row.sheet,
      acNo: row.acNo,
      rowNumber: row.rowNumber,
      column: row.sourceColumns?.[ri.fieldKey],
      fieldKey: ri.fieldKey,
      rule: 'lookup',
      message: ri.message,
      value: row.values[ri.fieldKey],
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
      report.add(issue(row, field, 'mandatory', severity, `Required field "${label(field)}" is blank`, value));
      continue;
    }
    if (!present) continue;

    // enum membership
    if (field.enum && !(raw in field.enum)) {
      report.add(
        issue(row, field, 'enum', 'error', `Value "${raw}" is not an allowed code for "${label(field)}"`, value),
      );
    }

    // date parseability (coerce already tried; a leftover non-8-digit string fails)
    if ((field.type === 'date-ddmmyyyy' || field.type === 'date-ddmmccyy') && !/^\d{8}$/.test(raw)) {
      report.add(issue(row, field, 'date', 'error', `Value "${raw}" is not a valid date (expected DDMMYYYY)`, value));
    }

    // format rules (PAN/PIN/phone/Aadhaar) keyed off field key
    const rule = formatRuleFor(field.key);
    if (rule && !rule(raw)) {
      report.add(issue(row, field, 'format', 'error', `Value "${raw}" has an invalid format for "${label(field)}"`, value));
    }

    // length: over-length is an error for fixed-width/coded; a warning-cap for pipe maxLength
    const cap = field.length ?? field.maxLength;
    if (spec.encoding !== 'pipe-delimited' && field.length && raw.length > field.length) {
      report.add(
        issue(row, field, 'length', 'error', `Value "${raw}" exceeds fixed width ${field.length} for "${label(field)}"`, value),
      );
    } else if (field.maxLength && raw.length > field.maxLength) {
      report.add(
        issue(row, field, 'length', 'error', `Value length ${raw.length} exceeds max ${field.maxLength} for "${label(field)}"`, value),
      );
    } else if (spec.encoding === 'coded-field' && raw.length > 99) {
      report.add(
        issue(row, field, 'length', 'error', `Coded field "${label(field)}" value length ${raw.length} exceeds 99`, value),
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
        value: n,
      });
    }
  }
}

function label(field: FieldSpec): string {
  return field.label ?? field.key;
}

function issue(
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
    value,
  };
}

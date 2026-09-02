export type ValidationRule =
  | 'mandatory'
  | 'format'
  | 'enum'
  | 'length'
  | 'cardinality'
  | 'date'
  | 'lookup'
  /** The flat-sheet reader could not safely parse a source value. */
  | 'parse'
  | 'empty-input'
  /** A cross-segment rule the bureau portal enforces on ingestion (e.g. every borrower
   * needs a Registered Office address) that the per-field walk can't express. */
  | 'portal-mandatory';

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  sheet: string;
  acNo: string;
  /** 1-based Excel row number for the offending record. */
  rowNumber: number;
  /**
   * Source spreadsheet column letter the offending value was read from (e.g. "AF").
   * For a DERIVED field (state/PIN/city parsed out of a free-text address) this points
   * at the column the user actually edits — the address column — not a column that does
   * not exist in the sheet. Undefined when the field maps to no single source column.
   */
  column?: string;
  fieldKey: string;
  /** Human label of the field, for the report. */
  fieldLabel?: string;
  rule: ValidationRule;
  message: string;
  value: unknown;
  /**
   * False for errors where emitting a file would silently discard or corrupt a
   * source value. These errors cannot be overridden with `bypassErrors`.
   */
  bypassable?: boolean;
}

export class ValidationReport {
  readonly issues: ValidationIssue[] = [];

  add(issue: ValidationIssue): void {
    this.issues.push(issue);
  }

  get errors(): ValidationIssue[] {
    return this.issues.filter((i) => i.severity === 'error');
  }

  get warnings(): ValidationIssue[] {
    return this.issues.filter((i) => i.severity === 'warning');
  }

  /** True when there are no blocking errors. */
  get ok(): boolean {
    return this.errors.length === 0;
  }

  /** Errors that must never be emitted, even when the operator selects bypass. */
  get hasNonBypassableErrors(): boolean {
    return this.errors.some((issue) => issue.bypassable === false);
  }
}

export interface ConvertResult {
  report: ValidationReport;
  /** The byte-exact output buffer (only present when emission was allowed). */
  output?: Buffer;
  /** The output as a string, for display. */
  outputText?: string;
  /** The multi-sheet workbook report (when `report: true` was requested). */
  reportWorkbook?: Buffer;
  counts?: {
    borrowerCount: number;
    accountCount: number;
    addressCount: number;
    segmentCount: number;
  };
}

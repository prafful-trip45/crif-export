export type ValidationRule =
  | 'mandatory'
  | 'format'
  | 'enum'
  | 'length'
  | 'cardinality'
  | 'date'
  | 'lookup'
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
  fieldKey: string;
  /** Human label of the field, for the report. */
  fieldLabel?: string;
  rule: ValidationRule;
  message: string;
  value: unknown;
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

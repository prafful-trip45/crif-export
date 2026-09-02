import type { Severity } from './result.js';

/**
 * Core spec abstraction consumed by the whole engine.
 *
 * A CRIF format is described as pure declarative data: a header segment, an
 * ordered list of body segments, and a trailer. Each segment is a list of
 * fields. The encoding engine interprets these objects and never hardcodes a
 * format. This is the seam that lets all three formats share one engine.
 */

export type FieldType =
  | 'string'
  | 'numeric'
  | 'date-ddmmyyyy' // Consumer / Commercial: 8-char DDMMYYYY
  | 'date-ddmmccyy' // MFI: 8-char DDMMCCYY (4-digit year — same digit count, distinct semantics)
  | 'enum';

/** A typed input row: stable field key -> coerced value (or undefined when blank). */
export type TypedRow = Record<string, FieldValue>;
export type FieldValue = string | number | Date | undefined;

/**
 * mandatory may depend on the row (conditional-mandatory, e.g. MFI fields
 * required only for new disbursals from 1-Apr-2022).
 */
export type MandatoryRule = boolean | ((row: TypedRow) => boolean);

export interface FieldSpec {
  /** Stable input column key, e.g. "borrowerName". */
  key: string;
  /** Human-readable column header shown in generated templates / reports. */
  label?: string;
  /**
   * Alternate input-column headers that also map to this field. CRIF forms in the
   * wild vary the wording of a column (e.g. "Address 1" vs "Address Line 1"), so
   * the workbook reader matches a header against `label`, `key`, OR any alias
   * (all normalized). Output/template generation still uses `label`.
   */
  aliases?: string[];
  /** 2-char field code — Consumer `coded-field` encoding only. */
  code?: string;
  type: FieldType;
  /**
   * For `fixed-width`: the exact pad/truncate target width.
   * For `coded-field`: ignored for layout (length is derived from the value),
   *   but used as the max length for validation.
   * For `pipe-delimited`: ignored unless `maxLength` is unset, then it is the cap.
   */
  length?: number;
  /** Delimited cap (validation only — pipe fields are not padded). */
  maxLength?: number;
  mandatory: MandatoryRule;
  /**
   * Severity when `mandatory` fails. Defaults to 'error' (blocks output). Use 'warning'
   * for fields the bureau portal *usually* demands but has been observed to accept blank
   * — the operator is told, but a legitimate submission is not halted.
   */
  mandatorySeverity?: Severity;
  /** Allowed enum codes -> human description; presence enables enum validation. */
  enum?: Record<string, string>;
  /** Fixed-width padding side + char. Defaults: string=right/space, numeric=left/'0'. */
  pad?: 'left' | 'right';
  padChar?: string;
  /** Emitted when the input value is blank. */
  default?: string;
}

export type EncodingStrategy =
  | 'fixed-width'
  | 'pipe-delimited'
  | 'coded-field'
  | 'concatenated'; // fields emitted back-to-back, variable width, no tags/delimiters
                     // (real-world CRIF Consumer "Data Submission Form" output)

export type Cardinality =
  | 'header' // exactly one, file-level
  | 'trailer' // exactly one, file-level (counts computed)
  | 'one-per-borrower' // exactly one per borrower group
  | 'optional-per-borrower' // zero or one per borrower group
  | 'many'; // zero or more per borrower group

export interface SegmentSpec {
  /** Record marker, e.g. "PN", "BS", "CNSCRD", "HDR". */
  tag: string;
  /** Excel sheet name carrying this segment's rows (defaults to tag). */
  sheet?: string;
  /** 2-digit version appended to the tag (Consumer coded segments). */
  version?: string;
  encoding: EncodingStrategy;
  /** Sort order within a borrower group (Commercial `Flag` column). */
  flag?: number;
  cardinality: Cardinality;
  fields: FieldSpec[];
  /** Whether `tag` (and `version`) is emitted as a literal prefix on the record. */
  emitTag?: boolean;
  /** For pipe-delimited records, whether the tag is itself the first pipe field. */
  tagAsField?: boolean;
  /**
   * Consumer `coded-field` only: literal bytes emitted immediately after
   * `tag + version`, before the TLV field stream — the 1-char subtype + 2-digit
   * record-type qualifier, e.g. "N01" (PN), "I01" (ID), "T00" (TL).
   */
  codedHeaderSuffix?: string;
}

export type FormatId =
  | 'consumer-tudf'
  | 'consumer-ucrf12'
  | 'consumer-ucrf12-flat'
  | 'commercial-ucrf'
  | 'commercial-ucrf-v310'
  | 'commercial-ucrf-flat'
  | 'commercial-ucrf-flat-v310'
  | 'mfi-cdf';

export interface FormatSpec {
  id: FormatId;
  label: string;
  version: string;
  outputExtension: '.txt' | '.CDF' | '.tudf';
  /** '\n'/CRLF-joined records, or one concatenated physical line (MFI). */
  physicalLayout: 'one-line-per-record' | 'single-physical-line';
  /** Line terminator between records (and trailing). */
  lineEnding: '\r\n' | '\n' | '';
  fileEncoding: 'ascii' | 'latin1';
  header: SegmentSpec;
  body: SegmentSpec[];
  trailer: SegmentSpec;
  /** Builds the typed header row from file-level metadata. */
  buildHeaderRow: (meta: FileMeta) => TypedRow;
  /** Builds the typed trailer row from computed counts + metadata. */
  buildTrailerRow: (counts: TrailerCounts, meta: FileMeta) => TypedRow;
  /**
   * Glue the header directly onto the first body record (no line break between
   * them), so line 0 = header + record0. Real CRIF Consumer flat output does this.
   */
  glueHeaderToFirstRecord?: boolean;
  /**
   * Cross-segment checks the per-field walk can't express (e.g. "at least one address
   * must be the Registered Office"). Returns one message per violation; the validator
   * reports them as errors against the borrower. Runs once per borrower.
   */
  checkBorrower?: (segments: ReadonlyArray<{ tag: string; values: Record<string, unknown> }>) => string[];
  /** Omit the trailer record entirely (flat Consumer output has none). */
  omitTrailer?: boolean;
  /**
   * Append the line ending after the final record too (real CRIF Commercial files
   * end the last `TS|..|` line with a trailing CRLF). Default false to preserve the
   * existing golden fixtures that have no trailing newline.
   */
  trailingLineEnding?: boolean;
  /**
   * Input is a single flat sheet (one row per consumer), not one sheet per
   * segment. Names the sheet + the 1-based label/data rows. When set, the reader
   * maps each data row to a single body record using `body[0]`'s field labels.
   *
   * `memberIdField`, when set, names a body-record field whose sheet value is
   * REPLACED at assembly time by the file-level `meta.memberId` (the CRIF-assigned
   * member ID). Real CRIF Consumer output stamps the bureau member ID into every
   * account record's member-code field, not the raw member ID the accountant typed.
   *
   * `headerCells` maps sheet cell addresses to FileMeta keys (e.g. the accountant
   * fills the short name / password in the form's header rows). A non-blank cell
   * OVERRIDES the matching CLI flag. NOTE: `memberId` is deliberately NOT mappable
   * here — the output member id is the CRIF-assigned id supplied via the flag, not
   * the raw member id typed in the sheet.
   */
  flatInput?: {
    sheet: string;
    labelRow: number;
    firstDataRow: number;
    memberIdField?: string;
    headerCells?: Record<string, 'reportingDate' | 'creationDate' | 'password' | 'memberName' | 'memberShortName'>;
  };
  /**
   * Flat input that explodes ONE source row into MANY segment records (real-world
   * Commercial "Master Sheet": one borrower row -> BS/AS/RS/CR/... segments).
   * `columns` maps source spreadsheet column letters (A, B, ...) to stable keys;
   * `explode` turns one such keyed row into the borrower's segment seeds. When set,
   * this supersedes `flatInput`'s single-record mapping.
   */
  flatExplode?: {
    sheet: string;
    /** 1-based first row containing borrower data (header rows above are skipped). */
    firstDataRow: number;
    /** Source column-letter -> stable input key (e.g. { A: 'borrowerName', B: 'pan' }). */
    columns: Record<string, string>;
    /**
     * Header-driven column mapping: header-cell TEXT -> stable input key. When set,
     * columns are resolved by matching the `headerRow` text (case/whitespace-folded)
     * rather than by fixed letters, so ONE profile adapts to Master Sheets whose
     * columns are shifted but whose header labels are the same (e.g. a single vs
     * double "Asset Classification" column cascading the related-person block). Keys
     * here take precedence over `columns`; any key not found in the header row is
     * left unmapped (blank), so the explode mapper must tolerate missing inputs.
     */
    columnHeaders?: Record<string, string>;
    /** 1-based row holding the column header labels (defaults to firstDataRow - 1). */
    headerRow?: number;
    /** Map one keyed source row to the borrower's segment records. */
    explode: (input: Record<string, FieldValue>, ctx: FlatExplodeContext) => SegmentSeed[];
    /**
     * Wire field key -> the source INPUT key it derives from, for error attribution.
     * Most wire fields share their input key's name, so only DERIVED fields need an
     * entry: e.g. `rsStateCode`/`rsPinCode`/`rsCity` are all parsed out of the
     * `relatedAddress` column, so a blank state points the user at the address cell.
     * The reader uses this + the resolved column map to stamp `SegmentRow.sourceColumns`.
     */
    wireFieldSource?: Record<string, string>;
    /**
     * File-level header values the accountant fills in the sheet's top rows, by
     * cell address -> FileMeta key (e.g. { B5: 'memberId', B6: 'reportingDate',
     * B7: 'creationDate' }). When a cell is non-blank it OVERRIDES the CLI flag;
     * blank cells fall back to the flag. Dates parsed as DDMMYYYY.
     */
    headerCells?: Record<string, 'memberId' | 'reportingDate' | 'creationDate' | 'password' | 'memberName' | 'memberShortName' | 'cycleId'>;
  };
}

/** One produced segment record from a flat-explode mapping. */
export interface SegmentSeed {
  tag: string;
  flag: number;
  values: TypedRow;
  /** Issues raised while mapping (e.g. an unmatched lookup), surfaced in the report. */
  issues?: Array<{
    fieldKey: string;
    message: string;
    severity?: Severity;
    rule?: 'lookup' | 'parse';
    /** Bureau specification section, catalogue, or source layout behind this finding. */
    reference?: string;
    /** Prevent output even if the operator requests validation bypass. */
    blocksBypass?: boolean;
  }>;
}

/** Context handed to a flat-explode mapper (lookups read from auxiliary sheets, etc.). */
export interface FlatExplodeContext {
  /** 1-based source row number, for error reporting. */
  rowNumber: number;
  /** Auxiliary lookup tables keyed by name (e.g. "creditType": text -> code). */
  lookups: Record<string, Map<string, string>>;
  /**
   * File-level metadata (CLI flags). Lets a mapper stamp the CRIF-assigned
   * `meta.memberId` into a record (e.g. the consumer TL member-code field) rather
   * than the raw id typed in the sheet.
   */
  meta?: FileMeta;
  /**
   * Every cell of the source row paired with its column header text, in column
   * order. Lets a mapper handle REPEATED header groups the flat `input` map can't
   * represent (e.g. up to 3 side-by-side guarantor blocks that share identical
   * headers) via positional block detection. Header text is the raw sheet label.
   */
  rawCells?: Array<{ col: number; header: string; value: FieldValue }>;
}

export interface FileMeta {
  /** Member / MFI / NBF id assigned by CRIF. */
  memberId: string;
  memberName?: string;
  /** Reporting / cycle date. */
  reportingDate: Date;
  /** File creation / certification date. */
  creationDate: Date;
  password?: string;
  [extra: string]: FieldValue;
}

export interface TrailerCounts {
  borrowerCount: number;
  accountCount: number;
  addressCount: number;
  segmentCount: number;
}

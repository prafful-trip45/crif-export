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
  | 'consumer-ucrf12'
  | 'consumer-ucrf12-flat'
  | 'commercial-ucrf'
  | 'mfi-cdf';

export interface FormatSpec {
  id: FormatId;
  label: string;
  version: string;
  outputExtension: '.txt' | '.CDF';
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
  /** Omit the trailer record entirely (flat Consumer output has none). */
  omitTrailer?: boolean;
  /**
   * Input is a single flat sheet (one row per consumer), not one sheet per
   * segment. Names the sheet + the 1-based label/data rows. When set, the reader
   * maps each data row to a single body record using `body[0]`'s field labels.
   */
  flatInput?: { sheet: string; labelRow: number; firstDataRow: number };
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

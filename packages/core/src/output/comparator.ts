/**
 * Byte-exact output comparator.
 *
 * Pure, runtime-agnostic diff between two bureau-file byte streams: the file the
 * engine just generated from a known-good input, and a reference/output file the
 * user supplies (a previously-filed submission, or a CRIF golden sample). It is
 * the engine-side primitive behind the desktop "Validator" feature — feed it two
 * buffers and it reports whether they are byte-identical and, if not, exactly
 * where they first diverge.
 *
 * It never throws: malformed or empty inputs simply produce a `match: false`
 * verdict with a descriptive note, mirroring the validator's fail-safe contract.
 */

export interface ByteDiff {
  /** 0-based byte offset of the first difference. */
  offset: number;
  /** 1-based line / 1-based column the offset falls on (for display). */
  line: number;
  column: number;
  /** The byte present in the generated output (undefined if past its end). */
  expected?: number;
  /** The byte present in the supplied reference (undefined if past its end). */
  actual?: number;
  /** Short printable context around the divergence, control chars escaped. */
  expectedContext: string;
  actualContext: string;
}

export interface CompareResult {
  /** True only when both byte streams are identical, length included. */
  match: boolean;
  generatedLength: number;
  referenceLength: number;
  /** Number of differing byte positions (capped at `maxDiffs`). */
  diffCount: number;
  /** True when more differences exist than were collected. */
  truncated: boolean;
  /** The collected differences (empty when `match` is true). */
  diffs: ByteDiff[];
  /** A one-line human summary, safe to show directly. */
  summary: string;
}

export interface CompareOptions {
  /** Stop collecting after this many differing positions. Default 50. */
  maxDiffs?: number;
  /** Printable context window each side of a diff. Default 24. */
  contextRadius?: number;
  /**
   * Normalise CRLF/CR to LF on both sides before comparing. Default false —
   * bureau files are byte-exact and line endings are part of the spec, so the
   * strict default is correct; offer this only for lenient "content" checks.
   */
  ignoreLineEndings?: boolean;
}

function toU8(input: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

/** LF-normalise: collapse CRLF and lone CR to LF, so only content differs. */
function normaliseEol(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0d) {
      out.push(0x0a);
      if (bytes[i + 1] === 0x0a) i++; // swallow the LF of a CRLF pair
    } else {
      out.push(b);
    }
  }
  return Uint8Array.from(out);
}

/** Printable, single-line context: latin1 chars, control bytes escaped. */
function context(bytes: Uint8Array, at: number, radius: number): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(bytes.length, at + radius);
  let s = '';
  for (let i = start; i < end; i++) {
    const b = bytes[i]!;
    if (b === 0x0a) s += '\\n';
    else if (b === 0x0d) s += '\\r';
    else if (b === 0x09) s += '\\t';
    else if (b < 0x20 || b === 0x7f) s += `\\x${b.toString(16).padStart(2, '0')}`;
    else s += String.fromCharCode(b);
  }
  return s;
}

/**
 * Compare the engine-generated output against a user-supplied reference file.
 *
 * @param generated  the bytes the engine produced from the input workbook
 * @param reference  the bytes of the output file the user uploaded to check against
 */
export function compareOutputs(
  generated: Uint8Array | ArrayBuffer | Buffer,
  reference: Uint8Array | ArrayBuffer | Buffer,
  options: CompareOptions = {},
): CompareResult {
  const maxDiffs = options.maxDiffs ?? 50;
  const radius = options.contextRadius ?? 24;

  let gen = toU8(generated);
  let ref = toU8(reference);
  // Record true sizes for the summary even when we normalise for the diff scan.
  const genLen = gen.length;
  const refLen = ref.length;

  if (options.ignoreLineEndings) {
    gen = normaliseEol(gen);
    ref = normaliseEol(ref);
  }

  const diffs: ByteDiff[] = [];
  let line = 1;
  let column = 1;
  let truncated = false;
  const scanLen = Math.max(gen.length, ref.length);

  for (let i = 0; i < scanLen; i++) {
    const e = i < gen.length ? gen[i] : undefined;
    const a = i < ref.length ? ref[i] : undefined;
    if (e !== a) {
      if (diffs.length < maxDiffs) {
        diffs.push({
          offset: i,
          line,
          column,
          expected: e,
          actual: a,
          expectedContext: context(gen, i, radius),
          actualContext: context(ref, i, radius),
        });
      } else {
        truncated = true;
        break;
      }
    }
    // Advance line/column tracking on the generated stream's newlines (the
    // authoritative "expected" layout); fall back to the reference's.
    const nl = e ?? a;
    if (nl === 0x0a) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  // Match is judged on the streams we actually compared: when normalising line
  // endings, that's the normalised lengths, so CRLF-vs-LF-only files still match.
  const match = diffs.length === 0 && gen.length === ref.length;
  let summary: string;
  if (match && options.ignoreLineEndings) {
    summary = `Content match — identical apart from line endings (${genLen.toLocaleString()} vs ${refLen.toLocaleString()} raw bytes).`;
  } else if (match) {
    summary = `Byte-exact match — both files are ${genLen.toLocaleString()} bytes, identical.`;
  } else if (gen.length !== ref.length && diffs.length === 0) {
    summary = `Content matches up to the shorter file, but lengths differ (generated ${genLen.toLocaleString()} vs reference ${refLen.toLocaleString()} bytes).`;
  } else {
    const first = diffs[0]!;
    summary =
      `Files differ: ${truncated ? `${maxDiffs}+` : diffs.length} ` +
      `byte position${diffs.length === 1 && !truncated ? '' : 's'}; ` +
      `first at offset ${first.offset} (line ${first.line}, col ${first.column}).`;
  }

  return {
    match,
    generatedLength: genLen,
    referenceLength: refLen,
    diffCount: diffs.length,
    truncated,
    diffs,
    summary,
  };
}

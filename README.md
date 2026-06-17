# crif-export

Convert NBFC customer/loan data held in **Excel** into **CRIF Highmark** credit-bureau
submission files, ready to upload to the bureau portal — plus a validation/error report so
staff fix data in the source workbook instead of debugging spreadsheet formulas.

Supports three bureau formats:

| Format | For | Output | Layout |
|---|---|---|---|
| **Commercial UCRF V3.9** | business / corporate loans | `.txt` | pipe-delimited records |
| **MFI CDF V2.0** | microfinance loans | `.CDF` | one physical line: fixed-width header/trailer + pipe segments |
| **Consumer UCRF-12 V3.73** | retail / individual loans | `.txt` | self-describing coded fields (`[tag][len][value]`) + 146-char fixed header |

## How it works

A single **spec-driven engine**. Each format is described as pure declarative data
(`packages/core/src/formats/*.ts`) — segments → fields with code / length / type /
mandatory / enum. One engine interprets the specs and encodes via three strategies:
`fixed-width`, `pipe-delimited`, `coded-field`. The CLI and the web portal are thin shells
over the same `packages/core` engine.

```
Excel (one sheet per segment)
  → workbook-reader  (sheet=segment, columns=fields, "A/c No." join key + "Flag" order)
  → grouper          (group rows into per-borrower records)
  → validator        (mandatory / format / enum / length / cardinality — accumulates, never throws)
  → engine.assemble  (header + per-borrower segments + computed-count trailer)
  → byte-exact file  (written as latin1 so fixed-width byte counts are exact)
```

If validation finds **errors**, the data file is suppressed and only the report is returned
(override with `--allow-warnings` for warning-only runs).

## Input model

One Excel sheet per segment (sheet name = segment tag: `BS`, `AS`, `CR`, … / `CNSCRD`,
`ADRCRD`, `ACTCRD` / `PN`, `ID`, `PT`, `PA`, `TL`). Row 1 = field labels. Every data row
carries two control columns:

- **`A/c No.`** — borrower join key (same value links all of a borrower's segments).
- **`Flag`** — segment order within a borrower (lower first).

Generate ready-to-fill templates for all formats:

```bash
npm install
npm run make:templates      # writes templates/<format>-input.xlsx
```

## CLI

```bash
npm run cli -- formats                       # list supported formats

npm run cli -- convert \
  --format commercial-ucrf \
  --in path/to/data.xlsx \
  --member-id NBF1111111 \
  --reporting-date 30042024 \
  --out submission.txt
```

Mandatory: `--format`, `--in`, `--member-id`. Common: `--reporting-date DDMMYYYY`,
`--member-name` (MFI), `--password`, `--allow-warnings`, `--out`.

## Web portal

```bash
npm run web        # http://localhost:4317
```

A local page (served by a tiny Node server using the same engine) with:

- a **format / portal dropdown** (and member-id / dates / password fields),
- **two input modes** — type a **local folder path** (the server reads the `.xlsx` from
  disk) **or drag-and-drop** a file directly,
- an inline **validation report** table and a **download** button for the generated file.

The folder-path mode needs the local server (a browser cannot read arbitrary filesystem
paths); drag-drop works purely client-side. Both feed the one engine.

## Tests

```bash
npm test
```

Golden fixtures (CRIF's own sample files in `test/fixtures/`) are the primary contract:

- **Commercial** — full file reproduced **byte-for-byte** (header + all body records).
- **MFI** — fixed-width header (171), trailer (41), all three pipe body segments, and the
  full single physical line reproduced byte-for-byte.
- **Consumer** — 146-char `TUDF` header and the `PN`/`PA`/`PT` coded segments reproduced
  byte-for-byte.
- End-to-end: a built workbook → valid file; dirty workbooks raise the right errors.

## Known caveats / TODO

- **Trailer counts:** CRIF's *sample* Commercial file shows `TS|12|12|` for only 3
  borrowers (illustrative). This tool computes the *true* counts from the data.
- **Consumer field tables** beyond `PN`/`ID`/`PT`/`PA` and the core `TL` fields were
  reverse-engineered from the spec PDF + golden sample; the **encoding mechanics** are
  verified byte-exact, but some `TL`/`TH` field tags/enums (account-type codes, payment
  history) should be confirmed against the full V3.73 appendices before production filing.
- **Consumer line wrapping:** CRIF's sample wraps the long `TL` record across several
  physical lines at irregular points; this tool emits one line per segment (valid &
  parseable, but not the sample's exact CRLF positions).
- Enum tables (`formats/enums/*`) are commonly-used subsets — extend from the format PDFs.

## Project layout

```
packages/core/    spec-driven engine (formats, encoding strategies, input, validation)
packages/cli/     commander CLI
packages/web/     local Node portal (server + single-page UI)
scripts/          template generator
templates/        generated input workbooks
test/             vitest specs + golden fixtures
```

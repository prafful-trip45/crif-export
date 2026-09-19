---
name: validate-references
description: Pre-rollout gate that validates every real-world input file in training-references/ before shipping a desktop build. Converts each reference input and byte-compares against its paired output, smoke-checks unpaired inputs for zero validation errors, and confirms deliberately-wrong inputs are rejected (not silently mis-converted). Use before any `npm run installers` / `tauri build`, after touching the core conversion engine (formats, workbook-reader, validator, encoding), or when adding a new reference file. Catches the bug class where unit goldens pass but a different real customer file breaks.
---

# Validate reference files before a build

The unit goldens cover a handful of fixtures. Real customer files vary (renamed
tabs, shifted layouts, formats that map by fixed column letters), so a build can
be green on `vitest` yet break on a file like `consumer_input_failing.xlsx`.
**Run this gate before rolling out a build.**

## When to run

- Before `npm run installers` / `npm run installers:reinstall` / `tauri build`.
- After editing anything in `packages/core/src/` — especially `formats/`,
  `input/workbook-reader.ts`, `validation/validator.ts`, `encoding/`.
- After adding a new file to `training-references/crif-reporting-io/`.

## How to run

```bash
# The whole gate (fast — pure conversion, no Rust build):
npx vitest run test/reference-files-validation.spec.ts

# Or as part of the full suite:
npx vitest run
```

A green run is the go/no-go signal. **Do not ship a build if this is red.**

## What it checks (`test/reference-files-validation.spec.ts`)

A manifest (`CHECKS`) drives three kinds of assertion:

1. **golden (byte-exact)** — convert with the file's known-correct metadata
   (memberId / dates, lifted from the dedicated golden specs) and assert
   `result.outputText` equals the paired `.txt` byte-for-byte, with zero errors.
2. **smoke (0 errors)** — for inputs without exact reproducible metadata: assert
   the file converts with **zero validation errors** and non-empty output. This
   is the regression guard for the sheet-resolution fix (`consumer_input_failing.xlsx`).
3. **reject (wrong inputs)** — synthetic malformed workbooks (empty workbook,
   unrelated columns, a non-xlsx buffer) **must** be rejected — either the
   convert throws, or the report carries errors / produces no output. Guards
   against silently emitting a garbage or header-only bureau file. Backed by the
   `empty-input` validation rule in `validator.ts`.

## Adding a new reference file

1. Drop the input (and its paired output if you have one) into
   `training-references/crif-reporting-io/`.
2. Add an entry to `CHECKS` in the spec:
   - With a paired output and known metadata → `kind: 'golden'`.
   - No reproducible metadata → `kind: 'smoke'`.
   - A file that *should* be rejected → `kind: 'reject'`.
3. Re-run the gate. If a `golden` doesn't byte-match, the metadata
   (memberId/dates) is usually wrong — check the dedicated golden spec for that
   file, or whether the sheet's header cells override the meta.

## If the gate is red

- **`empty-input` error on a real file** → the data isn't being read: wrong
  sheet resolved, or header row/columns not matched. Check
  `resolveFlatExplodeSheet` / the format's `columns`/`columnHeaders`.
- **byte-mismatch on a golden** → either the engine output changed (inspect the
  diff) or the manifest metadata is stale.
- **a `reject` case now passes through** → the converter started accepting a
  malformed input; tighten validation rather than loosening the test.

## Notes

- **`consumer-tudf` is the consumer profile customers submit** (spec V3.73:
  146-byte header, tagged PN/ID/PT/EC/PA/TL segments, `ES02**`, `TRLR`). It maps
  the "Data Submission Form" by header TEXT (`columnHeaders`), so the shifted
  "Sheet1" form and the row-1 "Consumer" export both resolve; fixed letters are
  only the fallback.
- `consumer-ucrf12-flat` is **hidden from the desktop app** (`HIDDEN_FORMATS`):
  it was reverse-engineered from a client file that is not a conforming UCRF-12
  submission (no Version field, Date Reported at 54 not 55, untagged records).
  It stays registered only so its goldens keep guarding the reader.
- A byte-exact golden proves the engine reproduces a file, not that the file
  parses. The `consumer-tudf` block walks every real consumer workbook as a
  spec-compliant reader would and must reach `TRLR` — that is what caught the
  Sept-2026 TL desync (`T00` + tag `10` vs the spec's `T001` + tag `01`).
- Consumer workbooks live in several `training-references/` folders, not just
  `crif-reporting-io/`; the `tref()` helper addresses them. Add a new consumer
  file to `CASES` in the `consumer-tudf` block with its subject count, layout
  note, and any known accountant data defects.
- This gate is conversion-only and runs in ~5s; there is no reason to skip it.

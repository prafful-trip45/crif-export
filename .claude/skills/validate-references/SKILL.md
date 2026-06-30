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

- Only the **flat** consumer profile (`consumer-ucrf12-flat`) is shipped; the
  TLV profile was removed because it mapped columns by fixed letters and broke on
  files whose layout differed. Keep the manifest pointed at flat/commercial/MFI.
- This gate is conversion-only and runs in ~2s; there is no reason to skip it.

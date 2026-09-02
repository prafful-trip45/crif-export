# Handoff: CIC — Text & TUDF Converter redesign

## Overview

A redesign of the CIC desktop converter (Tauri app, `packages/desktop`) that turns customer data in Excel into CRIF Highmark bureau submission files. The current app is a single vertical stack of cards: settings, input source, then a Generate button below the fold, with results rendered as raw HTML into a `#result` div.

The redesign keeps every existing capability and changes three things:

1. **One frame, two panes.** Setup on the left, a persistent action rail on the right. Generate is always visible without scrolling.
2. **Progress and results live in the rail.** Running a conversion replaces the rail's Generate section with live pipeline steps, then with the run result. A segmented toggle at the top of the rail switches between **Generate** and **Findings / Result** so the operator never loses either.
3. **Findings are actionable.** Validation issues are grouped by rule (not one row per issue), each group naming the exact sheet cells, the fix, and the CRIF spec reference. A full-width report view holds the detail tables.

Light theme added alongside the existing dark theme.

Target users: ops analysts filing monthly bureau submissions. Density: comfortable. Desktop only (min window 1240px content width); no responsive/mobile requirement.

## About the design files

`CIC Converter.dc.html` in this bundle is a **design reference created in HTML** — a clickable prototype showing intended look and behaviour. It is not production code to copy. The task is to recreate it inside `packages/desktop`, which is plain TypeScript + Vite with a hand-written `styles.css` and imperative DOM code in `src/main.ts`. Use that existing environment and its conventions (no framework introduction needed): extend `styles.css` with the tokens below, and restructure the markup in `index.html` plus the render functions in `main.ts`.

The prototype fakes all engine work with timers. Real wiring points already exist:

- `packages/desktop/src/engine.ts` — `convert()` / comparison
- `packages/core/src/core/result.ts` — `ValidationIssue`, `ValidationReport`, `ConvertResult`
- `packages/core/src/formats/index.ts` — `listFormats()`
- `packages/desktop/src/main.ts` — format dropdown, cycle picker, file/folder picking, result rendering, save dialogs

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, and copy are final. Recreate pixel-perfectly. Where the prototype and the current app disagree, the prototype wins — except for anything the engine dictates (filename patterns, counts, format labels), which must come from real data.

---

## Design tokens

Two themes, defined as CSS custom properties on a `[data-theme]` attribute on the app root. Default `dark`; persist the operator's choice.

### Dark (`[data-theme="dark"]`, also `:root`)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0B0E12` | desk behind the window frame |
| `--surface` | `#11161D` | window body, cards on grey |
| `--surface-2` | `#151B23` | title bar, right rail, sunken cards |
| `--line` | `#232C38` | borders, dividers, switch off-track |
| `--line-soft` | `#1C242E` | hairline row separators, disabled button fill |
| `--ink` | `#E6EDF3` | primary text |
| `--muted` | `#93A1B0` | secondary text |
| `--faint` | `#66737F` | labels, captions, metadata |
| `--field` | `#0C1116` | input / select / segmented-control backgrounds |
| `--accent` | `#5B93FF` | primary action, active state, cell references |
| `--accent-soft` | `rgba(91,147,255,.14)` | active fill, chip fill |
| `--ok` | `#34B759` | success |
| `--ok-soft` | `rgba(52,183,89,.13)` | success fill |
| `--warn` | `#E0A32E` | warning |
| `--warn-soft` | `rgba(224,163,46,.13)` | warning fill |
| `--err` | `#F0564B` | error |
| `--err-soft` | `rgba(240,86,75,.13)` | error fill |

### Light (`[data-theme="light"]`)

| Token | Value |
| --- | --- |
| `--bg` | `#EDEFF3` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#F6F8FA` |
| `--line` | `#DCE1E8` |
| `--line-soft` | `#E8ECF1` |
| `--ink` | `#121A23` |
| `--muted` | `#4E5A67` |
| `--faint` | `#71808E` |
| `--field` | `#FFFFFF` |
| `--accent` | `#2C64D8` |
| `--accent-soft` | `rgba(44,100,216,.10)` |
| `--ok` | `#0E7C42` |
| `--ok-soft` | `rgba(14,124,66,.10)` |
| `--warn` | `#8A5D0F` |
| `--warn-soft` | `rgba(138,93,15,.11)` |
| `--err` | `#B93124` |
| `--err-soft` | `rgba(185,49,36,.10)` |

Also set `color-scheme: light|dark` per theme so native `input[type=month]`, `input[type=date]`, and `select` popups match.

**Traffic lights** are fixed regardless of theme: `#E9695F`, `#E0B240`, `#54B963` — 11px circles, 7px gap.

### Typography

- Sans: **IBM Plex Sans** — 400 / 500 / 600 / 700
- Mono: **IBM Plex Mono** — 400 / 500 / 600. Used for every machine value: member IDs, dates, filenames, row/cell references, counts, segment tags, file previews, the version string, the status line.

| Role | Size / weight / other |
| --- | --- |
| Section heading (SUBMISSION, INPUT, OPTIONS, GENERATE, FINDINGS, OUTPUT) | 11px / 700 / `letter-spacing:.09em` / uppercase / `--faint` |
| Field label | 12.5px / 600 / `--ink`; trailing qualifier in 400 `--faint` |
| Input text | 13.5px / 400 (mono for IDs and dates) |
| Body / helper | 12.5px / 400 / `--muted`, `line-height:1.5–1.55` |
| Caption | 11–11.5px / 400 / `--faint` |
| Primary CTA | 13.5px / 700 |
| Secondary button | 12.5px / 600 |
| Pill / badge | 10–11px / 700 / `letter-spacing:.05em` / mono |
| Count stat | 17px (rail) or 21px (report) / 600 / mono |
| Finding title | 12.5px (rail) or 13.5px (report) / 600 / `line-height:1.4–1.45` |

### Spacing, radii, shadow

- Section gap 26px; field gap 14–16px; grid gap 16px; rail gap 16px; list gap 7–9px.
- Padding: window body 24px 26px 30px; rail 22px 20px; title bar 0 16px; toolbar 14px 22px; inputs 10px 12px; cards 11–14px.
- Radii: window frame 14px; cards / drop zones 9–10px; inputs, buttons, segmented tracks 7–9px; pills and badges 5–6px; switches / status dots 999px.
- Shadow: window `0 24px 60px -20px rgba(0,0,0,.45)`; enabled primary CTA `0 6px 18px -8px var(--accent)`.
- `box-sizing: border-box` globally (the prototype needs it; without it every `width:100%` input overflows its grid column).

---

## Screens / views

Screenshots in `screenshots/`. Two views (`view: 'app' | 'report'`) inside one window frame.

### Shared chrome

**Title bar** — 46px, `--surface-2`, 1px bottom border `--line`.
Left: three traffic lights. Then `CIC — Text & TUDF Converter` 12.5px/600 `--muted`. Right, in order: offline pill (`● Offline · on-device`, 11px/600, `--ok` on `--ok-soft`, 999px radius, 4px 10px, 6px dot; keep the existing tooltip "All processing happens on this machine…"), 1px×18px divider, `finguru-08` 12px/500 `--muted`, theme toggle (26px square, 1px `--line`, radius 7px, `☀`/`☾`; hover → accent border and icon).

**Toolbar** — 14px 22px, 1px bottom border.
Left: mode segmented control on a `--field` track (1px `--line`, radius 9px, 3px padding, 3px gap); each option 8px 20px, radius 7px, 12.5px/600; active `--accent` fill with `#fff` text, inactive `--muted` on transparent. Options: **Convert**, **Validator**.
Middle: mode blurb, 12.5px `--muted`, max-width 520px.
– Convert: "Convert customer data in Excel into CRIF Highmark bureau submission files. Nothing leaves this machine."
– Validator: "Re-generates from your input workbook and compares it byte-for-byte against a filed submission or CRIF reference file."
Right: `v2.4.1` (mono 11.5px `--faint`) and a `Sign out` link (`--accent`, underline on hover).

**Status line** — outside the frame, 14px below it, mono 11.5px `--faint`:
- idle: `● idle · on-device · signed in as finguru-08`
- running: `● working — step 3 of 5`
- done, errors: `● 16 errors · 6 warnings · no file written`
- done, file written: `● file written · 6 warnings`

---

### 1. Setup view — left pane
`01-setup-dark.png`, `02-setup-light.png`, `03-input-file-picked.png`

Left pane `flex:1`, min-width 0, 24px 26px 30px, 26px between sections. Each section starts with an uppercase heading followed by a 1px `--line-soft` rule filling the remaining width (baseline-aligned).

**SUBMISSION**
1. `Bureau format / portal` + qualifier `— which submission you are filing`. Full-width native `select`, options from `listFormats()` minus `HIDDEN_FORMATS`: Commercial UCRF V3.10 · Commercial UCRF V3.9 (deprecated) · Consumer UCRF-12 · Consumer TUDF Format · MFI CDF V2.0.
2. Two-column grid: `Member / MFI / NBF ID` (mono input, `letter-spacing:.02em`) and `Member name (MFI)`.
3. Two-column grid, top-aligned:
   - Left: label row with `Reporting / cycle date` on the left and the resolved date as an accent chip on the right (mono 11.5px, 2px 7px, radius 5px, `--accent` on `--accent-soft`). Below: `input[type=month]`, then a 4-up cycle grid (6px gap, 8px 4px cells, radius 8px): `9th/W1`, `16th/W2`, `23rd/W3`, `Month-end/ME`. Day 12.5px/500; tag mono 10.5px. Inactive: 1px `--line` on `--field`, day `--ink`, tag `--faint`. Active: 1px `--accent` on `--accent-soft`, both lines `--accent`.
   - Right: `Creation date DD/MM/YYYY`, mono text input with right padding 38px and a 26px calendar button inset 6px (`▤`, `--muted`; hover accent on `--accent-soft`) that opens the native picker. Below, 11.5px `--faint`: "Flat-sheet formats may leave the ID and dates blank — values in the sheet's header cells override these."

**INPUT** — heading row also carries a small segmented control on the right (2px track padding, options 5px 11px, radius 6px, 11.5px/600; active `--accent` on `--accent-soft`): **Pick a file**, **From a folder**.
- Empty: drop zone, 1.5px dashed `--line`, radius 10px, 30px padding, centered column, 6px gap. Line 1: 14px/600 `Choose an .xlsx file` with `.xlsx` in a mono chip (13px, `--surface-2`, 2px 6px, radius 4px). Line 2: 12px `--muted` "click to browse, or drop a file here". Hover / drag-over: `--accent` border, `--accent-soft` fill.
- Filled (`03-input-file-picked.png`): 1px `--line` card on `--surface-2`, radius 10px, 14px 16px, 14px gap. 34px `XLS` badge (mono 10px/700, `--ok` on `--ok-soft`, radius 8px), filename 13px/600 with ellipsis, meta line mono 11.5px `--muted` (`Master Sheet · 1,284 rows · 2.1 MB`), then a `Replace` text button (12px/600 `--accent`, hover `--accent-soft` fill).
- Folder mode: keep the existing "Choose folder…" button, path line, and file `select`, restyled to the tokens above.
- Validator only, below the input: `Reference output file` + qualifier `— .txt / .CDF / .tudf to compare byte-for-byte`; a shorter dashed drop zone (18px padding, 12.5px `--muted`) reading "Choose the reference output file (optional)", or `<filename> — replace` once set; then a checkbox row (16px box, radius 4px, accent when checked) "Ignore line-ending differences (CRLF vs LF)".

**OPTIONS** — two switch rows, 12px gap, switch left. Switch: 34×20px track, radius 999px, 2px padding, 16px white knob; off `--line`, on `--accent`; 150ms transition. Title 13px/500 `--ink`, description 11.5px `--faint`.
1. "Also generate the workbook report" / ".xlsx with one sheet per segment, sorted as filed"
2. "Bypass validation errors" / "Generate anyway — rejection risk. Parse and mapping errors are never bypassed."

---

### 2. Setup view — right rail
Fixed 372px, 1px left border, `--surface-2`, 22px 20px, column, 16px gap.

**Rail toggle** — only after a run has completed. Same segmented pattern on a `--field` track; both options `flex:1`, 8px padding, 12px/600, active `--accent` fill. Labels: `Generate` (or `Validate`) and `Findings` when the outcome has blocking errors, otherwise `Result`. The second option carries a count badge (1px 6px, radius 999px, mono 10.5px): on the active tab `rgba(255,255,255,.22)` on white text; inactive it takes the outcome color pair (`--err-soft`/`--err` for errors, `--warn-soft`/`--warn` otherwise). Count = error rows for an error outcome, error+warning rows when bypassed, warning rows when clean.

**a) Generate section** (default) — `01-setup-dark.png`
Heading `GENERATE` / `VALIDATE`. Then a readiness checklist, one row per line, 9px vertical padding, 1px `--line-soft` separators, 11px gap: 17px status dot (`✓` on `--ok-soft`/`--ok` when satisfied, `·` on `--line-soft`/`--faint` when not), label 12.5px/500 `--ink`, right-aligned value mono 11px (`--muted` satisfied, `--faint` not).

| Row | Value |
| --- | --- |
| Bureau format | `UCRF V3.10` |
| Member ID | the entered ID |
| Cycle | `23/07/2026 · W3` |
| Input workbook | `1,284 rows` / `not chosen` |
| Reference file (Validator only) | `NBF…W3.txt` / `optional` |

Primary CTA full width, 13px padding, radius 10px, 13.5px/700. Enabled: `--accent` on white with the accent glow. Disabled (no input file): `--line-soft` fill, `--faint` text, `cursor:not-allowed`. Label `Generate submission file` / `Validate and compare`.
Hint below, 11.5px `--faint`:
- no file: "Choose an .xlsx input file to enable this."
- ready: "Runs on this machine. Findings appear before anything is written to disk."
- ready with bypass on: "Bypass is on — errors will not stop the file being written."

Pinned to the bottom of the rail: `RECENT RUNS`, two rows (1px `--line` card on `--surface`, radius 8px, 9px 11px, 10px gap): 7px status dot (`--ok` / `--warn`), mono 11.5px filename with ellipsis, 11px `--faint` meta. Hover: accent border. Populate from real run history; the prototype shows
`NBFC00000101_16072026_10072026_W2.txt` · "1,240 borrowers · clean · 6 days ago" and
`NBFC00000101_09072026_03072026_W1.txt` · "1,231 borrowers · 2 warnings · 13 days ago".

**b) Running section** — `04-running-progress-in-rail.png`
Replaces the Generate section entirely (checklist, CTA, and recent runs are all hidden; the rail toggle is hidden while running).
Header row: 14px accent spinner (2px border, `--accent-soft` ring, `--accent` top, 0.7s linear) + title 12.5px/600 — "Generating submission file…" / "Validating and comparing…".
Progress bar: 3px track `--line`, radius 2px, accent fill, `width` transition 0.5s ease, `step/5`.
Step list, 9px rows with `--line-soft` separators: 18px dot, label 12.5px/500, right-aligned mono 11px detail.

| Step | Detail when complete |
| --- | --- |
| Reading workbook | `1,284 rows` |
| Mapping rows to segments | `6,142 segments` |
| Validating against spec | `16 errors` |
| Encoding records | `ASCII` |
| Writing output file | `done` |

Dot states: pending `--line-soft`/`--faint`; active `--accent-soft`/`--accent` with a 1.1s opacity pulse and detail `working…`; complete `✓` on `--ok-soft`/`--ok`. Pending labels are `--faint`, active and complete `--ink`.
`Cancel` button below, self-start, 1px `--line` on `--surface`, 12px/600 `--muted`; hover `--err` border and text. Cancel aborts the run and returns to the Generate section with no result.

**c) Result section** — `05-rail-findings-summary.png` (errors), `07-rail-result-clean.png` (clean)
Outcome pill, self-start, mono 10–11px/700:

| Outcome | Pill | Note (12.5px `--muted`) |
| --- | --- | --- |
| errors | `--err-soft`/`--err`, `16 BLOCKING ERRORS` | "No file written. 4 rules failed across 16 rows, plus 6 warnings. Fix the cells, then re-run." |
| bypassed | `--warn-soft`/`--warn`, `GENERATED WITH BYPASS` | "16 errors carried into the file — rejection risk on submission." |
| clean | `--ok-soft`/`--ok`, `GENERATED` | "6 warnings reviewed · file written to disk." |

If there are findings: a compact list of finding groups (all groups, errors first), 7px gap. Each is a 1px `--line` card on `--surface`, radius 9px, 11px 12px, 10px gap: severity chip (`ERROR` / `WARN`, mono 10px/700, 3px 7px, radius 5px, `--err-soft`/`--err` or `--warn-soft`/`--warn`), title 12.5px/600, `where` line mono 11px `--faint` (`AS · stateCode · enum`), right-aligned count `7 rows` mono 11.5px/600 `--muted`. Hover accent border; click opens the report view with that group expanded.

If clean: an output card (1px `--line` on `--surface`, radius 10px, 13px) with a 34px `TXT` badge (`--ok` pair), the filename in mono 11.5px with `word-break:break-all`, and a meta line `412 KB · ASCII · CRLF · no workbook report` (or `+ workbook report`). Below it, a 2×2 grid of count cards (radius 9px, 11px 12px): 17px mono value, 11px `--muted` label — Borrowers 1,284 · Credit facilities 1,507 · Addresses 1,349 · Segments 6,142.

Actions, stacked, 8px gap, 11px padding, radius 9px, 12.5px/600. Primary = `--accent` on white; secondary = 1px `--line` on `--surface` with `--ink` text.

| Outcome | Actions (setup rail) |
| --- | --- |
| errors | **Open full findings** (primary) · Export findings (.xlsx) · Mark cells fixed, re-run |
| clean / bypassed | **Save submission file…** (primary) · Open full report · Reveal in folder (or "Save workbook report (.xlsx)" when the report option is on) |

Rail footer, 11.5px `--faint`:
- with findings: "Findings are keyed to the exact sheet cell. Export them and hand the file back to whoever owns the Master Sheet."
- clean: "The file is written only after validation passes, so what you save is what the portal will accept."

---

### 3. Report view
`06-report-findings-full.png`, `08-report-result-clean.png`

Replaces the whole body below the toolbar; min-height 600px.

**Report header** — 18px 22px on `--surface-2`, 1px bottom border, 16px gap: `← Back to setup` button (1px `--line` on `--surface`, 7px 11px, radius 8px, 12.5px/600 `--muted`; hover accent), the outcome pill, the outcome note (12.5px `--muted`, `flex:1`), and a right-aligned run stamp in mono 11.5px `--faint` (`02/09/2026 12:41 · 3.2s` — real timestamp and duration).

**Findings pane** (left, `flex:1`, 24px 26px 30px)
Heading row: `FINDINGS`, hairline rule, then three filter chips right-aligned (5px 11px, radius 6px, 11.5px/600; active `--accent-soft`/`--accent`, inactive `--muted`): `All 22`, `Errors 16`, `Warnings 6` — counts are affected-row totals.

One card per rule group: 1px `--line`, radius 10px, `--surface-2`, overflow hidden.
- Header row, 14px 16px, clickable: severity chip, title 13.5px/600, `where` line mono 11.5px `--muted`, right side count mono 11.5px/600 `--muted` + chevron `▼`/`▲` (11px `--faint`).
- Expanded body, 0 16px 16px, 12px gap:
  - Fix guidance, 12.5px `--muted`, `line-height:1.6`, above a 1px `--line-soft` top border with 12px padding-top.
  - Row table: 1px `--line-soft`, radius 8px. Header 8px 12px on `--field`, 10.5px/700 uppercase `letter-spacing:.06em` `--faint`; grid `74px 62px 1fr` — **Row**, **Cell**, **Value read**. Body rows 8px 12px on `--surface`, 1px `--line-soft` top border, mono 11.5px: row number `--muted`, cell reference `--accent`, value `--ink` with ellipsis. A truncated group ends with a `4 more rows` line (11.5px `--faint`). Cap the inline table at 3 rows; the full set belongs in the `.xlsx` export (`test/issues-export.spec.ts`).
  - Rule footer: `Rule` (12px/600 `--muted`) + the spec reference (11.5px `--faint`), from `ValidationIssue.reference`.

Six groups are modelled in the prototype, derived from real `ValidationIssue` rules — build them from live data, not this list:

| Severity | Title | Where | Rows | Reference |
| --- | --- | --- | --- | --- |
| error | State / Union Territory code not recognised | `AS · stateCode · enum` | 7 | Catalogue 8.6 — State/UT codes |
| error | Borrower has no Registered Office address | `AS · locationType · portal-mandatory` | 3 | §7.3 — Address Segment Rules |
| error | PIN code could not be parsed from the address text | `AS · pinCode · parse · not bypassable` | 4 | Master Sheet layout — address column AH |
| error | Wilful Default Date missing while status is set | `CR · wilfulDefaultDate · mandatory` | 2 | §7.5, CR fields 35–36 |
| warning | Borrower Name exceeds 100 characters — will be truncated | `BS · borrowerName · length` | 4 | §7.2 — Borrower Segment |
| warning | GST number format looks wrong | `BS · gstin · format` | 2 | §7.2 — Borrower Segment |

Grouping key: `rule + fieldKey + segment tag`. Title = a human sentence per rule (use `fieldLabel` where the message is generic); `where` = `tag · fieldKey · rule`, plus ` · not bypassable` when `bypassable === false`. Sort errors before warnings, then by descending row count.

**Clean pane** (`08-report-result-clean.png`) — `FILE CONTENTS` heading, a 4-up grid of count cards (radius 10px, 14px, mono 21px value, 11.5px `--muted` label) from `ConvertResult.counts`, then a `FIRST RECORDS` panel: header bar 10px 14px on `--field` (11px/700 uppercase `--faint`) with a right-aligned `ASCII · CRLF` note in normal case, body 12px 14px on `--surface-2`, mono 11px, `line-height:1.75`, `white-space:pre`, `--muted` — the first few real output records.

**Output rail** (right, 336px, 1px left border, `--surface-2`, 24px 22px)
`OUTPUT` heading; output card (`TXT` badge — `--err` pair for the error outcome, `--ok` otherwise; filename or `nothing written`; meta `412 KB · ASCII · CRLF · …` or "Fix the blocking findings, then re-run"); the action stack; a 1px `--line` divider; then a run-facts list — label 12px `--faint` in a 96px column, value mono 11.5px/500 `--ink`, `word-break:break-all`:

Format · `Commercial UCRF V3.10` — Member · `NBFC00000101 · CheFair` — Cycle · `23/07/2026 (W3)` — Created · `17/07/2026` — Bypass · `ON` / `off`.

Rail footer text as in the setup rail.

Report-view actions drop the self-referential entry (no "Open full findings" while already in the report):

| Outcome | Actions (report rail) |
| --- | --- |
| errors | **Export findings (.xlsx)** (primary) · Mark cells fixed, re-run |
| clean / bypassed | **Save submission file…** (primary) · Reveal in folder / Save workbook report (.xlsx) |

---

### 4. Validator mode
`09-validator-mode.png`

Same two-pane frame. Differences: the toolbar blurb, the reference-file block in the left pane, the extra `Reference file` checklist row, the rail titled `VALIDATE`, and the CTA `Validate and compare`. Results reuse the same rail and report views; the comparison verdict occupies the outcome pill and note — `MATCH ✓` / `MISMATCH ✕` / `CANNOT COMPARE` (from `engine.ts`), with the byte summary as the note. Validation findings render exactly as in Convert.

---

## Interactions & behavior

Flow: **pick input → Generate → progress in rail → result in rail → (optional) full report → fix → re-run.**

- **Mode switch** (Convert ↔ Validator): resets status to idle, clears the outcome, returns the rail to Generate and the view to setup. Form field values persist.
- **Cycle buttons**: set the reporting date to the 9th / 16th / 23rd / last day of the selected month; the accent chip and the checklist row update immediately. Month change re-resolves the same cycle point. No free calendar (the existing rule).
- **Input file**: click or drop; drag-over paints the accent border and fill. `Replace` clears the file, the status, and the outcome, and returns the rail to Generate.
- **Generate** is inert until an input file exists (disabled styling, `cursor:not-allowed`).
- **Run**: rail switches to the running section, steps advance as the real pipeline reports (the prototype uses a fixed 620ms tick; drive it from engine phases). On completion, the rail auto-switches to the Result tab. The setup form stays visible and untouched throughout — the operator can read their inputs while findings are on screen.
- **Rail toggle**: appears only after a completed run; `Generate` restores the checklist, CTA, and recent runs; `Findings` / `Result` restores the result section. The toggle is hidden while running.
- **Finding group click** (rail): opens the report view, resets the filter to All, expands that group. Nothing else collapses.
- **Finding group header click** (report): toggles only that group. The prototype opens the first group by default; keep that.
- **Filter chips**: filter the group list by severity; expansion state survives filtering.
- **Mark cells fixed, re-run**: re-runs and produces the clean outcome. In production this is a plain re-run of the same input — the operator has edited the workbook in Excel meanwhile — so re-read the file from disk rather than reusing a cached parse.
- **Bypass on + errors**: outcome is `bypassed`; the file IS written, the pill is amber, and the findings list stays visible. Non-bypassable errors (`bypassable === false`, e.g. the PIN parse failure) must still block emission even with bypass on — surface that in the note.
- **Back to setup**: returns to the setup view with the rail still on the result tab.
- **Theme toggle**: flips `data-theme` on the root; persist it.
- Transitions: segmented and switch states 120–150ms; progress bar width 500ms ease; spinner 0.7s linear; step pulse 1.1s ease-in-out. Nothing else animates.
- Hover states: cards and secondary buttons take an accent border; text buttons take an `--accent-soft` fill; the theme toggle and cancel button recolor as noted. Every clickable element needs a visible focus ring for keyboard use (2px `--accent` outline, 2px offset) — the prototype does not model this and the current app is keyboard-thin.

## State management

```
theme          'dark' | 'light'                        persisted
mode           'convert' | 'validate'
view           'app' | 'report'
rail           'generate' | 'results'
status         'idle' | 'running' | 'done'
step           0..5                                    running progress
outcome        null | 'errors' | 'bypassed' | 'success'
source         'file' | 'folder'
file / ref     picked input and reference file
eol            boolean   ignore CRLF vs LF (validator)
report         boolean   also emit workbook report
bypass         boolean   bypass validation errors
fixed          boolean   prototype-only: forces the clean re-run
cycle          'W1' | 'W2' | 'W3' | 'ME'
month          'YYYY-MM'
format         FormatId
memberId, memberName, creation
filter         'all' | 'errors' | 'warnings'
open           Record<groupId, boolean>                expanded finding groups
```

Derived, not stored: reporting date (cycle + month), readiness (input file present), error/warning row totals, rail badge count, grouped findings, outcome pill and note.

Transitions: `Generate` → `status:'running'`, `step:0`, `rail:'generate'`, `view:'app'` · run completes → `status:'done'`, `rail:'results'`, outcome set · `Cancel` → `status:'idle'`, `step:0` · mode switch or `Replace` → idle and outcome cleared.

Data: everything comes from the local engine — `listFormats()`, `convert()`, `ValidationReport.issues`, `ConvertResult.counts` / `outputText`, plus recent-run history from local storage. No network calls beyond the existing auth and version gates.

## Edge cases

1. **No input file** — CTA disabled with the explanatory hint; the checklist row shows `not chosen` with a hollow dot.
2. **Blank member ID or dates on a flat-sheet format** — legal (the sheet's header cells override). Keep the helper text; the checklist may show a hollow dot but must not block Generate.
3. **Non-bypassable errors** — bypass cannot emit the file. Show the `errors` outcome and name the offending group (`… · not bypassable`), and say why in the fix text.
4. **Bypass with errors** — file written, amber `GENERATED WITH BYPASS` pill, findings kept on screen, `Bypass · ON` in the run facts.
5. **Clean run with warnings** — green pill, note counts the warnings, findings list still reachable via the rail toggle (labelled `Result` with a warning-tinted badge).
6. **Zero issues at all** — hide the findings list and the filter chips; the report's left pane shows only the file-contents panel.
7. **Single-row group** — count reads `1 row`, not `1 rows`.
8. **Long values** — filenames use `word-break:break-all`; the `Value read` column and picked filename use `text-overflow:ellipsis` on `white-space:nowrap`; the mode blurb caps at 520px.
9. **Groups larger than 3 rows** — inline table caps at 3 with a `N more rows` line; the full set goes to the `.xlsx` export.
10. **Cancel mid-run** — no partial file, no outcome, rail returns to Generate, status line back to idle.
11. **Validator with no reference file** — comparison is optional; validation still runs. Checklist value reads `optional` and must not block the CTA.
12. **Comparison impossible** (wrong format, unreadable reference) — `CANNOT COMPARE` pill with the engine's reason as the note.
13. **Empty input sheet** (`empty-input` rule) — treat as an error outcome with a single group rather than a zero-count success.
14. **Folder mode with no folder chosen** — the file `select` keeps its `— choose a folder above —` placeholder; CTA stays disabled.
15. **Session revoked / offline gate / update required mid-run** — existing blocking overlays still win over everything, including a run in progress; the toast keeps its current behavior.
16. **Theme switch mid-run** — purely visual, no state loss (all colors are tokens).
17. **Narrow window** — the frame is desktop-fixed; below ~1150px the left pane's two-column grids should collapse to one column before the rail shrinks. The rail's 372px is a floor.
18. **Very long member name** — the run-facts value wraps (`word-break:break-all`); do not truncate the ID.

## Assets

None. No images or icon files. The calendar glyph `▤`, chevrons `▼`/`▲`, check `✓`, dot `·`, sun/moon `☀`/`☾`, and the status dot `●` are text characters; the spinner and progress bar are CSS. Fonts load from Google Fonts (IBM Plex Sans + IBM Plex Mono) — self-host them for the offline desktop build, since the app runs with no network.

## Files

- `CIC Converter.dc.html` — the clickable design reference (all views and states)
- `screenshots/01-setup-dark.png` — setup view, dark, no input chosen
- `screenshots/02-setup-light.png` — setup view, light theme
- `screenshots/03-input-file-picked.png` — input file chosen, CTA enabled
- `screenshots/04-running-progress-in-rail.png` — run in progress in the rail
- `screenshots/05-rail-findings-summary.png` — error outcome in the rail, toggle visible
- `screenshots/06-report-findings-full.png` — full report, findings with row/cell tables
- `screenshots/07-rail-result-clean.png` — clean outcome in the rail
- `screenshots/08-report-result-clean.png` — full report, counts and first records
- `screenshots/09-validator-mode.png` — Validator mode

Existing code to change: `packages/desktop/index.html`, `packages/desktop/src/styles.css`, `packages/desktop/src/main.ts`. Read-only references: `packages/core/src/core/result.ts`, `packages/core/src/formats/index.ts`, `packages/desktop/src/engine.ts`.

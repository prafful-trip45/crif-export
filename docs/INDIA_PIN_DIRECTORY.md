# India Post PIN/state lookup

Commercial Master Sheet borrower address validation uses an exact offline index,
not postal-circle prefixes. The emitted PIN is checked against its selected or
parsed CRIF state. An explicit Borrower's PIN cell takes precedence and receives
the error if present. Blank optional PINs and foreign addresses keep existing rules.
The address parser also uses this index for state inference in AS/RS/GS, but only
when a PIN has exactly one recorded geographic state.

## Source and coverage

Publisher: Department of Posts, Ministry of Communications, Government of India.
[All India Pincode Directory till last month](https://www.data.gov.in/resource/all-india-pincode-directory-till-last-month),
resource `5c2f62fe-5afa-4119-a499-fec9d604d5bd`.
Downloaded directly from the CSV API linked by that official resource on 2026-09-11.
The resource page reports an update date of 03/10/2025; retrieval is not a claim
that the source was updated on the retrieval date.

Licensed under [Government Open Data License - India](https://www.data.gov.in/government-open-data-license-india).
This derived index is not endorsed by India Post. Source SHA-256, retrieval date,
and counts are embedded in `packages/core/src/formats/enums/india-pincodes.json`.
The raw download has 165,627 office rows and 19,586 distinct PINs across all 36
current states/UTs. The compact index stores only PIN/state associations.

## Exceptions and limits

- 52 PINs have multiple state entries. Retain all recorded states; a state outside
  that set is an error. A match still produces an ambiguity warning, since the
  source can contain both cross-border services and inconsistent records. Never
  infer a single state from such a PIN.
- 715 office rows lack a state (`NA`); other offices resolve most of their PINs.
  100 PINs have no recorded state at all. Keep them as known PINs and warn that
  state verification is unavailable. Do not substitute a postal-circle guess.
- CRIF legacy code 09 is compatible with merged territory code 08.
- Listed Army Postal Service PINs starting with 9 warn that geographic state
  validation is unavailable; they do not drive state inference.
- An absent PIN is an error saying it is **not listed in the bundled directory**,
  not proof it has never existed. New assignments require a reviewed refresh.
- Mismatch/unlisted errors block conversion even with error bypass enabled.

## Refresh

Download the complete CSV using the resource page's CSV export (not the API's
default limited page). Then run:

```sh
node scripts/import-india-pincodes.mjs /absolute/path/to/pincode.csv
npm test
npm run build --prefix packages/desktop
```

The importer validates schema values, all 36 states, at least 150,000 offices and
19,000 PINs before writing. It retains missing and conflicting data explicitly.
Review changes in counts, unknown-state PINs and source hash before committing a
refresh. Updates ship with the application; customer addresses are never sent to
a lookup service and conversion requires no network access.

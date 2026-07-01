---
name: crif-commercial-format
description: Authoritative reference for the CRIF Highmark Commercial UCRF V3.9 (delimited) bureau format — the code catalogues (Legal Constitution, Business Category/Industry, State, Location Type, Relationship, Related/Guarantor Type, Gender, Asset Classification, Account Status, Security Type/Classification, Currency) and the per-segment field orders (HD/BS/AS/RS/CR/GS/SS/CD/TS), plus how the accountant "Master Sheet" flat row maps into those segments. Load this when converting/validating commercial Master Sheets, mapping any coded column to a CRIF code, fixing the commercial-ucrf(-flat) format specs, or debugging a code/field-order mismatch against a golden. Source of truth is the client-provided spec PDF; use these tables instead of guessing or sample-deriving codes.
---

# CRIF Highmark Commercial UCRF V3.9 (delimited) — format reference

Source: `training-references/crif-reporting-io/Commercial/Commercial UCRF - V3.9-Delimited_APR2025.pdf`
(Section 8 catalogues + segment field lists). These codes are **fixed by CRIF** — the
client's only job is to put the right value in each column. When a coded column disagrees
with a golden, trust these tables, not a value reverse-engineered from one sample.

Engine code that must stay in sync:
- `packages/core/src/formats/commercial-ucrf.ts` — segment wire specs (HD/BS/AS/RS/CR/GS/SS/CD/TS)
- `packages/core/src/formats/commercial-ucrf-flat.ts` — Master Sheet → segments (`explode`) + legend maps
- `packages/core/src/formats/enums/commercial-enums.ts` — CURRENCY / INFO_TYPE / STATE_CODE

> ⚠️ Known bugs this reference corrects (as of 2026-07): `STATE_CODE` (enum) used the wrong
> numbering (UP=09/Gujarat=24 — WRONG); `LEGAL_CONSTITUTION` used a sequential 11–21 scheme
> (Proprietorship must be 30, Partnership 40, HUF 55); `ASSET_CLASSIFICATION` used 0001–0014
> sequential (SMA 2 must be 0008, Loss 0004). `RELATIONSHIP_TYPE` used 45–57 (Proprietor is 20,
> Partner 30, Promoter Director 51).

---

## 1. Code catalogues (Section 8)

### 8.2 Legal Constitution (BS field 12)
| Code | Constitution |
|------|--------------|
| 11 | Private Limited |
| 12 | Public Limited |
| 20 | Business Entities Created by Statute |
| 30 | Proprietorship |
| 40 | Partnership |
| 50 | Trust |
| 55 | Hindu Undivided Family (HUF) |
| 60 | Co-operative Society |
| 70 | Association of Persons |
| 80 | Government |
| 85 | Self Help Group |

### 8.3 Business Category (BS field 13) — code = dropdown position
`01 MSME · 02 SME · 03 Micro · 04 Small · 05 Medium · 06 Large · 07 Others`

### 8.4 Business / Industry Type (BS field 14) — code = dropdown position
`01 Manufacturing · 02 Distribution · 03 Wholesale · 04 Trading · 05 Broking · 06 Service Provider · 07 Importing · 08 Exporting · 09 Agriculture · 10 Dealers · 11 Others`

### 8.5 Location Type (AS field 1 / office location)
`01 Registered Office (Required) · 02 Branch/Regional · 03 Warehouse · 04 Plant/Factory · 05 Others · 06 Mortgage Property`

### 8.6 State (AS/RS/GS state code) — **this is the correct table**
| Code | State | Code | State |
|------|-------|------|-------|
| 01 | Andaman & Nicobar Is. | 19 | Madhya Pradesh |
| 02 | Andhra Pradesh | 20 | Maharashtra |
| 03 | Arunachal Pradesh | 21 | Manipur |
| 04 | Assam | 22 | Meghalaya |
| 05 | Bihar | 23 | Mizoram |
| 06 | Chandigarh | 24 | Nagaland |
| 07 | Chhattisgarh | 25 | New Delhi |
| 08 | Dadra & Nagar Haveli | 26 | Orissa |
| 09 | Daman & Diu | 27 | Puducherry |
| 10 | Goa | 28 | Punjab |
| 11 | Gujarat | 29 | Rajasthan |
| 12 | Haryana | 30 | Sikkim |
| 13 | Himachal Pradesh | 31 | Tamil Nadu |
| 14 | Jammu & Kashmir | 32 | Tripura |
| 15 | Jharkhand | 33 | Uttar Pradesh |
| 16 | Karnataka | 34 | Uttarakhand |
| 17 | Kerala | 35 | West Bengal |
| 18 | Lakshadweep | 36 | Telangana |

### 8.7 Type of Relationship (RS field 3 / relationship)
`10 Shareholder · 11 Holding Company · 12 Subsidiary Company · 20 Proprietor · 30 Partner · 40 Trustee · 51 Promoter Director · 52 Nominee Director · 53 Independent Director · 54 Director – Since Resigned · 55 Individual Member of SHG · 56 Other Director · 60 Others · 70 Karta (HUF)`

### Related / Guarantor Type (RS field 2 / GS field 2) — the sheet's "Guarantor Type" / "Related Type" dropdown
`1 Business Entity Registered in India · 2 Resident Indian Individual · 3 Business Entity Registered Outside India · 4 Foreign/Non-Resident Indian Individual`
> Golden byte-quirk: RS emits this **unpadded** (`2`), GS emits it **zero-padded** (`02`).

### Gender (RS/GS)
`01 Male · 02 Female · 03 Transgender`. Courtesy prefix: Male→`Mr`, Female→`Ms`, Transgender→(blank).

### 8.10 Asset Classification / Days Past Due (CR field 14) — **non-sequential**
| Input legend (dropdown) | Code |
|-------------------------|------|
| 1 Standard | 0001 |
| 2 Sub-standard | 0002 |
| 3 Loss | 0004 |
| 4 SMA 0 | 0006 |
| 5 SMA 1 | 0007 |
| 6 SMA 2 (and NA) | 0008 |
| 7 Doubtful-1 | 0009 |
| 8 Doubtful-2 | 0010 |
| 9 Doubtful-3 | 0011 |
| 10 NPA | 0012 |
| 11 ARC Loan | 0013 |
| 12 → 1 Day Past Due | 1001 |
| 13 → 2 Days Past Due | 1002 |
| 14 → 0 Day Past Due | 1000 |

`1nnn` = nnn days past due (e.g. 214 days → 1214); `1999` = 999+ days.

### 8.11 Account Status (CR field 25)
`01 Open · 02 Closed By Payment · 03 Settled & Closed · 04 Restructured · 05 Written Off · 06 Settled Post Write Off · 07 Invoked · 08 Devolved · 09 Restructured (Natural Calamity) · 10 Sold to ARC · 11 Purchase from Bank · 12 Restructured & Closed`

### Repayment Frequency (CR)
`01 Monthly · 02 Quarterly · 03 Half-yearly · 04 Annual · 05 On Demand · 06 Bullet · 07 Rolling · 08 Others`

### 8.12 Suit Filed Status (CR)
`00 Not a Suit Filed Case · 01 Suit Filed · 02 Trial in Progress · 03 Decree Issued · 04 Execution of Decree · 05 NCLT/NCLAT Suit Filed`

### 8.14 Security Type (SS field 3) — 3-digit
`001 Cash/Bullion/Bank Deposits · 002 Shares/Bonds/Securities · 003 Inventory · 004 Accounts Receivable · 005 Other Current Assets · 006 Plant & Machinery · 007 Land & Buildings · 008 Other Fixed Assets · 009 Other Assets · 010 Aggregate of all Current Assets · 011 Aggregate of all Fixed Assets`

### 8.15 Security Classification (SS field 4) — 2-digit
`01 Primary–First Charge · 02 Primary–Second Charge · 03 Primary–Third Charge · 04 Primary–Parri Passu · 21 Collateral–First Charge · 22 Collateral–Second Charge · 23 Collateral–Third Charge · 24 Collateral–Parri Passu`

### 8.8 Currency
3-letter ISO-ish (`INR` Indian Rupee is the default). Full list in the PDF.

---

## 2. Segment field order (wire = pipe `|` delimited)

Token 0 is always the tag. Blank fields still emit a `|`. Widths below are the golden
token counts the encoder pads to.

- **HD** (header): `HD | memberId | prevMemberId | creationDate | reportingDate | infoType(01) | filler`
- **BS** (per borrower, 28 tokens): key fields — 3 borrowerName, 7 pan, **12 legalConstitution**, 13 businessCategory, 14 businessIndustryType.
- **AS** (per borrower, 18 tokens): 1 officeLocationType(01), 3 addressLine1, 4/5 line2/3, 6 cityTown, 7 district, 8 stateCode, 9 pinCode, 10 country, 11 mobile.
- **RS** (related person, 40 tokens): 2 relatedType, 3 relationship, 7 namePrefix, 8 fullName, 9 gender, 12 dateOfBirth, 13 pan, 25 addr1, 28 city, 29 district, 30 stateCode, 31 pin, 32 country, 33 mobile.
- **GS** (guarantor, **38 tokens** — RS-like but shifted): 2 relatedType(padded), **6 namePrefix, 7 fullName, 8 gender, 11 dateOfBirth, 12 pan, 23 addressLine1, 26 city, 27 district, 28 stateCode, 29 pinCode, 30 country, 31 mobile**. (This differs from RS by the missing `relationship`/`businessEntityName`/one-ID slot — get the exact order from a populated golden before trusting a hand count.)
- **CR** (credit facility): 1 accountNumber, 3 sanctionDate, 4 sanctionedAmount, 5 currency(INR), 6 creditType, 8 repaymentFrequency, 9 drawingPower, 10 currentBalance, 14 assetClassification, 16 amountOverdue, 25 accountStatus, 34 wilfulDefaultStatus, 36 suitFiledStatus.
- **SS** (security, 8 tokens): 1 securityValue, 2 currency(INR), 3 securityType, 4 securityClassification.
- **CD** (cheque dishonour, 8 tokens): dateOfDishonour, amount, instrumentNumber, timesDishonoured, chequeIssueDate, reasonForDishonour.
- **TS** (trailer): `TS | borrowerCount | accountCount | filler`.

---

## 3. Master Sheet → segments (the flat-explode mapping)

The accountant keeps **one flat row per borrower** in a "Master Sheet"; each row explodes into
`BS, AS, RS?, CR, GS*, SS*, CD*`. Rules:

- **Column resolution:** match by header **text** (`columnHeaders`), not column letter — layouts
  shift (e.g. a doubled "Asset Classification" column moves everything right). For **repeated**
  headers (multiple guarantor blocks) header text can't disambiguate → detect each repeated
  "Guarantor Type" column and read the fixed offsets after it (**positional** block detection).
- **Coded columns accept:** the dropdown number (`"4"`), the label (`"Proprietorship"`, any case),
  or the already-CRIF code (`"30"`). Category/Industry map by dropdown **position**; Constitution/
  Relationship/Asset-Class map via the **catalogues above** (non-sequential).
- **`NA`** anywhere means blank.
- **Dates** arrive as DDMMYYYY text, Excel serials, or JS `Date` → normalize to DDMMYYYY.
- **Address:** prefer explicit **City / State / PIN** columns when the template has them; keep the
  full address text in **Address Line 1**; District carries the **state name** (canonical), state
  code from table 8.6, country field carries the telephone STD code (`079` in the sample).
- **Header cells** `B5/B6/B7` = Member ID / Reporting Date / Creation Date override CLI flags.
  Creation Date is often absent from the sheet → supply via UI/CLI.

## 4. Gotchas / non-determinism
- Some client "golden" outputs are **hand-finalized**: identical input rows can carry different
  codes (seen in `commercial_output_1Jul_OD_Loan.txt` — same "PARTNER" → 30/60/51). Such files are
  **smoke-only** references (must convert without validation errors), not byte-exact goldens.
- Minor golden artifacts exist (e.g. a stray leading space in a GS district). Decide per file
  whether to normalize or replicate before byte-comparing.

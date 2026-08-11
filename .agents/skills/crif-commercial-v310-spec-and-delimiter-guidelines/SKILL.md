---
name: crif-commercial-v310-spec-and-delimiter-guidelines
description: Technical reference for CRIF High Mark Commercial UCRF V3.10 specifications, CR segment delimiter math, AS dual-emission, and V3.9 deprecation rules.
---

# CRIF High Mark Commercial UCRF V3.10 Specification & Delimiter Guidelines

This reference documents the bureau specification rules, segment delimiter counts, field definitions, and engine implementation decisions for CRIF High Mark Commercial Credit Reporting (V3.10).

---

## 1. Bureau Specification & Delimiter Math

In CRIF High Mark pipe-delimited text exports (`.txt`), fields are separated by the pipe character (`|`).
For any segment containing $N$ fields, the number of pipe delimiters is exactly $N - 1$.

$$\text{Pipes} = \text{Field Count} - 1$$

### Segment Layout & Delimiter Summary (V3.10)

| Segment Tag | Segment Name | Field Count ($N$) | Pipe Delimiters | Last Field in Standard Wire Format |
| :--- | :--- | :--- | :--- | :--- |
| **`HD`** | Header Segment | 7 Fields | **6 Pipes** | `hdFiller` |
| **`BS`** | Borrower Segment | 28 Fields | **27 Pipes** | `bsFiller` |
| **`AS`** | Address Segment | 18 Fields | **17 Pipes** | `asFiller2` |
| **`RS`** | Related Person Segment | 40 Fields | **39 Pipes** | `rsFiller2` |
| **`CR`** | Credit Facility Segment | **44 Fields** | **43 Pipes** | `ufceAmount` (Field 44 / Index 43) |
| **`GS`** | Guarantor Segment | 38 Fields | **37 Pipes** | `gsFiller` |
| **`SS`** | Security Segment | 7 Fields | **6 Pipes** | `ssFiller` |
| **`CD`** | Cheque Dishonour Segment | 8 Fields | **7 Pipes** | `cdFiller` |
| **`TS`** | Trailer Segment | 4 Fields | **3 Pipes** | `tsFiller` |

---

## 2. The `CR` Segment Delimiter Issue & Resolution

### The Problem (`OUTPUT.txt` Delimiter Rejection)
An un-truncated output (`OUTPUT.txt`) contained **45 pipe delimiters (46 fields)** in the `CR` segment:
```text
CR|1947555888||04062025|3500000|INR|0410||01||1776905||||0001||0|||||||||01|||||||||0||00|||||||||
```
Because the standard wire specification expects **44 fields (43 pipes)** ending at `ufceAmount`, the extra two trailing pipes caused portal rejection:
> *"Segment CR delimiter count mismatch: expected 43 delimiters, found 45"*.

### The Resolution in V3.10 Engine
1. **Standard Wire Emission**: The V3.10 engine emits the standard **44 fields (43 pipe delimiters)** for `CR`, stopping at `ufceAmount` (Field 44):
   ```text
   CR|1947555888||04062025|3500000|INR|0410||01|0|1776905||||0001||0|||||||||01|||||||||0||00|||||||
   ```
2. **PDF V3.10 Extension Support**: In the 13th April 2026 PDF manual (Table 7.5, Page 39), Field 45 is listed as `UFCE Date`. When explicit `UFCE Date` data is supplied, the V3.10 specification emits 45 fields (44 pipes).

---

## 3. Key V3.10 Business Rules & Defaults

1. **Mandatory DUNS Defaults**:
   - `officeDunsNumber` (AS), `relationshipDuns` (RS), and `gsDuns` (GS) default to `"999999999"` when unpopulated in single-address Master Sheets.
2. **Drawing Power**:
   - Missing Drawing Power defaults to `0` for revolving and credit facilities.
3. **HD Reporting Cycle Code**:
   - Derived automatically from the reporting date (`W1` for 9th, `W2` for 16th, `W3` for 23rd, `ME` for month-end).
4. **AS Dual-Emission (Section 7.3)**:
   - CRIF portal requires every borrower to have at least one `01 Registered Office` address.
   - If an accountant selects a non-`01` location (e.g. `03` Warehouse or `04` Plant), the pipeline dual-emits:
     1. Mandatory `01 Registered Office` `AS` segment.
     2. Secondary user-selected `AS` segment (`03`/`04`).

---

## 4. V3.9 Format Deprecation

- **Default Format**: `commercial-ucrf-flat-v310` is the primary, default format in the application registry (`packages/core/src/formats/index.ts`).
- **Legacy Status**: `commercial-ucrf-flat` is marked as `Commercial UCRF V3.9 (Deprecated)` and retained only for backward-compatibility test validation.

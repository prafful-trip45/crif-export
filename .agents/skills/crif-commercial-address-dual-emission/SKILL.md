---
name: crif-commercial-address-dual-emission
description: Instructions and reference for handling CRIF Commercial Address Segment (AS) Registered Office requirement and dual-emission logic when converting flat Master Sheets.
---

# CRIF Commercial Address Segment (AS) Dual-Emission

## Problem & Bureau Requirement Context
In **CRIF High Mark Commercial UCRF V3.9 & V3.10** specifications:
- **Catalogue 8.4 Location Type**:
  - `01 Registered Office – Required` *(Mandatory)*
  - `02 Branch / Regional Office`
  - `03 Warehouse`
  - `04 Plant / Factory Address`
  - `05 Others`
  - `06 Mortgage Property Address`
- **Section 7.3 (Address Segment Rules)**:
  > **`Registered Address is Mandatory.`**
  - Every commercial borrower submitted to the bureau **MUST** have at least one Registered Office (`01`) address.
  - If a borrower record contains only non-registered office addresses (such as `03` Warehouse or `04` Plant/Factory), the CRIF portal rejects the entire borrower record:
    > *"No Registered Office address: the portal requires at least one address with Location Type 01 for each borrower."*

## Flat Master Sheet Conflict
Accounting teams use single-row "Master Sheet" Excel templates where **only one address block** is provided per borrower row.
When an accountant selects Location Type `03` (Warehouse) or `04` (Plant / Factory Address) for that single address, exporting only that single `AS` segment leaves the borrower with **zero Registered Office (`01`) addresses**, causing total validation failure.

## Resolution: Dual-Emission Pattern
To support accountant choice in single-address flat Master Sheets without breaking CRIF bureau compliance, the core exporter (`packages/core/src/formats/commercial-ucrf-flat.ts`) implements **Dual-Emission**:

1. **Mandatory Segment**: Always emits an `AS` segment with `officeLocationType = '01'` (Registered Office) using the primary address.
2. **User-Selected Segment**: If the input `locationType` is specified as a non-`01` code (e.g., `03` or `04`), the exporter dual-emits a second `AS` segment with `officeLocationType = userLocType`.

### Implementation Location
File: `packages/core/src/formats/commercial-ucrf-flat.ts` (`explode` function)

```typescript
const ba = resolveAddress(input.address, input.borrowerCity, input.borrowerState, input.borrowerPin);
const userLocType = mapLegend(LOCATION_TYPE, input.locationType);
const primaryLocType = userLocType || DEFAULTS.officeLocationType;

// 1. Always emit mandatory Registered Office (01) AS segment
seeds.push({
  tag: 'AS',
  flag: 2,
  values: row({
    _tag: 'AS',
    officeLocationType: '01',
    officeDunsNumber: strNA(input.officeDuns) || DEFAULTS.officeDuns,
    addressLine1: ba.line1,
    cityTown: ba.city,
    district: ba.city,
    stateCode: ba.stateCode,
    pinCode: ba.pinCode,
    country: DEFAULTS.countryCode,
    mobileNumber: strNA(input.contactNo),
  }),
});

// 2. Dual-emit user-selected secondary AS segment if non-01 (e.g. 03, 04)
if (primaryLocType !== '01') {
  seeds.push({
    tag: 'AS',
    flag: 2,
    values: row({
      _tag: 'AS',
      officeLocationType: primaryLocType,
      officeDunsNumber: strNA(input.officeDuns) || DEFAULTS.officeDuns,
      addressLine1: ba.line1,
      cityTown: ba.city,
      district: ba.city,
      stateCode: ba.stateCode,
      pinCode: ba.pinCode,
      country: DEFAULTS.countryCode,
      mobileNumber: strNA(input.contactNo),
    }),
  });
}
```

## Key Principles
1. **Never suppress `01 Registered Office`**: Bureau portal rejection is guaranteed without at least one `01` address per borrower.
2. **Preserve User Intent**: Emitting the secondary `03`/`04` segment ensures non-registered location classifications are still captured in bureau reporting.

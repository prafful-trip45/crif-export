# CRIF Export — Architecture & Business

> **Status:** Internal reference. Last updated 2026-06-28.
> **Product:** `crif-export` — converts NBFC/lender customer & loan data in Excel
> into portal-ready **CRIF Highmark** credit-bureau submission files (Consumer
> UCRF-12, Commercial UCRF, MFI CDF), with a validation report.
> **Repo:** standalone — `~/Desktop/Work/crif-export` (NOT inside EduBridge-TS).

---

## 1. Executive summary

Indian lenders (NBFCs, MFIs, fintechs) are **regulatorily required** to submit
borrower data to credit bureaus (CRIF Highmark, CIBIL, Experian, Equifax) on a
recurring cycle. The bureau file formats are rigid, fixed-width/delimited, and
unforgiving — one malformed field rejects the whole upload. Today most small/mid
lenders do this with brittle Excel macros, manual formatting, or by paying a
vendor per record.

`crif-export` is a **spec-driven conversion engine** that turns a familiar Excel
sheet into a **byte-exact** bureau file, validates it up front, and runs
**entirely on the customer's machine** — borrower PII never leaves the device.
It ships as a CLI, a local web portal, and a native **macOS/Windows desktop app**,
all over one engine. Conversion has **zero per-record cost** and **near-zero
infrastructure cost**, giving a ~100% gross margin at any sensible price point.

The strategic question is **pricing/positioning**, not technology or cost (see
Part B): the live competitor (Credionix) prices ~10× cheaper per record than our
internal costing doc assumed, so the headline number needs a deliberate
value-vs-undercut decision.

---

## 2. The problem & market

**Who:** NBFCs, microfinance institutions (MFIs), housing-finance companies,
fintech lenders, and the consultants/DSAs who file on their behalf.

**The pain:**
- Bureau formats (CRIF Highmark UCRF/CDF) are **fixed-layout, version-specific,
  and change periodically**. A wrong width, code, or date format → bulk rejection.
- Data originates as Excel/loan-management-system exports — a **format gap**.
- Filing is **recurring** (weekly/fortnightly/monthly) across **multiple
  portals/entities** → repetitive, error-prone manual work.
- Borrower data is **sensitive PII** → sending it to a hosted SaaS is a
  compliance and trust liability.

**Market reference (internal sizing):** a representative customer files ~70
borrowers × 25 companies × weekly × 4 portals ≈ **28,000 generations/month**
(~336K/year). See `financials/CRIF_COSTING_INTERNAL.md`.

---

# Part A — Architecture

## A1. Monorepo & packages

TypeScript monorepo (ESM). Five packages, **one engine, four front-ends**:

| Package | Role |
|---|---|
| `packages/core` | The spec-driven conversion **engine** (~3,500 LOC). Runtime-agnostic. |
| `packages/cli` | Command-line interface (`commander`) — automation/power users. |
| `packages/web` | Local web portal (zero-dep Node HTTP server + single-page UI). |
| `packages/worker` | Cloudflare Worker variant (proves the engine runs in a browser-like V8). |
| `packages/desktop` | **Tauri v2 native app** (macOS + Windows) — the primary end-user product. |

**Key invariant:** every front-end calls the same `core.convert()` **in-process**.
No front-end shells out to another (e.g. the GUI does *not* invoke the CLI). This
guarantees identical, byte-for-byte output regardless of surface.

```
   CLI ─┐
   Web ─┤
 Worker ─┼──▶  core.convert(buffer, format, meta)  ──▶  byte-exact bureau file
Desktop ─┘                                          └─▶  validation report
```

## A2. The spec-driven engine (`core`)

A CRIF format is expressed as **pure declarative data**, not code: a header
segment, ordered body segments, and a trailer — each a list of typed fields
(`code / length / type / mandatory / enum / pad`). One engine interprets these
specs; it never hard-codes a format. This is the seam that lets all formats share
one tested code path. Three encoding strategies cover every format:

- **fixed-width** — pad/truncate to exact widths (Consumer/MFI headers, trailers).
- **pipe-delimited** — `|`-separated records (Commercial, MFI body).
- **coded-field (TLV)** — self-describing `[tag][len][value]` stream (Consumer).

## A3. Conversion pipeline

```
Excel (.xlsx)
   │  workbook-reader   — one sheet per segment; A/c-No join key + Flag ordering
   ▼                      (also: flat single-sheet + flat-explode "master sheet")
grouped by borrower
   │  validator         — accumulates row/field issues (error|warning); NEVER throws;
   ▼                      suppresses the data file on any error
counts + report
   │  engine.assemble   — declarative spec → exact bytes (latin1/ascii, CRLF rules)
   ▼
byte-exact .txt / .CDF   (+ optional multi-sheet .xlsx working report)
```

Validation is **fail-safe**: a bad row produces a typed, located issue
(`sheet/row/field/message/severity`) in the report rather than a crash, and a file
is emitted only when there are no blocking errors.

## A4. Supported formats

| Bureau type | Profile id(s) | Output | Notes |
|---|---|---|---|
| **Commercial** UCRF V3.9 | `commercial-ucrf-flat` | `.txt` | pipe-delimited; full round-trip byte-exact vs CRIF golden sample |
| **MFI** CDF V2.0 | `mfi-cdf` | `.CDF` | single physical line: fixed HDR + pipe body + fixed TRL; conditional-mandatory fields for disbursals ≥ 2022-04-01 |
| **Consumer** UCRF-12 V3.73 | `consumer-ucrf12-flat`, `consumer-ucrf12-flat-tlv` | `.txt` | fixed TUDF header + self-describing coded/TLV body |

**Correctness is proven by byte-exact golden tests** — 30 tests / 10 suites green,
diffing engine output against real CRIF sample files at the byte level.

> Known caveats (tracked): some Consumer TL/TH field tags were reverse-engineered
> (encoding mechanics byte-verified; confirm account-type/payment-history codes vs
> the full V3.73 appendix before production); enum tables are common subsets;
> cross-segment conditional-mandatory rules are not yet wired.

## A5. Front-ends over the engine

- **CLI** — `npm run cli -- convert -f <id> -i file.xlsx -m MEMBERID`.
- **Web portal** — `npm run web` → `localhost:4317`; format dropdown, folder-path
  **and** drag-drop input, inline report, download.
- **Worker** — same engine on Cloudflare's runtime (a hosted option if ever wanted;
  also the proof that `core` is runtime-agnostic).
- **Desktop** — see A6.

## A6. Desktop app architecture (the product)

Native **Tauri v2** app for macOS + Windows. Design principle: **the engine runs
entirely inside the webview — no Rust/Node sidecar.**

```
 src/main.ts ──imports──▶ core.convert()      (runs in WKWebView / WebView2)
      │                        ▲
      │ Tauri plugins          │  Buffer/zlib via vite-plugin-node-polyfills
      ▼                        │  + src/polyfills.ts sets the globals
 native file/folder pick,      │
 native save dialog ───────────┘
```

- Because `core` uses Node's `Buffer` and ExcelJS needs `zlib`/`stream` (xlsx is a
  zip), the webview gets those via a Vite node-polyfill + a small globals shim.
- A `.js→.ts` resolver in `vite.config.ts` lets Vite consume the engine's
  ESM-style source imports **without modifying `core`**.
- Native **open/save dialogs + filesystem** via Tauri `dialog`/`fs` plugins
  (replaces the web build's "type a path" box and `data:` download).
- **Builds:** macOS `.app`/`.dmg` build locally; **Windows `.exe`/`.msi` cannot be
  cross-compiled from macOS**, so CI (`.github/workflows/desktop-release.yml`,
  `tauri-action`) builds mac (Apple-Silicon + Intel) + Windows on native runners,
  triggered by a `desktop-v*` tag.
- **Releases:** `npm run release:patch|minor|major` bumps the version in lockstep
  across `package.json` + `tauri.conf.json` + `Cargo.toml`, commits, and tags.

## A7. Authentication, version gate & licensing

The only online touch-point. Users **log in** (username + password, provisioned
per company at onboarding) against the **Vidyasetu backend** (EduBridge-TS,
reusing existing infra/DB/deploy). Borrower data is **never** part of these
calls — only credentials + app metadata.

**Auth model (tamper-proof).** Login returns **server-signed JWTs** (access +
refresh, `aud: crif-desktop`, signed with `CRIF_JWT_SECRET`). The signing secret
never leaves the server, so a tampered client **cannot forge** a valid
session/subscription — that is what makes identity tamper-proof (vs. the earlier
embedded-AES-key scheme, now retired). The app sends `Authorization: Bearer <at>`
plus `x-vidyasetu-ua` (`crif-<platform>/<os>/<desktopId>/<version>/<build>`,
mirroring the mobile `deviceContext`).

**Endpoints** (`/api/crif/*`): `auth/login`, `auth/refresh`, `auth/logout`,
`GET /session` (authenticated heartbeat).

**The guarantees**

| Rule | Mechanism | Verdict |
|---|---|---|
| Tamper-proof identity | server-signed JWT; forged token fails verify | `401 unauthenticated` |
| **No multiple sessions** | login wipes prior sessions, mints one `sid`; token's `sid` must still exist | `401 session-revoked` |
| **5–10 users / company** | enforced at provisioning (`CRIF_MAX_USERS_HARD_CAP`=10; per-company `max_users`, default 5) | n/a (no account issued) |
| Minimum version | re-checked at login + heartbeat; floor in `crif_app_config` (live) | `426 upgrade-required` |
| Company/user suspend | licence `status` / user `status` | `403` / `401` |

Backend pieces (EduBridge-TS): route `routes/crif.ts`; `crifAuthService`
(bcrypt + JWT, single-session), `crifLicenseService` (version gate), middleware
`crifAuth`; repos for `crif_users` (bcrypt hashes), `crif_sessions` (one active
per user), `crif_company_licenses`, `crif_app_config`, `crif_desktop_seats`
(device audit). Onboarding CLI `scripts/crifProvision.ts`
(`npm run crif:provision`). 24 dedicated tests; full backend suite **1435 green**.

**Policy — FAIL-CLOSED (mandatory internet).** The app refuses to run offline or
in the background. The client gate (`evaluateGate`) blocks the Generate button
and shows a modal unless a live, authenticated, current session is confirmed
**while the window is foreground** — re-checked on a 30s timer, on `online`/
`offline` events, and on Page-Visibility/focus changes. Any heartbeat failure →
"Internet connection required" modal; `session-revoked` → re-login; `upgrade-
required` → update overlay. This deliberately trades the earlier offline
capability for strict enforcement (a customer choice).

> **Security honesty.** Identity/subscription is now tamper-proof via
> server-signed tokens. But the app still runs offline, so a determined attacker
> who patches the binary can bypass client-side gating — inherent to any offline
> product. The strongest remaining lever (planned) is delivering CRIF
> spec/validation updates through the authenticated channel, so a cracked copy
> goes stale and silently produces **rejected** files (see B6).

## A8. Data privacy & security model

- **On-device processing is the core security property *and* the moat.** The
  `.xlsx` is read and the bureau file written only at paths the user picks; the
  data never transits a network or a server we run.
- The customer uploads the generated file to the CRIF portal themselves — we never
  hold bureau credentials or borrower data.
- The version/seat gate carries only app metadata, encrypted.

## A9. Tech stack & testing

- **Language/runtime:** TypeScript, ESM, Node ≥ 18. Deps kept minimal (`exceljs`,
  `zod`, `commander`, `chalk`).
- **Desktop:** Tauri v2 (Rust shell), Vite, WebCrypto.
- **Testing:** Vitest **byte-exact golden tests** for the engine (30/30); Jest for
  the backend licensing services (14/14; suite 1425/1425).

## A10. Build, release & deployment

- **Engine/CLI/web:** `tsc` build; run via `tsx`.
- **Desktop:** Tauri build → signed installers (code-signing config stubbed for
  Apple Developer ID/notarization + Windows cert; unset for now).
- **Licensing backend:** rides EduBridge-TS's existing Cloud Run deploy + MongoDB
  (no new infrastructure introduced).

---

# Part B — Business

## B1. Customer & buyer

- **User:** an accountant / operations person at a lender who prepares bureau
  submissions.
- **Buyer:** the lender's finance/compliance head or owner (small/mid NBFC, MFI,
  fintech), or a filing consultant serving several lenders.
- **Job-to-be-done:** "turn my loan data into a bureau file the CRIF portal
  accepts on the first try, without sending my borrowers' data to anyone."

## B2. Value proposition & differentiation

1. **Byte-exact, golden-tested output** across Consumer/Commercial/MFI — first-time
   portal acceptance, not "mostly works."
2. **100% on-device / offline** — borrower PII never leaves the machine
   (compliance + trust). This is the durable moat vs hosted converters.
3. **Point-and-click native app** (macOS/Windows) — no terminal, no install of
   Node, no SaaS login.
4. **Up-front validation report** — catch errors before the portal rejects them.
5. **Flat, predictable pricing** — no per-record metering anxiety.

## B3. Competitive landscape

**Credionix** (`credionix.in`) — "Excel to Credit Bureau", the closest live
competitor. Observed pricing:

| Plan | Price | Credits | Implied rate |
|---|---|---|---|
| Business | ₹49,999 | 1,000,000 / yr | **₹0.05 / record** |
| Enterprise | ₹99,999 | 10,000,000 / yr | **₹0.01 / record** |

A "credit" = one borrower record. Credionix is a **hosted, credit-metered** model
(data goes to their service).

**Our edges vs Credionix:** on-device/offline (privacy), byte-exact multi-format
output, flat pricing, no data egress. **Their edge:** much lower headline price and
an established billing funnel.

## B4. Pricing analysis & recommendation

> ⚠️ The internal costing doc (`financials/CRIF_COSTING_INTERNAL.md`) originally
> anchored to **₹0.50/record** and a ₹1,20,000/yr bundle "~28% cheaper" than the
> market. The **live Credionix rate is ₹0.05/record (~10× lower)**: a single
> ₹49,999 Business plan covers our reference 336K/yr volume with 3× headroom. So
> the real market reference for this workload is **~₹50,000/yr**, and our
> ₹1.2L bundle would be **~2.4× *more expensive*, not cheaper.** The "we're
> cheaper" story does not hold; pricing must be a deliberate decision.

Three coherent options:

| Option | Annual price | Rationale | Margin |
|---|---|---|---|
| **Match** | ~₹50,000 | Neutralize price as an objection; win on privacy + correctness | ~100% |
| **Undercut** | ~₹35,000 | "~28% cheaper" headline restored vs the real anchor | ~100% |
| **Premium / value** | ₹1,00,000–1,20,000 | Justified ONLY by differentiation (offline/privacy, byte-exact multi-format, validation, support, spec upkeep) — a value sale, not a price-beat | ~100% |

**Recommendation:** lead with the **Premium/value** narrative to the customers who
care about data residency (privacy is a real, defensible reason to pay more), but
hold a **Match (~₹50K)** option ready for price-sensitive deals. Do **not** repeat
the "28% cheaper" claim. Margin is ~100% at every option, so price is purely a
positioning/anchoring decision, not cost recovery.

## B5. Cost structure & margins

- **Conversion COGS ≈ ₹0** — CPU-only batch transform, no LLM, no per-record API,
  no server in the data path (runs on the customer's machine).
- **Only infrastructure cost** = the tiny version/seat gate, which rides the
  existing Vidyasetu backend (no new server) and carries no customer data —
  effectively **≤ ₹300/mo**, often absorbed.
- **Gross margin ≈ 97–100%** at any of the price points above.
- Real cost is **engineering**: format correctness + ongoing **spec upkeep** as
  bureaus revise their layouts. That upkeep is also the recurring-value
  justification for an annual subscription.

## B6. Licensing & anti-piracy strategy

The product is offline, so licensing can never be *uncrackable* — the goal is to
make the legitimate path effortless and cracking cost more than paying. Layered
approach:

1. **Login + server-signed tokens, at/rt (built — the real enforcement).** Users
   log in with provisioned credentials; the backend issues access/refresh JWTs
   signed with a server-only secret, so a client **cannot forge** a valid
   session. **Single-session** (one active session per user, new login revokes the
   prior), per-company **seat caps (5–10)**, company/user **suspend**, and
   **min-version** are all enforced server-side. Credentials are generated at
   onboarding via the provisioning CLI (bcrypt-hashed in the DB).
2. **Version gate.** Re-checked at login + heartbeat; the floor is a live DB doc,
   so shipping a release and raising the floor forces stragglers to update.
3. **Spec updates as the lever.** Deliver CRIF format/validation-rule updates
   through the authenticated channel. A cracked copy keeps stale specs and silently
   produces **rejected** files over time — turning piracy into self-sabotage and
   justifying the recurring fee far better than DRM.
4. **B2B context.** Customers are identifiable regulated entities under contract;
   pirating a compliance tool is a legal/reputational risk they won't take. ~80% of
   enforcement is relationship + contract, 20% technical.

## B7. Go-to-market (notes)

- **Channels:** direct to small/mid NBFCs & MFIs; **filing consultants/DSAs** as a
  multiplier (one consultant files for many lenders).
- **Wedge:** "first-time portal acceptance + your borrower data never leaves your
  machine." Free trial / sample-file conversion to prove byte-exact output.
- **Onboarding:** per-portal format mapping (~½ day) — bundle in, or ₹10k standalone.
- **Expansion:** more bureaus (CIBIL/Experian/Equifax) = new format specs on the
  same engine; per-portal/entity seat growth.

## B8. Risks

- **Pricing perception** vs Credionix's low headline (mitigated by the privacy
  value sale + match option).
- **Spec drift** — bureaus change formats; mitigated by the spec-driven engine
  (data-only edits) + spec-update channel, but requires ongoing maintenance.
- **Reverse-engineered Consumer field codes** — confirm vs full V3.73 appendix
  before high-volume production use.
- **Offline licensing is inherently crackable** — mitigated, not eliminated, by the
  at/rt + spec-update strategy (B6).
- **Coupling to the Vidyasetu backend** for licensing — convenient (reuses infra)
  but, under the **fail-closed** policy, backend/network downtime now blocks ALL
  users (no offline grace). Backend availability is therefore a hard dependency:
  needs solid uptime/SLA, and ideally a future grace-window escape hatch for
  outages.

## B9. Roadmap

**Done (2026-06-28):** login + server-signed at/rt, single-session enforcement,
per-company seat caps (5–10), onboarding provisioning CLI, version gate.

**Near-term**
- Code-signing + notarization (macOS) and Windows signing for clean installs.
- Spec-update delivery channel (the strongest anti-piracy lever — stale specs →
  rejected files for cracked copies).
- Admin UI for licences/users (issue, suspend, raise seats, reset password)
  instead of the CLI + manual DB edits.
- Password reset / rotation flow for provisioned users.

**Medium-term**
- Additional bureaus (CIBIL / Experian / Equifax) on the same engine.
- Admin console for licences/seats (issue, suspend, raise caps).
- Close the tracked engine caveats (Consumer codes, cross-segment conditionals).

---

## Appendix — references
- `financials/CRIF_COSTING_INTERNAL.md` — detailed costing, margin, competitor math.
- `packages/desktop/README.md` — build/release + version-gate/seat operational guide.
- `README.md` — engine/CLI/web usage.
- Backend (EduBridge-TS): `backend/src/routes/crif.ts`, `services/crifLicenseService.ts`,
  `services/crifSeatService.ts`.

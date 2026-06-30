# crif-export — Internal Costing & Margin Basis

> **Date:** 2026-06-26
> **Status:** Internal only — NOT for the customer. Customer sees the bundle price, never the credit math.
> **Product:** crif-export (Excel → CRIF Highmark bureau files: Commercial UCRF / MFI CDF / Consumer UCRF-12), spec-driven engine + CLI + local/portal web UI.
> **Hosting:** This is a **batch CPU transform with no LLM and no external API**. It is designed to run as a **CLI / local web portal** on a machine the customer already has. There is **no need for a dedicated server** — so infra cost is effectively **₹0**. A hosted URL is optional and, if wanted, runs scale-to-zero (near-free at this volume).

---

## 1. Usage sizing (the credit input)

> A **credit = one borrower/customer report generation**. Used here ONLY to size server load.
> It does **not** appear anywhere in the customer quotation.

| Driver | Value |
|---|---|
| Borrowers per report | 70 |
| Companies (entities) | 25 |
| Reporting frequency | Weekly → 4 / month |
| Portals | 4 |

**Monthly volume** = 70 × 25 × 4 × 4 = **28,000 generations / month**
**Annual volume** = 28,000 × 12 = **336,000 generations / year**

This is the load the infrastructure must absorb. It is a CPU-bound batch transform
(Excel parse → group → validate → byte-exact encode). **No LLM / no external API call
per generation** — so there is *no* per-credit variable cost (unlike Vidyasetu AI features).

---

## 2. Server cost basis — why it's effectively ₹0

The earlier draft padded an "always-on small service" (~₹1,800/mo). **That was wrong.** This
workload does not justify a 24/7 server. Each conversion is sub-second pure CPU (Excel parse →
group → validate → byte-exact encode). 28,000/month ≈ **~930 conversions/day**, each finishing
in well under a second. There is no LLM, no external API call, no persistent connection.

So we do **not** need GCP for this. Deployment options, cheapest first:

| Option | What it is | Real cost |
|---|---|---|
| **CLI / local web portal** (README default) | Staff run `npm run cli` or `npm run web` on an office machine they already have | **₹0** — no server at all |
| **Scale-to-zero serverless** (only if a hosted URL is wanted) | Cloud Run / Lambda, spins up per request, idles at zero | **~₹0–300/mo** — 28K sub-second invocations sits inside free/near-free tier |
| **Tiny always-on VM** (only if 24/7 URL is mandatory) | smallest e2-micro class | ~₹600–800/mo — not needed for this volume |

- No LLM token cost. No third-party bureau API cost (we generate the upload file; the customer
  uploads to the CRIF portal themselves).
- **Recommended COGS to assume: ₹0** (CLI/local). If a hosted portal is offered, assume **≤ ₹300/mo**.
- The product's cost is **engineering of the engine + format correctness/upkeep**, not runtime infra.

---

## 3. Competitor anchor

| | |
|---|---|
| Competitor price | ₹50,000 for 100,000 credits |
| Implied rate | **₹0.50 / credit** |
| Their rate applied to our 336K/yr volume | ₹1,68,000 / year |

So the market reference for this exact workload is **~₹1.68 L / year**.

---

## 4. Our pricing → margin

Customer-facing model = **single annual subscription bundle** (no credits shown, no tiers).

| | |
|---|---|
| **Bundle price (customer)** | **₹1,20,000 / year** (₹10,000 / month) |
| Vs. competitor's ₹1.68L for same volume | **~28% cheaper** |
| Incremental infra cost (COGS) | **₹0** (CLI/local) — or ≤ ₹3,600/yr if hosted scale-to-zero |
| **Gross margin** | **~100%** (₹1.2L) — or ~97% if hosted |

Headroom: the ₹0.50/credit competitor rate would bill ₹1.68L; we leave ~₹48K on the table
as the "win" the customer sees, and the margin is **near-100%** because there is no runtime
infra cost — the price reflects the value of the engine, not a server bill. Price is therefore
purely a value/anchor decision, not cost-recovery.

### Why a flat bundle (not per-credit)
- The workload is **predictable** (25 cos × weekly × 4 portals) — a flat number is easy to approve.
- Hides our unit economics (₹0.50/credit competitor framing invites a rate war; ₹1.2L/yr does not).
- Self-hosted-on-our-GCP means marginal cost per extra report ≈ 0 — flat pricing captures that.

### Overage / scaling guidance (internal)
- If volume materially grows (more companies / daily frequency), re-quote the bundle — don't meter.
- Soft ceiling for the ₹1.2L bundle: keep ≤ ~2× the sizing volume (≤ ~56K/mo) before re-pricing;
  infra still trivial, but renegotiate the bundle up to hold the value gap vs competitor.

---

## 5. One-time / optional lines (internal reference)

| Item | Internal cost | Suggested customer price |
|---|---|---|
| Onboarding + format mapping (per portal) | ~½ day eng | bundle in / ₹10,000 if standalone |
| New bureau format / custom spec | eng time | quote per scope |
| Hosted portal (optional, scale-to-zero) | ≤ ₹300/mo | bundle in if offered |

---

## 6. Summary

| Metric | Value |
|---|---|
| Annual volume (internal) | 336,000 generations |
| Infra / runtime cost | **₹0** (CLI/local) — ≤ ₹3,600/yr if hosted scale-to-zero |
| Customer bundle price | **₹1,20,000 / yr** |
| Gross margin | **~100%** (no server bill) |
| Position vs competitor | ~28% cheaper for the same workload |

# Reporting — persisted desglose, date-range VAT, and modelo 303 — Design

**Date:** 2026-08-08 · **Status:** spec for an autonomous run · **Sub-project:** 8 (Reporting) ·
**Suggested branch:** `feat/reporting-vat-range-and-303`

## Purpose

Two unstarted reporting slices, both built on the **exact per-rate filed desglose that 8a already
persisted**:

1. **A date-RANGE VAT summary** (`computeVatSummaryForPeriod`) — the daily close's per-rate VAT
   figures aggregated over an arbitrary span of business days, at the node grain (a weekly/period
   roll-up), and optionally across a whole tenant.
2. **A modelo 303 output-VAT aggregation** (`computeVatReturn`) — the régimen-general *IVA
   devengado* (output VAT) per rate over a calendar month, at the **obligado (tenant)** grain, bucketed
   by the filed *fecha de expedición* — the raw material for the 303's output-VAT boxes.

Both are pure, read-only functions over the immutable commercial record. **No migration, no new
table, no schema change** (see §2).

## Context — what already landed, and what the brief's framing predates

The task brief was written as though the filed difference-method desglose is *not yet persisted
queryably* and reporting *overstates cuota* for catalogue sales. **That gap is already closed.**
Verified against the tree:

- **The filed per-rate desglose is persisted on `sales.vat_breakdown`** — a `jsonb NOT NULL` column
  typed `{ rate: string; base: string; tax: string }[]`, added by migration **0032** (`#66`, slice
  8a). Receipt: `packages/db/src/schema/sales.ts:108-113`; `packages/db/drizzle/0032_perpetual_manta.sql`.
- **It is written from the SAME `vatBreakdown` variable each sale-creating backend files** (one
  source, two sinks, same transaction), so the stored copy provably equals what entered the huella.
  Receipt: `packages/core/src/record-sale.ts:277` (`const vatBreakdown = input.vatBreakdown ??
  buildVatBreakdown(input.lines)`, used by both the `sales` insert and `backend.recordSale`), filed
  by `packages/fiscal-verifactu/src/backend.ts:262-265` (`BaseImponibleOimporteNoSujeto ← base`,
  `TipoImpositivo ← rate`, `CuotaRepercutida ← tax`).
- **`computeVatSummary` already reads that column**, unnesting the jsonb and summing `base`/`tax` per
  rate — so the live daily close is already **exact** for catalogue difference-method sales. Receipt:
  `packages/reporting/src/vat-summary.ts:22-34`.
- **Two of the tests the brief asks for already exist:** the equality-to-filed proof
  (`packages/core/src/record-sale.test.ts:362-412` — asserts `sales.vat_breakdown` equals the filed
  desglose, the difference-method cuota `1.74`, *not* the multiplicative `1.73`) and the summary
  exactness proof (`packages/reporting/src/vat-summary.test.ts:201-225` — a catalogue sale whose
  filed cuota is `20.99`/`5.01`, not `21.00`/`5.00`).

**So brief scopes 1 (persist the desglose) and 2 (make `computeVatSummary` exact) are DONE (8a, #66).
This slice re-verifies them (plan Task 0, run don't reason — `CLAUDE.md` §1) and delivers only
scopes 3 (date range) and 4 (modelo 303).** The desglose-shape question the brief asked me to resolve
is therefore resolved by precedent (§2, D1).

**One stale artefact to be aware of (do NOT edit it in this slice — feature branches don't touch
`docs/backlog.md`):** the *Catalogue follow-ups* entry titled *"Daily-close VAT report vs the filed
desglose diverge for gross-inclusive (catalogue) sales"* (`docs/backlog.md:583-594`) still describes
the divergence as open and the desglose as *"not persisted queryably"*. That paragraph predates #66
and is a stale receipt (`CLAUDE.md` §1: "a behaviour change retires every receipt about the old
behaviour"). Pruning it belongs to a `docs/backlog.md`-only change (the lightweight direct-to-`main`
flow), recorded here so the discrepancy is not mistaken for live work.

## 1. Decisions

| # | Decision |
| --- | --- |
| **D1 — Keep the landed `sales.vat_breakdown jsonb` shape; do NOT add a `sale_desglose` table.** | 8a chose jsonb-on-`sales` (`{rate, base, tax}[]`), proven exact by the equality-to-filed test. The brief offered "a `sale_desglose` table, or the sale's `vatBreakdown` stored"; the latter shipped. A normalised table would re-implement the immutability + FORCE-RLS recipe (`CLAUDE.md` §3) for **zero** query benefit at this scale and would force re-proving the single-source property. The per-rate **gross** the brief worried about is unnecessary: `gross = base + tax`, both stored losslessly, and the 303 has **no gross box** (§4). Nothing to add. |
| **D2 — Both new functions are pure reads over `sales.vat_breakdown`; no migration.** | The per-invoice filed cuota is already on the row. A period/month aggregate is `Σ` of those filed figures grouped by rate — no re-rounding, no new data. This is the whole reason there is no schema work: the aggregation sums already-rounded filed values (§3, §4). |
| **D3 — Extract one shared `aggregateVatByRate` core.** | `computeVatSummary` (single day), `computeVatSummaryForPeriod` (range) and `computeVatReturn` (month) differ only in (a) the issuance-date predicate and (b) whether a node is fixed. Factor the jsonb-unnest + per-rate `Σ` + `activeSalesClause` + tenant predicate once; each caller supplies its date filter and optional node. `computeVatSummary` **delegates** to it, so its existing suite is the behaviour-preserving guard (`CLAUDE.md` global rule). |
| **D4 — The date-range summary keeps the operational business-day cutover; the 303 uses the civil fiscal date.** | These are *different* bucketing rules, deliberately (§3 vs §4). A period roll-up must sum the same daily closes an operator sees (cutover-shifted business days). A VAT **return** period is a civil calendar month keyed on the filed *fecha de expedición*. |
| **D5 — modelo 303 is per OBLIGADO (tenant), across all nodes.** | A 303 is filed by the legal entity, aggregating every till/node/location's output VAT. So `computeVatReturn` drops the node predicate and aggregates the whole tenant (the explicit `tenant_id` predicate + RLS still scope it — belt-and-suspenders, `listOutstandingSales` pattern). `computeVatSummaryForPeriod` keeps `nodeId` **optional** for the same reason. |
| **D6 — This slice produces the 303 output-VAT AGGREGATE, not the filed form.** | `computeVatReturn` returns the régimen-general *IVA devengado* per rate (`{rate, base, tax}` + totals) — the material for the output boxes. The **deducible/soportado (input-VAT) side is out of scope** (Waitron has no purchase-invoice data), as are recargo de equivalencia, intra-community/ISP, and the exact AEAT casilla numbers + the submittable form/model (a presentation layer needing primary-source verification — §5). |
| **D7 — English identifiers; "modelo 303" lives in comments/docs only.** | `@waitron/reporting` is under the `english-only` guard (`packages/db/src/english-only.ts:8-20`). `cuota`, `iva`, `periodo`, `ejercicio`, `operacion`, `impuesto` are in `SPANISH_WORDS`; `base`, `total`, `id`, and `tax`/`year`/`month`/`return`/`rate` are not. So: `computeVatReturn`, `VatReturn`, `byRate`, `baseTotal`, `taxTotal`, `year`, `month` — the *cuota → tax* choice #56/8a already made. No new schema tokens, so nothing is added to `SPANISH_WORDS`. |
| **D8 — Do NOT attempt the sargable rewrite in this slice (correctness first).** | See §6. |
| **D9 — Invalid inputs throw a plain `Error`, not a registered code.** | A bad `year`/`month`/day is a caller precondition, the exact class the package's own validators already reject with a plain `Error` (`business-day.ts:20-56`). No new `close.*`/`reporting.*` code — a `reporting.*` code is forbidden (names the package), and no domain condition a till surfaces exists here. |

## 2. No migration — and why that is the correct answer to "call out every migration"

The plan adds **no `packages/db/drizzle/*.sql`**, touches no schema, and creates no `tenant_id`-bearing
table — so the FORCE-RLS + tenant-isolation-policy + grants recipe (`CLAUDE.md` §3) has nothing to
apply, and the `inmutabilidad` guard (`packages/fiscal-verifactu`) has no new table to scan. The
queryable store this builds on — `sales.vat_breakdown` — **already exists** (migration 0032, #66) and
already carries `sales`' immutability + FORCE RLS (a column addition changed none of it; 8a spec §Data
model). The guard suites are still run as a belt-and-suspenders regression check (plan Task 5), but
they are *unaffected by construction*, and saying so plainly is the honest form of "call out every
migration": there is none.

## 3. Scope 3 — the date-range VAT summary

`computeVatSummaryForPeriod(tx, input): Promise<VatSummary>` — the daily-close VAT figures over a span
of business days.

```ts
export interface PeriodVatInput {
  tenantId: TenantId;
  nodeId?: NodeId;          // omit → aggregate across ALL the tenant's nodes (RLS + tenant predicate scope it)
  fromBusinessDay: string;  // inclusive "YYYY-MM-DD"
  toBusinessDay: string;    // inclusive "YYYY-MM-DD"
  timeZone: string;         // IANA — never UTC, never an offset (validated, as computeDailyClose does)
  dayCutover: string;       // "HH:MM" business-day start
}
```

- **Bucketing:** the same DST-aware, cutover-shifted business-day rule as the daily close, extended
  from `= businessDay` to a closed range. A new `businessDayRangeClause(column, input)` emits
  `(col AT TIME ZONE tz - cutover::interval)::date BETWEEN from::date AND to::date`, reusing the
  exact expression of `businessDayClause` (`packages/reporting/src/business-day.ts:64-66`) so a
  single day (`from == to`) is byte-identical to today's daily close.
- **Same exclusions:** `activeSalesClause` verbatim (`business-day.ts:75-78`) — voided sales and
  F3-canje substitutes excluded, rectificativas netted in as negatives. Issuance anchor
  (`s.issued_at`), same as the daily close.
- **Exactness is inherited, not re-derived:** the aggregate is `Σ` of each sale's **filed** per-rate
  `tax` from `sales.vat_breakdown`, grouped by rate — the same read `computeVatSummary` already does,
  just over more days. No re-rounding: the per-invoice figures are already the filed, already-rounded
  ones. The existing "rounds tax PER INVOICE, not on the summed base" test
  (`vat-summary.test.ts:125-141`) is preserved by the shared core; a range analogue is added.
- **Returns `VatSummary`** (existing type: `byRate`, `baseTotal`, `taxTotal`, `grossTotal`).

`nodeId` optional is the generalisation that scope 4 needs; when present the query adds
`and s.node_id = ${nodeId}` (the node predicate RLS does not enforce — proven by
`vat-summary.test.ts:177-199`).

## 4. Scope 4 — the modelo 303 output-VAT aggregation

`computeVatReturn(tx, input): Promise<VatReturn>` — the régimen-general *IVA devengado* over one
calendar month, for one obligado.

```ts
export interface VatReturnInput {
  tenantId: TenantId;  // the obligado — a 303 aggregates ALL nodes of the legal entity
  year: number;        // e.g. 2026
  month: number;       // 1..12 (the monthly liquidation period)
}
export interface VatReturn {
  tenantId: TenantId;
  year: number;
  month: number;
  byRate: VatRateLine[]; // régimen-general IVA devengado per rate {rate, base, tax}, corrections netted
  baseTotal: Decimal;    // Σ base imponible devengada
  taxTotal: Decimal;     // Σ cuota devengada (the output-VAT total)
}
```

Note there is **no `timeZone`/`dayCutover`** and **no `grossTotal`** — both deliberate:

- **Civil-date bucketing keyed on the filed *fecha de expedición*.** A VAT return counts an operation
  in the period its VAT was *devengado*, i.e. the invoice's *fecha de expedición* — a civil calendar
  date, not the operational business day. The filed `FechaExpedicionFactura` is the civil-local date
  of the issuance instant using the sale's **own snapshotted offset**:
  `formatDate(date, offsetMinutes) = shift(date, offsetMinutes)` then read the date components
  (`packages/verifactu/src/format.ts:119-122`, `shift` at `:97-112` = `getTime() + offsetMinutes*60000`).
  So the 303 buckets by **exactly that**, self-contained on the row, needing no timezone argument:

  ```sql
  ((s.issued_at at time zone 'UTC') + make_interval(mins => s.issued_offset_minutes))::date
  ```

  This is byte-identical to what AEAT received (`shift` then date). `(s.issued_at AT TIME ZONE tz)::date`
  is an equivalent DST-aware form, but the offset-snapshot form is preferred: it matches the filed
  value without re-deriving the offset and needs no `timeZone` input. Month bound (half-open, pure
  calendar dates, no DST subtlety):
  `filedDate >= make_date(year, month, 1) AND filedDate < make_date(year, month, 1) + interval '1 month'`.

- **No gross box.** The 303 output-VAT rows are `base imponible` + `tipo` + `cuota`; there is no gross
  field, so `VatReturn` omits `grossTotal`. This is why D1's "no per-rate gross stored" is a non-issue.

- **Corrections and F3, confirmed against the 303 on primary source.** `activeSalesClause` (reused
  verbatim) includes rectificativas (R1–R5 net in as negatives) and excludes F3-canje substitutes —
  exactly what the AEAT developer FAQ says a 303 does («se tienen en cuenta todas las facturas […] R1,
  R2, R3, R4 y R5 pero […] ninguna factura […] F3», because an F3's total «ya se declaró a medida que
  se fueron expidiendo las facturas simplificadas»). Receipt:
  `docs/superpowers/specs/2026-08-04-daily-close-reporting-design.md:262-270` →
  `docs/compliance/verifactu-faq-notes.md §19`. This is **not re-litigating** the difference-method
  rounding acceptance (already CLOSED, `docs/backlog.md:595-612`); it is the F3/rectificativa
  inclusion rule the exclusion clause already encodes.

- **Exactness across the month is the point.** Each rate's `tax` is `Σ` of the **filed** per-invoice
  difference-method cuotas — never `round(Σ base × rate)`, which would re-round on the monthly base
  and drift céntimos from what was filed. Because the filed figures are read straight from
  `sales.vat_breakdown`, a month of catalogue sales sums to the exact declared output VAT.

### What `computeVatReturn` does NOT produce (deferred, each with a reason)

- **The IVA deducible / soportado (input-VAT) side.** Waitron records sales, not purchase invoices,
  so the deductible boxes have no data source. Out until a procurement/purchase-invoice module exists.
- **Recargo de equivalencia.** Not carried on `sale_lines` or in the stored breakdown (daily-close
  design §4/§9); applicability is itself an open asesor question (`docs/backlog.md:271-276` in the
  daily-close design). Excluded.
- **The exact AEAT casilla mapping and the submittable form/model.** Which box each rate's base/cuota
  populates, and generating the filable 303, is a presentation layer that needs the *current* form
  verified on primary source — this slice yields the per-rate aggregate that feeds it, and the mapping
  is a later slice (or the reporting UI). The aggregate is regime-parameterisable later via the
  `nodes.tax_module` seam (#57) — this hardcodes ES-común/IVA, the first piece of that module.
- **Quarterly periods.** Most small filers file quarterly; a quarter is three months. `computeVatReturn`
  is monthly (per the brief); a quarter is a thin caller-side sum of three, or a later
  `computeVatReturnForQuarter`. Not built here.

## 5. Public API summary

New exports from `@waitron/reporting` (`packages/reporting/src/index.ts`):

```ts
export { computeVatSummaryForPeriod } from "./vat-summary.js"; // scope 3
export { computeVatReturn } from "./vat-return.js";            // scope 4
export type { PeriodVatInput, VatReturn, VatReturnInput } from "./types.js";
```

`computeVatSummary` (single-day daily-close VAT), `VatSummary`, `VatRateLine` are unchanged.

## 6. The sargable question — resolved: NOT rewritten here

The business-day predicate wraps the column (`(col AT TIME ZONE tz - cutover)::date`), so it cannot
use `sales_tenant_issued_idx` (`packages/db/src/schema/sales.ts:166`) — a documented, **gated-on-scale**
follow-up (`docs/backlog.md:712-718`). The brief asks to include a sargable half-open UTC-bounds
rewrite "only if clean." **Decision: keep the proven cutover-shifted predicate (extended to a range),
do not rewrite.** Reasons, receipted:

1. **The DST subtlety is a real correctness hazard.** A sargable bound is
   `(day::date + cutover)::timestamp AT TIME ZONE tz`; the Debt note's own caveat is that
   `start + interval '1 day'` is wrong on a transition day (compute the end from the *next* day's
   local cutover). Worse: a cutover falling in the spring-forward **gap** (e.g. `02:30` on the March
   transition, a value the `"HH:MM"` contract permits) has no unambiguous instant. The current
   predicate sidesteps all of this by never converting a wall-clock the other way.
2. **It only helps the VAT query.** Only `sales` has `(tenant_id, issued_at)`; the cash-up and voids
   paths (`tenders.settled_at`, `sale_voids.voided_at`) have no matching index, so a partial rewrite
   buys an inconsistent optimisation (Debt note, `:717`).
3. **No production scale exists.** Reporting is headless; there are no catalogue sales until the till
   runs a real venue. Correctness-first is the right trade (`CLAUDE.md`: measure, don't pre-optimise).

The range query becomes a **second caller** of the non-sargable clause, which strengthens the case for
the follow-up later — noted here; the `docs/backlog.md` edit itself is out of this slice's scope.
(The 303's civil-date predicate is non-sargable for the same reason and deferred identically.)

## 7. Testing

`@waitron/reporting` runs PGlite by default (`usePgliteDb` + `[CORE_MIGRATIONS]`) and has a real-PG
harness for the cases PGlite cannot show (`useRealPostgres` + `startRealPostgres`,
`record-daily-close.rls.test.ts`). Money is `Decimal` strings throughout; reads run inside
`withTenant` + `asAppUser`.

- **Scope 3 (PGlite):** a two-business-day range summing both days' per-rate figures; a range that
  excludes a day outside `[from, to]`; the per-invoice rounding preserved across a range (two invoices
  on different days at the `0.03 × 21%` boundary → `0.02`, not `0.01`); the cutover boundary at a range
  edge (a `01:30` sale with `05:00` cutover lands in the prior business day); a tenant-wide run
  (`nodeId` omitted) summing two nodes; and the node-scoped run excluding the other node. Empty range →
  zeros. **Prove-by-deletion** on the range bound and the node predicate.
- **Scope 4 (PGlite for the arithmetic):** a month of mixed-rate **catalogue** (difference-method)
  sales across **two nodes** → per-rate `base`/`tax` equal the summed **filed** figures and aggregate
  across nodes; a rectificativa nets its rate down; a voided sale and an F3 substitute excluded; a sale
  whose **operational business day** and **civil fiscal date** differ (issued just after midnight local
  with a `05:00` cutover) lands in the fiscal month by its filed *fecha de expedición*, proving the
  303 buckets on the civil date, not the cutover; a sale on the civil month boundary
  (`2026-08-01 00:30` local) lands in August, and its counterpart at `2026-07-31 23:30` local lands in
  July. Invalid `month`/`year` → plain `Error`.
- **Scope 4 (REAL Postgres — the one that matters, `CLAUDE.md` §4):** a cross-tenant isolation proof
  under the real non-superuser `app_user` with FORCE RLS: tenant B's month of sales never appears in
  tenant A's `VatReturn`. This is load-bearing *because the 303 drops the node predicate* — RLS + the
  explicit tenant predicate are the only scoping across nodes, and PGlite (superuser, single backend)
  cannot show the RLS half. Prove-by-deletion of the explicit `tenant_id` predicate confirms which
  layer is doing the work.
- **Re-verify the 8a receipts (run, don't reason):** `packages/core/src/record-sale.test.ts:362-412`
  (persisted desglose == filed record) and `packages/reporting/src/vat-summary.test.ts:201-225`
  (`computeVatSummary` exact) — both must be green before building on them (plan Task 0). These ARE
  the two tests the brief asks for; this slice adds their **period-level** analogue (scope 4's
  exactness-across-a-month test).
- **Guard suites (belt-and-suspenders — unaffected, no schema change):**
  `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`; the tree-wide `english-only` via the
  root project; `pnpm --filter @waitron/reporting test:coverage` (98/98/98/95).

## 8. Scope out / deferred

Input-VAT (deducible) side; recargo de equivalencia; the AEAT casilla mapping + submittable form;
quarterly/annual periods; a reporting UI (belongs to the till, #7); the sargable index rewrite
(§6, gated on scale); non-ES tax regimes (the `nodes.tax_module` seam is the future home).

## 9. Provenance (tree receipts — re-confirm each while implementing, `CLAUDE.md` §1)

| Claim | Receipt |
| --- | --- |
| `sales.vat_breakdown jsonb NOT NULL {rate,base,tax}[]`, migration 0032, #66 | `packages/db/src/schema/sales.ts:108-113`; `packages/db/drizzle/0032_perpetual_manta.sql` |
| Written from the same filed variable (one source, two sinks) | `packages/core/src/record-sale.ts:277`; filed at `packages/fiscal-verifactu/src/backend.ts:262-265` |
| `computeVatSummary` already reads `sales.vat_breakdown` (8a exact) | `packages/reporting/src/vat-summary.ts:22-34` |
| Persisted desglose == filed record (difference-method 1.74 not 1.73) | `packages/core/src/record-sale.test.ts:362-412` |
| Summary exact for catalogue difference-method (20.99/5.01 not 21.00/5.00) | `packages/reporting/src/vat-summary.test.ts:201-225` |
| Filed *fecha de expedición* = civil-local date via snapshot offset | `packages/verifactu/src/format.ts:119-122` (`formatDate`) + `:97-112` (`shift`) |
| Business-day predicate (non-sargable) + active-sales exclusion | `packages/reporting/src/business-day.ts:64-66`, `:75-78` |
| Node predicate is not RLS-enforced (must be explicit) | `packages/reporting/src/vat-summary.test.ts:177-199` |
| Sargable rewrite is gated-on-scale debt with a DST subtlety | `docs/backlog.md:712-718` |
| 303 counts R1–R5, excludes F3 (primary source) | `docs/superpowers/specs/2026-08-04-daily-close-reporting-design.md:262-270`; `docs/compliance/verifactu-faq-notes.md §19` |
| Difference-method rounding accepted (do not re-litigate) | `docs/backlog.md:595-612` |
| `english-only` word list (cuota/iva/periodo in; base/total/tax out) | `packages/db/src/english-only.ts:111-261`, `:8-20` |
| Real-PG harness precedent in this package | `packages/reporting/src/record-daily-close.rls.test.ts:1-45` |
| The stale divergence backlog entry (predates #66) | `docs/backlog.md:583-594` |

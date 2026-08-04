# Daily close (reporting) — first slice — Design

**Date:** 2026-08-04
**Status:** Approved in brainstorming
**Scope:** A headless, read-only **daily close** for one node (SIF), one business day — a single
report combining a **VAT summary** (taxable base and cuota per rate) and an **operational cash-up**
(what was collected, by till and tender method). Derived on demand from the already-immutable
commercial record; nothing is frozen, no new tables, no migrations. The till/UI that would *render*
this, and a numbered/signed *cierre Z*, are out of scope (see §9).

This is the first piece of sub-project 8 (Reporting). It is the reprioritisation-time "keep going
fiscal" choice made after the four-piece fiscal sequence completed (#39, #46, #51, #55): the cheapest,
lowest-risk way to prove the completed fiscal model can produce the aggregates a venue actually needs,
before the till is built on top of it.

---

## 0. Why this exists, and what is already there

The backlog names sub-project 8 as "Daily close, VAT summary" with no code yet. The data model was
built *for* this: the commercial tables carry redundant projections (`sales.fiscal_state`,
`sales.corrects_sale_id`, `sales.counterparty_*`) **specifically so a Z-report can answer questions
without a cross-boundary join into the Veri\*Factu fiscal tables** — the schema comments say so. So
reporting reads the English, regime-neutral **commercial** tables in `@waitron/db`
(`sales`, `sale_lines`, `tenders`, `sale_settlements`, `sale_voids`, `sale_substitutions`), and does
**not** read the fiscal chain (`registros_facturacion`, `envios`).

There is an exact precedent to mirror: **`listOutstandingSales`**
(`packages/core/src/list-outstanding-sales.ts`) — a read-model that nets corrections
(`amountDue = total + Σcorrections`), excludes correctives / settled / voided / F3-substitutes, takes
a `Transaction`, applies a belt-and-suspenders `tenant_id = $1` predicate on top of RLS, and returns
money as `Decimal` strings (never `SUM()` into a JS number). This slice adds a sibling read-model in a
new package.

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| D1 | **New read-only package `@waitron/reporting`**, depending on `@waitron/db` + `@waitron/shared`, plus the canonical VAT arithmetic `percentOf` (see D6 for where that comes from). No new tables, **no migration**, so it cannot collide with the till track on the `packages/db` drizzle journal. This is the parallelism guarantee. |
| D2 | **One combined report per `(tenant, node, business-day)`.** The node (the SIF/chain owner) is the grain, because the VAT summary is inherently a per-SIF aggregate. The cash-up is broken down **by till** within the node (a physical drawer is a till). In the single-node/single-till deli all grains coincide, so this costs nothing today and generalises. |
| D3 | **Two day-anchors.** The VAT summary counts a sale by its **issuance** business-day (*fecha de expedición* — the fiscal fact). The cash-up counts a tender by its **settlement** business-day (when the money moved). Under invoice-first, a sale issued day *N* and paid day *N+1* appears in *N*'s VAT and *N+1*'s cash-up — both correct. |
| D4 | **Business day = venue-local, DST-aware, with a configurable cutover** passed as a `"HH:MM"` time-of-day in the venue's IANA timezone. Bucketing is done in SQL via `AT TIME ZONE` — never UTC, never a fixed numeric offset (the workforce *registro* shipped a UTC-vs-local wall-clock bug; this is the explicit guard against repeating it). |
| D5 | **Timezone and cutover are function inputs, not stored columns.** This keeps the slice migration-free. Locations (sub-project 6, in the till track) is the natural future owner of that config and will supply the same values; until then the caller/demo passes them. |
| D6 | **VAT read from the commercial `sale_lines`**, grouped by `vatRate`, with cuota derived via the canonical `percentOf` at the **per-invoice** grain (§4) — the decoupled, regime-neutral path the schema was designed for. `percentOf` lives in `@waitron/core` today; the plan either adds a `@waitron/core` dependency or lifts `percentOf` into `@waitron/shared` (preferred — pure money math beside the `Decimal` codec, and keeps reporting off the write layer). A reconciliation against the filed fiscal `desglose` is a later cross-check, not this slice. |
| D7 | **Derived now, frozen later.** `computeDailyClose` is a pure, deterministic function returning a serializable `DailyClose`. A future numbered/signed *cierre Z* is a snapshot of that object into an append-only table — this slice builds no such table and bakes in nothing that would block deterministic recomputation. |
| D8 | **Cash-up reports takings only.** Per-till `cashTakings` (Σ cash-method tender amount) is *what the day added to the drawer*. Counting the drawer — counted cash, opening float (*fondo de caja*), payouts (*salidas*), and the resulting *descuadre* (over/short) — is deferred to the frozen-close phase, where a counted figure is persisted with who counted it. A descuadre **never blocks** and is operational, not fiscal (it never touches the huella or VAT). |
| D9 | **A runnable demo script** under `apps/server/scripts/` seeds a day of sales/corrections/tenders and prints a `DailyClose`, the human-checkable artifact (modelled on `record-one-sale.ts` / the invoice-first demo). |

D2 and D3 are the load-bearing ones. The alternative to D3 — a single anchor — is simpler but wrong
for one half of the report: anchoring everything on issuance makes the drawer count attribute cash to
a day it did not arrive; anchoring everything on settlement misdates fiscal records against their
*fecha de expedición*.

---

## 2. Package shape and public API

A new package `@waitron/reporting` with one exported function. Headless — a till/UI consumes it later,
exactly as the invoice-first slice stayed headless.

```ts
import type { Transaction } from "@waitron/db";
import type { TenantId, NodeId, TillId, Decimal } from "@waitron/shared";

export interface DailyCloseInput {
  tenantId: TenantId;
  nodeId: NodeId;             // the grain: one close per SIF
  businessDay: string;        // local calendar date, "2026-08-04"
  timeZone: string;           // IANA, e.g. "Europe/Madrid" — REQUIRED, never defaulted to UTC
  dayCutover: string;         // "HH:MM" time-of-day in timeZone the business day starts, e.g. "05:00"
}

export async function computeDailyClose(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<DailyClose>;
```

`timeZone` and `dayCutover` are validated in TS (IANA-parseable; `dayCutover` matches
`^([01]\d|2[0-3]):[0-5]\d$`); invalid input throws a clean `AppError` (a new `reporting.*` code — named
for the domain concept, per the error-code convention) rather than silently defaulting.

## 3. The result

```ts
export interface DailyClose {
  tenantId: TenantId;
  nodeId: NodeId;
  businessDay: string;
  timeZone: string;
  vat: VatSummary;     // anchored on ISSUANCE business-day
  cash: CashUp;        // anchored on SETTLEMENT business-day
  counts: CloseCounts;
}

export interface VatSummary {
  byRate: VatRateLine[];       // one row per VAT rate present, corrections netted in
  baseTotal: Decimal;          // Σ base across rates
  cuotaTotal: Decimal;         // Σ cuota across rates
  grossTotal: Decimal;         // baseTotal + cuotaTotal
}
export interface VatRateLine {
  rate: Decimal;               // "21.00"
  base: Decimal;               // net taxable base at this rate
  cuota: Decimal;              // net tax at this rate
}

export interface CashUp {
  byTill: TillCashUp[];        // one per till that took money this business day
  tenderTotal: Decimal;        // node-level Σ amount across tills and methods
  tipTotal: Decimal;           // node-level Σ tip
}
export interface TillCashUp {
  tillId: TillId;
  byMethod: TenderMethodLine[];
  cashTakings: Decimal;        // Σ cash-method amount at THIS till (cash revenue + cash tips)
}
export interface TenderMethodLine {
  method: "cash" | "card" | "voucher" | "transfer" | "other";
  amount: Decimal;             // total collected via this method (includes its tip portion)
  tip: Decimal;                // tip portion collected via this method
}

export interface CloseCounts {
  sales: number;               // ordinary altas issued in the business-day
  corrections: number;         // rectificativas issued in the business-day
  voids: number;               // annulments recorded in the business-day
}
```

Every money field is a `Decimal` string, summed with `sumDecimals` / cast-and-reparse in SQL. There is
deliberately no `toNumber` in the money codec; the report never produces a JS `number`.

**Implementation note (2026-08-04).** The shipped public API uses `tax` / `taxTotal` / `taxOf` where
this design wrote `cuota` / `cuotaTotal` / `cuotaOf` — identical values and rounding. `@waitron/reporting`
is a regime-neutral package that reads the English commercial tables, so it is English-only (it is in the
tree-wide `english-only` guard), and `cuota` is a Spanish token reserved for `@waitron/fiscal-verifactu`.
The Spanish fiscal term survives in code comments (the guard ignores comments) to keep the link.

## 4. The VAT half — issuance anchor

Reads `sale_lines` joined to `sales`, scoped to `(tenant, node)`, where the sale's **issuance** falls
in the business day (§6). The tax-exclusive base is `sale_lines.lineTotal`; the per-rate cuota is
**not stored** commercially and is derived with the canonical `percentOf` (`packages/core/src/vat.ts`,
exact BigInt, not float — see D6 for the dependency).

To stay reconcilable to what was filed, cuota is computed at the **per-invoice** grain and then summed:
`cuota_at_rate = Σ_sales percentOf(base_of_that_sale_at_that_rate, rate)`, **not**
`percentOf(daily_Σbase, rate)` — the two can differ by cents once VAT is rounded per invoice, and the
filed record rounds per invoice. `base_at_rate = Σ lineTotal`. All money math stays in the exact
`Decimal`/BigInt codec (the SQL returns per-`(sale, rate)` bases as text; the rounding and summing
happen in TS). One `VatRateLine` per rate.

**Recargo de equivalencia is out of scope** (§9): the surcharge is not carried on `sale_lines`, so the
commercial path cannot reproduce it — producing it would need a schema addition or the fiscal
`desglose`. It would in any case only arise on a full invoice to a customer who is **themselves** under
the regime, not on ordinary B2C tickets. Whether the regime touches the deli's retail-goods (take-away
packaged goods) sales at all — and it turns on the business's legal form — is an asesor question (§10),
not something this design asserts.

- **Corrections net automatically.** A rectificativa is a negative-total `sales` row with its own
  negative-`lineTotal` lines and `corrects_sale_id` set. Grouping all in-day lines by rate nets the
  correction into its rate for free — no special case.
- **Excluded from the base/cuota:**
  - **voided sales** — an annulled sale is not turnover;
  - **F3-canje substitutes** — the F3's VAT already lives in the substituted F2 tickets it references
    via `FacturasSustituidas`; counting both double-declares. This mirrors the exact exclusion
    `listOutstandingSales` already makes (`sale_substitutions.substitution_sale_id`).
- **Included:** ordinary altas (F2) and rectificativas (net-negative contributions).

The F3 exclusion is a fiscal judgement (it decides whether a canje adds to declared VAT or restates
it). It matches the existing read-model, and is **confirmed on primary source** — AEAT's developer FAQ
excludes F3 from *modelo 303* while counting rectificativas R1–R5 (§10).

## 5. The cash-up half — settlement anchor

Reads `tenders` joined to `sales` (for `(tenant, node)` scoping and the `till_id`), where the
tender's **`settledAt`** falls in the business day (§6). Groups by `till_id` then `method`:

- `amount` per method = what was collected that way; the tip is *part of* `amount`
  (`tenders_tip_ck: tip_amount <= amount`), never on top.
- `cashTakings` per till = Σ `amount` where `method = 'cash'` — cash revenue plus cash tips, i.e. what
  the day *added* to that till's drawer.

**What `cashTakings` is not.** It is not the absolute drawer contents. Those also depend on the
**opening float** and any **payouts**, neither of which the model represents yet, and on a **counted**
figure a human supplies at close. Full absolute-drawer reconciliation and the *descuadre* belong to
the frozen-close phase (D8). Post-settlement refunds are likewise out of scope — `tenders.amount` is
always positive (`tenders_amount_ck: amount > 0`) and the post-settlement-correction path is the
documented till-era case, unreachable headlessly today.

## 6. Business-day mechanics and the determinism property

Bucketing is done in SQL, DST-aware, with the cutover subtracted before taking the date:

```sql
(ts AT TIME ZONE $timeZone - $dayCutover::interval)::date = $businessDay
--  01:30 local − 05:00 → 20:30 prior day  → prior business date
--  05:30 local − 05:00 → 00:30 same day   → this business date
```

`ts` is `sales.issued_at` for the VAT half and `tenders.settled_at` for the cash half; both are
`timestamptz`, so `AT TIME ZONE '<IANA>'` yields the correct venue-local wall-clock across DST. The
timezone is always an explicit IANA name — never UTC, never a stored numeric offset.

**Determinism (the crux of "derived, recompute-anytime").** Issuance stamps `now()` at issuance and
settlement stamps `now()` at settlement, so once a business day has fully passed **no new row can land
in that day's issuance or settlement bucket** — a past day's report is fixed and recomputes byte-for-
byte. A correction gets its *own* issuance date (the day the rectificativa is issued), so it lands in
that day, never retroactively altering an earlier day's VAT. This property is exactly what a future
frozen close would snapshot, and why freezing needs no recomputation-blocking state now.

## 7. The frozen-later seam

`computeDailyClose` returns a stable, serializable `DailyClose`. A later *cierre Z* is then: snapshot
the object into an append-only `daily_closes` table with a per-node sequence number and a huella over
the serialized aggregates, plus the counted-cash / float / payout / *descuadre* fields from D8, with
the counting actor. None of that is built here; the seam is only the pure, deterministic function and
its serializable result. We do **not** add the table, the numbering, or any signing this slice.

## 8. Testing

PGlite (`usePgliteDb` with `[CORE_MIGRATIONS, FISCAL_MIGRATIONS]`), seeded via the existing fixtures,
run inside `withTenant` + `asAppUser` so RLS is exercised as the app role — the shape
`list-outstanding-sales.test.ts` uses.

Cases:

- multi-rate VAT (e.g. 21% + 10%) → one `VatRateLine` each, correct base and cuota;
- a rectificativa netting a rate's base and cuota **down**;
- a voided sale **excluded** from base/cuota and counted in `counts.voids`;
- an F3-canje substitute **excluded** (its substituted F2 tickets still counted);
- mixed tenders across methods and tills → correct `byTill`/`byMethod`, `cashTakings`, node totals;
- the invoice-first split — a sale issued day *N*, settled day *N+1* — appears in *N*'s `vat` and
  *N+1*'s `cash`, and in neither the other way;
- the cutover boundary — a 01:30 sale with a 05:00 cutover lands in the **prior** business day;
- a DST-transition day, to pin `AT TIME ZONE` behaviour;
- an empty day → all totals `"0.00"`, empty arrays, zero counts;
- **prove-by-deletion** on each exclusion (remove the filter, watch a count or total change), and on
  the tenant predicate;
- a belt-and-suspenders `*.rls.test.ts` proving cross-tenant rows never leak.

## 9. Scope boundaries (YAGNI)

One node, one business day, one `computeDailyClose`. Explicitly **out**, each a clean later addition:

- date **ranges** and monthly / VAT-return (modelo 303-shaped) aggregation;
- multi-node / whole-venue roll-up (sum across nodes);
- the **frozen** numbered/signed *cierre Z*, and with it counted cash, opening float, payouts, and the
  *descuadre* (D8);
- **recargo de equivalencia** (surcharge) — not carried on `sale_lines`, so it needs a schema
  addition or the fiscal `desglose` (§4);
- reconciliation of the derived VAT against the filed fiscal `desglose` (D6);
- any UI — this is a headless function plus a demo script (sub-project 7 renders it);
- persisting timezone/cutover config — Locations (sub-project 6) owns that (D5).

## 10. Fiscal treatment — one resolved, one open

- **F3-canje VAT treatment (§4) — RESOLVED on primary source, 2026-08-04.** This slice excludes F3
  substitutes from declared base/cuota and includes rectificativas. AEAT's developer FAQ (v1.3, §27,
  p.49) states that *for modelo 303* «se tienen en cuenta todas las facturas identificadas con clave de
  factura rectificativa (R1, R2, R3, R4 y R5) pero […] ninguna factura identificada con la clave F3»,
  because an F3's total «ya se declaró a medida que se fueron expidiendo las facturas simplificadas a las
  que canjea» (p.52). So a canje **restates** rather than **adds** turnover — the exclusion is confirmed,
  not an inference, and needs no asesor input. Receipt: [verifactu-faq-notes.md
  §19](../../compliance/verifactu-faq-notes.md).
- **Recargo de equivalencia applicability (§4) — open.** Whether the deli's retail-goods (take-away packaged
  goods) sales fall under the recargo de equivalencia regime at all — it can apply to an *autónomo*
  retailer but never to an *SL* company, and hospitality *service* sits outside it — decides whether
  the surcharge ever needs representing on the venue's own output. Surcharge is deferred on data-model
  grounds regardless (it is not on `sale_lines`); this answer only affects whether a **later** slice
  must add it, not this one.

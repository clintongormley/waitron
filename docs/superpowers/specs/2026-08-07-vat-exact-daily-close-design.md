# VAT-exact daily close — design (sub-project 8, slice 8a)

**Date:** 2026-08-07 · **Status:** approved in brainstorm, spec under review · **Branch:** `feat/vat-exact-daily-close`

## Purpose

`@waitron/reporting`'s `computeDailyClose` VAT summary is a **rounding céntimo off the filed record**
for catalogue (till) sales, and those sales are now reachable (the till shipped, #60–#64). This slice
makes the summary **exact** — it reports the same per-rate cuota that was filed — by storing each
sale's filed VAT breakdown on the (immutable) `sales` row and reading that instead of recomputing.

It fixes the **live** daily close and is the prerequisite for a VAT-exact frozen *cierre Z* (slice
8b): a signed, immutable close must not freeze a knowingly-approximate VAT figure.

## Context — the divergence, verified

Verified against the tree (receipts in §Provenance):

- **The filed desglose uses the DIFFERENCE method.** For a catalogue sale, per `(sale, rate)` group:
  `base = round(gross ÷ (1 + rate/100))` summed per line, then **`cuota = Σgross − Σbase`** applied
  once per group (`packages/catalogue/src/pricing.ts` `priceRows`). This is what `recordSale` files
  into `registros_facturacion.desglose`.
- **`computeVatSummary` recomputes MULTIPLICATIVELY.** It reads `sale_lines`, takes
  `base = sum(line_total)` (which **equals** the filed base exactly, same grain), then
  `cuota = round(base × rate/100)` (`packages/reporting/src/vat-summary.ts` `taxOf`). The base
  matches; only the cuota diverges, and **only for catalogue sales** — the non-catalogue path
  (`buildVatBreakdown`) files `round(base × rate/100)`, identical to `computeVatSummary`, so those
  already match.
- **The exact figure cannot be rebuilt from `sale_lines`.** Lines store only the *net* base
  (`line_total`), rate, net unit price and quantity — **no per-line gross and no per-line cuota**. The
  per-line rounding is lossy (distinct gross values collapse onto one base), and the only stored gross
  is the whole-sale `sales.total` with no per-rate split, so a multi-rate invoice's per-rate cuota is
  unrecoverable from lines.
- **The exact figure IS already computed at file time** — the `vatBreakdown` variable
  (`{ rate, base, tax }[]`) that `recordSale` passes to the fiscal backend. It is filed (inside the
  hash-chained registro) but not stored in a reporting-queryable column. This slice persists that same
  variable onto `sales`.

## Decisions

- **D1 — Store the filed breakdown on `sales`, don't read `registros_facturacion` across the package
  boundary.** `sales.vat_breakdown jsonb` keeps `@waitron/reporting` reading the commercial tables (as
  it does today), avoids coupling reporting to the fiscal module's immutable table and its
  jsonb/record-type filtering, and avoids re-expressing the active-sales rules over fiscal records.
- **D2 — Single source of truth: write the SAME variable that is filed, in the SAME transaction.**
  Each sale-creating backend already computes the `vatBreakdown` it files; that identical value is
  written to `sales.vat_breakdown` in the same INSERT. It is **not a recompute** — one variable, two
  sinks — so the stored copy provably equals what entered the huella. (This is the §1-defect-class
  guard: a second copy that could drift is exactly what we avoid by never recomputing it.)
- **D3 — `NOT NULL`, a forcing function.** Every path that inserts a `sales` row and files a desglose
  must populate it; a path that forgets fails loudly at insert, and a cross-path test asserts it. No
  backfill (pre-production — CI builds fresh, dev DBs are recreated; `CLAUDE.md` §3).
- **D4 — No huella change.** `vat_breakdown` is a queryable copy of already-filed data; nothing about
  what `computeHuella` hashes moves. No new error codes.
- **D5 — `sales` stays immutable.** The column is written once at INSERT (the app role holds INSERT,
  not UPDATE); the append-only trigger is unaffected.

## Data model

```sql
ALTER TABLE sales ADD COLUMN vat_breakdown jsonb NOT NULL;
```

Drizzle (`packages/db/src/schema/sales.ts`), typed to the filed breakdown shape:

```ts
vatBreakdown: jsonb("vat_breakdown")
  .$type<{ rate: string; base: string; tax: string }[]>()
  .notNull(),
```

- The array is the filed per-`(rate)` desglose for that sale: `rate` (e.g. `"21.00"`), `base`
  (tax-exclusive), `tax` (the filed cuota — difference-method for catalogue sales, multiplicative for
  the rest). Money fields are `Decimal` strings, never `number`.
- `sales` is a `tenant_id`-bearing table that already carries FORCE RLS + policy + grants and the
  immutability triggers; **adding a column changes none of that** and adds no new tenant-scoped table,
  so the `inmutabilidad` guard is untouched.

## The write path (single source of truth)

Every backend that inserts a `sales` row and files a desglose stores its `vatBreakdown` on that row,
from the same variable it passes to the fiscal backend:

- `recordSale` (`packages/core/src/record-sale.ts`) — the `vatBreakdown` computed as
  `input.vatBreakdown ?? buildVatBreakdown(...)` and passed to `backend.recordSale` is also written to
  the `sales` INSERT. (Covers walk-up, park/retrieve, and both card paths — they all funnel here.)
- **The rectificativa (`recordCorrection`) and F3-canje (`recordSubstitution`) paths** also insert
  `sales` rows and compute their own `vatBreakdown` (negative for a rectificativa; the substitute's own
  for F3) — each stores it identically.

The plan enumerates every call site; `NOT NULL` + a test that files through each path is the guard
that no path is missed.

## Reporting change

`computeVatSummary` (`packages/reporting/src/vat-summary.ts`) reads `sales.vat_breakdown` instead of
recomputing from `sale_lines`:

- Unnest each active sale's `vat_breakdown`, group by `rate`, `sum(base)` and `sum(tax)` →
  `VatRateLine[]`; `baseTotal`/`taxTotal`/`grossTotal` follow. The figures are now the filed ones.
- **All existing behaviour is preserved**: issuance-anchored on `sales.issued_at`, business-day
  bucketing (DST-aware cutover), the `activeSalesClause` filtering (voided and F3-canje substitutes
  excluded; rectificativas net in as negatives). `computeDailyClose`'s cash-up and counts are
  untouched.
- The stale `CAVEAT` block in `vat-summary.ts` (documenting the divergence) is **removed** — it no
  longer applies.

## Migration, testing

- **Migration:** one additive `ALTER TABLE sales ADD COLUMN vat_breakdown jsonb NOT NULL` in
  `packages/db`. **Sequenced after allergens' `0031`** (both touch `packages/db`;
  `drizzle/meta/_journal.json` collides — rebase to the next free number). Generated via
  `pnpm --filter @waitron/db db:generate`; verify the SQL is only the additive column.
- **Testing (TDD):**
  - **Equality-to-filed** (the load-bearing one): file a **catalogue** sale, then assert
    `sales.vat_breakdown` equals the `registros_facturacion.desglose` that was filed for it (same
    per-rate base + cuota) — proves the stored copy is the filed value, not a recompute.
  - **`computeVatSummary` now exact** for the previously-divergent case: a mixed-rate catalogue sale
    whose difference-method cuota ≠ `round(base × rate)`; assert the summary equals the filed figures.
  - **Non-catalogue unchanged**: a `buildVatBreakdown` sale still matches (regression).
  - **Corrections net**: a rectificativa's negative `vat_breakdown` nets into the day's summary.
  - **`NOT NULL` coverage**: filing through each sale-creating path yields a non-null `vat_breakdown`
    (a path that failed to set it would fail the insert).
  - Real Postgres where the fiscal write path / RLS warrants it; PGlite for the pure reporting math.

## Scope out / deferred

- **The frozen *cierre Z*** — slice 8b (this only makes the live close exact).
- **`modelo 303` / date ranges / monthly aggregation** — a later reporting slice.
- **Backfilling existing `sales`** — none (pre-production).
- **Changing the filed desglose or the huella** — nothing here touches what is hashed.
- **Recargo de equivalencia / non-ES tax regimes** — out (unchanged from #56).

## Provenance (tree receipts)

| Claim | Receipt |
| --- | --- |
| `sale_lines` stores net base + rate, no gross/cuota | `packages/db/src/schema/sales.ts` (`line_total` = base per `packages/core/src/record-sale.ts` doc; `vat_rate`; no gross column) |
| Difference method, rounding per line then `cuota = Σgross − Σbase` per `(sale,rate)` | `packages/catalogue/src/pricing.ts` `priceRows` |
| Filed into `registros_facturacion.desglose` (base+rate+cuota, no gross) | `packages/fiscal-verifactu/src/backend.ts` (`recordSale`/desglose map) |
| `computeVatSummary` multiplicative recompute; base matches, cuota diverges catalogue-only | `packages/reporting/src/vat-summary.ts` (`taxOf`, and its own CAVEAT) |
| Non-catalogue path already matches (same multiplicative rounding) | `packages/core/src/record-sale.ts` `buildVatBreakdown` |
| The filed `vatBreakdown` variable exists at file time and is what we persist | `packages/core/src/record-sale.ts` (`input.vatBreakdown ?? buildVatBreakdown(...)`) |

Full verification (with exact line numbers and a worked lossy-rounding example) was produced during
brainstorming; re-confirm each receipt while implementing rather than trusting this table.

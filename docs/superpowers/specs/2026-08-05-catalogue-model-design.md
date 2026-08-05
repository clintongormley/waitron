# Catalogue — priced products the till can sell — Design

**Date:** 2026-08-05
**Status:** Approved in brainstorming
**Scope:** The minimal priced-item model a till reads to build a basket, and the thin change to the
sale path that lets a sale be rung entirely from catalogue data. A tenant owns **catalogues** (named
menus); **products** belong to a catalogue; a **location** is assigned a catalogue; **categories** are
a tenant-wide analytics taxonomy snapshotted onto each sale line. Prices are stored **VAT-inclusive
(gross)** and reversed to base/cuota at sale time by the **difference method**. Headless: no till UI,
no management UI, no working-order producer. This is the till track's (sub-project 7) functional
unblocker and the seed of sub-project 18 (menu & allergens); allergens, variants, recipes, the scale
hardware, catalogue sync, and per-location overrides are all **out**.

This exists because the sale path today has no notion of *what is being sold*. `recordSale` receives
`lines` and a `total` as opaque, already-computed values; the demo scripts hand-build a single line
from CLI args. There is deliberately no product/menu/SKU anywhere (enforced by tests). A till cannot
tap a priced item because no priced item exists. This slice builds that layer and proves a sale can be
chained and filed from it, end to end, without a browser.

---

## 0. What is already there, and what this leans on

Verified in the tree (worktree `feat/catalogue-model`):

- **The sale seam is clean and transaction-oriented.** `recordSale(tx, backend, input)`
  (`packages/core/src/record-sale.ts:145`) runs the §4 7-step sequence and **returns inside the
  transaction** — the caller commits — so a future till can write the working-order settlement, the
  sale, and the fiscal record as one unit. This slice does not change that contract; it feeds it.
- **Sale lines are net-carrying; the total is gross.** `RecordSaleLine.lineTotal`/`unitPrice` are the
  **tax-exclusive base** (`record-sale.ts:46-51`; `sale_lines.unit_price`/`line_total`
  `numeric(12,2)`, `sales.ts`). `RecordSaleInput.total` is the **gross** figure — base + VAT, AEAT
  `ImporteTotal`, what the customer paid — passed verbatim and never re-derived (`record-sale.ts:78-83`),
  written to `sales.total` and handed to the backend as `ImporteTotal` (`fiscal-verifactu/src/backend.ts:287`).
- **The desglose is derived per rate group.** `buildVatBreakdown` (`record-sale.ts:125`) groups lines
  by `vatRate`, sums each group's `lineTotal` as the base, and derives `tax = percentOf(base, rate)`
  (base × rate, **multiplicative**). Each entry is `{ rate, base, tax }` (`@waitron/fiscal`), mapped to
  `BaseImponible`/`TipoImpositivo`/`CuotaRepercutida` (`backend.ts:261-272`).
- **No reconciliation is enforced on the write path.** Nothing asserts `Σlines == total`; the only
  cross-check (`verifactu/src/validate.ts`, ±10 tolerance, warning-only) is not wired in.
- **Money math is exact, round-half-away-from-zero, scale 2.** `@waitron/shared`'s `divideDecimal`,
  `multiplyDecimal`, `addDecimal`, `subtractDecimal`, `sumDecimals`, `MONEY_SCALE = 2`;
  `percentOf(amount, rate, scale=2)` = `amount × rate / 100` (`core/src/vat.ts:12`). **There is no
  gross→base helper** — this slice builds `base = gross ÷ (1 + rate/100)`.
- **The RLS pattern is hand-written.** Drizzle's `.enableRLS()` emits only `ENABLE`; `FORCE ROW LEVEL
  SECURITY` + a `<t>_tenant_isolation` `FOR ALL` policy (`USING`/`WITH CHECK` on `tenant_id =
  current_tenant_id()`) + grants live in a custom migration (`0001_tenancy_rls.sql`,
  `0017_nodes_rls.sql`). `current_tenant_id()` and `app_user` already exist.
- **A venue is provisionable.** `waitron-provision venue` (#57) stands up tenant → location → till →
  node → SIF → series; `locations` carries `catalogue_id`'s future sibling columns already
  (`tenants.ts:60`). This slice adds the catalogue and the location→catalogue assignment.
- **The snapshot rule is load-bearing and test-enforced.** Line tables carry snapshotted
  description/qty/price/rate, **never a catalogue FK**; `sales.test.ts` / `orders.test.ts` assert no
  `/(product|item|catalogue|catalog|menu|sku|variant)_id$/i` column. This is what makes an issued
  invoice immutable and offline-safe (a stale catalogue is a freshness, not a correctness, problem —
  arch design §6). A snapshotted `category` **text** column passes that guard (it forbids `*_id`, not a
  label).

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| D1 | **Catalogue-first, minimal.** This slice builds the priced-item model and one additive sale-path hook. It does **not** build the till UI, the working-order producer, or a management surface. Allergens, variants, modifiers, and recipes stay in sub-project 18. |
| D2 | **The catalogue is the shareable unit.** A tenant owns **catalogues** (named menus); **products belong to a catalogue**; a **location is assigned one catalogue** (`locations.catalogue_id`), and one catalogue serves many locations. This resolves both real cases: *N identical delis* share one catalogue (edit once), a *deli + restaurant* get one catalogue each (the restaurant never sees deli products). Pure tenant-level products would leak across heterogeneous venues; pure location-level products would duplicate across identical ones. |
| D3 | **Categories are a tenant-scoped analytics taxonomy**, orthogonal to catalogue: `catalogue_id` answers "which menu / which locations", `category_id` answers "what kind of thing, for reporting". A table (not free text) so "Drinks" is one canonical bucket a roll-up sums across catalogues. |
| D4 | **The category is snapshotted onto the sale line** (a `category` **text** value, never an FK). Because the snapshot rule leaves no `product_id` to join back through, category analytics only works if the label is copied onto the immutable line at sale time — the same principle as the description snapshot. Lands now so there is no historical hole; the GROUP-BY *reports* come with a later reporting slice. |
| D5 | **Prices are stored VAT-inclusive (gross)** — the shelf/PVP price, what the customer pays. Spanish consumer-protection law requires displayed prices to include VAT, and a counter operates on round-ish gross numbers. Base and cuota are derived backward at sale time. |
| D6 | **Weighed items are in the model now.** `pricing_unit ∈ {each, weight}`; `unit_price` is gross per item or gross per kg; a weighed line's `quantity` is a measured weight (e.g. `0.320`) in the existing `numeric(12,3)` column — no schema change to the line. The scale hardware, weight-entry UI, and barcode scanning are deferred. A deli's core stock is weighed, so this is realistic, and it is expensive to retrofit. |
| D7 | **VAT via a semantic class.** `vat_class ∈ {general, reduced, super_reduced, zero}`; a resolver maps class → rate at pricing time and the **resolved rate is snapshotted** onto the line. Single source of truth: a rate change is one edit, a mis-keyed `1.0`-vs-`10.0` rate is impossible, and it seeds the tax-module the territory design (`resolveFiscalModules` → `tax: "iva"`, #57) reserves. **The rate numbers get a primary-source AEAT receipt in the plan** (§8) — they are an external-world claim, not asserted from memory. |
| D8 | **Difference method for VAT rounding.** `total = Σ gross_line` (the customer pays exactly the marked/weighed gross); per rate group `cuota = gross_group − base_group`. This is the legally standard reverse calculation for VAT-inclusive Spanish retail. Its cost — `cuota` can differ from `base × rate` by a céntimo — is within AEAT's rounding tolerance and is why the *multiplicative* method was rejected: it would charge a céntimo over the marked price on boundary values. |
| D9 | **`recordSale` gains an optional caller-supplied `vatBreakdown`.** When present it is used verbatim; when absent, `buildVatBreakdown(lines)` runs exactly as today. This lets the catalogue drive the gross-inclusive difference-method desglose **without touching the fiscal backend** (which already just maps `{rate, base, tax}`). Existing callers (`recordCorrection`, `recordSubstitution`, demos) pass neither and are unaffected. On the supplied path, `recordSale` asserts `total == Σ(base + tax)` exactly and throws a new `sale.total_mismatch` otherwise — defence for an unrepairable record. |
| D10 | **Homes: logic in a new `@waitron/catalogue`; the three tables + RLS migrations in `@waitron/db`.** Schema lives in `packages/db` by convention (the FORCE/policy/grant migrations and the `inmutabilidad`/`english-only` guards all live there). `catalogue` is added to `english-only.ts`'s `GENERIC_PACKAGES` (it is an English, regime-neutral package) — which means `fiscal-verifactu/src/vocabulary-scope.test.ts`, which pins that list, is updated in the same change (the stale-hardcoded-list class, CLAUDE.md §2). No migration-manifest entry: the package owns no migrations. |
| D11 | **Grants: `app_user` gets `SELECT, INSERT, UPDATE` on all three tables**, no `DELETE`. Menu editing is a routine, app-managed back-office action a manager performs (not a rare provisioning action like creating a node), so it runs as `app_user` under RLS — the same posture `tills`/`locations` carry. The application-layer permission that gates it (a future `catalogue.manage`) is **deferred**, exactly like the `sale.discount` seam that has a permission but no call site yet. Deactivation is `active = false`, never `DELETE` (products may sit behind historical sales' snapshots and categories behind an FK). |
| D12 | **No management UI, CLI, or HTTP this slice.** Authoring is the headless package API plus a demo/seed script. Catalogue **sync** (the monotonic per-catalogue `version`, push-on-change / pull-on-reconnect) and **per-location overrides** are deferred to the sync slice; the `version` column lands now as its seam. |

D2, D7, and D8 are the load-bearing ones. D2 is what makes the model correct for a multi-venue
tenant. D7/D8 are what make a gross-priced retail catalogue reconcile to a fiscally-sound desglose.

---

## 2. Data model

Three new tenant-scoped tables in `@waitron/db` (each `.enableRLS()` in the schema, with FORCE +
policy + grants in a custom migration), one new column on `locations`, and one snapshot column on each
line table.

```
catalogues                              -- a named, shareable menu
  id           uuid pk
  tenant_id    uuid  → tenants(id)       -- FORCE RLS, tenant isolation
  name         text  not null
  active       boolean not null default true
  version      bigint not null default 1 -- sync seam (D12); bumps on product change (bump wired later)
  created_at / updated_at

categories                              -- tenant-wide analytics taxonomy
  id           uuid pk
  tenant_id    uuid  → tenants(id)
  name         text  not null            -- e.g. "Food", "Drinks", "Alcohol"
  created_at / updated_at

products
  id           uuid pk
  tenant_id    uuid  → tenants(id)
  catalogue_id uuid  → catalogues(id)     -- which menu / which locations sell this
  category_id  uuid  → categories(id) NULL -- analytics bucket; reporting treats NULL as "Uncategorised"
  descriptions jsonb not null             -- locale → text; mirrors sale_lines so snapshot is a direct copy
  pricing_unit text  not null             -- 'each' | 'weight'  (CHECK-constrained)
  unit_price   numeric(12,2) not null     -- GROSS (VAT-inclusive): per item, or per kg
  vat_class    text  not null             -- 'general' | 'reduced' | 'super_reduced' | 'zero' (CHECK)
  active       boolean not null default true
  created_at / updated_at

locations  (existing) + catalogue_id  uuid → catalogues(id) NULL   -- the assignment

sale_lines / working_order_lines  (existing) + category  text NULL -- snapshotted label (D4)
```

Notes:

- **Composite-FK / tenant-consistency.** `products.catalogue_id`/`category_id` and
  `locations.catalogue_id` are within one tenant; the plan decides whether to enforce this with
  composite FKs `(tenant_id, x_id)` (as the node rekey did for commercial tables) or plain FKs relying
  on RLS. Default: plain FKs + RLS, matching how `locations.tenant_id`/`tills.location_id` already
  work; composite only if a mixed-tenant path is reachable (it is not — all writes are tenant-scoped).
- **`pricing_unit` / `vat_class` as CHECK-constrained text**, not Postgres enums, so the sets can grow
  without an enum-alter dance (the same reasoning D3 of the locations design applied to
  `fiscal_territory`).
- **`working_order_lines` gains `category` too**, for symmetry with `sale_lines` (the two are
  deliberately parallel), even though nothing writes working orders yet — it saves a migration when the
  till's working-order producer lands. Only `sale_lines` is wired this slice.
- **English/regime-neutral.** Every token is English (`vat`, not `iva`); the resolver is `resolveVatRate`.
  `@waitron/catalogue` joins `GENERIC_PACKAGES` (D10) so this is guarded, not just intended.

---

## 3. Pricing — the difference method

`@waitron/catalogue` owns a pure pricing layer with no I/O:

**`resolveVatRate(vat_class) → Decimal`** — `general→"21.00"`, `reduced→"10.00"`,
`super_reduced→"4.00"`, `zero→"0.00"`. (Numbers pinned in the plan, §8.)

**`priceBasket(items: {product, quantity}[]) → { lines: RecordSaleLine[], total, vatBreakdown }`**,
ready to hand straight to `recordSale`. Per item (product `P`, `quantity q` — a count for `each`, a kg
weight for `weight`):

```
rate       = resolveVatRate(P.vat_class)                  -- e.g. 10.00
gross_line = round2(P.unit_price × q)                     -- VAT-inclusive; what the customer pays for the line
base_line  = round2(gross_line ÷ (1 + rate/100))          -- reverse VAT out  →  RecordSaleLine.lineTotal
unit_price = round2(P.unit_price ÷ (1 + rate/100))        -- net, informational only (stored verbatim, non-derivational)
descriptions, vatRate = rate, category = P.category?.name ?? null
```

Then per rate group `g` (and this is the whole point of the difference method):

```
base_group  = Σ base_line   (in g)
gross_group = Σ gross_line  (in g)
cuota_group = gross_group − base_group          -- NOT percentOf(base, rate)
vatBreakdown += { rate: g, base: base_group, tax: cuota_group }
total        = Σ gross_line  (all groups)
```

By construction `total == Σ(base_group + cuota_group)` **exactly**, so the record is internally
consistent and the customer is charged the exact marked/weighed gross. `cuota_group` may differ from
`base_group × rate` by a céntimo — accepted, within AEAT's rounding tolerance, and the reason D8 was
chosen over the multiplicative method. Worked example, 0.320 kg @ €24.90/kg incl. 10%:

```
gross_line = round2(24.90 × 0.320) = round2(7.968) = 7.97   ← charged
base_line  = round2(7.97 ÷ 1.10)   = round2(7.2454) = 7.25   ← lineTotal
cuota      = 7.97 − 7.25 = 0.72                              ← CuotaRepercutida (difference)
total      = 7.97                                            ← ImporteTotal == base + cuota
```

`priceBasket` uses `@waitron/shared`'s exact decimal ops throughout; `base = gross ÷ (1 + rate/100)`
is built from `divideDecimal(gross, "1"+rate/100, 2)` (the divisor `Decimal` assembled as `1 +
rate/100`, e.g. `"1.10"`). `unit_price`'s net value is informational — the existing model already has
no `unit×qty == lineTotal` invariant, and `unit_price` feeds no derivation (`record-sale.ts` stores it
verbatim); a customer ticket showing gross is a till-render concern, not this slice's.

---

## 4. The core change

Minimal and additive, in `@waitron/core`:

1. **`RecordSaleLine` gains `category?: string | null`.** The `saleLines` insert
   (`record-sale.ts:286`) adds `category: line.category ?? null`. Existing callers omit it → `null`.
2. **`RecordSaleInput` gains `vatBreakdown?: VatBreakdownLine[]`.** At `record-sale.ts:346`,
   `vatBreakdown: input.vatBreakdown ?? buildVatBreakdown(input.lines)`. Present → used verbatim
   (the catalogue's difference-method breakdown); absent → today's behaviour unchanged.
3. **On the supplied-breakdown path, assert `input.total == sumDecimals(base) + sumDecimals(tax)`
   exactly**, else throw the new `sale.total_mismatch` (domain-concept name; registered in
   `packages/core/src/errors.ts`, imported per the barrel-reachability convention). This does not
   re-derive the total (the design's stated objection) — it *refuses a breakdown that disagrees with
   the total*, catching a mis-built desglose before it is chained into an unrepairable record. It never
   fires on the legacy path.

`sale_lines` and `working_order_lines` each gain a nullable `category text` column (additive
migration). The fiscal backend is untouched — it already maps `{rate, base, tax}` to the desglose.

---

## 5. Operations

Headless functions in `@waitron/catalogue`, each taking a `Transaction` and running under the caller's
tenant context (`withTenant`/`app_user`), so the tests exercise them the way the till eventually will
and RLS is proven in the same pass:

- **Catalogues:** `createCatalogue`, `listCatalogues`, `renameCatalogue`, `deactivateCatalogue`.
- **Categories:** `createCategory`, `listCategories`, `renameCategory`.
- **Products:** `createProduct`, `listProducts(catalogueId)`, `updateProduct`, `deactivateProduct`.
- **Assignment:** `assignCatalogueToLocation(locationId, catalogueId)` — UPDATE `locations.catalogue_id`.
- **Effective list:** `listAvailableProducts(locationId)` → the location's catalogue's `active`
  products; the single query a till caches. The `version` column is the seam a later sync slice reads;
  no push/pull is built here.

No CLI/HTTP/UI. Authoring for the demo is the package API.

---

## 6. RLS, grants, testing

- **A custom migration** (next number, `0026_*`) adds to each of `catalogues`, `categories`,
  `products`: `FORCE ROW LEVEL SECURITY`, a `<t>_tenant_isolation` `FOR ALL` policy
  (`USING`/`WITH CHECK` = `tenant_id = current_tenant_id()`), and `GRANT SELECT, INSERT, UPDATE …
  TO app_user`. Mirrors `0001`/`0017`. `locations.catalogue_id` and the two `category` line columns are
  plain additive `ALTER`s (drizzle-generated), in their own migration(s).
- **After adding the tables, run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`** — its
  guard scans every `tenant_id`-bearing table for FORCE RLS, and a new tenant-scoped table with
  `.enableRLS()` alone would leave it red (CLAUDE.md §3). All three tables must FORCE.
- **Pricing math is pure and PGlite-free** — unit-tested directly (`priceBasket`, `resolveVatRate`,
  the rounding boundary cases, the difference-method reconciliation `total == Σ(base+cuota)`).
- **RLS isolation, grants, and the effective-list query run on real Postgres** via
  `useRealPostgres`/`describeEachTarget` — a second tenant must not read or write the first's
  catalogue; `app_user` has no `DELETE`.
- **The core change** gets tests both ways: the supplied `vatBreakdown` reaches the backend verbatim;
  the absent path still calls `buildVatBreakdown`; `sale.total_mismatch` fires on a breakdown that
  disagrees and not otherwise; `category` snapshots onto `sale_lines`. Prove each guard by deletion
  (CLAUDE.md §4).
- **The end-to-end proof (§7-demo)** runs on the venue `waitron-provision venue` produces, exercising
  the real chain-append and fiscal write.

Coverage thresholds are the package default (98/98/98/95). Whole-workspace suites run after touching
`GENERIC_PACKAGES` (the stale-hardcoded-list class, D10).

---

## 7. The end-to-end proof

A demo/seed script (a sibling of `apps/server/scripts/record-one-sale.ts`, non-coverage side):

1. Provision (or reuse) a venue → tenant, location, till, node, `standard` series.
2. `createCatalogue "Deli"`; `createCategory "Food"` / `"Drinks"`; `createProduct` ×2 — one `each`
   (a canned drink, `general`), one `weight` (jamón @ €/kg, `reduced`).
3. `assignCatalogueToLocation`.
4. `listAvailableProducts(location)` → the two products.
5. `priceBasket([{drink, 1}, {jamón, 0.320}])` → `{ lines, total, vatBreakdown }`.
6. `recordSale(tx, verifactuBackend, { …, lines, total, vatBreakdown })` → the sale chains and files,
   its desglose and total sourced entirely from catalogue data, `total` equal to the summed gross.

This demonstrates the seam the till will use, headless, against the real fiscal backend.

---

## 8. Open questions / receipts to obtain in the plan

- **The IVA rate numbers (D7) need a primary-source AEAT receipt.** `general 21 / reduced 10 /
  super_reduced 4 / zero 0` is the standing Spanish IVA set, but food rates have moved recently
  (temporary basic-food reductions) — the plan cites an official AEAT source for the values used and
  notes their date, rather than asserting them (CLAUDE.md §1, external-world claims). The resolver's
  *shape* is fixed regardless; only the numbers are the claim.
- **Composite vs plain FKs** (§2) — default plain + RLS; the plan confirms no mixed-tenant path exists.
- **The `version` bump trigger** is a sync-slice concern; this slice ships the column defaulting to 1
  and does not bump it. Named so it is not mistaken for wired.

---

## 9. Deferred (named, not built)

Allergens / variants / modifiers / recipes → sub-project 18. Per-location price/availability overrides
and the catalogue **sync** protocol (version push/pull, tenant→location→till merge) → the sync slice.
Scale hardware, weight-entry UI, barcode scanning → a later till slice. Category-based **reports**
(the snapshot lands now; GROUP-BY comes with reporting). Catalogue **management UI/CLI** → the
dashboard. The `catalogue.manage` **permission enforcement** → with the till's call sites (like the
discount seam). Multiple catalogues per location, and till-level assignment → sync slice. The
working-order **producer** and amendment log → sub-project 7 proper.

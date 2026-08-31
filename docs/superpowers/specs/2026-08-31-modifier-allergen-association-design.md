# Modifier ↔ allergen association — design

**Status:** approved (brainstorm, 2026-08-31)
**Owner ask:** 2026-08-30 (backlog, Tier B #7 follow-on) — a menu modifier changes a dish's
as-served EU-14 allergen profile in **both** directions: *adds* ("extra cheese" → milk) and,
safety-critically, *removes* ("gluten-free bun" → gluten; "oat milk" → milk).

## 1. Why

EU 1169/2011 Annex II obliges a food business to give the customer accurate allergen information for
the food **as served**. Waitron already tracks a dish's allergens (the menu-allergens subsystem,
`docs/superpowers/specs/2026-08-07-menu-allergens-design.md`, plus recipe/BOM inheritance,
`2026-08-15-recipes-bom-allergen-inheritance-design.md`), and #184 added reusable ordering modifiers.
But the two subsystems are **completely disjoint today** — they share no column, no code, no surface —
so a modifier that changes what is actually on the plate does not change the allergen answer the
waiter gives. A waiter selling "burger — gluten-free bun" still reads the base burger's "contains
gluten". This is the gap, and it must ship **add + remove together**: an add-only half would show a
"gluten-free" modifier as still containing gluten — worse than nothing, because it looks handled.

This feature is **non-fiscal** — it never touches the hash-chained record — but **legally
load-bearing**. It gets its own review, and a food-safety advisor should confirm the model (see §9).

## 2. What it is not (scope boundaries — YAGNI)

- **Not on the receipt.** The customer is told before ordering (the waiter answers from the till), not
  after. The printed receipt stays allergen-blind, which also keeps the immutable receipt path
  byte-unchanged. (Owner decision, 2026-08-31.)
- **Not on the filed record.** Nothing is added to `sale_lines` or `record-sale.ts`; the as-served
  profile is computed on read/display only. It is **structurally excluded from the huella** by never
  existing as a column on a fiscal table (§7).
- **Not snapshotted.** Computed live from the current catalogue on each read, not frozen onto the
  order line. Orders are short-lived (built → fired → served → settled in one service), so live is
  correct-enough and keeps the schema change to two columns. See §5 for the one accepted edge.
- **One shared derivation, not duplicated.** The safety-critical logic is a single pure leaf module
  (`packages/catalogue/src/derivation.ts`, zero runtime imports), used server-side for KDS and
  **deep-imported by the till** (`@waitron/catalogue/src/derivation.js`) — the exact precedent the till
  already uses for pricing (`import { priceBasket } from "@waitron/catalogue/src/pricing.js"`,
  `apps/till/src/state/working-order.ts:25`), which dodges the barrel's runtime deps. One tested
  implementation, no mirror.
- **No partial removes.** A remove deletes a code entirely; there is no "downgrade contains →
  may_contain". (Can be added later if an advisor asks for it.)
- **No allergen-driven KDS routing / warnings-as-blocks.** KDS *shows* the profile; it does not gate
  firing on it.

## 3. The data model

Two new JSONB columns on the existing `option_group_items` table
(`packages/db/src/schema/catalogue.ts:183-208`). That table already carries FORCE ROW LEVEL SECURITY +
a tenant-isolation policy + grants from #184's `0082_motionless_komodo.sql`, so **adding columns
inherits the policy** — `ALTER TABLE ADD COLUMN` only, no new RLS migration. This mirrors the existing
per-option `vat_class` override (`catalogue.ts:193`), extended to a bidirectional overlay because a
single scalar cannot express both directions:

- **`add_allergens`** — a `ProductAllergens` map, the same shape as `products.manual_allergens`
  (`packages/catalogue/src/allergens.ts:21-33`): `{ "milk": { "presence": "contains" } }`. Default
  `NULL` (no adds). Validated by `validateAllergens` (`allergens.ts:39-55`).
- **`remove_allergens`** — a JSONB array of EU-14 codes: `["gluten"]`. Default `NULL` (no removes).
  Each code validated against `ALLERGEN_CODES` (`allergens.ts:4-19`).

**Validation** (a new `allergen.*` code — grep the twelve siblings before naming it, CLAUDE.md §3):

- every code in either column ∈ `ALLERGEN_CODES`;
- `add_allergens` presence ∈ `{contains, may_contain}` (reuse `validateAllergens`);
- **`add` and `remove` are disjoint** for one item — a code in both is a contradiction and is
  rejected. (The check is per-item, at authoring time.)

The `AllergenMap` DB-layer copy (`packages/db/src/schema/catalogue.ts:26`) already exists for the
product columns and is reused for the column type.

## 4. The derivation — one pure function (the safety core)

`deriveAsServedAllergens(base, options)` in `packages/catalogue/src/derivation.ts`, beside the existing
`mergeAllergenMaps` / `republish` (`derivation.ts:18-43`). It returns the **same `{ allergens, pending }`
shape** the recipe subsystem already uses (`recipeDerivation`), so every downstream consumer already
knows how to render "reviewed set + a pending flag".

Inputs:
- `base: ProductAllergens | null` — the dish's **published** allergens (`products.allergens`,
  `catalogue.ts:117`). `null` means **not reviewed yet** (PENDING).
- `options: { add: ProductAllergens | null; remove: AllergenCode[] | null }[]` — the selected options'
  overlays, in selection order.

The **Cautious** policy (owner decision, 2026-08-31 — "remove" is the dangerous direction; over-declaring
is always safe):

1. **Base unreviewed** (`base === null`) → `{ allergens: merge(all adds), pending: true }`.
   Removes are **ignored** — you cannot declare an allergen absent from an unknown base. Adds still
   show (a positive assertion is always safe). The `pending: true` drives a "dish not fully reviewed —
   ask" state on every surface, exactly as an unreviewed base product does today.
2. **Base reviewed** (`base` is a map, possibly `{}`) →
   `{ allergens: merge( base minus all removes, all adds ), pending: false }`.
   - A **remove** deletes the code from the working set entirely — clearing both a definite `contains`
     **and** a `may_contain` (traces) declaration for that code. A gluten-free bun is a real prep
     change, not a downgrade.
   - **Removes are applied first, then adds merged in**, so **add wins** a cross-option conflict (one
     option removes gluten, another adds it → the plate contains gluten → shown). This is the safe
     direction by construction.
   - Merge semantics reuse `mergeAllergenMaps` (`contains` dominates `may_contain`; `source` strings
     sorted + comma-joined) — `derivation.ts:18-33`.

The function is **pure and total** (no I/O, defined for every input incl. empty options → echoes the
base). It is the spine of the test suite (§8).

## 5. Surfaces + data flow

The as-served profile is computed by the one shared `deriveAsServedAllergens` — client-side on the
till (the live order lives in the client) and server-side for KDS (it reads stored lines) — and each
surface renders the `{ allergens, pending }` shape it already knows from product allergens.

**Till & handheld** (owner-selected surface):
- `add_allergens` / `remove_allergens` are projected onto the option data the till already receives
  (a new field on `TillOptionItem`, `apps/till/src/api/client.ts:147-152`).
- The till computes as-served **client-side** on the **live order** from `TillProduct.allergens`
  (`client.ts:185`) + the selected options' overlays, via the deep-imported shared
  `deriveAsServedAllergens`. This is the same pattern the till already uses to display option prices
  client-side (`SelectedLineOption.priceDelta` is display-only, the server re-prices at commit,
  `apps/till/src/state/working-order.ts:40-48`) — and allergens are **never filed**, so there is no
  authoritative server value to fetch. It renders on the **order line / line-detail** where the
  selected-options context lives (`widgets/basket.ts:84-118`, `state/working-order.ts`).
- **Scope boundary:** the surface is the **live order being built**. A *retrieved/held* order does
  not carry its options today — `getHeldOrder` returns only `productId`/`quantity`
  (`apps/server/src/working-order.ts:2282-2293`, a pre-existing #184 read gap) — so as-served on a
  retrieved order is out of scope here and would need that read widened first.
- The existing standalone allergen screen (`till-allergen-screen.ts`) keeps showing **base**
  products — it has no order context — and is out of scope beyond reusing its allergen-name i18n.
- The **handheld inherits this for free**: it reuses the same till widgets unchanged
  (`2026-08-30-handheld-tableside-ordering-design.md`).

**KDS & expo** (owner-selected surface):
- The station/expo queue read already groups child modifier lines by parent
  (`readModifiersByParent`, `apps/server/src/working-order.ts:3169-3196`, feeding `listStationQueue` /
  the expo queue). It gains joins to `products` (base allergens) and `option_group_items` (overlays)
  so each fired dish line carries its as-served profile, rendered as **"NO GLUTEN"** (removes) /
  **"+MILK"** (adds) on the ticket — a second safety check at prep.

**Live, not snapshotted** — the one accepted edge: `working_order_lines.option_group_item_id` is
`ON DELETE SET NULL` (`0082_motionless_komodo.sql:61-65`), so an option **deleted mid-fired-service**
loses its overlay link and that line falls back to base − nothing (the line keeps its stored name).
This is rare (catalogue edits during a service), non-catastrophic (it drops back to the base dish's
allergens, the safe direction for a *removed* modifier since the base over-declares), and not worth a
snapshot column. Noted, accepted.

**Dashboard authoring** (in scope regardless of surface choice):
- The option-group manager (`apps/dashboard/src/widgets/option-group-manager.ts`) gains, per item,
  an **adds** editor (reuse the existing `apps/dashboard/src/widgets/allergen-picker.ts`) and a
  **removes** multiselect (the 14 codes). Mirrors the per-item VAT select already there.
- Threaded through `catalogue-api` option-item CRUD (`apps/server/src/catalogue-api.ts`) and the
  catalogue operations (`packages/catalogue/src/operations.ts`), the same way `vat_class` is.

## 6. Component boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `option_group_items.{add,remove}_allergens` (migration + schema) | store the per-option overlay | existing FORCE-RLS table |
| `deriveAsServedAllergens` (`packages/catalogue/derivation.ts`) | pure dish − removes + adds, Cautious policy | `mergeAllergenMaps`, allergen types |
| overlay validation (`packages/catalogue`) | reject invalid / contradictory overlays at authoring | `validateAllergens`, `ALLERGEN_CODES` |
| catalogue option-item CRUD (ops + `catalogue-api`) | persist/read the overlay; project onto `TillOptionItem` | schema, validation |
| KDS/expo queue read (server) | attach `{allergens,pending}` per fired dish line | derivation, `readModifiersByParent` + joins |
| dashboard option-group manager | author adds/removes | `allergen-picker`, dashboard API |
| till/handheld order-line render | compute (client-side, deep-imported derivation) + display `{allergens,pending}` | derivation, till allergen-name i18n |
| KDS/expo ticket render | display as-served on the ticket | dashboard kitchen screen |

Each is independently testable; the derivation is pure and the surfaces read a settled shape.

## 7. Non-fiscal guarantee

Read from the tree (to be re-verified in the plan, and **proven by the test below**, not by this
read): `record-sale.ts` carries no allergen field anywhere; `RecordSaleLine`
(`packages/core/src/record-sale.ts:44-64`) and the `sale_lines` insert (`:352-366`) write only
`lineNo, descriptions, quantity, unitPrice, vatRate, lineTotal, category?, parentLineNo?`, and the
huella hashes eight header fields built from `total` + `vatBreakdown` only (`:403-423`). This feature
**adds no column to any fiscal table** and computes purely on read, so the as-served profile cannot
reach a `registro` or the chain. The guarantee is enforced, not asserted: a huella **invariance
test** (the #184 precedent) files a sale with allergen-bearing modifiers and one without, and pins
that they hash **identically** — the overlay never enters `computeHuella`. If that test ever fails,
the guarantee has been broken.

## 8. Testing (TDD)

The derivation is the spine — unit tests first, watched to fail:

- base `null` → `pending: true`, adds-only, removes ignored;
- base reviewed → `base minus removes merged with adds`, `pending: false`;
- a remove clears both `contains` and `may_contain` for its code;
- cross-option conflict (remove gluten + add gluten) → gluten present (**add wins**);
- empty options → echoes the base unchanged;
- `mergeAllergenMaps` semantics preserved (contains dominates, sources joined).

Validation tests: add∩remove rejected; invalid code rejected; presence validated. Schema/RLS: the two
columns on `option_group_items` (reuse `packages/db/src/schema/catalogue.rls.test.ts`). Surface tests:
the order-line read and the KDS/expo queue read attach the right profile for a dish with a
removing/adding option; a PENDING base surfaces the pending state. Fiscal: the huella-invariance test
in §7. Prove every guard by deletion (CLAUDE.md §4).

## 9. Open questions (advisor / follow-up, none blocking the build)

- **Food-safety advisor** to confirm the model: is "remove clears may_contain too" acceptable, or must
  a substitution keep a cross-contamination warning (the "Extra-cautious on traces" variant we did not
  pick)? The design isolates this to `deriveAsServedAllergens` — a one-function change if the answer
  flips.
- **Allergen authoring completeness** already has a general gap (a base product can be PENDING); this
  feature inherits it and handles it safely (PENDING base → pending as-served). No new obligation.
- **Per-option quantity** ("extra shot ×2") is a *separate* Tier B #7 follow-on; allergens do not
  scale with quantity (presence is qualitative), so the two are independent.

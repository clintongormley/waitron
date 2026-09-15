# Optional product unit, and click-a-unit-to-see-its-products

Date: 2026-09-15
Status: draft (awaiting owner review)
Area: catalogue (units), dashboard (units screen + product form), server (units API)

## Problem

A product's selling unit is required today. Every product must pick one from a stored
list, and `each` is itself a stored, seeded, editable unit that sits in that list. That
is wrong on two counts:

1. Most products are sold "each" and should not have to pick anything. A product with no
   unit should simply read as **Each**.
2. `each` is not really a unit anyone should manage. It should not appear on the Units
   management screen, and it should not be editable or deletable.

Separately, the Units screen gives no quick way to see which products use a given unit —
that list only surfaces today when a delete is blocked.

## Goals

- A product's unit is **optional**. No unit assigned = **Each** (shown, never stored).
- `each` is no longer a stored/seeded unit; it never appears on the Units screen.
- The product form defaults to **Each** and no longer requires a unit.
- **Clicking a unit's row** on the Units screen opens a modal listing the products that
  use it, with the existing bulk-reassign toolbar — and reassign can now target
  **Each (no unit)** so a unit can be emptied and then deleted.

## Owner decisions (2026-09-15 brainstorm)

- Modal on row click: reuse the existing modal that also allows **bulk reassign**.
- `each` model: **truly optional** — a product can have no unit at all; absence means
  Each; `each` is never stored.
- Product form: the unit dropdown shows **Each** as the pre-selected default option.
- Reassign target may be **Each (no unit)** (owner said "go" to the recommendation).

## What this change does NOT need

- **No schema migration.** `product_units` is keyed by `(tenant_id, product_id)`; a
  product simply having **no row** is already structurally valid today. `unit_id` stays
  `NOT NULL` — a row, when present, always names a real unit. "No unit" = "no row". So no
  drizzle migration is generated and the migration risk-trigger does not apply.
  (Receipt: `packages/catalogue/src/schema/units.ts:57-80` — PK is product-scoped, the
  FK to `units` is `onDelete restrict`, and rows are already optional; the current code
  just always writes one.)
- **No fiscal-document change.** The unit label is snapshotted per sale line into the
  nullable `unit_name` column and fiscal records carry no unit at all. (Receipt:
  `packages/db/src/schema/sales.ts:229`, `orders.ts:180`; a grep of `packages/fiscal*`
  and `packages/verifactu` finds unit only in DB-privilege expectations, never on a
  registro row.)
- **No new display handling on the sale path.** Receipts, kitchen tickets and the till
  basket/expo already treat a missing unit as null-safe, and the till already renders an
  "each"/"kg" fallback (`apps/till/src/widgets/product-name.ts:15-33`). The only new
  label is the dashboard product form's **Each** option.

The one cross-package contract that DOES change (`readProductUnitId` return type,
`ProductEditorValue.unitId`) makes this a full-ceremony branch.

## Design

### 1. Domain — `@waitron/catalogue`

- `readProductUnitId` (`packages/catalogue/src/units.ts:215`) currently throws
  `unit.not_found` when a product has no `product_units` row. It returns **`null`**
  instead. Its only production caller is `readProductEditor`
  (`packages/catalogue/src/product-editor.ts:56`); `ProductEditorValue.unitId` becomes
  `string | null`.
- Add a **clear-unit** operation, `clearProductUnit(tx, tenant, productId)`, that deletes
  a product's `product_units` row (there is no way to remove a unit today —
  `assignProductUnit` only upserts). The write path calls it when the chosen unit is null;
  a real unit upserts via `assignProductUnit` as today.
- Legacy compatibility path in `packages/catalogue/src/operations.ts` (create `:1207`,
  update `:1401`) currently resolves `getSeededUnit(tx, tenant, "each")`. It now branches
  on the legacy `pricingUnit` directly instead of resolving an "each" seed: `"each"` →
  **clear the unit** (never calls `getSeededUnit`); `"weight"` → resolve the seeded `kg`
  (still an error if `kg` is somehow unseeded). `products.pricingUnit` derives to `"each"`
  when there is no unit, which is what the till's quantity-entry logic already expects.
- `getSeededUnit` (`units.ts:115`) keeps working for `"kg"`. It is no longer called with
  `"each"` on the legacy path (see above); if any other caller still passes `"each"` it
  now receives `null`, so that caller must be traced and handled before this lands.

### 2. Reassign — allow "Each (no unit)" as a target

- `reassignProductsToUnit` (`units.ts:190`) moves products from one unit to a target
  unit. Extend it to accept a **null target**, which deletes the products' `product_units`
  rows (making them Each) rather than pointing them at another unit.
- The reassign route `POST /management-api/units/:id/products/reassign`
  (`apps/server/src/units-api.ts:89`) accepts a null/absent `unitId` in its body to mean
  "reassign to Each"; it still returns `productsUsingUnit` for the source afterwards.

### 3. Units screen — click a row to see its products

- Add a **new read route**: `GET /management-api/units/:id/products` returning the
  existing `productsUsingUnit` shape (`{ id, name, available }`,
  `units.ts:235-249`), gated by `person.manage` like the sibling routes. Add a matching
  dashboard client method. (Today the only way to read this list is as the response body
  of the reassign POST — `units-api.ts:110` — which is unsuitable for a plain view.)
- On the Units `wt-data-table` (`apps/dashboard/src/screens/units-screen.ts:416`), add a
  **row-click handler** that fetches the unit's products via the new route and opens the
  existing modal (`units-screen.ts:442`). The modal keeps its search + bulk-reassign
  toolbar; the reassign target dropdown gains an **Each (no unit)** option.
- The blocked-delete flow (`units-screen.ts:197`, `#openInUse`) keeps working — it opens
  the same modal.

### 4. Product form — Each as the default

- The unit `<select>` (`apps/dashboard/src/widgets/product-editor.ts:574`) gains an
  **Each** option, pre-selected. Because options come from a `${…}` expression, the
  chosen option is marked with `.selected` on the option, not via a `.value` binding
  (repo rule — a `.value` binding runs before the options exist).
- Remove the `editor.unit_required` validation (`product-editor.ts:248`). The draft's
  unit becomes `null` by default (Each). Saving with Each → clear unit; saving with a
  real unit → assign it.
- Remove the `defaultUnitId="first unit"` binding
  (`apps/dashboard/src/screens/catalogue-screen.ts:329`) and the `defaultUnitId` property
  — the default is always Each now.
- Add the localised **Each** label to the dashboard i18n (both English and Spanish).

### 5. Seeding

- Drop `each` from the runtime seed set (`packages/catalogue/src/provisioning.ts:88`);
  `g`, `kg`, `mg`, `ml`, `l` stay. The `unit_seed_states` tombstone is unaffected.
- Per the repo's no-backwards-compat rule (pre-production, CLAUDE.md §3), existing `each`
  rows are **not** migrated; a `wa-wt reset` clears the dev DB. Add the replacement of the
  removed seed behaviour in this same change (there is none — Each is now the implicit
  default).

## Error codes

- `editor.unit_required` is retired from the product form path. Codes are never renamed;
  this one is simply no longer thrown. Confirm no other consumer depends on it before
  removing its use.
- No new domain error codes are anticipated. The new GET route 404s an unknown unit id
  the same way `GET /management-api/units/:id` does.

## Testing (TDD — failing test first for each)

Domain / server (PGlite unless a grant/role is under test; `asAppUser` on any grant
assertion):

- `readProductUnitId` returns `null` for a product with no row (was: threw).
- Clearing a unit deletes the `product_units` row; reading it back returns null.
- Create a product with no unit → no `product_units` row, `pricingUnit = "each"`.
- Update a product from a real unit to Each → row deleted.
- Legacy `pricingUnit: "each"` on create/update → no row (was: resolved the each seed).
- `reassignProductsToUnit` with a null target deletes rows (products become Each).
- `GET /management-api/units/:id/products` returns the products-using-unit list; 404 on
  unknown id; `person.manage` gate enforced.
- The reassign route accepts a null target and returns the source's remaining products.

Dashboard (browser mode — real Chromium):

- Product form defaults to Each; saving as Each clears the unit; the dropdown marks the
  chosen option with `.selected` and shows the right option after load.
- Units screen: a row click opens the products modal populated from the new route; the
  reassign toolbar lists Each (no unit) as a target; reassigning to Each empties the unit.
- Render the units screen and product form and LOOK in both themes and at phone width
  (repo rule — a page asserted only as a string has nothing checking it renders).

Fixtures: test helpers that inline-seed a unit named `each` still work — it is just a
user-named unit then, no longer the sentinel. The legacy-compat tests that relied on
`getSeededUnit("each")` resolving are updated to expect "no unit".

## Non-goals

- No change to `kg`/`g`/`mg`/`ml`/`l` seeds or to weight/scale quantity-entry behaviour.
- No data migration of existing `each` rows (pre-production).
- No fiscal / receipt / kitchen-ticket changes.
- No live-subscription for the products-in-a-unit modal — an imperative GET matches how
  the modal already loads.

## Risk & ceremony

- Cross-package contract change (`readProductUnitId`, `ProductEditorValue.unitId`) →
  **full ceremony**: per-task reviews plus the `/finish-branch` wave (simplify lenses +
  run-it + convention). No migration trigger (no schema change). No fiscal trigger.

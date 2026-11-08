# A1308 menu and photos, PR mn4: a product's unit is a column, and "sold by weight" is read from it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Fold `product_units` into `products.unit_id`, and drop `products.pricing_unit`, a stored
copy of "does the unit weigh", working it out from the unit on every read instead.

**Architecture:** One schema change to `products` plus the deletion of `product_units`. Reads that
joined `product_units` join `units` on the owning product's `unit_id` (a variant always reads its
parent's, as today). `pricingUnit` stays in what the API and the published menu document return, now
computed from the unit, so nothing outside the menu package changes shape. PR mn5 then drops the
product's menu column.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R1, R6;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.3 ("Dropped columns":
`pricing_unit`; "Note" on a variant's unit), §1.4, §5 (rows for `products` and `product_units`), §6
("whether a product is sold by weight"); [slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7`, written with the paths and names after
mn1 and mn3 (map in those plans): `packages/menu/src/operations.ts:1108` is today's
`packages/catalogue/src/operations.ts:1108`; `products.menuId` is today's `products.catalogueId`;
`apps/server/src/menu-api.ts` is today's `catalogue-api.ts`; the schema file
`packages/db/src/schema/menus.ts` is today's `schema/catalogue.ts`. Backlog entries are named by their text at `a086eedfb7`; mn3 changed "catalogue" to "menu" in
them, and moved `docs/backlog/catalogue.md` to `docs/backlog/menu.md`. Batch 1 and mn1–mn3 have
landed. Find a moved line by its identifier; a missing identifier this plan does not explain is a stop
(rules §5.1).

**Who lands:** the lane (rules §6). A sale line copies its unit from the unit, not from
`pricing_unit`: "Since B4 the order path reads only the unit (`priceOrderLines`)"
(`docs/backlog/menu.md`, today `catalogue.md:555-566`), and `apps/server/src/working-order.ts:880`
already derives `pricingUnit` from `selection.unit.hardwareUnit`. Read, not run.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **`products.unit_id`**: text, null (Each), key to `units.id` `on delete restrict`, index
   `products_unit_idx`. `product_units` and its three protections go (tables-menu.md §5: its primary
   key "one column per product; that is the same guarantee"; its cascade "not needed"; its unit key
   and index become `products.unit_id`'s). A variant may still store a `unit_id` that nothing reads,
   as a variant's `product_units` row is today (tables-menu.md §1.3 "Note"; `packages/menu/src/units.ts:273`);
   no CHECK forbids it.
2. **The unit is read from the owning product.** `unitOwnerJoin`
   (`packages/menu/src/variant-fallback.ts:127-130`) becomes a join of `units` on
   `case when products.parent_id is null then products.unit_id else parent.unit_id end`, which needs
   the parent join (`parentJoin`, same file). Every caller gets `.leftJoin(parentProducts, parentJoin)`
   before it where it lacks one: `packages/menu/src/operations.ts:587-588`, `:810-811`,
   `:1102-1103`, `:1113-1114`, `:1475-1476`; `packages/menu/src/extras.ts:221-222`;
   `packages/menu/src/extra-projection.ts:58-59`; `apps/server/src/order-state-counts.ts:140-141`,
   `:183-184`; `packages/menu/src/product-editor.ts:40`, `:52` (reads a product's own unit, so it
   reads `products.unitId` directly).
3. **Unit writes move to the column** (`packages/menu/src/units.ts`): `assignProductUnit` (`:207`)
   sets `products.unit_id`; reassigning a unit's products (`:224-262`) updates `unit_id` from source
   to target on top-level products and clears it on variants, in one statement each (no
   one-row-at-a-time rewrite, CLAUDE.md §3); clearing (`:268`) sets null; listing a unit's products
   (`:279-281`) reads `unit_id` on top-level products; deleting a unit (`:293`) first clears the
   variants' `unit_id` ("Only variants' rows are left on the unit"), then deletes the unit, whose
   key would otherwise refuse it.
4. **`pricing_unit` goes.** `products_pricing_unit_ck` goes with it and
   `products_top_level_owns_ck` loses its `pricing_unit` term (tables-menu.md §5). `Product.pricingUnit`
   and `AvailableProduct.pricingUnit` stay in what is returned, computed in `toProduct`
   (`operations.ts:281-310`) and in `listAvailableProducts` as
   `unit.hardwareUnit === null ? "each" : "weight"` (the formula of `legacyPricingUnit`, `:338-340`).
   The same derived value replaces `effective.pricingUnit` in `offerLineColumns` and
   `offerLineValues` (`operations.ts:438-505`, `:453`, `:501`), which build the offers a published
   menu document carries and the till reads. The variant-fallback entry (`variant-fallback.ts:103`) and the column-clearing update
   (`units.ts:250`) go. The legacy input `pricingUnit` on `createProduct`/`updateProduct`
   (`operations.ts:131-133`, `:163-165`, `:1051-1066`, `:1269-1279`) stays: it stores nothing and
   still picks Each or the kg starter unit, so the demo data that sends it
   (`packages/country-es/src/demo/menu.ts`, 45 lines) is unchanged.
5. **Configuration export:** `product_units` leaves `MENU_CONFIGURATION_TRANSFER`
   (`packages/menu/src/configuration-transfer.ts:217`); `products` rows carry `unit_id` and lose
   `pricing_unit`. The bundle format moves on by one (`packages/provisioning/src/configuration-transfer.ts:123`,
   `:160`, `:476`).
6. **Raw SQL in tests** that names `pricing_unit` (hand edits, listed): `packages/db/src/schema/menus.test.ts:60`
   (its `products_pricing_unit_ck` case goes with the CHECK, by design; its VAT-class case keeps its
   assertion without the column), `packages/menu/src/variants.db.test.ts:111` (the stored-variant
   read drops the column). Find others with `git grep -n pricing_unit -- '*.test.ts'`.
7. **Backlog** (rules §9): delete "Two signals say whether a dish is sold by weight" from
   `docs/backlog/architecture.md`'s "What A1308 retires" (`:1250-1253` at `a086eedfb7`) and its
   detail in `docs/backlog/menu.md` (today `catalogue.md:555-566`).

## Decisions this plan makes

- **D1. `pricingUnit` keeps its place in the returned shapes and the document.** The menu document
  carries it (`packages/shared/src/menu-document/menu-types.ts:77`, `:133`), the till reads it
  (`apps/till/src/widgets/product-name.ts:48-82`, `apps/till/src/state/order-line.ts:60-73`), and the
  module seam names it (`packages/module/src/module.ts:431`). Worked out from the unit on every read,
  it can no longer disagree with the unit, which is what the retire item asked for; removing the field
  from those shapes would touch the till and the orders area for no stored-data gain.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `products.menu_id`, the Products screen without a menu, the property-removal script | mn5 |
| `manual_allergens`, `diet`, `name_key`, the ordering CHECK, price and name CHECKs, the photo index | mn6 |
| Removing `pricingUnit` from the menu document, the till and the module seam | not planned (D1) |
| The duplicated legacy-`pricingUnit` fallback and the `EACH_UNIT` literal (`docs/backlog/menu.md`, "Bundle: Each unit literal") | its bundle; this PR keeps the input handling as it is |

## Files

- Schema: `packages/db/src/schema/menus.ts:28-139` (products), `packages/db/src/schema/menu/units.ts:40-61`
  (delete `productUnits`), `packages/db/src/schema/menu/index.ts`, `packages/db/src/index.ts:414`,
  `packages/db/src/classification.ts:296`
- Menu package: `operations.ts`, `units.ts`, `variant-fallback.ts`, `product-editor.ts`, `extras.ts`,
  `extra-projection.ts`, `classification.ts:10`, `configuration-transfer.ts:217`, `index.ts:117`,
  `test/fixtures.ts:28-60`
- Server: `apps/server/src/order-state-counts.ts`, `testing/clear-provision-fixture.ts:60`
- Dashboard: `api/live-queries.ts:21`, `:320`
- Provisioning: `packages/provisioning/src/configuration-transfer.ts` (format)
- Regenerated: `packages/db/drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (foreign keys from `:33`: remove `product_units` rows,
  add `["products", ["unit_id"], "units"]`; CHECKs from `:527`: remove `products_pricing_unit_ck`),
  `scripts/live-subscriptions.test.ts`, `packages/db/src/schema/menu/migrations.test.ts`
- Tests: as each task names; the raw-SQL lines in item 6; the Madrid baseline transform
- Docs: `docs/developers/products.md` (units, "sold by weight"); `docs/backlog/architecture.md`,
  `docs/backlog/menu.md`

## Size

| | Code | Tests |
| --- | --- | --- |
| Schema, unit column, joins, unit writes | 120 | 140 |
| `pricing_unit` derived, offer columns | 40 | 50 |
| Raw-SQL test lines | — | 10 |
| Format, Madrid transform, lists, docs | 35 | 40 |
| **Counted** | **195** | **240** |

About 435 counted lines. Not counted: deletions (`product_units`), generated files. About 2½ hours.

## Finish line

1. `pnpm --filter @waitron/menu exec vitest run src/units.db.test.ts src/units.operations.test.ts src/operations.test.ts src/variant-fallback.test.ts src/product-editor.test.ts src/menu-document.test.ts`
   passes, including "a variant reads its parent's unit, never its own", "deleting a unit clears the
   variants still holding it" and "a published offer's pricingUnit follows its unit".
2. `git grep -n -E "productUnits|product_units|pricing_unit" -- apps packages scripts` prints only the
   captured fixtures (never edited); `pricingUnit` remains only as a returned field or a legacy input.
3. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing table product_units
missing index product_units.primary key(product_id)
missing index product_units_unit_idx
extra index products_unit_idx
missing table products.columns[pricing_unit]
extra table products.columns[unit_id]
changed table products.columnOrder
old: [<mn3's order>]
new: [<without pricing_unit, with unit_id>]
missing table products.checks[products_pricing_unit_ck]
changed table products.checks[products_top_level_owns_ck].expression
old: <… pricing_unit is not null …>
new: <the same without that term>
extra table products.foreignKeys[unit_id->units(id)]
```

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_product_units_delete
missing trigger waitron_change_product_units_insert
missing trigger waitron_change_product_units_update
changed trigger waitron_change_products_update.when
old: <naming pricing_unit>
new: <naming unit_id>
```

Why, from tables-menu.md §5: `products_pricing_unit_ck` "dropped: the column goes"; `product_units`'
unit key and index → "`products.unit_id` FK restrict, index"; its primary key and cascade "not
needed". No hand-written trigger on `products` names `pricing_unit` (read in `packages/db/triggers/core.sql`),
so none changes.

## Stop points (beyond rules §5)

1. A read that used `unitOwnerJoin` returns a different unit for any product or variant in its
   existing tests after the change.
2. `products.unit_id` needs a CHECK or a trigger to keep an existing test green (the design adds none).
3. A published offer's `pricingUnit` differs from before for any product in an existing test.

## Needs

- **Outside this area:** batch 1.
- **In this area:** mn3 (final names).

## Global Constraints

- Rules §1–§9. Core rebuilt with `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- Behaviour tests keep their assertions (rules §4); the `products_pricing_unit_ck` case is deleted
  with its CHECK (by design) and listed in the pull request.
- One transaction per request; queries on one transaction awaited in turn (CLAUDE.md §3).

## Review Focus

1. **A variant's own stored `unit_id` is never read.**
2. **Reassigning or deleting a unit cannot be refused by the new key** when variants still hold it.
3. **The till's `pricingUnit` is unchanged** for every product: it comes from the same formula.

---

### Task 1: The unit column and the joins

**Files:** schema; `variant-fallback.ts`; `units.ts`; the join callers in item 2; tests
`packages/menu/src/units.db.test.ts`, `units.operations.test.ts`, `variant-fallback.test.ts`,
`packages/menu/test/fixtures.ts`.

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases:**
  - `units.db.test.ts` `"a unit in use cannot be deleted by a raw statement"`: a product with
    `unit_id` set; `delete from units where id = ?` is refused (`FOREIGN KEY constraint failed`);
    control: a unit no product names deletes.
  - `"a variant reads its parent's unit, never its own"`: parent with unit kg, variant with a raw
    `unit_id` of litre; `listProducts` and `readProductEditor` report kg for both. Control: the
    parent with no unit reads Each for both, whatever the variant holds.
  - `"reassigning a unit moves products and clears variants"`: two products and one variant on unit
    A; reassign A→B; both products read B; the variant's `unit_id` is null.
  - `"deleting a unit clears the variants still holding it"`: a variant holds A, no product does;
    `deleteUnit(A)` succeeds; the variant's `unit_id` is null.
  - Re-point the fixtures `ownUnitId` and the raw-write helper (`test/fixtures.ts:28-60`) to the
    column; the cases using them keep their assertions.
- [ ] **Step 3: Run; see them fail.**
- [ ] **Step 4: Implement** items 1–3; rebuild core.
- [ ] **Step 5: Run** the files above plus `packages/menu/src/extras.test.ts` and
  `apps/server/src/order-state-counts.test.ts` — PASS. **Commit.**

### Task 2: `pricing_unit` goes

- [ ] **Step 1: Failing cases:**
  - `operations.test.ts` `"still maps the legacy pricing unit"`: `pricingUnit: "weight"` stores the kg
    seed's id in `unit_id`; `pricingUnit: "each"` stores null; both read back their `pricingUnit`.
  - `"works out pricingUnit from the unit"`: a product on a litre unit (no `hardware_unit`) reads
    `"each"`; on kg reads `"weight"`.
  - `menu-document.test.ts` `"a published offer's pricingUnit follows its unit"`: an offer and a
    variant line built through `offerLineValues` carry the derived value.
- [ ] **Step 2:** Implement item 4 and the raw-SQL edits (item 6); rebuild core; run — PASS. **Commit.**

### Task 3: Export, Madrid baseline, guards, docs, finish

- [ ] **Step 1:** Remove `product_units` from the export list; move the bundle format on by one; add
  the refusal row (`apps/server/src/configuration-import.test.ts:204`).
- [ ] **Step 2: Madrid baseline.** A helper `madridWithProductUnits(capture)` with one test: for
  each phase, take the captured `product_units` rows (checked present), write each row's `unit_id`
  into the matching captured `products` row, remove `pricing_unit` from `products`' columns and rows,
  remove the `product_units` table and its phase count, and add `unit_id` to `products`' columns
  where the new schema puts it.
- [ ] **Step 3: Guards**, updated not loosened (Files).
- [ ] **Step 4: Docs and backlog** (item 7).
- [ ] **Step 5:** Finish line; paste the protection-list report, marking each line (rules §3);
  `/finish-branch`; push once.

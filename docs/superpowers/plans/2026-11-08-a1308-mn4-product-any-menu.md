# A1308 menu and photos, PR mn4: a product is one row, and any menu can offer it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Fold `product_units` into `products.unit_id`, drop `products.pricing_unit` (a copy of
"does the unit weigh"), and drop `products.menu_id` (the old `catalogue_id`), so a product belongs to
no menu and any menu can offer it through `menu_items`.

**Architecture:** One schema change to `products` plus the deletion of `product_units`. Reads that
joined `product_units` join `units` on the owning product's `unit_id` (a variant always reads its
parent's, as today). `pricingUnit` stays in what the API and the published menu document return, now
worked out from the unit on every read, so nothing outside the menu package changes shape. Calls that
passed a product's menu lose that field through a committed script driven by the type checker's own
error list. The Products screen stops needing a selected menu.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Hono, Lit, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R1, R6;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.3 ("Dropped columns":
`catalogue_id`, `pricing_unit`; "What `catalogue_id` takes with it"; "Note" on a variant's unit),
§1.4, §5 (rows for `products` and `product_units`), §6; [slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7`, written with the paths and names after
mn1 and mn3 (map in those plans): `packages/menu/src/operations.ts:1108` is today's
`packages/catalogue/src/operations.ts:1108`; `products.menuId` is today's `products.catalogueId`;
`apps/server/src/menu-api.ts` is today's `catalogue-api.ts`; the schema file
`packages/db/src/schema/menus.ts` is today's `schema/catalogue.ts`. Backlog entries are named by their text at `a086eedfb7`; mn3 changed "catalogue" to "menu" in
them, and mn1 moved `docs/backlog/catalogue.md` to `docs/backlog/menu.md`. Batch 1 and mn1–mn3 have
landed. Find a moved line by its identifier; a missing identifier this plan does not explain is a stop
(rules §5.1).

**Who lands:** the lane (rules §6). A sale line copies its unit from the unit, not from
`pricing_unit`: "Since B4 the order path reads only the unit (`priceOrderLines`)"
(`docs/backlog/menu.md`, today `catalogue.md:555-566`), and `apps/server/src/working-order.ts:880` already derives
`pricingUnit` from `selection.unit.hardwareUnit`. Read, not run.

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
   `unit.hardwareUnit === null ? "each" : "weight"` (the formula of `legacyPricingUnit`, `:331-333`).
   The variant-fallback entry (`variant-fallback.ts:103`) and the column-clearing update
   (`units.ts:250`) go. The legacy input `pricingUnit` on `createProduct`/`updateProduct`
   (`operations.ts:131-133`, `:163-165`, `:1051-1066`, `:1269-1279`) stays: it stores nothing and
   still picks Each or the kg starter unit, so the demo data that sends it
   (`packages/country-es/src/demo/menu.ts`, 45 lines) is unchanged.
5. **`products.menu_id` goes**, with `products_id_menu_key`, `products_menu_id_idx` and the
   composite key `(parent_id, menu_id) → products(id, menu_id)`, which becomes a plain self key
   `parent_id → products(id)` `on delete restrict` (tables-menu.md §1.3). Code that named it:
   - `CreateProductInput.menuId` (`operations.ts:125`) goes; `insertProduct`'s menu check
     (`:1050`, `:1073`, `:1093`) goes; `listProducts(tx)` (`:1108-1126`) loses its filter.
   - `saveProductEditor(tx, id, body, language)` loses its menu argument and check
     (`packages/menu/src/product-editor.ts:120`, `:168-188`); `variants.ts:82-90` reads the parent's
     name and Active state only, and `:287` stops naming a menu.
   - Routes (`apps/server/src/menu-api.ts`): `GET /management-api/menus/:id/products` (`:1443-1453`)
     is deleted, because `GET /management-api/products` (`:1380-1385`) already lists every product;
     `POST /management-api/menus/:id/product-editor` (`:1455-1473`) becomes
     `POST /management-api/products/editor`; `POST /management-api/products` (`:1517-1590`) stops
     requiring `menuId` in its body (`:1522`, `:1542-1545`, `:1585`).
   - Dashboard client (`apps/dashboard/src/api/client.ts:3248-3270`): `listProducts()` and
     `createProductEditor(value)` take no menu.
   - Products screen (`apps/dashboard/src/screens/products-screen.ts:100`, `:110`, `:280-288`,
     `:309-316`, `:475`, `:722-760`): `selectedMenuId` goes; the screen shows the product browser
     whether or not a menu exists (decision D1); `products.empty_prompt` and its `data-test="no-menu"`
     go. The Modifiers screen (`apps/dashboard/src/screens/modifiers-screen.ts:190-204`) reads one
     product list instead of merging every menu's.
   - Media's usage list stops returning a product's menu (`packages/media/src/images.ts:200`, the
     `product`/`variant` arms of `ImageUsage`, `:59`, `:69`); no screen reads it (tables-menu.md §1.3).
   - `listAvailableProducts` (`operations.ts:1441-1527`) lists every active, available, top-level
     product ordered by `created_at, id`, without `menuId` or `menuName`. (`listAccessibleCatalogues` is already gone: slice 4a-ii deleted
     it, `2026-11-08-a1308-4a-ii-menu-list-and-venue-receipt.md:14`.)
6. **A committed script** removes the `menuId` property from every object literal the type checker
   now refuses (Task 2), so the about 400 product-creating call sites in tests and fixtures change by
   script, not by hand.
7. **Configuration export:** `product_units` leaves `MENU_CONFIGURATION_TRANSFER`
   (`packages/menu/src/configuration-transfer.ts:217`); `products` rows carry `unit_id` and lose two
   columns. The bundle format moves on by one (`packages/provisioning/src/configuration-transfer.ts:123`,
   `:160`, `:476`).
8. **Backlog** (rules §9): delete "Two signals say whether a dish is sold by weight" and "The catalogue
   picker was deleted and nothing replaced it" from `docs/backlog/architecture.md`'s "What A1308
   retires" (`:1250-1258` at `a086eedfb7`), and the detail at `docs/backlog/menu.md` (today `catalogue.md:555-566`).

## Decisions this plan makes

- **D1. The Products screen no longer needs a menu.** Today it shows "Create a menu on the Menus
  screen before adding products" (`apps/dashboard/src/i18n/strings.ts:1464`) when no menu exists,
  because a product had to be filed under one. With no `menu_id` that reason is gone, so the browser
  shows and a product can be added; the other gates stay (`products-screen.ts:739`: settings loaded,
  a content language, a unit). The owner chose "any menu can offer any product" (tables-menu.md §1.3,
  2026-11-04); this is its direct consequence. The retire item "The catalogue picker was deleted and
  nothing replaced it" asked whether more than one catalogue is supported: products no longer belong
  to one, so there is nothing to pick.
- **D2. `pricingUnit` keeps its place in the returned shapes and the document.** The menu document
  carries it (`packages/shared/src/menu-document/menu-types.ts:77`, `:133`), the till reads it
  (`apps/till/src/widgets/product-name.ts:48-82`, `apps/till/src/state/order-line.ts:60-73`), and the
  module seam names it (`packages/module/src/module.ts:431`). Worked out from the unit on every read,
  it can no longer disagree with the unit, which is what the retire item asked for; removing the field
  from those shapes would touch the till and the orders area for no stored-data gain.
- **D3. `listAvailableProducts` keeps its name and loses the menu grouping.** Its callers are the demo
  seed (`apps/server/scripts/demo-seed/seed.ts:105`) and a test helper
  (`apps/server/src/testing/party-venue.ts:163`); with no menu on a product it lists products, which
  its name already says. Its tests that split the list by `menuName`
  (`apps/server/scripts/demo-seed/seed-menus.test.ts:374`, `seed.integration.test.ts:198-199`, `:244`)
  are re-pointed to "the menus that offer it" through `menu_items`; their counts stay (stop point 2).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `manual_allergens`, `diet`, `name_key`, the ordering CHECK, price and name CHECKs, the photo index | mn5 |
| Removing `pricingUnit` from the menu document, the till and the module seam | not planned (D2) |
| The duplicated legacy-`pricingUnit` fallback and the `EACH_UNIT` literal (`docs/backlog/menu.md`, "Bundle: Each unit literal") | its bundle; the duplication is in input handling this PR keeps as it is |

## Files

- Schema: `packages/db/src/schema/menus.ts:28-139` (products), `packages/db/src/schema/menu/units.ts:40-61`
  (delete `productUnits`), `packages/db/src/schema/menu/index.ts`, `packages/db/src/index.ts:414`,
  `packages/db/src/classification.ts:296`
- Menu package: `operations.ts`, `units.ts`, `variant-fallback.ts`, `product-editor.ts`, `variants.ts`,
  `extras.ts`, `extra-projection.ts`, `classification.ts:10`, `configuration-transfer.ts:217`,
  `index.ts:117`, `test/fixtures.ts:28-60`
- Server: `apps/server/src/menu-api.ts`, `order-state-counts.ts`, `testing/clear-provision-fixture.ts:60`
- Dashboard: `api/client.ts`, `api/live-queries.ts:21`, `:320`, `screens/products-screen.ts`,
  `screens/modifiers-screen.ts`, `i18n/strings.ts` (`products.empty_prompt`, both languages)
- Media: `packages/media/src/images.ts`
- Shared types: `packages/shared/src/menu-document/product-types.ts` (`Product.menuId` goes)
- Provisioning: `packages/provisioning/src/configuration-transfer.ts` (format)
- Create: `scripts/a1308/remove-refused-property.mjs`, `scripts/a1308/remove-refused-property.test.mjs`
- Regenerated: `packages/db/drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (foreign keys from `:33`: remove `product_units` rows,
  the products menu key; add `["products", ["unit_id"], "units"]` and the plain parent key; unique
  indexes from `:377`; CHECKs from `:527`: remove `products_pricing_unit_ck`),
  `scripts/live-subscriptions.test.ts`, `packages/db/src/schema/menu/migrations.test.ts`
- Tests: as each task names; the Madrid baseline transform (Task 5)
- Docs: `docs/developers/products.md` (units, "sold by weight", any sentence about a product's menu),
  `docs/backlog/architecture.md`, `docs/backlog/menu.md`; guides
  `apps/server/src/guide/{en,es}/products.md` only where they tell staff to choose a menu before
  adding a product (find with `grep -n -i -e "menu first" -e "create a menu" apps/server/src/guide/en/products.md`)

## Size

| | Code | Tests |
| --- | --- | --- |
| Schema, unit column, joins, unit writes | 120 | 140 |
| `pricing_unit` derived | 30 | 40 |
| `menu_id` gone: operations, editor, variants, routes, client, screens, media | 140 | 110 |
| Script and its test | 90 | 80 |
| Format, Madrid transform, lists | 40 | 50 |
| **Counted** | **420** | **420** |

About 840 counted lines. Not counted: the script's output (the removed `menuId:` properties,
about 400 lines), deletions (`product_units`, the deleted
route), generated files. About 3 hours.

## Finish line

1. `pnpm --filter @waitron/menu exec vitest run src/units.db.test.ts src/units.operations.test.ts src/operations.test.ts src/variant-fallback.test.ts src/product-editor.test.ts`
   passes, including "a variant reads its parent's unit, never its own" and "deleting a unit clears
   the variants still holding it".
2. `pnpm --filter @waitron/server exec vitest run src/menu-api.test.ts` passes, including "creates a
   product with no menu" and "GET /management-api/menus/:id/products answers 404".
3. `pnpm --filter @waitron/dashboard exec vitest run src/screens/products-screen.test.ts` passes,
   including "offers Add product when no menu exists".
4. `node scripts/a1308/remove-refused-property.mjs --property menuId <tsc output file>` on the
   merged tree removes nothing.
5. `git grep -n -E "productUnits|product_units|pricing_unit|products\\.menuId" -- apps packages scripts`
   prints only the captured fixtures (never edited) and `pricingUnit` as a returned field or a
   legacy input.
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing table product_units
missing index product_units.primary key(product_id)
missing index product_units_unit_idx
missing index products_menu_id_idx
missing index products_id_menu_key
extra index products_unit_idx
missing table products.columns[menu_id]
missing table products.columns[pricing_unit]
extra table products.columns[unit_id]
changed table products.columnOrder
old: [<mn3's order>]
new: [<without menu_id and pricing_unit, with unit_id>]
missing table products.checks[products_pricing_unit_ck]
changed table products.checks[products_top_level_owns_ck].expression
old: <… pricing_unit is not null …>
new: <the same without that term>
missing table products.foreignKeys[menu_id->menus(id)]
missing table products.foreignKeys[parent_id,menu_id->products(id,menu_id)]
extra table products.foreignKeys[parent_id->products(id)]
extra table products.foreignKeys[unit_id->units(id)]
```

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_product_units_delete
missing trigger waitron_change_product_units_insert
missing trigger waitron_change_product_units_update
changed trigger waitron_change_products_update.when
old: <naming menu_id and pricing_unit>
new: <naming unit_id>
```

Why, from tables-menu.md §5: `products_pricing_unit_ck` "dropped: the column goes";
`products_id_catalogue_key`, the key to the menu and its index "dropped: the column goes (owner,
2026-11-04)"; "parent composite FK → a plain self FK, RESTRICT"; `product_units`' unit key and index
→ "`products.unit_id` FK restrict, index"; its primary key and cascade "not needed". The hand-written
triggers on `products` (`products_variant_*`, `products_id_fixed_update`, the four media triggers)
name neither dropped column (read in `packages/db/triggers/core.sql`), so none changes.

## Stop points (beyond rules §5)

1. A read that used `unitOwnerJoin` returns a different unit for any product or variant in its
   existing tests after the change.
2. A demo-seed test re-pointed from `menuName` to "menus that offer it" gets a different count:
   some product is offered by two menus or none, so the old split by filing menu and the new split
   by offering menu differ. Ask; do not change the expected count.
3. `products.unit_id` needs a CHECK or a trigger to keep an existing test green (the design adds
   none).
4. The type-error list holds a refused `menuId` on an object that is not a product's input (for
   example a till offer, whose `menuId` is the offer's menu and stays). The script must leave it;
   if the type checker refuses it, the type was narrowed wrongly.

## Needs

- **Outside this area:** batch 1 (slice 4a-ii re-scoped `listAvailableProducts` and deleted `listAccessibleCatalogues`
  to every active menu; slice 5's default flag is untouched here).
- **In this area:** mn3 (final names).

## Global Constraints

- Rules §1–§9. Core rebuilt with `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- Behaviour tests keep their assertions (rules §4); a removed field (`menuId` on a product,
  `menuName` on an available product) leaving an expected object does not count as a changed
  assertion; any other changed expected value is a stop.
- One transaction per request; queries on one transaction awaited in turn (CLAUDE.md §3).

## Review Focus

1. **A variant's own stored `unit_id` is never read.** Pinned by "a variant reads its parent's unit,
   never its own".
2. **Reassigning or deleting a unit cannot be refused by the new key** when variants still hold it.
3. **The script removed only product inputs' `menuId`.** The reviewer re-runs it (Finish line 4) and
   reads its output list.

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
- [ ] **Step 5: Run** the files above plus `packages/menu/src/extras.test.ts`,
  `apps/server/src/order-state-counts.test.ts` (if present; else the tests that import it) — PASS.
  **Commit.**

### Task 2: The property-removal script, then `menu_id` and `pricing_unit` go

**Files:** create `scripts/a1308/remove-refused-property.mjs` and its test; schema; `operations.ts`;
`product-editor.ts`; `variants.ts`; `shared/.../product-types.ts`; tests named below.

**Interfaces:**

```js
/** Parses type-checker output (both `file(line,col): error TS2353: …` and
 *  `file:line:col - error TS2353: …` forms) and returns each refusal of `property`. */
export function refusals(output: string, property: string): { file: string; line: number; column: number }[];
/** Removes the property assignment or shorthand starting at each position, with its trailing comma
 *  and the line if the line held nothing else. Positions are 1-based, as the checker prints them. */
export function removeAt(text: string, positions: { line: number; column: number }[], property: string): string;
export function run(options: { root: string; property: string; outputFile: string }): { removed: number };
```

The message it matches: `Object literal may only specify known properties, and '<property>' does not exist in type`.
A position whose text does not start with `<property>` (or `"<property>"`) is refused with an error
naming it; nothing is written for that file.

- [ ] **Step 1: Script tests** (pure strings, plus one throwaway-folder `run`):
  `"removes a property on its own line"`, `"removes a shorthand property and its comma"`,
  `"removes a property in the middle of a one-line object"`, `"refuses a position that does not name
  the property"`, `"parses both output forms"`, `"is idempotent: an empty error list removes nothing"`.
  Run — FAIL; implement; run — PASS (root coverage covers it, `vitest.config.ts:119`). **Commit.**
- [ ] **Step 2: Failing behaviour cases:**
  - `operations.test.ts` `"creates a product with no menu"`: `createProduct(tx, { categoryId: null, name: "Tea", unitId: null, unitPrice: "2.00", vatClass: "general" })`
    succeeds; `listProducts(tx)` lists it.
  - `"still maps the legacy pricing unit"`: `pricingUnit: "weight"` stores the kg seed's id in
    `unit_id`; `pricingUnit: "each"` stores null; both read back their `pricingUnit`.
  - `"works out pricingUnit from the unit"`: a product on a litre unit (no `hardware_unit`) reads
    `"each"`; on kg reads `"weight"` (the formula of `legacyPricingUnit`).
  - `product-editor.test.ts` `"saves a new product through the editor with no menu"`.
  - `apps/server/src/menu-api.test.ts` `"creates a product with no menu"` (POST `/management-api/products/editor`
    → 201), `"GET /management-api/menus/:id/products answers 404"`.
  - `variants.db.test.ts`: variants created under a parent with no menu keep their existing assertions.
- [ ] **Step 3: Implement** items 4 and 5 (schema, operations, editor, variants, shared type, routes);
  rebuild core.
- [ ] **Step 4: Run the script:** for each package, `pnpm --filter <pkg> typecheck > <scratch>/<pkg>.txt 2>&1`
  (`@waitron/menu`, `@waitron/server`, `@waitron/venue-service`, `@waitron/media`, `@waitron/reporting`,
  `@waitron/provisioning`, `@waitron/fiscal-verifactu`, `@waitron/composition`, `@waitron/dashboard`),
  then `node scripts/a1308/remove-refused-property.mjs --property menuId <scratch>/<pkg>.txt` for each.
  Re-run the type checks until each passes; fix by hand (listed) only what is not an object literal:
  a variable now unused, a spread helper that forwarded `menuId`.
- [ ] **Step 5: Run** the Task 2 files — PASS. **Commit** the script's output separately from the
  hand edits.

### Task 3: The dashboard and media

**Files:** `apps/dashboard/src/api/client.ts`, `screens/products-screen.ts`, `screens/modifiers-screen.ts`,
`i18n/strings.ts`, `api/live-queries.ts`; `packages/media/src/images.ts`; their tests.

- [ ] **Step 1: Failing cases:**
  - `products-screen.test.ts` `"offers Add product when no menu exists"`: with `listMenus` empty,
    settings, one language and one unit loaded, the browser renders and `canAddProduct` is true;
    `[data-test="no-menu"]` is absent.
  - `"creates a product without naming a menu"`: the screen calls `createProductEditor(value)` with
    one argument.
  - `modifiers-screen.test.ts`: the existing "lists every menu's products" case keeps its expected
    list, now from one `listProducts()` call.
  - `packages/media/src/images.test.ts`: the usage-list cases keep their assertions minus the removed
    `menuId` field.
- [ ] **Step 2–4:** Run (fail), implement, run (pass). Remove `products.empty_prompt` from both
  languages and the live-query entries for `product_units`. **Commit.**

### Task 4: `listAvailableProducts` and the demo seed

**Files:** `operations.ts:1441-1527`; demo-seed tests named in D3.

- [ ] **Step 1:** `listAvailableProducts` without the menu join and fields, ordered by
  `products.created_at, products.id`. Its existing cases keep their expected products (order may
  change only where two menus' products interleaved; a changed order is a stop unless the case
  compared as a set).
- [ ] **Step 2:** Re-point the demo-seed splits (D3) to `menu_items` membership; counts unchanged
  (stop point 2).
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/` — PASS. **Commit.**

### Task 5: Export, Madrid baseline, guards, docs, finish

- [ ] **Step 1:** Remove `product_units` from the export list; move the bundle format on by one; add
  the refusal row (`apps/server/src/configuration-import.test.ts:204`).
- [ ] **Step 2: Madrid baseline.** In `seed.madrid-baseline.test.ts`, for each phase: take the
  captured `product_units` rows (checked present), write each row's `unit_id` into the matching
  captured `products` row, remove `pricing_unit` and `menu_id` from `products`' columns, rows and
  keys, remove the `product_units` table and its phase count, and add `unit_id` to `products`'
  columns where the new schema puts it. A helper `madridWithProductUnits(capture)` with one test.
- [ ] **Step 3: Guards**, updated not loosened: `scripts/schema-constraints.test.ts`,
  `scripts/live-subscriptions.test.ts`, `packages/db/src/schema/menu/migrations.test.ts`.
- [ ] **Step 4: Docs and backlog** (item 8 and the Files list).
- [ ] **Step 5:** Finish line 1–6; paste the protection-list report, marking each line (rules §3);
  `/finish-branch`; push once.

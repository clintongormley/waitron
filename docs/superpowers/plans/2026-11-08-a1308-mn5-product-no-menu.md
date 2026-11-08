# A1308 menu and photos, PR mn5: a product belongs to no menu, and any menu can offer it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Drop `products.menu_id` (the old `catalogue_id`), so a product belongs to no menu and any
menu offers it through `menu_items`; the Products screen stops needing a menu; the about 400 test and
fixture call sites that passed a product's menu lose that field by a committed script.

**Architecture:** One column and its two keys and index leave `products`. The script reads the type
checker's own error list (each object literal that names `menuId` where a product input no longer has
it) and removes exactly those properties, so the change is reproducible and the reviewer can re-run
it. Its output is counted against the size cap: rules §1 exempts only a rename script's output, and
this is not a rename (watcher, 2026-11-08).

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Hono, Lit, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R6;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.3 ("Dropped columns":
`catalogue_id`; "What `catalogue_id` takes with it"), §5 (the `products` rows naming the menu key);
[slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7`, written with the paths and names after
mn1 and mn3 (map in those plans): `packages/menu/src/operations.ts:1108` is today's
`packages/catalogue/src/operations.ts:1108`; `products.menuId` is today's `products.catalogueId`;
`apps/server/src/menu-api.ts` is today's `catalogue-api.ts`; the schema file
`packages/db/src/schema/menus.ts` is today's `schema/catalogue.ts`. Backlog entries are named by their text at `a086eedfb7`; mn3 changed "catalogue" to "menu" in
them, and moved `docs/backlog/catalogue.md` to `docs/backlog/menu.md`. Batch 1 and mn1–mn4 have
landed. Find a moved line by its identifier; a missing identifier this plan does not explain is a stop
(rules §5.1).

**Who lands:** the lane (rules §6). Which menu a product was filed under reaches no sale: a sale
line is priced from the offer's menu (`menu_items`), and the till's `menuId` is that offer's menu
(`apps/till/src/api/client.ts:352`, `:484`), which this PR does not touch. Read, not run.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **`products.menu_id` goes**, with `products_id_menu_key`, `products_menu_id_idx` and the
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
     `product`/`variant` arms of `ImageUsage`, `:67`, `:77`); no screen reads it (tables-menu.md §1.3).
   - `listAvailableProducts` (`operations.ts:1441-1527`) lists every active, available, top-level
     product ordered by `created_at, id`, without `menuId` or `menuName`. (`listAccessibleCatalogues` is already gone: slice 4a-ii deleted
     it, `2026-11-08-a1308-4a-ii-menu-list-and-venue-receipt.md:14`.)
2. **The script** `scripts/a1308/remove-refused-property.mjs` (Task 2) removes the `menuId` property
   from every object literal the type checker refuses once `CreateProductInput.menuId` is gone.
3. **Raw SQL in tests** that names `menu_id` on `products` (after mn3's rename of `catalogue_id`;
   hand edits, listed): `scripts/behavioural-triggers.test.ts:1546` and `:1693` (inserts that set
   it), `packages/menu/src/variants.db.test.ts:111` (a read that selects it),
   `packages/db/src/schema/menus.test.ts:60` (an insert that sets it), `apps/server/src/kitchen.test.ts:673-678`
   (reads a parent's menu to give a variant the same one: the read and the field go). Find others with
   `git grep -n -E "products.*menu_id|menu_id.*products" -- '*.test.ts'`.
4. **Configuration export:** `products` rows lose `menu_id`; the bundle format moves on by one.
5. **Backlog** (rules §9): delete "The catalogue picker was deleted and nothing replaced it" from
   `docs/backlog/architecture.md`'s "What A1308 retires" (`:1254-1258` at `a086eedfb7`).

## Decisions this plan makes

- **D1. The Products screen no longer needs a menu.** Today it shows "Create a menu on the Menus
  screen before adding products" (`apps/dashboard/src/i18n/strings.ts:1464`) when no menu exists,
  because a product had to be filed under one. With no `menu_id` that reason is gone, so the browser
  shows and a product can be added; the other gates stay (`products-screen.ts:739`: settings loaded,
  a content language, a unit). The owner chose "any menu can offer any product" (tables-menu.md §1.3,
  2026-11-04); this is its direct consequence. The retire item "The catalogue picker was deleted and
  nothing replaced it" asked whether more than one catalogue is supported: products no longer belong
  to one, so there is nothing to pick.
- **D2. `listAvailableProducts` keeps its name and loses the menu grouping.** Its callers are the demo
  seed (`apps/server/scripts/demo-seed/seed.ts:105`) and a test helper
  (`apps/server/src/testing/party-venue.ts:163`); with no menu on a product it lists products, which
  its name already says. Its tests that split the list by `menuName`
  (`apps/server/scripts/demo-seed/seed-menus.test.ts:374`, `seed.integration.test.ts:198-199`, `:244`)
  are re-pointed to "the menus that offer it" through `menu_items`; their counts stay (stop point 1).


## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `manual_allergens`, `diet`, `name_key`, the CHECKs, the photo index | mn6 |

## Files

- Schema: `packages/db/src/schema/menus.ts` (products)
- Menu package: `operations.ts`, `product-editor.ts`, `variants.ts`, `index.ts`
- Server: `apps/server/src/menu-api.ts`
- Dashboard: `api/client.ts`, `screens/products-screen.ts`, `screens/modifiers-screen.ts`,
  `i18n/strings.ts` (`products.empty_prompt`, both languages)
- Media: `packages/media/src/images.ts`
- Shared types: `packages/shared/src/menu-document/product-types.ts` (`Product.menuId` goes)
- Provisioning: `packages/provisioning/src/configuration-transfer.ts` (format)
- Create: `scripts/a1308/remove-refused-property.mjs`, `scripts/a1308/remove-refused-property.test.mjs`
- Regenerated: `packages/db/drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (foreign keys from `:33`: remove the products menu key
  and the composite parent key; add the plain parent key; unique indexes from `:377`: remove
  `products_id_menu_key`), `packages/db/src/schema/menu/migrations.test.ts`
- Tests: the script's output (about 400 lines); the raw-SQL lines in item 3; the demo-seed tests in D2;
  the Madrid baseline
- Docs: `docs/developers/products.md` (any sentence about a product's menu); guides
  `apps/server/src/guide/{en,es}/products.md` only where they tell staff to choose a menu before
  adding a product (find with `grep -n -i -e "menu first" -e "create a menu" apps/server/src/guide/en/products.md`);
  `docs/backlog/architecture.md`

## Size

| | Code | Tests |
| --- | --- | --- |
| `menu_id` gone: operations, editor, variants, routes, client, screens, media, `listAvailableProducts` | 150 | 120 |
| Script and its test | 90 | 80 |
| Script output (removed `menuId:` properties; counted, see Architecture) | — | about 400 |
| Raw-SQL lines, demo-seed re-point | — | 40 |
| Format, Madrid transform | 20 | 20 |
| **Counted** | **260** | **660** |

About 920 counted lines, inside the cap of about 1,000; most of it is the script's one-line removals.
Not counted: deletions (the deleted route, the empty-prompt string), generated files. About 3 hours.
If the script's real output exceeds about 500 lines, stop (rules §5.6) and ask whether to move the
test-file part of the output into a follow-up pull request.

## Finish line

1. `pnpm --filter @waitron/menu exec vitest run src/operations.test.ts src/product-editor.test.ts src/variants.db.test.ts`
   passes, including "creates a product with no menu".
2. `pnpm --filter @waitron/server exec vitest run src/menu-api.test.ts src/kitchen.test.ts` passes,
   including "creates a product with no menu" and "GET /management-api/menus/:id/products answers 404".
3. `pnpm --filter @waitron/dashboard exec vitest run src/screens/products-screen.test.ts` passes,
   including "offers Add product when no menu exists".
4. `node scripts/a1308/remove-refused-property.mjs --property menuId <tsc output file>` on the merged
   tree removes nothing.
5. `git grep -n -E "products\.menuId|products_id_menu_key|products_menu_id_idx" -- apps packages scripts`
   prints only the captured fixtures.
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing index products_menu_id_idx
missing index products_id_menu_key
missing table products.columns[menu_id]
changed table products.columnOrder
old: [<mn4's order>]
new: [<without menu_id>]
missing table products.foreignKeys[menu_id->menus(id)]
missing table products.foreignKeys[parent_id,menu_id->products(id,menu_id)]
extra table products.foreignKeys[parent_id->products(id)]
```

In the two `change-feed` entries, also:

```text
changed trigger waitron_change_products_update.when
old: <naming menu_id>
new: <without it>
```

Why, from tables-menu.md §5: `products_id_catalogue_key`, the key to the menu and its index "dropped:
the column goes (owner, 2026-11-04)"; "parent composite FK → a plain self FK, RESTRICT". No
hand-written trigger names the column (tables-menu.md §1.3; read in `packages/db/triggers/core.sql`).

## Stop points (beyond rules §5)

1. A demo-seed test re-pointed from `menuName` to "menus that offer it" gets a different count: some
   product is offered by two menus or none. Ask; do not change the expected count.
2. The type-error list holds a refused `menuId` on an object that is not a product's input (for
   example a till offer, whose `menuId` is the offer's menu and stays). The script must leave it;
   if the type checker refuses it, the type was narrowed wrongly.
3. The script's output passes about 500 lines (Size).

## Needs

- **Outside this area:** batch 1 (slice 4a-ii re-scoped `listAvailableProducts` to every active menu
  and deleted `listAccessibleCatalogues`).
- **In this area:** mn4.

## Global Constraints

- Rules §1–§9. Core rebuilt with `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- Behaviour tests keep their assertions (rules §4); a removed field (`menuId` on a product,
  `menuName` on an available product) leaving an expected object does not count as a changed
  assertion; any other changed expected value is a stop.

## Review Focus

1. **The script removed only product inputs' `menuId`.** The reviewer re-runs it (Finish line 4) and
   reads its output list.
2. **No sale or till read changes**: the offer's menu is untouched.
3. **The Products screen with no menu** behaves as D1 says.

---

### Task 1: The property-removal script

**Files:** create `scripts/a1308/remove-refused-property.mjs` and its test.

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

### Task 2: `menu_id` goes

**Files:** schema; `operations.ts`; `product-editor.ts`; `variants.ts`; `shared/.../product-types.ts`;
`menu-api.ts`; tests named below.

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing behaviour cases:**
  - `operations.test.ts` `"creates a product with no menu"`: `createProduct(tx, { categoryId: null, name: "Tea", unitId: null, unitPrice: "2.00", vatClass: "general" })`
    succeeds; `listProducts(tx)` lists it.
  - `product-editor.test.ts` `"saves a new product through the editor with no menu"`.
  - `apps/server/src/menu-api.test.ts` `"creates a product with no menu"` (POST `/management-api/products/editor`
    → 201), `"GET /management-api/menus/:id/products answers 404"`.
  - `variants.db.test.ts`: variants created under a parent with no menu keep their existing assertions.
- [ ] **Step 3: Implement** item 1's schema, operations, editor, variants, shared type and routes;
  rebuild core.
- [ ] **Step 4: Run the script:** for each package, `pnpm --filter <pkg> typecheck > <scratch>/<pkg>.txt 2>&1`
  (`@waitron/menu`, `@waitron/server`, `@waitron/venue-service`, `@waitron/media`, `@waitron/reporting`,
  `@waitron/provisioning`, `@waitron/fiscal-verifactu`, `@waitron/composition`, `@waitron/dashboard`),
  then `node scripts/a1308/remove-refused-property.mjs --property menuId <scratch>/<pkg>.txt` for each.
  Re-run the type checks until each passes; fix by hand (listed) only what is not an object literal:
  a variable now unused, a spread helper that forwarded `menuId`, and the raw SQL of item 3.
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

**Files:** `operations.ts:1441-1527`; demo-seed tests named in D2.

- [ ] **Step 1:** `listAvailableProducts` without the menu join and fields, ordered by
  `products.created_at, products.id`. Its existing cases keep their expected products (order may
  change only where two menus' products interleaved; a changed order is a stop unless the case
  compared as a set).
- [ ] **Step 2:** Re-point the demo-seed splits (D2) to `menu_items` membership; counts unchanged
  (stop point 1).
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/` — PASS. **Commit.**

### Task 5: Export, Madrid baseline, guards, docs, finish

- [ ] **Step 1:** Bundle format on by one; refusal row at `apps/server/src/configuration-import.test.ts:204`.
- [ ] **Step 2: Madrid baseline:** remove `menu_id` (mn3's rename of `catalogue_id`) from the captured
  `products` columns, rows and keys; extend mn4's helper or add one, with a test.
- [ ] **Step 3: Guards** (Files); docs and backlog (item 5).
- [ ] **Step 4:** Finish line; paste the protection-list report, marking each line (rules §3);
  `/finish-branch`; push once.

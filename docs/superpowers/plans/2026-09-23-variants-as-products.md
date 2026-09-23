# Variants as products — Branch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold variants into `products`: a variant becomes a product row with a `parent_id`, reads
any field it leaves empty from its parent, is published on a menu through its own `menu_items` row,
and is recorded on an open order as the product that was actually sold — then remove
`product_variants` and `menu_item_variants`.

**Architecture:** One self-reference on `products` plus one read rule ("an empty field on a variant
reads as its parent's value"), applied in ONE place (`packages/catalogue/src/variant-fallback.ts`)
that every reader of a product's effective values goes through. The editor's variant list, the
menu publication route and the till's wire shape keep their current shapes for as long as possible,
so storage moves first (Task 2) with no screen changing, and each later task changes one surface.

**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`), Hono
routes, Lit web components (dashboard + till), Vitest (`useVenueDb` real SQLite databases; browser
mode for the front-ends).

**Spec:** `docs/superpowers/specs/2026-09-18-one-product-model-design.md` — read §0, §1.2, §4, §6,
§7, §8, §9 and §12–§14 before any task. This plan implements **branch 2 only**; branch 1
(extras + options) is landed (the thirteen tasks of
`docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`, ending #480).

---

## What changed since the spec was written (read before Task 1)

The spec was written on 2026-09-18, before branch 1 and the SQLite switch landed. Measured on
`main` at `d0ff14157` (2026-09-23):

- **The engine is SQLite.** There is no PL/pgSQL. The variant-locales rule the spec says branch 2
  waits for (§4.3, decision 12) already exists in SQLite form as
  `working_order_lines_check_variant_locales_insert` / `_update` in
  `packages/db/drizzle/0001_behavioural_triggers.sql` (refusal text `VARIANT_LOCALES_REFUSAL`,
  `packages/db/src/trigger-refusals.ts`), guarded by `scripts/behavioural-triggers.test.ts`. It reads
  `working_order_lines.variant_descriptions` only, so it keeps working unchanged: this plan keeps that
  column. **Nothing in this branch needs a trigger rewritten for the engine.**
- **Each migration set is ONE regenerated baseline** (core: `0000_baseline.sql` + the hand-written
  `0001_behavioural_triggers.sql`; catalogue: `0000_baseline.sql` only). This branch adds the first
  migrations since the switch.
- **`sold_alone` is stored but nothing on the till or the menu read enforces it**
  (`packages/db/src/schema/catalogue.ts:82-85` says "a later slice"). `listMenuOffers` and
  `listAvailableProducts` filter on `active` only. This branch is where the menu/till use of it
  arrives (spec §4.1, decision 10).
- **`product.variant_required` fires when the product has ANY `product_variants` row**, published
  or not (`packages/catalogue/src/variants.ts:263-264`).
- **Variants are sellable only on the menu-offer path** (an order with a service zone). The plain
  `productId` path refuses a `variantId` with `management.request_invalid`
  (`apps/server/src/working-order.ts:381-383`) and never reads variants. This plan keeps that.
- **`working_order_lines.product_id` is always the PARENT today**, and the chosen variant sits in a
  separate `variant_id` column with no foreign key. **`sale_lines` carries `variant_id` too**, a
  catalogue id on the filed record — which decision 11 says a filed line never holds.
- **No variant data reaches the fiscal hash.** `backend.recordSale` receives header fields only
  (`packages/core/src/record-sale.ts:351-370`); the golden huella gate is
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts`,
  `describe("the extras/options rework leaves the fiscal fingerprint byte-identical")`, pinning
  `C43623FCC6F00D21DD31D4BABBDBA1A1FD05D466B84677C2F46594C31ED8536A` / `14.41` / `2.31`.
- **The per-menu variant publishing screen is not in `apps/dashboard`**: it is
  `packages/venue-service/src/dashboard/venue-operations-screen.ts:854-1027`, calling
  `PUT /management-api/catalogues/:id/items/:itemId/variants`.
- **The inheritance-hint pattern already exists**: `apps/dashboard/src/widgets/extra-list-form.ts`
  (`#inheritedPrice`, a `placeholder` on `wt-input`) and `form-fields.ts`'s `textField` /
  `optionalTextFields` `placeholder` parameter. `wt-price-input` has NO `placeholder` property, and
  nothing does the hint on a `<select>`.
- **Stale pointers to fix on touch:** `packages/db/src/schema/sales.ts:230` and spec §4.3 name
  `packages/db/drizzle/0031_variant_descriptions_locales_sql.sql`, which no longer exists.

## Task 1 cannot upgrade an existing venue — every one is wiped

Measured 2026-09-23 by the plan review, against a scratch copy of `packages/db` through the
product's own `applyMigrations`: migrating a venue that `main` had already migrated, with Task 1's
migrations, ABORTS at the table rename with
`error in trigger products_media_image_fk_parent_delete: no such table: main.products`; and on a
database without the media triggers, the rebuild's `DROP TABLE products` cascade-deletes the rows of
`product_categories` (and would do the same to `product_units` and `product_modifiers`). A fresh
database migrates cleanly. So after Task 1 lands:

- **every dev venue needs `wa-wt reset demo <name>`** (until then its boot fails with a raw driver
  error), and
- **no provisioned box may take this image without a wipe** — the owner's home box included.

This is within CLAUDE.md §3's "no data-migration code until production" rule, and it is stated here
so nobody discovers it by bricking a box. Task 1's PR, and the `docs/backlog.md` line it lands with,
say it in those words. Task 3 does not add a second wipe: its column drops are `ALTER TABLE … DROP
COLUMN`, measured to keep the rows and the append-only triggers.

## Decisions this plan takes where the spec is silent (owner: veto any before Task 1 starts)

Each is marked in the task that implements it. They are the plan's, not the brainstorm's.

- **D1 — The till tile rule.** Spec §4.1's first sentence ("the grid shows products that are
  `sold_alone` and have no parent") contradicts its own third ("a parent with `sold_alone = false`
  is today's rule exactly — the diner must pick a variant"), which needs a tile. The plan reads it
  as: **a tile for every offer whose product has no parent AND (is `sold_alone` OR has at least one
  available published variant)**.
- **D2 — Selling a non-sold-alone product with no variants** through its menu offer is refused with
  `product.unavailable` (not `product.variant_required`, which would name a variant that does not
  exist). A parent with `sold_alone = false` and variants, sold without one, is refused with
  `product.variant_required` (spec decision 10).
- **D3 — The till's wire shape stays `{ menuItemId, variantId }`.** `variantId` now names the
  variant's product id. The variant's own `menu_items` row carries its price and availability; the
  till does not need to send that row's id. Keeps the till change to the picker only.
- **D4 — `working_order_lines.variant_id` and `sale_lines.variant_id` are dropped.** On the open
  order, `product_id` IS the chosen row (spec §4.3), so `variant_id` would only repeat it; on the
  filed sale, a catalogue id breaks decision 11. The three frozen variant NAME columns stay on both
  tables (spec §4.3), so receipts, tickets and reports are untouched.
- **D5 — A variant's position among its siblings** needs a column the spec did not name: the
  editor's variant table reorders, and `product_variants.display_order` held it. `products` gains
  `variant_order` (a count, default 0), meaningful only when `parent_id` is set.
- **D6 — A variant's parent is fixed at creation** and must be in the same catalogue. Moving a
  variant to another parent, or detaching it, is refused: a detached variant would have to acquire
  every inherited value at once, and nothing needs that yet.
- **D7 — Removing a variant from the editor deletes its product row when nothing references it,
  and is refused with `product.variant_in_use` when anything does** — a menu row (as today), an
  open-order line, a recipe line, a preparation route, or an extras list or its per-menu row. The
  check covers EVERY foreign key that names `products` (grep the three `0000_baseline.sql` files
  for `REFERENCES \`products\``), so no removal ever surfaces a raw engine refusal (errcode 787
  for a "no action" key, 1811 for a "restrict" one, measured 2026-09-23). A variant on an open
  order cannot be removed while that order line exists; filed sale lines hold no product id, so
  a filed sale never blocks a removal.
- **D8 — `product.variant_count_invalid` (refusing exactly one variant) is retired, left
  registered and unthrown.** Decision 10 makes one variant meaningful ("Coffee" €1.50 plus "Large"
  €2.00), so the editor stops inventing a "Regular" variant on the first Add.
- **D9 — Image follows the same rule as every other field**: a variant with no photo shows its
  parent's. The spec lists `image` as "normally the variant's own"; the one-sentence rule (§1.2)
  says any null reads as the parent's, and this plan follows the rule. The media usage scan
  (§9.2) counts only the column a row actually holds.
- **D10 — Unpublishing a variant from a menu DELETES its `menu_items` row; marking it unavailable
  keeps the row with `active = false`.** Nothing else names a variant's own menu row: under D3 a
  line context records the PARENT's menu item (`apps/server/src/working-order.ts:282, 617`), and
  an extras list cannot be published on a variant's row, because the carries-this-list check in
  `packages/catalogue/src/extras.ts` refuses a product that carries no lists — and a variant
  carries none (spec §4.4). Deleting keeps D7 honest: a variant shown as unpublished is never
  blocked from removal by a row nobody can see. Task 2 pins that the delete succeeds.
- **D11 — `listProductVariantsForProducts` is deleted in Task 3** (spec §4.5, §8), once the order
  path decides everything from the offer; `listProductVariants` stays for the editor.
- **D12 — A variant's presentation on a menu follows its PARENT's row.** The variant's own
  `menu_items` row carries its price and availability; its `section_id` and `display_order` are
  set from the parent's row when it is created (they are `NOT NULL`) and are never read — the offer
  read nests variants under the parent, so a parent moved to another section takes its variants
  with it. Variants are ordered by `variant_order` everywhere; the per-menu variant order that
  `menu_item_variants.display_order` held is given up (nothing but that column used it).
- **Two overrides this model cannot express, stated so nobody assumes them:** a variant with an
  EMPTY category set, and a variant with NO unit, both read as "inherit" — no `product_categories`
  or `product_units` row is how inheritance is stored.

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** §1 (writing claims), §2 (the gate), §3 (conventions), §4 (testing)
  and §5 (fiscal invariants) apply to every task.
- **Worktree, never `main`.** Each task is its own branch and worktree, created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/variants-<slug>` (the slug is in each
  task's heading). One pull request per task, landed before the next task starts — each task
  depends on the one before.
- **Every commit needs `git commit -s`.** Plain English in commit messages and PR text; exact file,
  function and error-code names appear once as pointers; a command that was run goes in verbatim.
- **TDD, always.** Failing test first, watched failing for the right reason, then the minimal code.
  Fixtures give three DIFFERENT texts for the three names and different values for parent and
  variant, so a reader of the wrong one fails (CLAUDE.md §3, products.md).
- **Test databases come from `useVenueDb`** (`@waitron/db/testing/venue-db.js`) with the migration
  sets the suite needs. Rejected writes assert the domain error CODE, never
  `toBeInstanceOf(Error)`.
- **No backwards-compatibility or data-migration code** (CLAUDE.md §3). Schema changes drop and
  recreate. A migration-number collision on rebase is fixed by REGENERATION, never by
  hand-editing snapshots or `_journal.json`; then re-run `scripts/schema-constraints.test.ts`,
  `scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts` and
  `inmutabilidad`.
- **Every constraint that can be declared in TypeScript is declared there** (CLAUDE.md §3), so
  `drizzle-kit generate` carries it. Only what TypeScript cannot express (a trigger) goes in a
  `--custom` migration, with its refusal text in `packages/db/src/trigger-refusals.ts` and its
  behaviour pinned in `scripts/behavioural-triggers.test.ts` — a refusing case AND an accepting
  control for each.
- **Engine neutrality holds** (spec §7, guard `scripts/catalogue-engine-neutral.test.ts`): no
  advisory lock, no JSON containment, no new enum type. New columns use the shared vocabulary in
  `packages/db/src/schema/columns.ts` (`id`, `flag`, `count`, `money`, `label`, `json`).
- **Error codes name the domain concept** and are never renamed. Reuse the existing `product.*`
  variant family (`packages/catalogue/src/errors.ts:76-98`); retired codes stay registered,
  unthrown. A new code is registered with English and Spanish alert wording where
  `scripts/alert-codes.test.ts` requires it, and mapped to an HTTP status explicitly in the route's
  `STATUS` map (an unmapped code silently becomes 400).
- **The fiscal fingerprint is unrecoverable** (CLAUDE.md §5). The golden huella test named above
  must pass UNEDITED in every task. If it cannot, that is a real regression: STOP, do not edit the
  golden literals, record it and mark the task blocked.
- **The gate per task:** focused behavioural tests while implementing, then `/finish-branch`, which
  lets the pre-push hook run the local checks once and watches CI. No whole-workspace local run
  just to finish (CLAUDE.md §2). Every task touches a risk trigger (a migration, a cross-package
  contract, or the sale path), so every task takes the FULL review wave.
- **Every new or changed screen follows `docs/developers/design-system.md` → Forms**, uses `wt-*`
  primitives and `--wt-*` tokens only, styles `wt-data-table` cells with `part=`/`::part()`, and is
  opened and LOOKED at in both themes and at phone width before the PR (CLAUDE.md §4).
- **Update `docs/backlog.md` in the same change that makes it stale**, and
  `docs/developers/products.md` where a task changes what it describes.

## Review Focus

Inputs and conditions the spec implies but no spec section tests, most likely to bite first. Each
has its test in the named task.

1. **A variant sold with its VAT inherited is taxed at the PARENT's rate, and one with its own VAT
   at its own** — a wrong VAT on a filed invoice is unrepairable. Fixture: parent `reduced`,
   variant A empty, variant B `general`; the sale's `vatBreakdown` shows A at 10% and B at 21%.
   (Task 1 for the reads, Task 2 for the offer carrying each variant's effective values, Task 3 end
   to end through a filed sale.)
2. **A variant line reaches the kitchen exactly as its parent would** — the parent's station
   (through the product's and then the category's route), the parent's course, the parent's
   allergens on the kitchen screen, and the preparation routes keyed on the parent — once Task 3
   records the variant itself as the line's product. Every one of those readers keys on
   `working_order_lines.product_id` and reads columns that were ALREADY nullable, so the compiler
   flags none of them. (Task 3.)
3. **A variant whose parent is deactivated, unpublished from the menu, or on a different menu is
   never offered** — not on the till, not through the API, and never as a product in its own right
   on the plain product list (`listAvailableProducts`, `/api/products`), which would otherwise sell
   it with its name frozen as a parent's. (Tasks 1 and 2.)
4. **Removing a variant that an open order, a menu or an extras list still names is refused with
   `product.variant_in_use`, and leaves every row untouched** — not a raw foreign-key error
   answering 500. (Task 2.)
5. **The top-sellers roll-up adds money and quantities exactly** — a parent total is the exact sum
   of its variants' totals at the money and quantity scales, never a float sum. Fixture with
   `0.10 + 0.20`-shaped totals. (Task 6.)

---

## File Structure

**New:**

- `packages/catalogue/src/variant-fallback.ts` — the ONE place the read rule lives:
  `parentProducts` (a Drizzle alias of `products`), `effectiveProductColumns` (the select map of
  `coalesce(variant.x, parent.x)` expressions), `joinParent(query)`; plus the pure
  `inheritFromParent(variant, parent)` used where rows are already in memory.
- `packages/catalogue/src/variant-fallback.test.ts`
- `packages/db/drizzle/0002_<generated>.sql` — adds `parent_id`, `variant_order` and the unique
  index on `(id, catalogue_id)` (generated; `ALTER TABLE … ADD` and `CREATE UNIQUE INDEX`, no rebuild).
- `packages/db/drizzle/0003_<generated>.sql` — the nullable inherited columns, the composite parent
  key and the top-level check (generated; recreates `products`).
- `packages/db/drizzle/0004_variant_one_level.sql` — the one-level and fixed-parent triggers
  (`--custom`).
- `packages/db/drizzle/0005_<generated>.sql` — drops `working_order_lines.variant_id` and
  `sale_lines.variant_id` (Task 3; `ALTER TABLE … DROP COLUMN`).
- `packages/catalogue/drizzle/0001_<generated>.sql` — drops `product_variants` and
  `menu_item_variants` (Task 7).

**Modified (by task):**

- Task 1: `packages/db/src/schema/catalogue.ts`, `packages/db/src/trigger-refusals.ts`,
  `packages/db/src/index.ts`, `packages/catalogue/src/operations.ts` (`PRODUCT_BASE_COLUMNS`,
  `listProducts`, `createProduct`'s re-read, `listMenuOffers`, `listAvailableProducts`),
  `packages/catalogue/src/offered-modifiers.ts`, `packages/catalogue/src/product-editor.ts`,
  `apps/server/src/working-order.ts` (the extras-product read in `resolveBasketModifiers`, `:185-193`),
  `scripts/behavioural-triggers.test.ts`, `scripts/schema-constraints.test.ts`.
- Task 2: `packages/catalogue/src/variants.ts`, `operations.ts`, `content-languages.ts`,
  `menu-types.ts`, `packages/module/src/module.ts`, `packages/media/src/images.ts`,
  `apps/server/src/working-order.ts`, `apps/server/scripts/demo-seed/seed-catalogue.ts` + test.
- Task 3: `packages/db/src/schema/orders.ts`, `sales.ts`, `packages/core/src/sale-line.ts`,
  `sale-line-rows.ts`, `packages/catalogue/src/pricing.ts`, `variants.ts`,
  `apps/server/src/working-order.ts`, `packages/venue-service/src/operations.ts` (preparation
  routes), `apps/till/src/state/order-line.ts`,
  `apps/till/src/widgets/modifier-picker.ts`, `apps/till/src/api/client.ts`, product grid.
- Task 4: `packages/catalogue/src/product-editor.ts`, `product-editor-input.ts`,
  `product-types.ts`, `operations.ts` (`createProduct`/`updateProduct` for a variant),
  `apps/server/src/catalogue-api.ts`.
- Task 5: `apps/dashboard/src/widgets/product-editor.ts`, `product-editor-model.ts`,
  `variant-table.ts`, `variant-form.ts`, `product-list.ts`, `screens/catalogue-screen.ts`,
  `packages/ui/src/components/wt-price-input.ts`, `packages/media/src/dashboard/image-library.ts`,
  i18n strings.
- Task 6: `packages/reporting/src/top-sellers.ts`, `types.ts`, `apps/server/src/report-api.ts`,
  `apps/dashboard/src/widgets/top-sellers-table.ts`, `apps/dashboard/src/api/client.ts`.
- Task 7: removals (below), `docs/developers/products.md`, `design-system.md`,
  `conventions-data.md`, `docs/backlog.md`, the spec's status line.

---

## Task 1: `parent_id`, the inherited columns, and ONE fallback read — slug `parent-id`

Spec §1.2. After this task a variant row CAN exist and every reader resolves it correctly, but
nothing writes one yet, so no behaviour visible to a user changes.

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts` (`products`)
- Create (generated, in TWO generations — Step 5): `packages/db/drizzle/0002_*.sql`, `0003_*.sql`; Create (custom): `packages/db/drizzle/0004_variant_one_level.sql`
- Modify: `packages/db/src/trigger-refusals.ts`, `packages/db/src/index.ts`
- Create: `packages/catalogue/src/variant-fallback.ts`, `variant-fallback.test.ts`
- Modify: `packages/catalogue/src/operations.ts`, `offered-modifiers.ts`, `product-editor.ts`, `apps/server/src/working-order.ts`; `docs/backlog.md` (the wipe line)
- Test: `scripts/behavioural-triggers.test.ts`, `scripts/schema-constraints.test.ts`

**Interfaces:**
- Produces (schema): `products.parentId: id("parent_id")` (nullable), `products.variantOrder:
  count("variant_order").notNull().default(0)`; `vatClass`, `pricingUnit`, `dietaryDeclarations`
  become NULLABLE; check `products_top_level_owns_ck`; unique `products_id_catalogue_key (id,
  catalogue_id)`; foreign key `products_parent_fk (parent_id, catalogue_id) → products (id,
  catalogue_id)`, on delete restrict.
- Produces (db): `VARIANT_ONE_LEVEL_REFUSAL`, `VARIANT_PARENT_FIXED_REFUSAL` exported from `@waitron/db`.
- Produces (catalogue): `parentProducts`, `effectiveProductColumns`, `inheritFromParent(variant, parent)`.
  Every reader named below returns EFFECTIVE values with unchanged TypeScript types (`vatClass:
  VatClass`, never nullable) — the nullability stops at the fallback module.

**The inherited set** (spec §1.2, "normally inherited"): `customer_name`, `description`,
`kitchen_name`, `vat_class`, `pricing_unit`, `category_id` (and, with it, the membership rows in
`product_categories` and the unit row in `product_units` — a variant with NO row of its own reads
its parent's), `station_id`, `course_id`, `image` (D9), `allergens`, `manual_allergens`,
`recipe_derivation`, `diet_derivation`, `diet_override`, `diet`, `dietary_declarations`. **Always
the variant's own:** `id`, `catalogue_id`, `name`, `unit_price`, `active`, `sold_alone`,
`parent_id`, `variant_order`, timestamps.

- [ ] **Step 1: Write the failing trigger cases.** In `scripts/behavioural-triggers.test.ts`, add a
  `describe("a variant has exactly one level")` block migrated through `applyMigrations` like the
  file's other blocks. Cases, each asserting the exact refusal text, each with its accepting
  control:
  - inserting a product whose `parent_id` names a product that itself has a `parent_id` →
    `VARIANT_ONE_LEVEL_REFUSAL`; control: a parent with no parent is accepted.
  - updating `parent_id` on an existing row — setting it on a top-level product (including one
    that HAS variants, the only way a second level could otherwise arise), changing it, or clearing
    it → `VARIANT_PARENT_FIXED_REFUSAL`; control: updating any other column of a variant (`name`)
    is accepted, and inserting a second variant under the same parent is accepted.
  - a product naming itself as parent → `VARIANT_ONE_LEVEL_REFUSAL`.
  Two triggers make the whole rule: a new row can have no children yet, so the insert trigger only
  has to check the parent it names, and every later way of creating a second level goes through
  an update of `parent_id`, which the fixed-parent trigger refuses outright. Add both trigger names
  to the file's name pin.

- [ ] **Step 2: Write the failing schema-constraint entries.** In `scripts/schema-constraints.test.ts`
  add the foreign-key entry `["products", ["parent_id", "catalogue_id"], "products"]` (this guard's
  foreign-key entries carry no names), the unique index `products_id_catalogue_key`, and
  `products_top_level_owns_ck` in `EXPECTED_CHECK_CONSTRAINTS`. **Do not add an offending-insert
  case here** — the file's header says it reads the built schema and does not try one; the
  cross-catalogue refusal goes in `variant-fallback.test.ts` (Step 8), through `useVenueDb`.
  **This guard runs its statements outside a transaction, where `PRAGMA foreign_keys=OFF` works**,
  so it can pass while the product's migrator — which runs inside `BEGIN`, where that pragma does
  nothing — fails. Only a suite that migrates through `applyMigrations` or `useVenueDb` proves the
  migration applies.

- [ ] **Step 3: Run both to verify they fail.**
  Run: `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts`
  Expected: FAIL — the triggers, the key and the index do not exist.

- [ ] **Step 4: Change the schema.** In `packages/db/src/schema/catalogue.ts`:

```ts
    // Set only on a VARIANT (spec §1.2): the product it is a variant of. One level only, and fixed
    // once set — both enforced by triggers, because neither can be declared here
    // (0004_variant_one_level.sql; behavioural-triggers.test.ts). Same catalogue as the parent:
    // the composite key below.
    parentId: id("parent_id"),
    // A variant's position among its parent's variants; unused on a product with no parent.
    variantOrder: count("variant_order").notNull().default(0),
```

  Drop `.notNull()` from `vatClass`, `pricingUnit` and `dietaryDeclarations` (keep
  `dietaryDeclarations`' `.default([])`, so a top-level insert that omits it still gets `[]`), and
  in the table's extra config add:

```ts
    unique("products_id_catalogue_key").on(t.id, t.catalogueId),
    foreignKey({
      name: "products_parent_fk",
      columns: [t.parentId, t.catalogueId],
      foreignColumns: [t.id, t.catalogueId],
    }).onDelete("restrict"),
    // A product with no parent owns every value a variant may inherit (spec §1.2).
    check(
      "products_top_level_owns_ck",
      sql`${t.parentId} is not null or (${t.vatClass} is not null and ${t.pricingUnit} is not null and ${t.dietaryDeclarations} is not null)`,
    ),
```

  The existing `products_pricing_unit_ck` / `products_vat_class_ck` already pass a NULL (a CHECK
  is satisfied by NULL — measured by the plan review); Step 8 pins it with a variant insert.

- [ ] **Step 5: Generate in TWO steps, then write the custom trigger migration.** One generation
  does not apply: drizzle's rebuild copies `parent_id` and `variant_order` out of the old table
  (`no such column: "parent_id"`), and if the columns exist but the unique index does not, the
  rebuild's copy fails `foreign key mismatch - "__new_products" referencing "products"`, because
  the product migrator runs inside `BEGIN` and the generated `PRAGMA foreign_keys=OFF` does nothing
  there (both measured by the plan review). So:
  1. Add ONLY `parentId`, `variantOrder` and `unique("products_id_catalogue_key")` to the schema;
     run `pnpm --filter @waitron/db db:generate`. READ `0002_*.sql`: two `ALTER TABLE … ADD` lines
     and one `CREATE UNIQUE INDEX`, no table rebuild.
  2. Then make the three columns nullable and add the foreign key and the check; run
     `pnpm --filter @waitron/db db:generate` again. READ `0003_*.sql`: it recreates `products`
     and must carry the composite key and the check.
  3. Run `pnpm --filter @waitron/db db:generate:custom --name=variant_one_level` and write
     `0004_variant_one_level.sql` in the style of `0001_behavioural_triggers.sql` (a body of
     `select raise(abort, '…') where <refused case>;`, one trigger per event). Its header comment
     says the triggers live on `products` and that **any later migration that recreates
     `products` drops them** — the name pin in `scripts/behavioural-triggers.test.ts` is what
     notices.

```sql
create trigger products_variant_one_level_insert before insert on products
begin
  select raise(abort, 'a variant''s parent must be a product with no parent')
  where new.parent_id is not null
    and (new.parent_id = new.id
      or (select parent_id from products where id = new.parent_id) is not null);
end;
--> statement-breakpoint
create trigger products_variant_parent_fixed_update before update of parent_id on products
begin
  select raise(abort, 'a variant''s parent is fixed when it is created')
  where new.parent_id is not old.parent_id;
end;
```

  Put the two
  message strings in `trigger-refusals.ts` as `VARIANT_ONE_LEVEL_REFUSAL` and
  `VARIANT_PARENT_FIXED_REFUSAL` and export them from `packages/db/src/index.ts`.

- [ ] **Step 6: Prove the migration APPLIES, and record the upgrade result.** Run
  `pnpm --filter @waitron/db exec vitest run` and `pnpm --filter @waitron/catalogue exec vitest run
  src/migrations.test.ts` — both migrate fresh databases through `useVenueDb`, inside the
  migrator's transaction, which is the case the schema guard cannot see. Do NOT add a test that the
  media triggers survive on a fresh database: media migrates after core there, and the existing
  name pin (`scripts/behavioural-triggers.test.ts:322-331`) already asserts those names, so such a
  test could not fail. The UPGRADE result is already measured (see "Task 1 cannot upgrade an
  existing venue"); re-run it once on the final migrations — migrate a venue directory on `main`,
  then migrate it again with this branch — and paste what it printed into the PR. Add one line to
  `docs/backlog.md` in this PR: after this lands every dev venue needs `wa-wt reset demo <name>`,
  and no provisioned box takes the image without a wipe.

- [ ] **Step 7: Run the guards to verify they pass.**
  Run: `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/catalogue-engine-neutral.test.ts`
  Expected: PASS.

- [ ] **Step 8: Write the failing fallback tests.** Create
  `packages/catalogue/src/variant-fallback.test.ts` on `useVenueDb({ migrations: [CORE_MIGRATIONS,
  CATALOGUE_MIGRATIONS] })`. Fixture: a parent "Café" with every inherited field set to a distinct
  value (VAT `reduced`, customer name `{ es: "Café cliente" }`, kitchen name `CAF`, a category, a
  unit, a station, a course, allergens, an image), a menu with the parent on it, and two variant
  rows inserted DIRECTLY (`tx.insert(products)`, since no write path exists yet): "Solo" with every
  inherited field null, and "Doble" overriding VAT (`general`), kitchen name (`DBL`) and image.
  Each variant also gets its own `menu_items` row. Assert, for each reader:
  - `listProducts(tx, catalogueId)` → Solo reads VAT `reduced`, kitchen `CAF`, the parent's
    category ids, unit and image; Doble reads VAT `general`, kitchen `DBL`, its own image.
  - `listMenuOffers(tx, [menuId])` → the same effective values on each variant's offer row.
  - `listAvailableProducts(tx, locationId)` → Solo and Doble are ABSENT (a variant is never a
    product in its own right on the plain list — Review Focus 3); the parent is present.
  - `createProduct` of a new top-level product returns its values (it re-reads through the column
    map, which now needs the parent join — `operations.ts:749-754`).
  - on the plain `productId` sale path (`apps/server/src/till-sale.test.ts`), a line naming
    Solo's id is refused with `sale.unknown_product`.
  - a variant whose `catalogue_id` differs from its parent's is refused (errcode 787,
    `FOREIGN KEY constraint failed`) — a composite key a regeneration dropped would let it through.
  - a variant inserted with `dietaryDeclarations: null` reads back the PARENT's declarations; one
    inserted without the field at all stores `[]` (the column keeps `.default([])`), which is why
    every variant writer passes `null` explicitly — pin both.
  - `readOfferedModifiers` (an extras list naming Solo) → the extra's VAT is `reduced`.
  - `inheritFromParent` (pure) → a null field takes the parent's, a set one keeps its own, and
    `name`/`unitPrice`/`active` are never taken from the parent even when the parent's differ.
  Also a case pinning that a top-level product with a null `vat_class` is refused by
  `products_top_level_owns_ck` (errcode 275, `CHECK constraint failed`), and that a variant with a
  null `vat_class` is accepted.

- [ ] **Step 9: Run to verify they fail.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/variant-fallback.test.ts`
  Expected: FAIL — `variant-fallback.ts` does not exist; the readers return nulls for Solo.

- [ ] **Step 10: Implement `variant-fallback.ts`.**

```ts
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { products } from "@waitron/db";

/** The parent row of a variant, joined as `parent` (left join: a top-level product has none). */
export const parentProducts = alias(products, "parent");

/**
 * Each inherited field as `coalesce(product.x, parent.x)`: a null on a variant reads as its
 * parent's (spec §1.2). `.mapWith(column)` keeps the column's own decoding (a `json` column
 * would otherwise come back as the TEXT `coalesce` returns). The types are non-null where
 * `products_top_level_owns_ck` guarantees the parent holds the value.
 */
export const effectiveProductColumns = {
  customerName: sql<Record<string, string> | null>`coalesce(${products.customerName}, ${parentProducts.customerName})`.mapWith(products.customerName),
  vatClass: sql<string>`coalesce(${products.vatClass}, ${parentProducts.vatClass})`.mapWith(products.vatClass),
  pricingUnit: sql<string>`coalesce(${products.pricingUnit}, ${parentProducts.pricingUnit})`.mapWith(products.pricingUnit),
  // …one entry per remaining field of the inherited set above, in the same form.
};

/** The same rule over rows already in memory: inherited keys only, never the variant's own. */
export function inheritFromParent<T extends Record<string, unknown>>(
  variant: T,
  parent: T | null,
): T {
  if (parent === null) return variant;
  const out: Record<string, unknown> = { ...variant };
  for (const key of INHERITED_KEYS) if (out[key] === null) out[key] = parent[key];
  return out as T;
}
```

  The implementer writes out every entry; the exact column list is the inherited set above.
  `category_id` membership and the unit row: a variant with no `product_categories` rows reads its
  parent's, and one with no `product_units` row reads its parent's unit — join
  `productUnits`/`productCategories` on `coalesce(<variant's row>, <parent's row>)` or read both and
  pick in `inheritFromParent`; pick whichever keeps ONE query per read (CLAUDE.md §3, no per-row
  reads).
  **`coalesce` hands a JSON column back as TEXT; `.mapWith(<column>)` decodes it.** Measured by the
  plan review on drizzle-orm 0.45.2 through the repo's own store adapter: with `mapWith`, the JSON
  columns came back as objects and arrays; without it, as strings. Keep `.mapWith` on every JSON
  entry, and keep a test that reads `customerName` back as an object.

- [ ] **Step 11: Route every reader through it.** In `operations.ts`: `PRODUCT_BASE_COLUMNS` (used
  by `listProducts`/`toProduct`), the select in `listMenuOffers`, and the select in
  `listAvailableProducts` take their inherited entries from `effectiveProductColumns`, each query
  gaining `.leftJoin(parentProducts, eq(parentProducts.id, products.parentId))`;
  `listAvailableProducts` also adds `isNull(products.parentId)`. `createProduct`'s re-read of the
  new row (`operations.ts:749-754`) gets the same join — without it the coalesced columns fail
  `no such column: parent.*`. Same in `offered-modifiers.ts` (the extras product read near `:140`),
  `product-editor.ts`'s `columns` (Task 4 replaces this with a raw read plus hints; until then it
  reads effective values) and `apps/server/src/working-order.ts`'s extras-product read in
  `resolveBasketModifiers` (`:185-193`). `listMenuOffers` still returns variant rows as top-level
  offers in this task — Task 2 nests them, and says which of this task's assertions it replaces. **Find every other reader
  by the compiler, not by grep:** making `vatClass`, `pricingUnit` and `dietaryDeclarations`
  nullable in the schema makes every direct `products.vatClass` read type as `string | null`; each
  one the compiler then flags either goes through `effectiveProductColumns` or states at the site
  why it reads the raw value. Run `pnpm --filter "@waitron/*" typecheck` and clear every error that
  way.

- [ ] **Step 12: Run to verify they pass, then the affected suites.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/variant-fallback.test.ts src/operations.test.ts src/offered-modifiers.test.ts src/product-editor.test.ts src/migrations.test.ts`
  then `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/till-sale.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`.
  Expected: PASS, the golden huella unchanged.

- [ ] **Step 13: Commit.** `git add` the paths above; `git commit -s` with a message saying what a
  variant row now is, what reads it, and the upgrade measurement from Step 6.

---

## Task 2: Variants are stored as products — slug `storage`

Spec §4.2, §4.5, §9.2 (media scan). The editor body, the menu publication route, the offer shape
and the till's wire shape are UNCHANGED; only where the rows live changes, so no screen changes.

**Files:**
- Modify: `packages/catalogue/src/variants.ts`, `operations.ts` (`listProducts`, `listMenuOffers`), `content-languages.ts`, `menu-types.ts`
- Modify: `packages/module/src/module.ts` (`ZoneMenuOffer.variants`), `packages/media/src/images.ts`
- Modify: `apps/server/src/working-order.ts` (the batched variant read), `apps/server/scripts/demo-seed/seed-catalogue.ts`, `seed-catalogue.test.ts`
- Test: `packages/catalogue/src/variants.test.ts`, `variants.db.test.ts`, `operations.test.ts`, `content-languages.test.ts`; `packages/media/src/images.test.ts`; `apps/server/src/till-sale.test.ts`, `working-order.test.ts`

**Interfaces:**
- Consumes: Task 1's `parentId`, `variantOrder`, `effectiveProductColumns`.
- Produces: the same exported signatures as today — `listProductVariants`,
  `listProductVariantsForProducts`, `setProductVariants`, `listMenuVariants`, `setMenuVariants`,
  `selectMenuVariant` — now over `products` rows with `parent_id` and over variant `menu_items`
  rows. `ProductVariant.id` IS the variant's product id; `available` IS `products.active`.
  `MenuOffer.variants[]` (and `ZoneMenuOffer.variants[]`) entries gain `menuItemId: string` (the
  variant's own offer row) and the variant's EFFECTIVE `vatClass`, `pricingUnit`, `unit`,
  `category`, `courseId`, `allergens`, `diet`, `dietDerivation`, `dietOverride` and
  `dietaryDeclarations` — read through Task 1's fallback, so a variant that inherits carries its
  parent's value and one that overrides carries its own. Task 3 prices a variant line from these;
  in this task every variant inherits (nothing can override yet), so the values equal the parent
  offer's and no price or tax changes.

- [ ] **Step 1: Write the failing storage tests** in `variants.db.test.ts` (rewrite the file's
  direct `productVariants` inserts to go through `setProductVariants`):
  - `setProductVariants(tx, parentId, [Solo, Doble])` creates two `products` rows with
    `parent_id = parentId`, the parent's `catalogue_id`, `variant_order` 0 and 1, every inherited
    column NULL — `dietary_declarations` and `diet` included, read back with raw SQL, because the
    column default would otherwise store `[]` — and `sold_alone = true`; `listProductVariants`
    returns them in that order, and re-saving them reversed swaps `variant_order` without changing
    their ids.
  - a variant saved with `available: false` has `products.active = 0`.
  - removing an unreferenced variant deletes its row.
  - removing a variant (D7) that is named by ANY foreign key into `products` → refused
    `product.variant_in_use`, with the variant row and every other row unchanged (Review Focus 4).
    One case per referencing table: enumerate them with
    `grep -n 'REFERENCES \`products\`' packages/*/drizzle/0000_baseline.sql` and list what it
    printed in the test file's header (the plan review counted ten, among them `menu_items`,
    `recipe_lines`, `preparation_routes`, `extra_list_items` and `menu_item_extra_items`). An open
    order names the variant through `working_order_lines.variant_id` in this task — a column with
    no foreign key, so the check reads it explicitly — until Task 3 moves the check to
    `product_id`.
  - `setMenuVariants(tx, parentItemId, [{ variantId: solo, unitPrice: "1.75", available: true }])`
    creates a `menu_items` row for Solo on the parent row's menu with the parent row's `section_id`
    and `display_order` and `gross_price` 175 cents; publishing it with `available: false` keeps
    the row with `active = false`; re-publishing WITHOUT Solo DELETES Solo's row (D10), and that
    delete succeeds — pin it, since a foreign key into a variant's menu row would refuse it; after
    it, removing Solo from the editor is accepted.
  - `setMenuVariants` naming a product that is not a variant OF THIS PARENT → `product.variant_not_found`.

- [ ] **Step 2: Write the failing offer tests** in `operations.test.ts` (Review Focus 3):
  - `listMenuOffers` returns the parent's offer with `variants` [Solo, Doble] in `variant_order`,
    each with its own `menuItemId`, its menu price, its effective VAT and course, and
    `available = variant product active AND variant row active`, and does NOT return Solo's or
    Doble's row as a top-level offer. **This REPLACES Task 1's `variant-fallback.test.ts`
    assertions that read the variants as top-level `listMenuOffers` rows** — rewrite those cases
    to read the nested entries; the behaviour they pin (inherited values) is kept, only where it
    is read moves.
  - a variant row on a menu where its parent has no row is returned nowhere.
  - deactivating the parent product, or the parent's menu row, removes the parent's offer and with
    it the variants.

- [ ] **Step 3: Run to verify they fail.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/variants.db.test.ts src/variants.test.ts src/operations.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Rewrite `variants.ts` over `products`.** `listProductVariantsForProducts` selects
  `products` where `parentId in (…)` ordered by `variantOrder, id`, mapping `active` to `available`
  and `unitPrice` through `centsToDecimal`. `setProductVariants` keeps its validation (price,
  availability, translations, duplicate ids, "every supplied id is a variant of THIS parent" →
  `product.variant_not_found`) and writes:

```ts
const values = {
  name: input.name,
  customerName: input.customerName,
  kitchenName: input.kitchenName,
  image: input.image,
  unitPrice: decimalToCents(input.unitPrice),
  active: input.available,
  variantOrder: index,
};
// insert: { ...values, parentId, catalogueId: parent.catalogueId, soldAlone: true }
// every inherited column is left NULL, so it reads as the parent's (spec §1.2)
```

  Pass every inherited column as an explicit `null` (above all `dietaryDeclarations: null`, whose
  column default is `[]`). The removal check (D7) reads every table the Step 1 grep listed, plus
  `working_order_lines.variant_id`, for the removed ids — one query per table, before any delete —
  and throws `product.variant_in_use` with `{ variantId, menuItemIds }` (the existing params;
  `menuItemIds` is empty when the reference is not a menu row). `setMenuVariants` upserts
  `menu_items` rows keyed by the existing `(menu_id, product_id)` unique key, copying `sectionId`
  and `displayOrder` from the parent's row (D12) and setting `active` from `available`, and DELETES
  this parent's variant rows on that menu that are absent from the input (D10). `listMenuVariants` reads those rows. `selectMenuVariant` keeps its signature and
  behaviour in this task.

- [ ] **Step 5: Rewrite the offer read.** In `listMenuOffers`, the top-level select adds
  `isNull(products.parentId)`; a second select reads the variant rows (`menu_items` joined to
  `products` where `products.parentId in (<offer product ids>)` and `menu_items.menuId` equals the
  parent row's menu) and nests them under the parent offer, ordered by `variant_order`, carrying
  each variant's effective values through `effectiveProductColumns` (the Interfaces list above). `listProducts`
  reads variants the same way (child `products` rows, nested into `Product.variants`) and returns
  only top-level products at the top level. Add `menuItemId` to the variant entries of `MenuOffer`
  and `ZoneMenuOffer`.

- [ ] **Step 6: The other readers.** `content-languages.ts`'s translation gap report reads variant
  names from `products where parent_id is not null` (keeping the `'variant'` kind and a link to the
  parent), not `product_variants` — and its PRODUCT branch (`content-languages.ts:73`) gains
  `and parent_id is null`, or every variant is counted twice; pin both in
  `content-languages.test.ts`. `packages/media/src/images.ts`'s `listImageUsages` and
  `countUsages` read ONE column, `products.image`: a row with a `parent_id` is reported as
  `kind: "variant"` with `productId` = its parent, exactly as today — and a variant with a NULL
  image counts as no usage (D9: it borrows the parent's photo, it does not hold one). Update
  `images.test.ts`'s variant case to insert through `setProductVariants`.
  `apps/server/src/working-order.ts` keeps calling `listProductVariantsForProducts`, which now reads
  children. The demo seed keeps calling `setProductVariants` then `setMenuVariants`; rewrite
  `seed-catalogue.test.ts`'s raw SQL (`:120-145`) to read variant products and their `menu_items`.

- [ ] **Step 7: Run to verify.** The catalogue suites above, then
  `pnpm --filter @waitron/media exec vitest run src/images.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/till-sale.test.ts src/working-order.test.ts scripts/demo-seed/seed-catalogue.test.ts`
  and the golden huella test. Expected: PASS, golden unchanged. A variant sale in `till-sale.test.ts`
  still freezes the parent's names and the variant's names in their columns.

- [ ] **Step 8: Commit** (`git commit -s`).

---

## Task 3: A variant is sold as the product it is — slug `sale-line`

Spec §4.1, §4.3, decision 10, decision 11; D1–D4.

**Files:**
- Modify: `packages/db/src/schema/orders.ts`, `sales.ts` (drop `variantId`; fix the stale `0031` pointer at `sales.ts:230`)
- Create (generated): `packages/db/drizzle/0005_*.sql`
- Modify: `packages/core/src/sale-line.ts`, `sale-line-rows.ts`; `packages/catalogue/src/pricing.ts`, `variants.ts` (delete `listProductVariantsForProducts`, D11), `menu-types.ts`, `operations.ts`, `index.ts`
- Modify: `apps/server/src/working-order.ts` (the offer-line build `:292-312`, kitchen routing `:1166-1174`, the kitchen-screen allergen read `:3990-4000`, the held-order fast path `:3150-3252`); `packages/venue-service/src/operations.ts` (preparation routes, `:1003`)
- Modify: `apps/till/src/api/client.ts`, `state/order-line.ts`, `widgets/modifier-picker.ts`, `widgets/product-grid.ts`, `till-app.ts` (retrieval)
- Test: `packages/db/src/schema/variant-snapshot-columns.test.ts`, `sales.test.ts` (`:516-525`, tighten `["variant_id"]` to `[]`), `orders.test.ts` (`:500-517`, tighten `["product_id","variant_id"]` to `["product_id"]`), `packages/core/src/sale-line-rows.test.ts`, `packages/catalogue/src/pricing.test.ts`, `variants.db.test.ts`, `apps/server/src/till-sale.test.ts`, `working-order.test.ts`, `kitchen-print.test.ts`, `apps/till/src/widgets/modifier-picker.test.ts`, `product-grid.test.ts`, `state/order-line.test.ts`, `packages/fiscal-verifactu/src/write-path.e2e.test.ts`
  (Tighten the pinned column lists; do not delete those cases — CLAUDE.md "preserve behavioural assertions".)

**Interfaces:**
- Consumes: Task 2's `MenuOffer.variants[]` entries, with their `menuItemId` and effective values.
- Produces: `MenuOffer.soldAlone: boolean`; `TillProduct.soldAlone: boolean`;
  `SelectedVariant.productId: string` (the chosen row — parent or variant) replacing
  `variantId`; `working_order_lines.product_id` = the chosen row. Wire: unchanged
  `{ menuItemId, variantId? }` (D3).

- [ ] **Step 1: Write the failing fiscal test FIRST (Review Focus 1).** In
  `write-path.e2e.test.ts`, beside the golden block, add a sale of the parent "Café" (`reduced`)
  with one variant line inheriting VAT and one variant line overriding to `general` (set the
  override with a direct `tx.update(products)` — the write path for it is Task 4's), and assert the
  filed `vatBreakdown` carries the inherited line at 10% and the overriding line at 21%. Pin that
  no variant field reaches the fingerprint the way the "entorno is not part of the huella" test
  does (`write-path.e2e.test.ts:372`): two sales with the pinned tax id that differ ONLY in their
  variant names must produce the same huella. Leave the existing golden block UNEDITED and assert
  it still passes.

- [ ] **Step 2: Write the failing order-path tests** in `till-sale.test.ts` / `working-order.test.ts`:
  - a line `{ menuItemId: parentItem, variantId: solo }` writes `working_order_lines.product_id =
    solo`, `name`/`descriptions`/`kitchen_name` = the PARENT's three names and
    `variant_name`/`variant_descriptions`/`variant_kitchen_name` = Solo's OWN RAW values — never
    the fallback-filled ones — priced at Solo's menu price. Pin it with Solo's kitchen name EMPTY:
    the ticket must read `CAF · Solo` (`kitchenPresentationName` falls back to the variant's staff
    name, `packages/catalogue/src/product-presentation.ts:99`), where freezing the inherited value
    would print `CAF · CAF`. The same for the receipt's customer text.
  - a variant line is priced and taxed from the VARIANT's effective values on the offer (VAT,
    pricing unit, unit, course, category) — Doble overriding VAT to `general` under a `reduced`
    parent is charged 21%.
  - kitchen routing (Review Focus 2): a Solo line fires to the station its PARENT resolves to —
    the parent's own station, then the parent's category's — and carries the parent's course; the
    kitchen screen shows the PARENT's allergens for a Solo line (today a line whose product has
    null allergens shows none, `working-order.ts:3990-4000`); a preparation route keyed on the
    parent's product id applies to a Solo line (`packages/venue-service/src/operations.ts:1003`).
    Each with a Doble control that overrides the field and gets its own value.
  - with the parent `sold_alone = true`, `{ menuItemId: parentItem }` alone sells the parent at the
    parent row's price with all variant names NULL (decision 10).
  - with the parent `sold_alone = false` and variants, `{ menuItemId: parentItem }` →
    `product.variant_required` (decision 10); with `sold_alone = false` and NO variants →
    `product.unavailable` (D2).
  - an unpublished, deactivated or other-parent `variantId` → `product.variant_unavailable`.
  - a held order whose only change is the variant on a kept line is RE-PRICED at the new variant's
    price (closes the gap at `working-order.ts:3150-3211`, where the fast path compared the parent
    only).
  - a quantity-only edit of a held VARIANT line that carries an options answer keeps its line id
    and its locked price (CLAUDE.md §3's compare-by-values rule): the fast path looks the dish's
    lists up by product (`working-order.ts:3237-3252`), and a variant carries no lists of its own —
    they are its PARENT's (spec §4.4), so the lookup must use the parent's id.
  - retrieving a held order returns each line's `variantId` (= the line's `product_id` when that
    product has a parent) so a retrieved line re-sends it.
  - the filed `sale_lines` row has no `variant_id` column (read `pragma table_info(sale_lines)`).

- [ ] **Step 3: Write the failing till tests.** `product-grid.test.ts` (D1): an offer whose product
  is `soldAlone: false` with no available variant has no tile; `soldAlone: false` with an available
  variant has one; `soldAlone: true` has one. `order-line.test.ts`: `needsModifierPicker` is true
  when an available variant exists. `modifier-picker.test.ts`: with the parent `soldAlone: true` the
  variant radio group lists the parent itself first (its name and price) and Save is enabled with
  it picked; with `soldAlone: false` the parent is not listed and Save stays disabled until a
  variant is picked (today's rule).

- [ ] **Step 4: Run to verify they fail.** Run each suite named in Steps 1–3 with
  `pnpm --filter <package> exec vitest run <file>`. Expected: FAIL for the reasons above.

- [ ] **Step 5: Schema.** Remove `variantId` from `workingOrderLines` and `saleLines`; run
  `pnpm --filter @waitron/db db:generate` and READ `0005_*.sql`: it should be two
  `ALTER TABLE … DROP COLUMN` statements, NOT a table rebuild (the plan review measured that shape:
  with a row in `sale_lines` and its append-only triggers installed, the drop kept the row and both
  triggers, and an update was still refused). If drizzle emits a rebuild instead, STOP and record
  it — a rebuild of an append-only table is a different change. Re-run
  `scripts/behavioural-triggers.test.ts` (the variant-locales triggers live on
  `working_order_lines`) and `scripts/append-only-triggers.test.ts` (`sale_lines` is append-only).
  Update `variant-snapshot-columns.test.ts` so it pins the three name columns and the absence of
  `variant_id` on both tables, and tighten `sales.test.ts` / `orders.test.ts` as listed above.

- [ ] **Step 6: Implement.** `selectMenuVariant` returns `productId` (Solo's id, or the parent's)
  plus the chosen row's effective pricing values, and decides `variant_required` / `unavailable`
  from `offer.soldAlone` and the offer's variants (D2) rather than from "has any variant row".
  `listMenuOffers` adds `soldAlone` to the offer. `working-order.ts`'s offer-line build
  (`:292-312`) takes `vatClass`, `pricingUnit`, `unit`, `courseId` and `category` from the
  selection, not from the parent offer. Kitchen routing (`:1166-1174`), the kitchen-screen allergen
  read (`:3990-4000`) and preparation-route resolution (`venue-service/src/operations.ts:1003`)
  join the parent through Task 1's `parentProducts` / `effectiveProductColumns`, and match
  product-level routes on `coalesce(products.parent_id, products.id)`. Delete
  `listProductVariantsForProducts` (D11) — nothing reads it once the order path decides from the
  offer. The held-order fast path looks up option and extras lists by the line product's PARENT
  id when it has one. The line's `productId` is `selection.productId`; remove every `variantId`
  field from the row writes, `readLockedLines`, `carveOffLines`, `getHeldOrder`, the pricing types
  (`PriceableProduct`, `LockedLine`, `PricingRow` in `pricing.ts`) and `RecordSaleLine` /
  `saleLineRows`; `getHeldOrder` derives `variantId` from the line's product when it has a parent;
  `updateHeldOrder`'s same-line test compares the stored `product_id` with the resolved one.
  `setProductVariants`' removal check (Task 2, D7) reads `working_order_lines.product_id` in place
  of the dropped `variant_id`.
  Till: `menuOfferToTillProduct` maps `soldAlone`; `visibleProducts`/`product-grid` applies D1;
  the picker lists the parent first when `soldAlone`, and a line with the parent picked sends no
  `variantId`.

- [ ] **Step 7: Run to verify they pass**, then `pnpm --filter @waitron/server exec vitest run
  src/kitchen-print.test.ts src/receipt-ticket.test.ts src/split-bill.test.ts src/tabs.test.ts
  src/served-at-huella.test.ts`, `pnpm --filter @waitron/venue-service exec vitest run` and
  `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts src/schema/orders.test.ts
  src/schema/variant-snapshot-columns.test.ts` (they read the frozen names this task must not move) and the
  golden huella test, unedited. Open the till in both themes and at phone width and LOOK at the
  picker with the parent listed.

- [ ] **Step 8: Commit** (`git commit -s`).

---

## Task 4: A variant's own product page — the API — slug `editor-api`

Spec §4.4, §9.1; D6, D8. The server half of the variant's own page, landed and tested before the
screen that uses it.

**Files:**
- Modify: `packages/catalogue/src/product-types.ts`, `product-editor.ts`, `product-editor-input.ts`, `operations.ts` (`createProduct`, `updateProduct`, allergen/diet republishing)
- Modify: `apps/server/src/catalogue-api.ts`
- Test: `packages/catalogue/src/product-editor.test.ts`, `product-editor-input.test.ts`; `apps/server/src/catalogue-api.test.ts`

**Interfaces:**
- Produces: `ProductEditorValue` gains `parentId: string | null` and `inherited: InheritedValues |
  null` — the parent's values for every inherited field, `null` on a top-level product.
  For a VARIANT, the editor value's inherited fields are RAW (null when inheriting), never
  resolved. `ProductEditorInput` for a variant accepts `null` for every inherited field.
  `product.variant_count_invalid` is no longer thrown (D8).

```ts
export interface InheritedValues {
  customerName: Record<string, string> | null;
  description: Record<string, string> | null;
  kitchenName: string | null;
  image: string | null;
  vatClass: VatClass;
  unitId: string | null;
  categoryIds: string[];
  primaryCategoryId: string | null;
  stationId: string | null;
  courseId: string | null;
  allergens: ProductAllergens | null;
  dietaryDeclarations: DietaryLabel[];
}
```

- [ ] **Step 1: Write the failing tests.**
  - `GET /management-api/products/:variantId/editor` returns `parentId`, raw nulls for the
    inherited fields and `inherited` holding the parent's values (three different names on parent
    and variant, so a swap fails).
  - `PUT` on a variant with `vatClass: null` keeps it inheriting; with `vatClass: "general"`
    overrides it; clearing it back to `null` returns it to inheriting (§9.1 — "a blank stays
    blank"). The same for one join-table field (categories) and one JSON field (allergens).
  - the published allergen and diet columns of a variant (the plan review found both ways this
    goes wrong: `createProduct` and `updateProduct`'s republish always write a non-null `diet`,
    `operations.ts:643-668, 740`, and a published allergen value built from the variant's own
    recipe overlay, which is null, drops the parent's recipe-derived allergens):
    - a variant with ALL FOUR overlays null (`manual_allergens`, `recipe_derivation`,
      `diet_derivation`, `diet_override`) keeps `allergens` AND `diet` NULL, and so reads the
      parent's published values;
    - a variant overriding only `manual_allergens` publishes the union of its own manual overlay
      and the PARENT's recipe derivation — a variant never has a recipe of its own;
    - the same for diet: an override of `diet_override` alone is combined with the parent's
      `diet_derivation`;
    - when the parent's recipe derivation changes (`applyRecipeDerivation`), every variant of it
      that has an override of its own is republished too; one with no override needs nothing.
  - `PUT` on a TOP-LEVEL product with `vatClass: null` → `product.invalid` naming `vatClass`.
  - a body carrying a `parentId` different from the stored one, or on a top-level product →
    `product.invalid` naming `parentId` (D6).
  - a product body with exactly one variant is ACCEPTED (D8).
  - the product editor body on a VARIANT carrying a non-empty `variants` list → `product.invalid`
    naming `variants` (a variant has no variants).
  - `modifiers` on a variant → `product.invalid` naming `modifiers` (spec §4.4: a variant offers
    its parent's lists and has none of its own).

- [ ] **Step 2: Run to verify they fail.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/product-editor.test.ts src/product-editor-input.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** `readProductEditor` reads RAW columns (no fallback) plus, when
  `parentId` is set, the parent's EFFECTIVE values into `inherited`. `parseProductEditorInput`
  takes a second argument, `{ isVariant: boolean }`, decided by the route from the stored row:
  a variant's inherited fields accept `null`; a top-level product's do not. `saveProductEditor`
  branches on the stored row: a variant writes nulls through `updateProduct` and runs the
  allergen/diet republish by the rules pinned above — NULL published columns when every overlay is
  NULL, otherwise the variant's own overlays combined with the parent's derivations — and
  `applyRecipeDerivation` republishes a parent's overriding variants. Remove the
  `variants.length === 1` refusal. Map any new refusal in `catalogue-api.ts`'s `STATUS`.

- [ ] **Step 4: Run to verify they pass**, plus `src/variant-fallback.test.ts` and the Task 2
  suites. **Step 5: Commit** (`git commit -s`).

---

## Task 5: A variant's own product page — the dashboard — slug `editor-screen`

Spec §4.4, §9.1, §9.2 (branch 2 bullets); D8, D9.

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`, `product-editor-model.ts`, `variant-table.ts`, `variant-form.ts`, `product-list.ts`, `screens/catalogue-screen.ts`, `api/client.ts`, `i18n/strings.ts`
- Modify: `packages/ui/src/components/wt-price-input.ts` (a `placeholder` property), `packages/media/src/dashboard/image-library.ts`
- Test: the matching `*.test.ts` and `*.a11y.test.ts` files; `packages/ui/src/components/wt-price-input.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `wt-price-input` renders a `placeholder` on its inner input (a token-painting test is not
    needed — no new primitive — but its a11y test covers the placeholder state in both themes).
  - opening a variant's page (`/manage/catalogue/product/:variantId`) shows the editor with each
    inherited field EMPTY and the parent's value as its hint: text fields and price through
    `placeholder`; for `<select>` fields (VAT, unit, station, course, primary category) an explicit
    first option reading "Same as <parent value>" whose value is empty — nothing today does a hint
    on a select, so this is the pattern this task establishes, written into `design-system.md`
    → Forms in the same change.
  - saving with a field left empty sends `null`; typing a value sends it; clearing it sends `null`.
  - the variant page shows no Modifiers section and no Variants section.
  - the parent's quick variants section still edits name, price, photo and availability inline,
    and each row gains an "Open" action to the variant's own page.
  - the first "Add variant" no longer converts the plain price into a "Regular" variant (D8): the
    parent keeps its own price field, and a `sold_alone` switch is visible in the editor (it
    exists on the list only today), because decision 10 turns on it.
  - the products list nests variants under their parent with the variant's OWN effective values
    (today it shows the parent's muted "—"): its price, its effective VAT and category, and its
    own "Edit" action.
  - the image library's usage link for a variant opens the variant's own page, not the parent's.
- [ ] **Step 2: Run to verify they fail** (`pnpm --filter @waitron/dashboard exec vitest run <files>`;
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-price-input.test.ts`;
  `pnpm --filter @waitron/media exec vitest run src/dashboard/image-library.test.ts`).
- [ ] **Step 3: Implement**, keeping `productEditorField`'s server-field mapping for
  `variants.N.*` for the parent's quick section.
- [ ] **Step 4: Run to verify they pass. Open the catalogue screen, a parent and a variant page in
  both themes and at phone width and LOOK** (CLAUDE.md §4). **Step 5: Commit** (`git commit -s`).

---

## Task 6: Top sellers roll variants up under their parent — slug `top-sellers`

Spec §6. Filed data unchanged; report and presentation only.

**Files:**
- Modify: `packages/reporting/src/top-sellers.ts`, `types.ts`, `index.ts`; `apps/server/src/report-api.ts`
- Modify: `apps/dashboard/src/api/client.ts` (`TopSellerRow`), `widgets/top-sellers-table.ts`
- Test: `packages/reporting/src/top-sellers.test.ts`, `apps/server/src/report-api.reports.test.ts`, `report-api.overview.test.ts`, `apps/dashboard/src/widgets/top-sellers-table.test.ts`, the sales and overview screens' tests and a11y tests

**Interfaces:**
- Produces: `TopSeller { name: string; quantity: string; total: string; variants: TopSellerVariant[] }`,
  `TopSellerVariant { name: string; quantity: string; total: string }`. A parent row's `name` is
  the frozen `sale_lines.name`; a variant row's `name` is its `variant_name`, or the parent's name
  for the plain parent sale. `variants` is `[]` when nothing of that name was sold as a variant.
  `limit` counts PARENT rows.

- [ ] **Step 1: Write the failing tests** from ONE fixture (spec §12): parent "Coffee" sold as
  itself ×1 at 1.50, as "Single" ×2 at 1.40 and as "Double" ×3 at 2.10, plus a "Tea" with no
  variants. Assert the Coffee row totals quantity `6` and total `10.60`, nested in quantity order
  Double, Single, Coffee; Tea has `variants: []`; `limit: 1` returns Coffee alone with all three
  nested. Review Focus 5: a second fixture whose variant totals are `0.10` and `0.20` asserts the
  parent total is the string `0.30`.
- [ ] **Step 2: Run to verify they fail**
  (`pnpm --filter @waitron/reporting exec vitest run src/top-sellers.test.ts`).
- [ ] **Step 3: Implement.** Rank and limit the PARENTS in SQL, then read only their variant rows:
  a CTE groups `sale_lines` by `name` alone, orders by summed quantity then name, and takes
  `limit`; the outer query groups by `name, variant_name` for those names only. Never read every
  name-and-variant pair in the date range to throw most of it away. Sums stay the engine's cast-to-
  text sums (as today); any addition done in TypeScript uses the exact `Decimal` arithmetic from
  `@waitron/shared` at the money and quantity scales, never `Number`. `renderTopSellers` draws each parent row with its
  variants as indented sub-rows beneath it (`data-test="seller-row-${i}-variant-${j}"`).
- [ ] **Step 4: Run to verify they pass, then open the sales and overview screens in both themes
  and at phone width and LOOK. Step 5: Commit** (`git commit -s`).

---

## Task 7: Remove the variant tables and the old shapes; docs; backlog — slug `cleanup`

Spec §4.5, §8 (branch 2), §14's backlog line.

**Files:**
- Delete: `packages/catalogue/src/schema/variants.ts` (and its re-export in `schema/index.ts`)
- Create (generated): `packages/catalogue/drizzle/0001_*.sql` dropping `product_variants` and `menu_item_variants`
- Modify: `packages/catalogue/src/classification.ts`, `configuration-transfer.ts`, `variants.ts` (delete `resolveMenuVariant`; `listProductVariantsForProducts` already went in Task 3), `errors.ts` (`product.variant_count_invalid` marked retired, left registered)
- Modify: `scripts/schema-constraints.test.ts` (remove the variant-table entries), `packages/fiscal-verifactu/src/privileges.expected.ts` (only if a guard reads it — check first; it is recorded as a frozen pre-switch record nothing checks)
- Modify: `docs/developers/products.md` (Variants section, the gap report, the editor body), `design-system.md` (the variants table), `conventions-data.md`, `docs/backlog.md`, the spec's **Status** line
- Test: `packages/catalogue/src/migrations.test.ts`, `scripts/classification-complete.test.ts`

- [ ] **Step 1: Write the failing test.** In `migrations.test.ts`, assert neither
  `product_variants` nor `menu_item_variants` exists after the catalogue set migrates.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Delete the schema, regenerate** (`pnpm --filter @waitron/catalogue db:generate`),
  READ the drop migration (drop `menu_item_variants` before `product_variants`; no `CASCADE`, which
  this engine does not have), remove both tables from `CATALOGUE_CLASSIFICATION` and the
  configuration-transfer list, and delete `resolveMenuVariant` and its test cases. Grep the BARE
  names across the whole tree — `product_variants`, `menu_item_variants`, `productVariants`,
  `menuItemVariants`, `resolveMenuVariant`, `variant_count_invalid` — including `docs/`,
  `scripts/` and every `*.md`, and fix or delete each hit (CLAUDE.md §1: a behaviour change retires
  every receipt about the old behaviour, wherever it is written).
- [ ] **Step 4: Run** `scripts/classification-complete.test.ts`, `scripts/schema-constraints.test.ts`,
  `scripts/claude-md-pointers.test.ts`, `scripts/errors-reachable.test.ts` and the catalogue suite.
- [ ] **Step 5: Docs.** Rewrite `products.md`'s Variants section for the one-table model (the read
  rule, D1–D10 as they landed, the tile rule, the sale line). Reconcile `docs/backlog.md`: the
  "Next in this slice: branch 2" entry becomes LANDED with the seven PR numbers, and in the
  menus/categories/home-layouts entry mark ONLY the variants-and-extras part of its "do not start
  until" condition as met — it also waits on the SQLite work and the dependency upgrades, which
  this branch says nothing about. Set the spec's **Status** line to say branch 2 landed.
- [ ] **Step 6: Commit** (`git commit -s`).

---

## Finish (every task)

Each task ends the same way: `/finish-branch` in the task's worktree (full review wave — every task
touches a risk trigger), then `/land-branch`, then the next task starts from a freshly synced
`main`. Update `docs/backlog.md` in the task's own PR where the task makes it stale.

## Self-Review notes

- **Spec coverage.** §1.2 → Task 1 (+ D5, D6). §4.1 → Task 3 (+ D1, D2). §4.2 → Task 2 (+ D10).
  §4.3 → Task 3 (+ D4). §4.4 → Tasks 4 and 5. §4.5 → Tasks 3 and 7. §6 → Task 6. §7 → Global
  Constraints (the engine-neutral guard) and "What changed". §8 branch 2 → Task 7. §9.1 → Tasks 4
  and 5. §9.2 branch 2 bullets → Tasks 2 (media scan), 5 (list and editor). §10 → Task 3. §12
  reporting → Task 6; browser → Tasks 3, 5, 6. §13 branch 2's six steps map to Tasks 1, 2, 3, 6,
  5 and 7 in that order. §14 → Review Focus 1 and Task 7's backlog step.
- **Plan review, 2026-09-23.** A fresh-context review ran the migrations and probes against a
  scratch copy and found five blockers (the one-step migration fails to apply; no existing venue
  can upgrade; three kitchen-side readers key on the line's product; a variant's own VAT never
  reached the sale; the plain product list would sell a variant on its own) and twelve smaller
  findings. All are folded in above; the measurements it took are quoted where they are used.
- **Deliberately not in this plan:** per-variant modifier attachments (spec §4.4, §14); a
  dedicated extras report (§6); the components table (spec "does NOT build"); the sold-alone rule
  on the plain `productId` path, which never sells a variant.
- **Type consistency:** `SelectedVariant.productId` (Task 3) replaces `variantId`; the offer gains
  `MenuOffer.variants[].menuItemId` and each variant's effective values (Task 2) and
  `MenuOffer.soldAlone` (Task 3), and nothing else; `InheritedValues`
  (Task 4) is consumed by Task 5; `TopSeller.variants` (Task 6) is consumed by the dashboard in the
  same task.

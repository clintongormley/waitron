# Variants as products — Branch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold variants into `products`: a variant becomes a product with a parent, reads every
non-name field it leaves blank from that parent, follows its parent onto every menu, and is what an
order records as sold — while a parent that has variants is never sold itself. Split the one
product on/off switch into **Active** (exists) and **Available** (sold out for now). Remove
`product_variants` and `menu_item_variants`.

**Architecture:** One self-reference on `products` plus one read rule ("a blank field on a variant
reads as its parent's value, except its three names"), applied in ONE module
(`packages/catalogue/src/variant-fallback.ts`) that every reader of a product's effective values
goes through; and ONE price-resolution function for the menu price chain. Storage moves before any
screen changes, and each later task changes one surface.

**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`), Hono
routes, Lit web components (dashboard, venue-service dashboard, till), Vitest (`useVenueDb` real
SQLite databases; browser mode for the front-ends).

**Spec:** `docs/superpowers/specs/2026-09-18-one-product-model-design.md` — **§15 first** (the
owner's branch-2 revisions of 2026-09-23, which win over the earlier text), then §1.2, §4, §6, §7,
§8, §9, §12–§14. This plan implements **branch 2 only**; branch 1 (extras + options) is landed (the
thirteen tasks of `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`, ending #480).

**Revision history.** First written 2026-09-23 and reviewed by a fresh-context seat that ran the
migrations against a scratch copy (five blockers, twelve smaller findings, all folded in). Rewritten
the same day after the owner revised the design (spec §15); the measured facts from the first
review are kept where they still apply. The rewrite was reviewed again by a second fresh seat that
generated and applied every migration in scratch copies through the product's own
`applyMigrations` (three blockers, five smaller findings, all folded in).

---

## What changed since the spec was written (read before Task 1)

Measured on `main` on 2026-09-23:

- **The engine is SQLite.** The variant-locales rule the spec's decision 12 waited for already
  exists as `working_order_lines_check_variant_locales_insert` / `_update` in
  `packages/db/drizzle/0001_behavioural_triggers.sql` (refusal text `VARIANT_LOCALES_REFUSAL`,
  `packages/db/src/trigger-refusals.ts`), guarded by `scripts/behavioural-triggers.test.ts`. It reads
  `working_order_lines.variant_descriptions` only; this plan keeps that column. **No trigger needs
  rewriting for the engine.**
- **Each migration set is ONE regenerated baseline** (core: `0000_baseline.sql` + the hand-written
  `0001_behavioural_triggers.sql`; catalogue: `0000_baseline.sql`). This branch adds the first
  migrations since the switch.
- **`sold_alone` is stored but nothing on the till or the menu read enforces it**
  (`packages/db/src/schema/catalogue.ts:82-85`). Under spec §15.4 the till keeps ignoring it.
- **One switch does two jobs today.** `products.active` is what the product editor labels
  *Available* (`apps/dashboard/src/i18n/strings.ts:922`, `editor.available`), what the products list
  shows as *Active / Inactive* (`:1001, 1018-1019`), and what "delete" sets off
  (`apps/dashboard/src/screens/catalogue-screen.ts:260`). The products list has NO status filter
  (the extras, options and staff screens do).
- **`product.variant_required` fires when the product has ANY `product_variants` row**
  (`packages/catalogue/src/variants.ts:263-264`).
- **Variants are sellable only on the menu-offer path** (an order with a service zone). The plain
  `productId` path refuses a `variantId` with `management.request_invalid`
  (`priceOrderLines`, `apps/server/src/working-order.ts`). This plan keeps that.
- **`working_order_lines.product_id` is always the PARENT today**; the chosen variant sits in a
  separate `variant_id` column with no foreign key. **`sale_lines` carries `variant_id` too.**
- **No variant data reaches the fiscal hash.** `backend.recordSale` receives header fields only
  (`packages/core/src/record-sale.ts:351-370`). The golden gate is
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts`,
  `describe("the extras/options rework leaves the fiscal fingerprint byte-identical")`, pinning
  `C43623FCC6F00D21DD31D4BABBDBA1A1FD05D466B84677C2F46594C31ED8536A` / `14.41` / `2.31`.
- **The per-menu variant screen is not in `apps/dashboard`**: it is
  `packages/venue-service/src/dashboard/venue-operations-screen.ts:854-1027`, calling
  `PUT /management-api/catalogues/:id/items/:itemId/variants`.
- **The name join lives in ONE module**: `packages/catalogue/src/product-presentation.ts` (`join`,
  `staffPresentationName`, `joinCustomerPresentationText`, `kitchenPresentationName`). Every
  receipt, ticket, basket, tab, expo and report label goes through it.
- **The inheritance-hint pattern exists**: `apps/dashboard/src/widgets/extra-list-form.ts`
  (`#inheritedPrice`, a `placeholder` on `wt-input`) and `form-fields.ts`'s `textField` /
  `optionalTextFields` `placeholder` parameter. `wt-price-input` has NO `placeholder` property, and
  nothing does the hint on a `<select>`.
- **`menu_items.gross_price` is `NOT NULL`** (`packages/catalogue/src/schema/menu.ts:83`).
- **Stale pointers to fix on touch:** `packages/db/src/schema/sales.ts:230` and spec §4.3 name
  `packages/db/drizzle/0031_variant_descriptions_locales_sql.sql`, which no longer exists.

## Task 1 cannot upgrade an existing venue — every one is wiped

Measured 2026-09-23 by the first plan review, against a scratch copy of `packages/db` through the
product's own `applyMigrations`: migrating a venue that `main` had already migrated, with Task 1's
migrations, ABORTS at the table rename with
`error in trigger products_media_image_fk_parent_delete: no such table: main.products`; and on a
database without the media triggers, the rebuild's `DROP TABLE products` cascade-deletes the rows of
`product_categories` (and would do the same to `product_units` and `product_modifiers`). A fresh
database migrates cleanly. So after Task 1 lands **every dev venue needs `wa-wt reset demo <name>`**
(until then its boot fails with a raw driver error), and **no provisioned box takes the image
without a wipe** — the owner's home box included. This is within CLAUDE.md §3's "no data-migration
code until production" rule. Task 1's PR and its `docs/backlog.md` line say it in those words.
**Task 3 drops `menu_item_variants`, so a dev venue's old per-menu variant rows go with it**, and
its old `product_variants` rows are no longer read; `wa-wt reset demo <name>` re-seeds.

**Task 4 also cannot upgrade a venue that holds data — and part of the damage is SILENT.** Making
`menu_items.gross_price` nullable rebuilds `menu_items`, and inside the migrator's transaction
foreign keys stay on, so dropping the old table acts on every row pointing at it. Measured by the
second plan review (a venue migrated to Task 3, rows added, then Task 4 applied): with no open order
lines the upgrade REPORTS SUCCESS and empties `menu_item_extra_lists` and
`menu_item_variant_overrides` (1 → 0 each, no error); with one `working_line_contexts` row it fails
`FOREIGN KEY constraint failed` and the box does not boot. A fresh database is fine. So Task 4's PR
and backlog line say the same as Task 1's — reset every dev venue, wipe any box — and name the
silent loss. **Practical advice for the owner's box: do not upgrade it between Task 1 and Task 4;
wipe it once after Task 4 lands.** Task 5's column drops are `ALTER TABLE … DROP COLUMN` (measured
to keep rows and the append-only triggers) and need no reset.

## The design this plan implements (spec §15, and the owner's answers of 2026-09-23)

Marked **(owner)** where the owner decided it; **(plan)** where this plan decides it and the owner
has not been asked. A (plan) decision that turns out wrong is recorded in `questions.md`, not
improvised around.

- **V1 (owner) — A parent with Active variants is never sold itself.** Rung up without a variant it
  is refused `product.variant_required`. A product with no Active variants sells as itself. No
  "Regular" variant exists, stored or displayed; one variant is allowed.
- **V2 (owner) — A variant is named in full and printed under its own names.** Staff, customer and
  kitchen text for a variant line are the variant's own; a blank customer or kitchen name falls back
  to the VARIANT's staff name. The three names are never inherited; `description` and every other
  field in the inherited set are. The sale line keeps both the parent's and the variant's frozen
  names, so reports group by parent.
- **V3 (owner) — Prices are full prices; blank follows the parent.** A variant's own price is
  optional (blank = the parent's). On a menu the most specific price that is set wins: the variant's
  price on that menu → the variant's own price → the parent's price on that menu → the parent's own
  price. Every price field shows its fallback as hint text. A variant whose menu price differs from
  its parent's may be labelled "+€1.50" where variants are listed (the till picker now).
- **V4 (owner) — Every Active, Available, top-level product on a menu gets a till button**, sold
  alone or not. A variant never has a button. Tapping a parent opens its variants with the first
  available one preselected. A parent none of whose variants is offered and available on that menu
  gets no button.
- **V5 (owner) — Variants follow their parent onto every menu automatically.** A menu stores
  something for a variant only to override its price or switch it off there.
- **V6 (owner) — Two states: Active / Inactive and Available / Unavailable**, for products and
  variants alike. Delete / remove makes an item Inactive (always allowed — nothing is deleted);
  Inactive items are hidden behind a status filter on the products list and in the editor's variant
  section, and restorable. Available is "sold out for now" and hides nothing in the dashboard. The
  till offers an item only when it is both.
- **V7 (owner) — One variant order**, set in the product editor, used everywhere; it decides which
  variant the till preselects (the first available one).
- **V8 (owner) — The till's wire shape stays `{ menuItemId, variantId }`**; `variantId` now names the
  variant's product id.
- **V9 (owner) — `working_order_lines.variant_id` and `sale_lines.variant_id` are dropped.** On the
  open order `product_id` is the variant; the filed line keeps frozen names and no catalogue id.
- **V10 (owner) — A variant's parent is fixed at creation**, in the same catalogue.
- **V11 (owner) — A variant with no photo shows its parent's.**
- **V12 (owner) — A variant cannot be in no category, or have no unit, while its parent has one.**
  No `product_categories` / `product_units` row is how inheritance is stored.
- **V13 (plan) — A variant's per-menu settings live in a new table,
  `menu_item_variant_overrides`**, keyed by the PARENT's menu row and the variant:
  `(menu_item_id, product_id, variant_id, price NULL, offered flag)`. A row exists only while it
  overrides something (a price, or `offered = false`); saving a variant back to "default price,
  offered" deletes its row. The composite key `(product_id, variant_id) → products (parent_id, id)`
  ties each row to a real variant of that parent, and `(menu_item_id, product_id) → menu_items (id,
  product_id)` to the parent's offer, cascading when the offer goes. Variants therefore never get
  `menu_items` rows of their own — `createMenuItem` refuses a product that has a parent with
  `menu_item.variant_not_allowed` (Task 3). `menu_item_variants` is DROPPED in Task 3 (not reshaped)
  so no row referring to a `product_variants` id has to be copied.
- **V14 (plan) — A menu row's own price may be blank** (`menu_items.gross_price` nullable), meaning
  "the product's own price" — the fourth step of V3's chain, which spec §15.3 implies for every
  product, variant or not. Task 4 does it on its own, after variants work.
- **V15 (plan) — `listProductVariantsForProducts` is deleted in Task 5** (spec §4.5, §8) once the
  order path decides from the offer; `listProductVariants` stays for the editor.
- **V16 (plan) — Extras obey Active and Available too.** Spec §15.6 says the till offers an item
  only when it is both; the extras read (`readExtraProducts`, `offered-modifiers.ts`) and the order
  path's extras read (`resolveBasketModifiers`, `working-order.ts`) filter on neither today. Task 2
  adds the filter. A variant may be an extras item like any product; its child line freezes the
  variant's own names (V2) and its effective VAT and price.
- **Stored and resolved prices are different fields (plan).** `MenuItem.grossPrice` is the STORED
  menu price (`string` until Task 4, then `string | null`); `MenuOffer.unitPrice` is the RESOLVED
  price the till and the order path charge (added in Task 3, and what `priceOrderLines` in
  `working-order.ts` reads from then on instead of `grossPrice`); nested variants are
  `MenuOfferVariant` (Task 3), carrying both the resolved `unitPrice` and the stored `menuPrice` and
  `offered` the menu screen needs.

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** §1 (writing claims), §2 (the gate), §3 (conventions), §4 (testing)
  and §5 (fiscal invariants) apply to every task.
- **Worktree, never `main`.** Each task is its own branch and worktree, created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/variants-<slug>` (the slug is in each
  task's heading). One pull request per task, landed before the next starts.
- **Every commit needs `git commit -s`.** Plain English in commit messages and PR text; exact file,
  function and error-code names appear once as pointers; a command that was run goes in verbatim.
- **TDD, always.** Failing test first, watched failing for the right reason, then the minimal code.
  Fixtures give three DIFFERENT texts for the three names and different values for parent and
  variant on every field under test, so a reader of the wrong one fails.
- **Test databases come from `useVenueDb`** (`@waitron/db/testing/venue-db.js`). Rejected writes
  assert the domain error CODE, never `toBeInstanceOf(Error)`.
- **An owner-decided behaviour change changes the tests that pinned the old behaviour.** Where a
  task below says an existing assertion changes (for example "Coffee · Double" becoming "Double"), it
  is changed in that task and the PR names each one. Every other behavioural assertion is preserved.
- **No backwards-compatibility or data-migration code** (CLAUDE.md §3). A migration-number collision
  on rebase is fixed by REGENERATION, never by hand-editing snapshots or `_journal.json`; then
  re-run `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts` and `inmutabilidad`.
- **Never drop one table and add another in the same `drizzle-kit generate`.** Run without a
  terminal, drizzle-kit stops to ask whether the new table is a rename of the old one and fails
  (`Error: Interactive prompts require a TTY terminal … promptNamedWithSchemasConflict`, measured by
  the second review). Drop in one generation, create in the next.
- **Every constraint that can be declared in TypeScript is declared there** (CLAUDE.md §3). Only a
  trigger goes in a `--custom` migration, with its refusal text in
  `packages/db/src/trigger-refusals.ts` and its behaviour pinned in
  `scripts/behavioural-triggers.test.ts` — a refusing case AND an accepting control for each.
- **Engine neutrality** (spec §7, guard `scripts/catalogue-engine-neutral.test.ts`): no advisory
  lock, no JSON containment, no new enum type. New columns use `packages/db/src/schema/columns.ts`.
- **Error codes name the domain concept** and are never renamed; retired codes stay registered,
  unthrown. A new code gets English and Spanish alert wording where `scripts/alert-codes.test.ts`
  requires it and an explicit entry in the route's `STATUS` map.
- **The fiscal fingerprint is unrecoverable** (CLAUDE.md §5). The golden huella test passes UNEDITED
  in every task. If it cannot, STOP: do not edit the golden literals; record it and mark the task
  blocked.
- **The gate per task:** focused behavioural tests while implementing, then `/finish-branch`, which
  lets the pre-push hook run the local checks once and watches CI. No whole-workspace local run
  just to finish (CLAUDE.md §2). Every task touches a risk trigger, so every task takes the FULL
  review wave.
- **Every new or changed screen follows `docs/developers/design-system.md` → Forms**, uses `wt-*`
  primitives and `--wt-*` tokens only, styles `wt-data-table` cells with `part=`/`::part()`, and is
  opened and LOOKED at in both themes and at phone width before the PR (CLAUDE.md §4).
- **Update `docs/backlog.md` in the same change that makes it stale**, and
  `docs/developers/products.md` where a task changes what it describes.

## Review Focus

Inputs and conditions the spec implies but no spec section tests, most likely to bite first. Each
has its test in the named task.

1. **A variant sold with its VAT inherited is taxed at the PARENT's rate, and one with its own VAT
   at its own** — a wrong VAT on a filed invoice is unrepairable. Fixture: parent `reduced`, variant
   A blank, variant B `general`; the filed `vatBreakdown` shows A at 10% and B at 21%. (Task 1 for
   the reads, Task 3 for the offer carrying each variant's effective values, Task 5 end to end.)
2. **The price chain picks the right step when each level is blank.** One fixture with FOUR
   different prices (variant on this menu, variant's own, parent on this menu, parent's own), then
   each blanked in turn from the most specific: the price charged steps down the chain exactly, and
   never skips a set value. (Task 3 for the first three steps, Task 4 for the fourth.)
3. **A variant line reaches the kitchen exactly as its parent would** — the parent's station
   (product route, then category route), course, allergens on the kitchen screen, and preparation
   routes keyed on the parent — once the variant is the line's product. Those readers key on
   `working_order_lines.product_id` and read columns that were ALREADY nullable, so the compiler
   flags none of them. (Task 5.)
4. **A variant is never offered when it should not be** — Inactive, Unavailable, switched off on
   that menu, or its parent Inactive, Unavailable or not on the menu — and never as a product in its
   own right on the plain product list (`listAvailableProducts`, `/api/products`), which would sell
   it with its name frozen as a parent's. (Tasks 1, 2, 3.)
5. **A variant line prints the variant's own names, in every invoice locale** — a blank customer
   name falls back to the variant's STAFF name in each locale, never to the parent's names, and the
   stored `variant_descriptions` still satisfies the variant-locales trigger. (Task 5.)

---

## File Structure

**New:**

- `packages/catalogue/src/variant-fallback.ts` + `.test.ts` — `parentProducts` (a Drizzle alias of
  `products`), `effectiveProductColumns` (`coalesce(variant.x, parent.x)` per inherited field,
  `.mapWith` for JSON), `INHERITED_KEYS`, `inheritFromParent(variant, parent)`.
- `packages/catalogue/src/offer-price.ts` + `.test.ts` — `resolveOfferPrice(...)`, the ONE
  implementation of V3's chain.
- `packages/catalogue/src/schema/variant-overrides.ts` — `menu_item_variant_overrides` (V13).
- Core migrations (Task 1): `0002_*` (generated, add columns), `0003_*` (generated, recreate
  `products`), `0004_variant_one_level.sql` (custom triggers). Core migration (Task 2): `0005_*`
  (`available`). Core migration (Task 5): `0006_*` (drop the two `variant_id` columns).
- Catalogue migrations: `0001_*` (Task 3: create the overrides table, drop `menu_item_variants`),
  `0002_*` (Task 4: nullable `gross_price`), `0003_*` (Task 9: drop `product_variants`). Numbers are
  indicative — let `drizzle-kit generate` assign them against the tree as it is.

**Modified, by task:** listed in each task's **Files** block.

---

## Task 1: `parent_id`, the inherited columns, and ONE fallback read — slug `parent-id`

Spec §1.2 as revised by §15.2/§15.3. After this task a variant row CAN exist and every reader
resolves it correctly, but nothing writes one, so nothing a user sees changes.

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts` (`products`), `packages/db/src/trigger-refusals.ts`, `packages/db/src/index.ts`
- Create (generated, TWO generations — Step 5): `packages/db/drizzle/0002_*.sql`, `0003_*.sql`; Create (custom): `packages/db/drizzle/0004_variant_one_level.sql`
- Create: `packages/catalogue/src/variant-fallback.ts`, `variant-fallback.test.ts`
- Modify: `packages/catalogue/src/operations.ts` (`PRODUCT_BASE_COLUMNS`, `listProducts`, `createProduct`'s re-read at `:749-754`, `listMenuOffers`, `listAvailableProducts`), `offered-modifiers.ts` (`:140`), `product-editor.ts`; `apps/server/src/working-order.ts` (the extras-product read in `resolveBasketModifiers`, `:185-193`); `docs/backlog.md` (the wipe line)
- Test: `scripts/behavioural-triggers.test.ts`, `scripts/schema-constraints.test.ts`, `packages/catalogue/src/migrations.test.ts`, `apps/server/src/till-sale.test.ts`

**Interfaces:**
- Produces (schema): `products.parentId: id("parent_id")` (nullable), `products.variantOrder:
  count("variant_order").notNull().default(0)`; `vatClass`, `pricingUnit`, `unitPrice`,
  `dietaryDeclarations` become NULLABLE; check `products_top_level_owns_ck`; unique
  `products_id_catalogue_key (id, catalogue_id)` and `products_parent_id_key (parent_id, id)` (the
  target Task 3's overrides table needs); foreign key `(parent_id, catalogue_id) → products (id,
  catalogue_id)`, on delete restrict.
- Produces (db): `VARIANT_ONE_LEVEL_REFUSAL`, `VARIANT_PARENT_FIXED_REFUSAL` exported from `@waitron/db`.
- Produces (catalogue): `parentProducts`, `effectiveProductColumns`, `INHERITED_KEYS`,
  `inheritFromParent`. Every reader below returns EFFECTIVE values with unchanged TypeScript types
  (`vatClass: VatClass`, `unitPrice: Decimal`, never nullable); the nullability stops in the
  fallback module.

**The inherited set** (spec §1.2 minus the names, per §15.2): `description`, `vat_class`,
`pricing_unit`, `unit_price` (§15.3), `category_id` (with the `product_categories` membership rows
and the `product_units` unit row — a variant with NO row of its own reads its parent's), `station_id`,
`course_id`, `image` (V11), `allergens`, `manual_allergens`, `recipe_derivation`, `diet_derivation`,
`diet_override`, `diet`, `dietary_declarations`. **Never inherited:** `id`, `catalogue_id`, `name`,
`customer_name`, `kitchen_name`, `active`, `sold_alone`, `parent_id`, `variant_order`, timestamps (and
Task 2's `available`).

- [ ] **Step 1: Write the failing trigger cases.** In `scripts/behavioural-triggers.test.ts`, add one
  `describe` block per trigger, named after it, migrated through `applyMigrations` like the file's
  other blocks, each case asserting the exact refusal text, each with an accepting control:
  - inserting a product whose `parent_id` names a product that itself has a `parent_id` →
    `VARIANT_ONE_LEVEL_REFUSAL`; control: naming a parent with no parent is accepted.
  - updating `parent_id` on an existing row — setting it on a top-level product (including one that
    HAS variants), changing it, or clearing it →
    `VARIANT_PARENT_FIXED_REFUSAL`; control: updating any other column of a variant is accepted, and
    inserting a second variant under the same parent is accepted.
  - a product naming itself as parent → `VARIANT_ONE_LEVEL_REFUSAL`.
  - a new row naming a parent when a variant naming IT was already written (foreign keys deferred) →
    `VARIANT_ONE_LEVEL_REFUSAL`; control: the same order with the new row top-level is accepted.
  - `INSERT OR REPLACE` of a variant naming another parent, or none → `VARIANT_PARENT_FIXED_REFUSAL`;
    control: the same replace naming the parent it already has is accepted.
  - changing a product's `id` → `PRODUCT_ID_FIXED_REFUSAL`, including a variant renamed onto an id a
    waiting child names, and `UPDATE OR REPLACE` onto a variant's id; control: an update writing the
    same id back is accepted.
  Three triggers make the whole rule. The insert trigger checks the parent a new row names, and also
  that the new row has no variants already, because deferred foreign keys let a variant be written
  before its parent; it also refuses an `INSERT OR REPLACE` that names a different parent from the
  row it replaces, which the update triggers never see. Every UPDATE route to a second level changes
  `parent_id` or `id`, and the other two triggers refuse each outright. Add all three names to the
  file's name pin.

- [ ] **Step 2: Write the failing schema-constraint entries.** In `scripts/schema-constraints.test.ts`
  add the foreign-key entry `["products", ["parent_id", "catalogue_id"], "products"]` (this guard's
  entries carry no names), the unique indexes `products_id_catalogue_key` and
  `products_parent_id_key`, and `products_top_level_owns_ck` in `EXPECTED_CHECK_CONSTRAINTS`. **Do not
  add an offending-insert case here** — the file's header says it reads the built schema and tries
  none; the cross-catalogue refusal goes in `variant-fallback.test.ts` (Step 8). **This guard runs
  outside a transaction, where `PRAGMA foreign_keys=OFF` works**, so it can pass while the product's
  migrator — inside `BEGIN`, where that pragma does nothing — fails. Only a suite that migrates
  through `applyMigrations` or `useVenueDb` proves the migration applies.

- [ ] **Step 3: Run both to verify they fail.**
  Run: `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts`
  Expected: FAIL — the triggers, keys, indexes and check do not exist.

- [ ] **Step 4: Change the schema** (applied in two halves in Step 5). In
  `packages/db/src/schema/catalogue.ts`:

```ts
    // Set only on a VARIANT (spec §1.2, §15): the product it is a variant of. One level only,
    // fixed when the row is created, and the row's `id` never changes either — all enforced by
    // triggers, which cannot be declared here (0004_variant_one_level.sql;
    // scripts/behavioural-triggers.test.ts). Same catalogue as the parent: the composite key below.
    parentId: id("parent_id"),
    // A variant's position among its parent's variants (spec §15.5); unused with no parent.
    variantOrder: count("variant_order").notNull().default(0),
```

  Drop `.notNull()` from `vatClass`, `pricingUnit`, `unitPrice` and `dietaryDeclarations` (keep
  `dietaryDeclarations`' `.default([])`, so a top-level insert that omits it still gets `[]`), and in
  the table's extra config add:

```ts
    unique("products_id_catalogue_key").on(t.id, t.catalogueId),
    unique("products_parent_id_key").on(t.parentId, t.id),
    foreignKey({
      columns: [t.parentId, t.catalogueId],
      foreignColumns: [t.id, t.catalogueId],
    }).onDelete("restrict"),
    // A product with no parent owns every value a variant may inherit (spec §1.2, §15.3).
    check(
      "products_top_level_owns_ck",
      sql`${t.parentId} is not null or (${t.vatClass} is not null and ${t.pricingUnit} is not null and ${t.unitPrice} is not null and ${t.dietaryDeclarations} is not null)`,
    ),
```

  The existing `products_pricing_unit_ck` and `products_vat_class_ck` (the only checks on `products`,
  `catalogue.ts:136-139`) pass a NULL (a CHECK is satisfied by NULL — measured by the first review);
  Step 8 pins it with a variant insert.

- [ ] **Step 5: Generate in TWO steps, then write the custom trigger migration.** One generation
  does not apply: drizzle's rebuild copies `parent_id` and `variant_order` out of the old table
  (`no such column: "parent_id"`), and with the columns but not the unique index present, the
  rebuild's copy fails `foreign key mismatch - "__new_products" referencing "products"`, because the
  migrator runs inside `BEGIN` and the generated `PRAGMA foreign_keys=OFF` does nothing there (both
  measured by the first review). So:
  1. Add ONLY `parentId`, `variantOrder` and the two unique indexes; run
     `pnpm --filter @waitron/db db:generate`. READ `0002_*.sql`: `ALTER TABLE … ADD` lines and
     `CREATE UNIQUE INDEX` lines, no rebuild.
  2. Then make the four columns nullable and add the foreign key and the check; run
     `pnpm --filter @waitron/db db:generate` again. READ `0003_*.sql`: it recreates `products` and
     must carry the composite key and the check.
  3. Run `pnpm --filter @waitron/db db:generate:custom --name=variant_one_level` and write
     `0004_variant_one_level.sql` in the style of `0001_behavioural_triggers.sql` (a body of
     `SELECT raise(abort, '…') WHERE <refused case>;`). Its header says the
     triggers live on `products` and that **any later migration that recreates `products` drops
     them** — the name pin in `scripts/behavioural-triggers.test.ts` is what notices.

  The file below its header, verbatim:

```sql
-- A new row naming a parent is refused when that parent is the row itself or is a variant, or when
-- the new row already has variants of its own. The last case exists because foreign keys can be
-- deferred, as configuration transfer defers them (`apps/server/src/configuration-transfer.ts`),
-- so a variant can be written before the parent it names.
--
-- The second statement holds the fixed parent on an insert that names a taken id. This trigger runs
-- before the conflict is resolved, while the stored row is still in the table, so any such insert
-- naming a different parent is refused whatever its conflict clause, when the one-level check has
-- not already refused it — among them `INSERT OR REPLACE`, which never runs the update trigger
-- below, and a plain insert, before the primary key sees it.
CREATE TRIGGER products_variant_one_level_insert
BEFORE INSERT ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent must be a product with no parent, and a variant cannot have variants of its own')
  WHERE new.parent_id IS NOT NULL
    AND (new.parent_id = new.id
      OR (SELECT parent_id FROM products WHERE id = new.parent_id) IS NOT NULL
      OR exists (SELECT 1 FROM products WHERE parent_id = new.id));
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE exists (SELECT 1 FROM products WHERE id = new.id AND parent_id IS NOT new.parent_id);
END;
--> statement-breakpoint
-- `parent_id` never changes after insert: not set on a top-level product, not moved, not cleared.
CREATE TRIGGER products_variant_parent_fixed_update
BEFORE UPDATE OF parent_id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a variant''s parent is fixed when it is created')
  WHERE new.parent_id IS NOT old.parent_id;
END;
--> statement-breakpoint
-- `id` never changes after insert. Without this an UPDATE reaches a second level, or clears a
-- parent, without naming `parent_id`: a variant renamed onto an id a waiting child already names
-- (foreign keys deferred) makes a second level, and `UPDATE OR REPLACE` moving a top-level row onto
-- a variant's id deletes the variant and leaves a top-level row in its place.
CREATE TRIGGER products_id_fixed_update
BEFORE UPDATE OF id ON products
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a product''s id never changes')
  WHERE new.id IS NOT old.id;
END;
```

  The insert trigger also refuses a new row that names a parent and already has variants, because
  deferred foreign keys (as configuration transfer runs them) let a variant be written before the
  parent it names — `scripts/behavioural-triggers.test.ts`'s case "refuses a product naming a parent
  when it already has a variant of its own".

  Put the messages in `trigger-refusals.ts` as `VARIANT_ONE_LEVEL_REFUSAL`,
  `VARIANT_PARENT_FIXED_REFUSAL` and `PRODUCT_ID_FIXED_REFUSAL`, the first two exported from
  `packages/db/src/index.ts`.

- [ ] **Step 6: Prove the migration APPLIES, and record the upgrade result.** Run
  `pnpm --filter @waitron/db exec vitest run` and `pnpm --filter @waitron/catalogue exec vitest run
  src/migrations.test.ts` — both migrate fresh databases inside the migrator's transaction, the case
  the schema guard cannot see. Add no test that the media triggers survive on a fresh database (media
  migrates after core there, and the `IMAGE_REFERENCE_TRIGGERS` name pin in
  `scripts/behavioural-triggers.test.ts` already asserts those names, so it could not fail). Re-run the upgrade once on the final migrations
  (migrate a venue directory on `main`, then again with this branch) and paste what it printed into
  the PR. Add one line to `docs/backlog.md`: after this lands every dev venue needs
  `wa-wt reset demo <name>`, and no provisioned box takes the image without a wipe.

- [ ] **Step 7: Run the guards to verify they pass.**
  Run: `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/catalogue-engine-neutral.test.ts scripts/two-file-foreign-keys.test.ts`
  Expected: PASS.

- [ ] **Step 8: Write the failing fallback tests.** Create `packages/catalogue/src/variant-fallback.test.ts`
  on `useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] })`. Fixture: a parent "Wine
  by the glass" with every inherited field set to a distinct value (price 4.00, VAT `reduced`,
  description, a category, a unit, a station, a course, allergens, an image) and its own customer
  and kitchen names; two variants inserted DIRECTLY (`tx.insert(products)`, no write path exists
  yet): "Wine 125" with every inherited field `null` (dietary declarations passed as an explicit
  `null`) and NO customer or kitchen name, and "Wine 175" overriding price (5.50), VAT (`general`)
  and image, with its own customer and kitchen names. Assert:
  - `listProducts(tx, catalogueId)` → Wine 125 reads price 4.00, VAT `reduced`, the parent's
    description, category ids, unit and image — and its OWN `customerName` and `kitchenName`, both
    null (names are never inherited); Wine 175 reads its own price, VAT, image and names.
  - `listMenuOffers(tx, [menuId])` on offer rows for the two variants inserted directly into
    `menu_items` → the same effective values. (Task 3 nests variants and replaces these two
    assertions with the nested form.)
  - `listAvailableProducts(tx, locationId)` → both variants ABSENT; the parent present (Review Focus 4).
  - `readOfferedModifiers` for an extras list naming Wine 125 → its VAT is `reduced`.
  - `createProduct` of a new top-level product returns its values (its re-read needs the parent
    join, `operations.ts:749-754`).
  - on the plain `productId` sale path (`apps/server/src/till-sale.test.ts`), a line naming Wine
    125's id is refused with `sale.unknown_product`.
  - a variant whose `catalogue_id` differs from its parent's is refused (errcode 787,
    `FOREIGN KEY constraint failed`).
  - a top-level product with a null `vat_class` or null `unit_price` is refused (errcode 275,
    `CHECK constraint failed: products_top_level_owns_ck`); a variant with both null is accepted.
  - a variant inserted WITHOUT the `dietary_declarations` field stores `[]` (the column default), and
    one inserted with explicit `null` reads the parent's — pin both, which is why every variant
    writer passes `null` explicitly.
  - `inheritFromParent` (pure) → a null inherited key takes the parent's, a set one keeps its own,
    and `name` / `customerName` / `kitchenName` / `active` are never taken from the parent even when
    null or different.

- [ ] **Step 9: Run to verify they fail.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/variant-fallback.test.ts`
  Expected: FAIL — the module does not exist; the readers return nulls for Wine 125.

- [ ] **Step 10: Implement `variant-fallback.ts`.**

```ts
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { products } from "@waitron/db";

/** The parent row of a variant, joined as `parent` (left join: a top-level product has none). */
export const parentProducts = alias(products, "parent");

/**
 * Each inherited field as `coalesce(product.x, parent.x)`: a blank on a variant reads as its
 * parent's (spec §1.2, §15.2 — never the three names). `.mapWith(column)` keeps the column's own
 * decoding: `coalesce` hands a JSON column back as TEXT (measured on drizzle-orm 0.45.2 through
 * the store adapter). Non-null types where products_top_level_owns_ck guarantees the parent's.
 */
export const effectiveProductColumns = {
  description: sql<Record<string, string> | null>`coalesce(${products.description}, ${parentProducts.description})`.mapWith(products.description),
  vatClass: sql<string>`coalesce(${products.vatClass}, ${parentProducts.vatClass})`.mapWith(products.vatClass),
  unitPrice: sql<number>`coalesce(${products.unitPrice}, ${parentProducts.unitPrice})`.mapWith(products.unitPrice),
  // …one entry per remaining field of the inherited set above, in the same form.
};

export const INHERITED_KEYS = [/* the inherited set, as the TypeScript keys */] as const;

/** The same rule over rows already in memory: inherited keys only. */
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

  Category membership and the unit row: a variant with no `product_categories` rows reads its
  parent's, one with no `product_units` row reads its parent's unit; keep ONE query per read
  (CLAUDE.md §3 — never a read per row).

- [ ] **Step 11: Route every reader through it.** `PRODUCT_BASE_COLUMNS` (for
  `listProducts`/`toProduct`), `listMenuOffers`, `listAvailableProducts` and `createProduct`'s
  re-read take their inherited entries from `effectiveProductColumns`, each query gaining
  `.leftJoin(parentProducts, eq(parentProducts.id, products.parentId))`; `listAvailableProducts`
  also adds `isNull(products.parentId)`. Same in `offered-modifiers.ts` (`:140`), `product-editor.ts`'s
  `columns` (Task 6 replaces this with a raw read plus hints) and `working-order.ts`'s
  `resolveBasketModifiers` read (`:185-193`). **Find the rest by the compiler:** the four columns
  going nullable make every direct read type as nullable; each flagged site either goes through the
  fallback or states at the site why it reads the raw value. Run
  `pnpm --filter "@waitron/*" typecheck` until clean. (The compiler cannot find readers of columns
  that were ALREADY nullable — Review Focus 3 names those, and Task 5 fixes them.)

- [ ] **Step 12: Run to verify they pass, then the affected suites.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/variant-fallback.test.ts src/operations.test.ts src/offered-modifiers.test.ts src/product-editor.test.ts src/migrations.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/till-sale.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`.
  Expected: PASS, the golden huella unchanged.

- [ ] **Step 13: Commit** (`git commit -s`), saying what a variant row now is, what reads it, and
  the upgrade result from Step 6.

---

## Task 2: Active and Available become two states — slug `available`

Spec §15.6, V6. Products only — no variant is written yet. After it, "sold out for now" and
"deleted" are different things everywhere.

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts` (`products.available`); Create (generated): `packages/db/drizzle/0005_*.sql`
- Modify: `packages/catalogue/src/product-types.ts`, `product-editor.ts`, `product-editor-input.ts`, `operations.ts` (`listMenuOffers`, `listAvailableProducts`, `toProduct`, create/update), `offered-modifiers.ts` (`readExtraProducts`), `apps/server/src/catalogue-api.ts`, `apps/server/src/working-order.ts` (`resolveBasketModifiers`)
- Modify: `apps/dashboard/src/widgets/product-list.ts`, `product-editor.ts`, `screens/catalogue-screen.ts`, `api/client.ts`, `i18n/strings.ts`
- Test: the matching `*.test.ts`, `*.a11y.test.ts`; `apps/server/src/catalogue-api.test.ts`, `till-sale.test.ts`

**Interfaces:**
- Produces: `products.available: flag("available").notNull().default(true)` — sold out for now, never
  inherited. `Product.available: boolean` beside `Product.active`. The editor body's `available`
  now writes `products.available`; a new `active` field in the body writes `products.active`.
  Every sellable read (`listMenuOffers`, `listAvailableProducts`) requires `active AND available`.

- [ ] **Step 1: Write the failing tests.**
  - server: saving the product editor with `available: false` leaves `active` true and the product
    absent from `listMenuOffers` and `listAvailableProducts`; saving `active: false` does the same
    and leaves `available` as it was; saving both true brings it back.
  - server (V16): an Unavailable or Inactive product named by an extras list is not offered as an
    extra (`readOfferedModifiers`), and an order picking it as an extra is refused with the extras
    family's existing "not available" code — grep `packages/catalogue/src/errors.ts` for the
    `extras.*` sibling and reuse it rather than coining one.
  - dashboard: the products list has a **status** filter (`Active` / `Inactive` / any, the pattern
    `extras.filter_status_all` uses), defaulting to Active, so an Inactive product is hidden until
    the filter is changed; the list's Active column reads `active`; an Unavailable product stays
    listed with an "Unavailable" badge.
  - dashboard: the editor's *Available* switch sends `available`; **Delete** sends `active: false`
    (`catalogue-screen.ts:260` today sends `available: false`); an Inactive product's editor offers
    **Restore** (`active: true`).
- [ ] **Step 2: Run to verify they fail** (`pnpm --filter @waitron/catalogue exec vitest run …`,
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/till-sale.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/widgets/product-editor.test.ts src/screens/catalogue-screen.test.ts`).
- [ ] **Step 3: Implement**: the column (`pnpm --filter @waitron/db db:generate`, READ it: an
  `ALTER TABLE … ADD`, no rebuild), the reads, the editor contract, the list filter and badge, the
  Delete/Restore actions, English and Spanish strings. Record the terminology in
  `docs/developers/design-system.md` as the products screens' rule (the dashboard-wide terminology
  item stays on the backlog).
- [ ] **Step 4: Run to verify they pass; open the products list and editor in both themes and at
  phone width and LOOK. Step 5: Commit** (`git commit -s`).

---

## Task 3: Variants are stored as products, and follow their parent onto menus — slug `storage`

Spec §15.1, §15.3, §15.5, §15.6; V1, V3, V5, V6, V7, V13. The product-editor body and the till's wire
shape are unchanged; the per-menu variant endpoint and its screen change shape (V5).

**Files:**
- Modify: `packages/catalogue/src/variants.ts`, `operations.ts` (`listProducts`, `listMenuOffers`), `content-languages.ts` (`:73` and the variant branch), `menu-types.ts`, `classification.ts`, `configuration-transfer.ts`
- Create: `packages/catalogue/src/schema/variant-overrides.ts`, `offer-price.ts`, `offer-price.test.ts`; Create (generated): `packages/catalogue/drizzle/0001_*.sql` (create the overrides table, drop `menu_item_variants`)
- Modify: `packages/module/src/module.ts` (`ZoneMenuOffer`), `packages/media/src/images.ts`, `apps/server/src/catalogue-api.ts` (`:887-906`, `parseMenuVariants` `:319-337`), `apps/server/src/working-order.ts` (the batched variant read)
- Modify: `packages/venue-service/src/dashboard/venue-operations-screen.ts` (`:854-1027`), `client.ts` (`:98-102`, `:235-247`), `strings.ts`
- Modify: `apps/server/scripts/demo-seed/menu.ts`, `seed-catalogue.ts`, `seed-catalogue.test.ts`
- Modify: `packages/catalogue/src/errors.ts` (`menu_item.variant_not_allowed`), `product-editor.ts` (read Active variants only), `schema/menu.ts:88` (stale comment); `packages/venue-service/src/dashboard/live-queries.ts` (subscribe to the overrides table beside `menu_items`)
- Test: `packages/catalogue/src/variants.test.ts`, `variants.db.test.ts`, `operations.test.ts`, `content-languages.test.ts`, `variant-fallback.test.ts`, `migrations.test.ts` (it imports and pins `menu_item_variants` at `:29, 52-53, 164, 184-187, 217, 502-538` — replace those with the overrides table); `scripts/schema-constraints.test.ts` (remove `menu_item_variants`' foreign keys `:100-101` and `menu_item_variants_price_ck` `:330`; add the overrides table's two foreign keys and checks); `scripts/live-subscriptions.test.ts`; `packages/media/src/images.test.ts`; `apps/server/src/catalogue-api.test.ts`, `till-sale.test.ts`, `working-order.test.ts`; `packages/venue-service/src/dashboard/venue-operations-screen.test.ts` (+ a11y)

**Interfaces:**
- Consumes: Task 1's columns and fallback; Task 2's `available`.
- Produces:
  - `menu_item_variant_overrides (menu_item_id, product_id, variant_id, price money NULL, offered
    flag NOT NULL DEFAULT true)`, primary key `(menu_item_id, variant_id)`, foreign keys
    `(menu_item_id, product_id) → menu_items (id, product_id)` on delete cascade and
    `(product_id, variant_id) → products (parent_id, id)` on delete restrict, checks
    `menu_item_variant_overrides_price_ck` (`price >= 0`) and
    `menu_item_variant_overrides_overrides_ck` (`price is not null or offered = 0` — a row that
    overrides nothing cannot be stored), classified `state` in `CATALOGUE_CLASSIFICATION`, and listed
    after `menu_items` in `configuration-transfer.ts` (nothing guards that list's completeness —
    `composition.test.ts:89-132` checks only module kind and forbidden tables). Measured by the second
    review: both composite keys are declared by drizzle and enforced (a top-level product as the
    variant, another parent's variant, or a product not the offer's are each refused, errcode 787;
    deleting the offer cascades; deleting an overridden variant is refused, errcode 1811).
  - `resolveOfferPrice({ variantMenuPrice, variantPrice, parentMenuPrice, parentPrice }): Decimal` —
    the first non-null, in that order (V3). **`variantPrice` is the variant's RAW
    `products.unit_price`, never `effectiveProductColumns.unitPrice`**: the effective value is
    already `coalesce(variant, parent)`, never blank, so passing it would skip the parent's MENU
    price and charge the parent's catalogue price. Task 4 makes `parentMenuPrice` nullable.
  - `MenuOffer.unitPrice: string` (resolved; for a top-level offer, `grossPrice` until Task 4), which
    the order path reads from now on in place of `grossPrice`.
  - `listProductVariants` / `setProductVariants` keep their signatures over `products` rows with
    `parent_id`. `ProductVariant` becomes `{ id, name, customerName, kitchenName, image,
    unitPrice: string | null, available, active }`; a variant absent from a save is made INACTIVE
    (V6), never deleted.
  - `listMenuVariants(tx, menuItemId, menuId?)` → every ACTIVE variant of the offer's product with
    `{ variantId, price: string | null, offered: boolean }` (the override, or `null`/`true`);
    `setMenuVariants(tx, menuItemId, [{ variantId, price, offered }], menuId?)` writes a row only for
    an entry that overrides something and deletes the rest. The route
    `PUT /management-api/catalogues/:id/items/:itemId/variants` takes that shape.
  - `MenuOffer.variants: MenuOfferVariant[]` (and `ZoneMenuOffer.variants`), a NEW type — not
    `ProductVariant`, whose `unitPrice` becomes nullable in this task: `{ id, name, customerName,
    kitchenName, image, unitPrice: string /*resolved*/, menuPrice: string | null /*the stored
    override*/, offered: boolean, available: boolean }` plus the variant's EFFECTIVE `vatClass`,
    `pricingUnit`, `unit`, `category`, `courseId`, `allergens`, `diet`, `dietDerivation`,
    `dietOverride`, `dietaryDeclarations`. `available` = variant `active AND available AND offered`.
    Ordered by `variant_order`. A variant appears ONLY nested under its parent's offer.
  - `createMenuItem` refuses a product with a parent: `menu_item.variant_not_allowed` (V13).

- [ ] **Step 1: Write the failing price-chain tests** in `offer-price.test.ts` (Review Focus 2, first
  three steps): four distinct prices; blank the variant's menu price → the variant's own; blank that
  too → the parent's menu price; a set value is never skipped for a less specific one; an override
  of `0.00` wins (zero is a price, not a blank).

- [ ] **Step 2: Write the failing storage tests** in `variants.db.test.ts` (rewrite the file's direct
  `productVariants` inserts to go through `setProductVariants`):
  - `setProductVariants(tx, parentId, [Wine 125 (price null), Wine 175 (5.50)])` creates two
    `products` rows with `parent_id`, the parent's `catalogue_id`, `variant_order` 0 and 1, every
    inherited column NULL — `dietary_declarations` and `diet` included, read back with raw SQL — and
    `unit_price` NULL for Wine 125; `listProductVariants` returns them in that order; re-saving them
    reversed swaps `variant_order` without changing ids.
  - a variant saved with `available: false` has `products.available = 0` and `active = 1`.
  - a variant omitted from a save becomes `active = 0` — its row, ids and every reference kept — and
    is still returned by `listProductVariants` with `active: false` (the editor hides it behind the
    filter in Task 7); saving it again with its id makes it Active.
  - `setProductVariants` naming an id that is not a variant of THIS parent → `product.variant_not_found`.
  - `readProductEditor` returns ACTIVE variants only, so a later save of the parent (which sends back
    every variant it received, and writes `active: true` for each) cannot bring a removed variant
    back; Task 7 widens the read and adds `active` to the save body.
  - `createMenuItem` for a variant → `menu_item.variant_not_allowed`; control: its parent is accepted.
  - a product body with exactly ONE variant is accepted (V1: `product.variant_count_invalid` is
    retired here — left registered, unthrown).
- [ ] **Step 3: Write the failing menu tests** in `operations.test.ts` and `variants.db.test.ts`
  (Review Focus 4):
  - with NO override rows, the parent's own price 4.00 and its menu price on this menu 4.50,
    `listMenuOffers` returns the parent's offer with `variants` [Wine 125, Wine 175] in
    `variant_order`, priced **4.50** (the parent's MENU price — never 4.00, the value a wrongly wired
    chain would charge, which is why the two parent prices differ in this fixture) and 5.50, each with
    its effective VAT and course; Wine 175 overriding VAT to `general` carries `general`. Variants never
    appear as top-level offers. **This replaces Task 1's two top-level `listMenuOffers` assertions in
    `variant-fallback.test.ts`** — rewrite them to read the nested entries; what they pin is kept.
  - a variant added to the catalogue AFTER the parent went on the menu is offered there at once.
  - `setMenuVariants` with `{ variantId: wine175, price: "6.00", offered: true }` writes one row and
    the offer prices Wine 175 at 6.00; with `{ price: null, offered: false }` the variant is not
    offered on that menu; with `{ price: null, offered: true }` the row is deleted.
  - an Inactive or Unavailable variant is not offered (Unavailable is listed `available: false`,
    Inactive is absent); an Inactive or Unavailable parent takes its offer and variants away.
  - a parent whose every variant is not offered on that menu still returns its offer with
    `variants` all unavailable (the till decides the button — Task 5).
- [ ] **Step 4: Run to verify they fail.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/offer-price.test.ts src/variants.db.test.ts src/variants.test.ts src/operations.test.ts`
  Expected: FAIL.

- [ ] **Step 5: Implement the storage.** `variants.ts` over `products`: `listProductVariantsForProducts`
  selects `products` where `parentId in (…)` ordered by `variantOrder, id`. `setProductVariants`
  keeps its validation, accepts a null price, and writes

```ts
const values = {
  name: input.name,
  customerName: input.customerName,
  kitchenName: input.kitchenName,
  image: input.image,
  unitPrice: input.unitPrice === null ? null : decimalToCents(input.unitPrice),
  available: input.available,
  active: true,
  variantOrder: index,
};
// insert: { ...values, parentId, catalogueId: parent.catalogueId, soldAlone: true,
//   and every inherited column as an explicit null — dietaryDeclarations above all, whose column
//   default is [] }
// a current variant absent from the input: update set active = false
```

  **Generate in TWO steps** (Global Constraints — one generation that drops a table and adds
  another stops at a rename prompt): first remove `menu_item_variants` from the schema,
  classification and `configuration-transfer.ts` and run `pnpm --filter @waitron/catalogue
  db:generate` (READ it: one `DROP TABLE menu_item_variants`); then create
  `schema/variant-overrides.ts`, add it to the schema index, `CATALOGUE_CLASSIFICATION` and
  `configuration-transfer.ts`, and generate again (READ it: one `CREATE TABLE`, no rebuild).

- [ ] **Step 6: Implement the offer read.** `listMenuOffers`: the top-level select adds
  `isNull(products.parentId)` and `products.available`; a second select reads the Active variants of
  the offered products with their effective values (Task 1's fallback) — and their RAW `unit_price`
  for the chain — left-joined to their override row for that menu item, and nests them under the
  parent's offer, priced by `resolveOfferPrice`. The order path (`working-order.ts`) now reads
  `offer.unitPrice`, and counts only ACTIVE variants when deciding `product.variant_required` (so a
  product whose variants were all removed sells as itself — V1 — rather than being refused both
  ways until Task 5).
  `listProducts` nests the same way and returns only top-level products at the top level.
  `apps/server/src/working-order.ts` keeps calling `listProductVariantsForProducts` in this task
  (Task 5 removes it).

- [ ] **Step 7: The per-menu screen and route.** `parseMenuVariants` takes
  `{ variantId, price: string | null, offered: boolean }`. On `venue-operations-screen.ts`'s offer
  editor, the variants fieldset lists every Active variant of the product with an **Offered** checkbox
  (default ticked) and a price input left EMPTY unless overridden, whose hint is the price that
  applies (V3: the variant's own price, else the parent's price on this menu). Update its tests,
  including "publishes the variants of the product a new offer is saved for" (`:671`), which now
  asserts that a new offer sends NO overrides and offers every variant.

- [ ] **Step 8: The other readers.** `content-languages.ts`: the product branch (`:73`) gains
  `and parent_id is null` (or every variant is counted twice), and the variant branch reads
  `products where parent_id is not null`, keeping the `'variant'` kind and a link to the parent — pin
  both. `packages/media/src/images.ts`'s `listImageUsages` and `countUsages` read ONE column,
  `products.image`: a row with a `parent_id` is `kind: "variant"` with `productId` = its parent, and a
  variant with a NULL image holds no usage (V11: it borrows the parent's photo). The demo seed's
  variant shape (`menu.ts:61-68`) loses `menuPrice`; Café's "Solo" and "Doble" become full-name
  variants with their catalogue prices; rewrite `seed-catalogue.test.ts`'s raw SQL (`:120-145`).

- [ ] **Step 9: Run to verify.** The catalogue suites above plus `src/content-languages.test.ts
  src/variant-fallback.test.ts`, `pnpm --filter @waitron/media exec vitest run src/images.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/till-sale.test.ts src/working-order.test.ts scripts/demo-seed/seed-catalogue.test.ts`,
  `pnpm --filter @waitron/venue-service exec vitest run`, `pnpm --filter @waitron/catalogue exec vitest
  run src/migrations.test.ts`, `pnpm exec vitest run scripts/classification-complete.test.ts
  scripts/schema-constraints.test.ts scripts/live-subscriptions.test.ts`, and the golden huella test. Expected: PASS, golden unchanged.
  A variant sale still freezes the parent's names and the variant's names in their columns (the
  printing change is Task 5's). Open the menu offer editor in both themes and at phone width and LOOK.

- [ ] **Step 10: Commit** (`git commit -s`). The PR says a dev venue's old per-menu variant rows are
  dropped and `wa-wt reset demo <name>` re-seeds.

---

## Task 4: A blank menu price follows the product's own price — slug `menu-price`

Spec §15.3's fourth step, V14. Applies to every product on a menu, variant or not.

**Files:**
- Modify: `packages/catalogue/src/schema/menu.ts` (`grossPrice` nullable); Create (generated): `packages/catalogue/drizzle/0002_*.sql`
- Modify: `packages/catalogue/src/operations.ts` (`createMenuItem`, `updateMenuItem`, `listMenuOffers`), `menu-types.ts` (`MenuItem.grossPrice: string | null`), `offer-price.ts`, `apps/server/src/catalogue-api.ts` (`POST`/`PATCH …/items`); `packages/module/src/module.ts` (`ZoneMenuOffer.grossPrice`); `apps/till/src/api/client.ts`; `apps/server/scripts/demo-seed/seed-catalogue.ts`
- Modify: `packages/venue-service/src/dashboard/venue-operations-screen.ts`, `client.ts`; `docs/backlog.md` (the reset line)
- Test: `offer-price.test.ts`, `operations.test.ts`, `apps/server/src/catalogue-api.test.ts`, `till-sale.test.ts`, `venue-operations-screen.test.ts`

- [ ] **Step 1: Write the failing tests.** `offer-price.test.ts` completes Review Focus 2: blank the
  parent's menu price → the parent's own price, and the whole four-step walk from one fixture.
  `operations.test.ts`: an offer created with no price sells at the product's own (effective) price,
  and changing the product's price moves it; one with a price keeps it. `catalogue-api.test.ts`: the
  item routes accept `grossPrice: null`; the `menu_items_gross_price_ck` check still refuses a
  negative. Screen: the offer's price input is empty with the product's price as hint, and saving it
  empty sends `null`; each variant's price hint, and the till's "+€" label (Task 5), use the parent's
  RESOLVED offer price.
- [ ] **Step 2: Run to verify they fail. Step 3: Implement** (drop `.notNull()`, regenerate and READ
  the migration — a recreate of `menu_items` is expected; run `pnpm --filter @waitron/catalogue exec
  vitest run src/migrations.test.ts` and `scripts/schema-constraints.test.ts`). The PR and a
  `docs/backlog.md` line state the measured upgrade damage from "Task 1 cannot upgrade an existing
  venue" above — the silent emptying of `menu_item_extra_lists` and the overrides table, and the
  boot failure with an open order — and that every dev venue needs `wa-wt reset demo <name>`. Every reader of `menu_items.gross_price` goes
  through `resolveOfferPrice` — find them with `grep -rn "grossPrice" packages apps --include='*.ts'`
  and the compiler. **Step 4: Run to verify they pass, LOOK at the screen. Step 5: Commit.**

---

## Task 5: A variant is sold as the product it is — slug `sale-line`

Spec §15.1, §15.2, §15.4, §4.3, decision 11; V1, V2, V4, V8, V9, V15.

**Files:**
- Modify: `packages/db/src/schema/orders.ts`, `sales.ts` (drop `variantId`; fix the stale `0031` pointer at `sales.ts:230`); Create (generated): `packages/db/drizzle/0006_*.sql`
- Modify: `packages/core/src/sale-line.ts`, `sale-line-rows.ts`; `packages/catalogue/src/pricing.ts`, `variants.ts` (delete `listProductVariantsForProducts`), `product-presentation.ts`, `menu-types.ts`, `operations.ts`, `index.ts`
- Modify: `apps/server/src/working-order.ts` (the offer-line build and the variant text re-keying in `priceOrderLines`, kitchen routing in `fireLines`, kitchen-screen allergens in `readQueueSubItems` — the dish's, and each extra's allergens and dietary declarations — the held-order fast path in `updateHeldOrder`); `packages/venue-service/src/operations.ts` (preparation routes, `resolvePreparationRouteOutcomes`)
- Modify: `apps/till/src/api/client.ts`, `state/order-line.ts`, `widgets/modifier-picker.ts`, `widgets/product-grid.ts`, `widgets/product-name.ts`, `menu-filter.ts`, `till-app.ts` (retrieval)
- Test: `packages/db/src/schema/variant-snapshot-columns.test.ts`, `sales.test.ts` (`:516-525`: `["variant_id"]` → `[]`), `orders.test.ts` (`:500-517`: `["product_id","variant_id"]` → `["product_id"]`), `packages/core/src/sale-line-rows.test.ts`, `packages/catalogue/src/pricing.test.ts`, `product-presentation.test.ts`, `variants.db.test.ts`; `apps/server/src/till-sale.test.ts`, `working-order.test.ts`, `kitchen-print.test.ts`, `receipt-ticket.test.ts`, `tabs.test.ts`; `apps/till/src/widgets/modifier-picker.test.ts`, `product-grid.test.ts`, `product-name.test.ts`, `basket.test.ts`, `state/order-line.test.ts`; `packages/fiscal-verifactu/src/write-path.e2e.test.ts`
  (Tighten pinned column lists rather than deleting those cases. The name-join assertions that change are listed in Step 2 and named in the PR.)

**Interfaces:**
- Consumes: Task 3's nested `MenuOffer.variants[]` with effective values and resolved prices.
- Produces: `TillProduct.variants[]` gains `unitPriceDifference: string | null` (the variant's
  resolved price minus the parent's resolved offer price, negative when cheaper, null when equal);
  "has variants" is simply a non-empty `MenuOffer.variants` (Inactive variants are never in it); `SelectedVariant.productId: string` (the variant, or the
  parent when it has no Active variants) replacing `variantId`; `working_order_lines.product_id` =
  that product. Wire unchanged: `{ menuItemId, variantId? }` (V8).
- Presentation (V2): for a line with a variant, `staffPresentationName` returns the variant name;
  `kitchenPresentationName` the variant's kitchen name, else its staff name;
  `joinCustomerPresentationText` the variant's customer text per locale, else the variant's staff
  name. A line without a variant is unchanged byte for byte.

- [ ] **Step 1: Write the failing fiscal test FIRST (Review Focus 1).** In `write-path.e2e.test.ts`,
  beside the golden block, a sale of "Wine by the glass" (`reduced`) with a Wine 125 line (VAT
  inherited) and a Wine 175 line (VAT `general`, set with a direct `tx.update(products)`): the filed
  `vatBreakdown` carries 10% and 21%. Pin that no variant field reaches the fingerprint the way the
  `describe("entorno is not part of the huella")` test does (`packages/fiscal-verifactu/src/verify.test.ts:215`): two sales with the
  pinned tax id differing ONLY in variant names hash the same. The golden block stays UNEDITED.

- [ ] **Step 2: Write the failing order-path and presentation tests.**
  - `{ menuItemId: parentItem, variantId: wine125 }` writes `working_order_lines.product_id =
    wine125`, `name`/`descriptions`/`kitchen_name` = the PARENT's frozen names and
    `variant_name`/`variant_descriptions`/`variant_kitchen_name` = Wine 125's OWN RAW values, priced
    and taxed from the variant's effective offer values (Wine 175 at 5.50 and 21%).
  - `{ menuItemId: parentItem }` alone → `product.variant_required` (V1); a product with no Active
    variants (all Inactive) sells as itself.
  - an Inactive, Unavailable, not-offered or other-parent `variantId` → `product.variant_unavailable`.
  - Review Focus 3: a Wine 125 line fires to the station its PARENT resolves to (product route,
    then category route), carries the parent's course, shows the PARENT's allergens on the kitchen
    screen, and takes a preparation route keyed on the parent's product id — each with a Wine 175
    control that overrides the field and gets its own value.
  - Review Focus 3, extras: an extras line whose product is a variant inheriting its allergens and
    dietary declarations shows its PARENT's allergens and dietary labels on the kitchen screen
    (`addAllergens` and `suitableFor` in `readQueueSubItems`), with a control variant that overrides
    both and shows its own.
  - Review Focus 5 / V2: a Wine 125 line with NO customer or kitchen name prints "Wine 125" on the
    receipt in every invoice locale, on the kitchen ticket, in the basket, on the tab and in the expo
    queue; its stored `variant_descriptions` carries exactly the venue's invoice locales, filled with
    "Wine 125" (the variant-locales trigger accepts it). A line with no variant is unchanged. **The
    assertions that change:** every pinned "`Coffee · Double`"-shaped string becomes the variant's
    name alone — `product-presentation.test.ts`, `product-name.test.ts`, `till-sale.test.ts`,
    `kitchen-print.test.ts` (`:997`, `:1007`), `receipt-ticket.test.ts`, `basket.test.ts` — list each
    in the PR.
  - held orders: a change of variant alone on a kept line re-prices it (closes the gap at
    `updateHeldOrder`'s kept-line check in `working-order.ts`); a quantity-only edit of a variant
    line with an options answer keeps its line id and locked price (the fast path looks lists up by
    the PARENT's id, since a variant carries none of its own — `updateHeldOrder`'s fast path); a
    retrieved held order returns each line's `variantId` (the line's `product_id` when that product
    has a parent).
  - the filed `sale_lines` row has no `variant_id` column (`pragma table_info(sale_lines)`).
- [ ] **Step 3: Write the failing till tests** (V4). `product-grid.test.ts`: an Active, Available
  offer gets a button whether or not `soldAlone`; a parent whose variants are all unavailable gets
  none. `order-line.test.ts`: `needsModifierPicker` is true for a product with variants.
  `modifier-picker.test.ts`: the picker lists ONLY the variants, never the parent; the first AVAILABLE
  one in variant order is preselected and Save is enabled at once; an unavailable variant is shown
  disabled; a variant priced above its parent shows "+€1.50" beside its price, one priced below
  shows "−€0.50", one at the same price shows no label.
- [ ] **Step 4: Run to verify they fail**, each suite with `pnpm --filter <package> exec vitest run <file>`.

- [ ] **Step 5: Schema.** Remove `variantId` from `workingOrderLines` and `saleLines`; run
  `pnpm --filter @waitron/db db:generate` and READ `0006_*.sql`: two `ALTER TABLE … DROP COLUMN`
  statements, NOT a rebuild (measured by the first review: with a row in `sale_lines` and its
  append-only triggers installed, the drop kept the row and both triggers, and an update was still
  refused). If drizzle emits a rebuild, STOP and record it. Re-run
  `scripts/behavioural-triggers.test.ts` and `scripts/append-only-triggers.test.ts`; update
  `variant-snapshot-columns.test.ts` and tighten `sales.test.ts` / `orders.test.ts`.

- [ ] **Step 6: Implement.** `selectMenuVariant` returns `productId` and the chosen row's effective
  pricing values, and raises `variant_required` when `offer.variants` is non-empty.
  `working-order.ts`'s offer-line build takes `vatClass`, `pricingUnit`, `unit`, `courseId`,
  `category` and price from the selection. Kitchen routing, the kitchen-screen allergen read (the
  dish's, in `readQueueSubItems`), the same function's child read of each extra's allergens and
  dietary declarations, and preparation-route resolution join the parent through `parentProducts` /
  `effectiveProductColumns` and match product-level routes on
  `coalesce(products.parent_id, products.id)`. The variant-text re-keying (in `priceOrderLines`)
  fills a blank locale with the VARIANT's staff name. `product-presentation.ts` implements V2 in its
  one join function. Delete `listProductVariantsForProducts` (V15). Remove every `variantId` from
  the row writes, `readLockedLines`, `carveOffLines`, `getHeldOrder` (which derives it from the
  product's parent), the pricing types and `RecordSaleLine` / `saleLineRows`; `updateHeldOrder`'s
  same-line test compares the stored `product_id` with the resolved one. Till:
  `menuOfferToTillProduct` maps the price difference; `visibleProducts` / `product-grid` applies V4;
  the picker lists variants only and preselects the first available.

- [ ] **Step 7: Run to verify they pass**, then `pnpm --filter @waitron/server exec vitest run
  src/kitchen-print.test.ts src/receipt-ticket.test.ts src/split-bill.test.ts src/tabs.test.ts
  src/served-at-huella.test.ts src/print-job-preview.test.ts`, `pnpm --filter @waitron/venue-service
  exec vitest run`, `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts
  src/schema/orders.test.ts src/schema/variant-snapshot-columns.test.ts`, and the golden huella test,
  unedited. Open the till in both themes and at phone width and LOOK at the picker and a receipt
  preview.

- [ ] **Step 8: Commit** (`git commit -s`).

---

## Task 6: A variant's own product page — the API — slug `editor-api`

Spec §4.4, §9.1, §15.2, §15.3; V2, V10.

**Files:**
- Modify: `packages/catalogue/src/product-types.ts`, `product-editor.ts`, `product-editor-input.ts`, `operations.ts` (`createProduct`, `updateProduct`, allergen/diet republishing, `applyRecipeDerivation`)
- Modify: `apps/server/src/catalogue-api.ts`
- Test: `packages/catalogue/src/product-editor.test.ts`, `product-editor-input.test.ts`, `operations.test.ts`; `apps/server/src/catalogue-api.test.ts`

**Interfaces:**
- Produces: `ProductEditorValue` gains `parentId: string | null` and `inherited: InheritedValues |
  null` — the parent's EFFECTIVE values for every inherited field, `null` on a top-level product. For
  a VARIANT, the value's inherited fields are RAW (null when inheriting). `ProductEditorInput` for a
  variant accepts `null` for every inherited field, `unitPrice` included.

```ts
export interface InheritedValues {
  description: Record<string, string> | null;
  image: string | null;
  unitPrice: string;
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
  - `GET /management-api/products/:variantId/editor` returns `parentId`, raw nulls for the inherited
    fields, the variant's OWN names (never the parent's) and `inherited` holding the parent's values.
  - `PUT` on a variant with `vatClass: null` keeps it inheriting; `"general"` overrides it; clearing
    back to `null` returns it to inheriting (§9.1 — a blank stays blank). The same for `unitPrice`,
    one join-table field (categories) and one JSON field (allergens).
  - allergen and diet publishing for a variant (the first review found both ways it goes wrong:
    `createProduct`/`updateProduct`'s republish always writes a non-null `diet`,
    `republishProductOverlays` and `createProduct`'s insert in `operations.ts`, and a published
    allergen value built from the variant's own recipe overlay, which is null, drops the parent's
    recipe-derived allergens):
    - ALL FOUR overlays null (`manual_allergens`, `recipe_derivation`, `diet_derivation`,
      `diet_override`) → `allergens` AND `diet` stay NULL, so the parent's published values are read;
    - `manual_allergens` alone overridden → the union of it and the PARENT's recipe derivation;
    - `diet_override` alone overridden → combined with the parent's `diet_derivation`;
    - a change to the parent's recipe derivation (`applyRecipeDerivation`) republishes every variant
      of it that has an override of its own.
  - `PUT` on a TOP-LEVEL product with `vatClass: null` or `unitPrice: null` → `product.invalid` naming
    the field.
  - a body whose `parentId` differs from the stored one, or names a parent on a top-level product →
    `product.invalid` naming `parentId` (V10).
  - on a VARIANT: a non-empty `variants` list → `product.invalid` naming `variants`; `modifiers` →
    `product.invalid` naming `modifiers` (spec §4.4: a variant offers its parent's lists).
- [ ] **Step 2: Run to verify they fail.**
  Run: `pnpm --filter @waitron/catalogue exec vitest run src/product-editor.test.ts src/product-editor-input.test.ts src/operations.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `readProductEditor` reads RAW columns plus, with a `parentId`, the
  parent's effective values into `inherited`. `parseProductEditorInput` takes `{ isVariant: boolean }`,
  decided by the route from the stored row. `saveProductEditor` branches on the stored row; the
  republish follows the rules above. Map any new refusal in `catalogue-api.ts`'s `STATUS`.
- [ ] **Step 4: Run to verify they pass**, plus `src/variant-fallback.test.ts` and the Task 3
  suites. **Step 5: Commit** (`git commit -s`).

---

## Task 7: A variant's own product page — the dashboard — slug `editor-screen`

Spec §4.4, §9.1, §9.2 (branch 2), §15.1–§15.3, §15.6; V1, V2, V6, V11.

**Files:**
- Modify: `apps/dashboard/src/widgets/product-editor.ts`, `product-editor-model.ts`, `variant-table.ts`, `variant-form.ts`, `product-list.ts`, `screens/catalogue-screen.ts`, `api/client.ts`, `i18n/strings.ts`, `docs/developers/design-system.md`
- Modify: `packages/ui/src/components/wt-price-input.ts` (a `placeholder` property), `packages/media/src/dashboard/image-library.ts`
- Test: the matching `*.test.ts` and `*.a11y.test.ts`; `packages/ui/src/components/wt-price-input.test.ts` (+ a11y)

- [ ] **Step 1: Write the failing tests.**
  - `wt-price-input` renders a `placeholder` on its inner input; its a11y test covers the placeholder
    state in both themes.
  - a variant's page (`/manage/catalogue/product/:variantId`) shows each inherited field EMPTY with
    the parent's value as its hint — text and price fields through `placeholder`; `<select>` fields
    (VAT, unit, station, course, primary category) through a first option reading "Same as <parent
    value>" with an empty value, the pattern this task establishes and writes into `design-system.md`
    → Forms. The name fields are plain (never hinted from the parent — V2). Saving an empty field
    sends `null`, a typed value sends it, clearing it sends `null`.
  - a variant's page has no Modifiers section and no Variants section.
  - the editor read now returns Inactive variants too (Task 3 limited it to Active ones) and the save
    body carries each variant's `active`, so removing a variant sends it `active: false` and a save
    never reactivates one by accident.
  - the parent's quick variants section: adding the first variant adds ONE row (no "Regular" — the
    fold at `product-editor.ts:609-643` and its tests are removed); a variant's price input is empty
    with the parent's price as hint; each row has an "Open" action to the variant's page; removing a
    row makes the variant Inactive, and Inactive variants are hidden behind the section's status
    filter and restorable from it (V6).
  - with variants, the parent's price field stays visible, labelled as the base price.
  - the products list nests variants under their parent with each variant's OWN name and effective
    price, VAT and category (today variant rows show the parent's muted "—"), its own Edit action,
    and the Task 2 status filter applying to variants too.
  - the image library's usage link for a variant opens the variant's own page, not the parent's
    (`image-library.ts:27-32`, test `:353-376`).
- [ ] **Step 2: Run to verify they fail** (`pnpm --filter @waitron/dashboard exec vitest run <files>`,
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-price-input.test.ts`,
  `pnpm --filter @waitron/media exec vitest run src/dashboard/image-library.test.ts`).
- [ ] **Step 3: Implement.** **Step 4: Run to verify they pass; open the catalogue screen, a parent
  and a variant page in both themes and at phone width and LOOK. Step 5: Commit.**

---

## Task 8: Top sellers roll variants up under their parent — slug `top-sellers`

Spec §6, §15.2. Filed data unchanged.

**Files:**
- Modify: `packages/reporting/src/top-sellers.ts`, `types.ts`, `index.ts`; `apps/server/src/report-api.ts`
- Modify: `apps/dashboard/src/api/client.ts` (`TopSellerRow`), `widgets/top-sellers-table.ts`
- Test: `packages/reporting/src/top-sellers.test.ts`, `apps/server/src/report-api.reports.test.ts`, `report-api.overview.test.ts`, `apps/dashboard/src/widgets/top-sellers-table.test.ts`, the sales and overview screens' tests and a11y tests

**Interfaces:**
- Produces: `TopSeller { name: string; quantity: string; total: string; variants: TopSellerVariant[] }`,
  `TopSellerVariant { name: string; quantity: string; total: string }`. A parent row's `name` is the
  frozen `sale_lines.name`; a variant row's `name` is its `variant_name` alone (V2). `variants` is
  `[]` when nothing of that name was sold as a variant. `limit` counts PARENT rows.

- [ ] **Step 1: Write the failing tests** from ONE fixture (spec §12): "Wine by the glass" sold as
  "Wine 125" ×2 at 4.00 and "Wine 175" ×3 at 5.50, plus "Tea" with no variants. The wine row totals
  quantity `5` and total `24.50`, with Wine 175 then Wine 125 nested; Tea has `variants: []`;
  `limit: 1` returns the wine row alone with both nested. **The assertion that changes:**
  `top-sellers.test.ts:164-206` pinned "Coffee · Double" as a separate seller; it becomes a nested
  "Double" under "Coffee" — name it in the PR. A second fixture whose variant totals are `0.10` and
  `0.20` asserts the parent total is the string `0.30`.
- [ ] **Step 2: Run to verify they fail**
  (`pnpm --filter @waitron/reporting exec vitest run src/top-sellers.test.ts`).
- [ ] **Step 3: Implement.** Rank and limit the PARENTS in SQL, then read only their variant rows: a
  CTE groups `sale_lines` by `name` alone, orders by summed quantity then name, and takes `limit`; the
  outer query groups by `name, variant_name` for those names only. Sums stay the engine's
  cast-to-text sums; any addition in TypeScript uses the exact `Decimal` arithmetic from
  `@waitron/shared`, never `Number`. `renderTopSellers` draws each parent row with its variants as
  indented sub-rows (`data-test="seller-row-${i}-variant-${j}"`).
- [ ] **Step 4: Run to verify they pass; open the sales and overview screens in both themes and at
  phone width and LOOK. Step 5: Commit** (`git commit -s`).

---

## Task 9: Remove the variant table and the old shapes; docs; backlog — slug `cleanup`

Spec §4.5, §8 (branch 2), §14's backlog line.

**Files:**
- Delete: `packages/catalogue/src/schema/variants.ts` (and its re-export in `schema/index.ts`); Create (generated): `packages/catalogue/drizzle/0003_*.sql` dropping `product_variants`
- Modify: `packages/catalogue/src/classification.ts`, `configuration-transfer.ts`, `variants.ts` (delete `resolveMenuVariant`), `errors.ts` (confirm `product.variant_count_invalid` and any other unthrown variant code is marked retired, left registered)
- Modify: `scripts/schema-constraints.test.ts` (remove the `product_variants` entries — Task 3 already took `menu_item_variants`'); `packages/fiscal-verifactu/src/privileges.expected.ts` only if a guard reads it (check first — it is recorded as a frozen pre-switch record nothing checks)
- Modify: `docs/developers/products.md` (Variants section, the gap report, the editor body), `design-system.md` (the variants table), `conventions-data.md`, `docs/backlog.md`, the spec's **Status** line
- Test: `packages/catalogue/src/migrations.test.ts`, `scripts/classification-complete.test.ts`

- [ ] **Step 1: Write the failing test.** In `migrations.test.ts`, assert neither `product_variants`
  nor `menu_item_variants` exists after the catalogue set migrates.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Delete the schema, regenerate** (`pnpm --filter @waitron/catalogue db:generate`), READ
  the drop (no `CASCADE`, which this engine does not have), remove the table from
  `CATALOGUE_CLASSIFICATION` and the configuration-transfer list, and delete `resolveMenuVariant`
  and its test cases. Grep the BARE names across the whole tree — `product_variants`,
  `menu_item_variants`, `productVariants`, `menuItemVariants`, `resolveMenuVariant`,
  `listProductVariantsForProducts`, `variant_count_invalid`, `editor.variant_regular` — including
  `docs/`, `scripts/` and every `*.md`, and fix or delete each hit (CLAUDE.md §1: a behaviour change
  retires every receipt about the old behaviour, wherever it is written).
- [ ] **Step 4: Run** `scripts/classification-complete.test.ts`, `scripts/schema-constraints.test.ts`,
  `scripts/claude-md-pointers.test.ts`, `scripts/errors-reachable.test.ts`, `scripts/alert-codes.test.ts`
  and the catalogue suite.
- [ ] **Step 5: Docs.** Rewrite `products.md`'s Variants section for the one-table model (the read
  rule and its name exception, the price chain, Active and Available, the till button and picker
  rules, the sale line). Reconcile `docs/backlog.md`: the "Next in this slice: branch 2" entry becomes
  LANDED with the nine PR numbers, and in the menus/categories/home-layouts entry mark ONLY the
  variants-and-extras part of its "do not start until" condition as met — it also waits on the SQLite
  work and the dependency upgrades. Set the spec's **Status** line to say branch 2 landed.
- [ ] **Step 6: Commit** (`git commit -s`).

---

## Finish (every task)

Each task ends with `/finish-branch` in its worktree (full review wave), then `/land-branch`, then the
next task starts from a freshly synced `main`. Update `docs/backlog.md` in the task's own PR where the
task makes it stale.

## Self-Review notes

- **Spec coverage.** §15.1 → Tasks 3 (one variant allowed, no Regular) and 5 (never sold itself) and
  7 (editor). §15.2 → Tasks 1 (names not inherited), 5 (printing), 6–7 (editor), 8 (report names).
  §15.3 → Tasks 1 (nullable price), 3 (chain, three steps), 4 (fourth step), 5 (the "+€" label), 6–7
  (hints). §15.4 → Task 5. §15.5 → Task 3. §15.6 → Task 2 (products), 3 (variants), 7 (editor
  filter). §15.7 → Tasks 1 (fixed parent), 5 (filed line), and the golden gate throughout. §4.3 →
  Task 5. §4.4 → Tasks 6–7. §4.5 / §8 → Tasks 5 and 9. §6 → Task 8. §9.2 media → Task 3, list →
  Tasks 2 and 7.
- **Deliberately not in this plan:** per-variant modifier attachments (spec §4.4, §14); a dedicated
  extras report (§6); the components table; the dashboard-wide Active/Disabled terminology (a
  backlog item); a customer-facing menu, where `sold_alone` will matter (§15.4).
- **Type consistency:** `SelectedVariant.productId` (Task 5) replaces `variantId`; the offer gains
  `unitPrice` and nested `MenuOfferVariant`s (Task 3), `MenuItem.grossPrice` becomes nullable
  (Task 4), and the till's `unitPriceDifference` arrives in Task 5; `ProductVariant` gains `active` and a nullable `unitPrice` (Task 3);
  `InheritedValues` (Task 6) is consumed by Task 7; `TopSeller.variants` (Task 8) is consumed in the
  same task.

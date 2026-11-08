# A1308 menu and photos, PR mn5: a product stores what people declared, and the database checks it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** `products` keeps one allergen column (what a person declared, normalised on write), works
out the diet profile on read instead of storing it, drops the folded-name copy `name_key` (after a
measurement), and gains the checks the owner added on 6 November: no negative price, no blank name,
the ordering value as a declared CHECK instead of two triggers, and an index on the photo column. An
archived product is recorded in `activity_log`.

**Architecture:** Schema change to `products` only. Writers normalise allergens with
`mergeAllergenMaps` before storing; readers compute `diet` with `overlayDietProfile(UNDECLARED_DIET, dietOverride)`
from slice 4a. The "staff name taken" check reads the active names of the same parent and folds them
in code, as menus already do. `archiveProducts` writes one `product.archived` entry per product with
slice 2's `recordActivity`.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R2, R6, "Additions of 6
November 2026" (rows for `products`); [tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md)
§1.3 (dropped `name_key`, `manual_allergens`, `diet`; "Writing allergens gains one step"; "Not yet
reviewed stays"; ordering CHECK), §3 (`product.archived`), §5, §6, §8 item 1;
[slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7` with mn1/mn3's paths and names (for
example `packages/menu/src/product-names.ts:63` is today's `packages/catalogue/src/product-names.ts:63`).
Slice 4a rewrote parts of `operations.ts` this plan touches: it removed `applyRecipeDerivation`,
`applyDietDerivation`, `RecipeDerivation`, `republish` and `deriveDietProfile`, and introduced
`publishedAllergens` and `UNDECLARED_DIET` (4a plan, "D1"). mn4 removed `products.menu_id`,
`pricing_unit` and `product_units`. Backlog entries are named by their text at `a086eedfb7`; mn3
changed "catalogue" to "menu" in them and mn1 moved `docs/backlog/catalogue.md` to
`docs/backlog/menu.md`. A missing identifier this plan does not explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6). Allergens and diet reach a sale line only as a frozen copy at
order time (orders area); nothing here feeds a fiscal hash. A refused negative price was already
refused at every request boundary (`docs/backlog/catalogue.md:34-43`).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **Measurement first** (tables-menu.md §8 item 1, Task 1): the name check by scan at 1,000
   products. Failing result, written in advance: a median over 20 ms per product save. Then the
   design's fallback is to keep `name_key` and its index; the builder stops and the watcher confirms
   (rules §5.4) before taking it.
2. **`name_key` and `products_name_key_idx` go** (when item 1 passes). `nameColumns`
   (`packages/menu/src/product-names.ts:11-13`) and `storeProductNameKeys` (`:16-34`) go, with the
   import hook that calls it (`packages/menu/src/configuration-transfer.ts:240`, `afterImport`) and the
   export's `omit: ["name_key"]` (`packages/db/src/configuration-transfer.ts:72`).
   `assertProductNamesFree` (`product-names.ts:63-90`) selects `name` of active rows with the same
   parent (minus the family) and keeps those whose `foldName` equals a wanted key, then refuses as
   today. Every write that called `nameColumns` writes `name` alone (`operations.ts:1075`, `:1285`;
   `variants.ts:270`).
3. **One allergen column.** `manual_allergens` goes. Every write that stored it
   (`operations.ts:1086`, `:1297`; 4a's rewritten `insertProduct` and `updateProduct`) stores
   `allergens` = `publishedAllergens(declared)` (sorted kinds, repeats removed; `null` stays "not
   yet reviewed", `{}` stays "reviewed, none"). The variant-fallback entry `manualAllergens`
   (`packages/menu/src/variant-fallback.ts:110`) goes; `allergens` keeps inheriting (`:109`). The
   editor reads `products.allergens` (`packages/menu/src/product-editor.ts:37`) and its
   `publishedAllergens` alias (`:49-53`) goes. `Product.manualAllergens`
   (`packages/shared/src/menu-document/product-types.ts:134`) leaves the type. What 4a kept of
   `republishOverlays` (`operations.ts:909-959` at `a086eedfb7`) goes: there is no derived copy left
   to keep in step.
4. **`diet` is worked out on read.** The column goes, with its variant-fallback entry
   (`variant-fallback.ts:114`). `toProduct` (`operations.ts:281-310`), `listAvailableProducts`
   (`:1463`) and the menu document builder set `diet` to
   `overlayDietProfile(UNDECLARED_DIET, effective dietOverride)`; a variant with no override of its
   own reads its parent's, as `effectiveProductColumns` makes `dietOverride` inherit (`:113`). With no
   override, vegan and vegetarian read "unknown", never "yes" (tables-menu.md §1.3).
5. **`diet.invalid_origin` becomes `diet.invalid_contains_tag`, and its parameter `{ origin }`
   becomes `{ tag }`** (4a left the rename to this area). Of today's three throw sites in
   `packages/shared/src/menu-document/dietary.ts`, `:48` is `validateOrigin`, which 4a deletes with
   recipes; `:59` refuses a bad contains-tag; `:87` refuses an `addContains`/`removeContains` value that
   is not a list. Both remaining sites throw the new code with `{ tag: String(value) }`. Registry
   `packages/shared/src/errors.ts:73`, the server status map (`apps/server/src/menu-api.ts:361`), the
   dashboard wording in `apps/dashboard/src/i18n/codes.ts` (English and Spanish), and their tests.
   Pre-live, a code may be renamed freely (CLAUDE.md §3). **Assertions changed by design:** every test
   that expects `diet.invalid_origin` or its `origin` parameter (find with
   `git grep -n "invalid_origin" -- '*.test.ts'`) expects the new code and `tag`; the pull request lists
   each such case.
6. **Ordering as a CHECK.** `products_ordering_ck`: `ordering in ('public','staff_only','not_sold_separately')`,
   declared with `enumType`/`enumCheck` (`packages/db/src/schema/columns.ts:113`) over
   `PRODUCT_ORDERINGS` from `@waitron/shared` (or the literal list if no such constant exists; check
   with `git grep -n "staff_only" packages/shared/src`). The two triggers
   `products_ordering_check_insert`/`_update` leave `packages/db/triggers/core.sql`
   (today `packages/db/drizzle/0000_baseline.sql:3045-3059`).
7. **No negative price.** `products_unit_price_ck`: `unit_price is null or unit_price >= 0`. The
   direct writes refuse first with `product.invalid { field: "unitPrice" }`: `createProduct`,
   `createProductSkippingNameCheck`, `updateProduct`, `updateProductSkippingNameCheck`
   (`operations.ts:1029-1300`) and the variant writes in `variants.ts`.
8. **No blank name.** `products_name_ck`: `trim(name) <> ''` (the form of `menu_periods_name_ck`,
   `packages/db/src/schema/venue-service/menus.ts:42`). The same direct writes refuse a name that is
   blank after JavaScript's `trim()` with `product.invalid { field: "name" }` (a variant write names
   its field `variants.<i>.name`, as the editor parser does). The editor's parser already refuses
   (`packages/menu/src/product-editor-input.ts:94-95`).
9. **Photo index.** `products_image_idx` on `products(image) where image is not null`, so the media
   delete and rename triggers (`products_media_image_fk_parent_delete`/`_parent_rename`) stop
   reading every product for a photo nothing uses (README "Additions of 6 November 2026").
10. **`product.archived` in `activity_log`.** `archiveProducts(tx, ids, personId)`
    (`packages/menu/src/archive.ts:128`) records one entry per product it archives (subject `product`,
    data `{ name: string; variantIds: string[] }`, the variants it archived with it). Its callers pass
    the signed-in person: `product-items.ts:155` (from `deleteProductItems`), `operations.ts:1226`
    (`updateProduct` turning Active off), `:1316` (`deactivateProduct`), `product-editor.ts:142`; each
    gains a trailing `personId: string | null` that its route fills from the session (`gated`'s
    `authorizedBy`, `apps/server/src/menu-api.ts:815`). The kind joins slice 2's registry
    (`packages/db/src/activity-kinds.ts`).
11. **Backlog** (rules §9): delete from `docs/backlog/architecture.md` "Repeated allergen kinds from
    direct callers" (`:1240-1244`), "Catalogue names (W72) …" (`:1245-1246`), "A negative catalogue
    price …" (`:1191-1192`) and its detail `docs/backlog/menu.md` (today `catalogue.md:34-43`); edit
    "A product's name can be stored blank" (`:1198-1201`) to drop `products` (mn8 deletes the rest);
    edit `docs/backlog/menu.md`'s W72 section (today `catalogue.md:218-236`) to drop its first
    paragraph (the index and the backfill) and add one line to that file's "Decisions and deliberate
    limits" (today `:1244`): "Two active products of one parent may not share a staff name, checked in
    code by folding each name (`foldName`); no unique index holds it, because the fold is
    Unicode-aware and this engine's `lower()` folds ASCII only (`product-names.ts:18`)."
12. The bundle format moves on by one (columns leave `products`).

## Decisions this plan makes

- **D1. Repeated allergen kinds are normalised, not refused.** The design says the one column
  "normalises through `mergeAllergenMaps`, so readers see what they see today" (tables-menu.md §1.3).
  The retire item asked "normalise or refuse"; normalising is what the published column already did,
  so no stored value a reader sees changes.
- **D2. The ordering refusal's wording changes, by design.** The behavioural-trigger cases at
  `scripts/behavioural-triggers.test.ts:1705-1790` assert the triggers' refusal. They move to the
  products schema test (`packages/db/src/schema/menus.test.ts`) asserting the CHECK's name
  (`checkFailed(error, "products_ordering_ck")`, `packages/db/src/constraint-target.ts:197`). The
  bad value is still refused on insert and update: this is the design's own change ("a declared
  CHECK … triggers dropped", tables-menu.md §5), not behaviour moving, so rules §4's stop does not
  apply to these cases only.
- **D3. `activity_log` takes no person name.** Data holds the product's staff name and ids, never a
  person's (slice 2's registry rule).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Blank-name CHECKs on `option_lists`, `option_labels`, `extra_lists` | mn8 |
| The photo index on `sections` | mn7 |
| `menu.archived`, `menu_edition.rescheduled`, `photo.deleted` | mn6, mn9, mn12 |
| Removing `diet` from the menu document or the till | not planned: the document and the till read the computed value |

## Files

- Schema: `packages/db/src/schema/menus.ts` (products); `packages/db/triggers/core.sql` (two triggers
  out); `packages/db/src/configuration-transfer.ts:72`
- Menu package: `operations.ts`, `product-names.ts`, `product-editor.ts`, `variant-fallback.ts`,
  `variants.ts`, `archive.ts`, `product-items.ts`, `menu-document.ts`, `configuration-transfer.ts`
- Shared: `menu-document/product-types.ts`, `menu-document/dietary.ts`, `errors.ts`
- db: `packages/db/src/activity-kinds.ts` (one kind)
- Server: `apps/server/src/menu-api.ts` (status map; pass the person)
- Dashboard: `apps/dashboard/src/i18n/codes.ts`, `codes.test.ts`
- Regenerated: `packages/db/drizzle/**`, the epoch file
- Guards: `scripts/behavioural-triggers.test.ts` (`:101-102` list entries and `:1705-1790` cases
  move, D2), `scripts/schema-constraints.test.ts` (CHECK list: add `products_name_ck`,
  `products_ordering_ck`, `products_unit_price_ck`), `scripts/errors-reachable.test.ts` (runs),
  `scripts/starting-migrations.test.ts` (runs), `packages/db/src/schema/menu/migrations.test.ts`
- Tests: `packages/menu/src/product-name-key.db.test.ts` (rewritten: no key; its "check sees
  duplicates" assertions stay), `product-names.db.test.ts`, `operations.test.ts`,
  `variant-fallback.test.ts`, `product-editor.test.ts`, `allergen-kinds.test.ts`, `archive.db.test.ts`,
  `packages/shared/src/menu-document/dietary.test.ts`, `packages/db/src/schema/menus.test.ts`,
  `apps/server/src/configuration-import.test.ts`; the Madrid baseline
- Docs: `docs/developers/products.md` (allergens, diet, name uniqueness), `docs/backlog/architecture.md`,
  `docs/backlog/menu.md`

## Size

| | Code | Tests |
| --- | --- | --- |
| `name_key` | 40 | 60 |
| Allergens one column | 50 | 90 |
| Diet on read, code rename | 50 | 75 |
| Ordering, price, name CHECKs and refusals | 40 | 110 (40 moved) |
| Photo index | 5 | 30 |
| `product.archived` | 40 | 50 |
| Format, Madrid transform, docs and backlog | 50 | 30 |
| **Counted** | **275** | **445** |

About 720 counted lines; the measurement script is not committed (its text goes in the pull request
description). About 3 hours.

## Finish line

1. The pull request description holds the measurement's script, output and verdict (median and 95th
   percentile per save at 1,000 products, the machine).
2. `pnpm --filter @waitron/menu exec vitest run src/product-names.db.test.ts src/operations.test.ts src/allergen-kinds.test.ts src/archive.db.test.ts src/variant-fallback.test.ts`
   passes, including "stores repeated allergen kinds once", "refuses a negative price before the
   database does", "refuses a blank name before the database does", "records an archived product with
   its variants".
3. `pnpm --filter @waitron/db exec vitest run src/schema/menus.test.ts` passes, including "refuses an
   ordering outside the three", "refuses a negative price", "refuses a blank name" and "a lookup of
   products by photo uses products_image_idx".
4. `git grep -n -E "manualAllergens|manual_allergens|nameKey|name_key|diet\\.invalid_origin|products_ordering_check" -- apps packages scripts`
   prints only the captured fixtures and `nameKey` uses that belong to other tables (themes, persons).
5. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing index products_name_key_idx
extra index products_image_idx
missing table products.columns[name_key]
missing table products.columns[manual_allergens]
missing table products.columns[diet]
changed table products.columnOrder
old: [<mn4's order>]
new: [<without name_key, manual_allergens, diet>]
extra table products.checks[products_name_ck]
extra table products.checks[products_ordering_ck]
extra table products.checks[products_unit_price_ck]
missing trigger products_ordering_check_insert
missing trigger products_ordering_check_update
changed trigger products_media_image_fk_insert.order
old: 2
new: 1
changed trigger products_media_image_fk_update.order
old: 3
new: 2
```

(The two triggers are in core's starting migration, so even the `sql-only` entries hold them.) The
tool numbers each trigger by its creation order among those on the same table, timing and event
(`compare.ts`, `canonicalTriggers`). Counted from today's order in core's trigger tail
(`0000_baseline.sql:3016-3059`, `:3744-3760`): `products` BEFORE INSERT holds
`products_variant_one_level_insert`, `products_ordering_check_insert`, `products_media_image_fk_insert`;
BEFORE UPDATE holds `products_variant_parent_fixed_update`, `products_id_fixed_update`,
`products_ordering_check_update`, `products_media_image_fk_update`. Removing the two ordering triggers
moves each media trigger up one. Read, not run.

In the two `change-feed` entries, also:

```text
changed trigger waitron_change_products_update.when
old: <naming name_key, manual_allergens, diet>
new: <without them>
```

Why, from tables-menu.md §5: "`products_name_key_idx` dropped with `name_key` (subject to §8 item 1)";
"triggers `ordering_check_insert`/`_update` → a declared CHECK on `products.ordering`"; the two
6 November CHECKs and the photo index are the README's additions. `manual_allergens` and `diet` have
no protection of their own.

If the measurement fails and the watcher confirms the fallback, the first and third lines of the
first block do not print (`name_key` and its index stay).

## Stop points (beyond rules §5)

1. The measurement's median is over 20 ms (rules §5.4; the fallback is above).
2. A behaviour test of allergens or diet needs a changed expected value (for example a variant whose
   read changes from inherited to its own), other than a removed `manualAllergens` field.
3. `UNDECLARED_DIET` or `publishedAllergens` does not exist under that name after 4a.
4. Any `*.test.ts` other than the ordering cases (D2) asserts a trigger's refusal text for ordering.

## Needs

- **Outside this area:** slice 2 (`recordActivity`, the kind registry), slice 4a (`publishedAllergens`,
  `UNDECLARED_DIET`, recipes gone).
- **In this area:** mn4 (the products table without `menu_id`, `pricing_unit`, `product_units`).

## Global Constraints

- Rules §1–§9. Core rebuilt, never edited (rules §2).
- Every new CHECK has a refusal case and a legitimate-write case (rules §4).
- `activity_log` is for people to read; nothing decides from it (README §3 R2).

## Review Focus

1. **The measurement's failing case is the one named in advance**, and its machine is stated
   (README §5 U11, "The bench").
2. **"Not yet reviewed" survives**: `null` stays `null` through every write; `{}` stays `{}`.
3. **A variant's inheritance is unchanged** for allergens and diet.
4. **The name check still sees every active same-parent row**, now including rows a stale key used to
   hide (the old W72 gap): a case where two rows differ only in case is refused.

---

### Task 1: Measure the name check by scan (tables-menu.md §8 item 1)

**Files:** `packages/menu/src/product-names.ts` (the scan, behind the same function); a measurement
file not committed.

- [ ] **Step 1:** Change `assertProductNamesFree` (`:63-90`) to read
  `select name from products where active = 1 and parent_id is <parent> and id not in <family>`
  and keep rows whose `foldName(name)` is in the wanted keys. Leave `name_key` in the schema for now.
- [ ] **Step 2:** In a scratch file (for example `<scratch>/name-scan.measure.test.ts`, run from
  `packages/menu` with `pnpm exec vitest run <file>`), on a `useVenueDb` database with core's
  migrations: insert 1,000 active top-level products with distinct names of 10–30 characters
  (`"Dish 0001 …"` with accented letters every tenth), then time 200 calls of
  `assertFamilyNamesFree(tx, null, { name: "Nueva tapa", active: true })` with
  `performance.now()`, after 20 untimed calls. Print the median, 95th percentile and maximum, the
  machine (`os.cpus()[0].model`), Node version and commit.
- [ ] **Step 3: Judge.** Median ≤ 20 ms: pass, continue. Over: stop point 1.
- [ ] **Step 4:** Paste the script and output into the pull request description. Do not commit the
  file.

### Task 2: `name_key` goes; one allergen column; diet on read

**Files:** schema; `product-names.ts`, `operations.ts`, `variants.ts`, `variant-fallback.ts`,
`product-editor.ts`, `menu-document.ts`, `configuration-transfer.ts` (menu and db); shared types;
tests named in Files.

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases:**
  - `product-names.db.test.ts` `"refuses a name that differs only in case or accents from an active
    sibling"` (`"Café con leche"` vs `"cafe con LECHE"` → `product.name_taken`); `"ignores an inactive
    sibling"`; and the case formerly in `product-name-key.db.test.ts` that relied on a stored key now
    sets up rows with raw `insert` (no key) and keeps its refusal assertion.
  - `allergen-kinds.test.ts` `"stores repeated allergen kinds once"`: `updateProduct(tx, id, { allergens: { gluten: { kinds: ["wheat", "wheat", "barley"] } } })`
    → stored and read `{ gluten: { kinds: ["barley", "wheat"] } }`; the same through `createProduct`.
  - `apps/server/src/menu-api.test.ts` `"a product request with repeated allergen kinds stores them
    once"`: `POST /management-api/products/editor` and `PUT /management-api/products/:id/editor` with
    `["wheat", "wheat"]` answer 201/200 and read back `["wheat"]` (the retire item asks to "check
    product requests with repeated kinds").
  - `operations.test.ts` `"keeps null as not reviewed and {} as reviewed, none"` through create and
    update.
  - `variant-fallback.test.ts`: the existing inheritance cases keep their expected values, now with
    `allergens` only; `"a variant with no override reads its parent's diet"`.
  - `operations.test.ts` `"works out the diet profile from the override"`: override `{ vegan: "yes" }`
    reads `vegan: "yes"`, `vegetarian` as `overlayDietProfile` gives; no override reads both
    `"unknown"`.
  - `dietary.test.ts`: `"refuses a bad contains-tag as diet.invalid_contains_tag"` with
    `{ tag: "x" }`, and `"refuses a contains list that is not a list"` with the same code.
- [ ] **Step 3: Run; see them fail.**
- [ ] **Step 4: Implement** items 2–5; rebuild core.
- [ ] **Step 5: Remove `manualAllergens`** from object literals the type checker refuses, with mn4's
  script: `node scripts/a1308/remove-refused-property.mjs --property manualAllergens <tsc output>`
  (Task 2 step 4 of mn4 describes the loop). Hand-fix the rest (listed).
- [ ] **Step 6: Run — PASS. Commit.**

### Task 3: The CHECKs, the refusals, the index

**Files:** schema; `packages/db/triggers/core.sql`; `operations.ts`, `variants.ts`;
`packages/db/src/schema/menus.test.ts`; `scripts/behavioural-triggers.test.ts`;
`scripts/schema-constraints.test.ts`.

- [ ] **Step 1: Failing cases** in `packages/db/src/schema/menus.test.ts` (raw SQL, so the database
  alone is tested):
  - `"refuses an ordering outside the three"`: insert and update with `"secret"` →
    `checkFailed(e, "products_ordering_ck")`; controls: each of the three values inserts.
  - `"refuses a negative price"`: `unit_price = -1` → `products_unit_price_ck`; controls: `0` and
    null (a variant) insert.
  - `"refuses a blank name"`: `''` and `'   '` → `products_name_ck`; control: `"Tea"`.
  - `"a lookup of products by photo uses products_image_idx"` (a standalone query of the shape the
    delete and rename triggers run, not the trigger itself):
    `explain query plan select 1 from products where image = ?` contains
    `USING INDEX products_image_idx` (or `USING COVERING INDEX products_image_idx`); a control on a
    database built without the index prints `SCAN products` (build the control by dropping the
    index in the test database), so the probe can tell the two apart (CLAUDE.md §1).
  - In `operations.test.ts`: `"refuses a negative price before the database does"` (`unitPrice:
    "-1.00"` → `product.invalid { field: "unitPrice" }` on create and update), `"refuses a blank name
    before the database does"` (`"  "` → `product.invalid { field: "name" }`), and the variant write
    with `variants.0.name`.
  - Move `scripts/behavioural-triggers.test.ts:1705-1790` into the schema test as D2 says, and remove
    the two names from the list at `:101-102`.
- [ ] **Step 2: Run; see them fail.**
- [ ] **Step 3: Implement** items 6–9; delete the two triggers from `core.sql`; rebuild core.
- [ ] **Step 4: Run** the files plus `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts` — PASS. **Commit.**

### Task 4: `product.archived`

**Files:** `packages/db/src/activity-kinds.ts`; `archive.ts`, `product-items.ts`, `operations.ts`,
`product-editor.ts`; `apps/server/src/menu-api.ts`; `archive.db.test.ts`.

- [ ] **Step 1: Failing cases** in `archive.db.test.ts`:
  - `"records an archived product with its variants"`: archive a product with two active variants
    as person P; `readActivityForSubject(tx, "product", id)` holds one `product.archived` entry with
    `personId` P and data `{ name, variantIds: [v1, v2] }` (ids sorted).
  - `"records nothing for a product already inactive"`.
  - `"records a null person for a write no person made"` (`personId: null`).
  - In `apps/server/src/menu-api.test.ts`: a delete through the route records the session's person.
- [ ] **Step 2–4:** Run (fail), implement item 10, run (pass). **Commit.**

### Task 5: Export, Madrid baseline, docs, finish

- [ ] **Step 1:** Bundle format on by one; refusal row at `apps/server/src/configuration-import.test.ts:204`.
- [ ] **Step 2: Madrid baseline:** remove `name_key`, `manual_allergens` and `diet` from the captured
  `products` columns and rows (a column-drop helper, or extend the one mn4 added).
- [ ] **Step 3:** Docs and backlog (item 11).
- [ ] **Step 4:** Finish line; paste the protection-list report, marking each line; `/finish-branch`;
  push once.

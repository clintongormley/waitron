> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

> **2026-11-04 (A1009):** The five fake-backend demo scripts and their commands are retired.
> Their scenarios are ordinary server tests in `catalogue-allergen-workflow.test.ts` and
> `reporting-write-workflows.test.ts`. The [worked Spain VAT return](../../../../packages/reporting/examples/modelo-303.md)
> carries the reporting example. References below describe the earlier scripts.

# Target design — the menu area (menus, products, photos, supplier invoices)

Read only. Every "today" claim cites the file it came from or the grep that showed it. Where I say
"I propose", that is the design; where I say "could not establish", I did not find the answer in the
code.

This file carries the owner's review of 4 November 2026, and its cites were re-read on `main` at
`e0da0ad18a`.

Summary: **36 current tables → 23 tables plus one `settings` row (`settings.menu`)** (owner,
2026-11-04). Content languages join `settings.venue` instead. Supplier invoices keep their two tables,
`purchase_invoices` and `purchase_invoice_vat`.

The moves that matter most:

1. **A menu becomes one row.** `catalogues` takes `menu_details`' six home-page display columns, and
   one flag, `is_default`, replaces the venue's default pointer. `location_catalogues` goes with no
   replacement, along with A1301's planned `venue_catalogues` and
   `venue_settings.default_catalogue_id`. The table is renamed `menus` (owner, 2026-11-04).
2. **A category and a product become one row each.** `category_details` folds into `categories`, and
   `product_units` becomes `products.unit_id`. `products.pricing_unit` goes, because it is a copy of
   "does the unit have a scale unit". `products.catalogue_id` goes too: any menu can offer any product
   (owner, 2026-11-04).
3. **Publishing has two tables, not three.** `menu_versions` stays the frozen, append-only copy of each
   menu. One mutable row per version, `menu_releases`, replaces both the "which version is live"
   pointer (`menu_publications`) and the queue (`menu_scheduled_publications`).
4. **Photos have two tables, not four.** The framing and edit state fold into `media_images`. Both
   stores of image bytes become one store keyed by the content hash, `media_blobs`.
5. **The one-row catalogue tables leave.** `catalogue_settings` and `unit_seed_states` become
   `settings.menu`, and `content_languages` joins `settings.venue`, beside the invoice languages.
6. **No ids inside JSON,** with one exception. The include-folder photo moves out of
   `section_members.folder_overrides` into a column. The preselected option label becomes a flag on
   `option_labels` instead of an id that nothing checks. The exception is R4's for a short list owned
   by one row: a period's staff menus become a list on the period (§1.21).
7. **The word "catalogue" goes,** from the package, the settings document, the screen file and the
   visible wording, not only the table (§1, "The rename").
8. **Recipes go** (owner, 2026-11-04: "remove it, and remove recipes. we don't use them"). `ingredients`,
   `recipe_lines`, the two derivation columns on `products`, `packages/recipes`, the routes and the
   screen all leave (§4). A product's allergens and diet are what a person declared on it, and a
   variant inherits them (§1.3).

---

## 1. Target tables

Row estimates are for the reference venue: one restaurant, 250 bills a day with 4 lines each, open 360
days a year, about 150 dishes. Every table below is in the `core` set, because catalogue, venue-service
and media fold into core (README U1). Types use the house column helpers
(`id`/`label` = text, `flag`/`count` = integer, `money` = integer cents, `json` = text, `ts` = text
time, `binary` = blob).

### The rename

README U9 renames the table, its id column and its error codes. The owner extended it on 4 November
to everything below. New names are proposals.

| today | after |
| --- | --- |
| `catalogues`, `catalogue_id`, the `catalogue.*` error codes | `menus`, `menu_id`, `menu.*` |
| the package `packages/catalogue`, `@waitron/catalogue` (11 `package.json` files name it; 481 files under `apps`, `packages` and `scripts` mention it) | `packages/menu`, `@waitron/menu` |
| `settings.catalogue` | `settings.menu` |
| `apps/dashboard/src/screens/catalogue-screen.ts`, `apps/dashboard/src/widgets/catalogue-browser.ts` | `products-screen.ts`, `product-browser.ts` |
| the `/management-api/catalogues/…` routes, `apps/server/src/catalogue-api.ts` | `/management-api/menus/…` and, for products, `/management-api/products/…` |
| the `catalogue.manage` permission (`packages/identity/src/permissions.ts:14`) | `menu.manage` |
| "Choose a catalogue" / "Elige un catálogo" (`apps/dashboard/src/i18n/strings.ts:2365`, `:6162`) | removed with the recipe screen (§4) |
| "catalogue" in the guide (`apps/server/src/guide/en/kitchen-service.md:30`, `products.md:342`) | "menu" |
| "catálogo" in the guide (`apps/server/src/guide/es/kitchen-service.md:32`, `products.md:360`) | "carta", the dashboard's word (`apps/dashboard/src/i18n/strings.ts:5192`) |

The screen file becomes `products`, not `menus`: it is the Products screen (`nav.catalogue` reads
"Products", `apps/dashboard/src/i18n/strings.ts:1045`), and `menus-screen.ts` already exists. Two uses of the word mean
something else and stay: a string catalogue (`registerCatalogue`, `apps/dashboard/src/i18n/strings.ts:7564`) and the list of
guide pages (`apps/server/src/guide-catalogue.ts`).

### 1.1 `menus` (renamed from `catalogues`)

A named menu (main menu, lunch menu): whether it still exists, whether it is the venue's default, and
how a handheld and a till lay out its home page.

| column | type | key / null | from |
| --- | --- | --- | --- |
| `id` | text | PK | catalogues.id |
| `name` | text | not null | catalogues.name — and the ONE home of the menu's staff name (§6) |
| `active` | integer flag | not null, default 1 | catalogues.active |
| `is_default` | integer flag | not null, default 0 | `locations.catalogue_id` today; A1301 planned `venue_settings.default_catalogue_id` |
| `handheld_columns` | integer | not null, default from `HOME_DISPLAY_DEFAULTS` | menu_details |
| `handheld_tiles` | text | not null | menu_details |
| `handheld_order` | text | not null | menu_details |
| `till_columns` | integer | not null | menu_details |
| `till_tiles` | text | not null | menu_details |
| `till_order` | text | not null | menu_details |
| `created_at`, `updated_at` | ts | not null | catalogues |

- **Dropped:** `catalogues.version`. Nothing increases it ("Created at 1; nothing in the tree bumps it
  today", `packages/catalogue/src/operations.ts:113`). Also `menu_details.root_section_id` and
  `default_home_layout_id` (they duplicate `sections.role` + `owner_menu_id`, §6).
- **Protections:** primary key. New: a partial unique index `menus_one_default_uq` on `(is_default)`
  `where is_default = 1`, so the venue has at most one default menu (zero is allowed, as today: "a
  venue may exist before a menu is assigned", `packages/db/src/schema/tenants.ts:86`). New: CHECKs on
  the six display columns (owner, 2026-11-04). Today their ranges live only in code
  (`homeDisplayProblem`), because "one makes drizzle rebuild the table"
  (`packages/catalogue/src/schema/menu.ts:56-58`). The squash creates the table fresh, so the CHECK
  can be declared at creation.
- **The venue's list of extra menus goes, and `offered` with it** (owner, 2026-11-04). Nothing that
  sells reads it: sales run from menu periods and staff menus
  (`packages/venue-service/src/operations.ts:805-835`). No screen calls its routes:
  `listVenueCatalogues`, `addVenueCatalogue` and `removeVenueCatalogue` appear only in
  `apps/dashboard/src/api/client.ts:3148-3158` and that file's test. The functions built on the list
  go with it: `listCataloguesForVenue` and `addCatalogueToVenue` (their only callers are those routes,
  `apps/server/src/catalogue-api.ts:1278-1303`, and, for the second, the demo seed,
  `seed-catalogue.ts:266-268`), `listAccessibleCatalogues` (no caller, `packages/catalogue/src/operations.ts:1420`),
  `listAvailableProducts` (demo scripts and one test helper: `allergens-demo.ts:200`,
  `demo-seed/seed.ts:105`, `testing/party-venue.ts:160`) and `resolveAccessibleCatalogueIds` (those,
  plus `testing/zone-offers.ts:188`). A1301 S23 must not build `venue_catalogues`.
- **`setVenueDefaultCatalogue` keeps its job and loses one rule.** It clears the old default's flag
  and sets the new one. "Demoted to a member row" (`packages/catalogue/src/operations.ts:1317-1334`) goes,
  because there are no members. Its dashboard client method has no caller either
  (`apps/dashboard/src/api/client.ts:3160`), but the owner kept `is_default`, so the route stays (R5).
- **Who reads the default today, and so switches to `is_default`.** The value is `readVenue`'s
  `defaultCatalogueId`, read from `locations.catalogue_id` (`packages/db/src/venue.ts:46`). Its readers
  outside tests: `setVenueDefaultCatalogue` (`packages/catalogue/src/operations.ts:1327`), catalogue provisioning, which
  makes a starter menu the default when there is none (`packages/catalogue/src/provisioning.ts:116-124`),
  venue-service's new-department period (`packages/venue-service/src/operations.ts:194`) and its
  provisioning (`packages/venue-service/src/provisioning.ts:143`), and the configuration export.
  Found with `git grep -n -w defaultCatalogueId -- 'apps/*/src/*' 'packages/*/src/*'`, leaving out
  tests and fixtures.
- **Configuration export format 10** (#2415). Today the default travels as the bundle's top-level
  `defaultCatalogueId` (`packages/provisioning/src/configuration-transfer.ts:108,133,155`), and the
  extra menus as the `location_catalogues` table entry (`packages/db/src/configuration-transfer.ts:73`).
  The import clears the default before it deletes the starter menu, because the pointer is a foreign
  key (`packages/provisioning/src/configuration-transfer.ts:684`), and sets it again afterwards (`:760-763`). With the flag, the
  default travels inside the exported `menus` rows: the top-level field, the `location_catalogues`
  entry and that clear-and-restore step all go, and the bundle's shape changes, so its `version`
  moves on. Read, not run.
- state; not append-only; 1–3 rows.

### 1.2 `categories`

A reporting group (Food, Drinks, Starters…), which can sit inside a parent category and has a colour.

| column | type | key / null | from |
| --- | --- | --- | --- |
| `id` | text | PK | categories |
| `name` | text | not null | categories |
| `parent_id` | text | null, FK → categories.id ON DELETE RESTRICT, indexed | category_details.parent_id |
| `color` | text | null | category_details.color |
| `created_at`, `updated_at` | ts | not null | categories |

- **Protections:** primary key. `category_details_parent_fk` (restrict) becomes the self-key. The
  `category_details_parent_idx` index becomes `categories_parent_idx`.
  `category_details_category_fk ON DELETE CASCADE` is no longer needed, because the fact lives in the
  same row.
- state; 10–20 rows.

### 1.3 `products`

Every sellable item, and each of its variants as a child row: names, price, VAT class, unit, course,
category, photo, colour, and the allergen and diet facts that people declare.

| column | type | key / null | note |
| --- | --- | --- | --- |
| `id` | text | PK | |
| `parent_id` | text | null; FK → products.id RESTRICT | variant |
| `variant_order` | integer | not null, default 0 | |
| `category_id` | text | null, FK → categories.id | |
| `course_id` | text | null, FK → kitchen_courses.id | another area's table |
| `unit_id` | text | null, FK → units.id ON DELETE RESTRICT, indexed | **was `product_units`**; null = sold Each |
| `name` | text | not null | |
| `customer_name`, `description` | json | null | translations by language |
| `kitchen_name` | text | null | |
| `dietary_declarations` | json | null, default `[]` | |
| `unit_price` | money | null (a variant inherits) | |
| `vat_class` | text | null; CHECK in the four classes | |
| `active`, `available` | flag | not null, default 1 | |
| `ordering` | text | not null, default `public`; **CHECK** in three values | |
| `image` | text | null; photo by filename (trigger-checked) | |
| `color` | text | null | |
| `allergens` | json | null = not yet reviewed; `{}` = reviewed, contains none | was `manual_allergens`: what a person declared |
| `diet_override` | json | null | what a person declared about the diets: vegan, vegetarian, halal, kosher and contains-tags |
| `created_at`, `updated_at` | ts | not null | |


- **Dropped columns:**
  - `catalogue_id` (owner, 2026-11-04). Any menu can offer any product, through `menu_items`. The
    column says nothing a person chose: the Products and Modifiers screens load every menu's products
    and merge them (`apps/dashboard/src/screens/catalogue-screen.ts:276-289`,
    `apps/dashboard/src/screens/modifiers-screen.ts:190-204`), and a new product is filed under the
    oldest menu (`catalogue-screen.ts:255-256`, `:442`).
  - `pricing_unit`. It is a copy, always written as `unit.hardwareUnit === null ? "each" : "weight"`
    (`legacyPricingUnit`, `operations.ts:331-333`; also `units.ts:250-258`), and readers can take it
    from `units.hardware_unit`.
  - `name_key`. It is a folded copy of `name`, used only to look rows up for the "staff name taken"
    check. It is not a unique index (`packages/db/src/schema/catalogue.ts:76-78`), and menus already
    do the same check by scanning in code (`menu-names.ts:11-15`). See §8, item 1.
  - `recipe_derivation` and `diet_derivation` (owner, 2026-11-04). Recipes go (§4). Only
    `applyRecipeDerivation` and `applyDietDerivation` write these columns
    (`packages/catalogue/src/operations.ts:990`, `:1009`), and outside tests only
    `packages/recipes/src/recipes.ts:65-81` calls those. `mountRecipeApi` has no caller outside tests,
    so on a real box nothing can reach that code. The one other route to it is the demo script
    `apps/server/scripts/recipes-demo.ts`.
  - `manual_allergens` as a second column, and `diet` (owner, 2026-11-04). With no recipe, each is a copy
    of what a person declared. `republish` returns the declaration itself once its derivation is null
    (`packages/catalogue/src/derivation.ts:23-31`), so `allergens` and `manual_allergens` become one
    column, keeping the name `allergens`, which its readers already use. `diet` is always
    `overlayDietProfile` of the starting profile and `diet_override` (`operations.ts:1082`, `:943-948`).
    Code works it out on read from the inherited `diet_override`, as the till already does
    (`apps/till/src/state/as-served.ts:37-39`). No read gains a table, so the timing this design once
    asked for is not needed. That is reasoned, not timed.
- **Variants inherit.** `effectiveProductColumns` keeps `allergens` and `dietOverride` as they are: a
  variant's blank value reads its parent's, and its own value stands alone, not merged with the
  parent's (`packages/catalogue/src/variant-fallback.ts:110`, `:114`; `operations.ts:934-936`). The
  entries `manualAllergens`, `recipeDerivation`, `dietDerivation` and `diet` go.
  `product-editor.ts:40`, `:53` stop reading two columns.
- **Writing allergens gains one step.** Today only the published copy has its kinds sorted and
  repeats removed, by `mergeAllergenMaps` (`derivation.ts:11-19`); `updateProduct` stores what it was
  given as `manualAllergens` (`operations.ts:1290`). With one column, the write normalises through
  `mergeAllergenMaps`, so readers see what they see today.
- **"Not yet reviewed" stays; the unreviewed-ingredient rule goes.**
  - `null` still means nobody has reviewed this product's allergens, and `{}` still means reviewed, none
    (`packages/db/src/schema/catalogue.ts:105-106`). Its readers do not change: the publish warning
    (`packages/catalogue/src/menu-publication.ts:531`) and the till (`as-served.ts:18-19`).
  - `null` can now only mean no declaration. Today `republish` also forces `null` over a person's
    declaration when a recipe names an unreviewed ingredient (`derivation.ts:27`). That line goes
    with `recipe_derivation`. It cannot fire on a real box today, for the reason above.
  - Diet has the same caution and keeps it. With no `diet_override`, vegan and vegetarian read
    "unknown", never "yes" (`operations.ts:1082`, `apps/till/src/state/as-served.ts:37`). The starting
    profile is now a fixed value, and the `pending` flag goes.
  - `derivation.ts` loses `RecipeDerivation` and `republish`. It keeps `mergeAllergenMaps`, which the
    till imports (`apps/till/src/state/party-allergy.ts:2`). `dietary.ts` loses `DIETARY_ORIGINS`,
    `validateOrigin`, `DietDerivation` and `deriveDietProfile`; the diet override, the contains-tags
    and `overlayDietProfile` stay. `operations.ts` loses `republishOverlays`, `applyDerivation`,
    `applyRecipeDerivation` and `applyDietDerivation`.
- **What `catalogue_id` takes with it.** `products_id_catalogue_key` and `products_catalogue_id_idx`
  go, and `parent_id` becomes a plain self key, RESTRICT as today. Nothing else targets that key (the
  only use in `packages/*/src/schema` is the composite key at `catalogue.ts:149-150`), and no trigger
  names the column (in `packages/*/drizzle/*.sql` it appears only in table rebuilds). `listProducts`
  loses its filter and the create paths stop naming a menu: `packages/catalogue/src/operations.ts:1066`, `:1085`, `:1111`;
  `packages/catalogue/src/product-editor.ts:123`, `:174-188`; `variants.ts:79`, `:276`;
  `apps/server/src/catalogue-api.ts:1446-1465`, `:1522-1585`; `apps/dashboard/src/api/client.ts:3248-3270`.
  Media's usage list drops the field (`packages/media/src/images.ts:59`, `:69`, `:192`), which no
  screen reads. The till's `catalogueId` is a different value, the offer's menu
  (`apps/till/src/api/client.ts:507`); it keeps its meaning and is renamed.
- **Protections kept:** `products_top_level_owns_ck`, without its `pricing_unit` term;
  `products_vat_class_ck`; `products_parent_id_key`; and the indexes on course and unit. Also
  the triggers `products_variant_one_level_insert`, `products_variant_parent_fixed_update`,
  `products_id_fixed_update` (`packages/db/drizzle/0061_recreate_product_triggers.sql`) and the four
  `products_media_image_fk_*` (`packages/media/drizzle/0007_recreate_product_image_triggers.sql`).
  The two `products_ordering_check_*` triggers become a declared CHECK (owner, 2026-11-04). They exist
  only because "adding one to an existing table makes drizzle rebuild `products`"
  (`0047_product_ordering_check.sql:1-3`).
- **Dropped protection:** `products_pricing_unit_ck`, because the column goes.
- **Note:** today a variant can still hold a `product_units` row that nothing reads ("A row a variant
  still stores is not listed", `packages/catalogue/src/units.ts:273`). The merged column keeps that behaviour. I do not
  add a `parent_id is null or unit_id is null` CHECK, because writers store a unit on variants today
  (`units.ts:294`, "Only variants' rows are left on the unit").
- state; not append-only; 150–250 rows (deactivated rows are kept for ever).

### 1.4 `units`

The units a product can be sold in (g, kg, l…). `products.unit_id` points at it.

Columns are as today: `id` PK, `seed_key` null unique, `staff_name`, `staff_abbreviation`,
`name` json, `abbreviation` json, `precision`, `hardware_unit` null, `measure` flag.

- **Protections:** `units_seed_key_key`, `units_precision_ck`, `units_hardware_unit_ck`, all kept.
- state; 5–8 rows. "Each" is still not a row (`units.ts:42-44`).

### 1.5 `purchase_invoices` (kept, unchanged)

A supplier invoice the venue received. It feeds the deductible input VAT in the quarterly VAT return
(modelo 303). Supplier invoices need their own design (backlog A1326), so this design changes nothing
here and adds no history for them (owner, 2026-11-04).

Columns are as today: `id`, `supplier_tax_id`, `supplier_name`, `supplier_invoice_number`,
`issued_on`, `received_on`, `total`, `regime`, `deductible_proportion`, `note`, `created_at`,
`updated_at`.

- **Protections:** the expression unique index `purchase_invoices_supplier_number_key`,
  `purchase_invoices_tenant_received_idx` (rename it without "tenant", README U9),
  `purchase_invoices_regime_ck` and `purchase_invoices_deductible_proportion_ck`.
- ledger (as today, `packages/db/src/classification.ts:44`); editable and deletable
  (`packages/purchasing/src/operations.ts:300,337`). Not append-only. 3–8 a day, about 1,000–3,000
  after a year.

### 1.6 `purchase_invoice_vat` (kept, unchanged)

One VAT rate's base and tax on a supplier invoice.

Columns: `id`, `purchase_invoice_id`, `rate`, `base`, `tax`, `kind`.

- **Protections:** FK cascade `purchase_invoice_vat_invoice_fk`, the invoice index,
  `purchase_invoice_vat_rate_ck` and `purchase_invoice_vat_kind_ck`. These are separate rows, not
  JSON: they are many per invoice and grouped in SQL (`packages/reporting/src/input-vat.ts`).
- ledger; about 2,000–5,000 after a year.

### 1.7 `menu_items` (kept)

One product on one menu, with that menu's price (blank means the product's own price).

Columns: `id` PK, `menu_id` FK → menus CASCADE, `product_id` FK → products RESTRICT, `gross_price`
null.

- **Protections:** `menu_items_id_product_key`, `menu_items_menu_product_key` and
  `menu_items_gross_price_ck`; both foreign keys.
- state; 150–450 rows.

### 1.8 `menu_item_variant_overrides` (kept)

A different price for one variant on one menu.

Columns: `menu_item_id`, `product_id`, `variant_id`, `price`.

- **Protections:** primary key `(menu_item_id, variant_id)`; offer FK (cascade); variant FK →
  `products(parent_id, id)` (restrict); `…_price_ck` and `…_overrides_ck`.
- state; 0–50 rows.

### 1.9 `option_lists`

A reusable list of kitchen choices (cooking point).

Columns: `id`, `name`, `customer_name`, `kitchen_name`, `sort`, `active`.

- **Dropped:** `default_label_id`. Today it is an id that nothing in the database checks: "nothing in
  the database says so … `parseOptionListInput` is what refuses an id naming no label of the list"
  (`packages/catalogue/src/schema/options.ts:12-15`). It is replaced by a flag on the label (R4, next
  table).
- state; 5–15 rows.

### 1.10 `option_labels`

One choice inside an options list.

Columns: `id`, `list_id` FK → option_lists CASCADE, `name`, `customer_name`, `kitchen_name`,
`available`, `sort`, **`is_default` flag not null default 0**.

- **Protections:** `option_labels_list_fk` (cascade) and `option_labels_list_sort_idx`. New: a
  partial unique index `option_labels_one_default_uq` on `(list_id)` `where is_default = 1`. The
  database then checks what today only the parser checks: at most one preselected label, and it
  belongs to that list.
- state; 30–60 rows.

### 1.11 `extra_lists`, 1.12 `extra_list_items`, 1.13 `product_modifiers` (kept unchanged)

- `extra_lists`: `extra_lists_picks_ck`.
- `extra_list_items`: list FK (cascade), product FK (restrict), `_qty_ck`, `_price_ck`, `_portion_ck`,
  unique `(list_id, product_id)`, index `(list_id, sort)`.
- `product_modifiers`: three cascade FKs, `_one_reference_ck`, index `(product_id, sort)`, and the two
  partial-by-null unique indexes. It is a link table: each row attaches exactly one list to one
  product (R7).
- state; 5–15, 30–100 and 50–150 rows.

### 1.14 `sections`

A folder or page staff tap through. Each menu has exactly one root section and one home-page section.

Columns: `id`, `internal_name` (**null on the root**, see below), `names` json, `role`,
`owner_menu_id` FK → menus, `image`, `color`.

- **Protections kept:** `sections_owner_menu_fk`, `sections_role_ck`, `sections_owner_menu_idx`, and
  the four `sections_media_image_fk_*` triggers (`packages/media/drizzle/0006`).
- **New:** a partial unique index `sections_one_root_per_menu_uq` on `(owner_menu_id, role)`
  `where role in ('menu_root','home_layout')`. It replaces `menu_details_root_uq` and the two
  `menu_details` pointers. The code already finds roots from `role` and `owner_menu_id`
  (`packages/catalogue/src/section-graph.ts:91-93`), and `createMenuShell` writes both
  (`menu-structure.ts:31-46`).
- **New:** CHECK `(role = 'menu_root') = (internal_name is null)`. A menu's staff name then lives only
  in `menus.name`. Today a rename writes both copies (`operations.ts:878-886`).
- state; 20–50 rows.

### 1.15 `section_members`

One place in a section's list: a product, a nested section, or a placeholder for a missing item.

| column | type | note |
| --- | --- | --- |
| `id`, `section_id`, `position`, `product_id`, `child_section_id`, `missing_name`, `show_as_folder` | as today | |
| `folder_names` | json null | was `folder_overrides.names` (translations; text, not ids) |
| `folder_image` | text null | was `folder_overrides.image`, **a photo reference inside JSON** (R4) |
| `folder_color` | text null | was `folder_overrides.color` |

- **Protections kept:** the three cascade FKs, `section_members_one_ref_ck`, the two unique indexes,
  and the order, child and product indexes.
- **Changed:** the expression index `section_members_folder_image_idx` on
  `folder_overrides ->> '$.image'` becomes a plain partial index on `folder_image`. The four
  `section_members_media_image_fk_*` triggers (`packages/media/drizzle/0009`) read `new.folder_image`
  instead of `json_extract(...)`. This also removes the drizzle-kit hazard where a table rebuild
  writes an expression index back wrongly (`packages/catalogue/src/schema/sections.ts:93-94`).
- state; 200–500 rows.

### 1.16 `menu_versions` — append-only (typed history)

One frozen copy of a whole menu document, published at once or queued for later. It is never changed.
Sales point at it.

| column | type | key / null |
| --- | --- | --- |
| `id` | text | PK |
| `menu_id` | text | not null, FK → menus |
| `number` | integer | not null, ≥ 1, unique per menu |
| `document` | json | not null |
| `content_hash` | text | not null |
| `created_at` | ts | not null (today `published_at`; for a queued edition it is the moment it was queued) |
| `created_by` | text | not null, FK → persons (README U1, U11) |

- **Protections kept:** `menu_versions_menu_fk`, `menu_versions_menu_number_uq`,
  `menu_versions_id_menu_key`, `menu_versions_number_ck`, and the `appendOnly()` update/delete
  trigger pair (`packages/catalogue/src/classification.ts`; listed in
  `scripts/append-only-triggers.test.ts:55-56`).
- It must be kept for ever. `sale_lines.menu_version_id` (`packages/db/src/schema/sales.ts:207`) and
  `working_line_contexts.menu_version_id` (FK, `packages/venue-service/src/schema/service.ts:294`)
  point at it.
- state (append-only); 1–5 a week, 100–300 rows a year, each holding the whole menu (§8, item 3).

### 1.17 `menu_version_images` — append-only, kept

The photo filenames each version's document names. It exists so the database can refuse to delete a
photo that a live or queued menu still shows.

Columns: `version_id` FK → menu_versions, `filename`; primary key on the pair; index on `filename`.

- This is a second copy of facts inside `document`. It is kept because a trigger cannot search a
  nested document cheaply, and the refusal is a database guarantee (R6, the "concurrency guarantee"
  case). It stays a link table, not a JSON list (R7).
- **Protections kept:** the primary key, FK, index, append-only pair, and
  `menu_version_images_media_image_fk_insert`. The two `…_parent_delete` and `…_parent_rename`
  triggers (`packages/media/drizzle/0008`) are rewritten to join `menu_releases` with
  `state in ('live','queued')`, instead of two `exists` over `menu_publications` and
  `menu_scheduled_publications`.
- state (append-only); 50–150 rows per version, about 5,000–15,000 a year.

### 1.18 `menu_releases` — NEW (replaces `menu_publications` and `menu_scheduled_publications`)

Where each version stands: queued for a time, live now, replaced by a later one, or cancelled. It is
a separate table from `menu_versions` because the version can never change while this fact changes
later (R1's lifetime and protection reason).

| column | type | key / null |
| --- | --- | --- |
| `version_id` | text | PK; composite FK `(version_id, menu_id)` → `menu_versions(id, menu_id)` |
| `menu_id` | text | not null, FK → menus |
| `state` | text | not null; CHECK in `queued`, `live`, `superseded`, `cancelled` |
| `activates_at` | ts | not null: the queued time, or the publish time for an immediate publish; a reschedule moves it while queued |
| `cancelled_at` | ts | null |
| `cancelled_by` | text | null, FK → persons (README U1, U11) |

- **Protections:**
  - New: a partial unique index `menu_releases_one_live_uq` on `(menu_id)` `where state = 'live'`.
    The database now holds "one live version per menu", which today is the pointer table's primary
    key.
  - Kept: `menu_scheduled_publications_queued_time_uq`, now `(menu_id, activates_at) where
    state = 'queued'`.
  - Kept, reworded: the "settled" CHECK becomes `(state = 'cancelled') = (cancelled_at is not null)
    and (cancelled_at is null) = (cancelled_by is null)`.
  - The "after queue" CHECK (`activates_at > queued_at`) has no stored `queued_at` any more, so it
    moves into code. `queueMenuPublication` and `rescheduleMenuPublication` already refuse a time in
    the past with `menu_publication.time_past` (`menu-schedule.ts:50-51,151-152`). Dropped from the
    database; stated here.
- **Reads, the same shape as today.** The live version is the `live` row, or the highest-numbered
  `queued` row due by now (`liveVersions`, `menu-publication.ts:79-129`).
  - `settleDue` turns due `queued` rows into `live` and the old `live` into `superseded`.
  - `publishMenu` inserts a version plus a `live` row and supersedes the old one.
  - Cancel and reschedule touch only `queued` rows.
  - The background activation job (`apps/server/src/menu-activation.ts`) keeps waking on changes to
    this table instead of `menu_scheduled_publications` (its `SCHEDULE` constant, line 8).
- state; one row per version, 100–300 a year.

### 1.19 `content_suggestion_jobs`, 1.20 `content_suggestions` (kept)

These are the batches of a "translate everything" run sent to Waitron Cloud, and the suggestions
waiting for a person to accept or discard.

- **Change:** `run_total` is the same number copied onto every batch of a run and rewritten across
  them (`content-suggestion-store.ts:259-273`), but it is read from the first batch only
  (`content-suggestion-jobs.ts:203`). I propose it is stored on the `position = 0` batch only (null
  elsewhere), or the run becomes its own row; the first is smaller.
- **Protections kept:** jobs: `…_run_position_key` and the state, refusal and failure CHECKs.
  Suggestions: job FK (set null), `…_item_language_key`, the partial `…_item_row_key`, the language
  and job indexes, and the kind, name, fix and text_language CHECKs.
- `content_suggestions.item_id` points at a row of whichever table `kind` names, so no foreign key is
  possible (`packages/catalogue/src/schema/suggestions.ts:87-89`). It stays that way, as stated at the column.
- state; 0 to a few batch rows, and 0 to a few hundred suggestion rows.

### 1.21 `menu_periods` (kept, gains the staff menu list)

A department's service period (Breakfast, Lunch), with its calendar colour, starting menu, floor-plan
set and the extra menus staff may also sell from.

| column | type | key / null | from |
| --- | --- | --- | --- |
| current columns | as today | as today | menu_periods |
| `staff_menu_ids` | json list of menu ids, in display order | not null, default `[]` | menu_period_staff_menus (owner, 2026-11-04) |

- **The list replaces `menu_period_staff_menus`,** under R4's exception for a short list owned by one
  row. A period holds a handful of menus, and every read starts from the period or its department:
  `packages/venue-service/src/menu-timetable.ts:183-187`, `:432-436`, `:682-687`;
  `packages/venue-service/src/operations.ts:820-836`; `packages/venue-service/src/routing-periods.ts:45-48`.
  A period save replaces the whole list (`menu-timetable.ts:412-415`). The copied `department_id` and
  `display_order` go: a read joins `menu_periods`, and the array holds the order.
- **What moves to code:** `writeMenuPeriod`'s checks already refuse a duplicate, the period's own menu
  and an inactive menu (`menu-timetable.ts:353-361`). The database no longer refuses an unknown menu.
  A stale id cannot appear by a delete: menus are never deleted, only deactivated
  (`packages/catalogue/src/operations.ts:889-891`; `git grep -n 'delete(catalogues)' -- 'apps/*/src/*' 'packages/*/src/*'`
  outside tests finds nothing), and today's rows already outlive a deactivated menu.
- **What the import must learn:** it rewrites an id only when a whole value equals one, never ids
  inside a list (`scripts/id-columns-are-references.test.ts:24-25`), and its check of these rows
  (`packages/venue-service/src/configuration-transfer.ts:138-155`) moves onto the list. The devices
  and floor areas' lists need the same change.
- **Protections:** FKs to departments, menus and floor_plan_sets; `menu_periods_department_name_key`;
  `menu_periods_name_ck`; `menu_periods_colour_ck`; new, a CHECK that `staff_menu_ids` is a JSON array.
- `menu_periods_department_key (id, department_id)` stays. Besides the staff-menus key it is the
  target of `department_day_ranges` (`packages/venue-service/src/schema/seasons.ts:156`), which
  `opening_hours` keeps (`tables-venuebox.md` §5), and of `routing_cell_periods`
  (`packages/venue-service/src/schema/routing.ts:116`).
- state; 3–8 rows.

### 1.22 `media_images` (takes in `media_image_edits`)

The photo library: one row per photo, with its stable filename, translated names, current framing
and edit revision.

| column | type | key / null | from |
| --- | --- | --- | --- |
| `id` | text | PK | media_images |
| `filename` | text | not null, unique, CHECK (64 hex characters + `.jpg`/`.png`/`.webp`) | media_images |
| `original_hash` | text | not null, FK → media_blobs.hash RESTRICT; CHECK `= substr(filename,1,64)` | new, where the original upload's bytes live |
| `source_hash` | text | null, FK → media_blobs.hash RESTRICT | media_image_edits (replacement picture) |
| `focus_x`, `focus_y` | integer | not null, default 5000, CHECK 0–10000 | media_image_edits |
| `zoom` | integer | not null, default 100, CHECK 100–400 | media_image_edits |
| `revision` | integer | not null, default 1, CHECK ≥ 1 (refuses two people overwriting each other's edits) | media_image_edits |
| `original_filename` | text | null, CHECK (length, no NUL/CR/LF) | media_image_edits |
| `names` | json | not null, CHECK `json_type = 'object'` | media_images |
| `created_at`, `updated_at` | ts | not null; index `(created_at, id)` | media_images |

- `media_image_edits` is one row per photo, created with the photo (`images.ts:349`) and updated in
  place. That is exactly R1's fold case.
- **Protections:** every CHECK from both tables, `media_images_filename_key` and
  `media_images_date_idx`. `media_image_edits_source_fk` becomes `media_images_source_fk`. The edits
  table's cascade FK is no longer needed.
- Products, sections, include folders and menu versions point at `filename` through the 15
  `*_media_image_fk_*` triggers (listed in `scripts/behavioural-triggers.test.ts:99-113`), all kept.
- state; 100–200 rows.

### 1.23 `media_blobs` (takes in `media_image_data` and `media_image_blobs`)

The stored bytes of every picture, original or replacement, kept once per content hash.

| column | type | key / null |
| --- | --- | --- |
| `hash` | text | PK; CHECK 64 lowercase hex characters, no NUL |
| `format` | text | not null; CHECK in `jpg`, `png`, `webp` (today a replacement is always webp, `images.ts:371-376`) |
| `bytes` | blob | not null |

- It stays a separate table, because the bytes are immutable and shared by hash. A replacement can be
  used by more than one photo, and its lifetime is not one photo's. It also keeps the stated reason
  for the split, "metadata reads and change subscriptions never select a photo payload"
  (`packages/media/src/schema/images.ts:31`).
- **Today the same bytes can be stored twice.** `media_image_data` keys an original by photo id, and
  `media_image_blobs` keys a replacement by hash. `readImageBytes` looks in one and then the other
  (`images.ts:361-387`).
- **Lifetime (owner, 2026-11-04):** today a replaced picture's bytes are never removed (no
  `.delete(mediaImageBlobs` in non-test code). A blob is deleted in the same transaction when a photo
  delete or replace leaves no `original_hash`/`source_hash` naming it. The two RESTRICT keys make
  deleting a blob that is still in use impossible.
- state; 100–250 rows. This is storage growth (whole image files), not row growth.

---

## 2. Settings documents

### `settings.menu` (venue database, `settings` row with `module = 'menu'`, `version` 1)

| field | type | default | came from |
| --- | --- | --- | --- |
| `defaultProductVatClass` | `general` \| `reduced` \| `super_reduced` \| `zero` | `general` | `catalogue_settings.default_product_vat_class` |
| `defaultColor` | `#rrggbb` lowercase \| null | null | `catalogue_settings.default_color` |
| `starterUnitsCreated` | boolean | false | `unit_seed_states` (row present = true) |

- The database CHECK `catalogue_settings_vat_class_ck` becomes the document's validation in code (§5).
  The save's revision check replaces the guarantee that `insert … on conflict do nothing returning`
  gave the unit seeding (`packages/catalogue/src/provisioning.ts:90-93`): starter units are created at
  most once.
- The document travels in a configuration export, because both source tables do today
  (`packages/catalogue/src/configuration-transfer.ts:209-210`).
- No ids in the document (R4). The default menu is the `menus.is_default` flag.

### Content languages go to `settings.venue` (owner, 2026-11-04)

`contentLanguages` (string list, 1–200 language codes, no duplicates, set at first setup from the
country pack) and `defaultContentLanguage` (must be in the list) join `settings.venue`, beside
`invoiceLocales` (`tables-venuebox.md` §2.1).

- The database CHECKs `content_languages_default_ck` and `_list_ck` become the venue document's
  validation in code. No SQL reads this table: a grep of `packages/*/drizzle/*.sql` finds only the
  baseline that creates it, so no trigger has to learn to read the document. Its code readers
  (catalogue, media, `apps/server/src/working-order.ts`, `venue-locale.ts`, `kitchen-language.ts`) go
  through `packages/catalogue/src/content-languages.ts` and switch with it.
- `settings.venue` does not travel as a document; the venue's fields travel in the bundle's `venue`
  field (`tables-venuebox.md` §2.4). Today `content_languages` is a transferred table, checked against
  the importing venue's geography (`checkContentLanguages`,
  `packages/catalogue/src/configuration-transfer.ts:80`). The two fields join the bundle's `venue`
  field, and that check moves with them.

---

## 3. History

**Typed history tables that remain** (read back by product code):

- `menu_versions`. Read on the sale path: `readLiveDocuments`
  (`packages/catalogue/src/menu-publication.ts:248`) is called by venue-service's
  `liveDocumentsByZone` (`packages/venue-service/src/operations.ts:788-792`), and `readLiveMenu`
  (`menu-publication.ts:675`) by the management API's menu route
  (`apps/server/src/catalogue-api.ts:1115`). The till reads them in
  `apps/till/src/state/menu-refresh.ts`. Sale lines point at them by `menu_version_id`.
- `menu_version_images`. Read by media's photo delete and rename triggers.
- `menu_releases` is current state, not history, but its `superseded` and `cancelled` rows keep the
  publishing record (`listMenuPublications`, `menu-schedule.ts:166`).

**To `activity_log`** (for people to read; product logic never decides from it, README §3):

| `kind` | subject | `data` | written by |
| --- | --- | --- | --- |
| `menu_edition.rescheduled` | menu_versions.id | from → to `activates_at` (today the old time is overwritten, `menu-schedule.ts:156-159`) | `rescheduleMenuPublication` |
| `menu.archived` | menus.id | name | `deactivateCatalogue` (`operations.ts:889-891`) |
| `product.archived` | products.id | name, variant ids | `packages/catalogue/src/archive.ts` |
| `photo.deleted` | media_images.id | filename, names | `packages/media/src/images.ts` delete |

These are low-volume conveniences; dropping any of them changes nothing that gets built. Supplier
invoices write no history here: they need a design first (backlog A1326). A history of `settings.menu`
saves is the central `settings` design's business, not this area's.

---

## 4. Mapping (every current table)

| current | fate | why |
| --- | --- | --- |
| catalogues | rename to `menus` | the menu; drops unused `version`; takes in menu_details and the default flag |
| categories | keep | takes in category_details |
| products | keep | takes in product_units as `unit_id`; drops `catalogue_id`, the copies (`pricing_unit`, `name_key`, `manual_allergens` as a second column, `diet`) and the two recipe columns |
| location_catalogues | delete (owner, 2026-11-04) | no screen uses the venue's list of extra menus; supersedes A1301's `venue_catalogues` |
| ingredients | delete (owner, 2026-11-04) | recipes removed |
| recipe_lines | delete (owner, 2026-11-04) | recipes removed |
| purchase_invoice_vat | keep, unchanged | many per invoice, grouped in SQL |
| purchase_invoices | keep, unchanged | needs its own design (backlog A1326) |
| content_languages | → `settings.venue` | one-row policy (R3), beside the invoice languages (owner, 2026-11-04) |
| menu_details | merge into `menus` | one row per menu (R1); root/home pointers duplicate `sections.role` |
| menu_items | keep | link with a price (R7) |
| category_details | merge into `categories` | one row per category (R1) |
| product_units | merge into `products` (`unit_id`) | at most one row per product (R1) |
| unit_seed_states | → settings.menu (`starterUnitsCreated`) | one-row marker |
| units | keep | `products.unit_id` points at it |
| menu_item_variant_overrides | keep | real per-menu, per-variant price |
| option_labels | keep | takes the preselected flag `is_default` |
| option_lists | keep | drops the unchecked `default_label_id` (R4) |
| extra_list_items | keep | |
| extra_lists | keep | |
| product_modifiers | keep | link table (R7) |
| section_members | keep | `folder_overrides` split into three columns (photo id out of JSON, R4) |
| sections | keep | root's staff name moves to `menus.name`; one root/home per menu enforced |
| menu_publications | merge into `menu_releases` | the live pointer becomes `state = 'live'` |
| menu_scheduled_publications | rename to `menu_releases` | the queue and the pointer in one row per version; drops duplicates `queued_at`/`queued_by` and the unread `activated_at` |
| menu_version_images | keep | the database's photo-in-use check needs it |
| menu_versions | keep | frozen document; sales point at it |
| catalogue_settings | → settings.menu | one-row defaults (R3) |
| content_suggestion_jobs | keep | `run_total` stored once per run |
| content_suggestions | keep | |
| menu_period_staff_menus | merge into `menu_periods.staff_menu_ids` | a short list owned by one period (owner, 2026-11-04) |
| menu_periods | keep | takes in the staff menu list |
| media_image_blobs | rename to `media_blobs` | one store of bytes by content hash |
| media_image_data | merge into `media_blobs` | originals' bytes keyed by their hash, not by photo id |
| media_image_edits | merge into `media_images` | one row per photo (R1) |
| media_images | keep | takes in the edit columns and `original_hash` |

`location_catalogues`, `ingredients` and `recipe_lines` are the three tables in this area deleted
outright, by the owner's choice. Every other table has a product writer named in the tables file, and
none serves only a second box (R11). The classification reason "copied to a standby"
(`packages/catalogue/src/classification.ts`) describes replication, not a second-box-only feature.

**What removing recipes takes with it** (owner, 2026-11-04). Found with `git grep` over the whole tree,
leaving out `docs/`; read, not run.

- **Package and server:** `packages/recipes`; `apps/server/src/recipe-api.ts` and its two test files;
  `apps/server/scripts/recipes-demo.ts`, with `demo:recipes` and the dependency in
  `apps/server/package.json:36`, `:67`.
- **Dashboard:** `apps/dashboard/src/screens/recipe-screen.ts`; the widgets `recipe-editor.ts`,
  `ingredient-form.ts`, `ingredient-list.ts` and `dietary-origin-picker.ts`, whose only user is the
  ingredient form; the client methods and types (`apps/dashboard/src/api/client.ts:480-494`, `:604-624`,
  `:3445-3461`); the two tables in the live query lists (`apps/dashboard/src/api/live-queries.ts:341-342`,
  `:515-516`); the recipe, ingredient and `origin.*` strings; and `recipeOrigins` in the product list
  (`apps/dashboard/src/widgets/product-list.ts:105-107`). Today the list's "has dietary info" check
  reads it (`:112`, `:119`). After this it reads the declarations and the override alone.
- **The permission:** `recipe.manage` (`packages/identity/src/permissions.ts:27`, `:69`). Its one gate is
  `apps/server/src/recipe-api.ts:31`.
- **Schema lists:** `packages/db/src/schema/recipes.ts`, `packages/db/src/classification.ts:119-120`,
  `packages/db/src/index.ts:176`, and `packages/db/src/configuration-transfer.ts:74-75`, so the
  configuration bundle's `version` moves on again (§1.1).
- **The `dietDerivation` field, which reaches further than `products`:** the menu types and change lists
  (`packages/catalogue/src/menu-types.ts:49`, `:82`, `:144`, `menu-document.ts:755`,
  `menu-navigation.ts:175`), so a new menu document stops carrying it; the line's frozen copy
  (`packages/venue-service/src/schema/service.ts:271`, `operations.ts:1200`, `:1219`,
  `apps/server/src/working-order.ts:5215`, `:5426`, `packages/module/src/module.ts:239`, `:439`, `:1195`),
  which `tables-ordersales.md` §1.2 no longer takes; and the till
  (`apps/till/src/api/client.ts:391`, `:407`, `:423`, `:528`, `apps/till/src/state/as-served.ts:37`).
- **Guards and CI:** `scripts/schema-constraints.test.ts:274-275`, `:489`, `scripts/changed-scope.mjs:314`
  and `.github/workflows/ci.yml:3415`. Adding or removing a workspace package also touches the root
  guards' shard lists (CLAUDE.md §2).
- **Fixtures:** `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:135-136`
  and the `madrid-before-move` files in `packages/country-es/test-fixtures/demo/`, which name both
  tables, holding no rows.
- **Not touched:** `apps/server/src/kitchen-allergy.ts:247`, `:251` and `:289` say "ingredients", but they
  mean a dish's declared allergens: `readAsServedAllergens` reads the line, and the word is only a label
  for what changed. That code stays.

---

## 5. Protections

| current protection | new home / dropped |
| --- | --- |
| catalogues PK | menus PK |
| products: `products_top_level_owns_ck` | products, without the `pricing_unit` term |
| products: `products_pricing_unit_ck` | **dropped**: the column goes |
| products: `products_vat_class_ck` | products |
| products: `products_id_catalogue_key`, FK to catalogues, `products_catalogue_id_idx` | **dropped**: the column goes (owner, 2026-11-04) |
| products: parent composite FK | a plain self FK, RESTRICT |
| products: `products_parent_id_key`, FKs to category and course | products |
| products: course index | products |
| products: `products_name_key_idx` | **dropped** with `name_key` (subject to §8, item 1) |
| products: triggers `variant_one_level_insert`, `variant_parent_fixed_update`, `id_fixed_update` | products, unchanged |
| products: triggers `ordering_check_insert`/`_update` | a declared CHECK on `products.ordering`; triggers dropped |
| products: `products_media_image_fk_{insert,update,parent_delete,parent_rename}` | unchanged |
| location_catalogues PK and FKs | **dropped** with the table (owner, 2026-11-04) |
| ingredients: `ingredients_dietary_origin_ck` | **dropped** with the table (owner, 2026-11-04): recipes removed |
| recipe_lines: FKs, indexes, `recipe_lines_product_ingredient_key` | **dropped** with the table (owner, 2026-11-04): recipes removed |
| purchase_invoices: expression unique index, received index, regime CHECK, deductible CHECK | purchase_invoices |
| purchase_invoice_vat: cascade FK, index, rate CHECK, kind CHECK | purchase_invoice_vat |
| content_languages: `_singleton_ck` | not needed (one `settings` row per module by primary key) |
| content_languages: `_default_ck`, `_list_ck` | **moved to code**: the `settings.venue` validator; no SQL reads the value |
| menu_details: PK, `menu_details_menu_fk` | not needed (columns on `menus`) |
| menu_details: `menu_details_root_fk`, `_default_layout_fk`, `menu_details_root_uq` | `sections_one_root_per_menu_uq` (one root and one home per menu) |
| menu_items: two unique keys, two FKs, price CHECK | menu_items |
| category_details: PK, cascade FK | not needed (columns on `categories`) |
| category_details: parent FK (restrict), parent index | `categories.parent_id` FK and index |
| product_units: PK (one unit per product) | one column per product; that is the same guarantee |
| product_units: product FK cascade | not needed |
| product_units: unit FK restrict, unit index | `products.unit_id` FK restrict, index |
| unit_seed_states: singleton CHECK | not needed (document field) |
| units: seed_key unique, precision CHECK, hardware_unit CHECK | units |
| menu_item_variant_overrides: PK, both FKs, two CHECKs | unchanged |
| option_labels: list FK cascade, sort index | unchanged |
| option_lists: (none; `default_label_id` unchecked) | **gains** `option_labels_one_default_uq` |
| extra_lists, extra_list_items, product_modifiers: all keys, CHECKs, indexes | unchanged |
| section_members: FKs, `_one_ref_ck`, two unique indexes, three indexes | unchanged |
| section_members: expression index on `folder_overrides ->> '$.image'` | a plain partial index on `folder_image` |
| section_members: `section_members_media_image_fk_*` (4) | same four, reading `folder_image` |
| sections: owner FK, role CHECK, owner index, `sections_media_image_fk_*` (4) | unchanged; gains the root/home unique index and the root-name CHECK |
| menu_publications: PK on menu_id | `menu_releases_one_live_uq` |
| menu_publications: version composite FK | `menu_releases` composite FK |
| menu_scheduled_publications: PK, menu FK, version composite FK, state CHECK, queued-time partial unique | menu_releases |
| menu_scheduled_publications: `_settled_ck` | menu_releases, reworded for the four states |
| menu_scheduled_publications: `_after_queue_ck` | **moved to code**: `queued_at` is no longer stored; `menu_publication.time_past` already refuses it |
| menu_version_images: PK, FK, filename index, append-only pair, `…_media_image_fk_insert` | unchanged |
| menu_version_images: `…_parent_delete`, `…_parent_rename` | rewritten to read `menu_releases.state in ('live','queued')` |
| menu_versions: FK, two unique keys, number CHECK, append-only pair | unchanged |
| catalogue_settings: singleton, vat CHECK | moved to code (`settings.menu` validator) |
| content_suggestion_jobs, content_suggestions: all keys, CHECKs, indexes | unchanged |
| menu_period_staff_menus: PK | **moved to code**: `writeMenuPeriod` refuses a duplicate |
| menu_period_staff_menus: menu FK | **moved to code**: `writeMenuPeriod` refuses an unknown or inactive menu, and the import check moves onto the list; menus are never deleted (§1.21) |
| menu_period_staff_menus: composite period FK `(period_id, department_id)` cascade | not needed (the list is on the period) |
| menu_periods: FKs, name unique, name CHECK, colour CHECK | unchanged |
| menu_periods: `menu_periods_department_key` | kept: `opening_hours` and `routing_cell_periods` target it (§1.21) |
| media_images: filename unique, date index, filename CHECK, names CHECK | unchanged |
| media_image_data: PK, cascade FK | `media_images.original_hash` FK restrict; deletion by code (§1.23) |
| media_image_blobs: hash CHECK | `media_blobs` hash CHECK, plus a format CHECK |
| media_image_edits: image FK cascade | not needed |
| media_image_edits: source FK restrict, focus/zoom/revision/filename CHECKs | `media_images` |
| change-feed triggers (`packages/db/src/change-feed.ts:127`, one set per table listed in each module's change sources) | follow the table: merged tables are listed under their new names; dropped tables leave the lists |

---

## 6. Duplicates removed

| the same thing stored twice | where | one home |
| --- | --- | --- |
| a menu's root and home sections | `menu_details.root_section_id`/`default_home_layout_id` and `sections.role` + `owner_menu_id` (`section-graph.ts:91-93`) | `sections` with a unique `(owner_menu_id, role)` |
| a menu's staff name | `catalogues.name` and the root section's `internal_name`; a rename writes both (`operations.ts:878-886`), a copy writes both (`menu-copy.ts:69`) | `menus.name` |
| whether a product is sold by weight | `products.pricing_unit` and `units.hardware_unit` via `product_units` (`operations.ts:331-333`) | `products.unit_id` → `units.hardware_unit` |
| a product's published allergens and diet | `products.allergens` and `diet`, computed from `manual_allergens` and `diet_override` | `products.allergens`, holding the declaration, and `diet_override`; the diet profile is worked out on read |
| a product's folded name | `products.name_key` and `name` | `name` (after §8, item 1) |
| a queued edition's time and author | `menu_scheduled_publications.queued_at`/`queued_by` = `menu_versions.published_at`/`published_by` (`menu-schedule.ts:58-67`) | `menu_versions.created_at`/`created_by` |
| the live version and since when | `menu_publications.version_id`/`published_at`, alongside the version and schedule rows | `menu_releases.state = 'live'` and its `activates_at` |
| when a queued edition went live | `menu_scheduled_publications.activated_at`: written (`menu-publication.ts:166`), never read (grep `activatedAt` in `packages/catalogue/src` and `apps/dashboard/src` finds only the schema and that write) | dropped; `activates_at` is the time |
| a photo's bytes | `media_image_data` (by photo id) and `media_image_blobs` (by hash); a replacement equal to an original is stored in both | `media_blobs` by hash |
| a staff-menu row's department | `menu_period_staff_menus.department_id` and `menu_periods.department_id` | `menu_periods`, which now holds the list |
| a suggestion run's size | `content_suggestion_jobs.run_total` on every batch (`content-suggestion-store.ts:272`) | the first batch |
| the venue's default menu | `locations.catalogue_id` today; A1301 plans `venue_settings.default_catalogue_id` | `menus.is_default` |

---

## 7. Depends on other areas

- **Orders and sales.** `working_order_lines.product_id` → products (`packages/db/src/schema/orders.ts:236-239`)
  and `sale_lines.menu_version_id` (`sales.ts:207`). Sale lines copy the category name.
- **Floor and kitchen.** `products.course_id` → `kitchen_courses`. `routing_cells` → categories and
  products (`packages/venue-service/src/schema/routing.ts:35-43`); its `location_id` goes under R10
  in that area. `working_line_contexts` → menu_versions and menu_items (`service.ts:4,294`).
  `menu_periods` → `departments` and `floor_plan_sets`.
- **Venue and box (A1301).** This design replaces A1301's `venue_catalogues` table and
  `venue_settings.default_catalogue_id` with `menus.is_default`
  (`docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md` §2.1 and its S23 row). A1301's
  spec and plan already say so (their amendments of 2026-11-04). That area must not add the id to its document. Both of today's homes are still on main
  (`packages/db/src/schema/tenants.ts:90`, `packages/db/src/schema/location-catalogues.ts`).
  - Configuration export format 10 (#2415) carries the default as a top-level bundle field, not a
    venue field. The venue area's document must not take it back (§1.1).
  - Content languages join `settings.venue` (`tables-venuebox.md` §2.1) and the bundle's `venue`
    field (§2).
- **Devices and theming.** Receipt logos become the checked key `departments.receipt_logo_image_id`
  (`tables-venuebox.md` §1.10), and theme logos become columns on `custom_themes` (`tables-devices.md`).
  Media's usage list and redraw read them through those columns instead of inside JSON
  (`packages/media/src/images.ts:104-115`, `packages/media/src/image-edits.ts:75-97`), and a photo
  delete is refused while a receipt logo names it.
- **People.** `menu_versions.created_by` and `menu_releases.cancelled_by` gain a key to `persons`,
  because identity's tables fold into core (README U1, U11). Writers pass the signed-in person
  (`packages/catalogue/src/menu-publication.ts:650`, `:744`, `:784`,
  `packages/catalogue/src/menu-schedule.ts:63`, `:120`); read, not traced to every caller.
- **Shared.** `settings` (one `menu` row, and two fields in `venue`) and `activity_log` (§3).

---

## 8. Measure before building

1. **Dropping `name_key`.** Time the staff-name uniqueness check by scan (fold every product name in
   code, as `menu-names.ts` does) at 1,000 products. **Failing result:** more than about 20 ms per
   product save. Then keep `name_key` and its index.
2. **The rewritten photo-in-use triggers.** Delete a photo while 3 menus are live and 2 editions are
   queued, with 15,000 `menu_version_images` rows, using the new join on `menu_releases`. Use
   `EXPLAIN QUERY PLAN` and a timing. **Failing result:** a full scan of `menu_version_images`, or a
   delete over 10 ms. Then add an index `(version_id)`, or a `(state, version_id)` index on
   `menu_releases`.
3. **The size of a menu document.** Measure `length(document)` for the reference menu, times 300
   versions a year. **Failing result:** over about 100 MB a year. Versions cannot be pruned (sales
   point at them), so the design would then need a compressed `document` or one shared store of
   unchanged sub-documents. I could not measure this: the brief allowed no test runs.
4. **`menu_releases` versus the pointer on the sale path.** `liveVersions` reads the `live` row
   instead of `menu_publications`. Time `readLiveDocuments` for 3 menus. **Failing result:** slower
   than today by more than noise. Then add a covering index `(menu_id, state)`.
5. **The lists through a configuration export.** Export and import a period with two staff menus.
   **Failing result:** `staff_menu_ids` arrives naming the exporting venue's menus, or out of order.

---

## 9. Decisions for the owner

The owner has settled this area's decisions on 4 November: the tables go into core (README U1); the
default is a flag and `offered` goes; `catalogues` becomes `menus`, and the rename reaches the package,
the settings document and the screen file; computed allergens and diet stop being stored; recipes
go, and the recipe screen's picker with them; replaced photo bytes are pruned; content languages join
`settings.venue`; the two CHECKs are declared; staff menus become a list on the period;
`products.catalogue_id` goes. No question is open in this area.

**Could not establish:**

- The size of a published menu document (§8, item 3).
- Whether the Cloud translation service that `content_suggestion_*` talks to is reachable today. The
  box side is built (`apps/server/src/cloud-translation.ts`); I kept the tables.

**2026-11-10, slice 5c:** the bundle carries `contentLanguages` and `holidayArea` at its top level,
not inside `venue`, which keeps setup fields including `invoiceLocales` (5c plan, item 7).

# A1308 menu and photos, PR mn7: a menu is one row, a category is one row — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** `menus` takes in `menu_details`' six Home-page display columns, with the CHECKs their
ranges never had; a menu's root and Home sections are found from `sections` by role, held by one new
unique index; `categories` takes in `category_details`' parent and colour; the unused
`menus.version` goes; and archiving a menu is recorded in `activity_log`.

**Architecture:** Two side tables keyed by their parent's id fold into the parent (README R1). The
pointers `menu_details.root_section_id` and `default_home_layout_id` duplicate `sections.role` plus
`owner_menu_id` (tables-menu.md §6), so the code reads roles instead, and the partial unique index
`sections_one_root_per_menu_uq` takes over the guarantee `menu_details_root_uq` and the two keys
gave. Display settings are columns of `menus` with declared CHECKs, possible now because the table
is created fresh.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Lit, Vitest, slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R1, R6;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.1 (columns, CHECKs, dropped
`version`), §1.2, §1.14 (the one-root index only; the root-name CHECK is mn8's), §3 (`menu.archived`),
§5, §6; [slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7` with mn1/mn3's paths and names
(`packages/menu/src/menu-structure.ts:44` is today's `packages/catalogue/src/menu-structure.ts:44`;
`menus` is today's `catalogues`; `createMenu` is `createCatalogue`). Batch 1 and mn1–mn6 have landed;
slice 5 added `menus.is_default` (its index name is whatever slice 5 chose, renamed by mn3). A missing
identifier this plan does not explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **`menus` gains** `handheld_columns`, `handheld_tiles`, `handheld_order`, `till_columns`,
   `till_tiles`, `till_order`, not null, defaults from `HOME_DISPLAY_DEFAULTS`
   (`packages/shared/src/menu-document/device-home.ts:19-22`), with CHECKs:
   - `menus_handheld_columns_ck`: `handheld_columns between 2 and 3`;
     `menus_till_columns_ck`: `till_columns between 4 and 10` (`HOME_COLUMN_RANGE`, `:23-26`; the
     schema writes the four numbers through `sql.raw(String(n))` from that constant, and a schema test
     pins them equal);
   - `menus_handheld_tiles_ck`, `menus_till_tiles_ck` over `HOME_TILE_MODES` (`:16`) and
     `menus_handheld_order_ck`, `menus_till_order_ck` over `HOME_ORDERS` (`:17`), declared with
     `enumType`/`enumCheck` (`packages/db/src/schema/columns.ts:113`), so the schema-conformance
     suite's vocabulary rule is met (the reason `packages/db/src/schema/menu/menu.ts:47-49` gave for
     not using `enumType` was the missing CHECK).
   `homeDisplayProblem` (`device-home.ts:31-46`) stays as the request check that names the field.
2. **`menus.version` goes** (nothing increases it: `packages/menu/src/operations.ts:120`), and the
   `version` field leaves the `Menu` type (`:116-122`) and its column list. Any reader of a menu's
   `version` outside the menu package is a stop.
3. **`menu_details` goes.** Readers and writers:
   - `createMenuShell` (`packages/menu/src/menu-structure.ts:29-46`) inserts the two sections and no
     details row; it returns the same `{ rootSectionId, homeSectionId }`.
   - `menuRoots` (`:49-61`), `menuRoot` (`:64-70`) and `requireMenuRoot` (`:72-77`) read
     `sections` where `role = 'menu_root'` and `owner_menu_id` is the menu (batched as today).
     A new `menuHome(tx, menuId)` beside them reads the `home_layout` section.
   - `buildMenuDocuments` (`packages/menu/src/menu-document.ts:146-178`) reads the six columns from
     `menus` and the two section ids by role.
   - `requireMenuHome` (`packages/menu/src/menu-home.ts:52-60`) and `setHomeDisplay` (`:128-136`)
     read and update `menus`; `homeDisplaysOf` (`:44-49`) takes a `menus` row.
   - `copyMenu` (`packages/menu/src/menu-copy.ts:29`, `:78`) copies the six columns onto the new
     menu's row and writes no details row.
   - `updateMenuDetails` (`operations.ts:856-894`) keeps its name and behaviour.
   - Raw SQL in `packages/menu/src/content-translation-candidates.ts:89`, `:98`: the two
     `left join menu_details d … (d.root_section_id = s.id)` become `(s.role = 'menu_root')`.
   - `packages/menu/src/operations.ts:363` and any other `menuDetails` import (grep
     `menuDetails|menu_details` across `apps packages scripts`).
4. **`sections_one_root_per_menu_uq`**: unique on `sections(owner_menu_id, role)` where
   `role in ('menu_root','home_layout')` (tables-menu.md §1.14). It replaces `menu_details_root_uq`,
   `menu_details_root_fk` and `menu_details_default_layout_fk` (§5: "`sections_one_root_per_menu_uq`
   (one root and one home per menu)").
5. **`categories` gains** `parent_id` (key to `categories.id` `on delete restrict`, index
   `categories_parent_idx`) and `color`; `category_details` goes. Readers and writers:
   `packages/menu/src/categories.ts` (8 sites), `product-items.ts` (5; today `catalogue-items.ts`), `category-names.ts` (4),
   `sale-classification.ts` (3), `packages/venue-service/src/menu-timetable.ts` (3),
   `packages/venue-service/src/routing-store.ts` (5) — counts from
   `git grep -c categoryDetails` at `a086eedfb7`. A category write that set both its row and its
   details row now writes one row.
6. **`menu.archived` in `activity_log`**: `deactivateMenu(tx, id, personId)` (`operations.ts:896-898`)
   records subject `menu`, data `{ name }`, when the menu was active. Its route passes the session's
   person (`apps/server/src/menu-api.ts`, the route that calls it).
7. **Lists:** classification (`packages/db/src/classification.ts:291`, `:306`;
   `packages/menu/src/classification.ts:5`, `:20`), exports, the configuration-export entries
   (`packages/menu/src/configuration-transfer.ts:212` `category_details`, `:227` `menu_details`; the
   checks `checkHomeDisplays(tables.menu_details)` at `:162` and `checkColors(tables.category_details, …)`
   at `:164` read the `menus` and `categories` rows instead, refusing `menus.<column>` and
   `categories.color`), live-query lists (`apps/dashboard/src/api/live-queries.ts:12`, `:86`,
   `:302-307`, `:339`; `packages/venue-service/src/dashboard/live-queries.ts:257`),
   `apps/server/src/testing/clear-provision-fixture.ts:55-56`. The bundle format moves on by one.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The root section's staff name moving to `menus.name` (`sections_root_name_ck`) | mn8 |
| `section_members.folder_overrides` split, the four triggers, the sections photo index | mn8 |
| `menus.is_default` | slice 5 (already landed) |
| The dashboard's display of a category's colour source (`docs/backlog/menu.md`, "A category's naming square…") | its backlog entry; no table change |

## Files

- Schema: `packages/db/src/schema/menus.ts` (menus, categories); delete `menuDetails` from
  `packages/db/src/schema/menu/menu.ts:37-75` and `packages/db/src/schema/menu/categories.ts` (whole
  file); `packages/db/src/schema/menu/sections.ts` (index); `packages/db/src/schema/menu/index.ts`;
  `packages/db/src/index.ts:404`; `packages/db/src/classification.ts`
- Menu package: `menu-structure.ts`, `menu-document.ts`, `menu-home.ts`, `menu-copy.ts`,
  `operations.ts`, `content-translation-candidates.ts`, `categories.ts`, `product-items.ts`,
  `category-names.ts`, `sale-classification.ts`, `classification.ts`, `configuration-transfer.ts`,
  `index.ts`, `test/fixtures.ts`
- Venue service: `menu-timetable.ts`, `routing-store.ts`, `dashboard/live-queries.ts`
- Server: `apps/server/src/menu-api.ts`; `testing/clear-provision-fixture.ts`
- Dashboard: `apps/dashboard/src/api/live-queries.ts`; `screens/menus-screen.ts:734`, `:1394`,
  `:1406`, `:2440` (live names or comments naming `menu_details`)
- db: `packages/db/src/activity-kinds.ts`
- Regenerated: core's `drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (foreign keys: remove `menu_details` and
  `category_details` rows, add `["categories", ["parent_id"], "categories"]`; unique indexes: remove
  `menu_details_root_uq`, add `sections_one_root_per_menu_uq`; CHECKs: add the six), 
  `scripts/live-subscriptions.test.ts`, `packages/db/src/schema/menu/migrations.test.ts`,
  `scripts/two-file-foreign-keys.test.ts` (runs)
- Tests: `packages/menu/src/menu-structure.test.ts`, `menu-home.test.ts`, `menu-home-columns.test.ts`,
  `menu-copy.test.ts`, `menu-document.test.ts`, `categories.db.test.ts`, `categories.test.ts`,
  `sections.db.test.ts`, `content-translation-pages.test.ts`, `configuration-transfer.test.ts`,
  `operations.test.ts`; `packages/db/src/schema/menus.test.ts`; venue-service tests that seed
  categories; the Madrid baseline
- Docs: `docs/developers/product-categories.md`, `docs/developers/products.md` and
  `docs/developers/design-system.md` where they name `menu_details` or `category_details`

## Size

| | Code | Tests |
| --- | --- | --- |
| Menus' display columns and CHECKs | 40 | 90 |
| `menu_details` readers and writers | 120 | 80 |
| One-root index | 10 | 40 |
| Categories fold | 80 | 60 |
| `menu.archived` | 25 | 40 |
| Lists, transfer, format, Madrid transform, docs | 60 | 60 |
| **Counted** | **335** | **370** |

About 705 counted lines. About 3 hours.

## Finish line

1. `pnpm --filter @waitron/db exec vitest run src/schema/menus.test.ts src/schema/menu/migrations.test.ts`
   passes, including "refuses a handheld with 4 columns", "refuses a second root section for one
   menu" and "refuses deleting a category that has a subcategory".
2. `pnpm --filter @waitron/menu exec vitest run src/menu-structure.test.ts src/menu-home.test.ts src/menu-copy.test.ts src/categories.db.test.ts src/content-translation-pages.test.ts`
   passes, including "finds a menu's root and Home sections by role" and "records an archived menu".
3. `git grep -n -E "menuDetails|menu_details|categoryDetails|category_details" -- apps packages scripts`
   prints only the captured fixtures.
4. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing table category_details
missing index category_details.primary key(category_id)
missing index category_details_parent_idx
missing table menu_details
missing index menu_details.primary key(menu_id)
missing index menu_details_root_uq
extra index categories_parent_idx
extra index sections_one_root_per_menu_uq
extra table categories.columns[color]
extra table categories.columns[parent_id]
changed table categories.columnOrder
old: [<base order>]
new: [<with parent_id and color>]
extra table categories.foreignKeys[parent_id->categories(id)]
missing table menus.columns[version]
extra table menus.columns[handheld_columns]
extra table menus.columns[handheld_order]
extra table menus.columns[handheld_tiles]
extra table menus.columns[till_columns]
extra table menus.columns[till_order]
extra table menus.columns[till_tiles]
changed table menus.columnOrder
old: [<base order>]
new: [<without version, with the six>]
extra table menus.checks[menus_handheld_columns_ck]
extra table menus.checks[menus_handheld_order_ck]
extra table menus.checks[menus_handheld_tiles_ck]
extra table menus.checks[menus_till_columns_ck]
extra table menus.checks[menus_till_order_ck]
extra table menus.checks[menus_till_tiles_ck]
```

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_category_details_delete
missing trigger waitron_change_category_details_insert
missing trigger waitron_change_category_details_update
missing trigger waitron_change_menu_details_delete
missing trigger waitron_change_menu_details_insert
missing trigger waitron_change_menu_details_update
changed trigger waitron_change_categories_update.when
old: <base comparison>
new: <with parent_id and color>
changed trigger waitron_change_menus_update.when
old: <with version>
new: <without version, with the six>
```

Why, from tables-menu.md §5: `menu_details`' primary key and menu key "not needed (columns on
`menus`)"; its root and Home keys and `menu_details_root_uq` → `sections_one_root_per_menu_uq`;
`category_details`' primary key and cascade "not needed"; its parent key and index →
`categories.parent_id` and `categories_parent_idx`; the six CHECKs are new (owner, 2026-11-04); the
`version` column has no protection. `categories` and `menus` (today `catalogues`) are change sources
(`CORE_CHANGE_SOURCES`, `packages/db/src/classification.ts:492-498`), so their update triggers'
`when` clauses change.

## Stop points (beyond rules §5)

1. A seeded or fixture menu has no `home_layout` section, or two (the new index would refuse a
   fixture that inserts sections by hand). Fix the fixture to match what `createMenuShell` writes;
   if a product path writes such a menu, stop.
2. A reader outside the menu package reads a menu's `version`.
3. `HOME_COLUMN_RANGE` differs from 2–3 and 4–10 when this PR starts.

## Needs

- **Outside this area:** slice 2 (`recordActivity`); slice 5 (`menus.is_default` exists).
- **In this area:** mn3 (names); mn6 (none of its columns, but it rebuilt core last; take `main`'s
  generated files and re-run the rebuild on rebase, rules §2.4).

## Global Constraints

- Rules §1–§9; core rebuilt, never edited.
- Each new CHECK and the new unique index: one refusal case and one legitimate-write case (rules §4).
- A write that touches a category's parent and colour is one `update`, never two rows.

## Review Focus

1. **One root and one Home per menu is still a database guarantee** (the new index), and nothing
   needs the old pointers.
2. **Copying a menu copies its display settings** (`menu-copy.test.ts`).
3. **A Home-page display change still refuses an out-of-range value with a field** (the request
   check), before the CHECK.

---

### Task 1: Menus take the display columns; the one-root index

**Files:** schema; `menu-structure.ts`, `menu-document.ts`, `menu-home.ts`, `menu-copy.ts`,
`operations.ts`, `content-translation-candidates.ts`; tests.

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases:**
  - `packages/db/src/schema/menus.test.ts` (raw SQL): `"refuses a handheld with 4 columns"`
    (`menus_handheld_columns_ck`; controls 2 and 3), `"refuses a till with 3 or 11 columns"`
    (`menus_till_columns_ck`; controls 4 and 10), `"refuses an unknown tile mode or order"` (the four
    names; controls each listed value), `"pins the column ranges to HOME_COLUMN_RANGE"` (reads the
    CHECK text from `sqlite_master` and compares the four numbers to the constant),
    `"refuses a second root section for one menu"` and `"…a second Home section"`
    (`UNIQUE constraint failed` naming `sections.owner_menu_id, sections.role`); control: many
    `section` rows for one menu insert.
  - `menu-structure.test.ts` `"finds a menu's root and Home sections by role"`; the existing
    `createMenuShell` cases keep their assertions.
  - `menu-home.test.ts`, `menu-home-columns.test.ts`: existing cases re-pointed from `menu_details`
    to `menus`; expected values unchanged.
  - `menu-copy.test.ts` `"copies the Home display settings"`.
  - `content-translation-pages.test.ts`: the cases that mark a menu's root keep their assertions.
- [ ] **Step 3: Run; see them fail.**
- [ ] **Step 4: Implement** items 1–4; rebuild core.
- [ ] **Step 5: Run — PASS. Commit.**

### Task 2: Categories take parent and colour

**Files:** schema; `categories.ts`, `product-items.ts`, `category-names.ts`, `sale-classification.ts`;
venue-service `menu-timetable.ts`, `routing-store.ts`; tests.

- [ ] **Step 1: Failing cases:** `packages/db/src/schema/menus.test.ts`
  `"refuses deleting a category that has a subcategory"` (`FOREIGN KEY constraint failed`; control: a
  leaf deletes); `categories.db.test.ts`: the existing parent, cycle and colour cases keep their
  assertions with one row per category.
- [ ] **Step 2–4:** Run (fail), implement item 5, rebuild core, run (pass). **Commit.**

### Task 3: `menu.archived`, the lists, the export

**Files:** `operations.ts`, `menu-api.ts`, `activity-kinds.ts`, the lists in item 7; tests.

- [ ] **Step 1: Failing cases:** `operations.test.ts` `"records an archived menu"` (subject `menu`,
  data `{ name }`, the given person) and `"records nothing when the menu was already inactive"`;
  `configuration-transfer.test.ts`: the refusals that named `menu_details.<column>` now name
  `menus.<column>` (the field string is the request contract, so changing it is planned here, not a
  moved behaviour) and `category_details.color` becomes `categories.color`.
- [ ] **Step 2–4:** Run, implement items 6–7, run. Bundle format on by one, with the refusal row at
  `apps/server/src/configuration-import.test.ts:204`. **Commit.**

### Task 4: Madrid baseline, guards, docs, finish

- [ ] **Step 1: Madrid baseline:** move the captured `menu_details` rows' six values onto the matching
  `menus` rows, drop `version` from `menus`, move `category_details`' `parent_id` and `color` onto
  `categories` rows, and remove both side tables and their phase counts. One helper, one test.
- [ ] **Step 2:** Guards (Files), docs.
- [ ] **Step 3:** Finish line; paste the protection-list report, marking each line;
  `/finish-branch`; push once.

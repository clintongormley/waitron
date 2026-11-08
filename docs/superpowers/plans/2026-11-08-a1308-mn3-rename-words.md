# A1308 menu and photos, PR mn3: "catalogue" leaves the words — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Every identifier, table, column, index, route, permission, error code, module name, live
update name, string key and visible word that says "catalogue" in the menu sense says "menu" (or,
for the Products screen, "products"), by one committed script a reviewer can re-run. The two other
meanings of the word stay: a string catalogue (translations) and the guide's page list.

**Architecture:** `scripts/a1308/rename-catalogue-words.mjs` applies three ordered tables to every
text file in scope: exact replacements first (the Products screen's names, the string keys, the
error codes and the permission), then protected spans that must not change (the other meanings),
then a case-keeping catch-all (`catalogue` → `menu`, `Catalogues` → `Menus`, `CATALOGUE` → `MENU`, as
whole words and inside identifiers). A `--report` run lists every occurrence it kept, with the rule
that kept it, for the reviewer to read. Core's starting migration is rebuilt; the configuration
bundle's format moves on.

**Tech Stack:** Node 24 ES modules, Vitest (root project), slice 1a's rebuild command.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §5 U9 and "Catalogue goes
everywhere"; [tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1 "The rename";
[slice rules](2026-11-08-a1308-slice-rules.md) ("rules §n"), especially §1 on rename scripts.

**Base and names:** cites are `file:line` at `a086eedfb7`, with the paths after PR mn1 (for
example `packages/menu/src/operations.ts:848` is today's `packages/catalogue/src/operations.ts:848`).
Batch 1, mn1 and mn2 have landed; mn2 deleted `catalogue_settings` and `unit_seed_states`, so this
PR does not meet them. Find a moved line by its identifier; a missing identifier this plan does not
explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6). The fiscal packages change only in test and comment lines and one
dependency name already moved by mn1 (`packages/fiscal-verifactu/src/write-path.e2e.test.ts:20`,
`:29`, `:710-712` call `createCatalogue`, which becomes `createMenu`). No value that reaches a sale
or a hash changes. If the watcher reads rules §6 as covering a fiscal package's test, the owner lands it.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. `scripts/a1308/rename-catalogue-words.mjs` and `scripts/a1308/rename-catalogue-words.test.mjs`.
2. The script's output, committed in the same pull request.
3. Core's starting migration rebuilt (the table `catalogues` becomes `menus`; `products.catalogue_id`
   becomes `products.menu_id`; three index names change, among them slice 5e's
   `catalogues_one_default_uq`, which becomes `menus_one_default_uq`; 5e's reader
   `readDefaultCatalogueId` becomes `readDefaultMenuId`).
4. The hand edits the script cannot make, listed in the pull request description (rules §1): the
   Spanish wording, any name clash the type check finds, doubled words in prose, the bundle format,
   and the Madrid baseline's table-rename transform.

### The three tables (exact text for the script)

**Exact replacements**, applied first, each matched as a whole token (the characters on either side
are not `[A-Za-z0-9_]`; a dotted or hyphenated key matches as written):

| From | To | Why |
| --- | --- | --- |
| `CatalogueScreen`, `dashboard-catalogue-screen` | `ProductsScreen`, `dashboard-products-screen` | the Products screen (tables-menu.md §1) |
| `CatalogueBrowser`, `dashboard-catalogue-browser` | `ProductBrowser`, `dashboard-product-browser` | its browser |
| `CatalogueFormsApp`, `catalogue-forms-leave-test-app`, `CatalogueLeaveApp`, `catalogue-leave-test-app` | `ProductFormsApp`, `product-forms-leave-test-app`, `ProductsLeaveApp`, `products-leave-test-app` | the screen's test apps |
| `CatalogueSelection`, `moveCatalogueItems`, `deleteCatalogueItems` | `ProductSelection`, `moveProductItems`, `deleteProductItems` | the screen's move and delete (`packages/menu/src/product-items.ts:11`, `:110`, `:136`) |
| `nav.catalogue`, `navCatalogue`, `nav-catalogue` | `nav.products`, `navProducts`, `nav-products` | the navigation entry reads "Products" (`apps/dashboard/src/i18n/strings.ts:1062`) |
| `catalogue.title`, `catalogue.add_product`, `catalogue.empty_prompt` | `products.title`, `products.add_product`, `products.empty_prompt` | string keys of the Products screen (`strings.ts:1418`, `:1463-1464`) |
| `catalogue_settings.` (prefix of a string key) | `menu_settings.` | `strings.ts:802-803`, `:4643-4644` |
| `catalogue.not_found`, `catalogue.failed`, `catalogue.manage` | `menu.not_found`, `menu.failed`, `menu.manage` | error codes and the permission (`packages/identity/src/permissions.ts:10`, `:48`) |
| `cataloguePrice` | `productPrice` | the product's own price in a test helper (`apps/dashboard/src/widgets/test-helpers.ts:477`, `:487`, `:497`); "menu price" would mean the opposite |
| the property and binding `catalogue` of `CombineInput` (`packages/shared/src/menu-document/menu-combine-types.ts:24`), in every file that names `CombineInput` or `combineOffer` (the dry run lists them: `packages/menu/src/menu-combine.ts:29`, its test, `apps/dashboard/src/widgets/menu-price-inheritance.test.ts:160`, and any builder of a `CombineInput`) | `product` | the product's own prices beside the menu's `own`; the catch-all would give `{ menu, own }`, reversing the two meanings |
| `ZoneOfferCatalogue` | `ZoneOffers` | the till's set of a zone's offers (`apps/till/src/till-app.ts:2866`); the catch-all's `ZoneOfferMenu` would read as one menu, and its `catalogue` field would become `menu.menus` |
| `#zoneCatalogues` | `#zoneOffers` | the till's cache of those sets (`till-app.ts:2866-2868`, `:6468`); the catch-all would give `#zoneMenus` and a second `#rememberZoneMenu` beside the existing one (`till-app.ts:6353`, `:6472`), and a use before declaration in `till-app.test.ts` |
| `rememberZoneCatalogue`, `forgetZoneCatalogues`, `zoneCatalogueGeneration` | `rememberZoneOffers`, `forgetZoneOffers`, `zoneOffersGeneration` | the same cache's helpers, kept consistent with the two rows above |
| in `apps/dashboard/**` only: the quoted literal `"catalogue"` and the path segment `/catalogue/` | `"products"`, `/products/` | the screen's id and its address (`apps/dashboard/src/dashboard-app.ts:146`, `:250`, `:2307-2308`, `:2968`; `apps/dashboard/src/screens/products-screen.ts:150`, `:161`, `:205`) |

**Protected spans**, masked after the exact replacements and before the catch-all, restored
unchanged:

| Rule | Where | What it keeps |
| --- | --- | --- |
| K1 | every file | the tokens `registerCatalogue`, `I18N_CATALOGUES`, `helpCatalogues`, `guide-catalogue` (and `./guide-catalogue.js`) |
| K2 | `apps/*/src/i18n/**`, `packages/dashboard-kit/src/i18n*.ts`, `packages/*/src/dashboard/strings*.ts`, `packages/recovery-pack/src/i18n/**`, `scripts/english-only.test.ts`, `packages/db/src/english-only.ts` | the words `catalogue`, `catalogues`, `Catalogue`, `Catalogues` (a string catalogue: for example `export const catalogues` at `apps/dashboard/src/i18n/strings.ts:7712` and `apps/setup/src/i18n/strings.ts:35`) |
| K3 | `packages/fiscal-verifactu/src/inmutabilidad.test.ts` | the words, which mean a database's system catalogue (`:21`, `:25`) |
| K5 | `packages/store/src/append-only.ts` (`CatalogueTarget`, `:11`), `packages/db/src/schema/menu/migrations.test.ts` ("the engine's own catalogue", `:66`) | a database's system catalogue |
| K6 | `packages/staffing/src/dashboard/painter-parts.ts` (`catalogueText`, `:2`), `apps/dashboard/src/screens/card-provider-panel.ts` (comment, `:19`), `packages/payments-stripe/src/dashboard/index.ts` (comment, `:1`) | a string catalogue |
| K7 | `docs/developers/testing-guide.md` ("AEAT error catalogue", `:131`) | AEAT's list of error codes |
| K4 | whole files, never read | the `NEVER` list of mn1's script, plus `apps/server/src/guide-catalogue.ts` and its test |

**Catch-all**, applied last, keeping case, plural before singular, anywhere in a word:
`CATALOGUES`→`MENUS`, `CATALOGUE`→`MENU`, `Catalogues`→`Menus`, `Catalogue`→`Menu`,
`catalogues`→`menus`, `catalogue`→`menu`. Examples it produces: `useCatalogueDb`→`useMenuDb`,
`catalogue_id`→`menu_id`, `ZoneOfferCatalogue`→`ZoneOfferMenu`, `CATALOGUE_TABLES`→`MENU_TABLES`,
the module name `"catalogue"` (`packages/composition/src/modules.ts:186`) → `"menu"`, the routes
`/management-api/catalogues/…` → `/management-api/menus/…`, `/management-api/catalogue-settings` →
`/management-api/menu-settings`, `/management-api/venue/default-catalogue` → `/management-api/venue/default-menu`,
the live-update name `"catalogues"` → `"menus"`, and the till's `catalogueId`
(`apps/till/src/api/client.ts:352`, `:484`, the offer's menu) → `menuId`, keeping its meaning
(tables-menu.md §1.3).

**Scope** is mn1's `SCOPE` (code, scripts, CI, root config, `CLAUDE.md`, `README.md`,
`docs/developers/**`, `docs/backlog/**`, `docs/backlog.md`) and the guides
`apps/server/src/guide/**`. Historical documents stay (CLAUDE.md §6).

**Local renames before the catch-all.** Some files already hold a local binding with the name the
catch-all would produce, most often `const menus = await tx.select({ id: catalogues.id … }).from(catalogues)`
(`packages/menu/src/section-graph.ts:122-124`, `packages/venue-service/src/menu-timetable.ts:699-701`,
about ten more): after the catch-all it reads `.from(menus)` inside its own declaration. The script
holds a committed table `LOCAL_RENAMES: { file, name, to }[]` and applies it first, renaming in that
file every whole-word `name` that is not preceded by `.` or `?.` and not an object key (`name:`); the
usual entry is `{ name: "menus", to: "menuRows" }` (or `menu` → `menuRow`). The table is filled from
the script's `--clashes` mode, which lists each file where the catch-all would produce an identifier
that the file already declares (`const`/`let`/`var`/`function`/`class X`, a parameter `X`, or `X` in a
destructuring). A shorthand `{ menus }` in a listed file is shown by the dry run; where it builds a
wire object whose key must stay, the builder writes `{ menus: menuRows }` by hand (listed). The
reviewer reads the table and the clash report.

**Moved by this PR:** `docs/backlog/catalogue.md` → `docs/backlog/menu.md` (`git mv`, a step of the
script). Its links are relative (`catalogue.md#…`, about 85 lines in `docs/backlog.md` and
`docs/backlog/*.md`), and the catch-all rewrites them to `menu.md#…` in the same run, so they point
at the moved file. Links into it from historical documents, which the script does not read, point at
the old name.

**Not by script, by hand** (counted, listed in the description):
- Spanish: "catálogo" → "carta", the dashboard's word (`strings.ts:5192`), with the grammar it
  needs: `apps/server/src/guide/es/kitchen-service.md:32`, `apps/server/src/guide/es/products.md:360`
  (and `strings.ts:6289` only if 4a left it). `packages/country-es/src/data/sources/BOE-A-2015-2294.xml`
  is the law's text and stays.
- Name clashes the type check or lint still finds after the local renames (a `catalogue` variable next
  to a `menu` one in the same scope that `--clashes` cannot see, for example a parameter in an inner
  function; `{ menuId: menuId }` that lint wants as shorthand). The review's approximate run on
  2026-11-08 saw about 40 distinct type errors across the packages before any local rename; the
  local-rename table is expected to clear most.
- Doubled words the catch-all makes in prose ("menu menu", "menus' menu"): found by Task 2 step 4.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Dropping `products.menu_id` (any menu offers any product) | mn5 |
| Reshaping `listAvailableProducts` once products have no menu (4a-ii already deleted `listAccessibleCatalogues`) | mn5 |
| `diet.invalid_origin`'s name (4a left it to this area) | mn6, with the diet change |
| Comments in i18n files that use "catalogue" in the menu sense (for example `apps/dashboard/src/i18n/codes.ts:1047`); K2 keeps them | hand-edited here when the report shows them, otherwise left: they are comments, and K2 cannot tell the senses apart |

## Files

- Create: `scripts/a1308/rename-catalogue-words.mjs`, `scripts/a1308/rename-catalogue-words.test.mjs`
- Moved by the script: `docs/backlog/catalogue.md` → `docs/backlog/menu.md`.
- Rewritten by the script (not counted): measured on 2026-11-08 before batch 1, "catalogue" appears
  on 9,698 lines in 858 files under `apps`, `packages` and `scripts` (excluding drizzle), plus 451
  lines in the living docs (`docs/developers` 226, `docs/backlog` 181, `docs/backlog.md` 44)
- Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`
- Hand (counted): Spanish guide lines; clash fixes; `packages/provisioning/src/configuration-transfer.ts:123`,
  `:160`, `:476` and `apps/server/src/configuration-import.test.ts:204` (format);
  `apps/server/scripts/demo-seed/testing/madrid-renamed-tables.ts` and its test, and
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (call it)
- Guards updated by the script's output, then run: `scripts/schema-constraints.test.ts`,
  `scripts/live-subscriptions.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/errors-reachable.test.ts`, `scripts/write-path-tables.test.ts`,
  `apps/server/src/menu-manage-permission.test.ts`

## Size

| | Lines |
| --- | --- |
| Script | about 220 |
| Script tests | about 220 |
| Madrid table-rename transform and its test | about 90 |
| Hand edits: Spanish, format, clashes left after the local renames, shorthand keys (estimate; the description lists the real ones) | about 150 |
| Local-rename table and `--clashes` mode (in the script and its tests) | about 80 |
| **Counted** | **about 760** |

Not counted: the script's output, generated migration files. About 3 hours.

## Finish line

1. `node scripts/a1308/rename-catalogue-words.mjs` prints `rewrote 0`; `git status --porcelain` is empty.
2. `node scripts/a1308/rename-catalogue-words.mjs --report` prints only kept occurrences, each with
   its K-rule (K1–K3, K5–K7); the pull request pastes this report.
3. `git grep -n -I -i catalogue -- apps packages scripts .github CLAUDE.md README.md docs/developers docs/backlog docs/backlog.md`
   prints only lines the report lists, plus the K4 files.
4. `pnpm --filter @waitron/menu typecheck`, `pnpm --filter @waitron/server typecheck`,
   `pnpm --filter @waitron/dashboard typecheck`, `pnpm --filter @waitron/till typecheck` pass.
5. `pnpm exec vitest run scripts/a1308/rename-catalogue-words.test.mjs scripts/schema-constraints.test.ts scripts/live-subscriptions.test.ts scripts/classification-complete.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/claude-md-pointers.test.ts scripts/starting-migrations.test.ts`
   passes with a `Tests` count.
6. `pnpm --filter @waitron/server exec vitest run src/menu-manage-permission.test.ts src/configuration-import.test.ts`
   passes; the second refuses the previous bundle format.
7. `pnpm protection-list compare` prints exactly the next section.
8. The reviewer, on a clean checkout of the base: `node scripts/a1308/rename-catalogue-words.mjs`,
   then `pnpm --filter @waitron/server migration-baseline rebuild --set core`; `git diff <pr-head> --stat`
   shows only the hand edits the description lists.

## Expected protection-list difference

Predicted by reading the schema and `compare.ts:66-246`; not run. `node.db` prints nothing.
`venue.db`: six `DIFF` headers (both compositions × three phases).

In all six:

```text
missing table catalogues
extra table menus
missing index products_catalogue_id_idx
extra index products_menu_id_idx
missing index products_id_catalogue_key
extra index products_id_menu_key
missing table products.columns[catalogue_id]
extra table products.columns[menu_id]
changed table products.columnOrder
old: [<base order>]
new: [<the same, "catalogue_id" now "menu_id">]
missing table products.foreignKeys[catalogue_id->catalogues(id)]
extra table products.foreignKeys[menu_id->menus(id)]
missing table products.foreignKeys[parent_id,catalogue_id->products(id,catalogue_id)]
extra table products.foreignKeys[parent_id,menu_id->products(id,menu_id)]
```

and, for each table whose key points at the menu, one pair (the column keeps its name; only the
target table's name changes):

```text
missing table <t>.foreignKeys[<col>->catalogues(id)]
extra table <t>.foreignKeys[<col>->menus(id)]
```

for `menu_details` (`menu_id`), `menu_items` (`menu_id`), `sections` (`owner_menu_id`),
`menu_publications` (`menu_id`), `menu_scheduled_publications` (`menu_id`), `menu_versions`
(`menu_id`), `menu_periods` (`menu_id`), `menu_period_staff_menus` (`menu_id`) — read from
`packages/db/drizzle/0000_baseline.sql` (`REFERENCES \`catalogues\``) at `a086eedfb7`, less
`locations` and `location_catalogues`, which batch 1 removed.

Slice 5e adds `catalogues.is_default` and `catalogues_one_default_uq`
(`2026-11-08-a1308-5e-floor-and-device-location-columns.md`, What it builds item 10); the column moves with its table, and
the index prints:

```text
missing index catalogues_one_default_uq
extra index menus_one_default_uq
```

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_catalogues_delete
missing trigger waitron_change_catalogues_insert
missing trigger waitron_change_catalogues_update
extra trigger waitron_change_menus_delete
extra trigger waitron_change_menus_insert
extra trigger waitron_change_menus_update
changed trigger waitron_change_products_update.when
old: <comparison naming catalogue_id>
new: <the same, naming menu_id>
```

Why: README §5 U9 renames the table and its id column; every protection keeps its home under the new
names (tables-menu.md §5 first rows; `products_id_catalogue_key` and the composite key are dropped
only by mn5, which drops the column). No hand-written trigger in `packages/db/triggers/core.sql`
names `catalogues` or `catalogue_id` (`grep -c -i catalogue` over core's baseline trigger tail,
lines 3008–3856 at `a086eedfb7`, prints 0), so no trigger body changes.

## Stop points (beyond rules §5)

1. The dry run (Task 2 step 1) shows the catch-all changing an occurrence that means a string
   catalogue, a guide page list or a database catalogue in a file no K-rule covers: add a K-rule
   (a script change) and re-run from the base. Do not hand-edit the output.
2. A type check fails because two different things now share a name AND the two meant different
   things (not merely two spellings of one menu id). Ask.
3. Any `menu.not_found` refusal now collides with an existing code of that name in the error
   registry (`scripts/errors-reachable.test.ts` or a duplicate-key type error in
   `apps/dashboard/src/i18n/codes.ts`). The till's string key `menu.not_found`
   (`apps/till/src/i18n/strings.ts:1838`) is a UI string, not an error code, and is not a clash.
4. A protection-list line outside the prediction.

## Needs

- **Outside this area:** batch 1, in particular slice 5 (the default menu as a flag on the table this
  PR renames) and 1a's rebuild command.
- **In this area:** mn1 (paths), mn2 (the two settings tables are gone, so this PR need not name them).

## Work beside A1308 that this affects

As mn1: A353 pull requests 2–5, A799's rig and A1457 rebase across this and run
`node scripts/a1308/rename-catalogue-words.mjs` after rebasing (rules §8). The script must give the
same answer on their trees: that is why it is idempotent and works file by file.

## Global Constraints

- Rules §1–§9 apply. The script's output is committed in the same pull request; every hand edit is
  listed.
- The catch-all never runs inside a protected span or a `NEVER` file.
- `git commit -s`; plain English in commit messages and the pull request (CLAUDE.md, the repository's
  English-only rule is unaffected: "menu" is English).

## Review Focus

1. **The report (Finish line 2) holds only the other meanings.** Read every line.
2. **The exact table is complete for the Products screen.** Anything the screen calls itself
   should say "products"; a leftover `menu` that means the Products screen is a missed row.
3. **Every place the catch-all would join two different meanings has an exact row or a local
   rename.** The known cases are the product-meaning rows above (`cataloguePrice`, `CombineInput`'s
   `catalogue`, the till's zone-offer cache). Read the clash report and the type errors for others;
   a renamed `catalogueId` beside a pre-existing `menuId` is only safe where both name a row of
   `catalogues`, which the reviewer checks site by site (stop point 2).
4. **The re-run on the base reproduces the pull request** (Finish line 8).

---

### Task 1: The words script, tested on strings

**Files:** create `scripts/a1308/rename-catalogue-words.mjs` and its test.

**Interfaces:**

```js
export const EXACT;      // [{ from, to, files? }] in table order; `files` limits a row to globs
export const PROTECTED;  // [{ id: "K1" … "K7" (no K4: K4 is NEVER), files, pattern }]
export const LOCAL_RENAMES; // [{ file, name, to }], applied before EXACT
/** Each file where the catch-all would produce a name the file already declares. */
export function clashes(root: string): { file: string; name: string; produced: string }[];
export const CATCH_ALL;  // [[from, to]] in table order
export const SCOPE, NEVER; // as mn1's, plus apps/server/src/guide/** in SCOPE, guide-catalogue* in NEVER
/** The rewritten text and the kept spans for one file. */
export function rewriteWords(text: string, file: string): { text: string; kept: { rule: string; line: number; snippet: string }[] };
export function run(options: { root: string; dryRun?: boolean; report?: boolean }): { rewrote: number; kept: number; changes: { file: string; lines: number }[] };
```

- [ ] **Step 1: Write the failing tests** (pure strings for `rewriteWords`; a throwaway repository
  for `run`, `GIT_DIR` cleared):
  - `"applies exact rows before the catch-all"`: `"nav.catalogue"` → `"nav.products"`;
    `"catalogue.title"` → `"products.title"`; `"catalogue.not_found"` → `"menu.not_found"`;
    `CatalogueScreen` → `ProductsScreen`.
  - `"limits the screen-id row to the dashboard"`: `screen: "catalogue"` in
    `apps/dashboard/src/x.ts` → `"products"`; the same text in `packages/composition/src/modules.ts`
    → `"menu"`.
  - `"keeps case in the catch-all"`: `CATALOGUE_TABLES`, `useCatalogueDb`, `catalogue_id`,
    `Catalogues` → `MENU_TABLES`, `useMenuDb`, `menu_id`, `Menus`.
  - `"keeps K1 tokens everywhere"`: `registerCatalogue(strings)` and `import "./guide-catalogue.js"`
    unchanged; the report lists both under K1.
  - `"keeps K2 words in string-catalogue files but still applies exact rows there"`: in
    `apps/dashboard/src/i18n/strings.ts`, `export const catalogues` unchanged and
    `"nav.catalogue": "Products"` → `"nav.products": "Products"`.
  - `"keeps K3 words"` in the fiscal immutability test file; `"keeps K5, K6 and K7 spans"` in their
    files (`CatalogueTarget`, `catalogueText`, "AEAT error catalogue").
  - `"limits the CombineInput row to files that name it"`: `catalogue: { price }` in a file naming
    `CombineInput` → `product: { price }`; the same text elsewhere → `menu: { price }`.
  - `"renames a listed local before the catch-all"`: with `LOCAL_RENAMES` `{ file, name: "menus",
    to: "menuRows" }`, `const menus = tx.select({ id: catalogues.id }).from(catalogues)` becomes
    `const menuRows = tx.select({ id: menus.id }).from(menus)`, and `row.menus` and `{ menus: 1 }`
    in the same file are unchanged.
  - `"reports a clash"`: `clashes` on a file declaring `const menus` and using `catalogues` lists it.
  - `"moves the backlog file"`: `run` on a tree with `docs/backlog/catalogue.md` leaves
    `docs/backlog/menu.md`, and a link `[x](catalogue.md#a-catalogue-price)` in `docs/backlog.md`
    reads `[x](menu.md#a-menu-price)`.
  - `"never reads K4 files"`: a `drizzle/0000_baseline.sql` naming `catalogues` is byte-identical.
  - `"does not touch Spanish"`: `"Elige un catálogo"` unchanged.
  - `"is idempotent"`: `rewriteWords(rewriteWords(t).text)` equals `rewriteWords(t).text` for a
    sample holding every row; `run` twice → second `rewrote: 0`.
  - `"report lists only kept spans"`: `run({ report: true })` writes nothing and lists K1/K2/K3 hits.
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/a1308/rename-catalogue-words.test.mjs` — FAIL.
- [ ] **Step 3: Implement.** It is in the root coverage `include` (`vitest.config.ts:119`); cover
  every branch.
- [ ] **Step 4: Run — PASS**; read the coverage table for the file. **Commit.**

### Task 2: Run it, rebuild, fix what the type check finds

- [ ] **Step 1: Take the base protection list** (rules §3).
- [ ] **Step 2: Dry run.** `node scripts/a1308/rename-catalogue-words.mjs --dry-run > <scratch>/words.txt`.
  Read the catch-all hits in prose (comments, Markdown) for a meaning other than a menu (stop point
  1). Read the report: every kept line is K1–K3.
- [ ] **Step 2b: Clashes.** `node scripts/a1308/rename-catalogue-words.mjs --clashes > <scratch>/clashes.txt`;
  fill `LOCAL_RENAMES` from it (a script change: commit it with the script), and re-run the dry run.
- [ ] **Step 3: Run it**, then `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 4: Doubled words.** `git diff -U0 | grep -n -i -E "\\bmenus?'?s? menus?\\b"` and fix each
  sentence by hand (listed).
- [ ] **Step 5: Type check and lint**, package by package, reading each exit status: `@waitron/menu`,
  `@waitron/db`, `@waitron/server`, `@waitron/dashboard`, `@waitron/till`, `@waitron/media`,
  `@waitron/venue-service`, `@waitron/composition`, `@waitron/provisioning`, `@waitron/reporting`,
  `@waitron/fiscal-verifactu`. Fix each clash by hand (stop point 2 if the meanings differ); run
  `pnpm exec eslint --fix` on the changed files for `{ menuId: menuId }`.
- [ ] **Step 6: Spanish by hand** (the lines under "Not by script").
- [ ] **Step 7: Run the script again** — `rewrote 0`. **Commit** the output, then the hand edits in
  a separate commit, so the reviewer can diff the script's commit alone.

### Task 3: The bundle format and the Madrid baseline

**Files:** `packages/provisioning/src/configuration-transfer.ts`; `apps/server/src/configuration-import.test.ts`;
create `apps/server/scripts/demo-seed/testing/madrid-renamed-tables.ts` and its test; modify
`seed.madrid-baseline.test.ts`.

- [ ] **Step 1: Format.** The bundle names tables (`catalogues` is now `menus`), so its `version`
  moves on by one (`:123`, `:160`, `:476`); add the previous version to the refusal table at
  `configuration-import.test.ts:204`.
- [ ] **Step 2: Madrid table renames.** The capture is hashed and never edited (4a's D3). Write
  `madridWithRenamedTables(capture, { catalogues: "menus" })`: moves the table entry to its new
  name, rewrites `foreignKeys[].table` in every table that points at it, and refuses (throws) an
  entry whose old name is absent or whose new name exists. Extend the column renames
  (`madrid-renamed-columns.ts:31`) to also rename a foreign key's `to` column when it targets the
  renamed column's table, and add `products: { catalogue_id: "menu_id" }` to `RENAMED_COLUMNS`
  (`seed.madrid-baseline.test.ts:22`). Rename the `manifest.phases` keys the same way. Test:
  `"renames a table and every key that targets it"` and `"refuses an unused rename"`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/` — PASS.
  **Commit.**

### Task 4: Guards, protection list, finish

- [ ] **Step 1:** Run Finish line 4–6; fix only what the script's own output broke, by improving
  the script (re-run from the base) or by a listed hand edit.
- [ ] **Step 2:** Protection list (rules §3); paste the report, marking each line.
- [ ] **Step 3:** Pull request description: first line; the script commands; the report (Finish line
  2); every hand edit by file and line; the dry-run counts.
- [ ] **Step 4:** `/finish-branch`. Push once.

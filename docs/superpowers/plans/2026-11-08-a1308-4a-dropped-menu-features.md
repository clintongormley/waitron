# A1308 slice 4a-i — delete recipes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** Remove recipes, which the owner dropped ("remove it, and remove recipes. we don't use
them", 2026-11-04), with everything only recipes used, in one pull request.

**Architecture:** Almost all deletion. These go:
- two tables, `ingredients` and `recipe_lines`;
- two columns on `products`, `recipe_derivation` and `diet_derivation`;
- one column on `working_line_contexts`, `diet_derivation`;
- `packages/recipes`, the unmounted recipe routes, the unreachable dashboard screen and the
  `recipe.manage` permission.

What stays — publishing a product's allergens and diet — keeps its stored values: only its
always-empty recipe inputs go. Core's starting migration is rebuilt with slice 1a's command.

**Tech Stack:** TypeScript, drizzle over SQLite (`node:sqlite`), Hono, Lit, Vitest 4, pnpm workspace.

**Spec:** [the approved design](../specs/2026-11-02-rationalisation/README.md) §5 U6, R5, §10
("Recipes: removed"); [`tables-menu.md`](../specs/2026-11-02-rationalisation/tables-menu.md) §1.3
and §4 "What removing recipes takes with it".
**Rules:** [the slice rules](2026-11-08-a1308-slice-rules.md) ("rules §n").
**Order:** [build order](2026-11-08-a1308-build-order.md), batch 1, lane 2, after slice 1a. The
other half of the old slice 4a is
[4a-ii](2026-11-08-a1308-4a-ii-menu-list-and-venue-receipt.md). The two are independent: either may
land first.

**Owner lands:** no (rules §6). Checked by reading, not run: `dietDerivation`, which this slice
removes from a line's frozen copy, never reaches a sale record or a fiscal hash.
- A line's frozen copy is the `working_line_contexts` row that keeps a bill line's menu facts as
  they were when the line was added (`packages/db/src/schema/venue-service/service.ts:249-271`).
- The sale path reads only `menuId` and `menuVersionId` from it (`apps/server/src/issuance-pass.ts:30-62`).
- Its other readers (`apps/server/src/working-order.ts:1128`, `:4459`, `:5463`, `:5895`) build the
  till's view of an open bill, or read `menuItemId`.
- `git grep -n -i diet -- packages/db/src/schema/sales.ts packages/fiscal packages/fiscal-verifactu packages/fiscal-none apps/server/src/issuance-pass.ts`
  printed nothing (exit 1). As a control, `git grep -n menu_version_id -- packages/db/src/schema/sales.ts`
  prints a line, so the search does find a column there when one exists.

## What it builds

1. **The recipe feature leaves.**
   - Deleted: `ingredients`, `recipe_lines`, `packages/recipes`, and `apps/server/src/recipe-api.ts`,
     which nothing mounts (`apps/server/src/boot.test.ts:671-674` asserts its route answers 404).
   - Deleted: the dashboard recipe screen and its four widgets, which nothing imports, and their
     client methods, types, live-query names, strings and error texts.
   - Deleted: the `recipe.manage` permission.
2. **The recipe-derived product values leave.**
   - `products.recipe_derivation`, `products.diet_derivation` and `working_line_contexts.diet_derivation`
     are dropped. A "derivation" was the allergens or diet worked out from a recipe's ingredients.
   - The `dietDerivation` field goes from every type that copies it: product and menu types, the
     menu document's change lists, the module seam, the line's frozen copy, and the till.
   - The published `allergens` becomes the declaration, sorted and de-duplicated
     (`publishedAllergens`). The stored `diet` becomes the override laid over a fixed "claims
     nothing" profile (`UNDECLARED_DIET`). For every real product these equal what is stored today
     (D1).
3. **The configuration export format moves up by one** (rules §9): from `main`'s value when the
   slice is built (10 at this plan's base, so 11). The configuration export is the encrypted file one
   box writes and a new box imports at setup. Its `ingredients` and `recipe_lines` entries go, and
   `products` rows lose two columns. A file in the previous format is refused as
   `setup.configuration_outdated`.
4. **Housekeeping (rules §9):** classification, live-query names, guards, CI package lists, the
   mutation cost table, test durations, the Madrid seed comparison, developer docs, and the backlog
   entries this finishes.

## What it leaves out (and who takes it)

| Left out | Why | Taken by |
| --- | --- | --- |
| `location_catalogues`, the venue's extra-menu list, `tenant_receipts` | Split out by the coordinator, 2026-11-08 | [4a-ii](2026-11-08-a1308-4a-ii-menu-list-and-venue-receipt.md) |
| Folding `products.manual_allergens` into `allergens`; working `diet` out on read instead of storing it | `tables-menu.md` §1.3 gives both to the menu area. They change what is stored and read; this slice's product changes keep stored values (D1). | Menu and photos (batch 2) |
| Renaming the error code `diet.invalid_origin` (still thrown for a bad contains-tag or a non-list, `packages/shared/src/menu-document/dietary.ts:59`, `:84-85`) | A rename is not a deletion | Menu and photos, if wanted |
| The bench (slice 0's timings) | No read on a measured path gains work; the sale path writes one column fewer | — (stated so the reviewer can disagree) |
| Editing the A1002 plan and design that name `recipe.manage` | Lane K's living documents; see "Other plans that name these" | Their owner |

## Decisions

- **D1. Where the line with the menu slice falls.** This slice drops only recipe inputs. It keeps
  `manual_allergens`, `allergens` and `diet` as columns.
  - **Allergens.** Today the published `allergens` is `republish(manual, derivation)`
    (`packages/catalogue/src/derivation.ts:23-31`). Every real derivation is `null` (only
    `packages/recipes` writes one, and nothing mounts it). So today it is always
    `mergeAllergenMaps({}, manual)`, or `null` for `null` — which is `publishedAllergens`.
  - **Diet.** The stored `diet` today is `overlayDietProfile(deriveDietProfile({ origins: [], pending: true }), override)`.
    That fixed starting profile is `UNDECLARED_DIET`.
  - **Variants.** A variant's own value already stands alone and is not merged with its parent's
    (`packages/catalogue/src/variant-fallback.ts:108-114`; `tables-menu.md` §1.3 "Variants inherit").
    So once recipes go, nothing a parent changes alters a variant's stored values.
    `republishOverlays`' loop over variants (`packages/catalogue/src/operations.ts:917-958`) only
    carried the parent's recipe values, so it goes, and the function republishes the one row it
    is given.
  - Folding the columns here would change two readers (the product editor reads `manualAllergens`,
    `packages/catalogue/src/product-editor.ts:37`) and is the menu slice's job.
- **D2. Captured fixtures stay byte-for-byte.**
  - `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json` is a real
    version-1 export. Its only use is to be refused as outdated (`apps/server/src/configuration-import.test.ts:118-125`).
  - The Madrid fixtures in `packages/country-es/test-fixtures/demo/` are hashed by their manifest
    (`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:91`).
  - Neither file is edited. The Madrid test takes the removals in code, as it already does for
    `pass_item_marks` (`:39`).
- **D3. A test whose subject is a recipe or a derivation is deleted. A test that only used one to
  reach a state is re-pointed.**
  - Re-pointing means reaching the same state through a surviving input: `updateProduct(..., { allergens })`,
    `dietOverride` or `dietaryDeclarations`. The asserted values must stay the same.
  - Removing a deleted field from an expected object or a column list is not a changed assertion.
    The deleted fields are `dietDerivation`, `recipeDerivation`, `diet_derivation` and
    `recipe_derivation`.
  - Any other change to an expected value is a stop (rules §5.3), unless it is listed under
    "Assertions that change, by design".
  - An assertion that still passes and names a removed thing stays: `apps/server/src/boot.test.ts:671-674`
    and `apps/dashboard/src/dashboard-app.test.ts:2600`.
  - The pull request lists every deleted case by file and title.

## Cases deleted (D3), by title

- `packages/catalogue/src/operations.test.ts`:
  - every case calling `applyRecipeDerivation` or `applyDietDerivation` in `:982-1370`;
  - in `describe("a variant's published allergens and diet")` (`:1987`), these cases. Their results
    change because a variant's own value stands alone (`variant-fallback.ts:108-114`), and they are
    about the parent's recipe values:
    - "unions a variant's own manual allergens with its PARENT's recipe floor" (`:2069`);
    - "combines a variant's own diet override with its PARENT's derivation" (`:2077`; it would read
      "unknown");
    - "republishes each variant with an override of its own when its parent's recipe changes" (`:2089`);
    - "republishes a variant with only its own allergens, or only its own diet override, on the
      column it overrides" (`:2115`);
    - "refuses a recipe or diet derivation written to a variant" (`:2141`).
- `packages/catalogue/src/menu-allergen-warnings.test.ts`, in "warns once for offered unreviewed
  products and their effective active variants" (`:28`): the recipe tail `:75-95` is deleted, from
  the `updateProduct(... { milk: {} })` before the first `applyRecipeDerivation` through the
  `toEqual([])` after the second. With no derivation the "Reviewed" variant drops out of the warnings.
  The case's earlier assertions and `:96` stay.
- `packages/catalogue/src/product-editor.test.ts`:
  - "writes direct declarations without reviving or rewriting stale recipe derivation" (`:428`);
  - "offers the parent's PUBLISHED allergens as inherited, never only its manual overlay" (`:775`).
    Its `:782` and `:787` assertions need the recipe floor.
- `packages/catalogue/src/derivation.test.ts`: the `republish` cases whose input has a derivation (`:43-78`).
- `packages/shared/src/menu-document/dietary.test.ts`: `describe("deriveDietProfile")` (`:14-62`);
  the `validateOrigin` half of `:99-102`; the two `validateOrigin` expectations in "refuses an unknown
  origin and a tag outside meat and fish, echoing the value" (`:167-175`; its `validateContainsTag`
  expectation stays); "counts dairy, egg and honey as vegetarian" (`:199-203`).
- `packages/identity/src/permissions.test.ts`: "grants recipe.manage to manager and admin only
  (recipe authoring)" (`:138-143`).
- `apps/server/src/catalogue-allergen-workflow.test.ts`: "publishes recipe inheritance and manual
  additions, then withdraws and restores review" (`:74`).
- `apps/till/src/state/as-served-diet.test.ts`: "a pending derivation reads unknown (never a positive
  claim), extra or no extra" (`:127`) and "a null derivation reads unknown (an unreviewed dish)"
  (`:134`). Both are replaced by the new "a dish with no declaration and no override reads unknown".
- `apps/dashboard/src/widgets/product-list.test.ts`: the case at `:5855-5870`, whose subject is the
  recipe origins shown as dietary info.
- `apps/dashboard/src/i18n/codes.test.ts`: "says an ingredient that no longer exists needs a refresh,
  in English and Spanish" (`:610`).
- Every case in the deleted files (Files, Delete).

## Assertions that change, by design

- `packages/catalogue/src/operations.test.ts:2063-2066`, in "stores both blank when all four overlays
  are blank, so the parent's are read". `expect(parent.allergens)` changes from
  `{ eggs: {}, nuts: { kinds: ["almonds"] } }` to `{ nuts: { kinds: ["almonds"] } }`. The `eggs`
  came from the parent's recipe floor, `PARENT_RECIPE`, whose set-up (`:2022`) is deleted along with
  `:2023`'s diet derivation. The case's other assertions are unchanged.
- No other expected value may change. Any other change is a stop.

## Files

Line numbers are at this plan's base (`main` d908a5b8d4 plus docs commits). Slice 1a may move some
of them; re-find each by its identifier.

**Delete:**
- `packages/recipes/` (all)
- `apps/server/src/recipe-api.ts`, `recipe-api.test.ts`, `recipe-api.gate-sweep.test.ts`
- `apps/dashboard/src/screens/recipe-screen.ts` (+ `.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`)
- `apps/dashboard/src/widgets/recipe-editor.ts` (+ `.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`)
- `apps/dashboard/src/widgets/ingredient-form.ts` (+ `.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`, `.unsaved.test.ts`)
- `apps/dashboard/src/widgets/ingredient-list.ts` (+ `.test.ts`, `.a11y.test.ts`)
- `apps/dashboard/src/widgets/dietary-origin-picker.ts` (+ `.test.ts`, `.a11y.test.ts`)
- `packages/db/src/schema/recipes.ts`, `recipes.test.ts`

**Modify — schema, lists, guards, CI:**
- `packages/db/src/schema/catalogue.ts:84-109`: drop `recipeDerivation` and `dietDerivation`; reword
  the `manualAllergens` and `diet` comments, which name recipes.
- `packages/db/src/schema/venue-service/service.ts:271`
- `packages/db/src/schema/index.ts:38`; `packages/db/src/index.ts:177`
- `packages/db/src/classification.ts:118-119`; `packages/db/src/configuration-transfer.ts:74-75`
- `packages/db/src/english-only.ts:33`; `scripts/english-only.test.ts:110`
- `packages/db/mutation-costs.json:111`; `apps/server/test-durations.json:877-878`
- `scripts/schema-constraints.test.ts:271-272`, `:486`
- `scripts/changed-scope.mjs:318`; `.github/workflows/ci.yml:3476`
- `apps/server/package.json:64`; `pnpm-lock.yaml` (by `pnpm install`)
- Generated by `pnpm --filter @waitron/server migration-baseline rebuild --set core`:
  `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*`, and
  `scripts/migration-baseline-epoch.json`.
- `packages/db/triggers/core.sql` is **not** changed. None of core's hand-written triggers names a
  removed table or column: in `packages/db/drizzle/0000_baseline.sql` they appear only in the table
  definitions (`:973-974`, `:1007-1030`, `:2393`).

**Modify — production code:**
- `packages/catalogue/src/operations.ts`:
  - imports `:15`, `:18`, `:45`; the comment at `:172`;
  - `dietDerivation` and `recipeDerivation` entries `:209-211`, `:267`, `:307`, `:458`, `:482`,
    `:506`, `:1464`, `:1518`;
  - `republishOverlays` `:899-959`;
  - delete `applyDerivation`, `applyRecipeDerivation` and `applyDietDerivation` (`:961-1027`);
  - `insertProduct` `:1068-1089`.
- `packages/catalogue/src/`: `derivation.ts`, `index.ts:22-23`, `:80-95`, `variant-fallback.ts:110-112`,
  `product-editor.ts:46`, `menu-document.ts:800`, `menu-navigation.ts:175`
- `packages/shared/src/menu-document/`: `dietary.ts`, `menu-types.ts:4`, `:49`, `:82`, `:142-144`,
  `product-types.ts:4`, `:129-140`, `:215`, `dietary-declarations.ts:37-38`
- `packages/shared/src/index.ts:300-313`; `packages/shared/src/errors.ts:72`
- `packages/venue-service/src/operations.ts:1201`, `:1220`, `:1353`
- `packages/module/src/module.ts:237`, `:437`, `:1191`
- `apps/server/src/working-order.ts:5322`, `:5533`
- `packages/identity/src/permissions.ts:20`, `:53`
- `apps/till/src/api/client.ts:272-280`, `:289`, `:366-368`, `:384`, `:400`, `:505`;
  `apps/till/src/state/as-served.ts`
- `apps/dashboard/src/api/client.ts:485-493`, `:575-599`, `:3430-3452`
- `apps/dashboard/src/api/live-queries.ts:347-348`, `:521-522`
- `apps/dashboard/src/i18n/strings.ts`:
  - English: `:1068`, `:2314-2323`, `:2392`, `:2397`, `:2411-2420`;
  - Spanish: `:4909`, `:6183-6192`, `:6262`, `:6267`, `:6281-6290`.
- `apps/dashboard/src/i18n/codes.ts:957-964`; `apps/dashboard/src/widgets/product-list.ts:62-65`, `:104-125`
- `packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:473-476`

**Modify — tests:** the cases above, plus:
- `packages/catalogue/src/`: `operations.test.ts` (the variant set-up at `:1991-2023`, plus one new
  case), `derivation.test.ts`, `variant-fallback.test.ts:53-62`, `:136-178`, `:377-394`, `:764`,
  `allergen-kinds.test.ts:75-87`, `variants.db.test.ts:113`, `:131`
- `packages/db/src/schema/catalogue.test.ts:106-110`; `packages/shared/src/menu-document/dietary.test.ts`
- `apps/till/src/`: `state/as-served-diet.test.ts`, `widgets/basket.test.ts:735-775`,
  `widgets/basket.a11y.test.ts:245-265`, `widgets/modifier-picker.test.ts:750-850`,
  `api/client.test.ts:5230-5260`, `screens/till-table-order-screen.test.ts:3261`, `till-app.test.ts:355`, `:389`
- `apps/dashboard/src/api/client.test.ts` (recipe client cases)
- `apps/server/src/till-api.test.ts:2214`, `:2237`; `till-api.fiscal-sale-paths.test.ts:1987` (comments only)
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:38`, `:139-176`
- Format files:
  - `apps/server/src/configuration-import.test.ts:48`, `:200-204`;
  - `apps/server/src/configuration-transfer.test.ts:389`, `:5481`;
  - `packages/provisioning/test/configuration-bundle.ts:5`;
  - `packages/provisioning/src/configuration-transfer.privacy-contact.test.ts:79`;
  - `packages/provisioning/src/configuration-transfer.boundaries.test.ts:104`.
- About 47 test files lose only a line that reads `dietDerivation: null,` (Task 3 step 6 command).

**Modify — docs:**
- `docs/developers/products.md:564`, `:785-786`, `:894`
- `docs/developers/design-system.md:667`, `:2918-2919`, `:2936-2938`, `:3036`, `:5840`
- `docs/developers/ci-and-gates.md:490`; `docs/developers/conventions-data.md:1821-1824`
- `docs/backlog/kitchen.md:414`; `docs/backlog/back-office.md:6-21`;
  `docs/backlog/dashboard.md:173-174`, `:1372-1381`; `docs/backlog/catalogue.md:1468-1469`;
  `docs/backlog/architecture.md:397`, `:781`; `docs/backlog.md:1434`, `:1697-1700`
- Historical records are not edited: `docs/operations/*`, `docs/developers/grants-retirement-audit.md`,
  `docs/developers/ci-and-gates.md:531`.

## Size

Estimated by reading, not by building.

| What | Lines |
| --- | --- |
| **Counted:** production code written or changed by hand | about 80 |
| **Counted:** tests written or changed by hand (new cases, re-pointed till and catalogue set-ups, Madrid, format rows) | about 220 |
| **Counted:** docs and backlog | about 25 |
| **Counted total** | **about 325** (cap about 1,000) |
| Not counted: pure deletions. `packages/recipes` 940; recipe API and tests 901; dashboard screen, widgets and tests 4,863; schema files about 200; catalogue, shared and till test cases about 700; client, strings and codes about 150; `dietDerivation: null,` lines 67. | about 7,800 |
| Not counted: generated files (core's starting migration, `drizzle/meta/*`, the epoch file, `pnpm-lock.yaml`) | — |

**Time:** about 3 hours. About 110 files are touched, and most of them are deletions or one-line
removals done by command.

## Finish line

1. The leftover search (Task 4, step 1) prints only the lines listed there.
2. `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts` passes. Its case
   "refuses A1308 4a-i pre-recipe-removal export" refuses the previous format as
   `setup.configuration_outdated`.
3. These pass:
   - `pnpm --filter @waitron/catalogue exec vitest run src/derivation.test.ts src/operations.test.ts`,
     including "publishedAllergens sorts and de-duplicates kinds" and "updateProduct publishes the
     declaration sorted and de-duplicated";
   - `pnpm --filter @waitron/shared exec vitest run src/menu-document/dietary.test.ts`, including
     "UNDECLARED_DIET claims nothing";
   - `pnpm --filter @waitron/till exec vitest run src/state/as-served-diet.test.ts`, including "a
     dish with no declaration and no override reads unknown".
4. From `apps/server`, `pnpm protection-list compare --old <base> --new <tip> --report <file>` prints
   exactly "Expected protection-list difference".
5. CI is green on the head commit. The pull request's first line reads: "Every venue is reset: core;
   backups and exports from before this cannot be restored or imported."

## Expected protection-list difference

The protection list is slice 0's tool. It builds the databases from the migrations and lists every
protection in them: CHECKs, triggers, foreign keys, indexes, and each table's columns. How it works:
`docs/developers/testing-guide.md#the-protection-list`.

The lines below are predicted by reading `apps/server/scripts/protection-list/compare.ts:66-246` and
`packages/db/drizzle/0000_baseline.sql:973-974`, `:1007-1030`, `:2393`. They were not run.
- `node.db` prints nothing.
- `venue.db` prints one `DIFF` header for each of six builds: compositions `fiscal-verifactu` and
  `fiscal-none`, each at phases `sql-only`, `migrated` and `change-feed`.
- Within a header the lines follow the tool's name sort. The set of lines is what must match.

**In each of the six builds:**

```text
missing index ingredients.primary key(id)
missing index recipe_lines.primary key(id)
missing index recipe_lines_ingredient_id_idx
missing index recipe_lines_product_id_idx
missing index recipe_lines_product_ingredient_key
missing table ingredients
changed table products.columnOrder
old: [<base order>]
new: [<base order without "recipe_derivation" and "diet_derivation">]
missing table products.columns[recipe_derivation]
missing table products.columns[diet_derivation]
missing table recipe_lines
changed table working_line_contexts.columnOrder
old: [<base order>]
new: [<base order without "diet_derivation">]
missing table working_line_contexts.columns[diet_derivation]
```

**In each of the two `change-feed` builds, also:**

```text
missing trigger waitron_change_ingredients_delete
missing trigger waitron_change_ingredients_insert
missing trigger waitron_change_ingredients_update
missing trigger waitron_change_recipe_lines_delete
missing trigger waitron_change_recipe_lines_insert
missing trigger waitron_change_recipe_lines_update
changed trigger waitron_change_products_update.when
old: <the column comparison, including recipe_derivation and diet_derivation>
new: <the same, without those two terms>
changed trigger waitron_change_working_line_contexts_update.when
old: <including diet_derivation>
new: <without it>
```

Why each line (design §5 "Protections"; `tables-menu.md` §5):
- The two tables are deleted (README U6). Their foreign keys and `ingredients_dietary_origin_ck`
  belong to the table object, so they print no line of their own.
- The change feed is the set of triggers that tell the dashboard a row changed. It follows the
  tables (`tables-menu.md` §5, last row).
- Each build has one update trigger on `products` and one on `working_line_contexts`. Each compares
  every column, so each loses the dropped columns' terms.
- No foreign key on a surviving table points into a deleted table.

Any other line is a stop (rules §5.2).

## Stop points (beyond rules §5)

1. `git grep -n 'recipe\.manage'` finds the permission anywhere other than `permissions.ts` and its
   test. One example is role presets or a roles table seed, if A1002 cut 2 has landed. Also stop if
   A1002 cut 1 has renamed the permission catalogue's file. Remove the permission there too only
   after checking what that code does with an unknown stored permission name; stop if it refuses one.
2. `seed.madrid-baseline.test.ts` fails for any table or column other than the two tables and three
   columns removed here.
3. A hand-written trigger in `packages/db/triggers/core.sql` names a removed table or column.
4. `scripts/changed-scope.test.mjs`, `scripts/ci-workflow.test.mjs` or `scripts/mutation-shard.test.mjs`
   fails for a reason other than a list entry this plan removes.

## Global Constraints

- Rules §1–§9 apply. Never edit `drizzle/*.sql`, `drizzle/meta/*` or the epoch file by hand. Run
  `pnpm --filter @waitron/server migration-baseline rebuild --set core` after every schema change,
  in the same task.
- No backwards-compatibility code: venues are reset (CLAUDE.md §3).
- `git commit -s` on every commit. Work in your own worktree
  (`python3 ~/workspace/tools/worktree.py new waitron a1308-4a-i-recipes --headless`).
- English only in code (CLAUDE.md §3). Spanish strings go with their English twins.
- Comments: delete a comment that names recipes, ingredients or derivations. Reword one only when it
  states an invariant that still holds, and never into a new claim (CLAUDE.md §1).
- Run focused tests locally; CI runs the package suites (CLAUDE.md §2).
- `apps/dashboard` and `apps/till` run real Chromium. Check free memory first
  (`memory_pressure | grep free`).

## Review Focus

1. **Allergens on a product edit.** `updateProduct` with repeated kinds must still store `allergens`
   sorted and de-duplicated, as `republish` did. Task 2 adds "updateProduct publishes the
   declaration sorted and de-duplicated".
2. **A variant with nothing of its own** still stores blank and reads its parent's values. This is
   the kept "stores both blank…" case (`operations.test.ts:2050`). A variant with its own value keeps
   it when the parent changes: Task 2's new case "a parent's change leaves a variant's own
   declaration and override as they are".
3. **The till's diet for a dish with no override and no declarations** reads "unknown, unknown,
   contains nothing", never vegan. Task 3 adds "a dish with no declaration and no override reads
   unknown".
4. **A new product's stored diet with an override** equals the override over `UNDECLARED_DIET`. This
   is covered by the kept `operations.test.ts` "listAvailableProducts carries the diet profile" (`:942`).
5. **A configuration file from before this slice** is refused as outdated, not as an invalid request
   (rules §9). Task 2's format row covers it.

---

### Task 0: Record the base

- [ ] **Step 1:** In a throwaway worktree of the base (`git worktree add --detach <dir> <base-sha>`,
  then `pnpm install`), run `pnpm protection-list list --out <empty absolute dir A>` from
  `apps/server` (rules §3). Keep `A` outside the repository.
- [ ] **Step 2:** Run
  `git grep -n -i -E 'recipe|ingredient|dietDerivation|diet_derivation|recipeDerivation|recipe_derivation|DietaryOrigin|DIETARY_ORIGINS|deriveDietProfile|validateOrigin' -- ':!docs' ':!pnpm-lock.yaml' > <scratch>/before.txt`.
  Remove the throwaway worktree after Task 4 step 2.

### Task 1: The dashboard's recipe screen, widgets, client and strings

Deletion only; no schema change.

**Interfaces — Produces:** `apps/dashboard/src/api/client.ts` no longer exports `Ingredient`,
`IngredientInput`, `IngredientPatch`, `RecipeLine`, `DIETARY_ORIGINS` or `DietaryOrigin`. It no
longer has `listIngredients`, `createIngredient`, `updateIngredient`, `getProductRecipe` or
`setProductRecipe`.

- [ ] **Step 1:** Delete the D3 cases in `product-list.test.ts` (`:5855-5870`) and `codes.test.ts`
  (`:610`). In `product-list.ts`, delete `recipeOrigins` (`:106-109`), its uses at `:113` and `:120`,
  and the `DIETARY_ORIGINS`/`DietaryOrigin` imports. `hasDietaryInfo` then reads declarations or the
  override only.
- [ ] **Step 2:** Delete the recipe screen and widgets and the client types and methods, with their
  `client.test.ts` cases.
  - `live-queries.ts`: delete `"recipe_lines"` and `"ingredients"` from `listProducts`, and the
    `getProductRecipe` and `listIngredients` entries.
  - Strings, English and Spanish: delete `nav.recipe`, every `origin.*`, `diet.auto` and
    `diet.contains_auto` (both say "from recipe"; `git grep` finds no reader), every `ingredient.*`
    and every `recipe.*`.
  - `codes.ts`: delete `ingredient.name_required` and `ingredient.not_found`.
- [ ] **Step 3:** Run `pnpm --filter @waitron/dashboard typecheck` and
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/api/client.test.ts src/i18n/codes.test.ts src/dashboard-app.test.ts`.
  From the root, run `pnpm exec vitest run scripts/live-subscriptions.test.ts`. Each must print a
  `Tests` count and no failure.
  Then run `git grep -n -i -E 'recipe|ingredient|origin-picker|DIETARY_ORIGINS' -- apps/dashboard/src`.
  It must print only `dashboard-app.test.ts:2600`.
- [ ] **Step 4:** Commit `-s -m "dashboard: remove the recipe screen, its widgets and client"`.

### Task 2: Recipes on the server, the permission, two tables, `recipe_derivation`, format bump

**Interfaces — Produces:**
- `publishedAllergens(manual: ProductAllergens | null): ProductAllergens | null`, in
  `packages/catalogue/src/derivation.ts`, exported through `index.ts`'s `export *`.
  `RecipeDerivation`, `republish` and `applyRecipeDerivation` are gone.
- `republishOverlays(tx, id, columns)` writes only row `id` (D1).
- `ConfigurationBundle.version` is one more than `main`'s value at build time. The previous value is
  refused as `setup.configuration_outdated`, and anything higher than the new value as
  `setup.configuration_newer`.

- [ ] **Step 1: Failing tests.**
  - `derivation.test.ts`: `describe("publishedAllergens")`, re-pointed from today's no-recipe
    `republish` cases. Each must hold:
    - `publishedAllergens(null)` is `null`;
    - `publishedAllergens({ gluten: { kinds: ["wheat"] } })` equals itself;
    - `publishedAllergens({})` equals `{}`;
    - "sorts and de-duplicates kinds": `publishedAllergens({ nuts: { kinds: ["walnuts", "almonds", "almonds"] } })`
      equals `{ nuts: { kinds: ["almonds", "walnuts"] } }`.
  - `operations.test.ts`:
    - Add "updateProduct publishes the declaration sorted and de-duplicated". After
      `updateProduct(tx, id, { allergens: { nuts: { kinds: ["walnuts", "almonds", "almonds"] } } })`,
      `products.allergens` equals `{ nuts: { kinds: ["almonds", "walnuts"] } }` and
      `products.manual_allergens` equals the input.
    - Add "a parent's change leaves a variant's own declaration and override as they are". In the
      `:1987` describe: `updateProduct(variantId, { allergens: { milk: {} }, dietOverride: { kosher: "yes" } })`,
      then `updateProduct(parentId, { allergens: { sesame: {} }, dietOverride: { vegan: "yes" } })`.
      Then `published(variantId)` equals
      `{ allergens: { milk: {} }, diet: { vegan: "unknown", vegetarian: "unknown", contains: [], kosher: "yes" }, effectiveAllergens: { milk: {} }, effectiveDiet: <same diet> }`.
      It passes today too: it pins the behaviour the deleted variant loop never changed.
  - `configuration-import.test.ts`:
    - add `["A1308 4a-i pre-recipe-removal export", { version: <main's value> }]`;
    - the "future version" row becomes one above the new value;
    - `:48` takes the new value.
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/derivation.test.ts` and
    `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts`. Expected: FAIL,
    because `publishedAllergens` is missing and the old format is accepted.
- [ ] **Step 2:** `publishedAllergens` returns `null` for `null`, else `mergeAllergenMaps({}, manual)`.
  Delete `RecipeDerivation` and `republish`. `mergeAllergenMaps` stays: the till imports it
  (`apps/till/src/state/party-allergy.ts:2`).
- [ ] **Step 3: Catalogue.**
  - `republishOverlays` reads only row `id`. A variant with no own `manual_allergens` stores `null`;
    otherwise the row stores `publishedAllergens(own manual)`. The diet half keeps reading
    `dietDerivation` until Task 3.
  - `insertProduct` uses `publishedAllergens`.
  - Delete `applyRecipeDerivation` and its export (`index.ts:23`), and `applyDerivation`'s recipe arm.
  - Delete `variant-fallback.ts:111` and the recipe clause at `product-editor.ts:46`.
- [ ] **Step 4: Format bump.** Update `packages/provisioning/src/configuration-transfer.ts:123`,
  `:160`, `:473` and `:476` to the new value. Do the same in `packages/provisioning/test/configuration-bundle.ts:5`,
  `configuration-transfer.privacy-contact.test.ts:79`, `configuration-transfer.boundaries.test.ts:104`
  (one above the new value), and `apps/server/src/configuration-transfer.test.ts:389`, `:5481`.
- [ ] **Step 5: Schema, lists, permission.**
  - Delete `schema/recipes.ts` and its test, `recipeDerivation` in `schema/catalogue.ts`,
    `schema/index.ts:38`, `index.ts:177`, `classification.ts:118-119` and `configuration-transfer.ts:74-75`.
  - Delete `scripts/schema-constraints.test.ts:271-272` and `:486`, and `mutation-costs.json:111`.
  - Delete `recipe.manage` (`permissions.ts:20`, `:53`).
- [ ] **Step 6: Package, server, CI.**
  - Delete `packages/recipes/`, `apps/server/src/recipe-api*.ts` and `apps/server/package.json:64`.
  - Delete the entries in `test-durations.json:877-878`, `changed-scope.mjs:318`, `ci.yml:3476`,
    `english-only.ts:33` and `scripts/english-only.test.ts:110`.
  - Run `pnpm install`.
  - `tables-menu.md` §4's `recipes-demo.ts` and `demo:recipes` are already gone (A1009):
    `git grep -n 'demo:recipes\|recipes-demo' -- ':!docs'` prints nothing.
- [ ] **Step 7: Tests.** Delete the D3 cases this task reaches.
  - In `operations.test.ts`, delete `:2022` (the `applyRecipeDerivation` set-up) and change the
    expectation at `:2063-2066` ("Assertions that change, by design").
  - `allergen-kinds.test.ts:75-87`: rename the variable `recipe` to `other`.
  - `variants.db.test.ts:113`, `:131`: drop `recipe_derivation`.
  - `variant-fallback.test.ts`: drop `PARENT_RECIPE_DERIVATION`, `W175_RECIPE_DERIVATION` and their
    uses.
- [ ] **Step 8: Madrid comparison.**
  - Add `"ingredients"` and `"recipe_lines"` to `REMOVED_TABLES` (`:39`). Both have 0 rows in every
    phase: manifest `:124`, `:199`, and the same rows in the other phases.
  - In the per-phase loop, remove `products.recipe_derivation` from `columns` and from every row,
    written like the `parties.main_bill_id` filter at `:167-169`, plus `delete row.recipe_derivation`.
- [ ] **Step 9: Rebuild and run.**
  - Run `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
  - From the root, run `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/english-only.test.ts scripts/changed-scope.test.mjs scripts/ci-workflow.test.mjs scripts/mutation-shard.test.mjs`.
  - Then run:
    - `pnpm --filter @waitron/catalogue exec vitest run`;
    - `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts`;
    - `pnpm --filter @waitron/provisioning exec vitest run`;
    - `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts src/configuration-transfer.test.ts src/catalogue-allergen-workflow.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`.
  - Each run must print a `Tests` count and no failure.
- [ ] **Step 10:** Commit `-s -m "Remove recipes: package, routes, permission, tables and the recipe-derived allergens"`.

### Task 3: `diet_derivation` and the `dietDerivation` field

**Interfaces:**
- **Produces:** `export const UNDECLARED_DIET: DietProfile = { vegan: "unknown", vegetarian: "unknown", contains: [] }`
  in `packages/shared/src/menu-document/dietary.ts`. It is exported from `@waitron/shared` and
  re-exported by `@waitron/catalogue` where `deriveDietProfile` was.
- **Removes:**
  - from `@waitron/shared`: `DIETARY_ORIGINS`, `DietaryOrigin`, `DietDerivation`, `validateOrigin`,
    `deriveDietProfile`;
  - from `@waitron/catalogue`: `applyDietDerivation`;
  - the `dietDerivation` property, from: `Product`, `AvailableProduct`, the menu-document product and
    variant types, `ZoneMenuOffer`, `ZoneMenuOfferVariant`, the line-context row (`module.ts:1191`),
    `TillProduct` and `TillSellingValues`.

- [ ] **Step 1: Failing tests.**
  - `dietary.test.ts`: add "UNDECLARED_DIET claims nothing". It checks that `UNDECLARED_DIET` equals
    `{ vegan: "unknown", vegetarian: "unknown", contains: [] }` and that
    `overlayDietProfile(UNDECLARED_DIET, null)` equals the same. Delete the D3 cases. Wherever an
    `overlayDietProfile` case builds its input with `deriveDietProfile(...)`, write the literal
    profile that call returned instead; its expectation is unchanged.
  - `as-served-diet.test.ts`: add "a dish with no declaration and no override reads unknown". It
    expects `{ vegan: "unknown", vegetarian: "unknown", contains: [] }`.
  - Run `pnpm --filter @waitron/shared exec vitest run src/menu-document/dietary.test.ts`. Expected:
    FAIL, because `UNDECLARED_DIET` is missing.
- [ ] **Step 2: Shared.**
  - Add `UNDECLARED_DIET`. Delete `DIETARY_ORIGINS`, `DietaryOrigin`, `DietDerivation`, `ORIGINS`,
    `VEGAN_OK`, `VEGETARIAN_OK`, `validateOrigin` and `deriveDietProfile`, and update `index.ts`.
  - In `validateContainsTag`'s comment, delete the clause comparing it with `validateOrigin`.
    `errors.ts:72` becomes "A supplied contains-tag, or a contains list, is not valid." The code
    name stays.
  - Delete `dietDerivation` and the recipe clauses in the comments of `menu-types.ts`,
    `product-types.ts` and `dietary-declarations.ts:37-38`. Delete those clauses; do not reword them.
- [ ] **Step 3: Catalogue.**
  - `republishOverlays`' diet half: a variant with no own `diet_override` stores `null`; otherwise the
    row stores `overlayDietProfile(UNDECLARED_DIET, own override)`. `insertProduct` does the same.
  - Delete `applyDerivation`, `applyDietDerivation` and every `dietDerivation` entry listed in Files,
    including `variant-fallback.ts:112`, `menu-document.ts:800` and `menu-navigation.ts:175`.
- [ ] **Step 4: Line copy and seam.**
  - Delete `dietDerivation` at `service.ts:271`, `venue-service/src/operations.ts:1201`, `:1220`,
    `:1353`, `module.ts:237`, `:437`, `:1191` and `working-order.ts:5322`, `:5533`, and in
    `schema/catalogue.ts`.
  - The `diet` column comment becomes "the published profile: the override laid over `UNDECLARED_DIET`".
- [ ] **Step 5: Till.**
  - `as-served.ts:35-37` becomes `overlayDietProfile(UNDECLARED_DIET, override)`.
  - In `client.ts`, delete `DietaryOrigin` and `DietDerivation` from `:272-280`, and `dietDerivation`
    at `:366-368`, `:384`, `:400` and `:505`.
  - In `:289`'s comment, delete only the word "recipes,", giving "used by stock and preparation
    routing". The rest of the comment is not this slice's claim.
- [ ] **Step 6: Fixtures.**
  - Run `git grep -l -E '^[[:space:]]*dietDerivation: null,?$' -- apps packages | xargs sed -i '' -E '/^[[:space:]]*dietDerivation: null,?$/d'`
    (about 67 lines in 47 files), then run `pnpm exec prettier --write` on those files.
  - Apply D3 to whatever `git grep -n -E 'dietDerivation|diet_derivation|deriveDietProfile|origins:' -- apps/till apps/dashboard/src packages/catalogue/src packages/shared/src packages/db/src` still prints.
  - **Till.** Each derivation set-up becomes the override that gives the same asserted profile:
    - `["plant"]` → `{ vegan: "yes", vegetarian: "yes" }`;
    - `["plant","dairy"]` → `{ vegan: "no", vegetarian: "yes" }`;
    - `["meat"]` → `{ vegan: "no", vegetarian: "no", addContains: ["meat"] }`;
    - `["other_animal"]` → `{ vegan: "no", vegetarian: "no" }`;
    - pending with no origins → no override.

    This applies in `as-served-diet.test.ts`, `basket.test.ts:735-775`, `basket.a11y.test.ts:249-263`,
    `modifier-picker.test.ts:754` and `:848`, and `api/client.test.ts:5236` and `:5259`.
    `till-table-order-screen.test.ts:3261` and `till-app.test.ts:355` and `:389` lose the line.
  - **Catalogue.** In `operations.test.ts`, delete `PARENT_DIET_DERIVATION` and its set-up (`:1993`,
    `:2023`) and the line at `:960`. In `variant-fallback.test.ts`, delete `PARENT_DIET_DERIVATION`
    and `W175_DIET_DERIVATION` from the set-ups and expected rows, and remove `"dietDerivation"` at
    `:764`. The stored `diet` values there are written directly, so they do not change.
  - **Db.** Remove `diet_derivation` from `schema/catalogue.test.ts:106-110`.
  - **Server.** The comments "No recipe" at `till-api.test.ts:2214` and `:2237` and at
    `till-api.fiscal-sale-paths.test.ts:1987` become "No override".
- [ ] **Step 7: Madrid comparison.** Extend Task 2's column removal to `products.diet_derivation` and
  `working_line_contexts.diet_derivation`.
- [ ] **Step 8: Rebuild and run.**
  - Rebuild core, then run the root guards from Task 2 step 9.
  - Run:
    - `pnpm --filter @waitron/shared exec vitest run src/menu-document`;
    - `pnpm --filter @waitron/catalogue exec vitest run`;
    - `pnpm --filter @waitron/venue-service typecheck`;
    - `pnpm --filter @waitron/module typecheck`;
    - `pnpm --filter @waitron/till exec vitest run src/state src/widgets/basket.test.ts src/widgets/basket.a11y.test.ts src/widgets/modifier-picker.test.ts src/api/client.test.ts`;
    - `pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/working-order.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`.
  - Each run must print a `Tests` count and no failure.
- [ ] **Step 9:** Commit `-s -m "Remove the recipe-derived diet from products, menus, a line's frozen copy and the till"`.

### Task 4: Leftovers, protection list, docs, backlog

- [ ] **Step 1: Leftover search.** Run Task 0 step 2's command again. These are the only lines it may
  still print:
  - media's rendition "recipe" (`packages/media/src/routes.ts` and its tests);
  - `scripts/release/prepare-ui*` (`recipeSha512`);
  - `bench/sqlite-failover`;
  - `packages/db/src/immutability.sql.md`;
  - `packages/db/src/schema/daily-closes.ts:12`;
  - `packages/reporting/src/backup-verification.test.ts:115`;
  - `apps/server/src/kitchen-allergy.ts`, where "ingredients" means a dish's declared allergens
    (`tables-menu.md` §4, "Not touched");
  - `apps/till/src/widgets/party-allergy-dialog.test.ts:189`;
  - `apps/server/src/catalogue-api.test.ts:3185`, "Ingredient only", which is a product's name;
  - `apps/server/src/boot.test.ts:671-674` and `apps/dashboard/src/dashboard-app.test.ts:2600` (D3);
  - the two captured fixtures (D2);
  - `seed.madrid-baseline.test.ts`'s removal lists.

  Anything else is a leftover. Remove it, or stop if it is outside this plan's files (rules §5.5).
- [ ] **Step 2: Protection list.** From `apps/server`, run `pnpm protection-list list --out <empty absolute dir B>`,
  then `pnpm protection-list compare --old <A> --new <B> --report <absolute file>`. Paste the report
  into the pull request and mark each line against the prediction.
- [ ] **Step 3: Developer docs.**
  - `products.md:564`, `:785-786`, `:894`: the published allergens are the declaration, sorted and
    de-duplicated, or none while unreviewed.
  - `design-system.md:667`, `:2918-2919`, `:2936-2938`, `:3036`: remove "ingredient form", "recipe
    editor" and "dietary-origin picker" from the lists.
  - `design-system.md:5840` and `conventions-data.md:1821-1824`: give the new format number.
  - `ci-and-gates.md:490`: remove `recipes`.
- [ ] **Step 4: Backlog** (CLAUDE.md §6: a finished entry is deleted, not marked done).
  - `back-office.md`: delete "## Recipes are removed under A1308" (`:6-21`). The decision at
    `:48-51` stays.
  - `backlog.md:1697-1700`: delete the index line.
  - `dashboard.md:173-174`: remove "ingredient" and "the allergen and dietary-origin pickers on the
    ingredient form".
  - `dashboard.md:1372-1381` and `backlog.md:1434` (A1227): drop the Catalogue's case, which this
    slice ends. Keep the check of other screens.
  - `catalogue.md:1468-1469`: drop the origin half.
  - `architecture.md:397` and `:781`: remove "recipe ingredient".
  - `kitchen.md:414`: append "**<date>:** A1308 4a-i moved it to version <n>."
- [ ] **Step 5:** Commit `-s -m "docs: A1308 4a-i retires recipes"`. Then run `/finish-branch` with
  this plan's path. The pull request's first line is the reset sentence. Its body lists the
  protection-list report and every D3 deletion.

## Other plans that name these (docs only; not edited here)

- **A1002.** [plan](2026-11-08-a1002-custom-roles.md) `:22`, `:51`, `:77`, `:100`;
  [design](../specs/2026-10-22-a1002-custom-roles-design.md) `:99`, `:151`, `:538`, `:721`.
  - Both say to keep `recipe.manage` at its Manager default "until its area retires the route". This
    slice is that retirement. Neither slice blocks the other.
  - If A1002 cut 1 (the permission renames) lands first, this slice deletes `recipe.manage` from the
    renamed catalogue and test.
  - If this slice lands first, cut 1's scan (`:77`) finds no `recipe.manage`.
  - If cut 2 (stored role permissions) lands first, stop point 1 applies.
- **A1301.** [plan](2026-11-01-a1301-remove-location.md) `:3136-3137`, `:4150`, `:4218`, `:4269` name
  `packages/recipes`. These are its landed fixture slices.
- **A760.** [plan](2026-11-04-a760-squash-into-eight-sets.md) `:516` names the retired `recipes-demo.ts`.
- **Design cites that moved.**
  - `tables-menu.md` §4 places the menu types at `packages/catalogue/src/menu-types.ts`; they are
    now in `packages/shared/src/menu-document/menu-types.ts`.
  - It names `apps/server/scripts/recipes-demo.ts` and `allergens-demo.ts`, both retired by A1009.
  - Its line numbers for `operations.ts` and `client.ts` have moved; this plan's are current.

## Questions for the watcher

None open. The coordinator settled the earlier questions on 2026-11-08: the split, and the fixtures
staying unchanged.

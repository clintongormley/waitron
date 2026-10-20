# A655 — fewer and slimmer columns on Products: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: LIGHT** (as queued: no per-task reviewer; `/finish-branch` runs its wave). **But see
"Points for the driver" 1:** Task 1 adds a field to `Product` and `ListedVariant`, shapes
`@waitron/catalogue` exports and `apps/dashboard` imports — the driver decides whether that is the
"cross-package contract" risk trigger, which would make the path FULL. **No migration, nothing
fiscal, one pull request.** Branch `feat/a655-products-columns`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a655-products-columns`, from `main` at
`1f54271d9`. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** the Products list gets narrower and more useful — a Course column and filter, a short
"Standalone" heading, Allergens and Dietary info hidden until chosen, and no Made at column — with
"Default course" renamed "Course" across the dashboard.

**Architecture:** `apps/dashboard/src/widgets/product-list.ts` owns the columns; the catalogue
screen already watches the courses list (`apps/dashboard/src/screens/catalogue-screen.ts:253`) and
hands it on through `dashboard-catalogue-browser` to the list. The list's only new data is each
product's course and each variant's own and effective course, added to the product list read in
`packages/catalogue/src/operations.ts` (`products.course_id` already exists,
`packages/db/src/schema/catalogue.ts:70`, so no migration). The routing read stays for the red
asterisk; its failure moves from every category's Made at cell to one line above the list.

**Tech stack:** TypeScript, Lit, Drizzle on `node:sqlite`, Vitest (`apps/dashboard` in real
Chromium, project `browser`; `packages/catalogue` and `apps/server` in Node).

## Sources

- Backlog: `docs/backlog.md` "A655 — fewer and slimmer columns on Products" and its detail,
  `docs/backlog/catalogue.md#a655--fewer-and-slimmer-columns-on-products` — items (1) heading,
  (2) Allergens and Dietary info hidden, (3) Made at, and the owner's **2026-10-16 addition**
  (commit d23eee32c): heading "Standalone"; editor field and filter "Standalone ordering by"; a
  Course column and a Course filter; "Default course" renamed "Course" everywhere the dashboard
  shows it; confirm on a till that a course change is live without republishing.
- **Owner answers** (`~/waitron-campaign/questions.md`, 2026-10-20 ~14:10 and ~14:14), quoted:
  > "A — DELETE IT, WITH ITS FILTER. Which items go where is found on Prep stations → Routing; the
  > red * on a category with no working station stays; the "routing cannot be read" line moves
  > above the list as in picture 05."

  > "Por separado/Pedir por separado" — the column heading is «Por separado» and the editor field
  > and filter are «Pedir por separado» (today's field wording kept, not option A's «Quién lo pide
  > por separado»). Values stay Cualquiera / Solo el personal / Nadie.
- Pictures: `docs/backlog/mockups/a655-products-columns/` — `01-today-light.png` (today),
  `02-a-made-at-deleted-light.png` / `-dark.png` (the chosen list), `05-routing-unavailable-light.png`
  (the line above the list), `06-spanish-light.png`; the question text is `question.txt` there.

## Decisions this plan makes that the spec does not (the default to build)

1. **Column order:** Name, **Course**, Price, Modifiers, **Standalone**, Availability, Allergens
   (hidden), Dietary info (hidden), Actions — picture 02. Course is `choosable: "shown"`. A person
   whose saved column order predates Course gets it after Name: `#orderedColumns` places a column
   missing from the saved order after the nearest earlier column it holds
   (`packages/ui/src/components/wt-data-table.ts:1411-1435`, read, not run).
2. **Where the Course data comes from (no migration):** the product list read
   (`GET /management-api/catalogues/:id/products`, `listProducts`,
   `packages/catalogue/src/operations.ts:1085`) gains `courseId` on each `Product`
   (`effective.courseId`, which for a top-level product is its own) and, on each `ListedVariant`,
   `courseId` (the variant's OWN stored value, null when it follows its product) and
   `effective.courseId` (`effectiveProductColumns.courseId`,
   `packages/catalogue/src/variant-fallback.ts:108`). Courses' names come from the `listCourses`
   read the screen already watches (live). **Probe, 2026-10-20, this worktree, reverted after:**
   adding `courseId` to `Product` and `effective.courseId` to `ListedVariant` left
   `pnpm --filter @waitron/catalogue typecheck` and `pnpm --filter @waitron/server typecheck` at
   exit 0; `pnpm --filter @waitron/dashboard typecheck` failed only in test fixture factories (19
   files: every `error TS` line was in a `*.test.ts`); `packages/catalogue` ran 107 files / 2550
   tests and failed 2 (both in `variant-fallback.test.ts`), and the 93 `apps/server` test files that
   read products ran 4516 tests and failed 1 (`catalogue-api.test.ts`). Those three are in "Changed
   test checks". With `Product.courseId` alone (no variant field) all of those passed.
3. **Course cell.** A product row shows its course's name; a product with no course shows `—`
   (picture 02; a literal `—` for "no value" is already the dashboard's habit, e.g.
   `apps/dashboard/src/screens/floor-plan-tables-panel.ts:210`); a course id the courses list does
   not hold shows `t("editor.missing_choice")` ("Unavailable selection"), as the product editor
   does for the same case (`apps/dashboard/src/widgets/product-editor.ts:1110-1112`). A category
   row's cell is blank (picture 02; `#buildColumns` already draws nothing for a category under any
   column but Name and Actions). **A variant row's cell is blank while the variant follows its
   product's course and names the variant's own course when it has one** — the variant editor
   offers a course of its own (`product-editor.ts:1114`), and blank-when-following matches the
   Standalone and Modifiers cells of a variant row.
4. **Course filter:** multi-select, like Standalone (and the deleted Made at); options are the
   courses in firing order (`listCourses`' order, `apps/server/src/kitchen.ts:352-365`), then
   **"No course"** last. **While the courses list is empty the filter offers no options at all**, not
   even "No course": `wt-data-table` keeps a stored choice waiting, unjudged, only while a column
   offers an empty list (`wt-data-table.ts:1683-1695`), so offering "No course" alone would throw
   away a remembered course choice in the moment before the courses arrive. A venue with no courses
   has nothing to filter by. The filter reads a row's **effective** course (a variant's
   `effective.courseId`, a product's `courseId`), as the Allergens filter reads each variant's
   effective state (`product-list.ts:1271-1276`).
5. **Course sort:** firing order; a course the list does not hold sorts after every known course,
   and no course after that.
6. **Labels.** `product.ordering` becomes the column heading only: "Standalone" / «Por separado».
   The Standalone filter's label and the editor field both read `editor.ordered_on_own`: "Standalone
   ordering by" / «Pedir por separado» (Spanish unchanged). The filter's "all" and count labels
   (`product.filter_ordering_all`, `product.filter_ordering_count`) stay as they are.
   `product.course` becomes "Course" / «Curso» and serves the editor field, the column heading and
   the Course filter. New keys: `product.filter_course_all` "Any course" / «Cualquier curso»,
   `product.filter_course_count` "{count} courses" / «{count} cursos», `product.filter_no_course`
   "No course" / «Sin curso». The Spanish of every new key is this plan's wording (an owner point in
   the PR).
7. **Allergens and Dietary info** become `choosable: "hidden"`. A person who has already saved a
   shown/hidden choice for either column keeps it: a stored choice wins over the column's default
   (`wt-data-table.ts:1444-1445`). Their filters keep working while hidden: "A hidden column still
   filters and is still searched, but does not sort" (`wt-data-table.ts:57`), and in the probe below
   "keeps products by allergen state…" passed with both columns hidden.
8. **Made at goes whole:** the column, its filter, its cell link to Prep stations' routing view,
   the category rows' station and grey second line, its `maker-link`/`maker-detail` styles, its
   twelve strings, and the Products screen's `listMadeAt` subscription (whose only reader was this
   column). A saved column choice, column order or filter naming `made-at` is ignored, as the
   removed Main category column's key already is (test "ignores the old Main category column's key
   in a saved column choice and order, and applies the rest"). **The server route
   `GET /management-api/products/made-at`, the client's `listMadeAt` and its live query stay**: the
   station-deletion case in `apps/server/src/kitchen-delete.integration.test.ts:271-273` asserts
   through that route, so deleting it would delete a behavioural check. A new backlog entry asks
   whether to delete or reuse it.
9. **The routing line** (picture 05): one paragraph in `dashboard-catalogue-browser`, slotted into
   the list's `toolbar-bottom` slot after the selection bar, so it sits directly above the table;
   danger colour (the browser's existing `.error` rule, `catalogue-browser.ts:89-91`),
   `role="status"`, `data-test="routing-unavailable"`. Text: "Kitchen routing unavailable:
   categories with no station are not marked. Try again later." / «Envío a cocina no disponible:
   las categorías sin estación no se marcan. Inténtalo más tarde.» (new key
   `folders.routing_unavailable`; `folders.made_at_unavailable` is deleted). **Shown only while the
   routing read has failed AND at least one category exists**: the line speaks only about
   categories, and the shell test "the Products screen in the shell"
   (`apps/dashboard/src/dashboard-app.test.ts`) measures the screen with a refused routing read
   (`dashboard-app.test.ts:7262`), 40 uncategorised products and "no message above the list"
   (`docs/developers/design-system.md`, sticky headings) — so that measurement keeps its setup.
10. **The red asterisk stays exactly as built** (`unroutedFolderIds`, `isRouted`,
    `product-list.ts:1446-1458`).
11. **`folderMadeAt` is trimmed to what the asterisk reads.** With the second line gone, its
    `source` and `someElsewhere` outputs have no reader, and `someElsewhere` costs a `chooseMaker`
    call per active product per zone on every routing, product or category change
    (`apps/dashboard/src/widgets/folder-made-at.ts:115-124`). `FolderMadeAt` becomes `{ maker }`,
    the products argument goes, and so does `catalogue-browser`'s recompute on a products change.
    File and names stay (`folder-made-at.ts`, `FolderMadeAt`, `isRouted`) to keep the change small.
12. **"Confirm on a till that a course change is live without republishing"** is Task 8: run the
    existing pins, then a scripted look on the dev stack. If it is not live, Task 8 records a backlog
    entry and changes nothing else.
13. **The LOOK runs on the dev stack** (`wa-wt demo waitron-feat-a655-products-columns`), not in a
    browser test: the demo seed has real categories, courses and variants, which a stub fixture
    would have to invent. Screenshots are taken with the workspace's Playwright Chromium.
14. **The guides get no new heading**, so the English and Spanish `{#id}` sets stay twins; the
    text changes sit in `{#selling}`, `{#category}`, `{#course}` and `{#allergens}`.

## Points for the driver (contradictions and things not resolved here)

1. **LIGHT versus the risk triggers.** The queue says LIGHT; `~/.claude/CLAUDE.md` puts "a
   cross-package contract" on the FULL path. Task 1 adds fields to `Product` and `ListedVariant`
   (`packages/catalogue/src/product-types.ts`), the wire shape the dashboard imports as a type
   (`apps/dashboard/src/api/client.ts:43-49`). It is additive and the probe in Decision 2 found no
   consumer outside tests that breaks, but whether it counts is the driver's call.
2. **"Prep stations → Routing" versus "Routes".** The owner's answer and the question say Routing;
   the tab is named **Routes** / **Rutas** in both guides (`apps/server/src/guide/en/products.md:91`,
   `es/products.md:94`). The guides keep the tab's name.
3. **"Try again later" is false for one reader.** Picture 05's words tell everyone to try again,
   but a person refused the routing read for permission gets the same failure
   (`catalogue-screen.ts:158-165`, and the backlog entry "A person who may not read routing sees
   'Kitchen routing unavailable' on every category"), and trying again changes nothing for them.
   Built as pictured; that backlog entry is reworded to the line, not closed.
4. **The Spanish of the routing line and of the three Course filter strings** was not shown to the
   owner; owner point in the PR.
5. **Historical slice records keep "default course"** (`docs/backlog/dashboard.md:1097,1110`
   describe landed slices; CLAUDE.md §6: historical docs are not rewritten). Current docs change.

## Global constraints

- **English in general code**; Spanish only in `apps/dashboard/src/i18n/strings.ts` and the guides
  under `apps/server/src/guide/es/`. A test of a Spanish screen reads its expected text from the
  strings file (`es["…"]`), never a Spanish literal.
- **No hex, no `rem`** in new styles; colours read `--wt-*` tokens.
- **Coverage 98/98/98/95** in every package touched (`apps/dashboard`, `packages/catalogue`).
- **Changing an existing assertion is a stop** unless it is listed in "Changed test checks" below.
  Adding a field a fixture lacks (`courseId: null`, `effective.courseId`) is not an edit. Turning a
  hidden column on before mounting, where the checks that follow are unchanged, is listed as a
  setup change. Deleting a test of deleted behaviour is listed. The PR description repeats the list
  with the spec line that changes each.
- Every commit `git commit -s`. Every task ends with: its focused tests (read the `Tests` count; a
  run that prints none proves nothing; unset `AI_AGENT` and `CLAUDECODE` to see console output),
  `pnpm --filter <pkg> typecheck` for each package touched, and `pnpm exec prettier --check <changed
  files>` (`pnpm exec prettier --file-info <file>` for anything under `docs/`). Before a Chromium
  run, `memory_pressure | grep free`.
- Focused commands, from the worktree root:
  - dashboard (browser mode): `pnpm --filter @waitron/dashboard exec vitest run --project browser <files>`
  - catalogue: `pnpm --filter @waitron/catalogue exec vitest run <files>`
  - server: `pnpm --filter @waitron/server exec vitest run <files>`
  - root guards: `pnpm exec vitest run <scripts/…test.ts>`
- An implementer past about 150 tool calls with the task unfinished stops at a passing or cleanly
  red point, commits, and returns a handover (done, left, files, each check's state).
- Test line numbers below are at `1f54271d9`; they move as tasks land, so find a test by its name.

## Changed test checks

Each changes because the A655 spec or an owner answer changes what it pins.

**Task 1 — the list read carries courses** (spec: "a Course column and a Course filter join the
list")

| Test | Old check | New check |
| --- | --- | --- |
| `packages/catalogue/src/variant-fallback.test.ts` "nests each variant by its own names and stored price, never listing it on its own" | `toEqual` on the two variants without course fields | the same, plus `courseId: null` and `effective.courseId: f.courseId` on 125 ml (it follows its product), and `courseId: f.ownCourseId`, `effective.courseId: f.ownCourseId` on 175 ml (fixture: `variant-fallback.test.ts:109-113,134,173`) |
| same file, "lists an Inactive variant too, in variant order, with its effective values" | same `toEqual` | same additions |
| `apps/server/src/catalogue-api.test.ts` "lists every variant, a removed one too, with its own price and its effective price, VAT and category" (`:2812-2829`) | nested `effective: {…}` inside `expect.objectContaining` | `effective` also holds `courseId` (the fixture's value; `null` if its product has none) |

**Task 2 — the Course column** (spec: "a Course column and a Course filter join the list")

| Test | Old check | New check |
| --- | --- | --- |
| `product-list.test.ts` chooser test (`:668`) | the chooser's list starts `["made-at", true]` | `["course", true]` is inserted first (Task 4 and Task 6 change the same list again) |
| `product-list.test.ts` "draws the filters in the order of the default columns" (`:6036`) | `["made-at","modifiers",…]` | `"course"` inserted first (Task 6 then drops `made-at`) |

**Task 3 — labels** (owner 2026-10-16 heading and field; owner answer Q2)

| Test | Old check | New check |
| --- | --- | --- |
| `apps/dashboard/src/widgets/product-list.test.ts` "names the three orderings in English and in Spanish" (`:1000-1004`) | a Spanish heading starts with the literal «Pedido por separado» | starts with `es["product.ordering"]` (now «Por separado»); and the Standalone filter's label equals `es["editor.ordered_on_own"]` |
| `apps/dashboard/src/widgets/product-editor.test.ts:261` | `choices!.label` is "Ordered on its own by" | is `en["editor.ordered_on_own"]`, "Standalone ordering by" |
| `product-editor.test.ts:3247` | label "Ordered on its own by" | "Standalone ordering by" (read from `en`) |

`product-editor.test.ts:3256` (Spanish «Pedir por separado») is unchanged. `packages/ui`'s demo
and tests use "Ordered on its own by" and "Standalone ordering" as made-up labels for generic
components; they are not the dashboard's words and stay.

**Task 4 — Allergens and Dietary info start hidden** (spec item 2)

| Test | Old check | New check |
| --- | --- | --- |
| `product-list.test.ts` "offers every column but the name and the actions in a translated column chooser, and remembers a hidden one" (`:668`) | `["allergens", true]`, `["dietary", true]` | `["allergens", false]`, `["dietary", false]` |

Setup changes, checks unchanged (each mounts with the column(s) it reads turned on through the
stored column choice, `localStorage["waitron.products.table:columns"]`, via one helper). These are
exactly the tests that failed when the probe below hid the two columns:
`product-list.test.ts` "renders a PENDING allergen pill when allergens is null" (`:1560`), "renders
a 'none' allergen pill when allergens is an empty map" (`:1569`), "renders a 'declared' allergen
pill when allergens has entries" (`:1577`), "renders each allergen-state pill with its localised
name" (`:1585`), "distinguishes all three allergen states from one another" (`:1599`), "paints the
thumbnail frame and the badges through ::part, not a class" (`:1635`), "shows a variant's price,
availability, menu and effective allergens, leaving its other cells empty" (`:3820`), "keeps
products with dietary info, from their declarations or a diet override, or with none" (`:6204`),
"counts a recipe's categorised ingredient origins as dietary info, and an uncategorised one as
none" (`:6230`), "shows inherited allergen badges in italic for %s" (`:6714`, three cases); and
`product-list.a11y.test.ts` "shows inherited and own allergen badges accessibly" (`:209`, light and
dark). **Probe, 2026-10-20, reverted after:** with only the two `choosable` values changed,
`pnpm exec vitest run --project browser src/widgets/product-list.test.ts
src/widgets/product-list.a11y.test.ts src/widgets/catalogue-browser.test.ts
src/widgets/catalogue-browser.a11y.test.ts` in `apps/dashboard` printed `Tests 15 failed | 735
passed (750)`, and the 15 were the runs above.

**Task 6 — Made at deleted** (owner answer Q1 = A)

Deleted (they pin only the deleted column, its filter, its link or its category line):
- `product-list.test.ts`: "names a switched-off station with no replacement instead of nowhere"
  (`:414`), "names a switched-off station holding a placeholder or a replacement pattern as it is"
  (`:434`), "shows the made-at station, zone variation, and Routing link" (`:454`), "leaves a
  product's cell blank, without a link, when the made-at read has no entry for it" (`:485`), "says
  nowhere, with the Routing link, for a product the made-at read routes to no station" (`:507`);
  the describe "a click on a Made at cell's blank space beside its short link" (`:529`, both
  tests); the two phone-width cases "keeps a category's made-at link and its detail clear of
  pinned actions…" (`:1969`) and "keeps the full made-at link clear of pinned actions…" (`:2012`);
  the whole describe "a category's Made at" (`:4439`) and "falls back as product rows do when a
  switched-off station's or a category's name is not known" (`:4635`); "offers one Made at choice
  per station…" (`:6050`), "offers a switched-off station that only products with no replacement
  name" (`:6102`), "offers the stations a live routing update names, not the ones it replaced"
  (`:6127`).
- `product-list.a11y.test.ts`: the describe "product made-at link a11y (%s)" (`:583`, both tests,
  both themes).
- `catalogue-browser.test.ts`: "shows each category's route from the routing it holds, and redraws
  it when routing changes" (`:265`).

Changed:

| Test | Old check | New check |
| --- | --- | --- |
| `product-list.test.ts` chooser test (`:668`) | list starts `["made-at", true]` | no `made-at` entry |
| `product-list.test.ts` "draws the filters in the order of the default columns" (`:6036`) | `["made-at","modifiers","ordering","allergens","dietary"]` | `["course","modifiers","ordering","allergens","dietary"]` (Course added in Task 2) |
| `product-list.test.ts` variant-row test (`:3820`) | `product.made_at` among the headers whose variant cell is empty; last line: the product row's Made at cell is not empty | `product.made_at` dropped from the list; last line deleted |
| `product-list.test.ts` "ignores the old Main category column's key…" (`:4378`) | stored order `["reporting-category","price","made-at"]`; Price before Made at | stored order `["reporting-category","price","ordering"]`; Price before Standalone |
| `catalogue-browser.test.ts` "works the route out again when the products or the categories change" (`:284`) | Made at text of `folder:d` and new `folder:w` | renamed "works the asterisk out again when the categories change": a new subcategory under a category whose baseline reaches no station carries the asterisk; the products half goes (its "some items made elsewhere" line is deleted) |
| `catalogue-browser.test.ts` "decides the asterisk from default recovery for a switched-off station" (`:311`) and "clears the asterisk on a category that falls through…" (`:343`) | Made at text and asterisk | the `madeAtText` lines go; every `unroutedMarker` line stays |
| `catalogue-browser.test.ts` "leaves categories blank while routing loads, and says so when its read failed" (`:360`) | Made at cells blank, then "Kitchen routing unavailable" in `folder:d`'s cell | renamed "marks no category while routing loads, and says so above the list when its read failed": no line and no asterisk while loading; failed → the line shows, no asterisk |
| `catalogue-browser.a11y.test.ts` "renders categories' Made at %s accessibly" (`:236`) | axe over Made at cells, routed and unreadable | renamed "renders the categories' routing marks %s accessibly": the routed case shows an asterisk, the unreadable case the line; axe in both |
| `apps/dashboard/src/screens/catalogue-screen.test.ts` "loads all product editor libraries…" (`:346`) | `api.listMadeAt` called once; `list(el).madeAt[…]` is "Bar" | `api.listMadeAt` not called; the `madeAt` line goes |
| `catalogue-screen.test.ts` "loads the products once the server answers again…" (`:503`) | last-but-one line reads `list(el).madeAt` | that line goes |

Setup changes, checks unchanged: `apps/dashboard/src/widgets/product-editor.unsaved.test.ts` "real
Product write success commits before a failed refresh" (`:244`) uses `listMadeAt` as the read that
fails after the write (`:259-264`); the hook moves to `listProducts`, the read `#reloadProducts`
then makes. `product-list.a11y.test.ts` "renders accessibly mid-drag" (`:550`) and any mount
passing `madeAt`, `folderMadeAt` or `routingFailed` to the list drop the prop.

**Task 7 — `folderMadeAt` trimmed** (follows from Q1 = A: nothing shows `source` or
`someElsewhere`)

In `apps/dashboard/src/widgets/folder-made-at.test.ts`, every `maker` and `isRouted` assertion
stays exactly; every `source` and `someElsewhere` assertion goes; the `madeAt(model, products)`
helper loses `products`:
- Narrowed (`toEqual({ maker, source, someElsewhere })` or `toMatchObject` with `source` becomes
  `toEqual({ maker })` with the same maker): `:91`, `:100` (its `beer.source` line goes), `:110`,
  `:122`, `:147`, `:157`, `:166`, `:186`, `:199`, `:214`, `:562`, `:609`, and `:434` (its maker
  check stays, its "qualifies" check goes).
- Deleted (they pin only `source` or `someElsewhere`): `:131` "reads a category's own cell naming
  the default station as its own, not as the default"; `:601` "does not count a maker that reaches
  nowhere, whatever the source" (`:594` still pins nowhere); and every "qualifies"/"does not
  qualify" test from `:241` to `:548` other than `:434`.
- `:232` "gives every category an entry, and none to an unknown one" stays unchanged.

## Tasks

### Task 1: the product list read carries each product's course and each variant's own and effective course

**Files:** `packages/catalogue/src/product-types.ts` (`Product`, `ListedVariant`),
`packages/catalogue/src/operations.ts` (`PRODUCT_BASE_COLUMNS` `:177`, `RawProduct` `:212`,
`listedVariantsOfProducts` `:1117`), `packages/catalogue/src/variant-fallback.test.ts`,
`apps/server/src/catalogue-api.test.ts`, and the dashboard test fixtures the typecheck names.

Interfaces after the task:

```ts
export interface Product {
  // …unchanged…
  /** The kitchen course it is fired in, or null for none. */
  courseId: string | null;
}
export interface ListedVariant extends ProductVariant {
  allergensInherited: boolean;
  /** Its own course, or null while it follows its product's. */
  courseId: string | null;
  effective: {
    allergens: ProductAllergens | null;
    unitPrice: string;
    vatClass: VatClass;
    primaryCategoryId: string | null;
    courseId: string | null;
  };
}
```

- [ ] **Step 1 (failing test).** In `variant-fallback.test.ts`, describe "listProducts lists the
  parent alone…", add "names the product's course, and each variant's own course and the course it
  is fired in": `listProducts(tx, f.catalogueId)`; the parent's `courseId` is `f.courseId`; 125 ml
  has `courseId: null`, `effective.courseId: f.courseId`; 175 ml has `courseId: f.ownCourseId`,
  `effective.courseId: f.ownCourseId`. Run
  `pnpm --filter @waitron/catalogue exec vitest run src/variant-fallback.test.ts` — expect the new
  test to fail on `courseId` being `undefined`.
- [ ] **Step 2.** Add `courseId: effective.courseId` to `PRODUCT_BASE_COLUMNS` and `courseId: string
  | null` to `RawProduct`; in `listedVariantsOfProducts` select `courseId: products.courseId` and
  `effectiveCourseId: effective.courseId`, and map them to `courseId` and `effective.courseId`.
  Update the two interfaces.
- [ ] **Step 3.** Make the three listed checks (Changed test checks, Task 1) hold the real values.
  Re-run the catalogue file, then
  `pnpm --filter @waitron/catalogue exec vitest run` (whole package, Node, a few minutes) and
  `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts`. Expect green, and no
  other failure (the probe found none); any other failing check is a stop.
- [ ] **Step 4.** `pnpm --filter @waitron/dashboard typecheck` names the fixture factories that lack
  the field (the probe: 19 test files). Add `courseId: null` to each `Product` factory and
  `courseId: null` plus `effective.courseId: null` to each `ListedVariant` fixture. No assertion
  changes. Typecheck catalogue, server and dashboard to exit 0.
- [ ] **Step 5.** Commit: "The products list read names each product's course and each variant's own
  and effective course (A655)".

### Task 2: the Course column and the Course filter

**Files:** `apps/dashboard/src/widgets/product-list.ts`, `catalogue-browser.ts`,
`apps/dashboard/src/screens/catalogue-screen.ts`, `apps/dashboard/src/i18n/strings.ts` (the three new
filter keys, EN and ES), `product-list.test.ts`, `catalogue-browser.test.ts`,
`catalogue-screen.test.ts`.

Interfaces: `ProductList` and `CatalogueBrowser` gain
`@property({ attribute: false }) courses: Course[] = []` (`Course` from `../api/client.js`); the
screen passes `.courses=${this.courses}` to the browser, the browser to the list. In the list, a
change of `courses` resets `#columnLocale` (as a change of `madeAt` does today, `:729-730`) so the
filter's options are rebuilt; the cell reads `this.courses` when drawn.

- [ ] **Step 1 (failing tests)** in `product-list.test.ts`, new describe "the Course column", with
  courses `[{ id: "starters", name: "Starters", displayOrder: 1, … }, { id: "mains", name: "Mains",
  displayOrder: 2, … }]` and products with `courseId` "mains", "starters", null and "gone":
  - the heading after Name is `t("product.course")`, and the chooser offers `course` shown;
  - cells read "Mains", "Starters", "—" and `t("editor.missing_choice")`; a category row's cell is
    empty; a variant row's cell is empty when its `courseId` is null and names its own course
    otherwise (use a product whose variant has `courseId: "starters"` while the product has "mains");
  - sorting by Course ascending lists starters, mains, the unknown one, then the one with none;
  - the Course filter's options are `[["starters","Starters"],["mains","Mains"],["",
    t("product.filter_no_course")]]`, it is multi-select (two choices read
    `fill("product.filter_course_count", { count: "2" })`), choosing Starters keeps only the
    products — and the variant — fired as Starters (a variant filtered by its effective course),
    choosing "No course" keeps only the product with none;
  - with `courses = []` the Course filter offers no options, and a stored Course choice in
    `sessionStorage["waitron.products.table"]` survives until courses arrive, then applies (the
    failing case this guards: a "No course"-only list would drop the stored "mains");
  - a rename in `courses` redraws the cell and the filter option without a remount.
  In `catalogue-screen.test.ts` "loads all product editor libraries…", add
  `expect(list(el).courses).toEqual(<the stub's courses>)` (an added check). Run
  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/screens/catalogue-screen.test.ts`
  — expect the new tests to fail (no Course heading; `courses` undefined on the browser).
- [ ] **Step 2.** Add the column (Decisions 1, 3, 4, 5), the property chain, and the three strings
  (Decision 6). Update the chooser test's list and the filter-order test (`:6036`) to include
  `course` first among the movable columns — these two are in Changed test checks under Task 6 as
  their final form; at this task they still hold `made-at` too.
- [ ] **Step 3.** Re-run the two files plus `src/widgets/catalogue-browser.test.ts` and
  `src/widgets/product-list.a11y.test.ts`; add an axe case with the Course column filled to
  `product-list.a11y.test.ts` (light and dark). Typecheck. Commit: "Products lists each dish's
  course, with a Course filter (A655)".

### Task 3: "Standalone", "Standalone ordering by", and "Course" in place of "Default course"

**Files:** `apps/dashboard/src/i18n/strings.ts`, `product-list.ts` (the Standalone filter's label),
`product-list.test.ts`, `product-editor.test.ts`.

- [ ] **Step 1 (failing tests).** Make the three checks in Changed test checks (Task 3), and add to
  "names the three orderings…": the English heading starts with "Standalone" read from
  `en["product.ordering"]`, and the filter section's label is `t("editor.ordered_on_own")`. Add a
  check in `product-editor.test.ts` "picks the default course from a shared dropdown…" (`:5064`)
  that `course.label` is `en["product.course"]` and that this is "Course" (an added check). Run
  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-editor.test.ts`
  — expect failures naming "Standalone ordering" / "Ordered on its own by" / "Default course".
- [ ] **Step 2.** Strings: `product.ordering` "Standalone" / «Por separado»; `editor.ordered_on_own`
  "Standalone ordering by" (Spanish stays «Pedir por separado»); `product.course` "Course" /
  «Curso». In `product-list.ts` the ordering filter's `label` becomes `t("editor.ordered_on_own")`.
- [ ] **Step 3.** Re-run; also run `src/widgets/product-editor.a11y.test.ts`. Commit: "Shorter
  Standalone heading, and Course in place of Default course (A655)".

### Task 4: Allergens and Dietary info start hidden

**Files:** `product-list.ts`, `product-list.test.ts`, `product-list.a11y.test.ts`.

- [ ] **Step 1 (failing test).** Add "starts with Allergens and Dietary info hidden, offers them in
  Customise, and still filters by them": no `thead th` reads `t("product.allergens")` or
  `t("product.dietary_info")`; the chooser lists both unchecked; choosing the Allergens filter's
  `pending` and the Dietary filter's `has` still narrows the rows; ticking Allergens in the chooser
  shows its heading. Change the chooser test (Changed test checks, Task 4). Run the product-list
  file — expect the new test and the chooser test to fail.
- [ ] **Step 2.** Set `choosable: "hidden"` on both columns. Add one helper in each of the two test
  files, `showColumns(...keys)`, which writes `{ [key]: true }` entries to
  `localStorage["waitron.products.table:columns"]` before mounting, and call it in each setup-change
  test listed under Task 4. Change nothing else in those tests.
- [ ] **Step 3.** Run `src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts
  src/widgets/catalogue-browser.test.ts src/screens/catalogue-screen.test.ts`; read the count.
  Commit: "Allergens and Dietary info start hidden on Products (A655)".

### Task 5: the routing line above the list

**Files:** `apps/dashboard/src/widgets/catalogue-browser.ts`, `strings.ts`
(`folders.routing_unavailable`, EN and ES), `catalogue-browser.test.ts`,
`catalogue-browser.a11y.test.ts`.

- [ ] **Step 1 (failing tests)** in `catalogue-browser.test.ts`: "says above the list that routing
  could not be read, when there are categories": with `routingFailed = true` and categories, a
  `[data-test=routing-unavailable]` element is slotted `toolbar-bottom` into the list, reads
  `t("folders.routing_unavailable")`, has `role="status"`, and sits between the toolbar and the
  table (its box's bottom at or above the table's `thead` top); with `routingFailed = false` there
  is none; with `routingFailed = true` and `categories = []` there is none; in selection mode it
  follows the selection bar. Run
  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts`
  — expect failure (no such element).
- [ ] **Step 2.** Render the paragraph (Decision 9) and add the string.
- [ ] **Step 3.** Re-run the file, `catalogue-browser.a11y.test.ts`, `catalogue-screen.test.ts` and
  `src/dashboard-app.test.ts -t "the Products screen in the shell"` (the measurement that must keep
  "no message above the list"). Commit: "When routing cannot be read, Products says so once above
  the list (A655)".

### Task 6: delete Made at

**Files:** `product-list.ts`, `catalogue-browser.ts`, `catalogue-screen.ts`, `strings.ts`, and the
tests named under Task 6 in Changed test checks.

- [ ] **Step 1 (failing test).** In `product-list.test.ts`, replace the Main-category test's order
  as listed and add "ignores a saved Made at column choice, order and filter": store
  `{ "made-at": true }` under `…:columns`, `["made-at","price"]` under `…:column-order`, and
  `{ filters: { "made-at": ["bar"] } }` in `sessionStorage["waitron.products.table"]`; mount two
  products; no heading reads "Made at" (`en` has no `product.made_at` after this task, so assert on
  the literal English "Made at" and on the absence of `input[data-column="made-at"]`), Price is the
  third heading (after Name and Course), and both products are listed. Also make the chooser and
  filter-order checks drop `made-at`. Run the file — expect these to fail.
- [ ] **Step 2.** In `product-list.ts` delete the `made-at` column, `madeAtStation`,
  `#stationOptions`, `#folderMadeAt`, the `made-at` branch in `#buildColumns`, the `madeAt`,
  `folderMadeAt` and `routingFailed` properties and their `willUpdate` line, the `maker-link` and
  `maker-detail` part styles, and the imports only they used (`MadeAt`, `FolderMadeAt`). In
  `catalogue-browser.ts` stop passing those three to the list (it keeps `routing`,
  `routingFailed`, `#folderMadeAt` for the asterisk and the line) and drop its own `madeAt`
  property. In `catalogue-screen.ts` delete the `madeAt` state, the `listMadeAt` watch in
  `#reloadProducts` (`:279-281`) and the `.madeAt` binding. Delete the twelve strings
  `product.made_at`, `product.no_preparation`, `product.nowhere`, `product.no_replacement`,
  `product.varies_by_zone`, `product.filter_made_at_all`, `product.filter_made_at_count`,
  `folders.made_at_own`, `folders.made_at_inherited`, `folders.made_at_default`,
  `folders.made_at_some_elsewhere`, `folders.made_at_unavailable` (each used only by
  `product-list.ts` and its test, `git grep` 2026-10-20). Keep `folders.no_active_station`.
- [ ] **Step 3.** Apply every Task 6 deletion, change and setup change in Changed test checks, and
  nothing else. Run
  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/screens/catalogue-screen.test.ts src/screens/catalogue-screen.a11y.test.ts src/widgets/product-editor.unsaved.test.ts src/dashboard-app.test.ts`
  and typecheck. Then `git grep -n "made_at\|madeAt\|made-at" -- apps/dashboard/src` must list
  only `api/client.ts`, `api/live-queries.ts`, their tests, and stubs that still answer
  `listMadeAt` (`dashboard-app.test.ts`, `catalogue-screen.a11y.test.ts`,
  `modifier-owners.unsaved.test.ts`, `unit-owners.unsaved.test.ts`) — leave those stubs.
- [ ] **Step 4.** Commit: "Products drops the Made at column and its filter; Prep stations' Routes
  tab shows where dishes are made (A655)".

### Task 7: trim `folderMadeAt` to what the asterisk reads

**Files:** `apps/dashboard/src/widgets/folder-made-at.ts`, `folder-made-at.test.ts`,
`catalogue-browser.ts`.

- [ ] **Step 1.** Apply the Task 7 changes in Changed test checks; change the signature in the tests
  to `folderMadeAt(routing, categories)`. Run
  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/folder-made-at.test.ts`
  — expect type and shape failures (`source`/`someElsewhere` still returned).
- [ ] **Step 2.** `FolderMadeAt` becomes `{ maker: FolderMaker }`; delete `FolderMakerSource`,
  `outcomeOf`, the `elsewhere`/`compare`/`compareChoice` machinery, the products and zones loops,
  `linesAt`, `categoryNames`, the `source` computation and every import only they used; drop the
  `products` parameter. In `catalogue-browser.ts` call it without products and stop recomputing on
  a products change. Reword `isRouted`'s comment so it does not name Made at.
- [ ] **Step 3.** Run `folder-made-at.test.ts`, `catalogue-browser.test.ts`,
  `catalogue-browser.a11y.test.ts`, `product-list.test.ts`; typecheck; then
  `pnpm --filter @waitron/dashboard test:coverage` only if the per-file table is wanted for
  `folder-made-at.ts` (CI owns the package bar). Commit: "The category asterisk no longer works out
  a Made at line nobody shows (A655)".

### Task 8: confirm on a till that a course change is live without republishing

Not a fix. The claim under test (`packages/catalogue/src/menu-document.ts:339,344`, course left out
of the published copy) is already pinned in three places; this task runs them and then looks.

- [ ] **Step 1.** Run, and record each `Tests` count:
  `pnpm --filter @waitron/catalogue exec vitest run src/menu-document.test.ts -t "puts availability, course and category back"`;
  `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts -t "both move when a dish changes course"`;
  `pnpm --filter @waitron/till exec vitest run src/till-app-open-table.test.ts -t "A768 a moved course or category is read again"`
  (check each package's name in its `package.json`; the till runs in Chromium).
- [ ] **Step 2 (the look).** `lsof +D` the venue folder and port 8080 first; start
  `wa-wt demo waitron-feat-a655-products-columns`. In the dashboard pick a dish on a published menu
  that has no course (or one course); note it; change its Course to a course that is held until
  fired (Kitchen settings → Courses shows which) and save. **Do not publish.** On the till, open a
  table, wait at least 15 seconds (the open table's poll, `till-app-open-table.test.ts:397-400`),
  add the dish, and look at **New order**: the dish should sit in that course's held group. **The
  failing case** is the dish landing in **Fire now** or its old course's group; check it once more
  after reloading the till, to tell "not live until reload" from "not live until publish". Save
  two screenshots (before and after) to `~/waitron-campaign-b/a655-shots/till-course-*.png`.
- [ ] **Step 3.** Write what was run and seen in the PR description. If it is not live, add a
  backlog entry under `docs/backlog.md` (catalogue area) saying which of the two it was, with the
  screenshots' names; change no code here.

### Task 9: guides, developer docs and the backlog

**Files:** `apps/server/src/guide/en/products.md`, `apps/server/src/guide/es/products.md`,
`docs/developers/products.md`, `docs/developers/product-categories.md`,
`docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/catalogue.md`.

- [ ] **Guides (EN and ES, no new heading).** `{#selling}`: "Ordered on its own by" → "Standalone
  ordering by" (ES keeps «Pedir por separado»); add one sentence that the Products list shows it as
  **Standalone** / **Por separado** with a filter. `{#course}`: "Default course" → "Course" (twice;
  ES «Curso predeterminado» → «Curso», twice); add that the list's Course column shows each
  product's course and the Filters panel's Course filter picks one or several, plus "No course".
  `{#category}`, after the routing-grid paragraph: the Products list does not show where each dish
  is made, the Routes tab does; a red asterisk after a category's name in the list means its dishes
  reach no active station; when the routing cannot be read, one line above the list says so and no
  category is marked. `{#allergens}`, the "In the Products list…" paragraph: the Allergens and
  Dietary info columns start hidden — turn them on with the table's columns button (use the label
  the LOOK shows), and their filters work while hidden. Each sentence states only what Tasks 2-6
  built; check it against the screen in Task 10. Run
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Developer docs.** `products.md:736-740`: "Ordered on its own by" → "Standalone ordering by";
  the list "shows the same setting as a column headed Standalone, with a filter".
  `product-categories.md:50-53`: "the route the Made at column shows for it" → "its baseline
  route" and "Made at reads only" → "The baseline reads only"; `:80` "and Made at above" → "and the
  baseline above". `design-system.md:2275`: "the default course" → "the course".
- [ ] **Backlog.** Delete the A655 entry (`docs/backlog.md:765-770`) and the
  `## A655 — fewer and slimmer columns on Products` section (`docs/backlog/catalogue.md:736-761`).
  Under `## Decisions and deliberate limits` (`catalogue.md:885`) add one entry "Products list
  columns (A655, owner 2026-10-14, 2026-10-16 and 2026-10-20)": Availability stays as it is; the
  table may stay wider than its box at desktop width; Made at deleted with its filter (where dishes
  are made is on Prep stations → Routes; the red asterisk stays; a routing failure is one line above
  the list); Allergens and Dietary info start hidden; heading Standalone / «Por separado», field and
  filter "Standalone ordering by" / «Pedir por separado»; a Course column and filter;
  "Default course" is "Course". Add a dated pointer "(2026-10-20, A655: the Made at column and this
  note were deleted.)" to the W86 decision (`catalogue.md:1066`) and "(2026-10-20, A655: the Made
  at column and filter were deleted.)" after the A463 Made at sentences (`:1075-1080`). In
  `docs/backlog.md`: reword "A person who may not read routing sees 'Kitchen routing unavailable'
  on every category" (`:1005`) to the line above the list ("…sees the 'Kitchen routing
  unavailable' line above the Products list…", left open by W86 and A655); delete "The Products
  folder note ('some items made elsewhere') counts a period line…" (`:1996-1998`, its note and code
  are gone); in `:4639-4642` drop "a category row's maker link". In `catalogue.md:77` drop ", and of
  the product list's maker link". New short entries, catalogue area: "**The products' made-at read
  has no screen since A655** — `GET /management-api/products/made-at`, the dashboard's `listMadeAt`
  and its live query are read only by tests (`apps/server/src/kitchen-delete.integration.test.ts:271`
  checks station deletion through it). Delete them, or give the read a screen." Plus Task 8's entry
  if it found the course not live.
- [ ] `pnpm exec prettier --file-info` each `docs/` file; `pnpm exec prettier --check` the guides;
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts`. Commit (docs and guides together):
  "Products guide and docs: Course, Standalone, hidden Allergens and Dietary info, no Made at
  (A655)".

### Task 10: LOOK

- [ ] `lsof +D` the venue folder and port 8080; `wa-wt demo waitron-feat-a655-products-columns`
  (reuse Task 8's stack if it is still up). Sign in to the dashboard as the demo seed's owner.
- [ ] With the workspace's Playwright Chromium, screenshot to `~/waitron-campaign-b/a655-shots/`,
  named `products-<en|es>-<light|dark>-<1280|390>.png`, the Products list with a category open
  (variants open on one product), and `editor-<en|es>-<light|dark>-<1280|390>.png`, the product
  editor with **Selling** and **Kitchen** open (Standalone ordering by, Course). Also, once, at 1280
  light in each language: the Filters panel open (Course filter with two courses chosen) as
  `filters-<en|es>.png`, and the column chooser as `columns-<en|es>.png`. For the routing line, make
  the routing read fail (sign in as a person without the routing permission, or stop the read in
  the browser's network panel) and take `routing-line-<en|es>-light-1280.png`.
- [ ] Put the list shots beside `02-a-made-at-deleted-light.png` / `-dark.png`, and the routing
  line beside `05-routing-unavailable-light.png`; record every difference in the PR description,
  fix what is a defect, and list what is a judgement call as an owner point. Check each guide
  sentence from Task 9 against what the shots show.

**PR description:** plain-English summary; the Decisions above in one line each; Task 8's result;
"Changed test checks" in full with the spec line for each; owner points (Spanish of the routing line
and the Course filter strings; the variant Course cell rule; a person who had saved Allergens or
Dietary info shown keeps them).

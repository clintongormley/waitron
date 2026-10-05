# Product folders (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard's Products screen into a file browser of products and folders (the
reporting categories), make categories plain internal folders (one untranslated name, no image, no
colour), remove labels, and retire the Categories screen.

**Architecture:** Server first, screens last. Labels come out of the recorded classification and
the reports, then out of every package, then out of the schema. Categories lose translations, then
their image and colour. Superseded 2026-10-05 by W92
(`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): a category has an optional
colour again, which products inherit. Two new catalogue operations — move a selection, delete a
selection — back the new screen. The screen is a new `dashboard-catalogue-browser` widget wrapping the existing
`dashboard-product-list`, which learns to show folder rows beside product rows.

**Tech Stack:** TypeScript, Hono (server routes), drizzle-orm + drizzle-kit on `node:sqlite`
(schema and migrations), Lit web components (dashboard), Vitest (node projects for packages and
server, real headless Chromium for the dashboard and `packages/ui`).

**Spec:** [docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md](../specs/2026-09-30-catalogue-menus-routing-design.md),
§1, §2, §3 and §6 "Slice 1". Slices 2 (menus) and 3 (routing) are NOT in this plan. In particular
the kitchen `station_id` on products and categories stays; slice 3 removes it.

## Global Constraints

- Waitron is not live: no data migration and no backwards-compatibility code (CLAUDE.md §3). After
  this branch lands, every dev venue needs `wa-wt reset demo <worktree-name>`, because stored
  category names are JSON text and the image/colour columns are dropped. Say so in the PR body.
- Every commit: `git commit -s`, message in plain English (owner rule; name the files and error
  codes once as pointers).
- Coverage `98/98/98/95` in every package touched; never close a gap with an exclude or ignore
  comment. The mutation-tested packages are `ui`, `ui-core`, `shared`, `fiscal` and `db`
  (`ls packages/*/stryker.config.json`); this plan touches `ui` (Task 7) and `shared` (Task 1), and a
  thinned test there turns a mutation run red.
- Every colour, spacing, radius and font reads a `--wt-*` token. Markup handed to `wt-data-table`
  as a cell is styled with `part=` / `::part()`, never a CSS class.
- Forms follow `docs/developers/design-system.md` → Forms: required fields visibly marked, a
  field's problem beside the field, a hint as the field's placeholder, and the form's refusal
  message at the BOTTOM of the form, left-aligned on its own line, never beside the buttons or in a
  dialog's pinned button bar (owner decision 2026-09-30, newer than CLAUDE.md's "beside the
  action").
- Product wording: "Delete makes a product Inactive, and Restore makes it Active again; never label
  either of them 'unavailable'" (design-system.md, "Products: Active and Available").
- Error codes name the domain concept (`category.*`, `product.*`); before go-live a code may be
  deleted freely, and every copy in the tree goes in the same change (CLAUDE.md §3).
- Migrations: never edit a shipped migration file. Generate with
  `pnpm --filter <pkg> db:generate --name <name>`; hand-written SQL with
  `pnpm --filter <pkg> db:generate:custom --name <name>`.
- Browser suites: check `memory_pressure | grep free` before a browser run; do not start one beside
  a whole-workspace `pnpm -r test:coverage`.
- Run focused tests while implementing; CI runs the package suites. Do not hand-run the pre-push
  checks before pushing.

## Review Focus

These inputs are the likeliest to hurt a manager and are pinned by tests in the tasks named:

1. **Moving a folder into itself or one of its own subfolders** — by "Move to…" or by dragging.
   The folder is never offered as its own destination, a drop onto it is refused, and the server
   refuses with `category.parent_cycle` whatever the screen sends. (Tasks 6, 9, 10)
2. **Deleting a folder together with one of its own subfolders, "delete everything inside"
   chosen.** The subfolder is already gone when its turn comes; the whole delete still succeeds in
   one transaction and nothing is left half done. (Task 6)
3. **A link to a folder that no longer exists** (`/manage/catalogue/folder/<deleted id>`). The
   browser shows the top level and no broken breadcrumb. (Task 8)
4. **The Status and Ordering filters** (Status starts on "Active") must never hide a folder,
   whatever they are set to. (Task 8)
5. **A selection made in one folder, then navigating away or changing a filter.** Either clears the
   selection, so an action never applies to rows the manager cannot see. (Tasks 7, 9)

---

## File structure

**Created**

- `packages/catalogue/drizzle/00NN_drop_labels.sql` (generated) — drops `product_labels`, `labels`.
- `packages/catalogue/drizzle/00NN_drop_category_image_triggers.sql` (custom) — drops media's four
  `category_details_media_image_fk_*` triggers before the column drop.
- `packages/catalogue/drizzle/00NN_drop_category_image_color.sql` (generated) — drops
  `category_details.image` and `.color`.
- `packages/media/drizzle/0004_drop_category_image_triggers.sql` (custom) — drops the same four
  triggers again, because media `0001` re-creates them on a fresh database.
- `packages/catalogue/src/catalogue-items.ts` + `.test.ts` + `.db.test.ts` — move and delete a
  selection of products and folders; count what a folder holds.
- `apps/dashboard/src/widgets/catalogue-browser.ts` + `.test.ts` + `.a11y.test.ts` — the file
  browser: breadcrumb, view toggle, search, selection mode, action bar, folder form, move and delete
  dialogs, drag and drop.

**Deleted**

- `packages/catalogue/src/labels.ts`, `labels.test.ts`, `schema/labels.ts`
- `apps/dashboard/src/screens/labels-panel.ts` (+ its two tests)
- `apps/dashboard/src/screens/categories-screen.ts` (+ its tests)
- `apps/dashboard/src/widgets/category-manager.ts` (+ its tests), `color-field.ts` stays (sections
  use it)

**Modified (main ones)** — each task lists its own exactly.

- `packages/shared/src/sale-line-classification.ts`, `packages/catalogue/src/sale-classification.ts`,
  `packages/reporting/src/category-sales.ts`, `apps/server/src/category-sales-page.ts`
- `packages/catalogue/src/categories.ts`, `apps/server/src/catalogue-api.ts`
- `packages/ui/src/components/wt-data-table.ts` — a `rowSelectable` predicate
- `apps/dashboard/src/widgets/product-list.ts`, `product-editor.ts`, `category-form.ts`,
  `screens/catalogue-screen.ts`, `dashboard-app.ts`, `navigation.ts`, `api/client.ts`,
  `i18n/strings.ts`

---

### Task 1: Sale lines and the category report stop carrying labels

The recorded classification becomes `{ reporting }` only, and the category report loses its label
totals. Rows already stored in `sale_lines.classification` (an append-only table) may still carry a
`"labels"` key; readers simply ignore it — the JSON has no SQL constraint.

**Files:**
- Modify: `packages/shared/src/sale-line-classification.ts:1-11`
- Modify: `packages/catalogue/src/sale-classification.ts` (label parts: imports :9-14, `LoadedClassification.labels` and `products[].labelIds` :20-30, the label query in `loadClassification` :47-57 and :67-69, `classifyLine` :82 and :103, `validateSnapshot` :111 and :125-128)
- Modify: `packages/catalogue/src/current-classifications.ts` (type only)
- Modify: `packages/reporting/src/category-sales.ts` (`LabelTotal` :49-55, `CategoryReport.labels` :60, the label map and tally :289-346), `packages/reporting/src/index.ts:18`
- Modify: `apps/server/src/category-sales-page.ts` (strings :39-40, :58-60, :79-81; `labelRows` :130-138; use at :174-179)
- Modify: `apps/dashboard/src/api/client.ts` (`LabelTotalDto`, `CategorySalesDto.labels` :968-979), `apps/dashboard/src/screens/dashboard-sales-screen.ts` (import :23, CSS `tr.label-row` :182, :540, `#renderLabels` :584-606)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`sales.labels_title`, `sales.label`, `sales.labels_overlap`, English :1404-1407 and Spanish :3351-3354)
- Modify (comments that describe labels): `packages/core/src/sale-line.ts:49`,
  `apps/server/src/issuance-pass.ts:11`, `packages/db/src/schema/orders.ts:177` — cut the label
  wording (prefer deleting to rewording)
- Tests: `packages/catalogue/src/sale-classification.test.ts`, `current-classifications.test.ts`; `packages/reporting/src/category-sales.test.ts`, `category-sales-current.test.ts`, `test/category-fixtures.ts`; `packages/core/src/record-sale.test.ts:1183-1185,1287`, `sale-line-rows.test.ts:147`; `apps/server/src/report-api.categories.test.ts`, `category-sales-page.test.ts`, `issuance-pass.test.ts`, `issuance-pass.fiscal-identity.test.ts`, `working-order.test.ts:2816-2828`; `apps/dashboard/src/screens/dashboard-sales-screen*.test.ts`

**Interfaces:**
- Produces: `type SaleLineClassification = { reporting: ClassificationEntry[] }`;
  `CategoryReport` without `labels`; `classifyLine(...)` returns `{ reporting }`.

- [ ] **Step 1: Write the failing tests**

In `packages/catalogue/src/sale-classification.test.ts`, replace the label assertions with an exact
shape check on a product that HAS a category (so the test fails while labels are still produced):

```ts
it("records the reporting chain and nothing else", async () => {
  const loaded = await loadClassification(tx, [productId], "en");
  expect(classifyLine(loaded, productId)).toEqual({
    reporting: [
      { id: drinks.id, name: "Drinks" },
      { id: beer.id, name: "Beer" },
    ],
  });
});
```

In `packages/reporting/src/category-sales.test.ts`, replace the label-totals block (:427-501) with:

```ts
it("reports no label totals, and ignores a stored line that still carries labels", () => {
  const report = categorySales([
    line({ classification: { reporting: [{ id: "c1", name: "Drinks" }], labels: [{ id: "l1", name: "Alcoholic" }] } as never }),
  ]);
  expect(report).not.toHaveProperty("labels");
  expect(report.categories.map((c) => c.name)).toEqual(["Drinks"]);
});
```

(Use the file's existing `line(...)` fixture helper and report function names — read the top of the
test file; the names above stand for them.)

In `apps/server/src/category-sales-page.test.ts`, assert the printed page contains no "Labels" /
"Etiquetas" heading.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/sale-classification.test.ts`
Run: `pnpm --filter @waitron/reporting exec vitest run src/category-sales.test.ts`
Expected: FAIL — `labels: []` is still in the classification and the report.

- [ ] **Step 3: Remove labels from the classification and the report**

`packages/shared/src/sale-line-classification.ts`:

```ts
export interface ClassificationEntry {
  id: string;
  name: string;
}
/** What a sale line is reported under: its category and each category above it, root first. */
export interface SaleLineClassification {
  reporting: ClassificationEntry[];
}
```

In `sale-classification.ts` delete every label import, field, query and check listed above;
`classifyLine` returns `{ reporting }` and `validateSnapshot` checks only `reporting`. In
`category-sales.ts` delete `LabelTotal`, `CategoryReport.labels`, the `labels` map and its tally
loop and output. In `category-sales-page.ts` delete the label strings, `labelRows` and its use. In
the dashboard delete `LabelTotalDto`, `CategorySalesDto.labels`, `#renderLabels`, its call, the
`tr.label-row` rule and the three `sales.label*` strings in both languages.

- [ ] **Step 4: Fix the remaining tests and run them**

Update every test file listed above to the new shape (remove `labels: [...]` from fixtures and
expectations; delete tests that only exercised label totals). Then:

Run: `pnpm --filter @waitron/catalogue --filter @waitron/reporting --filter @waitron/core exec vitest run`
Run: `pnpm --filter @waitron/server exec vitest run src/report-api.categories.test.ts src/category-sales-page.test.ts src/issuance-pass.test.ts src/issuance-pass.fiscal-identity.test.ts src/working-order.test.ts`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/dashboard-sales-screen`
Run: `pnpm -r --filter @waitron/shared --filter @waitron/catalogue --filter @waitron/reporting --filter @waitron/server --filter @waitron/dashboard typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages/shared packages/catalogue packages/reporting packages/core apps/server apps/dashboard
git commit -s -m "Sale lines and the category report no longer carry labels"
```

---

### Task 2: Labels leave the product editor, the product list and every API

Labels are removed from code in every package in one task, because the product editor's saved
value is a contract between the dashboard and the server: the server will REFUSE a body that still
carries `labelIds` (the house rule for retired fields, as `categoryIds` is refused today at
`packages/catalogue/src/product-editor-input.ts:138-139`). The tables stay until Task 3.

**Files:**
- Delete: `packages/catalogue/src/labels.ts`, `packages/catalogue/src/labels.test.ts`,
  `apps/dashboard/src/screens/labels-panel.ts`, `labels-panel.test.ts`, `labels-panel.a11y.test.ts`
- Modify (catalogue): `src/index.ts:20`; `src/errors.ts:21-26` (`label.invalid`,
  `label.name_taken`, `label.not_found`; the comment on `sale_classification.invalid`);
  `src/variant-fallback.ts:4,13,124-131` (`labelOwnerJoin`); `src/operations.ts` (`labelIds` in
  `listProducts`/`listedVariantsOfProducts`: :13,16,63,241,247,924-1009); `src/categories.ts:6,8,11`
  and `CategoryProduct.labelIds` / `listCategoryProducts` (:307-330); `src/product-editor.ts`
  (:9,10,23,43,54,83,194 — `setProductLabels` in the save); `src/product-editor-input.ts:140-142,201`;
  `src/product-types.ts:79-80,98-99,167-168,196`
- Modify (server): `apps/server/src/catalogue-api.ts` (imports :22-27, `requireLabelName` :130-136,
  statuses :246-248, the six label routes :1166-1225)
- Modify (dashboard): `api/client.ts` (`CategoryProduct.labelIds` :298, `Label`/`LabelSummary`
  :300-306, six methods :1755-1772); `api/live-queries.ts` — remove `labels` and `product_labels`
  from EVERY entry's dependencies, including `getCategorySales` (:96-97), and the `listLabels` and
  `getProductLabels` entries (:134-143). The server builds its allowed live-update names from the
  table classification (`packages/catalogue/src/classification.ts:40`), so once Task 3 drops the
  tables a leftover name is refused and closes the tab's whole live stream (CLAUDE.md §3); update
  `api/live-queries.test.ts` to match; `i18n/codes.ts:114-125`; `i18n/strings.ts` (`labels.*`, English :108,
  :115-129, Spanish :2049, :2056-2070; `editor.classification` becomes "Category" / "Categoría";
  delete `categories.combobox_selected` in both languages, only `labelsField` used it);
  `screens/categories-screen.ts` (Labels tab :44,190-194,894-905; imports and state
  :22,33-34,147,230-232; products-table labels column :553-554,586-594); `screens/catalogue-screen.ts`
  (:16,99,193-195,606,638,784-785); `widgets/classification-fields.ts` (delete `LabelsFieldOptions`,
  `labelsField`, `labelsText`, :57-108); `widgets/product-editor.ts`
  (:27,38,101,164,185,373,532,785,815-830); `widgets/product-list.ts` (:11,18,89,135-146,210-216)
- Modify (seed): `apps/server/scripts/demo-seed/seed-catalogue.ts:12,19,199-212`
- Modify (docs): `docs/developers/products.md:439-454` (the labels picker and `labelIds`)
- Tests: every test file the labels map named (packages/catalogue 12, apps/server
  `catalogue-api.test.ts` label blocks — hits from :2719 on are OPTION labels and stay — and
  `configuration-transfer.test.ts:49,284-291,453-476`, `scripts/demo-seed/seed-catalogue.test.ts`,
  apps/dashboard 27). Find them with:
  `grep -rln "labelIds\|LabelSummary\|listLabels\|labelsField\|labels-panel\|productLabels" packages apps --include='*.ts' | grep -v option`

**Interfaces:**
- Produces: `Product` and `ProductEditorInput` without `labelIds`; the product-editor parser
  refuses a body carrying `labelIds` with `product.invalid` (or the parser's existing `invalid(...)`
  helper) naming `labelIds`; no `/management-api/labels` or `/management-api/products/:id/labels`
  route.

- [ ] **Step 1: Write the failing tests**

In `packages/catalogue/src/product-editor-input.test.ts` replace the label cases (:201-229) with:

```ts
it("refuses a body that still carries labelIds, rather than dropping them", () => {
  expect(() => parseProductEditorInput({ ...validBody(), labelIds: [] }, config)).toThrow(
    expect.objectContaining({ code: "product.invalid", params: { field: "labelIds" } }),
  );
});
```

(Use the file's own body builder and parser names; read how the `categoryIds` refusal is tested in
the same file and copy that case's shape and code exactly — the code is whatever `invalid(...)`
throws there.)

In `apps/server/src/catalogue-api.test.ts` add:

```ts
it("has no labels routes", async () => {
  const res = await app.request("/management-api/labels", { headers: managerHeaders });
  expect(res.status).toBe(404);
});
```

In `apps/dashboard/src/widgets/product-list.test.ts` add an assertion that no column keyed
`labels` is rendered (`table.shadowRoot!.querySelector('th[data-column="labels"]')` is null — use
the selector the file already uses for column headers).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/product-editor-input.test.ts`
Run: `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts -t "no labels routes"`
Expected: FAIL.

- [ ] **Step 3: Remove labels from code**

In `product-editor-input.ts`, replace :140-142 with the refusal, next to the `categoryIds` one:

```ts
  // A body still carrying labels is refused rather than having them silently dropped.
  if (body.labelIds !== undefined) invalid("labelIds");
```

and delete `labelIds` from the returned object (:201). Delete everything else listed under Files.
Delete the three `label.*` codes from `packages/catalogue/src/errors.ts`, their statuses in
`catalogue-api.ts`, and their messages in `apps/dashboard/src/i18n/codes.ts`. In the product
editor, the classification section keeps only the category field; its heading string
`editor.classification` becomes "Category" (en) / "Categoría" (es).

- [ ] **Step 4: Make every suite pass**

Update the tests named under Files. Then:

Run: `pnpm --filter @waitron/catalogue --filter @waitron/server exec vitest run`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets src/screens/catalogue-screen src/screens/categories-screen src/api src/i18n`
Run: `pnpm -r --filter @waitron/catalogue --filter @waitron/server --filter @waitron/dashboard typecheck`
Run: `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/live-subscriptions.test.ts`
Expected: PASS. Then
`grep -rn "LabelSummary\|labelsField\|listLabels\|productLabels" packages apps --include='*.ts'`
prints nothing, and `grep -rn "labelIds" packages apps --include='*.ts' | grep -iv option` prints
only options-list lines (an options list has its own `labelIds`, e.g.
`apps/server/src/working-order.test.ts:2646`, `apps/till/src/state/working-order.test.ts:701` —
read each remaining hit and leave the options ones).

- [ ] **Step 5: Commit**

```bash
git add -A packages/catalogue apps/server apps/dashboard
git commit -s -m "Labels are removed from the product editor, the product list and the management API"
```

---

### Task 3: The labels tables are dropped

**Files:**
- Delete: `packages/catalogue/src/schema/labels.ts`; its export at `src/schema/index.ts:7`
- Create (generated): `packages/catalogue/drizzle/00NN_drop_labels.sql` + snapshot + journal entry
- Modify: `packages/catalogue/src/classification.ts:8-9`; `src/configuration-transfer.ts:5-6`
- Modify: `scripts/schema-constraints.test.ts:151-152`; `scripts/catalogue-engine-neutral.test.ts:24,29,46`;
  `packages/catalogue/src/migrations.test.ts:28,50-51,161,201-202,284,536-556`
- Modify: `packages/fiscal-verifactu/src/privileges.expected.ts` only if it names the tables (grep)

- [ ] **Step 1: Write the failing test**

In `packages/catalogue/src/migrations.test.ts` add:

```ts
it("leaves no labels tables", async () => {
  const { rows } = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name in ('labels', 'product_labels')`,
  );
  expect(rows).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/migrations.test.ts -t "no labels tables"`
Expected: FAIL — both tables exist.

- [ ] **Step 3: Drop the tables**

Delete `schema/labels.ts` and its export, the two `classify(...)` entries and the two transfer
entries. Then generate:

```bash
pnpm --filter @waitron/catalogue db:generate --name drop_labels
```

Expected: a new `packages/catalogue/drizzle/00NN_drop_labels.sql` containing exactly
`DROP TABLE \`product_labels\`;` and `DROP TABLE \`labels\`;` (drizzle orders them; neither table
is referenced from outside, so there is no rebuild). Read the file; if it contains anything else,
stop and report it.

- [ ] **Step 4: Run the guards and the package**

Run: `pnpm --filter @waitron/catalogue exec vitest run`
Run: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/catalogue-engine-neutral.test.ts scripts/two-file-foreign-keys.test.ts scripts/live-subscriptions.test.ts`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts`
Run: `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A packages/catalogue scripts packages/fiscal-verifactu
git commit -s -m "The labels and product_labels tables are dropped"
```

---

### Task 4: A category's name is one plain string

`categories.name` is declared `json` today; it becomes `label` (plain text). Both are TEXT in
SQLite, so drizzle generates NO migration — `migrations-match-schema` accepts "No schema changes".
Stored JSON rows are cleared by the dev reset (Global Constraints).

**Files:**
- Modify: `packages/db/src/schema/catalogue.ts:27` (`name: json<Record<string,string>>("name")` →
  `name: label("name")`)
- Modify (catalogue): `src/categories.ts` (`Category.name`, `CategoryInput.name` :19,25;
  `createCategory`/`updateCategory` drop `validateContentTranslations` :115,:135 and the
  `fallbackLanguage` parameter; `CategoryDependants.children[].name` :202); `src/content-languages.ts:93,108`
  (delete the `'category'` branch of the translation-gap query — it would `JSON.parse` a plain
  string and throw); `src/sale-classification.ts:98` (use `category.name` directly; drop the
  language parameter from `loadClassification` if nothing else in it uses it — follow every caller);
  `src/current-classifications.ts:17-19`; `src/operations.ts:384,405,425-428,1259-1260,1311-1318`;
  `src/menu-document.ts:345,394,494-497`
- Modify (server): `apps/server/src/catalogue-api.ts:152-162` (`categoryInput` name check; drop the
  `deps.venueLocale` argument to create/update); `apps/server/src/working-order.ts:575-582`
- Modify (media): `packages/media/src/images.ts:47,181-186` (`ImageUsage` category `names` →
  `name: string`), `src/dashboard/client.ts:16`, `src/dashboard/image-library.ts:212-218`
  (this category usage disappears entirely in Task 5; make it compile here)
- Modify (venue-service): `src/dashboard/client.ts:85,117`; `src/dashboard/venue-operations-screen.ts:394-396,745,1040`
- Modify (dashboard): `api/client.ts:267-286` (`CategorySummary.name`, `CategoryInput.name`,
  `CategoryDependants.children[].name` → `string`); `widgets/category-form.ts` (`categoryPath`
  :34-44 becomes `categoryPath(category, categories): string`; ONE name input replacing the per-language
  inputs :153-154, :254-265; submit sends `name: string` :213; the `content.translation_required`
  mapping :87-94 goes); every `categoryPath` caller (`product-list.ts:131`,
  `classification-fields.ts:36`, `section-add-products.ts:161`, `product-editor.ts:632`,
  `menu-prices-table.ts:257-260,361-363,375`); `screens/categories-screen.ts` (`#text` :250-251 and
  its uses); `screens/catalogue-screen.ts:532`
- Delete: `apps/dashboard/src/widgets/category-manager.ts` and its tests — no screen mounts it,
  and it reads `category.name` as translations (:67-69), so it would otherwise fail the typecheck;
  also delete the assertion of its absence at `apps/dashboard/src/screens/catalogue-screen.test.ts:241`
- Modify (seed): `apps/server/scripts/demo-seed/menu.ts:48-55` (keep the translated names — the
  seed also names SECTIONS from them), `seed-catalogue.ts:112` (`createCategory(tx, { name: cat.name.en })`),
  `allergens-demo.ts:153-154`, `seed-catalogue.test.ts:170` (`c.name` instead of `c.name->>'en'`)
- Modify (docs): `docs/developers/products.md` — the translation-gap report no longer lists
  categories

**Interfaces:**
- Produces: `Category { id: string; name: string; image: string | null; color: string | null; parentId: string | null }`
  (image/colour go in Task 5); `CategoryInput { name: string; image?; color?; parentId? }`;
  `createCategory(tx, input)`, `updateCategory(tx, id, patch)` (no language argument);
  dashboard `categoryPath(category: CategorySummary, categories: readonly CategorySummary[]): string`.
- Name rule: trimmed, non-empty. The route refuses a non-string with
  `management.request_invalid {field:"name"}` (shape); `createCategory`/`updateCategory` trim and
  refuse a blank with a NEW code `category.invalid {field:"name"}`, following the package's
  `<concept>.invalid` siblings (`product.invalid`, `menu_section.invalid`,
  `packages/catalogue/src/errors.ts`). Register it in `errors.ts`, give it 400 in the route's status
  map, add its English and Spanish message in `apps/dashboard/src/i18n/codes.ts`, and map it to the
  name field in `category-form.ts`'s refusal mapping.

- [ ] **Step 1: Write the failing tests**

`packages/catalogue/src/categories.db.test.ts` (use the file's existing database setup):

```ts
it("stores a category's name as one trimmed string", async () => {
  const created = await createCategory(tx, { name: "  Drinks  " });
  expect(created.name).toBe("Drinks");
  expect((await readCategory(tx, created.id)).name).toBe("Drinks");
});

it("refuses a blank category name", async () => {
  await expect(createCategory(tx, { name: "   " })).rejects.toMatchObject({
    code: "category.invalid",
    params: { field: "name" },
  });
});
```

`apps/server/src/catalogue-api.test.ts`:

```ts
it("refuses a translated-object category name", async () => {
  const res = await post("/management-api/categories", { name: { en: "Drinks" } });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ code: "management.request_invalid", params: { field: "name" } });
});
```

`apps/dashboard/src/widgets/category-form.test.ts`: the form renders exactly one name input
(`wt-input[name="name"]`) whatever content languages are enabled, and submits
`{ name: "Drinks", parentId: null }` (plus image/colour until Task 5).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/categories.db.test.ts`
Expected: FAIL — the name is still a Record.

- [ ] **Step 3: Implement**

Make the changes listed under Files. In `categories.ts`:

```ts
function categoryName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") throw new AppError("category.invalid", { field: "name" });
  return trimmed;
}
```

called by `createCategory` (always) and `updateCategory` (when `patch.name !== undefined`). In the
route's `categoryInput`, the name check becomes `typeof body.name !== "string"` → refuse.

- [ ] **Step 4: Run everything that reads a category name**

Run: `pnpm --filter @waitron/catalogue --filter @waitron/media --filter @waitron/venue-service --filter @waitron/server exec vitest run`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets src/screens/categories-screen src/screens/catalogue-screen src/screens/menus-screen`
Run: `pnpm exec vitest run scripts/migrations-match-schema.test.ts`
Run: `pnpm -r typecheck`  (a shared type changed; the whole workspace is the honest scope)
Expected: PASS; `db:generate` would report no changes (do not run it).

- [ ] **Step 5: Commit**

```bash
git add -A packages apps docs/developers/products.md
git commit -s -m "A category's name is one plain internal name, not a set of translations"
```

---

### Task 5: Categories lose their image and colour

Superseded 2026-10-05 by W92
(`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): a category has an optional
colour again, which products inherit.

Order matters on an existing venue (measured by the research for this plan on SQLite 3.53.4:
`ALTER TABLE … DROP COLUMN image` fails while any trigger names the column, and a dangling trigger
then blocks every later DROP COLUMN or RENAME). Catalogue migrates before media
(`packages/media/src/module.ts:30` `requires` catalogue), so catalogue itself must drop media's
triggers first.

**Files:**
- Create (custom): `packages/catalogue/drizzle/00NN_drop_category_image_triggers.sql`
- Create (generated): `packages/catalogue/drizzle/00NN_drop_category_image_color.sql`
- Create (custom): `packages/media/drizzle/0004_drop_category_image_triggers.sql`
- Modify: `packages/catalogue/src/schema/categories.ts:9-10` (delete `image`, `color`)
- Modify: `packages/catalogue/src/categories.ts` (types :20-21,26-27, columns :40-41,
  `validateImage` :85-88, `validateColor` :106-109, writes :119-126,138-153). KEEP `isHexColor` and
  `mediaImageExists` — `src/sections.ts:5,83` imports both; move them into `sections.ts` (their
  only remaining user) and update its import.
- Modify: `packages/catalogue/src/errors.ts:12,14` (delete `category.color_invalid`,
  `category.image_not_found`); `apps/server/src/catalogue-api.ts:164-175,244`;
  `apps/dashboard/src/i18n/codes.ts` (their messages)
- Modify: `packages/media/src/images.ts:181-186,603-607` (no `category` usage kind);
  `packages/media/src/module.ts:19-20` (`before:` list drops `category_details`);
  `packages/media/src/dashboard/client.ts`, `image-library.ts:212-218`
- Modify (dashboard): `api/client.ts` (`CategorySummary`, `CategoryInput` lose `image`, `color`);
  `widgets/category-form.ts` (:11-13 imports, :70-71,75-76, :141-142, :156-157, :180-181, :215-216,
  :292-318 — the form keeps Name and Parent only); `screens/categories-screen.ts:9,440-443,452-460,481`
  (swatch, thumbnail, coloured lozenge)
- Modify (docs): `docs/developers/design-system.md:129` ("a category's colour, so far");
  `docs/backlog.md` — close the entry "A category's colour is stored but shown nowhere" with a dated
  note that the colour is removed
- Modify (guards/tests): `scripts/behavioural-triggers.test.ts:87,95-98` (remove the four names);
  `packages/media/src/image-references.test.ts:120-123,181-283`;
  `packages/catalogue/src/migrations.test.ts:49,159,182-183,274`; `category-form.test.ts:339-391,791-796`;
  `catalogue-screen.test.ts:635`

- [ ] **Step 1: Write the failing tests**

`packages/catalogue/src/migrations.test.ts`:

```ts
it("gives category_details no image or colour column and no trigger naming it", async () => {
  const cols = await db.execute<{ name: string }>(sql`select name from pragma_table_info('category_details')`);
  expect(cols.rows.map((c) => c.name).sort()).toEqual(["category_id", "parent_id"]);
  const triggers = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'trigger' and name like 'category_details_media_image_fk_%'`,
  );
  expect(triggers.rows).toEqual([]);
});
```

This must be run with the MEDIA set applied too (that is where the triggers come from): use the
same `useVenueDb` sets `packages/media/src/image-references.test.ts` uses, or put this case in that
media test file instead.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/media exec vitest run src/image-references.test.ts`
Expected: FAIL — the columns and four triggers exist.

- [ ] **Step 3: Write the migrations, in this order**

```bash
pnpm --filter @waitron/catalogue db:generate:custom --name drop_category_image_triggers
```

Fill it with:

```sql
-- media's four triggers name category_details.image, and SQLite refuses to drop the column while
-- they exist. Catalogue migrates before media, so they go here, first. IF EXISTS: on a fresh
-- database catalogue migrates before media has created them.
DROP TRIGGER IF EXISTS category_details_media_image_fk_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS category_details_media_image_fk_parent_rename;
```

(Check `packages/db/drizzle/0043_drop_triggers_before_rebuild.sql` for the exact breakpoint
syntax this repo's custom migrations use, and copy it.) Then delete the two columns from
`schema/categories.ts` and:

```bash
pnpm --filter @waitron/catalogue db:generate --name drop_category_image_color
```

Expected: two `ALTER TABLE \`category_details\` DROP COLUMN` statements and nothing else (no
`__new_` rebuild — neither column has a key, check or index). If drizzle proposes a rebuild, stop:
a rebuild's `DROP TABLE` would empty `category_details` of every row that cascades (CLAUDE.md §3).

```bash
pnpm --filter @waitron/media db:generate:custom --name drop_category_image_triggers
```

with the same four `DROP TRIGGER IF EXISTS` lines: on a FRESH database media `0001` creates the
triggers after the column is already gone (SQLite allows that), and they must not linger — a
dangling trigger blocks later column drops anywhere.

- [ ] **Step 4: Remove the code, then run**

Make the code changes listed under Files. Then:

Run: `pnpm --filter @waitron/catalogue --filter @waitron/media --filter @waitron/server exec vitest run`
Run: `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts scripts/module-graph-honesty.test.ts scripts/errors-reachable.test.ts`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/category-form src/screens/categories-screen src/screens/catalogue-screen`
Expected: PASS. `migration-upgrade` is the one that proves the ORDER on a database migrated step by
step; if it fails with "no such column" in a trigger, the catalogue custom migration is missing or
ordered after the column drop.

- [ ] **Step 5: Commit**

```bash
git add -A packages/catalogue packages/media apps scripts docs/developers/design-system.md docs/backlog.md
git commit -s -m "Categories lose their image and colour; the image library's category triggers go first"
```

---

### Task 6: Move and delete a selection of products and folders

Two catalogue operations and their routes back the file browser. Both take ONE selection of
top-level products and folders and run in the one transaction the route opens.

**Files:**
- Create: `packages/catalogue/src/catalogue-items.ts`, `catalogue-items.db.test.ts`
- Modify: `packages/catalogue/src/index.ts` (export it); `packages/catalogue/src/categories.ts`
  (export `tablePresent` and `validateParent` — both private today)
- Modify: `apps/server/src/catalogue-api.ts` (three routes, one status);
  `apps/server/src/catalogue-api.test.ts`; `apps/server/src/catalogue-api.full-manifest.test.ts`
  (the only server suite that migrates venue-service's `preparation_routes`, per its header)
- Modify: `apps/dashboard/src/api/client.ts` (three methods + types), `api/client.test.ts`

**Interfaces:**
- Produces (catalogue):

```ts
export interface CatalogueSelection {
  productIds: string[]; // top-level products only (never a variant)
  categoryIds: string[];
}
/** What a deleted folder's contents do: go up to its parent, or go with it (products switched off). */
export type FolderContents = "move_up" | "delete";
export interface FolderSummary {
  id: string;
  folders: number; // folders below it, at any depth
  products: number; // top-level products in it or below it, Active or not
  routes: number; // preparation routes naming it or a folder below it
}
export async function moveCatalogueItems(tx: Transaction, selection: CatalogueSelection, to: string | null): Promise<void>;
export async function deleteCatalogueItems(tx: Transaction, selection: CatalogueSelection, contents: FolderContents): Promise<void>;
export async function summariseFolders(tx: Transaction, categoryIds: string[]): Promise<FolderSummary[]>;
```

- Produces (routes; "catalogue" in this codebase means a MENU, so the routes are named for folders):
  - `POST /management-api/folders/move` body `{ productIds: string[], categoryIds: string[], to: string | null }` → 204
  - `POST /management-api/folders/delete` body `{ productIds: string[], categoryIds: string[], contents: "move_up" | "delete" }` → 204
  - `GET /management-api/folders/summary?id=<uuid>&id=<uuid>` → `FolderSummary[]` in the order asked
- Produces (dashboard client):

```ts
moveCatalogueItems(selection: CatalogueSelection, to: string | null): Promise<void>;
deleteCatalogueItems(selection: CatalogueSelection, contents: FolderContents): Promise<void>;
summariseFolders(categoryIds: string[]): Promise<FolderSummary[]>;
```

- Refusals:
  - a body of the wrong shape → `management.request_invalid` naming the field; a malformed id →
    `shared.invalid_id`, through the route file's existing `idList` helper
    (`apps/server/src/catalogue-api.ts:218`); a repeated id → `management.request_invalid` naming
    the list;
  - an unknown or variant product id → `product.not_found {productId}`;
  - an unknown folder id or target → `category.not_found {categoryId}`;
  - a folder moved into itself or below itself → `category.parent_cycle`, answered **409**: the
    request is well formed and the stored tree refuses it, as the sibling `menu_section.member_cycle`
    is answered.
  A refusal changes nothing: every id is checked before the first write, and the route's one
  transaction rolls back anyway.

**Rules the code must hold:**
- The folder tree is read ONCE (`listCategories`), and depths and subtrees are worked out in memory;
  no per-level read.
- Move: products get `category_id = to`; folders get `parent_id = to` (upsert the
  `category_details` row, as `updateCategory` does). Each folder's new chain is checked with the
  existing `validateParent(tx, id, to)`, which throws `category.parent_cycle` for a target that is
  the folder itself or below it.
- Delete, products: each is switched off with the existing `deactivateProduct`
  (`packages/catalogue/src/operations.ts:1096`); it stays in its folder.
- Delete with `move_up`: selected folders DEEPEST FIRST, each with `deleteCategory(tx, id)`, whose
  default sends its products and subfolders to its parent. So a selected child's contents reach
  the grandparent once its selected parent goes too.
- Delete with `delete`: selected folders SHALLOWEST FIRST. For each one still present (a selected
  folder inside an earlier-processed selected folder is already gone — skip it): every product row
  whose `category_id` is in its subtree is moved to the folder's parent (variants with their own
  category included, so no foreign key is left pointing at a deleted folder), every top-level one
  among them is switched off, then the subtree's folders are deleted deepest first with
  `deleteCategory` (which also deletes preparation routes naming each one).

- [ ] **Step 1: Write the failing tests** (`packages/catalogue/src/catalogue-items.db.test.ts`)

Use the database setup `packages/catalogue/src/categories.db.test.ts` uses (`useVenueDb` with the
catalogue sets) and its product-creation helper. Build this tree in `beforeEach`:

```
Drinks (d) ── Beer (b) ── [lager]
         └── [cola]
Food (f)  ── [burger]
```

```ts
describe("moveCatalogueItems", () => {
  it("moves products and folders together, into a folder or to the top level", async () => {
    await moveCatalogueItems(tx, { productIds: [burger], categoryIds: [b] }, f);
    expect((await readProduct(tx, burger)).primaryCategoryId).toBe(f);
    expect((await readCategory(tx, b)).parentId).toBe(f);
    await moveCatalogueItems(tx, { productIds: [burger], categoryIds: [b] }, null);
    expect((await readProduct(tx, burger)).primaryCategoryId).toBeNull();
    expect((await readCategory(tx, b)).parentId).toBeNull();
  });

  it("refuses to move a folder into itself or below itself, and changes nothing", async () => {
    await expect(moveCatalogueItems(tx, { productIds: [cola], categoryIds: [d] }, b)).rejects.toMatchObject({
      code: "category.parent_cycle",
    });
    await expect(moveCatalogueItems(tx, { productIds: [], categoryIds: [d] }, d)).rejects.toMatchObject({
      code: "category.parent_cycle",
    });
    expect((await readProduct(tx, cola)).primaryCategoryId).toBe(d);
    expect((await readCategory(tx, d)).parentId).toBeNull();
  });

  it("refuses a variant or unknown product id and an unknown target", async () => {
    await expect(moveCatalogueItems(tx, { productIds: [lagerVariant], categoryIds: [] }, f)).rejects.toMatchObject({
      code: "product.not_found",
    });
    await expect(moveCatalogueItems(tx, { productIds: [cola], categoryIds: [] }, crypto.randomUUID())).rejects.toMatchObject({
      code: "category.not_found",
    });
  });
});

describe("deleteCatalogueItems", () => {
  it("switches selected products off and leaves them where they are", async () => {
    await deleteCatalogueItems(tx, { productIds: [cola], categoryIds: [] }, "move_up");
    const product = await readProduct(tx, cola);
    expect(product.active).toBe(false);
    expect(product.primaryCategoryId).toBe(d);
  });

  it("move_up: a deleted folder's products and subfolders go to its parent", async () => {
    await deleteCatalogueItems(tx, { productIds: [], categoryIds: [d] }, "move_up");
    expect((await readProduct(tx, cola)).primaryCategoryId).toBeNull();
    expect((await readCategory(tx, b)).parentId).toBeNull();
    await expect(readCategory(tx, d)).rejects.toMatchObject({ code: "category.not_found" });
  });

  it("move_up: a selected folder and its selected child both go, contents to the grandparent", async () => {
    await deleteCatalogueItems(tx, { productIds: [], categoryIds: [d, b] }, "move_up");
    expect((await readProduct(tx, lager)).primaryCategoryId).toBeNull();
    expect((await readProduct(tx, lager)).active).toBe(true);
  });

  it("delete: everything inside goes, products switched off and moved to the folder's parent", async () => {
    await deleteCatalogueItems(tx, { productIds: [], categoryIds: [d] }, "delete");
    for (const id of [d, b])
      await expect(readCategory(tx, id)).rejects.toMatchObject({ code: "category.not_found" });
    for (const id of [cola, lager]) {
      const product = await readProduct(tx, id);
      expect(product.active).toBe(false);
      expect(product.primaryCategoryId).toBeNull();
    }
    expect((await readProduct(tx, burger)).active).toBe(true);
  });

  it("delete: a selected folder inside another selected folder is skipped, not refused", async () => {
    await deleteCatalogueItems(tx, { productIds: [], categoryIds: [b, d] }, "delete");
    await expect(readCategory(tx, d)).rejects.toMatchObject({ code: "category.not_found" });
    const product = await readProduct(tx, lager);
    expect(product.active).toBe(false);
    expect(product.primaryCategoryId).toBeNull();
  });

  it("delete: a variant with its own category inside the subtree follows it to the parent", async () => {
    await setMainReportingCategory(tx, lagerVariant, b, "any");
    await deleteCatalogueItems(tx, { productIds: [], categoryIds: [b] }, "delete");
    expect((await readVariantCategory(tx, lagerVariant))).toBe(d); // b's parent, not null
  });

  it("checks every id before changing anything", async () => {
    await expect(
      deleteCatalogueItems(tx, { productIds: [cola], categoryIds: [crypto.randomUUID()] }, "delete"),
    ).rejects.toMatchObject({ code: "category.not_found" });
    expect((await readProduct(tx, cola)).active).toBe(true);
  });
});

describe("summariseFolders", () => {
  it("counts folders and products at any depth, in the order asked", async () => {
    expect(await summariseFolders(tx, [f, d])).toEqual([
      { id: f, folders: 0, products: 1, routes: 0 },
      { id: d, folders: 1, products: 2, routes: 0 },
    ]);
  });
});
```

(`readProduct` and `readVariantCategory` stand for however the file reads one product's `active`
and main category, and one variant row's own `category_id` — read `categories.db.test.ts` and
`variants.db.test.ts` for the helpers they use. The "checks every id" case runs in a transaction the
TEST owns, so it proves the operation validates before writing — stronger than relying on the
route's rollback.)

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/catalogue-items.db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/catalogue/src/catalogue-items.ts`**

```ts
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { and, inArray, sql } from "drizzle-orm";
import { batches } from "./batches.js";
import { categoryDetails } from "./schema/categories.js";
import {
  deleteCategory,
  listCategories,
  tablePresent,
  validateParent,
  type Category,
} from "./categories.js";
import { deactivateProduct } from "./operations.js";
import { isTopLevelProduct } from "./variant-fallback.js";
import "./errors.js";

export interface CatalogueSelection {
  productIds: string[];
  categoryIds: string[];
}
export type FolderContents = "move_up" | "delete";
export interface FolderSummary {
  id: string;
  folders: number;
  products: number;
  routes: number;
}

/** The folder tree, read once: each folder's parent, depth and whole subtree. */
class FolderTree {
  readonly #parent = new Map<string, string | null>();
  constructor(folders: readonly Category[]) {
    for (const { id, parentId } of folders) this.#parent.set(id, parentId);
  }
  require(id: string): void {
    if (!this.#parent.has(id)) throw new AppError("category.not_found", { categoryId: id });
  }
  parent(id: string): string | null {
    return this.#parent.get(id) ?? null;
  }
  depth(id: string): number {
    let n = 0;
    const seen = new Set([id]);
    for (let at = this.parent(id); at !== null && !seen.has(at); at = this.parent(at)) {
      seen.add(at);
      n++;
    }
    return n;
  }
  /** `id` and every folder below it. */
  subtree(id: string): string[] {
    const found = [id];
    for (let i = 0; i < found.length; i++)
      for (const [child, parent] of this.#parent) if (parent === found[i]) found.push(child);
    return found;
  }
  byDepth(ids: readonly string[], order: "deepest" | "shallowest"): string[] {
    const sign = order === "deepest" ? -1 : 1;
    return [...ids].sort((a, b) => sign * (this.depth(a) - this.depth(b)));
  }
}

async function requireTopLevelProducts(tx: Transaction, ids: readonly string[]): Promise<void> {
  const found = new Set<string>();
  for (const batch of batches([...ids]))
    for (const row of await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, batch), isTopLevelProduct)))
      found.add(row.id);
  const missing = ids.find((id) => !found.has(id));
  if (missing !== undefined) throw new AppError("product.not_found", { productId: missing });
}

async function readTree(tx: Transaction, selection: CatalogueSelection): Promise<FolderTree> {
  await requireTopLevelProducts(tx, selection.productIds);
  const tree = new FolderTree(await listCategories(tx));
  for (const id of selection.categoryIds) tree.require(id);
  return tree;
}

export async function moveCatalogueItems(
  tx: Transaction,
  selection: CatalogueSelection,
  to: string | null,
): Promise<void> {
  const tree = await readTree(tx, selection);
  if (to !== null) tree.require(to);
  for (const id of selection.categoryIds) await validateParent(tx, id, to);
  for (const batch of batches(selection.productIds))
    await tx.update(products).set({ categoryId: to, updatedAt: now() }).where(inArray(products.id, batch));
  for (const id of selection.categoryIds)
    await tx
      .insert(categoryDetails)
      .values({ categoryId: id, parentId: to })
      .onConflictDoUpdate({ target: categoryDetails.categoryId, set: { parentId: to } });
}

export async function deleteCatalogueItems(
  tx: Transaction,
  selection: CatalogueSelection,
  contents: FolderContents,
): Promise<void> {
  const tree = await readTree(tx, selection);
  for (const id of selection.productIds) await deactivateProduct(tx, id);
  if (contents === "move_up") {
    for (const id of tree.byDepth(selection.categoryIds, "deepest")) await deleteCategory(tx, id);
    return;
  }
  const gone = new Set<string>();
  for (const id of tree.byDepth(selection.categoryIds, "shallowest")) {
    if (gone.has(id)) continue; // inside a selected folder already deleted with its contents
    const parent = tree.parent(id);
    const subtree = tree.subtree(id);
    for (const batch of batches(subtree)) {
      const inside = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.categoryId, batch), isTopLevelProduct));
      for (const product of inside) await deactivateProduct(tx, product.id);
      await tx
        .update(products)
        .set({ categoryId: parent, updatedAt: now() })
        .where(inArray(products.categoryId, batch));
    }
    for (const folder of tree.byDepth(subtree, "deepest")) {
      await deleteCategory(tx, folder);
      gone.add(folder);
    }
  }
}

export async function summariseFolders(
  tx: Transaction,
  categoryIds: string[],
): Promise<FolderSummary[]> {
  const tree = new FolderTree(await listCategories(tx));
  for (const id of categoryIds) tree.require(id);
  const routesPresent = await tablePresent(tx, "preparation_routes");
  const summaries: FolderSummary[] = [];
  for (const id of categoryIds) {
    const subtree = tree.subtree(id);
    let productCount = 0;
    let routeCount = 0;
    for (const batch of batches(subtree)) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(products)
        .where(and(inArray(products.categoryId, batch), isTopLevelProduct));
      productCount += Number(row!.n);
      if (routesPresent) {
        const routes = await tx.execute<{ n: number }>(
          sql`select count(*) as n from preparation_routes where category_id in (${sql.join(
            batch.map((folder) => sql`${folder}`),
            sql`, `,
          )})`,
        );
        routeCount += Number(routes.rows[0]!.n);
      }
    }
    summaries.push({ id, folders: subtree.length - 1, products: productCount, routes: routeCount });
  }
  return summaries;
}
```

Export `tablePresent` and `validateParent` from `categories.ts` (they are private today), and add
`export * from "./catalogue-items.js"` to `index.ts`. `requireTopLevelProducts` reports WHICH id is
missing, which `allTopLevelProducts` (a boolean) cannot; Task 11 deletes `allTopLevelProducts` if
nothing else calls it by then.

- [ ] **Step 4: Routes**

In `apps/server/src/catalogue-api.ts`, beside the category routes:

```ts
function selectionBody(body: Record<string, unknown>): CatalogueSelection {
  const ids = (field: "productIds" | "categoryIds", kind: string): string[] => {
    const list = idList(body[field], field, kind);
    if (new Set(list).size !== list.length)
      throw new AppError("management.request_invalid", { field });
    return list;
  };
  return { productIds: ids("productIds", "ProductId"), categoryIds: ids("categoryIds", "CategoryId") };
}

app.post("/management-api/folders/move", (c) =>
  run(c, log, async () => {
    const session = requireManagementSession(c);
    const body = await readJsonBody<Record<string, unknown>>(c);
    const selection = selectionBody(body);
    const to = nullOrUuid(body.to, "to");
    await gated(session, (tx) => moveCatalogueItems(tx, selection, to));
    return c.body(null, 204);
  }),
);
app.post("/management-api/folders/delete", (c) =>
  run(c, log, async () => {
    const session = requireManagementSession(c);
    const body = await readJsonBody<Record<string, unknown>>(c);
    const selection = selectionBody(body);
    if (body.contents !== "move_up" && body.contents !== "delete")
      throw new AppError("management.request_invalid", { field: "contents" });
    const contents: FolderContents = body.contents;
    await gated(session, (tx) => deleteCatalogueItems(tx, selection, contents));
    return c.body(null, 204);
  }),
);
app.get("/management-api/folders/summary", (c) =>
  run(c, log, async () => {
    const session = requireManagementSession(c);
    const ids = (c.req.queries("id") ?? []).map((id) => requireUuidParam(id, "CategoryId"));
    return c.json(await gated(session, (tx) => summariseFolders(tx, ids)));
  }),
);
```

`nullOrUuid(undefined, "to")` refuses (`catalogue-api.ts:138-142`), so an absent `to` is never read
as "top level". Add `"category.parent_cycle": 409` to the route file's `STATUS` map.

Route tests in `catalogue-api.test.ts`: one success per route; `to` absent → 400
`management.request_invalid {field:"to"}`; a repeated product id → 400 naming `productIds`; a
malformed id → 400 `shared.invalid_id`; `contents: "archive"` → 400 naming `contents`;
`category.parent_cycle` → 409; and a refused move leaves the product where it was (read it back
through `GET /management-api/products`).

In `catalogue-api.full-manifest.test.ts` (it migrates venue-service, so `preparation_routes`
exists): create Drinks › Beer, a preparation route naming Beer (use the helper that suite's existing
routing cases use), then assert `GET /management-api/folders/summary?id=<Drinks>` reports
`routes: 1`, and that `POST /management-api/folders/delete` with `contents: "delete"` leaves no
preparation route naming Beer.

- [ ] **Step 5: Dashboard client**

In `apps/dashboard/src/api/client.ts`, beside the category methods, add the three types (copy them
from the Interfaces block) and three methods calling the three routes, using the private request
helpers the neighbouring category methods (:1711-1745) use; the query string for the summary is
`categoryIds.map((id) => `id=${encodeURIComponent(id)}`).join("&")`. Add a `client.test.ts` case per
method asserting method, path and body, as the file's category cases do.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @waitron/catalogue exec vitest run src/catalogue-items.db.test.ts src/categories.db.test.ts`
Run: `pnpm --filter @waitron/server exec vitest run src/catalogue-api.test.ts src/catalogue-api.full-manifest.test.ts`
Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts`
Run: `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts`
Expected: PASS.

```bash
git add -A packages/catalogue apps/server apps/dashboard/src/api
git commit -s -m "Products and folders can be moved or deleted together in one step"
```

---

### Task 7: `wt-data-table` can leave some rows unselectable, and reports filter changes

Variant rows must not get a checkbox: a variant moves and is deleted with its product. And a screen
holding a selection must hear when the table's own filters change, so it can clear a selection that
now includes hidden rows (Review Focus 5).

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` (property block :336-342, `#toggleAll`
  :587-595, header "select all" :762-790, `#renderSelectCell` :843-856)
- Test: `packages/ui/src/components/wt-data-table.test.ts` (the file that holds its selection
  cases — grep `selectable`)
- Modify: `docs/developers/design-system.md` (the `wt-data-table` row, :269)

**Interfaces:**
- Produces: `@property({ attribute: false }) rowSelectable: (row: Row) => boolean = () => true;` —
  an unselectable row renders an EMPTY select cell (so columns stay aligned), is skipped by "select
  all" and by the header box's all/some state, and its key is never emitted.
- Produces: event `wt-filter-change`, `detail: { filters: Record<string, string> }`, dispatched
  `bubbles: true, composed: true` when the manager changes a filter select (the `@change` handler
  at `wt-data-table.ts:890-898`) — not when filters are restored from storage.

- [ ] **Step 1: Write the failing test**

```ts
it("gives an unselectable row no checkbox and leaves it out of select-all", async () => {
  const el = await mountTable({
    selectable: true,
    rows: [{ id: "a" }, { id: "b" }],
    rowSelectable: (row: { id: string }) => row.id !== "b",
  });
  expect(el.shadowRoot!.querySelector('[data-test="select-a"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="select-b"]')).toBeNull();
  const events: string[][] = [];
  el.addEventListener("wt-selection-change", (e) => events.push((e as CustomEvent).detail.selected));
  el.shadowRoot!.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.click();
  expect(events.at(-1)).toEqual(["a"]);
  el.selected = ["a"];
  await el.updateComplete;
  // Every SELECTABLE row is picked, so the header box reads fully checked, not "some".
  const header = el.shadowRoot!.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
  expect(header.checked).toBe(true);
  expect(header.indeterminate).toBe(false);
});

it("reports a filter the manager changes", async () => {
  const el = await mountTable({ rows: [{ id: "a", kind: "x" }], columns: [filteredColumn()] });
  const seen: unknown[] = [];
  el.addEventListener("wt-filter-change", (e) => seen.push((e as CustomEvent).detail));
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="kind"]')!;
  select.value = "x";
  select.dispatchEvent(new Event("change"));
  expect(seen).toEqual([{ filters: { kind: "x" } }]);
});
```

(`filteredColumn()` is a column keyed `kind` with a filter offering `x`; copy an existing filter
case's column.)

(`mountTable` stands for the helper the existing selection tests use; read them first.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t unselectable`
Expected: FAIL — row b has a checkbox.

- [ ] **Step 3: Implement**

Add the property and, in the filter select's `@change` handler after `#persistView()`, dispatch
`wt-filter-change` with `{ filters: { ...this.filterSelections } }`. In `#renderSelectCell`, when
`!this.rowSelectable(row)` return
`html`<td class="select" role=${isTree ? "gridcell" : nothing}></td>``. Where the visible keys for
select-all are computed (the caller of `#toggleAll` and the header's all/some state), filter the
rows through `rowSelectable` before taking their keys.

- [ ] **Step 4: Run the package's selection tests and a11y**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table`
Expected: PASS. Add to design-system.md's `wt-data-table` row: "`rowSelectable` leaves a row
without a checkbox (a product list's variant rows, which move with their product);
`wt-filter-change` reports a filter the manager changed."

- [ ] **Step 5: Commit**

```bash
git add packages/ui docs/developers/design-system.md
git commit -s -m "A data table can leave some rows without a selection box, and reports filter changes"
```

---

### Task 8: The Products screen browses folders

**Files:**
- Create: `apps/dashboard/src/widgets/catalogue-browser.ts`, `catalogue-browser.test.ts`,
  `catalogue-browser.a11y.test.ts`
- Modify: `apps/dashboard/src/widgets/product-list.ts` (folder rows, optional path column; its own
  search box goes — the browser, its only user (`catalogue-screen.ts:603`), owns the one search)
- Modify: `apps/dashboard/src/icons.ts` — add a `folder` icon to `DASHBOARD_ICONS` (the dashboard
  registers none today; the till's `menu-section` icon, `apps/till/src/widgets/menu-browser.ts:19`,
  shows the shape, and `wt-icon` lives in `packages/ui-core/src/components/wt-icon.ts`)
- Modify: `apps/dashboard/src/widgets/product-editor.ts` (`newCategoryId` for a new product)
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts` (renders the browser; owns the address)
- Modify: `apps/dashboard/src/navigation.ts:8` (`catalogue: { view: "view", product: "product", folder: "folder" }`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (new `folders.*` strings, both languages)
- Tests: `product-list.test.ts`, `product-editor.test.ts`, `catalogue-screen.test.ts`

**Interfaces:**
- `dashboard-product-list` gains:
  - `@property folders: CategorySummary[] = []` — folder rows shown before the product rows;
  - `@property showPath = true` — the category-path column ("reporting-category") is included only
    when true;
  - no search box of its own: `searchable` is removed from its `wt-data-table` — the browser has
    already filtered the rows it passes;
  - row keys: a folder row is `folder:<id>`, a product row `<productId>`, a variant row
    `<productId>:<variantId>` (unchanged);
  - events (bubbling, composed, `detail` as shown): `open-folder {folderId}`,
    `rename-folder {folderId}`, `delete-folder {folderId}` besides the existing product events.
- `dashboard-catalogue-browser` properties: `api: DashboardApi`, `products: Product[]`,
  `categories: CategorySummary[]`, `extraLists`, `optionLists`, `folderId: string | null`,
  `view: "folders" | "all"`. Events: `open-folder {folderId: string | null}`,
  `view-change {view}`, and it lets the product list's product events bubble through unchanged.
- `dashboard-product-editor` gains `@property newCategoryId: string | null = null`, used as the
  new draft's `primaryCategoryId` when `value` is null.

**Behaviour (the tests pin each):**
- Folder view, no search: rows = the folders whose `parentId === folderId`, then the products whose
  `primaryCategoryId === folderId` (with their variants). No path column. A folder id the category
  list does not contain is treated as the top level.
- Breadcrumb above the table: "All products" (the top level) › each ancestor › the current folder
  (`aria-current="location"`), built with `categoryAncestors`. Copy the markup and CSS of the menus
  screen's breadcrumb (`apps/dashboard/src/screens/menus-screen.ts:249-268,1720-1741`).
- View toggle: two `aria-pressed` buttons, "Folders" / "All products", as the categories screen
  does today (`categories-screen.ts:738-753`). All-products view: rows = every product, no folder
  rows, path column shown, no breadcrumb.
- One search box, owned by the browser, in both views. With text: rows = every folder whose name
  or path contains it, and every product whose name, a variant's name, or path contains it
  (case-insensitive, `toLocaleLowerCase(currentLocale())`); path column shown; breadcrumb hidden.
  Clearing it returns to the folder the manager was in.
- A folder row: name cell = `<wt-icon name="folder">` (added to `DASHBOARD_ICONS` above) plus a
  ghost `wt-button` with the folder's name that emits `open-folder`; price, modifiers,
  ordering, status and allergens cells empty; actions = Rename, Delete.
- The Status and Ordering filters never hide a folder: a folder row's filter value is EVERY option
  value (the table accepts an array: `held.includes(selected)`, `wt-data-table.ts:666-668`).
- Folders sort before products on the name column ascending: `sortValue` is `"a" + name` for a
  folder and `"b" + name` for a product. Letters, not digits: the table sorts with
  `numeric: true` (`wt-data-table.ts:632-635`), so a digit prefix runs into a name that starts with
  a number ("05 Star" sorts after "1Bread"). Descending puts folders after products; accepted.
- "New folder" button in the browser toolbar opens `dashboard-category-form` with the parent set to
  the current folder; Rename opens it with the folder's value; save calls
  `createCategory`/`updateCategory` and closes on success (a failed refresh afterwards is a load
  failure, not a failed save — CLAUDE.md §3).
- The screen's "Add product" opens the editor with `newCategoryId` = the current folder in folder
  view, `null` in all-products view.
- Address: a PATH, not a query string — `packages/ui/src/url-state.ts:45-62` reads path segments
  by the labels in `navigation.ts`: `/manage/catalogue/folder/<id>` and
  `/manage/catalogue/view/all`. The screen reads both with its `UrlStateController` and writes them
  when the browser emits `open-folder` (push) and `view-change` (replace).

- [ ] **Step 1: Write the failing tests** (`catalogue-browser.test.ts`)

Mount with the file-local fixture pattern of `categories-screen.test.ts:59-76` (`vi.fn()` API cast
to `DashboardApi`). Fixtures, defined once at the top of the file and reused by Tasks 9 and 10:
a builder `folder(id, name, parentId): CategorySummary`, the list `CATEGORIES` = Drinks (`d`) ›
Beer (`b`), Food (`f`); and `PRODUCTS` = Cola (in `d`, Active), Lager (in `b`, Inactive), Burger
(in `f`), Bread (no folder). `mountBrowser(overrides)` mounts with those defaults, a stub API, and
any property overridden.

```ts
it("shows the top level: its folders first, then products with no folder", async () => {
  const el = await mountBrowser({ folderId: null });
  expect(rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
});

it("opens a folder and shows its breadcrumb", async () => {
  const el = await mountBrowser({ folderId: "b" });
  expect(rowKeys(el)).toEqual([]); // Lager is Inactive and the Status filter starts on Active
  const crumbs = [...el.shadowRoot!.querySelectorAll("nav.breadcrumb li")].map((li) => li.textContent!.trim());
  expect(crumbs).toEqual(["All products", "Drinks", "Beer"]);
});

it("never hides a folder, whatever the Status and Ordering filters say", async () => {
  const el = await mountBrowser({ folderId: "d" });
  expect(rowKeys(el)).toEqual(["folder:b", "cola"]);
  await chooseFilter(el, "active", "inactive"); // Cola is Active: it goes, the folder stays
  expect(rowKeys(el)).toEqual(["folder:b"]);
  await chooseFilter(el, "ordering", "staff_only"); // no fixture product is staff-only
  expect(rowKeys(el)).toEqual(["folder:b"]);
});

it("sorts folders before products even when a folder's name starts with a number", async () => {
  const el = await mountBrowser({ folderId: null, categories: [...CATEGORIES, folder("s", "5 Star", null)] });
  expect(rowKeys(el)).toEqual(["folder:s", "folder:d", "folder:f", "bread"]);
});

it("treats a folder that no longer exists as the top level", async () => {
  const el = await mountBrowser({ folderId: crypto.randomUUID() });
  expect(rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
  expect(breadcrumbText(el)).toEqual(["All products"]);
});

it("searches every folder and shows each result's path", async () => {
  const el = await mountBrowser({ folderId: "f" });
  await typeSearch(el, "col");
  expect(rowKeys(el)).toEqual(["cola"]);
  expect(pathCell(el, "cola")).toBe("Drinks");
  await typeSearch(el, "");
  expect(rowKeys(el)).toEqual(["burger"]);
});

it("lists every product with its path in the all-products view", async () => {
  const el = await mountBrowser({ folderId: null, view: "all" });
  expect(rowKeys(el).sort()).toEqual(["bread", "burger", "cola"]); // Lager: Inactive
});

it("asks to open a folder when its name is pressed", async () => {
  const el = await mountBrowser({ folderId: null });
  const opened = listen(el, "open-folder");
  folderButton(el, "d").click();
  expect(opened()).toEqual({ folderId: "d" });
});
```

(`rowKeys` reads `tr[data-row-key]` from the product list's inner `wt-data-table` shadow root, in
order; write it and the other small helpers at the top of the file.)

(`chooseFilter(el, columnKey, value)` sets the table's `select[data-filter=<key>]` and dispatches
`change`; use an Ordering value that exists in `PRODUCT_ORDERINGS` and that no fixture has.)

In `product-editor.test.ts`: a new product opened with `newCategoryId: "d"` submits
`primaryCategoryId: "d"`. In `catalogue-screen.test.ts`: the address `/manage/catalogue/folder/d`
reaches the browser as `folderId: "d"`; the browser's `open-folder {folderId: "b"}` writes
`/manage/catalogue/folder/b`. Copy how the file already drives `/manage/catalogue/product/<id>`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser.test.ts`
Expected: FAIL — element not defined.

- [ ] **Step 3: Extend `product-list.ts`**

Change the row type to a union and teach each column the folder case:

```ts
type ListRow =
  | { kind: "folder"; key: string; parentKey: null; folder: CategorySummary }
  | { kind: "product"; key: string; parentKey: string | null; product: Product; variant: Product["variants"][number] | null };
```

- `#rows()` returns `this.folders.map((folder) => ({ kind: "folder", key: `folder:${folder.id}`, parentKey: null, folder }))`
  followed by today's product rows (tagged `kind: "product"`).
- Name column: for a folder, `html`<span part="folder-cell"><wt-icon name="folder"></wt-icon><wt-button variant="ghost" data-test=${`open-${folder.id}`} @click=${(e: Event) => this.#emitFolder(e, "open-folder", folder.id)}>${folder.name}</wt-button></span>``;
  `sortValue` `"a" + folder.name` / `"b" + name`; `searchValue` the name.
- The path column is pushed only when `this.showPath`; for a folder it shows the PARENT's path.
- Every other column returns `nothing` (cell) and `""` (search/sort) for a folder; the two filters'
  `value` return all option values for a folder.
- Actions for a folder: Rename (`rename-folder`) and Delete (`delete-folder`), same `wt-row-actions`
  markup as products.
- `render()`: drop `searchable`, `searchLabel` and `noMatchesMessage` from the `wt-data-table`;
  everything else unchanged.
- Add `::part(folder-cell)` styles (flex, gap `--wt-space-2`, like `product-cell`).

`#emitFolder` mirrors `#emit` with `detail: { folderId }`.

- [ ] **Step 4: Write `catalogue-browser.ts`**

```ts
@customElement("dashboard-catalogue-browser")
export class CatalogueBrowser extends LitElement {
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) folderId: string | null = null;
  @property() view: "folders" | "all" = "folders";
  @state() private search = "";
  @state() private folderForm: { value: CategorySummary | null } | null = null;
  @state() private formBusy = false;
  @state() private formError: unknown = null;

  /** The folder being shown: an id the category list lacks is the top level. */
  get #current(): string | null {
    return this.categories.some(({ id }) => id === this.folderId) ? this.folderId : null;
  }

  #visible(): { folders: CategorySummary[]; products: Product[]; showPath: boolean } {
    const query = this.search.trim().toLocaleLowerCase(currentLocale());
    const path = (c: CategorySummary) => categoryPath(c, this.categories);
    const productPath = (p: Product) => {
      const folder = this.categories.find(({ id }) => id === p.primaryCategoryId);
      return folder ? path(folder) : "";
    };
    if (query !== "") {
      const hit = (text: string) => text.toLocaleLowerCase(currentLocale()).includes(query);
      return {
        folders: this.categories.filter((c) => hit(path(c))),
        products: this.products.filter(
          (p) => hit(p.name) || p.variants.some((v) => hit(v.name)) || hit(productPath(p)),
        ),
        showPath: true,
      };
    }
    if (this.view === "all") return { folders: [], products: this.products, showPath: true };
    const here = this.#current;
    return {
      folders: this.categories.filter(({ parentId }) => parentId === here),
      products: this.products.filter(({ primaryCategoryId }) => primaryCategoryId === here),
      showPath: false,
    };
  }
  // render(): toolbar (breadcrumb when view is "folders" and search is empty; view toggle; a
  // wt-input type="search" bound to `search`; "New folder" button), then
  // <dashboard-product-list .folders .products .showPath ...> with open-folder,
  // rename-folder and delete-folder handled here, then <dashboard-category-form> for the folder
  // form. delete-folder is wired in Task 9 (it opens the delete dialog).
}
```

Emit `open-folder` (from the breadcrumb and the list's `open-folder`, re-dispatched after
`stopPropagation`) and `view-change` as `new CustomEvent(name, { detail, bubbles: true, composed: true })`.
The folder form: `<dashboard-category-form .open=${this.folderForm !== null} .value=${...} .categories=${this.categories} .defaultParentId=${this.#current} ...>`
— read `category-form.ts`'s properties after Tasks 4-5 and add a `defaultParentId` property if it
has none (a new folder's parent). On `wt-submit`: `formBusy = true`, call
`this.api.createCategory(value)` or `updateCategory(id, value)`; on success close the form; the
category list refreshes through the screen's live query. On refusal keep it open and pass the
refusal to the form (as the catalogue screen does for its nested category form).

New strings (en / es): `folders.all_products` "All products" / "Todos los productos";
`folders.view_folders` "Folders" / "Carpetas"; `folders.view_all` "All products" / "Todos los
productos"; `folders.search` "Search products and folders" / "Buscar productos y carpetas";
`folders.new` "New folder" / "Nueva carpeta"; `folders.rename` "Rename" / "Cambiar nombre";
`folders.breadcrumb` "Folder path" / "Ruta de carpetas"; `folders.open_named` "Open {name}" /
"Abrir {name}".

- [ ] **Step 5: Wire the screen and the editor**

In `catalogue-screen.ts` replace `<dashboard-product-list ...>` (:602-622) with
`<dashboard-catalogue-browser .api .products .categories .extraLists .optionLists .folderId=${this.folderId} .view=${this.view} @open-folder=... @view-change=...>`
keeping the three product event handlers exactly as they are. Add `@state() folderId` and `view`,
read in the `UrlStateController` callback (:150-159) with `this.#url.read("folder")` and
`this.#url.read("view") === "all" ? "all" : "folders"`; write with
`this.#url.write({ folder: id }, false)` (push) and `this.#url.write({ view }, true)` (replace; the
second argument `true` means replace). `#openCreate` sets
`this.newCategoryId = this.view === "folders" ? this.folderId : null`, passed to the editor as
`.newCategoryId`. In `product-editor.ts:428`:
`this.draft = this.value ? structuredClone(this.value) : { ...emptyDraft(), primaryCategoryId: this.newCategoryId };`

- [ ] **Step 6: Accessibility test and run**

`catalogue-browser.a11y.test.ts`: `expectNoA11yViolations` in light and dark for (a) the top level,
(b) inside a folder with the breadcrumb, (c) a search with results, (d) the all-products view, (e)
the folder form open — copy `categories-screen.a11y.test.ts:10-45`'s shape.

Run: `memory_pressure | grep free` (headroom), then
`pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser src/widgets/product-list src/widgets/product-editor src/screens/catalogue-screen`
Expected: PASS. Open the screen and LOOK (CLAUDE.md §4): `wa-wt demo <worktree>`, visit
`/manage/catalogue`, both themes and phone width; screenshot top level, inside a folder, a search.

- [ ] **Step 7: Commit**

```bash
git add -A apps/dashboard
git commit -s -m "The Products screen browses folders, with a breadcrumb, an all-products view and one search"
```

---

### Task 9: Selection mode — move and delete several things at once

**Files:**
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts`, `product-list.ts`
- Tests: `catalogue-browser.test.ts`, `catalogue-browser.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Modify: `docs/developers/design-system.md` (a short "Selection mode" section)

**Interfaces:**
- `dashboard-product-list` gains `@property selecting = false`, `@property selected: string[] = []`
  and emits `wt-selection-change` through (it sets the table's `selectable`, `selected`,
  `rowSelectable=${(row: ListRow) => row.kind === "folder" || row.variant === null}`, and
  `selectionLabel` = the row's name).
- Consumes: Task 6's `moveCatalogueItems`, `deleteCatalogueItems`, `summariseFolders`; Task 7's
  `rowSelectable`.

**Behaviour:**
- A "Select" button in the browser toolbar turns selection mode on; the product list shows its
  checkboxes (not on variant rows). While on, an action bar replaces the toolbar's buttons:
  "{count} selected", "Move to…", "Delete", "Cancel". Move and Delete are disabled at 0 selected.
- Cancel, opening another folder, changing view, changing the search, or a `wt-filter-change`
  from the table (Task 7) CLEARS the selection (Review Focus 5). Selection mode itself stays on.
- Selected keys split into `{ productIds, categoryIds }` (`folder:` prefix → folder).
- **Move to…** opens a `wt-modal` with one REQUIRED `wt-combobox` of destinations (marked
  required, nothing preselected, Move disabled until one is chosen): "All products (top level)"
  plus every folder by path, EXCLUDING each selected folder and its descendants
  (`categoryWithDescendants`, Review Focus 1). Confirm calls `moveCatalogueItems`; success closes
  the dialog, clears the selection and leaves selection mode on. A refusal keeps the dialog open
  and shows the code's message at the bottom of the form.
- **Delete**:
  - **only empty folders selected** (every summary has `folders: 0` and `products: 0`): no dialog —
    `deleteCatalogueItems(selection, "move_up")` runs at once (spec §2.3: "An empty folder is
    deleted without asking"). The summary is still read first, to know they are empty; if it
    cannot be read, the dialog below opens showing the error.
  - otherwise a `wt-modal` opens.
  - products only: heading "Delete {count} products?" (singular form for one); body reuses the
    existing `product.delete_warning` wording in its plural form ("This makes the products
    inactive: the till stops selling them and they leave this list until you choose to show
    inactive products. You can restore them, and their past sales are kept."). Confirm →
    `deleteCatalogueItems(selection, "move_up")`.
  - any folder with contents: the summary read above shows (spinner while it loads; on failure the
    Delete button stays disabled and the error shows — as the categories screen's preview does,
    `categories-screen.ts:283-340`). A required radio group "What happens to what is inside?":
    - "Move it up to the parent folder" (`move_up`, preselected — the reversible choice);
    - "Delete it too: {folders} folders and {products} products (products become Inactive)"
      (`delete`).
    If any selected folder's summary has `routes > 0`, add: "{routes} kitchen routing rules name
    these folders and will be removed."
  - The danger button reads "Delete". Escape is blocked while busy. A refusal keeps it open with the
    message at the bottom.
- A folder row's own Delete action opens the same dialog with just that folder selected.

- [ ] **Step 1: Write the failing tests**

```ts
it("selects products and folders but never a variant", async () => {
  const el = await mountBrowser({ folderId: "d", products: withVariant(cola) });
  await pressSelect(el);
  expect(checkbox(el, "folder:b")).not.toBeNull();
  expect(checkbox(el, "cola")).not.toBeNull();
  expect(checkbox(el, "cola:v1")).toBeNull();
});

it("clears the selection when another folder is opened", async () => {
  const el = await mountBrowser({ folderId: "d" });
  await pressSelect(el);
  await tick(checkbox(el, "cola")!);
  el.folderId = "f";
  await el.updateComplete;
  expect(selectedCount(el)).toBe(0);
});

it("moves the selection, never offering a selected folder or its subfolders as the destination", async () => {
  const el = await mountBrowser({ folderId: null });
  await pressSelect(el);
  await tick(checkbox(el, "folder:d")!);
  await tick(checkbox(el, "bread")!);
  await pressAction(el, "move");
  expect(destinationLabels(el)).toEqual(["All products (top level)", "Food"]);
  await chooseDestination(el, "Food");
  await confirm(el);
  expect(el.api.moveCatalogueItems).toHaveBeenCalledWith({ productIds: ["bread"], categoryIds: ["d"] }, "f");
});

it("deletes empty folders without asking", async () => {
  const el = await mountBrowser({ folderId: null });
  el.api.summariseFolders.mockResolvedValue([{ id: "f", folders: 0, products: 0, routes: 0 }]);
  await pressSelect(el);
  await tick(checkbox(el, "folder:f")!);
  await pressAction(el, "delete");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith({ productIds: [], categoryIds: ["f"] }, "move_up"),
  );
  expect(openDialog(el)).toBeNull();
});

it("clears the selection when a table filter changes", async () => {
  const el = await mountBrowser({ folderId: "d" });
  await pressSelect(el);
  await tick(checkbox(el, "cola")!);
  await chooseFilter(el, "active", "inactive");
  expect(selectedCount(el)).toBe(0);
});

it("asks what happens to a folder's contents and sends the choice", async () => {
  const el = await mountBrowser({ folderId: null });
  el.api.summariseFolders.mockResolvedValue([{ id: "d", folders: 1, products: 2, routes: 1 }]);
  await pressSelect(el);
  await tick(checkbox(el, "folder:d")!);
  await pressAction(el, "delete");
  await vi.waitFor(() => expect(dialogText(el)).toContain("1 folder and 2 products"));
  expect(dialogText(el)).toContain("1 kitchen routing rule names");
  await chooseRadio(el, "delete");
  await confirm(el);
  expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith({ productIds: [], categoryIds: ["d"] }, "delete");
});

it("keeps Delete disabled when the folder summary cannot be read", async () => {
  const el = await mountBrowser({ folderId: null });
  el.api.summariseFolders.mockRejectedValue(new Error("network"));
  await pressSelect(el);
  await tick(checkbox(el, "folder:d")!);
  await pressAction(el, "delete");
  await vi.waitFor(() => expect(dialogAlert(el)).not.toBeNull());
  expect(dangerButton(el).disabled).toBe(true);
});

it("keeps the move dialog open and explains a refusal", async () => {
  const el = await mountBrowser({ folderId: null });
  el.api.moveCatalogueItems.mockRejectedValue(apiError("category.parent_cycle"));
  // select, move, confirm …
  await vi.waitFor(() => expect(dialogAlert(el)).not.toBeNull());
  expect(openDialog(el)).not.toBeNull();
});
```

(Write the small helpers at the top of the file; `apiError` builds the error object the client
throws — copy how `catalogue-screen.test.ts` fakes a refusal.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser.test.ts -t "select|move|delete"`
Expected: FAIL.

- [ ] **Step 3: Implement the selection, the action bar and the two dialogs** in
`catalogue-browser.ts` as described under Behaviour. Clear the selection in `willUpdate` when
`folderId`, `view` or `search` changed. Map a refusal to a message with `codeMessage(codeOf(error))`
(`apps/dashboard/src/i18n/codes.ts`), placed at the bottom of the dialog's form.

New strings (en / es): `folders.select` "Select" / "Seleccionar"; `folders.selected` "{count}
selected" / "{count} seleccionados" (`_one` "1 selected" / "1 seleccionado"); `folders.move` "Move to…" / "Mover a…"; `folders.move_heading`
"Move {count} items" / "Mover {count} elementos" (`_one` "Move 1 item" / "Mover 1 elemento"); `folders.destination` "Destination" / "Destino";
`folders.top_level` "All products (top level)" / "Todos los productos (nivel superior)";
`folders.cancel_selection` "Cancel" / "Cancelar". Every string with a count also gets a `_one`
form, the house pattern (`strings.ts:83,93,95,104`), chosen when the count is 1:
`folders.delete_products_heading` "Delete {count} products?" / "¿Eliminar {count} productos?", `_one`
"Delete 1 product?" / "¿Eliminar 1 producto?"; `folders.delete_products_body` "This makes the
products inactive: the till stops selling them and they leave this list until you choose to show
inactive products. You can restore them, and their past sales are kept." / "Esto desactiva los
productos: la caja deja de venderlos y salen de esta lista hasta que elijas mostrar los productos
inactivos. Puedes restaurarlos, y sus ventas anteriores se conservan." (with one product selected,
reuse `product.delete_warning` itself); `folders.delete_heading` "Delete {count} items?" /
"¿Eliminar {count} elementos?", `_one` "Delete 1 item?" / "¿Eliminar 1 elemento?";
`folders.contents_question` "What happens to what is inside?" / "¿Qué pasa con lo que contienen?";
`folders.contents_move_up` "Move it up to the parent folder" / "Subirlo a la carpeta superior";
`folders.contents_delete` "Delete it too: {folders} and {products} (products become inactive)" /
"Eliminarlo también: {folders} y {products} (los productos se desactivan)", where `{folders}` is
`folders.count` "{count} folders" / "{count} carpetas" (`_one` "1 folder" / "1 carpeta") and
`{products}` is `folders.product_count` "{count} products" / "{count} productos" (`_one` "1 product"
/ "1 producto"); `folders.routes_warning` "{count} kitchen routing rules name these folders and will
be removed." / "{count} reglas de envío a cocina nombran estas carpetas y se eliminarán.", `_one`
"1 kitchen routing rule names these folders and will be removed." / "1 regla de envío a cocina
nombra estas carpetas y se eliminará.";
`folders.summary_error` "What these folders hold could not be read, so they cannot be deleted
yet." / "No se pudo leer lo que contienen estas carpetas, así que aún no se pueden eliminar.".

- [ ] **Step 4: Design-system note, a11y, run**

Add to `docs/developers/design-system.md` a short "Selection mode" section: a list screen that acts
on several rows at once has a "Select" button; checkboxes appear only while selecting; an action
bar shows the count and the actions; navigating or searching clears the selection; destructive
actions confirm in a `wt-modal` with a `danger` button and keep the dialog open on refusal.

Extend `catalogue-browser.a11y.test.ts` with: selection mode on with two rows ticked; the move
dialog; the delete dialog with the contents question — both themes.

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser src/widgets/product-list`
Expected: PASS. Open the screen and look (both themes, phone width).

- [ ] **Step 5: Commit**

```bash
git add -A apps/dashboard docs/developers/design-system.md
git commit -s -m "Products and folders can be selected together, then moved or deleted in one step"
```

---

### Task 10: Drag products and folders onto a folder

Native HTML drag and drop, on a pointer device only; selection mode and "Move to…" remain the way
on a touch screen and from the keyboard (spec §2.2).

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts`, `catalogue-browser.ts`
- Tests: `product-list.test.ts`, `catalogue-browser.test.ts`

**Interfaces:**
- `dashboard-product-list` emits `drag-items {keys: string[]}` at `dragstart` (so the browser knows
  what is being dragged — a real browser does not let `dragover` read `dataTransfer` data), and
  `drop-items {keys: string[], folderId: string}` when rows are dropped on a folder row.
- The browser turns a drop (on a folder row or a breadcrumb crumb, where the top-level crumb means
  `null`) into `moveCatalogueItems(selectionOf(keys), folderId)`.

**Behaviour:**
- The name cell of every product and folder row carries `draggable="true"`; `dragstart` sets
  `event.dataTransfer.setData("application/x-waitron-items", JSON.stringify(keys))` where `keys` is
  the whole selection if the dragged row is selected, otherwise just that row. Variant rows are not
  draggable.
- A folder row's name cell and each breadcrumb crumb are drop targets. `dragover` calls
  `preventDefault()` (accepting the drop) ONLY when the target is not one of the dragged folders
  nor below one (`categoryWithDescendants` over the dragged folder ids). The accepting target shows
  `part="folder-cell drop-target"` (background `--wt-color-surface-lifted`), cleared on
  `dragleave`/`drop`.
- A drop on a refused target does nothing. A successful move clears the selection. A refusal from
  the server shows its message in the browser's alert line (`role="alert"`, bottom of the browser).

- [ ] **Step 1: Write the failing tests**

```ts
function drag(from: Element, to: Element): void {
  const data = new DataTransfer();
  from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: data }));
  to.dispatchEvent(new DragEvent("dragover", { bubbles: true, composed: true, cancelable: true, dataTransfer: data }));
  to.dispatchEvent(new DragEvent("drop", { bubbles: true, composed: true, cancelable: true, dataTransfer: data }));
}

it("moves a dragged product into the folder it is dropped on", async () => {
  const el = await mountBrowser({ folderId: null });
  drag(nameCell(el, "bread"), nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith({ productIds: ["bread"], categoryIds: [] }, "f"),
  );
});

it("drags the whole selection when a selected row is dragged", async () => {
  const el = await mountBrowser({ folderId: null });
  await pressSelect(el);
  await tick(checkbox(el, "bread")!);
  await tick(checkbox(el, "folder:d")!);
  drag(nameCell(el, "bread"), nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith({ productIds: ["bread"], categoryIds: ["d"] }, "f"),
  );
});

it("refuses a drop of a folder onto itself or its own subfolder", async () => {
  // A search for "drinks" shows Drinks (d), its subfolder Beer (b, path "Drinks / Beer") and an
  // unrelated top-level Soft drinks (s) together.
  const el = await mountBrowser({ folderId: null, categories: [...CATEGORIES, folder("s", "Soft drinks", null)] });
  await typeSearch(el, "drinks");
  const data = new DataTransfer();
  nameCell(el, "folder:d").dispatchEvent(
    new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: data }),
  );
  const over = (key: string) => {
    const event = new DragEvent("dragover", { bubbles: true, composed: true, cancelable: true, dataTransfer: data });
    nameCell(el, key).dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(over("folder:d")).toBe(false);
  expect(over("folder:b")).toBe(false);
  expect(over("folder:s")).toBe(true);
});

it("moves to the top level when dropped on the first breadcrumb", async () => {
  const el = await mountBrowser({ folderId: "d" });
  drag(nameCell(el, "cola"), crumb(el, 0));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith({ productIds: ["cola"], categoryIds: [] }, null),
  );
});
```

(Chromium keeps the `DataTransfer` data readable across events dispatched from script; if
`getData` returns "" in `dragover`, which browsers do for protected mode, keep the dragged keys in
a field of the list set at `dragstart` and read that instead — the tests above then still pin the
behaviour. `CATEGORIES` and `folder(id, name, parentId)` are the fixture list and builder
written for Task 8's tests.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser.test.ts -t "drag|drop"`
Expected: FAIL.

- [ ] **Step 3: Implement** as described under Behaviour. The product list keeps the dragged keys
in a private field set at `dragstart` (it judges its own folder rows as targets from it) and emits
`drag-items`; the browser keeps the same keys to judge the breadcrumb crumbs, and both clear them at
`dragend`. `dataTransfer.setData` is still called so the drag is a real one.

- [ ] **Step 4: Run and look**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/catalogue-browser src/widgets/product-list`
Expected: PASS. Try it by hand in the demo stack: drag a product onto a folder, a folder onto
another, a folder onto its own subfolder (nothing happens), a selection onto the top-level crumb.

- [ ] **Step 5: Commit**

```bash
git add -A apps/dashboard
git commit -s -m "Products and folders can be dragged onto a folder or a breadcrumb"
```

---

### Task 11: The Categories screen goes

**Files:**
- Delete: `apps/dashboard/src/screens/categories-screen.ts`, `categories-screen.test.ts`,
  `categories-screen.a11y.test.ts` (`category-manager.ts` went in Task 4)
- Modify: `apps/dashboard/src/dashboard-app.ts` (nav entry :161-170, screen id :95-96, render
  :1626-1635 for `categories`)
- Modify: `apps/dashboard/src/api/client.ts` — delete the methods only the Categories screen called:
  `deleteCategory`, `getCategoryDependants`, `listCategoryProducts`, `addProductsToCategory`,
  `setMainCategory`, `listLibraryProducts` (grep each for other callers first; keep any that has
  one) and their types (`CategoryDependants`, `CategoryReassignment`, `CategoryProduct`)
- Modify: `apps/server/src/catalogue-api.ts` — delete the routes left without a dashboard caller:
  `DELETE /management-api/categories/:id`, `GET …/:id/dependants`, `GET …/:id/products`,
  `POST …/:id/products`, `PUT /management-api/products/:id/categories`; and from
  `packages/catalogue/src/categories.ts` the functions only they used (`categoryDependants`,
  `listCategoryProducts`, `addProductsToCategory`, and `allTopLevelProducts` if nothing else calls
  it). KEEP `setMainReportingCategory` (the product editor's save uses it, `product-editor.ts:192`).
  SIMPLIFY `deleteCategory` to `deleteCategory(tx: Transaction, id: string): Promise<void>` — its
  contents always go to its parent, which is all Task 6 uses — deleting `CategoryReassignment`, the
  reassign branches (`categories.ts:167-181`) and their tests, and the code
  `category.reassign_invalid`. Delete `category.membership_invalid` if nothing raises it any more.
- Modify: `apps/server/src/catalogue-api.full-manifest.test.ts:161-219` ("category dependants and
  bulk add") — it drives routes this task deletes; delete the block, keeping Task 6's case
- Modify (docs): `docs/developers/design-system.md:302` and `:333`, which use the Categories screen
  as their example — point them at the Products screen's folder rows instead
- Modify: `apps/dashboard/src/i18n/strings.ts` — delete `categories.*` and `nav.categories` keys no
  file uses any more (grep each key; the category form and `categoryField` still use some)
- Modify: `apps/dashboard/src/api/live-queries.ts` — drop dependencies naming removed methods
- Modify docs: `docs/developers/product-categories.md` (rewrite to describe folders in the Products
  screen, the move/delete operations and their refusals; no labels); `docs/backlog.md` (the slice
  1 entry: landed, with the PR number; note any follow-up this plan left)
- Tests: `apps/server/src/catalogue-api.test.ts` (delete the removed routes' cases; add one case
  asserting each removed route answers 404); `packages/catalogue/src/categories*.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/dashboard/src/dashboard-app.test.ts` (or wherever the nav entries are asserted — grep
`nav.categories`):

```ts
it("has no Categories screen", async () => {
  const el = await mountApp();
  expect(navLabels(el)).not.toContain("Categories");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "no Categories"`
Expected: FAIL.

- [ ] **Step 3: Remove** everything listed under Files, grepping each symbol for other callers
before deleting it.

- [ ] **Step 4: Run the affected suites and guards**

Run: `pnpm --filter @waitron/catalogue --filter @waitron/server exec vitest run`
Run: `pnpm --filter @waitron/dashboard exec vitest run`
Run: `pnpm -r typecheck`
Run: `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/live-subscriptions.test.ts scripts/claude-md-pointers.test.ts`
Expected: PASS. `grep -rn "categories-screen\|category-manager\|labels-panel" apps packages` prints
nothing. (`scripts/claude-md-pointers.test.ts`: CLAUDE.md names no deleted file today; run it to
confirm.)

- [ ] **Step 5: Commit**

```bash
git add -A apps packages docs/developers/product-categories.md docs/developers/design-system.md docs/backlog.md
git commit -s -m "The Categories screen is retired: folders are managed on the Products screen"
```

---

## After the last task

Run `/finish-branch <worktree>` (review wave, PR, CI). The PR body says, in plain English: every
dev venue needs `wa-wt reset demo <name>` after this lands; slices 2 and 3 are separate.

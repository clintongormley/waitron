# A332 — "All products" gets a colour of its own: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The venue gets one default colour, edited from the "All products" row of the Products screen. It is the last step of the colour walk, so any product or category with no colour of its own and none above it takes it. The "All products" row draws a swatch in the same column as the categories', so the names line up.

**Architecture:** The default is a new nullable `default_color` column on the catalogue module's existing one-row `catalogue_settings` table (no tenant column; CLAUDE.md §3). The walk in `packages/catalogue/src/color-inheritance.ts` gains a required `fallback` parameter, and each of its four callers passes the stored default. The server freezes resolved colours into published menu versions (`readDishFacts`), so the till sees a changed default when a menu is next published, just as it sees a changed category colour today. The dashboard reads the default live.

**Tech stack:** TypeScript, drizzle-orm on SQLite (`node:sqlite`), Hono (apps/server), Lit (apps/dashboard), Vitest (browser mode in Chromium for the dashboard).

**Spec:** the A332 block in lane B's queue (owner, 2026-10-07 ~12:05), quoted here because it is the whole spec:

> "the All products doesn't have a color but isn't lined up with the categories below, so it looks weirdly inset. we could give it a color which acts as a default for the others, no?"
>
> **Change:** "All products" gets a venue-wide default colour, stored once for the venue (no tenant column: one row, in the catalogue module's own migration set; CLAUDE.md §3). It is the LAST step of the inheritance walk, so a category or product with no colour of its own, and none above it, takes it. That includes products in no category. The All products row draws its swatch in the same column as the categories', so the names line up, and it can be edited like a category's colour. With no default set, it draws an empty swatch (the existing `empty` look), so the row lines up either way.
>
> **Trace every consumer before changing the walk.** … A changed default must reach everything that resolves a colour, or be frozen where the design freezes it. State which in the PR.
>
> FULL review path: a migration plus a cross-package contract. … Test-first. LOOK at the Products screen, the category colour field and the till's tiles, EN/ES, both themes.

## Consumer map (traced 2026-10-08 on main 4e948af89)

The walk (`categoryColor`, `effectiveColor`) has exactly four callers outside tests:

| Caller | Where its categories come from | What the colour paints | After this change |
| --- | --- | --- | --- |
| `packages/catalogue/src/menu-document.ts:297` (`readDishFacts`, called from `buildMenuDocuments` :142) | `listCategories(tx)` | `FrozenOffer.color` in every built menu document → published versions → till tiles (`apps/till/src/widgets/menu-browser.ts:438`), and the dashboard's device-home preview and document tree | Reads the default in the same transaction. **Frozen** in a published version; the menu reads "changed" until republished (the status is a hash of the rebuilt document, `menu-publication.ts:188-217`) |
| `apps/dashboard/src/widgets/product-list.ts:1016` | `.categories` from catalogue-screen → catalogue-browser | product and variant swatches on the Products page | **Live**, from catalogue-screen's existing `getCatalogueSettings` watch |
| `apps/dashboard/src/widgets/product-editor.ts:1196` | `.categories` from catalogue-screen | the colour field's inherited hint | **Live**, same source |
| `apps/dashboard/src/widgets/menu-structure-table.ts:706` | `.categories` from menus-screen | product thumbnails in a menu's Structure tab | **Live**, from a new `getCatalogueSettings` watch in menus-screen |

Nothing else resolves a product or category colour: sections and include folders carry their own colour with no inheritance (`include-folder-presentation.ts:21`, `device-home.ts:68-75`), the till reads only the published document, and the product APIs return a product's own colour (a variant's parent's) never an inherited one (`variant-fallback.ts:107`). Category rows on the Products screen draw a category's OWN colour (`swatchChip(folder.color)`), not an inherited one; the All products row follows that: it draws the default itself.

## Global constraints

- No tenant column. The default lives in `catalogue_settings` (singleton row, id = 1).
- Generate the migration with `pnpm --filter @waitron/catalogue db:generate`; let drizzle-kit pick the number. Never hand-edit a snapshot or `_journal.json`. Never edit a shipped migration file.
- `catalogue_settings` is already classified `state` (`packages/catalogue/src/classification.ts:8`); no classification change. No new table, no core migration.
- A stored colour is lowercase `#rrggbb` (`isStoredColor`). Anything else is refused.
- Error codes: a refused default colour throws `category.invalid` with `{ field: "color" }`, the code a category colour refusal already throws (`categories.ts:75-79`), so the dashboard's existing `categoryRefusalErrors` shows it in the colour form. A wrong JSON type at the route is `management.request_invalid` `{ field: "color" }`, as `catalogue-api.ts:153-156` does. On import, `setup.request_invalid` `{ field: "catalogue_settings.default_color" }`. No new codes.
- Saving the VAT class must not touch the default colour, and saving the colour must not touch the VAT class.
- No backwards-compatibility or data-migration code (pre-production).
- Dashboard: every colour reads a `--wt-*` token; markup handed to `wt-data-table` as a cell is styled with `part=`, never a class.
- Test changes: this lane's "⚠ THE RULE" and the owner's 2026-10-05 decision. Existing test call sites of `categoryColor`/`effectiveColor` gain the new `null` argument (no assertion changes), and test stubs of `getCatalogueSettings` gain `defaultColor: null`; whole-shape pins of a `catalogue_settings` row gain `default_color: null`. Each goes under "Changed test checks" in the PR. The golden huella test and `inmutabilidad` are not touched.
- Every commit `git commit -s`.

## Review focus

1. **Saving one setting wipes the other.** Set a default colour, then save the VAT class (and the reverse): both must survive. Test in Task 1.
2. **A product whose category is gone, or that has none, or whose tree loops.** Each takes the default (end of the walk). Test in Task 2.
3. **Clearing the default.** Choosing "no colour" stores null; uncoloured products go back to no colour; menus read "changed". Tests in Tasks 1 and 2.
4. **A malformed colour** (`#ABCDEF`, `#abc`, `red`, `123`, `{}`) is refused at the domain (`category.invalid`) and the route (`management.request_invalid` for a non-string), and shown in the colour form. Tests in Tasks 1, 3 and 4.
5. **The till keeps a published menu's colours until republish.** A default change does not alter a published document; the menu's status reads `changed`. Test in Task 2.

---

### Task 1: Store the default colour

**Files:**
- Modify: `packages/catalogue/src/schema/settings.ts`
- Generate: `packages/catalogue/drizzle/00NN_*.sql` + `meta/` (drizzle-kit)
- Modify: `packages/catalogue/src/settings.ts`, `packages/catalogue/src/settings-types.ts`, `packages/catalogue/src/index.ts` (export the new function if the package exports by list)
- Modify: `packages/catalogue/src/configuration-transfer.ts:75-82`
- Test: `packages/catalogue/src/settings.test.ts`, `packages/catalogue/src/configuration-transfer.test.ts`, `apps/server/src/configuration-transfer.test.ts:745-775` (whole-row pins gain `default_color: null`)
- Stubs: every dashboard test stub of `getCatalogueSettings` (`git grep -n 'getCatalogueSettings' apps/dashboard/src`) gains `defaultColor: null`, because the type now requires it (adding what a stub lacks; list them for the PR). Assertions that pin a whole settings value (e.g. `catalogue-settings-panel*.test.ts` `toHaveBeenCalledExactlyOnceWith({ defaultProductVatClass })`) must stay as they are: the VAT panel still sends only the VAT class.

**Interfaces — produces:**
- `CatalogueSettings` = `{ defaultProductVatClass: VatClass; defaultColor: string | null }`
- `readCatalogueSettings(tx): Promise<CatalogueSettings>` — fallback when no row: `{ defaultProductVatClass: "general", defaultColor: null }`
- `saveCatalogueDefaultColor(tx: Transaction, color: unknown): Promise<CatalogueSettings>` — refuses with `category.invalid {field:"color"}`; upserts only `default_color`; returns the whole settings after the write.
- `saveCatalogueSettings` keeps its input `{ defaultProductVatClass: unknown }`, updates ONLY the VAT column on conflict, and returns the whole settings (read back), so its result carries the stored `defaultColor`.

- [ ] **Step 1: failing tests** in `settings.test.ts` (use the file's existing `useVenueDb` suite):
  - fresh venue reads `{ defaultProductVatClass: "general", defaultColor: null }`;
  - `saveCatalogueDefaultColor(tx, "#b12525")` then read → `defaultColor: "#b12525"`, VAT class unchanged; then `saveCatalogueSettings(tx, { defaultProductVatClass: "zero" })` → read gives `{ "zero", "#b12525" }` (Review focus 1); then `saveCatalogueDefaultColor(tx, "#25b125")` keeps `"zero"`;
  - `saveCatalogueDefaultColor(tx, null)` clears it;
  - each of `"#ABCDEF"`, `"#abc"`, `"red"`, `123`, `{}`, `undefined` rejects with an `AppError` whose `code` is `category.invalid` and `params` `{ field: "color" }` (assert the code, not `toBeInstanceOf(Error)`), caught OUTSIDE `withTransaction`, and the stored value is unchanged.
  - `configuration-transfer.test.ts`: `validateCatalogueConfiguration({ catalogue_settings: [{ id: 1, default_product_vat_class: "general", default_color: "#ABCDEF" }] })` throws `setup.request_invalid` `{ field: "catalogue_settings.default_color" }`; `"#b12525"` and `null` and an absent key pass.
- [ ] **Step 2:** run `pnpm --filter @waitron/catalogue exec vitest run src/settings.test.ts src/configuration-transfer.test.ts` — expect FAIL (no function / no column).
- [ ] **Step 3:** schema: add `defaultColor: text("default_color")` using the column vocabulary from `@waitron/db` that `category_details.color` uses (look at `packages/catalogue/src/schema/categories.ts` for the exact builder; `scripts/column-vocabulary.test.ts` forbids drizzle's raw builders). No CHECK (the category colour column has none; validation is in code). Run `pnpm --filter @waitron/catalogue db:generate` and confirm the SQL is a single `ALTER TABLE \`catalogue_settings\` ADD \`default_color\` text;` (no table rebuild).
- [ ] **Step 4:** implement in `settings.ts`:

```ts
export async function readCatalogueSettings(tx: Transaction): Promise<CatalogueSettings> {
  const [row] = await tx
    .select({
      defaultProductVatClass: catalogueSettings.defaultProductVatClass,
      defaultColor: catalogueSettings.defaultColor,
    })
    .from(catalogueSettings)
    .where(eq(catalogueSettings.id, 1));
  return row ?? { defaultProductVatClass: "general", defaultColor: null };
}

export async function saveCatalogueSettings(tx, input: { defaultProductVatClass: unknown }) {
  // existing check unchanged
  await tx.insert(catalogueSettings).values(settings)
    .onConflictDoUpdate({ target: catalogueSettings.id, set: settings });
  return readCatalogueSettings(tx);
}

export async function saveCatalogueDefaultColor(tx: Transaction, color: unknown) {
  const defaultColor = colorOrNull(color, () => {
    throw new AppError("category.invalid", { field: "color" });
  });
  await tx.insert(catalogueSettings).values({ defaultColor })
    .onConflictDoUpdate({ target: catalogueSettings.id, set: { defaultColor } });
  return readCatalogueSettings(tx);
}
```

  `colorOrNull(undefined, …)` refuses (it accepts only null or a stored colour) — confirm with the test. Add `default_color` to `validateCatalogueConfiguration`:

```ts
for (const row of tables.catalogue_settings ?? []) {
  // existing VAT check …
  if (row.default_color !== undefined)
    colorOrNull(row.default_color, () => {
      throw new AppError("setup.request_invalid", { field: "catalogue_settings.default_color" });
    });
}
```

- [ ] **Step 5:** run the two files again → PASS. Then `pnpm --filter @waitron/catalogue exec vitest run src/migrations.test.ts src/provisioning.test.ts src/schema` and fix only what the new column legitimately changes. Then `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts`: the two whole-row pins (~761, ~770) gain `default_color: null` (whole-shape pin rule; note for the PR). Add one case there: a source venue with `default_color = '#b12525'` transfers it to the target.
- [ ] **Step 6:** root guards: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/column-vocabulary.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. All pass unedited. Read each run's `Tests` count.
- [ ] **Step 7:** update the dashboard stubs; `pnpm --filter @waitron/catalogue typecheck`, `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/dashboard typecheck`; `pnpm --filter @waitron/dashboard exec vitest run src/screens/catalogue-settings-panel` (the VAT panel's suites stay green unedited apart from stubs). Commit: `git commit -s -m "Catalogue: store a venue default colour beside the VAT class default (A332)"`.

### Task 2: The walk ends at the default; built menus use it

**Files:**
- Modify: `packages/catalogue/src/color-inheritance.ts`, `packages/catalogue/src/menu-document.ts:275-300`
- Modify (call sites only, to keep the build compiling): `apps/dashboard/src/widgets/product-list.ts:1016`, `product-editor.ts:1196`, `menu-structure-table.ts:706` — each widget gains `@property({ attribute: false }) defaultColor: string | null = null;` and passes `this.defaultColor` as the new argument. Tasks 4 and 5 feed the property.
- Test: `packages/catalogue/src/color-inheritance.test.ts`, `packages/catalogue/src/menu-document.test.ts` (~349-410), `packages/catalogue/src/menu-publication.test.ts` (~688)

**Interfaces — produces:**

```ts
export function categoryColor(categoryId: string | null, categories: ReadonlyMap<string, ColorNode>, fallback: string | null): string | null;
export function effectiveColor(own: string | null, categoryId: string | null, categories: ReadonlyMap<string, ColorNode>, fallback: string | null): string | null;
```

`fallback` is REQUIRED so the compiler finds every caller. It is returned wherever the walk returns null today: no category, a category missing from the map, a loop, nothing coloured above.

- [ ] **Step 1: failing tests.** In `color-inheritance.test.ts`, existing calls gain `, null` (assertions unchanged — list them for the PR). New cases with fallback `"#777777"`: an uncategorised product → fallback; a category with nothing coloured above → fallback; a category the tree lacks → fallback; a loop → fallback; a product's own colour and a coloured ancestor each still win over the fallback.
  In `menu-document.test.ts` (`readDishFacts` block): with `saveCatalogueDefaultColor(tx, "#777777")` stored, an uncategorised product's and an uncoloured-category product's `color` is `"#777777"`, a product under a coloured category keeps that colour, a variant follows its parent.
  In `menu-publication.test.ts`, beside "a category colour edit is a shared change each menu publishes on its own" (~688): publish two menus, set the default colour → both read `changed`; the PUBLISHED document (the version's stored document, as the neighbouring tests read it) still carries the old colour (null) for an uncategorised product (Review focus 5); clearing the default back to null → both read `current` again (Review focus 3).
- [ ] **Step 2:** run `pnpm --filter @waitron/catalogue exec vitest run src/color-inheritance.test.ts src/menu-document.test.ts src/menu-publication.test.ts` — FAIL.
- [ ] **Step 3:** implement:

```ts
export function categoryColor(categoryId, categories, fallback) {
  let id = categoryId;
  for (let steps = 0; id !== null && steps <= categories.size; steps++) {
    const node = categories.get(id);
    if (node === undefined) return fallback;
    if (node.color !== null) return node.color;
    id = node.parentId;
  }
  return fallback;
}
export function effectiveColor(own, categoryId, categories, fallback) {
  return own ?? categoryColor(categoryId, categories, fallback);
}
```

  Update the doc comment on `categoryColor` to say the walk ends at `fallback` (the venue default). In `readDishFacts`, read `(await readCatalogueSettings(tx)).defaultColor` once, beside the `listCategories` read, and pass it. Update the comment above `readDishFacts` if it lists what it reads.
- [ ] **Step 4:** the three dashboard call sites: add the `defaultColor` property and pass it. No behaviour change yet (it is null until Tasks 4–5).
- [ ] **Step 5:** run the catalogue files → PASS; `pnpm --filter @waitron/catalogue typecheck`, `pnpm --filter @waitron/dashboard typecheck`; `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/widgets/product-editor.test.ts src/widgets/menu-structure-table.test.ts` stay green. Golden huella: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts` unedited, green. Commit `-s`: "Colour walk: a product with nothing coloured above it takes the venue default (A332)".

### Task 3: Server route and dashboard client

**Files:**
- Modify: `apps/server/src/catalogue-api.ts:750-766` (new route beside the settings routes)
- Modify: `apps/dashboard/src/api/client.ts:2016-2022`, `apps/dashboard/src/api/live-queries.ts:4-25`
- Test: `apps/server/src/catalogue-api*.test.ts` (find the file that tests `/management-api/catalogue-settings` with `git grep -l 'catalogue-settings' apps/server/src`), `apps/dashboard/src/api/client-routes.test.ts:1140-1150`, `apps/dashboard/src/api/live-queries.test.ts`

**Interfaces — produces:**
- `PUT /management-api/catalogue-settings/default-color`, body `{ color: string | null }`, answers the whole `CatalogueSettings`. Same session gate as the settings PUT (`gated`). A body `color` that is neither a string nor null (including absent) → `management.request_invalid` `{ field: "color" }`.
- `DashboardApi.saveCatalogueDefaultColor(color: string | null): Promise<CatalogueSettings>`.
- `MENU_PUBLICATION_READS` includes `"catalogue_settings"`, so a menu's status and preview refresh when the default changes.

- [ ] **Step 1: failing tests:** route — a manager sets `"#b12525"` and GET returns it with the VAT class unchanged; `null` clears; `"#ABCDEF"` → 400 `category.invalid` `{field:"color"}`; `{ color: 5 }` and `{}` → 400 `management.request_invalid`; a session without the catalogue permission is refused the same way the settings PUT refuses (copy that test's shape). Client — `saveCatalogueDefaultColor` sends PUT to the path with `{ color }`. Live queries — `getMenuStatus`'s dependencies include `{ type: "catalogue_settings" }`.
- [ ] **Step 2:** run them (`pnpm --filter @waitron/server exec vitest run <file>`, `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/api/live-queries.test.ts`) — FAIL.
- [ ] **Step 3:** implement:

```ts
app.put("/management-api/catalogue-settings/default-color", (c) =>
  run(c, log, async () => {
    const sessionId = requireManagementSession(c);
    const body = await readJsonBody<{ color?: unknown }>(c);
    if (body.color !== null && typeof body.color !== "string")
      throw new AppError("management.request_invalid", { field: "color" });
    return c.json(await gated(c, sessionId, (tx) => saveCatalogueDefaultColor(tx, body.color)));
  }),
);
```

  Check the middleware at ~740-747 that bumps the menu revision on non-GET requests: if it covers the settings routes, it covers this one; say in the commit which it is. Client method next to `saveCatalogueSettings`. Add `"catalogue_settings"` to `MENU_PUBLICATION_READS`; a test pinning that whole list gains it (whole-shape pin; list it).
- [ ] **Step 4:** run → PASS; `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/dashboard typecheck`; `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/errors-reachable.test.ts`. Commit `-s`: "Server: the venue default colour is saved on its own route (A332)".

### Task 4: The "All products" row draws and edits the default

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts:1279-1296` (root row), `apps/dashboard/src/widgets/catalogue-browser.ts` (~124 `colorTarget`, ~791-818 `#chooseColor`/`#colorHeading`, ~880-886 events, ~981-996 colour form, ~829-899 product-list properties), `apps/dashboard/src/screens/catalogue-screen.ts` (~721-783: pass `.defaultColor=${this.catalogueSettings?.defaultColor ?? null}` to catalogue-browser and to the product editor)
- Test: `apps/dashboard/src/widgets/product-list.test.ts`, `apps/dashboard/src/widgets/catalogue-browser.test.ts` (or wherever `folder-color` is tested: `git grep -ln 'folder-color' apps/dashboard/src`), `apps/dashboard/src/widgets/product-editor.test.ts`, and the matching `*.a11y.test.ts` files.

**Interfaces — consumes:** `DashboardApi.saveCatalogueDefaultColor`, `CatalogueSettings.defaultColor`, the widgets' `defaultColor` properties (Task 2). **Produces:** a `root-color` event (no detail beyond `{}`) from product-list, bubbling + composed like `folder-color`.

- [ ] **Step 1: failing tests (Chromium):**
  - product-list: the root row has a `button[part~="swatch-button"][data-test="color-root"]` labelled `folders.edit_color` with `{name}` = `folders.all_products`, inside the same `folder-frame` slot categories use; with `defaultColor` null its chip has the `empty` part, with `"#b12525"` the chip is painted that colour. **Alignment (the owner's complaint):** the left edge of the root row's name text equals a top-level category row's name text left edge (`getBoundingClientRect().left`, within 0.5px), at desktop width and at 390px. Write this one first and see it fail on today's markup.
  - product-list: an uncategorised product with no own colour draws the default chip when `defaultColor` is set (Review focus 2), and draws its category's colour when the category has one.
  - catalogue-browser: clicking `color-root` opens the colour form with heading `folders.color_heading` / All products and the current default selected; choosing a colour calls `api.saveCatalogueDefaultColor("#…")` once and closes; choosing "no colour" sends `null`; a `category.invalid` refusal shows in the form (same as a category's), and does not close it (Review focus 4); while busy a second choice is ignored.
  - product-editor: with no category and `defaultColor` `"#b12525"`, the colour field's inherited hint shows that colour.
  - a11y: axe on the product list with the root swatch, both themes, empty and painted.
- [ ] **Step 2:** run the files — FAIL.
- [ ] **Step 3:** implement. Root row name cell becomes:

```ts
html`<span part="folder-cell"
  >${folderFrame(
    html`<button part="swatch-button" type="button" data-test="color-root"
      aria-label=${t("folders.edit_color").replace("{name}", t("folders.all_products"))}
      @click=${(event: Event) => { event.stopPropagation(); this.#send("root-color", {}); }}
    >${swatchChip(this.defaultColor)}</button>`,
  )}<span part="folder-name">…unchanged…</span></span>`
```

  (Reuse whatever `#send` does for `folder-color`; keep the button's existing part styles.) In catalogue-browser: `colorTarget` gains `{ kind: "default" }`; `@root-color` sets it; `.color` for the form is `this.defaultColor` for that kind; `#colorHeading` uses `t("folders.all_products")` for it; `#chooseColor` for `default` calls `this.api.saveCatalogueDefaultColor(color)` with the same busy/error/close handling as a row (errors via `categoryRefusalErrors(error, null)`). catalogue-browser gains `defaultColor` and passes it to product-list; catalogue-screen passes `this.catalogueSettings?.defaultColor ?? null` to catalogue-browser and the product editor. The existing `getCatalogueSettings` watch refreshes it after a save.
- [ ] **Step 4:** run → PASS; dashboard typecheck; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`. Commit `-s`: "Products: the All products row shows and edits the venue default colour (A332)".

### Task 5: The menu editor's Structure tab uses the default

**Files:**
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (~868-872 watches, ~2158 structure table)
- Test: `apps/dashboard/src/screens/menus-screen.test.ts` (and its stubs gain `getCatalogueSettings` where the screen now calls it — adding what a stub lacks)

- [ ] **Step 1: failing test:** with `getCatalogueSettings` answering `defaultColor: "#b12525"`, an uncategorised, uncoloured product in the Structure tab draws that colour; when the live query answers a new value, it updates.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** add `this.#queries.watch("getCatalogueSettings", [], (value) => { this.defaultColor = value.defaultColor; })` beside the `listCategories` watch (copy its exact shape, including failure handling the screen uses for reads), and pass `.defaultColor=${this.defaultColor}` to `<dashboard-menu-structure-table>`. Before editing, `git fetch` and check whether lane C's `feat/save-follows-changes-menus` has landed changes to this file; rebase if it has.
- [ ] **Step 4:** run → PASS (plus `menus-screen.a11y.test.ts` if stubs changed); typecheck. Commit `-s`: "Menus: the Structure tab's product colours end at the venue default (A332)".

### Task 6: Look, docs

- [ ] Start the dev stack from the worktree (`wa-wt demo waitron-feat-all-products-colour`; before that, check nobody holds the slot-0 venue: `lsof -i :8080`). The branch adds a catalogue migration; the shared venue migrates on start. Sign in, open Products: screenshot the All products row aligned with the categories, with no default and with one set, EN and ES, light and dark, desktop and 390px. Open a product with no category and no colour: the colour field's hint shows the default. Publish a menu, enrol/open the till (`http://localhost:5190/?dev`), and check an uncategorised product's tile takes the default after publishing (and not before). Save screenshots under `~/waitron-campaign-b/a332-shots/`.
- [ ] `docs/developers/design-system.md`: if it documents category colour inheritance or the product list's folder rows, add one line that the walk ends at the venue default edited from "All products". Grep first (`grep -n -i 'inherit\|All products' docs/developers/design-system.md`); add nothing if there is no such section.
- [ ] Commit `-s` any doc change. The backlog entry is written at land.

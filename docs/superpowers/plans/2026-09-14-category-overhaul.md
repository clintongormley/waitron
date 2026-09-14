# Category Management Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the categories screen and its dialogs into a consistent sortable/filterable layout, and move the reusable toolbar + remembered-view capabilities into the `wt-data-table` primitive.

**Architecture:** Additive, opt-in inputs on `wt-data-table` (search, per-column filters, public defaultable sort, a session-storage `viewKey`, and ownership of the tree-mode ancestor walk). The categories screen, category form and membership picker then consume those inputs, dropping their own search/ancestor/filter code, and switch their parent/category pickers to `wt-combobox`. Two content-language bugs (parent and category names shown in the venue default language) are fixed by passing the full `ContentLanguages` config into the two widgets.

**Tech Stack:** TypeScript, Lit web components, Vitest in real headless Chromium (browser mode), axe for a11y. Packages: `@waitron/ui` (primitive), `apps/dashboard` (screen + widgets).

**Spec:** `docs/superpowers/specs/2026-09-14-category-overhaul-design.md` — read it alongside this plan; the plan implements it task by task.

## Global Constraints

- **Tokens only** in `packages/ui`: every colour, spacing, radius, font reads a `--wt-*` token — no hex, named colours, `rem`/`em`. Guard: `packages/ui/src/no-hardcoded-chrome.test.ts`.
- **`text-wrap: nowrap`**, never the `white-space` shorthand starting with a colour keyword — the no-hardcoded-chrome scan rejects the shorthand (see the existing `.value` rule in `wt-combobox.ts`).
- **A new primitive behaviour needs two tests:** a token-painting/behaviour test and an axe `*.a11y.test.ts` covering each state in both light and dark themes.
- **Custom events** are `wt-*`, carry `detail`, dispatched `bubbles: true, composed: true`; the triggering event is stopped with `stopPropagation()` before re-emitting.
- **Storage access is wrapped:** every `sessionStorage`/`localStorage` read and write is inside try/catch and the component works when it throws (a private window, blocked site data). Match the existing `MODE_KEY` handling in `categories-screen.ts`.
- **Cell markup handed to `wt-data-table` is styled with `part=`/`::part()`, never a CSS class** — the nodes live in the table's shadow root. This already governs the categories screen's swatch/thumbnail/muted parts.
- **Plain-English commit messages** (owner rule): describe the mechanism in words; exact file/function/error-code names appear once as pointers; a command that was run goes in verbatim. No attribution lines.
- **Coverage floor** `90/90/85/85` in both `packages/ui` and `apps/dashboard`; new branches need their own assertions.
- **Every `git commit` uses `-s`.** Commit after each task's tests are green.
- **Run focused tests while implementing:** `pnpm --filter @waitron/ui test <file>` and `pnpm --filter @waitron/dashboard test <file>`. CI owns the full package suites and coverage.
- **No backwards-compatibility / data-migration code** (pre-production).

---

## File Structure

- `packages/ui/src/components/wt-data-table.ts` — the primitive; gains toolbar, filters, public sort, ancestor walk, stored view.
- `packages/ui/src/components/wt-data-table.test.ts` — behaviour tests (existing file, extended).
- `packages/ui/src/components/wt-data-table.a11y.test.ts` — axe tests (existing file, extended for the toolbar).
- `packages/ui/demo/main.ts` — workbench example exercising the toolbar.
- `docs/developers/design-system.md` — Primitives table row + a "Remembered table view" note.
- `apps/dashboard/src/i18n/strings.ts` — string keys (add/remove/relabel), English and Spanish blocks.
- `apps/dashboard/src/screens/categories-screen.ts` (+ `.test.ts`, `.a11y.test.ts`) — header, categories table, product dialogs, delete.
- `apps/dashboard/src/widgets/category-form.ts` (+ `.test.ts`) — parent combobox, `languages` config.
- `apps/dashboard/src/widgets/category-membership-picker.ts` (+ `.test.ts`) — comboboxes, lozenges, `languages` config.

Tasks 1–6 are the primitive and its docs (each a standalone, reviewable `@waitron/ui` deliverable). Task 7 is strings. Tasks 8–13 are the dashboard screen and widgets. Task 14 is the final visual/a11y pass. Tasks 8–13 depend on 1–7; within the primitive, do 1→5 in order (each builds on the last), then 6.

---

### Task 1: `wt-data-table` — public, defaultable sort + `wt-sort-change`

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts`
- Test: `packages/ui/src/components/wt-data-table.test.ts`

**Interfaces:**
- Consumes: existing `DataTableColumn<Row>` (`key`, `label`, `cell`, `sortValue?`, `align?`), existing `SortDirection = "ascending" | "descending"`.
- Produces: `@property() sortKey: string | null`, `@property() sortDirection: SortDirection`, event `wt-sort-change` with `detail: { sortKey: string | null; sortDirection: SortDirection }`. Later primitive tasks and the categories screen rely on these.

Today `sortKey`/`sortDirection` are private `@state`. Make them public `@property` with the current defaults, so a consumer chooses the starting sort, and emit an event on every change.

- [ ] **Step 1: Write the failing tests**

Add to `wt-data-table.test.ts`:

```ts
test("applies the sortKey and sortDirection defaults on first render", async () => {
  const el = await table({ sortKey: "name", sortDirection: "ascending" });
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]); // Ada before Bea
});

test("emits wt-sort-change when a header is clicked", async () => {
  const el = await table();
  const events: { sortKey: string | null; sortDirection: string }[] = [];
  el.addEventListener("wt-sort-change", (e) =>
    events.push((e as CustomEvent).detail),
  );
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(events).toEqual([{ sortKey: "name", sortDirection: "ascending" }]);
});

test("descending default sorts the other way", async () => {
  const el = await table({ sortKey: "count", sortDirection: "descending" });
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]); // 10 before 2
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: FAIL — `sortKey`/`sortDirection` are not settable inputs; no `wt-sort-change` fires.

- [ ] **Step 3: Make sort public and emit the event**

In `wt-data-table.ts`, change the two `@state` sort fields to `@property`:

```ts
@property() sortKey: string | null = null;
@property() sortDirection: SortDirection = "ascending";
```

In `#sort(column)`, after mutating `sortKey`/`sortDirection`, emit the event. Replace the method body's two mutation branches so both fall through to one emit:

```ts
#sort(column: DataTableColumn<Row>): void {
  if (column.sortValue === undefined) return;
  if (this.sortKey === column.key) {
    this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
  } else {
    this.sortKey = column.key;
    this.sortDirection = "ascending";
  }
  this.dispatchEvent(
    new CustomEvent("wt-sort-change", {
      detail: { sortKey: this.sortKey, sortDirection: this.sortDirection },
      bubbles: true,
      composed: true,
    }),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts
git commit -s -m "Make the data table's sort a chosen input

The sort column and direction become inputs a screen can set to pick the
starting sort, and the table announces every change with a wt-sort-change
event, so a screen can record it. Default behaviour is unchanged."
```

---

### Task 2: `wt-data-table` — toolbar search

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts`
- Test: `packages/ui/src/components/wt-data-table.test.ts`

**Interfaces:**
- Consumes: Task 1 outputs; existing render paths.
- Produces: `@property({ type: Boolean }) searchable`, `@property() searchLabel`, `@property() searchPlaceholder`, `@property() noMatchesMessage`; `DataTableColumn.searchValue?: (row: Row) => string`. Later tasks (filters, ancestor walk) build on the same "which rows match" pipeline.

The toolbar is one flex row rendered above the table when `searchable` is set: a search box filling the left, a filter group on the right (filters land in Task 3). This task adds the box and the text filtering.

- [ ] **Step 1: Write the failing tests**

```ts
test("searchable renders a search box that narrows rows", async () => {
  const el = await table({
    searchable: true,
    searchLabel: "Search users",
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, sortValue: (r: Row) => r.name,
        searchValue: (r: Row) => r.name },
      { key: "count", label: "Count", cell: (r: Row) => r.count },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  expect(input.getAttribute("aria-label")).toBe("Search users");
  input.value = "ad";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10"]);
});

test("no toolbar is rendered when searchable is off", async () => {
  const el = await table();
  expect(el.shadowRoot!.querySelector(".table-toolbar")).toBeNull();
});

test("noMatchesMessage shows when a search excludes every row", async () => {
  const el = await table({
    searchable: true,
    noMatchesMessage: "Nothing matches",
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "zzz";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toContain("Nothing matches");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: FAIL — no `.table-toolbar`/`.table-search`, no filtering.

- [ ] **Step 3: Add the search input and the match pipeline**

Add properties and state to `wt-data-table.ts`:

```ts
@property({ type: Boolean }) searchable = false;
@property() searchLabel = "Search";
@property() searchPlaceholder = "Search";
@property() noMatchesMessage = "No matches";
@state() private searchText = "";
```

Add `searchValue?: (row: Row) => string;` to the `DataTableColumn<Row>` interface (after `sortValue`).

Add a helper that decides which rows pass the current search. It reads `searchValue`, falling back to the column's `sortValue` coerced to a string:

```ts
/** The text a row exposes to the search box: every column's searchValue, or its sortValue as a
 * fallback, joined so a term can match any column. */
#searchHaystack(row: Row): string {
  return this.columns
    .map((column) =>
      column.searchValue
        ? column.searchValue(row)
        : column.sortValue
          ? String(column.sortValue(row) ?? "")
          : "",
    )
    .join(" ")
    .toLocaleLowerCase();
}

#passesSearch(row: Row): boolean {
  const term = this.searchText.trim().toLocaleLowerCase();
  return term === "" || this.#searchHaystack(row).includes(term);
}

/** The rows left after the toolbar (search now; filters in Task 3). The single choke point every
 * render path funnels through, so flat and tree mode narrow identically. */
#visibleRows(): readonly Row[] {
  if (!this.searchable) return this.rows;
  return this.rows.filter((row) => this.#passesSearch(row));
}
```

Change both render paths to source rows from `#visibleRows()` rather than `this.rows`: in the flat path replace `this.#sortedRows()`'s input, and in the tree path replace the `this.rows` reads inside `#treeRows()`. Do this by having `#sortedRows()` and `#treeRows()` operate on a passed-in row list; add a parameter `rows: readonly Row[]` to each and pass `this.#visibleRows()`. Update their internal `this.rows.forEach`/`this.rows.map` references to the parameter.

Add the empty/no-match branch to `render()` before building the table. Replace the existing zero-rows guard:

```ts
const visible = this.#visibleRows();
if (this.rows.length === 0)
  return html`${this.#renderToolbar()}<p class="message" role="status">${this.emptyMessage}</p>`;
if (visible.length === 0)
  return html`${this.#renderToolbar()}<p class="message" role="status">${this.noMatchesMessage}</p>`;
```

Render the toolbar above the `.scroll` region in both flat and tree paths (wrap the returned template so `#renderToolbar()` precedes it):

```ts
#renderToolbar() {
  if (!this.searchable) return nothing;
  return html`<div class="table-toolbar">
    <input
      class="table-search"
      type="search"
      autocomplete="off"
      aria-label=${this.searchLabel}
      placeholder=${this.searchPlaceholder}
      .value=${this.searchText}
      @input=${(event: Event) => {
        this.searchText = (event.target as HTMLInputElement).value;
      }}
    />
  </div>`;
}
```

Add toolbar styles to the `css` block (tokens only). The search box grows; the (future) filter group sits at the right and the row wraps on narrow screens:

```css
.table-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wt-space-3);
  margin-bottom: var(--wt-space-3);
}
.table-search {
  flex: 1 1 min(100%, var(--wt-space-9, 16rem));
  min-height: var(--wt-tap-min);
  padding: var(--wt-space-2) var(--wt-space-3);
  border: 1px solid var(--wt-color-border);
  border-radius: var(--wt-radius-full);
  background: var(--wt-color-bg);
  color: var(--wt-color-text);
  font: inherit;
}
```

(If `--wt-space-9` does not exist, use a token that does — check `packages/ui/src/tokens`; the intent is "search stays wide but yields to wrap". Confirm the chosen token exists before committing so no-hardcoded-chrome stays green.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: PASS, including all pre-existing tests (they pass no `searchable`, so the toolbar is absent).

- [ ] **Step 5: Verify the token guard**

Run: `pnpm --filter @waitron/ui test no-hardcoded-chrome.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts
git commit -s -m "Give the data table an optional search box

When a screen turns on searching, the table draws a search box above itself
and keeps only the rows whose text contains what was typed, across whichever
columns expose text. A separate message covers the case where rows exist but
none match, kept apart from the empty-table message."
```

---

### Task 3: `wt-data-table` — column filters + toolbar a11y

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts`
- Test: `packages/ui/src/components/wt-data-table.test.ts`, `packages/ui/src/components/wt-data-table.a11y.test.ts`

**Interfaces:**
- Consumes: Task 2's `#visibleRows()` pipeline.
- Produces: `DataTableColumn.filter?: { label; allLabel; value; options }`; internal filter selection state; native `<select>` dropdowns in the toolbar. Later tasks (ancestor walk, stored view) read/persist the filter selections.

- [ ] **Step 1: Write the failing tests**

```ts
const withStatus: DataTableColumn<RowS>[] = [
  { key: "name", label: "Name", cell: (r: RowS) => r.name, searchValue: (r: RowS) => r.name },
  {
    key: "status", label: "Status", cell: (r: RowS) => r.status,
    filter: {
      label: "Filter by status", allLabel: "Any status",
      value: (r: RowS) => r.status,
      options: [{ value: "active", label: "Active" }, { value: "off", label: "Inactive" }],
    },
  },
];
// RowS = { id: string; name: string; status: string }; rowsS defined with mixed statuses.

test("renders one dropdown per filtered column and narrows on selection", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
  expect([...select.options].map((o) => o.textContent!.trim())).toEqual([
    "Any status", "Active", "Inactive",
  ]);
  select.value = "active";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowTextS(el).every((t) => t.includes("Active"))).toBe(true);
});

test("search and filter combine with AND", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
  input.value = "ada"; input.dispatchEvent(new Event("input"));
  select.value = "off"; select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  // Ada is Active, so name=ada AND status=off yields nothing.
  expect(el.shadowRoot!.querySelector(".message")).not.toBeNull();
});

test("a column with no filter contributes no dropdown", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  expect(el.shadowRoot!.querySelectorAll("select[data-filter]").length).toBe(1);
});
```

Add the a11y test to `wt-data-table.a11y.test.ts` inside the existing `describe.each`:

```ts
test("toolbar with a search box and a filter dropdown", async () => {
  const el = (await mountThemed(
    '<wt-data-table aria-label="Users"></wt-data-table>',
    theme,
  )) as WtDataTable<{ id: string; name: string; status: string }>;
  el.columns = [
    { key: "name", label: "Name", cell: (r) => r.name, searchValue: (r) => r.name },
    { key: "status", label: "Status", cell: (r) => r.status,
      filter: { label: "Filter by status", allLabel: "Any status", value: (r) => r.status,
        options: [{ value: "a", label: "Active" }] } },
  ];
  el.rows = [{ id: "1", name: "Ada", status: "Active" }];
  el.rowKey = (row) => row.id;
  el.searchable = true;
  el.searchLabel = "Search users";
  await el.updateComplete;
  await expectNoA11yViolations(host);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/ui test wt-data-table`
Expected: FAIL — no `select[data-filter]`, no filtering.

- [ ] **Step 3: Add the filter descriptor, state and rendering**

Extend the interface:

```ts
export interface DataTableColumn<Row> {
  key: string;
  label: string;
  cell: (row: Row, context: { ancestorOnly: boolean }) => unknown; // second arg lands fully in Task 4
  sortValue?: (row: Row) => string | number | null | undefined;
  searchValue?: (row: Row) => string;
  filter?: {
    label: string;
    allLabel: string;
    value: (row: Row) => string;
    options: { value: string; label: string }[];
  };
  align?: "start" | "end";
}
```

Filter selections keyed by column key ("" = all):

```ts
@state() private filterSelections: Record<string, string> = {};
```

Extend `#visibleRows()` to apply filters (AND), then search:

```ts
#passesFilters(row: Row): boolean {
  for (const column of this.columns) {
    if (!column.filter) continue;
    const selected = this.filterSelections[column.key] ?? "";
    if (selected !== "" && column.filter.value(row) !== selected) return false;
  }
  return true;
}

#visibleRows(): readonly Row[] {
  if (!this.searchable) return this.rows;
  return this.rows.filter((row) => this.#passesFilters(row) && this.#passesSearch(row));
}
```

Render the filter group inside `#renderToolbar()`, after the search input:

```ts
${this.columns.some((c) => c.filter)
  ? html`<div class="table-filters">
      ${this.columns.map((column) =>
        column.filter
          ? html`<select
              class="table-filter"
              data-filter=${column.key}
              aria-label=${column.filter.label}
              .value=${this.filterSelections[column.key] ?? ""}
              @change=${(event: Event) => {
                this.filterSelections = {
                  ...this.filterSelections,
                  [column.key]: (event.target as HTMLSelectElement).value,
                };
              }}
            >
              <option value="">${column.filter.allLabel}</option>
              ${column.filter.options.map(
                (option) => html`<option value=${option.value}>${option.label}</option>`,
              )}
            </select>`
          : nothing,
      )}
    </div>`
  : nothing}
```

Add styles:

```css
.table-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wt-space-2);
}
.table-filter {
  min-height: var(--wt-tap-min);
  padding: var(--wt-space-2) var(--wt-space-3);
  border: 1px solid var(--wt-color-border);
  border-radius: var(--wt-radius-md);
  background: var(--wt-color-surface);
  color: var(--wt-color-text);
  font: inherit;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/ui test wt-data-table`
Expected: PASS, including the a11y toolbar test in both themes and `no-hardcoded-chrome`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts
git commit -s -m "Let data-table columns carry a filter dropdown

A column can declare a set of values to filter by; every such column gets a
dropdown in the toolbar, and a row must pass every active dropdown and the
search box to show. A column without a filter contributes no dropdown, so a
screen that hides a column in one mode also hides its filter there."
```

---

### Task 4: `wt-data-table` — tree-mode ancestor walk + cell context

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts`
- Test: `packages/ui/src/components/wt-data-table.test.ts`

**Interfaces:**
- Consumes: Task 2/3 `#visibleRows()`; existing `rowParent`, `#treeRows()`.
- Produces: in tree mode, ancestor rows of a matching row are kept and passed to cells with `context.ancestorOnly === true`; matching (and non-tree) rows get `context.ancestorOnly === false`. The categories screen (Task 9) reads this to mute ancestor-only rows and drops its own ancestor walk.

Today a filtered tree would orphan a matching descendant whose parent does not match. The screen currently patches this itself; move it into the primitive.

- [ ] **Step 1: Write the failing tests**

```ts
type TreeRow = { id: string; parent: string | null; name: string };
const treeRows: TreeRow[] = [
  { id: "food", parent: null, name: "Food" },
  { id: "break", parent: "food", name: "Breakfast" },
  { id: "eggs", parent: "break", name: "Eggs" },
];

test("a filtered tree keeps a match's ancestor chain and marks it ancestor-only", async () => {
  const seen: Record<string, boolean> = {};
  const el = (await mount('<wt-data-table aria-label="Cats"></wt-data-table>')) as WtDataTable<TreeRow>;
  Object.assign(el, {
    rows: treeRows,
    rowKey: (r: TreeRow) => r.id,
    rowParent: (r: TreeRow) => r.parent,
    searchable: true,
    columns: [
      { key: "name", label: "Name",
        searchValue: (r: TreeRow) => r.name,
        cell: (r: TreeRow, ctx: { ancestorOnly: boolean }) => { seen[r.id] = ctx.ancestorOnly; return r.name; } },
    ],
  });
  await el.updateComplete;
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "eggs"; input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  // Eggs matches; Food and Breakfast are kept only to hold Eggs' place.
  expect(Object.keys(seen).sort()).toEqual(["break", "eggs", "food"]);
  expect(seen.eggs).toBe(false);
  expect(seen.food).toBe(true);
  expect(seen.break).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: FAIL — filtering drops ancestors, and `cell`'s second argument is undefined.

- [ ] **Step 3: Keep ancestors in tree mode, pass the cell context**

Split matching from the row set the tree renders. Add a helper that, in tree mode, extends the matched set with ancestors and reports which keys are ancestor-only:

```ts
/** In tree mode a matching row's ancestors must stay so it is not shown as a false top-level row.
 * Returns the rows to render plus the set of keys present only as an ancestor of a match. */
#treeVisible(): { rows: readonly Row[]; ancestorOnly: ReadonlySet<string> } {
  const parentOf = this.rowParent!;
  const indexOf = new Map<Row, number>();
  this.rows.forEach((row, i) => indexOf.set(row, i));
  const keyOf = (row: Row) => this.rowKey(row, indexOf.get(row)!);
  const matched = new Set(this.#visibleRows().map(keyOf));
  const included = new Set(matched);
  for (const row of this.rows) {
    if (!matched.has(keyOf(row))) continue;
    const visited = new Set<string>();
    let current: Row | undefined = row;
    let parentKey = current ? parentOf(current) : null;
    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey);
      included.add(parentKey);
      current = this.rows.find((r) => keyOf(r) === parentKey);
      parentKey = current ? parentOf(current) : null;
    }
  }
  const ancestorOnly = new Set([...included].filter((key) => !matched.has(key)));
  return { rows: this.rows.filter((row) => included.has(keyOf(row))), ancestorOnly };
}
```

In the tree render path, source rows from `#treeVisible()` instead of `this.rows`, and thread `ancestorOnly` into every `column.cell(row, ...)` call:

```ts
const isTree = this.rowParent !== undefined;
// flat path:
column.cell(row, { ancestorOnly: false })
// tree path: compute `const { ancestorOnly } = this.#treeVisible();` and pass
column.cell(row, { ancestorOnly: ancestorOnly.has(key) })
```

Make `#treeRows()` operate on the `rows` from `#treeVisible()` (pass them in, as Task 2 did for `#sortedRows`). The flat path keeps passing `{ ancestorOnly: false }`.

Guard the empty/no-match branch for tree mode too: when `isTree`, compute `#treeVisible().rows.length` for the no-match check instead of `#visibleRows().length` (a match with kept ancestors is not "no matches").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts
git commit -s -m "Keep a filtered tree's ancestor rows in the table itself

When a search or filter narrows a tree, the table now keeps each match's
parent chain so a deep match is not shown as a false top-level row, and tells
each cell whether its row is present only as an ancestor. This is the logic
the categories screen carried by hand, moved where every tree table gets it."
```

---

### Task 5: `wt-data-table` — remembered view (session storage)

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts`
- Test: `packages/ui/src/components/wt-data-table.test.ts`

**Interfaces:**
- Consumes: Task 1 sort state, Task 3 `filterSelections`.
- Produces: `@property() viewKey?: string`. When set, sort + filters persist to `sessionStorage`; search text does not. The categories screen and product tables (Tasks 9, 12, 13) set a `viewKey`.

- [ ] **Step 1: Write the failing tests**

```ts
test("restores a stored sort and filter from session storage under viewKey", async () => {
  sessionStorage.setItem(
    "test.table",
    JSON.stringify({ sortKey: "count", sortDirection: "descending", filters: {} }),
  );
  const el = await table({ viewKey: "test.table", searchable: true });
  expect(el.sortKey).toBe("count");
  expect(el.sortDirection).toBe("descending");
  sessionStorage.clear();
});

test("writes sort changes back to session storage", async () => {
  const el = await table({ viewKey: "test.table2", searchable: true });
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(JSON.parse(sessionStorage.getItem("test.table2")!).sortKey).toBe("name");
  sessionStorage.clear();
});

test("ignores a stored sort column that no longer exists", async () => {
  sessionStorage.setItem("test.table3", JSON.stringify({ sortKey: "gone", sortDirection: "ascending", filters: {} }));
  const el = await table({ viewKey: "test.table3", sortKey: "name", sortDirection: "ascending" });
  expect(el.sortKey).toBe("name"); // fell back to the default, not "gone"
  sessionStorage.clear();
});

test("never stores search text", async () => {
  const el = await table({ viewKey: "test.table4", searchable: true,
    columns: [{ key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name }] });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "ada"; input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  const stored = JSON.parse(sessionStorage.getItem("test.table4") ?? "{}");
  expect(stored.search).toBeUndefined();
  sessionStorage.clear();
});

test("a throwing storage does not break the table", async () => {
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const el = await table({ viewKey: "test.table5" });
  expect(el.shadowRoot!.querySelector("table")).not.toBeNull();
  spy.mockRestore();
});
```

Import `vi` in the test file if not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: FAIL — no `viewKey`, no persistence.

- [ ] **Step 3: Add viewKey persistence**

```ts
@property() viewKey?: string;
```

Restore on connect:

```ts
override connectedCallback(): void {
  super.connectedCallback();
  this.#restoreView();
}

#restoreView(): void {
  if (!this.viewKey) return;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(this.viewKey);
  } catch {
    return; // storage blocked; defaults stand
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as {
      sortKey?: string | null;
      sortDirection?: SortDirection;
      filters?: Record<string, string>;
    };
    if (typeof parsed.sortKey === "string") this.sortKey = parsed.sortKey;
    if (parsed.sortDirection === "ascending" || parsed.sortDirection === "descending")
      this.sortDirection = parsed.sortDirection;
    if (parsed.filters && typeof parsed.filters === "object")
      this.filterSelections = { ...parsed.filters };
  } catch {
    // A malformed store is ignored, exactly like a first visit.
  }
}
```

Drop a stale stored sort in `#sortedRows`/`#treeRows` already happens (a `sortKey` with no matching sortable column falls back to original order). Also guard the default explicitly: in `#restoreView`, only apply a stored `sortKey` if a current column has it with a `sortValue`:

```ts
if (
  typeof parsed.sortKey === "string" &&
  this.columns.some((c) => c.key === parsed.sortKey && c.sortValue !== undefined)
)
  this.sortKey = parsed.sortKey;
```

Note: `columns` may be assigned after `connectedCallback`. Re-run the restore once columns arrive. Add to `updated`:

```ts
protected override updated(changed: PropertyValues<this>): void {
  if (changed.has("viewKey") || (changed.has("columns") && this.viewKey && !this.#restored)) {
    this.#restoreView();
    this.#restored = true;
  }
}
```

with `#restored = false;` as a field. (If `wt-data-table` already has an `updated`, extend it; it does not today — confirm before adding.)

Persist on change. Add a writer and call it wherever sort or filter selections change:

```ts
#persistView(): void {
  if (!this.viewKey) return;
  try {
    sessionStorage.setItem(
      this.viewKey,
      JSON.stringify({
        sortKey: this.sortKey,
        sortDirection: this.sortDirection,
        filters: this.filterSelections,
      }),
    );
  } catch {
    // The remembered view is a convenience; the table works without it.
  }
}
```

Call `this.#persistView()` at the end of `#sort()` (after emitting `wt-sort-change`) and in the filter `<select>`'s `@change` handler (after setting `filterSelections`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/ui test wt-data-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts
git commit -s -m "Let a data table remember its sort and filters per tab

Given a storage key, the table saves its sort column, direction and filter
choices to the tab's session storage and restores them next time, ignoring a
saved value that no longer fits the current columns. It never saves the typed
search text, and a browser with storage blocked still works."
```

---

### Task 6: `wt-data-table` — workbench demo + design-system docs

**Files:**
- Modify: `packages/ui/demo/main.ts`
- Modify: `docs/developers/design-system.md`

**Interfaces:**
- Consumes: all of Tasks 1–5.
- Produces: documentation only.

- [ ] **Step 1: Add a searchable/filterable demo**

In `packages/ui/demo/main.ts`, add a `wt-data-table` instance with `searchable`, a `searchLabel`, a `viewKey`, and one column carrying a `filter`, wired to sample rows. Mirror the existing demo wiring style (the file already imports and configures primitives). This is a manual workbench aid; no assertion.

- [ ] **Step 2: Update the Primitives table**

In `docs/developers/design-system.md`, extend the `wt-data-table` row's Properties column to include `searchable`, `searchLabel`, `searchPlaceholder`, `noMatchesMessage`, `sortKey`, `sortDirection`, `viewKey`, and the `filter`/`searchValue` column fields; add `wt-sort-change` to its Events column.

- [ ] **Step 3: Add a "Remembered table view" note**

Add a short subsection under the data-table area of `design-system.md`:

```markdown
### Remembered, searchable, filterable tables

`wt-data-table` renders its own toolbar when `searchable` is set: a search box that fills the row,
with any column-declared filter dropdowns grouped at the right; the row wraps to stacked at phone
width. A column exposes text to the search with `searchValue` (falling back to `sortValue`), and
offers a dropdown with a `filter` descriptor. A row must pass every active filter and the search to
show. Pass `sortKey`/`sortDirection` to choose the starting sort — the table then owns it and emits
`wt-sort-change`. Give the table a `viewKey` and it remembers its sort and filter choices in the
tab's session storage (never the search text), ignoring a stored value that no longer fits the
columns. In tree mode the table keeps a match's ancestor rows and tells each cell, via its second
argument's `ancestorOnly`, whether the row is present only to hold a descendant's place — mute those
with a `part` on the cell.
```

- [ ] **Step 4: Verify the docs guard**

Run: `pnpm --filter @waitron/root test claude-md-pointers.test.ts` (or the repo's doc-pointer guard if named differently — check `scripts/claude-md-pointers.test.ts`). Expected: PASS (no new broken pointers).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/demo/main.ts docs/developers/design-system.md
git commit -s -m "Document the data table's toolbar and remembered view

Record the new search, filter, chosen-sort and remembered-view behaviour in
the design system's primitives table and a short note, and add a workbench
example that exercises them."
```

---

### Task 7: Strings

**Files:**
- Modify: `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**
- Produces: string keys the screen and widgets (Tasks 8–13) reference.

- [ ] **Step 1: Relabel the mode keys**

Change the **values** (both English and Spanish blocks) — keep the keys:
- `categories.mode_tree`: "Tree view" / "Vista de árbol"
- `categories.mode_flat`: "Flat view" / "Vista de lista"

- [ ] **Step 2: Add the new keys**

Add to both blocks (English shown; add the Spanish equivalents alongside, matching the file's paired structure):

```ts
"categories.edit_membership": "Edit product categories",
"categories.delete_named": "Delete {name}?",
"categories.filter_parent_all": "Any parent",
"categories.filter_reporting_all": "Any reporting category",
"categories.no_matches": "No categories match your search.",
"categories.products_no_matches": "No products match your search.",
"categories.select_all_products": "Select all products",
"categories.categories_label": "Categories",
"categories.categories_placeholder": "Choose categories",
"categories.combobox_search": "Search",
"categories.combobox_no_results": "No results",
```

Spanish: "Editar categorías del producto", "¿Eliminar {name}?", "Cualquier categoría superior", "Cualquier categoría de informes", "Ninguna categoría coincide con tu búsqueda.", "Ningún producto coincide con tu búsqueda.", "Seleccionar todos los productos", "Categorías", "Elige categorías", "Buscar", "Sin resultados".

- [ ] **Step 3: Remove the retired keys**

Delete from both blocks: `categories.select_all_visible`, `categories.delete_routes`, `categories.route_all_zones`, `categories.no_preparation`. First confirm no other consumer:

Run: `grep -rn "select_all_visible\|delete_routes\|route_all_zones\|no_preparation" apps packages`
Expected: hits only in `categories-screen.ts` (to be updated in Tasks 9/13) and `strings.ts`. If any other file references them, stop and reconcile.

- [ ] **Step 4: Verify the strings guard**

Run: `pnpm --filter @waitron/dashboard test` on the i18n guard if one exists (check for a `strings` or `i18n` test that asserts English and Spanish blocks have matching keys). Expected: PASS — every added/removed key is mirrored in both blocks.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/i18n/strings.ts
git commit -s -m "Update category strings for the overhaul

Relabel the two view-mode buttons to Tree view and Flat view, add the strings
the new toolbar, comboboxes and delete dialog need, and drop the printing-route
strings the delete preview no longer shows."
```

Note: Steps 3's grep will still show `categories-screen.ts` using the removed keys until Tasks 9/13 land. That is expected; commit the strings, and the screen tasks remove the last references. If the package typechecks keys strictly and this breaks the build before Task 9, do Task 7 immediately before Tasks 8–13 in one continuous stretch and keep the working tree building at each task's own commit by pairing the key removal (Step 3) with the screen edits — i.e. defer Step 3 to Task 13. **Decision: defer Step 3 (key removal) to the end of Task 13** so every commit builds. Steps 1–2 (relabel + add) commit here.

---

### Task 8: Categories screen — header row

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.ts`
- Test: `apps/dashboard/src/screens/categories-screen.test.ts`

**Interfaces:**
- Consumes: Task 7 strings (`categories.mode_tree`/`mode_flat` relabelled).
- Produces: the header layout later tasks render into.

- [ ] **Step 1: Write the failing test**

```ts
it("shows an Add category button and two labelled view-mode buttons in the header", async () => {
  const { el } = await mount();
  const add = el.shadowRoot!.querySelector('[data-test="create-category"]')!;
  expect(add.textContent).toContain(t("categories.create"));
  expect(el.shadowRoot!.querySelector('[data-test="mode-tree"]')!.textContent).toContain("Tree view");
  expect(el.shadowRoot!.querySelector('[data-test="mode-flat"]')!.textContent).toContain("Flat view");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: FAIL — the Add control is an icon-only round button (`aria-label`, no text); mode buttons say "Tree"/"Flat".

- [ ] **Step 3: Rework the header**

In `render()`, replace the heading block. Put the title, the two mode buttons, and a text Add button in one row. Move the mode toggle out of the `.filters` block (which is removed in Task 9) and into the header:

```ts
<div class="heading">
  <h1>${t("nav.categories")}</h1>
  <div class="header-actions">
    <div class="mode-toggle">
      <wt-button data-test="mode-tree"
        variant=${this.mode === "tree" ? "primary" : "secondary"}
        aria-pressed=${this.mode === "tree" ? "true" : "false"}
        @click=${() => this.#setMode("tree")}>${t("categories.mode_tree")}</wt-button>
      <wt-button data-test="mode-flat"
        variant=${this.mode === "flat" ? "primary" : "secondary"}
        aria-pressed=${this.mode === "flat" ? "true" : "false"}
        @click=${() => this.#setMode("flat")}>${t("categories.mode_flat")}</wt-button>
    </div>
    <wt-button data-test="create-category" variant="primary" @click=${() => this.#edit(null)}
      >${t("categories.create")}</wt-button>
  </div>
</div>
```

Add a `.header-actions` style (`display:flex; gap:var(--wt-space-3); align-items:center;`). Remove the old round-button import usage if `wt-icon`'s only use was the plus (check other uses before dropping the import).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: PASS. Update any existing test that asserted the round `+`/`aria-label=create` shape.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/screens/categories-screen.test.ts
git commit -s -m "Put the categories header controls in one row

The title now sits beside the two view-mode buttons and a labelled Add
category button, replacing the icon-only plus and the toggle that used to sit
below the search box."
```

---

### Task 9: Categories screen — table onto the primitive toolbar

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.ts`
- Test: `apps/dashboard/src/screens/categories-screen.test.ts`

**Interfaces:**
- Consumes: primitive Tasks 1–5 (`searchable`, `filter`, `viewKey`, `sortKey`, cell `ancestorOnly`).
- Produces: the categories table with remembered view and parent filter.

- [ ] **Step 1: Write the failing tests**

```ts
it("filters by parent in flat mode and hides the filter in tree mode", async () => {
  const { el } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!
    .querySelector('select[data-filter="parent"]')).not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-tree"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!
    .querySelector('select[data-filter="parent"]')).toBeNull();
});

it("defaults the categories table to sorting by name", async () => {
  const { el } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  expect(table.sortKey).toBe("name");
  expect(table.sortDirection).toBe("ascending");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: FAIL — the table has no toolbar or parent filter and no default sort.

- [ ] **Step 3: Move search/filter/ancestor logic into the table**

Remove from the screen: the `search` state, the `.filters` block wrapping the search `wt-input` and the mode toggle (mode moved in Task 8), `#matches()`, and the tree-ancestor walk in `render()`. Keep the tree/flat `mode` and `MODE_KEY`.

Pass rows straight through (`this.categories`) and let the table filter. Update `#columns`/`#treeColumns` so:
- The name column drops its `matchIds` parameter and reads `context.ancestorOnly` in the cell:

```ts
{
  key: "name",
  label: t("categories.name"),
  searchValue: (category) => this.#text(category.name),
  sortValue: (category) => this.#text(category.name),
  cell: (category, context) => this.#nameCell(category, context.ancestorOnly),
}
```

Change `#nameCell(category, matchIds)` to `#nameCell(category, ancestorOnly: boolean)` and use `ancestorOnly` for the mute (`this.mode === "tree" && ancestorOnly`).

- The parent column gains a `filter`:

```ts
{
  key: "parent",
  label: t("categories.parent"),
  sortValue: (category) => this.#parentPath(category) ?? "",
  cell: (category) => this.#parentPath(category) ?? t("categories.no_parent"),
  filter: {
    label: t("categories.parent"),
    allLabel: t("categories.filter_parent_all"),
    value: (category) => category.parentId ?? "",
    options: this.#parentFilterOptions(),
  },
}
```

with a helper listing categories that are some category's parent, labelled by path:

```ts
#parentFilterOptions(): { value: string; label: string }[] {
  const parentIds = new Set(
    this.categories.map((c) => c.parentId).filter((id): id is string => id !== null),
  );
  return this.categories
    .filter((c) => parentIds.has(c.id))
    .map((c) => ({ value: c.id, label: categoryPath(c, this.categories, currentLocale(), this.languages) }));
}
```

- The products column gains `sortValue: (category) => this.products.filter((p) => p.categoryIds.includes(category.id)).length`.

Set the table's inputs:

```ts
<wt-data-table
  aria-label=${t("nav.categories")}
  searchable
  searchLabel=${t("categories.search")}
  noMatchesMessage=${t("categories.no_matches")}
  viewKey="waitron.categories.table"
  sortKey="name"
  sortDirection="ascending"
  .rows=${this.categories}
  .columns=${this.mode === "tree" ? this.#treeColumns() : this.#columns()}
  .rowKey=${(category: CategorySummary) => category.id}
  .rowParent=${this.mode === "tree" ? this.#rowParent : undefined}
  collapseLabel=${t("categories.collapse")}
  expandLabel=${t("categories.expand")}
  .emptyMessage=${t("categories.empty")}
></wt-data-table>
```

Remove the now-unused `.filters` styles and the `name-muted` handling stays (cell still emits the `name-muted` part when `ancestorOnly`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: PASS. Fix any existing test that drove the old screen-owned search input (`name="category-search"`); it now types into the table's `.table-search`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/screens/categories-screen.test.ts
git commit -s -m "Move category search and filtering into the table

The categories table now uses the shared table's own search box, a Parent
filter that is present only in flat view, a remembered view and a default
name sort. The screen drops its hand-written search, match set and tree
ancestor walk."
```

---

### Task 10: Category form — parent combobox + content-language fix

**Files:**
- Modify: `apps/dashboard/src/widgets/category-form.ts`
- Modify: `apps/dashboard/src/screens/categories-screen.ts` (pass `.languages`)
- Test: `apps/dashboard/src/widgets/category-form.test.ts`

**Interfaces:**
- Consumes: `wt-combobox` (`options`, `value`, `wt-change`), `categoryPath`, `ContentLanguages`.
- Produces: `CategoryForm.languages: ContentLanguages` replacing `locales`.

- [ ] **Step 1: Write the failing test**

```ts
it("shows parent names in the reader's language, not the default content language", async () => {
  // default language Spanish, reader English; a parent has both names.
  const parent: CategorySummary = { id: "p", name: { es: "Bebidas", en: "Drinks" }, image: null, color: null, parentId: null };
  const el = await mountWidget<CategoryForm>("dashboard-category-form", {
    open: true,
    languages: { defaultLanguage: "es", languages: ["es", "en"] },
    categories: [parent],
    value: null,
  });
  // reader locale is English in the test harness; assert the combobox option reads "Drinks"
  const combo = el.el.shadowRoot!.querySelector('wt-combobox[name="category-parent"]')!;
  const labels = (combo as { options: { label: string }[] }).options.map((o) => o.label);
  expect(labels).toContain("Drinks");
  expect(labels).not.toContain("Bebidas");
});
```

(Confirm how the widget test harness sets the reader locale; if it defaults to `en`, the above holds. If not, set it explicitly the way other dashboard widget tests do.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/dashboard test category-form.test.ts`
Expected: FAIL — the parent control is a native `<select>` and resolves names with `this.locales[0]` (Spanish).

- [ ] **Step 3: Swap the property and the control**

Replace the `locales` property with `languages`:

```ts
@property({ attribute: false }) languages: ContentLanguages = { defaultLanguage: "en", languages: ["en"] };
```

Import `ContentLanguages` and `resolveEnabledContentText`/`currentLocale` as needed; import `wt-combobox`. Everywhere the code read `this.locales`, read `this.languages.languages` (the name-input `map`, the `locales[0]` required marker → `this.languages.languages[0]`, the validation language). Resolve `categoryPath` with the reader's language:

```ts
const path = (category: CategorySummary) =>
  categoryPath(category, this.categories, currentLocale(), this.languages);
```

Replace the parent `<label><select>…` with:

```ts
<wt-combobox
  name="category-parent"
  label=${t("categories.parent")}
  .disabled=${this.busy}
  .options=${[
    { value: "", label: t("categories.no_parent") },
    ...this.#parents().map((c) => ({ value: c.id, label: path(c) })),
  ]}
  .value=${this.parentId ?? ""}
  .error=${errors.parent ?? ""}
  searchPlaceholder=${t("categories.combobox_search")}
  noResultsLabel=${t("categories.combobox_no_results")}
  @wt-change=${(event: CustomEvent<{ value: string }>) => {
    event.stopPropagation();
    this.parentId = event.detail.value || null;
  }}
></wt-combobox>
```

In `categories-screen.ts`, change `.locales=${this.languages.languages}` on `<dashboard-category-form>` to `.languages=${this.languages}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/dashboard test category-form.test.ts`
Expected: PASS. Update existing form tests that referenced `name="category-parent"` as a `<select>` (option elements → combobox `options`).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/category-form.ts apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/widgets/category-form.test.ts
git commit -s -m "Make the parent picker a searchable combobox in the reader's language

The category form's parent field becomes a single-select combobox, and it now
receives the full content-language settings so parent names read in the
signed-in person's language with the usual fallback, instead of always the
venue's default language."
```

---

### Task 11: Membership picker — comboboxes + lozenges + content-language fix

**Files:**
- Modify: `apps/dashboard/src/widgets/category-membership-picker.ts`
- Modify: `apps/dashboard/src/screens/categories-screen.ts` (pass `.languages`)
- Test: `apps/dashboard/src/widgets/category-membership-picker.test.ts`

**Interfaces:**
- Consumes: `wt-combobox` (`multiple`, `values`, single-select), `wt-lozenge`, `categoryPath`, `ContentLanguages`.
- Produces: `CategoryMembershipPicker.languages` replacing `locales`; unchanged `wt-submit` detail (`{ value: ProductCategories }`).

- [ ] **Step 1: Write the failing tests**

```ts
it("emits the chosen category ids and reporting id from the comboboxes", async () => {
  const cats: CategorySummary[] = [
    { id: "food", name: { en: "Food" }, image: null, color: "#112233", parentId: null },
    { id: "drink", name: { en: "Drinks" }, image: null, color: null, parentId: null },
  ];
  const el = await mountWidget<CategoryMembershipPicker>("dashboard-category-membership-picker", {
    categories: cats,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: { categoryIds: ["food"], primaryCategoryId: "food" },
  });
  // multi-select the drink category
  const multi = el.el.shadowRoot!.querySelector('wt-combobox[data-test="member-categories"]')! as any;
  multi.values = ["food", "drink"];
  multi.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["food", "drink"] }, bubbles: true, composed: true }));
  await el.el.updateComplete;
  const events: { value: ProductCategories }[] = [];
  el.el.addEventListener("wt-submit", (e) => events.push((e as CustomEvent).detail));
  el.el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(events[0].value.categoryIds.sort()).toEqual(["drink", "food"]);
});

it("shows the chosen categories as lozenges", async () => {
  const cats: CategorySummary[] = [{ id: "food", name: { en: "Food" }, image: null, color: "#112233", parentId: null }];
  const el = await mountWidget<CategoryMembershipPicker>("dashboard-category-membership-picker", {
    categories: cats,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: { categoryIds: ["food"], primaryCategoryId: "food" },
  });
  expect(el.el.shadowRoot!.querySelectorAll("wt-lozenge").length).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/dashboard test category-membership-picker.test.ts`
Expected: FAIL — checkboxes/select, no `data-test="member-categories"`, no lozenges.

- [ ] **Step 3: Replace the fieldset and select with comboboxes**

Replace `locales` with `languages: ContentLanguages`; import `wt-combobox`, `wt-lozenge`, `currentLocale`. Keep the `draft` state and the `#change` selection rules but drive them from the multi-select. Rework `render()`:

```ts
const path = (c: CategorySummary) => categoryPath(c, this.categories, currentLocale(), this.languages);
const chosen = this.categories.filter((c) => this.draft.categoryIds.includes(c.id));
return html`
  <wt-combobox
    data-test="member-categories"
    multiple
    label=${t("categories.categories_label")}
    placeholder=${t("categories.categories_placeholder")}
    .disabled=${this.busy}
    .options=${this.categories.map((c) => ({ value: c.id, label: path(c) }))}
    .values=${[...this.draft.categoryIds]}
    @wt-change=${(event: CustomEvent<{ values: string[] }>) => {
      event.stopPropagation();
      this.#setCategories(event.detail.values);
    }}
  ></wt-combobox>
  <div class="chips">
    ${chosen.map((c) => html`<wt-lozenge color=${c.color ?? ""}>${path(c)}</wt-lozenge>`)}
  </div>
  <wt-combobox
    data-test="reporting-category"
    label=${t("editor.reporting_category")}
    placeholder=${t("categories.none")}
    .disabled=${this.busy || this.draft.categoryIds.length === 0}
    .options=${[{ value: "", label: t("categories.none") }, ...chosen.map((c) => ({ value: c.id, label: path(c) }))]}
    .value=${this.draft.primaryCategoryId ?? ""}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      this.draft = { ...this.draft, primaryCategoryId: event.detail.value || null };
    }}
  ></wt-combobox>
  <wt-form-actions>…existing cancel/save buttons…</wt-form-actions>`;
```

Replace `#change(event, id)` with `#setCategories(ids: string[])`, preserving the existing rules (the diff from `draft.categoryIds` decides first-pick-becomes-reporting; removing the reporting category clears it; emptying clears it):

```ts
#setCategories(ids: string[]): void {
  let primary = this.draft.primaryCategoryId;
  const added = ids.filter((id) => !this.draft.categoryIds.includes(id));
  if (ids.length === 0) primary = null;
  else if (this.draft.categoryIds.length === 0 && added.length === 1) primary = added[0]!;
  else if (primary && !ids.includes(primary)) primary = null;
  this.draft = { categoryIds: ids, primaryCategoryId: primary };
}
```

Add a `.chips` style (`display:flex; flex-wrap:wrap; gap:var(--wt-space-2);`).

In `categories-screen.ts`, change `.locales=${this.languages.languages}` on `<dashboard-category-membership-picker>` to `.languages=${this.languages}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test category-membership-picker.test.ts`
Expected: PASS. Update existing tests that toggled checkboxes/`name="primary-category"` select.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/category-membership-picker.ts apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/widgets/category-membership-picker.test.ts
git commit -s -m "Rebuild the membership editor around comboboxes

Editing a product's categories now uses a multi-select combobox with the
chosen categories shown as coloured chips, and a single-select for the
reporting category limited to the chosen ones. Names read in the reader's
language. The first-pick and remove-reporting rules are unchanged."
```

---

### Task 12: Products dialog — Close button, shared columns, select-all

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.ts`
- Test: `apps/dashboard/src/screens/categories-screen.test.ts`

**Interfaces:**
- Consumes: primitive `selectable`/`selected`/`wt-selection-change`, `searchable`, `viewKey`.
- Produces: a shared product-columns helper reused by Task 13.

- [ ] **Step 1: Write the failing tests**

```ts
it("closes the products dialog from a footer Close button", async () => {
  const { el } = await mount();
  // open a category's product dialog
  // (drive the existing path that sets this.selected — e.g. click the name button)
  el.shadowRoot!.querySelector<HTMLElement>('wt-button[data-category="food"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="close-products"]')!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('wt-modal[data-test="products-modal"]')!.open).toBe(false);
});

it("adds products using the table's own select-all", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('wt-button[data-category="drink"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector('[data-test="category-add-products"]')! as any;
  table.shadowRoot.querySelector('[data-test="select-all"]').click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
  await vi.waitFor(() => expect(api.addProductsToCategory).toHaveBeenCalled());
});
```

(Adjust selectors to the real ones; the intent is Close closes, and select-all → add calls the API.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: FAIL — no Close button; add-products uses hand-rolled checkboxes.

- [ ] **Step 3: Add a shared product-columns helper and rework the dialog**

Add one helper producing the shared columns (Name searchable+sortable, Reporting category sortable + filter, Other categories), taking the trailing column as an argument:

```ts
#productColumns(trailing?: DataTableColumn<Product>): DataTableColumn<Product>[] {
  const base: DataTableColumn<Product>[] = [
    { key: "name", label: t("categories.name"),
      cell: (p) => this.#text(p.descriptions),
      searchValue: (p) => this.#text(p.descriptions),
      sortValue: (p) => this.#nameSortValue(p) },
    { key: "primary", label: t("editor.reporting_category"),
      cell: (p) => this.#reportingCell(p),
      sortValue: (p) => this.#reportingSortValue(p),
      filter: {
        label: t("editor.reporting_category"),
        allLabel: t("categories.filter_reporting_all"),
        value: (p) => p.primaryCategoryId ?? "",
        options: this.#reportingFilterOptions(),
      } },
    { key: "other", label: t("categories.other_categories"), cell: (p) => this.#otherCategoriesCell(p) },
  ];
  return trailing ? [...base, trailing] : base;
}

#reportingFilterOptions(): { value: string; label: string }[] {
  const ids = new Set(this.products.map((p) => p.primaryCategoryId).filter((id): id is string => !!id));
  return this.categories.filter((c) => ids.has(c.id))
    .map((c) => ({ value: c.id, label: this.#text(c.name) }));
}
```

Rebuild `#memberColumns()` as `this.#productColumns(<row-actions column with "Edit product categories" + "Remove">)`, and delete `#addColumns()`'s hand-rolled `pick` column — the add table uses `this.#productColumns()` plus the primitive's selection.

Member view: give the `wt-data-table` `searchable`, `searchLabel`, `viewKey="waitron.categories.members.table"`. Remove the screen's own `productSearch` input above it (the table now owns search). Add a footer with a Close button to the products `wt-modal`:

```ts
<wt-form-actions slot="footer">
  <wt-button data-test="close-products" variant="secondary"
    @click=${() => { this.selected = null; this.addingProducts = false; this.picked = new Set(); }}
    >${t("action.close")}</wt-button>
</wt-form-actions>
```

(Confirm `action.close` exists; if not, add it in Task 7.)

Add view: replace the checkbox column + "Select all visible" label. Give the add table:

```ts
<wt-data-table
  data-test="category-add-products"
  aria-label=${t("categories.add_products")}
  searchable
  searchLabel=${t("categories.search_products")}
  noMatchesMessage=${t("categories.products_no_matches")}
  viewKey="waitron.categories.add.table"
  selectable
  .selected=${[...this.picked]}
  .selectionLabel=${(p: Product) => `${t("categories.add_products")}: ${this.#text(p.descriptions)}`}
  selectAllLabel=${t("categories.select_all_products")}
  @wt-selection-change=${(e: CustomEvent<{ selected: string[] }>) => { this.picked = new Set(e.detail.selected); }}
  .rows=${addRows}
  .columns=${this.#productColumns()}
  .rowKey=${(p: Product) => p.id}
  .emptyMessage=${t("categories.no_products")}
></wt-data-table>
```

Keep `addRows` as the products not already in the category (the search is now the table's, so drop the screen-side `productSearch` filtering of `addRows`/`members` — pass the full lists and let the table filter). Remove `#togglePick`, `#toggleAllPicked`, `productSearch`, and the `allVisiblePicked` computation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: PASS. Update tests that used `data-test="pick-*"`, `select-all-visible`, or the screen's `category-product-search`/`add-category-product-search` inputs.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/screens/categories-screen.test.ts
git commit -s -m "Share one product table across the category dialogs

The products dialog gains a Close button, its member and add lists are built
from one column set with search and a reporting-category filter, and adding
products now uses the table's own select-all and per-row checkboxes instead of
a hand-written checkbox column."
```

---

### Task 13: Delete confirmation — reshape, drop routes

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (Task 7 Step 3, deferred key removal)
- Test: `apps/dashboard/src/screens/categories-screen.test.ts`

**Interfaces:**
- Consumes: Task 12's `#productColumns`, the `CategoryDependants` payload.
- Produces: final delete dialog; last references to removed strings gone.

- [ ] **Step 1: Write the failing tests**

```ts
it("titles the delete dialog with the category name and lists no routes", async () => {
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue({
    products: [{ id: "p", name: { en: "Toast" }, reporting: true }],
    children: [], parentId: null, routes: [{ id: "r", station: "Pass", zone: null }],
  });
  // open delete for "Food"
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
  await el.updateComplete;
  // drive the row action that calls #openDelete(food) …
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector('[data-test="delete-dialog"]')).not.toBeNull());
  const dialog = el.shadowRoot!.querySelector('[data-test="delete-dialog"]')!;
  expect(dialog.getAttribute("heading")).toContain("Food");
  expect(dialog.textContent).not.toContain("route");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: FAIL — heading is generic; routes are still listed.

- [ ] **Step 3: Reshape the delete dialog**

Change the modal heading to `t("categories.delete_named").replace("{name}", this.deleting ? this.#text(this.deleting.name) : "")` and add `data-test="delete-dialog"`. In `#renderDependants()`, delete the routes section entirely (the `dependants.routes` block). Replace the products `<ul>` with the shared product table over resolved full products:

```ts
const affected = dependants.products
  .map((p) => this.products.find((product) => product.id === p.id))
  .filter((p): p is Product => p !== undefined);
// render: a wt-data-table with this.#productColumns() (no trailing column), searchable optional,
// viewKey="waitron.categories.delete.table", rows=affected. The reporting cell already flags a
// product whose primaryCategoryId === this.deleting.id via #reportingCell / a danger part.
```

Keep the "this cannot be undone" intro and the child-categories sentence. Keep the Delete button disabled until `this.dependants` is set (unchanged gating) and the generation guard.

Ensure the reporting cell marks a to-be-cleared product: the shared `#reportingCell` shows the reporting category; add a danger annotation when `product.primaryCategoryId === this.deleting?.id`. Since `#reportingCell` is shared, gate the annotation on a deletion being open, or add a dedicated delete-preview trailing note column. Simplest: pass an optional `flagCleared` into `#productColumns` used only by the delete table that adds a danger span to the reporting cell when the product's reporting category is the one being deleted.

- [ ] **Step 4: Remove the retired string keys (Task 7 Step 3)**

Now that no screen code references them, delete `categories.delete_routes`, `categories.route_all_zones`, `categories.no_preparation`, and `categories.select_all_visible` from both blocks of `strings.ts`.

Run: `grep -rn "select_all_visible\|delete_routes\|route_all_zones\|no_preparation" apps packages`
Expected: no hits.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @waitron/dashboard test categories-screen.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/categories-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/categories-screen.test.ts
git commit -s -m "Reshape the delete confirmation and drop its route list

Deleting a category now reads Delete <name>? over the warning and the affected
products shown in the shared product table, with the ones that lose their
reporting category flagged. The printing-route list is gone, since routes are
removed without confirmation, and its strings are deleted."
```

---

### Task 14: Screen a11y + visual pass

**Files:**
- Modify: `apps/dashboard/src/screens/categories-screen.a11y.test.ts`
- Verify: rendered screen in both themes at phone width.

**Interfaces:**
- Consumes: the finished screen.
- Produces: an axe pass over the new states; a recorded visual check.

- [ ] **Step 1: Extend the a11y test**

Ensure the existing `categories-screen.a11y.test.ts` still covers the header, the products dialog (member and add views), the membership editor (comboboxes + lozenges) and the delete dialog, in both themes. Add cases for any state not already covered (the add-products selectable table; the combobox membership editor open).

Run: `pnpm --filter @waitron/dashboard test categories-screen.a11y.test.ts`
Expected: PASS in light and dark.

- [ ] **Step 2: Open the screen and look**

The `apps/dashboard` package is browser-mode, so mount the screen in the workbench/dev stack and view it at phone width (~400px) in both themes. Confirm: the header row wraps sanely; the table toolbar's search fills the row with the filter at the right and wraps on narrow width; the membership comboboxes and lozenges render; the delete dialog reads correctly. This is the "open it and LOOK" rule — string assertions do not prove a screen renders.

- [ ] **Step 3: Commit any fixes**

```bash
git add apps/dashboard/src/screens/categories-screen.a11y.test.ts
git commit -s -m "Cover the reworked category screen states with axe

Extend the accessibility pass to the new header, the combobox membership
editor and the reshaped delete dialog in both themes, after checking the
screen renders at phone width."
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- A1 toolbar search → Task 2. A1 filters → Task 3. A2 public sort → Task 1. A3 stored view → Task 5. A4 cell context → Task 4. A5 primitive tests → Tasks 1–5 (behaviour) + Task 3 (a11y toolbar) + Task 6 (demo/docs). ✓
- B1 header → Task 8. B2 categories table → Task 9. B3 content-language (form) → Task 10, (membership) → Task 11. ✓
- C1 parent combobox → Task 10. C2 membership comboboxes + lozenges → Task 11. C3 row-action label → Task 12 (the member-list trailing column). ✓
- D1 shared product columns → Task 12. D2 Close → Task 12. D3 add-products selectable → Task 12. ✓
- E delete reshape + drop routes → Task 13. ✓
- Strings → Task 7 (+ deferred removal in Task 13). ✓
- Testing (visual/a11y) → Task 14, plus per-task tests. ✓

**Placeholder scan:** No "TBD/handle edge cases/similar to Task N". Two explicit "confirm X exists" checks (the `--wt-space-9` token in Task 2; `action.close` in Task 12) are verification steps with a stated fallback, not deferred work.

**Type consistency:** `sortKey: string | null`, `sortDirection: SortDirection`, `wt-sort-change` detail, `DataTableColumn.filter`/`searchValue`, and the `cell(row, context)` second argument are defined once (Tasks 1–4) and used with the same names in Tasks 9, 12, 13. `languages: ContentLanguages` replaces `locales` consistently in Tasks 10–11 and both screen call sites are updated. `#productColumns` is defined in Task 12 and reused in Task 13.

**Known risk to watch during execution:** the strict i18n key-mirroring guard means Task 7's key **removal** must land with the last screen reference (deferred to Task 13). This is called out in both tasks. Tasks 8–13 should run in one continuous stretch so the working tree builds at each commit.

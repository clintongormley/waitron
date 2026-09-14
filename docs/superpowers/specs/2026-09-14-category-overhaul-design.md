# Category management overhaul — design

Status: approved for planning (owner, 2026-09-14)

> **Note (2026-09-14, after two review fix rounds).** The text below is the design as approved. The
> built branch differs from it in these places; the code and the pointers named here decide.
>
> - **A1, toolbar wrap.** There is no phone breakpoint. The search box's flex basis is eight tap
>   targets (`calc(var(--wt-tap-min) * 8)`); when it and the dropdowns cannot share a line at that
>   width, the dropdowns wrap below and the search box takes its line alone. A media or container
>   query cannot read a `--wt-*` token. See the comment on `.table-search` in
>   `packages/ui/src/components/wt-data-table.ts` and design-system.md → "Remembered, searchable,
>   filterable tables".
> - **A2 and A3, stored sort.** A stored sort column is used only if a current column can sort by
>   it, and its direction only together with that column; otherwise the consumer's `sortKey` and
>   `sortDirection` stand (not "unsorted", when the consumer passes a `sortKey`).
> - **A3, when the view is restored.** Not on `connectedCallback`: the table reads storage once it
>   has columns, whenever `viewKey` or `columns` change (`willUpdate`).
> - **A3, stale filter values.** A filter choice, stored or picked, is checked each time the columns
>   change, not only at restore. One whose column offers options that do not include it is cleared,
>   and the stored view is saved without it. One whose column is not rendered, has no `filter`, or
>   has an empty option list is kept but hides no rows, stays in storage, and is checked when the
>   column next offers options — so the Parent filter survives the tree view, which has no Parent
>   column. See design-system.md (same section) and docs/developers/product-categories.md.
> - **A4, the cell's second argument** is required, not optional:
>   `cell: (row: Row, context: { ancestorOnly: boolean }) => unknown`. A one-argument cell function
>   is still accepted by TypeScript; a function requiring a third parameter is refused. See the note
>   in the plan's Task 3.
> - **Strings.** `categories.filter_parent_all` is "All parents" / "Todas las categorías
>   superiores" and `categories.filter_reporting_all` is "All reporting categories" / "Todas las
>   categorías de informes", matching the other screens' filters. The header button uses
>   `categories.add` ("Add category" / "Añadir categoría"). See
>   `apps/dashboard/src/i18n/strings.ts`.

The categories screen and its dialogs get a consistent, filterable, sortable layout, and the two
capabilities that make that possible — a search-and-filter toolbar, and a remembered view — move
into the `wt-data-table` primitive so every table across the dashboard can reuse them. Along the way
two long-standing content-language bugs on this screen get fixed.

This is a UI-only change. No server route, SQL, grant, migration or fiscal path is touched. The one
server-adjacent edit is deleting three now-unused string keys and adding new ones.

## Why now

The owner walked the current screen and listed what is wrong with it: a cramped round `+` where a
labelled button belongs, a view toggle buried below the search box, tables that neither sort nor
filter, parent names shown in the venue's default language (Spanish) instead of the reader's, a
parent dropdown that should be a searchable combobox, a products dialog with a missing close button
and a hand-rolled select-all, and a delete confirmation whose shape does not match the add-products
layout. Rather than fix these on this one screen, the reusable parts land in the primitive.

## Part A — `wt-data-table` gains a toolbar and a remembered view

Today `wt-data-table` (`packages/ui/src/components/wt-data-table.ts`) holds its sort as private
`@state` and renders only the table. It already supports tree mode (`rowParent`) and controlled
selection (`selectable` / `selected` / `wt-selection-change`). Three capabilities are added. All are
opt-in, so every existing consumer (printers, units, payments, staff-list) renders exactly as before
when it passes none of the new inputs.

### A1. Toolbar: search and filters in one row

New inputs:

- `searchable` (boolean) — renders a search box above the table.
- `searchPlaceholder` / `searchLabel` — the box's placeholder and its accessible label.
- Each `DataTableColumn` may add `searchValue?: (row) => string`. When `searchable` is on, a row
  matches the typed text if any column's `searchValue` (falling back to that column's `sortValue`,
  coerced to a string) contains the text, case-insensitively and locale-lowercased.
- Each `DataTableColumn` may add a `filter`:

  ```ts
  filter?: {
    label: string;                    // the dropdown's accessible label
    allLabel: string;                 // the "any value" option, which is the default
    value: (row: Row) => string;      // the row's value for this filter
    options: { value: string; label: string }[];  // selectable values, in display order
  };
  ```

  Every rendered column that carries a `filter` gets one dropdown. A row passes a filter when its
  `value(row)` equals the selected option, or when "all" is selected. Multiple active filters are
  combined with AND, then the search text is applied on top.

**Layout.** The toolbar is a single flex row directly above the table, with a gap below it before
the table. The search box has `flex: 1` and fills the space on the left; the filter dropdowns sit in
a group at the right edge at their natural width. At narrow width (the same phone breakpoint the rest
of the design system uses) the row wraps: the search box takes the full width on the first line and
the dropdowns flow onto the line below. The search box and dropdowns are painted from `--wt-*` tokens
only (the `no-hardcoded-chrome` guard scans this file). Dropdowns are native `<select>` elements
styled from tokens — native selects are keyboard- and screen-reader-accessible with no extra ARIA,
which keeps the axe pass clean; `wt-combobox` stays reserved for form fields, matching how the staff,
printers and payments screens already render their filter rows.

**Filtering interacts with tree mode.** When a search or filter narrows a tree-mode table, an
ancestor row that does not itself match must still be shown so a matching descendant is not orphaned
as a false top-level row, and those ancestor-only rows are muted. The categories screen does this by
hand today (the ancestor walk in `render()` and the `name-muted` part). That logic moves into the
primitive: after computing which rows match, the table walks each match's `rowParent` chain, adds the
ancestors, and marks ancestor-only rows so the caller's cell can mute them. The table exposes which
rows are ancestor-only via a cell argument (see A4) so the screen no longer needs its own match set.

**Empty vs no-match.** A new `noMatchesMessage` covers "rows exist but the search or filters exclude
them all", kept distinct from `emptyMessage` ("there are no rows at all"). With no toolbar, only
`emptyMessage` is ever shown, unchanged.

### A2. Sort as public, defaultable state

`sortKey` and `sortDirection` (`"ascending" | "descending"`) become `@property` inputs with defaults
(current defaults: no column, ascending). A consumer sets them to choose the starting sort — the
categories screen passes Name ascending. The table still owns the live sort and flips it on header
click, but now emits `wt-sort-change` (`detail: { sortKey: string | null; sortDirection }`) on every
change. A stored/default `sortKey` naming a column with no `sortValue`, or one that no longer exists,
is ignored (falls back to unsorted, i.e. original row order).

### A3. Remembered view (session storage) — the reusable part

New input `viewKey?: string`. When set, the table persists its **sort column, sort direction and
filter selections** to `sessionStorage` under that key, and restores them on `connectedCallback`.
Rules:

- **Search text is never stored.** Reopening a screen must not silently hide rows behind a phrase the
  operator has forgotten typing.
- **First visit** uses the `sortKey` / `sortDirection` defaults and every filter at "all".
- **Stale values are ignored:** a stored sort column or filter option that no longer matches a
  current column/option is dropped, not applied. A malformed or unreadable store falls back to
  defaults. Every read and write is wrapped so a browser with storage blocked still works (the same
  discipline `login-preference.ts` and the screen's existing `MODE_KEY` use).
- **No `viewKey` means nothing is stored** — existing consumers are unaffected.

Session storage (not local) is deliberate: a remembered sort is a within-session convenience, and
`sessionStorage` is per-tab, so two tabs open on the same screen do not fight over one key. The
storage read/write lives inside the primitive; there is no separate helper for consumers to wire up.
(The tree/flat toggle stays the screen's own concern in `localStorage` — it is a layout choice, not a
table view, and predates this.)

### A4. Cell context for ancestor muting

Because the primitive now owns the match/ancestor computation, a cell callback needs to know whether
its row is an ancestor-only row. `DataTableColumn.cell` gains an optional second argument:
`cell: (row: Row, context: { ancestorOnly: boolean }) => unknown`. Existing single-argument cells
keep working (the extra argument is simply ignored). The categories name cell reads
`context.ancestorOnly` to decide muting, replacing the screen's own match set.

### A5. Tests for Part A

Per the design system's "new primitive behaviour needs a token-painting test and an axe test" rule:

- Toolbar renders search + one dropdown per filtered column; typing narrows rows; selecting a filter
  narrows rows; search and filter combine with AND.
- Sort defaults apply on first render; a header click emits `wt-sort-change`; `sortKey`/`sortDirection`
  inputs set the initial sort.
- `viewKey` restores a stored sort and filter on reconnect; search text is not restored; a stale
  stored value is ignored; storage throwing does not break the table (proven by a throwing stub).
- Tree mode keeps and marks ancestor-only rows under an active filter; `noMatchesMessage` shows when
  everything is filtered out; `emptyMessage` still shows with zero rows.
- An `*.a11y.test.ts` axe pass over the toolbar (search + filters) in both themes.
- The Primitives table in `design-system.md` and a short "Remembered table view" note are updated;
  `packages/ui/demo/main.ts` gains a searchable/filterable example so the workbench exercises it.

## Part B — the categories screen

`apps/dashboard/src/screens/categories-screen.ts`.

### B1. Header row

One heading row: the "Categories" title on the left; immediately to its right the view toggle as two
buttons, **"Tree view"** and **"Flat view"**, each with `aria-pressed` reflecting the current mode
(reusing the existing `mode` state and `MODE_KEY` storage); and at the far right an
**"Add category"** primary text button (replacing the round `+`). The existing `categories.mode_tree`
/ `categories.mode_flat` keys keep their names and only their **values** change to "Tree view" /
"Flat view" (and the Spanish equivalents), so there is no key churn here.

### B2. Categories table

The screen stops owning search state, the match computation and the ancestor walk. It passes:

- `searchable`, with `searchLabel = t("categories.search")`;
- Name column: `sortValue` = translated name, `searchValue` = translated name, and its cell reads
  `context.ancestorOnly` to mute ancestor-only rows;
- Parent column (flat mode only, as today): `sortValue` already present, plus a `filter` whose
  options are the categories that are some category's parent, labelled by translated path, with
  `allLabel = t("categories.filter_parent_all")`. Because the Parent column is absent in tree mode,
  its dropdown is automatically absent there — no special case.
- Products (count) column: gains a `sortValue` (the count) so it sorts.
- `viewKey = "waitron.categories.table"`, `sortKey = "name"`, `sortDirection = "ascending"`.

### B3. Content-language fix (parent names)

`categoryPath` in `category-form.ts` already accepts a `ContentLanguages` config and resolves with
the reader's language first. The screen's own `#parentPath` uses it correctly. The bug is in the
**form** and **membership picker**, which call `categoryPath(category, categories, this.locales[0])`
— `locales[0]` is the default (Spanish) language, so parent/category names there ignore the reader's
language. Both widgets will instead receive the full `ContentLanguages` config and pass it to
`categoryPath`, so names resolve to the reader's language with the content-language fallback, exactly
as the table already does. See Part C.

## Part C — category form and membership picker

### C1. Parent picker → single-select combobox

In `category-form.ts`, the native `<select>` for parent becomes a single-select `wt-combobox`:

- `options` = the eligible parents (the existing `#parents()` exclusion of self + descendants),
  labelled by translated path using the reader's language; plus a leading "No parent" option
  (`value: ""`).
- `value` = current `parentId ?? ""`; on `wt-change`, set `parentId` to the value or `null`.
- Field error wiring (`category.parent_cycle` → `parent`) is preserved via the combobox's `error`.
- The widget's current `locales: readonly string[]` property is replaced by
  `languages: ContentLanguages`. The per-locale name inputs iterate `languages.languages` (same list
  as before), and `categoryPath` is called with the full config so parent names resolve in the
  reader's language. The screen already holds this config (`this.languages`) and passes
  `.locales=${this.languages.languages}` today; it will pass `.languages=${this.languages}` instead.

### C2. Membership editor → comboboxes (the "Edit product categories" dialog)

`category-membership-picker.ts` today renders a checkbox fieldset for categories and a native select
for the reporting category. It becomes:

- **Categories:** a multi-select `wt-combobox` (`multiple`, `values` = chosen ids, options = all
  categories by translated path). Beneath it, the chosen categories are shown as `wt-lozenge` chips
  (each in its category colour) so the closed trigger's "N selected" is not the only signal of what
  is chosen.
- **Reporting category:** a single-select `wt-combobox` whose options are only the currently chosen
  categories (plus a "None" option), disabled when nothing is chosen.
- The existing selection rules are preserved exactly: choosing the first category makes it the
  reporting category; removing a category that was the reporting one clears the reporting value;
  clearing all categories clears the reporting value. These currently live in `#change`; the same
  logic runs on the multi-select's `wt-change`.
- Names resolve in the reader's language (Part C, `languages` config).

### C3. The row action label

In the products dialog member table, the row's edit action reads **"Edit product categories"**
(`t("categories.edit_membership")`), not the generic "Edit".

## Part D — the products dialog

The `wt-modal` opened by selecting a category (`this.selected`). It shows either the member list or
the add-products view.

### D1. Shared product table

All three product tables — member list, add-products list, and the delete preview's affected-products
list — are built from **one** column-set helper so they cannot drift. Columns: Name (sortable,
searchable), Reporting category (sortable, with a `filter` over reporting categories), Other
categories, and a per-context trailing column (row actions for the member list; nothing for the
delete preview; the add-products list uses the table's own selection column, see D3). Each table is
`searchable` with a `viewKey` of its own
(`waitron.categories.members.table`, `.add.table`, `.delete.table`).

**All three tables operate on the same row type, the full `Product`.** The member list and
add-products list already do (`this.products`, filtered). The delete preview's payload
(`CategoryDependants["products"]`) is only ids plus a `reporting` flag, so the screen resolves each
dependant id to its full `Product` from `this.products` (skipping any that no longer resolve) before
handing the rows to the shared helper. The "reporting category will be cleared" flag is then derived
on the client as `product.primaryCategoryId === deleting.id`, which is exactly what the server's
`reporting` flag means — so the shared Reporting-category cell can annotate it without a second code
path. This removes the delete preview's dependence on the server flag for rendering.

### D2. Member list — Close button

The products dialog gains a **Close** button in a `wt-form-actions` footer (the button the owner
found missing). It closes the dialog (same effect as the existing `wt-close`). The dialog keeps its
busy-guard on Escape and close.

### D3. Add-products view — the table owns selection

The hand-rolled checkbox column (`#addColumns`' `pick` cell) and the separate "Select all visible"
label are removed. The add-products table uses the primitive's `selectable` mode: `selected` =
`[...this.picked]`, `selectionLabel` naming each product, and `wt-selection-change` updates
`this.picked`. The header select-all checkbox is the primitive's own; it selects/clears the currently
visible (searched/filtered) rows, since the primitive's select-all already operates on visible keys.
The footer keeps Cancel (back to the member list) and the "Add N products" primary button.

**Behaviour preserved:** as today, `this.picked` accumulates across searches — a product picked, then
hidden by a later search term, stays picked — and "Add N products" adds the whole `picked` set
(`#addPicked`'s `[...this.picked]`), not only what is currently visible. The count on the button is
`this.picked.size`, unchanged. This is the existing behaviour; the only change is where the checkboxes
come from.

## Part E — the delete confirmation

The delete `wt-modal` is reshaped to match the add-products layout plus a warning:

- **Heading:** "Delete {name}?" (`categories.delete_named`, interpolating the translated name),
  replacing the generic "Delete this category?" plus a separate name paragraph.
- **Warning + consequences:** the existing "cannot be undone" intro and the child-categories sentence
  are kept. The **printing-routes** section is removed from the preview — the owner confirmed routes
  may be removed without confirmation, and the server already deletes them in the same transaction
  (`deleteCategory` step 4 in `packages/catalogue/src/categories.ts`). So the preview no longer needs
  `dependants.routes`, and the route-related string keys and the routes list rendering are removed.
- **Affected products** are shown in the shared product table (Part D1, no row actions), the rows
  resolved to full `Product` records as D1 describes, with the reporting-category column flagging
  products whose reporting category will be cleared.
- **Footer:** Cancel and a danger **Delete**, still disabled until the dependants preview has loaded
  (the existing `dependants === null` / `dependantsError` gating and generation guard are unchanged).

Server note: `getCategoryDependants` still returns `routes`; the screen simply stops rendering them.
No server change is required or made. (Leaving the field returned but unused is deliberate — trimming
the query is out of scope and would touch `packages/catalogue`, which this UI change should not.)

## Strings

`apps/dashboard/src/i18n/strings.ts` (English and Spanish blocks both):

- **Change value only (keep key):** `categories.mode_tree` → "Tree view", `categories.mode_flat` →
  "Flat view" (and Spanish).
- **Add:** `categories.edit_membership` ("Edit product categories"), `categories.delete_named`
  ("Delete {name}?"), `categories.filter_parent_all` ("Any parent"),
  `categories.filter_reporting_all` ("Any reporting category"), `categories.no_matches` ("No
  categories match your search."), `categories.products_no_matches` ("No products match your
  search."), `categories.select_all_products` (the add-products table's `selectAllLabel`), plus the
  membership combobox labels (`categories.categories_label`, `categories.categories_placeholder`, and
  the combobox search/no-results labels as needed).
- **Remove:** `categories.select_all_visible` (the table's own select-all replaces it),
  `categories.delete_routes`, `categories.route_all_zones`, `categories.no_preparation` (routes no
  longer shown). Confirm each removed key has no other consumer before deleting
  (`grep` the key across the repo — the string-key guard will also flag an orphan).

## Testing

Behavioural tests (browser-mode, `apps/dashboard`), each asserting a behaviour that deletion of the
code would break:

1. **Remembered view:** sort the categories table by a column, reopen the screen, the sort is
   restored from session storage; the Name default applies on a cleared store; typed search text is
   **not** restored.
2. **Parent filter** in flat mode narrows the table; the dropdown is absent in tree mode.
3. **Select-all header** in add-products selects every visible row; a row picked and then hidden by a
   later search term stays picked, and "Add N products" adds the whole picked set (the preserved
   accumulate-across-search behaviour).
4. **Content language:** with Spanish as the default content language and English as the reader's,
   the parent combobox and the membership category list show English names (this is the regression
   fix — assert the English string appears, not the Spanish one).
5. **Membership comboboxes** emit the correct `categoryIds` / `primaryCategoryId`, including the
   first-pick-becomes-reporting and remove-reporting-clears rules; chosen categories render as
   lozenges.
6. **Delete** shows "Delete <name>?", the warning, the affected-products table, and **no** routes
   section; Delete stays disabled until the preview loads.
7. **Row action** in the member list reads "Edit product categories".

Then, per the "open it and look" rule, the screen is opened in **both themes at phone width** — the
`apps/dashboard` package is browser-mode, so the harness is already there; the toolbar wrap, the
lozenges and the comboboxes are checked visually, not only by string assertions.

Coverage: `apps/dashboard` and `packages/ui` both sit on the `90/90/85/85` floor. New primitive
branches (toolbar, filters, stored view, stale-value handling) need their own assertions to hold it.

## Risk classification

No risk trigger is touched: no fiscal invariant, tenant isolation, by-id read, migration, grant, ACL,
auth, concurrency, or cross-package contract. `wt-data-table`'s new inputs are additive and opt-in, so
the change to a shared primitive does not alter any existing consumer's contract. This is a LIGHT-path
branch: the fresh-context plan-vs-spec read and the Codex run-it seat run as always; the per-task
reviewer and the simplify lenses are not required by the diff's risk. (Owner's model rules govern;
noted here only so the finish-branch wave is scoped correctly.)

## Out of scope

- Trimming `routes` from `getCategoryDependants` (server change, not needed for the UI).
- Full `ElementInternals` form association for `wt-combobox` (the design system defers it repo-wide).
- Migrating other screens' filter rows onto the new toolbar — they keep their own until touched.
- Any backwards-compatibility or data-migration code (pre-production; the house rule forbids it).

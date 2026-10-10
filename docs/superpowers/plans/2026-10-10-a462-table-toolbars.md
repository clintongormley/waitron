# A462 Table Toolbars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline in this registered worktree. Native execution is authorised. Read superpowers:test-driven-development before writing implementation or test code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Customise last on every table, align native selection boxes, and give Products and Menu Structure predictable branch closure and one selection/drag mode.

**Architecture:** Change toolbar and checkbox layout in `wt-data-table`. Add an opt-in descendant-collapse policy and an initial-open row predicate; adopt them only in Products and Structure. Keep the existing navigation, selection identities, live-read controllers and write paths.

**Tech Stack:** TypeScript, Lit, token-based CSS, Vitest browser mode with real Playwright Chromium, existing EN/ES strings and axe helpers. No dependencies or new primitives.

**Spec:** `docs/backlog.md` A462 and `docs/backlog/catalogue.md` A462, quoted in full below. The owner's instructions for this plan also require A461 amendment behavior and the validation matrix below. Source receipts describe the inspected candidate, not a runtime measurement.

## Global constraints

- A462 is the only Lane D item. Execute only in `/Users/clintongormley/workspace/worktrees/waitron-feat-a462-table-toolbars`, branch `feat/a462-table-toolbars`.
- The plan was written without implementation or test edits. Land the reviewed plan through the docs-only workflow; implementation remains a later task. Do not change CLAUDE.md rules or fiscal invariants.
- On later implementation: failing behavioral test first, observe its expected failure, minimal implementation, observe passing assertions. Every eventual commit uses `git commit -s`; never bypass hooks.
- Customise is last, after search, at every width in both drawn and native Tab order. Preview keeps Expand all.
- Root opening opens its own level only. Every deliberate branch closure on Products/Structure closes its descendants, including filtered-out branches, ordinary remembered openings and the active search openings. A new query still starts collapsed; search openings and their parents survive clearing unless subsequently closed.
- Selection/search drag, list/member identity, read-only ownership, busy gates, live reconciliation and permission boundaries survive unchanged. Use existing tokens, semantic names, localized labels and composed/bubbling event discipline.
- Focused local checks; normal push hook once for an unchanged candidate; package coverage in current-head CI. Full Claude whole-branch review during finish-branch because this changes a shared cross-package contract.

## Review focus

1. A filter hides a deeply open descendant: closing its ancestor must still clear that descendant and must not let filter-forced openings defeat closure (Task 3).
2. A root was explicitly closed before a reload or a deep-link reveal: distinguish that saved choice from a first visit; an explicit reveal opens its ancestors without reopening unrelated branches (Tasks 3–5).
3. One member appears in several paths and as several search copies: expansion follows path keys; ticks and writes follow list/member identity (Task 5).
4. A live snapshot arrives during a drag or open Move/Remove dialog: preserve captured identity, prune lost ownership, retain hidden ticks and reject stale targets (Tasks 4–5).
5. A narrow container inside a wide page changes width, or has a forwarded search slot: Customise stays on the search line, last in drawing and native keyboard order, and boxes align on wrapped rows (Tasks 1–2).

## Owner-authorised requirements, verbatim

### `docs/backlog.md` A462

```markdown
- **A462 — dashboard table toolbars: column chooser at the end, no Expand all, closing a branch
  closes everything in it (owner, 2026-10-10; open).** Every table's Customise columns button moves
  to the right-hand end of its toolbar (seen on Products, a menu's Price overrides and Modifiers →
  Extras), last at every width. Products and a menu's Structure tab lose Expand all; their top row
  ("All products", the menu's own name) opens its own level and, closed, closes everything. Closing
  a branch closes every branch inside it. The Structure tab's Reorder and Select buttons become one,
  as on Products. Every table's Select all checkbox lines up with the rows' checkboxes.
  [Detail](backlog/catalogue.md#a462--dashboard-table-toolbars-column-chooser-at-the-end-no-expand-all-closing-a-branch-closes-everything-in-it)
```

### `docs/backlog/catalogue.md` A462

```markdown
## A462 — dashboard table toolbars: column chooser at the end, no Expand all, closing a branch closes everything in it

Owner, 2026-10-10, from screenshots of Products, a menu's Structure and Price overrides tabs, and
Modifiers → Extras. Five changes; the owner's answers of 2026-10-10 to the first draft's open
points are folded in.

**1. The Customise columns button sits at the right-hand end of every table's toolbar**, after the
search field. Today `wt-data-table` draws Filters, `toolbar-start`, Expand all, `toolbar-end`,
Customise, then search, and design-system.md (Tables, the toolbar-order paragraph) puts search last
on purpose, so Tab crosses the buttons on the first line before reaching search on its own line
when the table is narrow. Moving Customise after search changes that rule: at each width, the order
Tab follows must still match what is drawn, and the "Tab follows" cases in
`packages/ui/src/components/wt-data-table.test.ts` and
`apps/dashboard/src/widgets/catalogue-browser.test.ts` change with it. Owner, 2026-10-10: "we'll
almost never use this button, so it goes on the right" — at every width it is the last control,
drawn and reached by Tab after search; where search takes its own line, Customise ends that line.

**2. No Expand all or Collapse all on Products or a menu's Structure tab.** The top row ("All
products"; the menu's own name on Structure) opens and closes everything instead. Today that row
cannot be closed at all: both tables pass `rowCollapsible` returning false for the root row
(`apps/dashboard/src/widgets/product-list.ts`, `apps/dashboard/src/widgets/menu-structure-table.ts`),
so the top row needs a chevron. Owner, 2026-10-10: opening the top row opens only its own level,
like any other branch. Closing it closes every level, by point 3, so on both tables it is how to
collapse everything. A menu's Preview tab (`apps/dashboard/src/widgets/menu-document-tree.ts`) keeps
its Expand all (owner, 2026-10-10), so `wt-data-table` keeps the feature. The entry "The Menus Structure tree notices Collapse all only by watching its table
redraw" below then needs revisiting: closing the top row still closes many branches at once.

**3. Closing a branch closes every branch inside it**, on Products and on a menu's Structure tab,
so opening it again shows its categories or sections closed rather than as they were left.

**4. A menu's Structure tab has one button for Reorder and Select.** Pressing it shows the
checkboxes and the drag handles together, as Products already does (`catalogue-browser.ts` passes
one `selecting` state to both `.selecting` and `.reordering`); today `menus-screen.ts` keeps
`structureReordering` and `structureSelecting` apart.

**5. The header's Select all checkbox lines up with the rows' checkboxes, on every table** (owner,
2026-10-10: "do this everywhere"). Seen on Products at phone width with select mode on: the rows'
checkboxes sit at the start of the controls column with the drag handle after them, while the
header's checkbox sits further right, over the gap between them. The header and the rows are drawn
by `wt-data-table` (the select-all cell and the row-controls cell), so fix it there, with and
without drag handles, and pin the alignment in a test that measures both boxes.
```

## Consumer trace and source receipts

Re-run these inventories immediately before implementation, since other lanes can land changes. Follow new matches before changing a shared predicate. These commands are read-only:

```bash
rg -n '<wt-data-table|WtDataTable|choosable:' apps packages --glob '*.ts' --glob '!*.test.ts'
rg -n 'rowParent|rowCollapsible|initiallyCollapsed|rememberExpanded|expandAllIncludes|flatTreeSearch|searchOpensPath|rowControlsAlign|rowControls=|setExpanded\(|isExpanded\(|revealRow\(|wt-expand-change|:expanded' apps packages scripts docs --glob '!*.test.ts'
rg -n 'structureReordering|structureSelecting|structureSelected|category-toggle|open-category|#checkCurrentShown|#revealCurrent' apps/dashboard/src
rg -n 'Expand all|Collapse all|Customise.*search|search.*last|toolbar-order|Tab follows' docs apps packages --glob '!pnpm-lock.yaml'
```

All production `wt-data-table` render sites found in apps/packages are listed here. Paths abbreviated in this table only: `D` = `apps/dashboard/src`, `V` = `packages/venue-service/src/dashboard`, `A` = `packages/adjustments/src/dashboard`.

| Source | Table instances and shared behavior affected |
| --- | --- |
| `D/widgets/product-list.ts:1612` | Products tree, chooser, forwarded search/toolbar, baseline controls; only production expansion persistence (`waitron.products.table:expanded`). |
| `D/widgets/menu-structure-table.ts:1435` | Structure tree, forwarded search/toolbar, centered controls; no viewKey or reload persistence. |
| `D/widgets/menu-document-tree.ts:240` | Preview tree; always-open root, Expand/Collapse all, document-generation reset, exact-occurrence reveal. Keep default descendant preservation. |
| `D/widgets/menu-prices-table.ts:1181` | Price overrides tree, own search and chooser, variant-order rule, initially collapsed, no expansion persistence. Keep default closure policy. |
| `D/screens/modifiers-screen.ts:496,519,591` | Dependants, usage (one column, no chooser); Extras and Options lists (chooser and own search). |
| `D/screens/devices-screen.ts:1637,1734` | Devices (chooser/search), waiting joins (no chooser). |
| `D/screens/printers-screen.ts:2078,2957,3125,3897` | Agents, printers, jobs (choosers), discovery (no chooser). |
| `D/screens/menus-screen.ts:2342` | Menus list, chooser depends on Cards/List columns. Structure and Preview are the widgets above. |
| `D/screens/units-screen.ts:547,691` | Units chooser/search; in-use-products flat selectable table without grips. |
| `D/screens/alerts-screen.ts:249,273` | Open and handled alert choosers. |
| `D/screens/orders-screen.ts:352`; `D/screens/payments-screen.ts:1996` | Orders and readers choosers. |
| `D/widgets/staff-list.ts:145` | Staff chooser, external searchTerm, no toolbar search slot. |
| `D/screens/servers-screen.ts:332`; `D/screens/content-languages-screen.ts:246`; `D/widgets/content-translations-dialog.ts:701`; `D/widgets/menu-publications.ts:821` | Flat tables without choosable columns. Do not introduce a chooser. |
| `V/departments-list.ts:189` | Departments chooser, separate package. |
| `V/station-table.ts:118`; `V/opening-hours-screen.ts:752`; `V/prep-stations-screen.ts:1378` | Flat tables without choosers. |
| `A/reasons-screen.ts:1122`; `A/adjustment-report-screen.ts:750,848` | Reasons and report people/entries choosers, separate package. |
| `packages/ui/demo/main.ts:210,214` | Demo flat and searchable tables, no choosable columns. |

The chooser gate is `wt-data-table.ts:2543`: a choosable column plus at least two movable columns, excluding the first and pinned end. Keep that gate. The tree consumers are exactly the four widgets above, by the `rowParent` search. Only Products and Structure set `flatTreeSearch`; no production caller currently sets `searchOpensPath`, but its legacy tests remain part of the shared contract. `swatch-styles`, `product-media`, `menu-tree-presentation`, `tree-drag`, `option-list-form` and `venue-departments-shell` also reference table styling or types; they do not render additional shared tables.

Native tables found separately: dashboard `widgets/{extra-list-form,course-list,product-editor,option-list-form,variant-table,top-sellers-table}.ts`, `screens/{planned-actual-screen,dashboard-overview-screen,dashboard-sales-screen,roster-screen}.ts`; venue `dashboard/{prep-stations-screen,hours-calendar,routing-grid}.ts`; adjustments `dashboard/adjustment-report-screen.ts`; till `screens/till-allergen-screen.ts`. The chooser search found no separate column chooser there. Leave their editor/report layouts alone; the selection-column contract here is the shared table's native controls.

Expansion mutation runs through `wt-data-table.ts:2016` (`#rowsByKey`), `:2025` (`#setOpen`), `:2067` (`#toggle`), `:2079` (`isExpanded`), `:2084` (`setExpanded`), `:2128` (`revealRow`), and `:2315` (Expand-all branch collection). Ordinary state, remembered openings and search openings are separate. Initial seeding is `:1096`; filter-held paths are `:1896` onward and the `held` rendering gate at `:2792`. Default `#setOpen` removes only the named key, so descendant preservation is the inspected default, not an experimentally established dependency. Preserve it for Preview/Prices instead of silently broadening A462; Preview explicitly keeps its feature.

Products path: `product-list.ts:1573` expansion handler, `catalogue-browser.ts:268` category navigation, then `screens/catalogue-screen.ts:697` URL update. Reveal/hover callers are `product-list.ts:639,649,1582,1593` and `catalogue-browser.ts:241`. Structure path: `menu-structure-table.ts:395` redraw controller and `:410,425,438` reveal/current/expansion handlers, `menus-screen.ts:2452`, then `#edit` at `:1616`. Its programmatic drag-focus reveal at `:475` and public `setExpanded` at `:955` must also work. Preview's parent is `menu-preview.ts:718`; its target-link handler at `:336` calls `menu-document-tree.ts:98` reveal, and `:146,236` reset replacement snapshots. Keep path expansion distinct from selection identity (`menu-structure-table.ts:998–1105`, `menus-screen.ts:2644`). Shell admission is `dashboard-app.ts:193–194,1615,1647`: Menus requires manager/admin, staff gets its restricted screens. Neither changed widget owns a new permission policy.

## Default decisions and interfaces

1. **Toolbar:** actual markup order is Filters, `toolbar-start`, retained Expand all, `toolbar-end`, search (own input or forwarded slot), Customise. Group search and Customise together, with Customise at the group's trailing edge; the group takes the last line when stacked. No CSS `order` or positive tabindex. Tables without search still put Customise last. Keep both existing search channels in source order if both are supplied.
2. **Width:** retain `STACKED_SEARCH_WIDTH = 640` for the shared group's stacking and measure the table's own box, including forwarded search slots. Add private `#hasToolbarSearch(): boolean`, resolving slot assignments with `flatten: true`; use `slotchange` to re-evaluate observation in an already rendered toolbar, including hidden-to-shown transitions. First render discovers its existing light-DOM search as today. Dynamic insertion into a toolbar that renders `nothing` is outside A462; do not add a mutation observer for it. Extend `stacked-search` to a real slotted search; retain zero-width and disconnected cleanup. Remove the two consumer rules forcing the input alone to `flex-basis: 100%` (`catalogue-browser.ts:98`, `menus-screen.ts:531`), and let its minimum inline size shrink so the final button fits. All CSS values use existing tokens.
3. **Checkboxes:** use the same leading wrapper/inset for header and row native inputs. When selectable, horizontally start-align both, with a grip following the row checkbox. Keep controls-only groups horizontally centered when `rowControlsAlign="center"`; retain its baseline/middle vertical behavior. Preserve the controls-only layout assertions in `wt-data-table.test.ts:7893–7910`. Do not center the header over checkbox-plus-grip or add a fake focusable header grip.
4. **New shared properties:** `collapseDescendants: boolean = false`; `rowInitiallyExpanded: (row: Row) => boolean = () => false`, both Lit properties with no attribute for the predicate. The predicate is a once-per-new-branch seeding exception under `initiallyCollapsed`, not an instruction applied on every redraw. Products and Structure pass true only for `row.kind === "root"`. Root starts open, other branches closed, preserving the existing top-level view. Remembered choices override defaults; refresh never reseeds an existing branch.
5. **Closure:** with `collapseDescendants`, collect the key and descendants from the complete `rows` parent graph, never from searched/rendered rows, never by string prefix or selection identity. Use visited keys to bound malformed/cyclic inputs. Close every collapsible branch in that set, including product variants. Update `collapsed`, active `searchExpanded`, remembered openings and deliberate closures atomically. Opening changes the requested key only; search opening additionally opens its ordinary ancestors as A461 already requires. Noncollapsible branches keep their existing invariant.
6. **Persistence and filters:** maintain private deliberate-closure keys separately from initial collapsed seeds. With opt-in cascade + `rememberExpanded` + `viewKey`, store them as a string array at `${viewKey}:collapsed`, alongside existing `${viewKey}:expanded`. Missing/invalid/blocked storage gives normal defaults; no migration/reset. A deliberate close overrides an open entry if both are present; explicit opening/reveal clears the corresponding closure. Filter-held ancestors auto-open unless deliberately closed, and opted-in held ancestors still expose an effective toggle. `isExpanded`, displayed `aria-expanded`, toggling and traversal must agree on that effective state. No new persistence for Structure. Query changes reset transient search openings only, not ordinary openings/closures. Flat matching descendants still appear as independent results after an ancestor closes; their own branch contents are closed.
7. **Events/navigation:** retain shared `wt-expand-change` detail `{ key: string; expanded: boolean }`, one event for the toggled branch; `setExpanded` stays silent. Products extends app-owned `category-toggle` to `{ categoryId: string | null; open: boolean }`, using null for root; ordinary root close emits existing `open-category` `{ categoryId: null }`. Search-only toggles still do not navigate. Root uses a standalone native chevron while its swatch/menu remain independent controls. Root labels use existing named open/close strings with All products/menu name.
8. **Structure mode:** retain `structureSelecting` as the single screen state; bind it to both widget `.selecting` and `.reordering`. Remove `structureReordering`, Reorder button, reorder Done and `#leaveReordering`; keep `data-test="select"`, Select/Seleccionar, `select-rows` icon, pressed state, busy guard and selection-bar Done. `#leaveSelecting(): Promise<void>` clears ticks, turns both capabilities off and focuses Select. Preserve the widget's public `reordering` property/default for standalone callers. Preserve shell role/permission admission and existing owned/read-only/busy gates.
9. **Current path:** closing root in ordinary Structure sends exactly one `wt-structure-edit` `{ path: [] }`; closing a current ancestor sends its parent path. After search clears, reconcile a path hidden by deliberate closure instead of immediately revealing it again. Explicit navigation to a deep path/reveal must open root plus that path, not unrelated siblings. Preserve guarded dialogs/draft scopes.
10. **W88:** keep the table redraw controller: it also fits paths, restores keyboard/moved focus and paints active drag marks (`menu-structure-table.ts:395`). Extend `#checkCurrentShown(): void` to check root as well as the current path, including silent programmatic root closure; `#expandChange` handles root directly and sets the existing duplicate-report guard. Do not add a batch expansion event in this change. Reword the observer backlog entry later around silent programmatic closure and its retained duties; remove neither the controller nor the broader W88 drag-duplication entry.

## Exact file map

Modify production:

- `packages/ui/src/components/wt-data-table.ts`: shared toolbar, checkbox geometry, opt-in cascade/default-open/persistence/filter policy.
- `apps/dashboard/src/widgets/product-list.ts`: root toggle, opt-in properties, nullable root navigation event, remove Expand/Collapse labels.
- `apps/dashboard/src/widgets/catalogue-browser.ts`: root navigation handling and remove search-only stacking override.
- `apps/dashboard/src/widgets/menu-structure-table.ts`: root toggle, opt-in properties, root/current reconciliation and explicit reveal, remove Expand/Collapse labels.
- `apps/dashboard/src/screens/menus-screen.ts`: one mode, search layout, reset/Done paths.

Modify existing behavioral tests: `packages/ui/src/components/wt-data-table.test.ts`; dashboard `src/widgets/{product-list,catalogue-browser,menu-structure-table,menu-document-tree,menu-prices-table}.test.ts`, `src/screens/{catalogue-screen,menus-screen,modifiers-screen,units-screen}.test.ts`. Add representative cross-package assertions to `packages/venue-service/src/dashboard/departments-list.test.ts` and `packages/adjustments/src/dashboard/reasons-screen.test.ts`.

Modify existing accessibility tests: `packages/ui/src/components/wt-data-table.a11y.test.ts`; dashboard `src/widgets/{product-list,catalogue-browser,menu-structure-table}.a11y.test.ts`, `src/screens/menus-screen.a11y.test.ts`. Read/run existing `menu-document-tree.a11y.test.ts`, `menu-preview.test.ts`, `catalogue-browser.unsaved.test.ts`, `menus-screen.structure-move.unsaved.test.ts`, and `src/dashboard-app.test.ts` role/permission cases; preserve their behavioral assertions.

Modify documentation during implementation only: `docs/developers/design-system.md` (property/slot table, tree policy, search persistence, toolbar and selection mode). Add dated A462 pointers to superseded assertions in historical `docs/superpowers/plans/2026-10-10-a453-menu-root-row-and-pinned-buttons.md` and `docs/superpowers/plans/2026-10-10-a461-product-search.md`. Update A462 and the W88 observer entry in `docs/backlog.md`/`docs/backlog/catalogue.md` when implementation/validation makes them stale; retain unrelated residuals and append decisions under the existing decisions section. No new source/test files.

## Task 1: Put Customise last in the shared toolbar

**Files:** shared table; catalogue-browser and menus-screen search CSS; shared table and catalogue-browser tests/a11y; menu-prices, modifiers, departments-list and reasons-screen tests; design-system toolbar/slot wording.

**Interfaces:** use existing labels, chooser gate and toolbar slots; introduce private `#hasToolbarSearch(): boolean` as specified above. No consumer changes chooser eligibility.

- [ ] Write `A462 Customise is last after native and forwarded search` tests and revise existing `Tab follows` expectations. At 390/1280 px, EN/ES, light/dark, assert explicit expected control order, then press real `{Tab}` from a preceding button and compare each deepest native focused element. Do not merely sort geometry and accept whatever order appears. Assert Customise right edge ends the final line, search shares that line at phone width, and rectangles stay inside the toolbar. Cover no-search, no-chooser, empty/no-matches, hidden→shown, 640/641 px, 660 px Spanish Products, and a 390 px container in a 1280 px page. In an already rendered toolbar, assert assigning/removing forwarded search updates stacking without an infinite update loop; do not require dynamic creation from an absent toolbar.
- [ ] RED: run the following; the new order/geometry assertion must fail because Customise precedes search or occupies the earlier line. Existing no-chooser controls can pass as regressions.

  `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t 'A462.*Customise|Tab follows'`

  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts src/widgets/menu-prices-table.test.ts src/screens/modifiers-screen.test.ts -t 'A462.*Customise|Tab follows'`

- [ ] Implement markup/group/width decisions 1–2. Retain Expand all in the shared component and current Products/Structure bindings until their own tasks. Update token-paint assertions and design-system wording in the same task.
- [ ] GREEN: run the same commands and require nonzero passing Tests counts. Add/run cross-package chooser-last regressions with `pnpm --filter @waitron/venue-service exec vitest run --project browser src/dashboard/departments-list.test.ts -t A462` and `pnpm --filter @waitron/adjustments exec vitest run --project browser src/dashboard/reasons-screen.test.ts -t A462` (both configs name the browser project). Cover chooser dialog open/Done focus return and saved column order.
- [ ] Commit only this task's complete changes with `git commit -s -m "feat(ui): place table Customise after search"` after inspecting staged paths.

## Task 2: Align header and row native checkboxes

**Files:** shared table/tests/a11y; Products and Structure geometry tests; units in-use selectable regression; design-system row-controls wording.

**Interfaces:** keep `rowControls?: (row: Row) => unknown`, `rowControlsAlign: "baseline" | "center"`, `rowSelectable`, `rowSelectionKey`, `selected` and selection events unchanged.

- [ ] Write `A462 native select-all aligns with native row boxes` using eight representative geometry cases covering 390/1280 px, EN/ES labels, baseline/center, with/without grip, flat/tree and both themes. Pair these dimensions rather than taking their Cartesian product; retain existing selection and controls-only layout cases. Render a short and a wrapping name plus a row without a checkbox. Measure actual `input[type=checkbox]` rectangles: header.left equals each row.left within 0.5 px; widths and heights equal within 0.5 px. Do not compare header/row vertical positions. Assert checkbox precedes grip, neither overlaps the name/pinned menu, Select all still selects only eligible visible identities and indeterminate remains correct.
- [ ] RED: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t 'A462.*native select-all'`. Expect a measured left-edge mismatch with grips, not a missing fixture/control.
- [ ] Implement decision 3 in both flat and tree rendering via shared header/row wrappers and token CSS. Preserve baseline wrapped-name behavior, center name-and-note stacks and horizontal centering when controls have no checkboxes.
- [ ] GREEN: repeat RED command. Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/menu-structure-table.test.ts src/screens/units-screen.test.ts -t 'A462.*native select-all'`; ensure each file's new geometry case actually runs. Run shared checkbox token-paint and axe states, including gripless selection and controls-only rows.
- [ ] Commit with `git commit -s -m "fix(ui): align table select-all with row checkboxes"`.

## Task 3: Add opt-in cascading closure with usable initial roots

**Files:** shared table/tests/a11y; Preview regression test; design-system property/tree/search contract and dated A461 pointer.

**Interfaces:** add `collapseDescendants: boolean` and `rowInitiallyExpanded: (row: Row) => boolean`; keep `isExpanded(key: string): boolean`, `setExpanded(key: string, expanded: boolean): void`, `revealRow(key: string): Promise<void>` and event payload unchanged. Private deliberate-closure state and `:collapsed` storage belong to this task.

- [ ] Write `A462 cascade closes hidden descendants and saved search openings`. Use root→Drinks→Beer→product→variant plus a sibling category. Initially root open, others closed. Open all levels, filter out Beer/product, close Drinks and reopen: Beer/product remain closed, sibling state unchanged. Close root: only root is rendered; reopen: only direct members return. Inspect `isExpanded` and `aria-expanded`, not visibility alone. Repeat through toggle, silent `setExpanded`, rows refresh, late-arriving children and actual remount with storage.
- [ ] Write `A462 cascade keeps flat own results and honours deliberate filter closure`: open parent/child in flat search, close parent, assert every descendant's expansion false while matching descendants remain independent flat results; clear/whitespace and remount, assert parent/descendants closed and saved open keys removed. Search-open another child and clear: that child and its ancestors, including root, remain open. New query has collapsed results; hidden ticks stay. Filter-held root/ancestor must offer a working toggle; close it while filtered and assert it stays closed through filter changes/clear/remount. Add missing parents, cycles, repeated copies, invalid/blocked storage, no viewKey and no rememberExpanded controls.
- [ ] Write `A462 default preserves descendants and Preview keeps Expand all`: a table without the opt-in closes/reopens a parent retaining its expanded child; Preview retains its always-open root, Expand/Collapse all, nested reopen state, exact-occurrence reveal, snapshot replacement and content-language behavior. Pin menu-prices' product/variant reopen behavior too. No change to default/legacy search and bulk-expand assertions.
- [ ] RED: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t 'A462.*cascade|A462.*default'`. Expect descendant expansion/storage or initial root state failures with the new properties, not a type/import failure. Default behavior tests should already pass.
- [ ] Implement decisions 4–6. Use the full graph and one state update; make explicit closures override filter-held paths only when opted in. Make toggle calculate effective open state. Ensure cycle-safe traversal, ordinary root default seeding and silent reveal clear closures only along the requested path. Preserve default search close persistence and all existing bulk expansion rules.
- [ ] GREEN: repeat RED command, then `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t 'A461|Expand all|Collapse all|remember|seeds|searchOpensPath|A462'` and `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/menu-document-tree.test.ts src/widgets/menu-preview.test.ts src/widgets/menu-prices-table.test.ts -t 'A462|reveal|snapshot|replacement|locale'`. Require actual Tests counts and default/opt-in controls. Verify new persistence branches with useful assertions, without coverage exclusions.
- [ ] Commit with `git commit -s -m "feat(ui): add opt-in cascading tree closure"`.

## Task 4: Adopt root/cascade behavior on Products

**Files:** product-list, catalogue-browser; their tests/a11y; catalogue-screen tests for URL integration; dated A453 pointer and relevant design-system Products wording.

**Interfaces:** consume Task 3 properties; extend `category-toggle` detail to `{ categoryId: string | null; open: boolean }` in its producer and listener together. Keep screen-facing `open-category` payload `{ categoryId: string | null }`, reveal methods, product/variant keys and write requests.

- [ ] Write `A462 Products root replaces Expand all and closes every level`: root initially open; no Expand/Collapse toolbar button; native named root chevron closes all category/product/variant branches and reopens only top level. Stored closed root remains closed on remount, ordinary deep-link reveal opens root/path only. Closing during a narrowed/search view clears descendants from both storage and ordinary expansion; clearing restores that closed choice. Root swatch, actions, blank grip and nonselectability remain intact.
- [ ] Write `A462 Products root closure clears category URL`: reach Beer through real catalogue-screen/browser events, close root and assert `categoryId`/address return to top level once, with no save or product edit. Search-only category toggles leave address alone. Closing an ordinary parent still navigates to its parent, and a later live snapshot does not reveal the closed path again.
- [ ] RED: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/catalogue-browser.test.ts src/screens/catalogue-screen.test.ts -t 'A462.*Products'`. Expect the remaining Expand-all/root-always-open or category-address assertion to fail.
- [ ] Implement decisions 7 and Products adoption of Tasks 1/3. Remove Products' Expand/Collapse labels and now-unused `expandAllIncludes` binding. Keep root row activation `"none"` with its own chevron; use existing named strings. Suppress navigation during search exactly as before. Retain graph-derived eligible selection, visible-only drag batches, hidden ticks and full-set Move/Archive operations.
- [ ] GREEN: repeat RED command, then run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/catalogue-browser.test.ts -t 'A461|A462|Tab follows|remember|reveal|selection|refused|variant'`. Preserve the source's one-category placement; do not add multi-category storage/editor behavior. Adjust only obsolete bulk-button checks, and retain refusal codes and navigation/grip/swatches assertions.
- [ ] Commit with `git commit -s -m "feat(dashboard): collapse Products through its root row"`.

## Task 5: Unify Structure mode and reconcile root closure

**Files:** menu-structure-table and menus-screen; widget/screen tests and a11y; existing structure-move unsaved tests; design-system Structure/selection and eventual A462/W88 backlog updates.

**Interfaces:** consume Task 3; use one screen `structureSelecting: boolean`; retain widget `.selecting`, `.reordering`, `.current: string[]`, `setExpanded(key: string, expanded: boolean): Promise<void>` and `wt-structure-edit` `{ path: string[] }`. Extend existing `#expandChange`/`#checkCurrentShown` for root; keep observer duties.

- [ ] Write `A462 Structure has one Select mode`: exactly one native Select/Seleccionar button; activating it shows both eligible native boxes and grips, toggling or Done clears ticks and removes both, Done focuses Select, no reorder-only button/Done. Busy controls do nothing; an empty menu/reset/another menu ends the mode; live reads do not end it. Native Arrow reordering and pointer dragging still work, including search. Existing read-only included rows have no selectable boxes/active grips.
- [ ] Write `A462 Structure root closes current path once`: root initially open; close root while current is Drinks/Beer and assert only root remains, exactly one `{ path: [] }`, current marker/editor switches to top-level list, then reopen only direct members. Repeat via silent `setExpanded("root", false)`, parent closure, active Available filter, refresh and explicit deep-path navigation. Close search branch: no navigation while searching, reconcile the hidden current path after clearing without reopening it. Empty-state add actions and root ⋮ still act on the top list.
- [ ] Add one focused repeated-path cascade case: close one section path while a distinct placement stays open; expansion follows paths and shared native ticks remain unchanged. Reuse existing A461 membership identity, visible search drag, hidden ticks, full-set Move/Remove, live replacement, removed/read-only ownership, exact request/refusal, stale/cyclic target and unsaved Move cases. Identify their test names in the task receipt and run them with the GREEN command below; do not recreate an omnibus regression suite.
- [ ] RED: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/menu-structure-table.test.ts src/screens/menus-screen.test.ts -t 'A462.*Structure'`. Expect missing root closure/current reconciliation or separate mode-button assertions to fail.
- [ ] Implement decisions 8–10 and Structure opt-in. Remove all screen `structureReordering` consumers, including menu/reset/Done paths; keep widget standalone interface. Include root in explicit current-path reveals but do not reveal it when a collapse sends `path: []`. Handle root closure before the owned-section check and retain duplicate-report/search guards. Keep the redraw controller and silent-close check; do not claim an event solves its other duties.
- [ ] GREEN: repeat RED command. Run `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/menu-structure-table.test.ts src/screens/menus-screen.test.ts src/screens/menus-screen.structure-move.unsaved.test.ts -t 'A461|A462|selection|reorder|current|refus|unsaved|warning'`. Run affected axe states and retain checks for included-row menus, busy writes, live identity, draft handling and focus.
- [ ] Update current design-system claims and only now retire completed A462 requirements in both backlog files, moving enduring decisions into catalogue's decisions section. Replace the W88 Collapse-all wording with the remaining silent-close observer concern and its current duties; retain the entry unless runtime tests justify resolving it. Keep unrelated backlog work untouched.
- [ ] Commit with `git commit -s -m "feat(dashboard): unify Structure selection and cascading closure"`.

## Changed-check inventory

Record each actual before/after assertion in the implementation PR; preserve unrelated behavior within the same tests. These are intentional changes, not evidence that the old tests were wrong:

| Existing check/claim | Required replacement |
| --- | --- |
| UI `Tab follows...` at `wt-data-table.test.ts:8258`; toolbar slot checks `:6001–6026`; searchable-only stacking cases and stacked-search axe state | Customise after search, final search+chooser line; own and forwarded search share width tracking. Preserve slot forwarding, no-chooser gates and actual Tab. |
| Catalogue toolbar tests `catalogue-browser.test.ts:3772,3947,4023,4250` | Remove Products bulk button; Filters, Select, search, Customise; Spanish 660 px and phone geometry include final chooser. |
| Catalogue Expand-all/category-only/variants-excluded checks `:4136,4156` | Root closes all levels including variant branches; root reopening only direct members. Keep category/variant order and edit behavior. Shared Expand-all/expandAllIncludes tests remain. |
| Structure current hidden by Collapse-all `menu-structure-table.test.ts:585` and always-open root `:3594` | Native and silent root close reset current path once; root can close/reopen; preserve root actions, empty behavior and nonselection. |
| Menus Reorder button/Done helpers, search preserved through reorder Done, reset and focus checks; `menus-screen.a11y.test.ts:555,627` | One Select button, shared mode and selection Done, search retained, native focus/tooltip and axe assertions still cover the mode. Update helpers, not just selectors in assertions. |
| A461 “closing a search branch affects that query only,” design-system tree/search paragraph, A461 checkpoint | For opted-in Products/Structure, closure clears ordinary/saved descendants too. Default consumers retain old behavior; search openings still persist with ancestors until explicitly closed. |
| Products and Structure name-heading/arrow geometry cases; phone search field width check `menus-screen.test.ts:4226` | Account for root chevron and shared controls geometry; cap search by space left for Customise where offered. Structure has no chooser, so its search still fills its own last line. |
| UI row-controls checks `wt-data-table.test.ts:7864,7895`, including baseline `display: contents`, and Products/Structure token/axe checks | Vertical alignment still follows rowControlsAlign; native horizontal positions agree with/without grip. If the shared wrapper becomes flex in both modes, retire only that display assertion and retain measured baseline/center behavior and token paint. |
| Historical A453/A461 plan assertions and current design-system slot/selection text | Dated pointers in historical plans; rewrite current contract, including removal of Products “keep Expand all” selection wording. |
| W88 observer backlog item | Re-evaluate only this concern; root closure still changes many branches and silent API changes still lack events. Keep controller and unrelated W88 residuals. |

Other files containing chooser geometry selectors include dashboard alerts, printers, payments, units, menus, modifiers, staff, menu-prices and adjustments reasons tests. Inspect their contexts rather than mechanically rewriting every `.table-end` selector. Keep assertions about saved columns, refusing the last hide, Actions pinned at end, sort/filter persistence and chooser focus. Snapshot root/color/data fixtures are not approval to weaken those checks.

## Focused validation and branch finish

- [ ] Read the TDD skill before the first code/test edit; re-run inventory and inspect the current worktree diff. Check `memory_pressure` before browser work. Run commands sequentially and retain logs/exit statuses; no whole-workspace test run merely to finish.
- [ ] Run affected complete browser files after their focused cases, once changes settle:

  `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts src/components/wt-data-table.a11y.test.ts src/no-hardcoded-chrome.test.ts`

  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/catalogue-browser.test.ts src/widgets/menu-structure-table.test.ts src/widgets/menu-document-tree.test.ts src/widgets/menu-prices-table.test.ts src/screens/menus-screen.test.ts src/screens/modifiers-screen.test.ts src/screens/units-screen.test.ts src/screens/catalogue-screen.test.ts`

  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.a11y.test.ts src/widgets/catalogue-browser.a11y.test.ts src/widgets/menu-structure-table.a11y.test.ts src/widgets/menu-document-tree.a11y.test.ts src/screens/menus-screen.a11y.test.ts src/widgets/catalogue-browser.unsaved.test.ts src/screens/menus-screen.structure-move.unsaved.test.ts`

  `pnpm --filter @waitron/dashboard exec vitest run --project browser src/dashboard-app.test.ts -t 'STAFF-role|staff session sees|permission is absent'`

- [ ] Open and look at Products, populated/empty Structure, Preview, Price overrides, Extras, gripless Units selection, Departments and adjustment Reasons. Matrix: 390/1280 px, EN/ES, light/dark; add 640/641/660 px and narrow-in-wide container. Use `page.viewport`, assert measured window/container width, await real layout frames, register icons, and restore viewport/locale/theme. Set a live page's theme on `document.documentElement` and record computed surface/text colors; reject identical light/dark captures. Save screenshots under permitted `__screenshots__/` paths. Exercise native Tab/Enter and native checkbox geometry. If needed, use `wa-wt demo waitron-feat-a462-table-toolbars`; stop only processes started for this work.
- [ ] Run focused root style-token, native-field and pinned-actions guards only if affected assertions/styles require them; the normal hook runs root guards. Do not add CI/config changes or lower coverage/mutation thresholds.
- [ ] Self-review base-to-tip code and every changed prose claim, including historical pointers. Confirm all five requirements and each review-focus input have receipts; no unrelated assertion was dropped. Confirm `git diff --cached --name-only` before every signed-off commit.
- [ ] Announce readiness for finish-branch. During finish-branch, after its initial rebase, obtain a **full Claude run-it whole-branch review** through `claude-seat.sh review-run`, using the complete installed candidate in its isolated review checkout. This future review checkout is the finish workflow's reviewer isolation, not another development worktree for this planning task. Read completed findings and check receipts; a successful wrapper with pending prose is not approval. Fix findings with focused red/green cycles.
- [ ] Push via the normal hook once for the unchanged candidate; let it perform sign-offs, frozen install, formatting, lint, root coverage and scoped types. Do not duplicate those checks as a separate whole-workspace ceremony. Verify CI's current-head `changes` scope selects UI and all dependents, including dashboard, venue-service and adjustments; use coverage/merge job results, not plain test jobs. All required current-head checks and package bars must pass before reporting ready. When finish-branch has passed, continue the owner-authorised land-branch under the shared atomic main.lock, including main install and branch/worktree cleanup; verify exact-merge CI. Never merge a failing check.

## Planning self-review

The plan maps A462 points 1–5 to Tasks 1, 4/5, 3–5, 5 and 2 respectively. Preview preservation belongs to Task 3. The source trace includes every shared table render site, chooser declaration family, all four trees, root/remembered/search consumers and navigation/reveal callers found by the inventory. The five review-focus cases have concrete assertions in their owning tasks. Public signatures agree across producers and consumers; default closure behavior stays unchanged outside the two opt-ins.

Deliberate additional decisions are initial-open roots, a separate persisted deliberate-closure array, filtered-path closure precedence, Select as the unified label, and retention of the W88 redraw controller. These are implementation decisions within the authorised requirements. Runtime behavior and geometry are not verified by this planning turn; the red/green and visual checks above supply those receipts later. No requirement is deferred, no fiscal/backlog/CLAUDE rule is changed now, and no test result or branch readiness is claimed.

## Fresh-context plan review corrections (2026-10-10)

A read-only reviewer checked this plan against the owner text and code. The plan now limits dynamic slot changes to an already-rendered toolbar, preserves centered controls-only rows, and uses representative checkbox geometry plus retained selection/drag assertions. The separate deliberate-close state remains an opt-in default, so closed-root restoration differs from first-visit seeding; this is a planning decision, not a runtime receipt. No code or browser test ran during plan review.

# The Products screen as a category tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard's Products screen into one tree — an "All products" row with every category opening in place, adds and renames from each row's ⋮ menu, a clearer drag, prices with their unit, and "category" wording — as the owner approved on 2026-10-02 (backlog A208, which also builds A205).

**Architecture:** The shared table `wt-data-table` (`packages/ui`) gains what a tree screen needs: categories-first sibling groups, an always-open branch, row activation in tree mode (a branch row toggles, a product row opens), an Expand all / Collapse all button, toolbar slots, a search term its consumer supplies, a remembered open set, and a small public API (`isExpanded`, `setExpanded`, `revealRow`, `sortedSiblings`). The dashboard's `dashboard-product-list` then builds the whole tree from every category and product, owns the drag, the name box and the menus; `dashboard-catalogue-browser` keeps the search box, Select mode and the move/delete dialogs, and saves names; `dashboard-catalogue-screen` loses its header button and reads and writes `category=`.

**Tech Stack:** Lit 3 web components, TypeScript 7, Vitest 4 in real headless Chromium (Playwright provider), axe-core.

**Spec:** `docs/superpowers/specs/2026-10-02-products-category-tree-design.md` — read it in full before Task 1. Every task below argues from it.

## Global Constraints

- Dashboard only: no migration, no route, and the product editor's own rules unchanged (spec, Status line).
- Words: "category" / "categoría" wherever the Products screen says "folder" / "carpeta" today, in English and Spanish; the product editor's "Main category" keeps its name; the till's menu sections are not touched (spec §5). The string KEYS keep their `folders.` prefix — say so in the PR (spec §5 leaves it free). Internal identifiers (the `folder:` row keys, the `folder-cell` part, `data-test` names) keep "folder": they are never shown.
- Standalone ordering's empty choice: **"Any ordering"** / **"Cualquier pedido por separado"** (spec §1).
- Prices: "€19.00 each", "€48.00 / kg" — the unit a quiet second word after the amount (spec §1).
- Every field is a field primitive: the name box is `wt-input` (CLAUDE.md §3, guard `scripts/native-form-fields.test.ts`).
- Markup handed to `wt-data-table` as a cell is styled with `part=` / `::part()`, never a class (CLAUDE.md §3).
- Every colour, spacing, radius and font reads a declared `--wt-*` token; no hex, no named colours, no `rem`/`em` (CLAUDE.md §3).
- `wt-data-table`'s new event is named `wt-expand-change`, carries `detail`, is dispatched `bubbles: true, composed: true`, and the click that triggers it is stopped with `event.stopPropagation()` (CLAUDE.md §3).
- The row-menu column stays keyed `actions` and `pinned: "end"` (CLAUDE.md §3).
- `wt-data-table` keeps its token-painting tests and its `*.a11y.test.ts` covering each new state in both themes (CLAUDE.md §3).
- Which categories are open is remembered in `localStorage` under `${viewKey}:expanded`, every read and write wrapped in `try`/`catch`; a fresh browser starts with every category closed (spec §6.1).
- The address names a category with `category=`, replacing `folder=` and `view=`; old addresses are not supported (spec §6.3).
- The hover-to-open delay is the named constant `HOVER_OPEN_MS = 600` in `apps/dashboard/src/widgets/product-list.ts`; the PR states it (spec §4).
- Coverage stays at 98/98/98/95 in `apps/dashboard` and `packages/ui`, never by hiding code; `packages/ui` has a mutation floor of 90 (weekly run), so its tests assert exact values (CLAUDE.md §2, §4).
- TDD: each test is written first and seen failing. Comments only for an invariant or a non-obvious why, never history.
- Every commit is `git commit -s` with a plain-English message.
- Branch `feat/products-category-tree`, made with `python3 ~/workspace/tools/worktree.py new waitron feat/products-category-tree --headless`. Light review path (spec §8): no per-task reviewer seat; the fresh-context plan read and `/finish-branch`'s Codex run-it seat still run.

## Review Focus

1. **A drag that crosses a closed category without stopping** — the person expects it to stay closed; only a pause of `HOVER_OPEN_MS` opens it. Test added to Task 10.
2. **Enter pressed twice, or Enter then leaving the box** — one category is made, not two. Test added to Task 9.
3. **Add category while a search is typed** — the new row's name box must still appear (the search would otherwise hide it). Test added to Task 9.
4. **A tree three categories deep at 390 px** — every row's ⋮ stays on screen and uncovered. Test added to Task 7.
5. **A refused rename followed by Esc** — the old name stays and nothing more is sent. Test added to Task 9.

---

## Decisions this plan takes where the spec is silent

Each is a reading of the spec, stated so the owner can overturn it on the plan.

1. **Counts.** A category row counts its direct subcategories and the Active products filed directly in it ("1 category, 2 products"; a part that is zero is left out unless both are, which reads "0 products"). The All products row counts the whole catalogue: every category and every Active product. Inactive products are left out because the default Status filter hides them, so counting them would name products the person cannot see.
2. **The address.** `category=` is written when a person opens a category by its row or arrow (history replaced, not pushed, so opening ten categories does not leave ten Back steps). Closing the category the address names, or one above it, writes its parent. Expand all and Collapse all leave the address alone. Opening an address opens that category and every category above it and scrolls it into view (spec §6.3).
3. **Search through variants.** A product is found by its own name or any of its variants' names; a variant row is never a match itself, and it stays reachable under its found product, closed until the person opens the product. This keeps today's behaviour ("keeps a variant match on its parent until the manager expands it", `catalogue-browser.test.ts`). A category that matches AND holds a match is held open while the search lasts (spec §1). The table gets this search rule only when asked (`searchOpensPath`), because the menus Prices tree searches differently: its variant rows' search text includes the product's name (`apps/dashboard/src/widgets/menu-prices-table.ts`, the `name` column's `searchValue`), and its "keeps a product's variants when the product is found by its name" test expects the found product to stay closed.
4. **Phone width.** The table's scroll box is a size container; at a box width of 380 px or less each level indents `--wt-space-2` instead of `--wt-space-4`, and no deeper than four levels (spec §6.4). Nothing here asserts a width a phone gives: Task 2 pins the boundary itself (a 380 px box indents half as far, a 381 px box does not), the existing indentation test must still pass at Vitest's default viewport, and Task 7's 390 px case measures that a product list on a 390 px screen gets the phone indent. If either of the last two fails, the breakpoint moves, not the tests. (2026-10-02: Task 7's case failed, because at a 390 px window the list's box was 390 px wide, so the breakpoint moved to 440 px, and Task 2's boundary case moved with it to 440 and 441. The 380 px values in the tasks below are as first planned. The size container and its container query became a `narrow` attribute the table sets on itself in code while the tree's box is 440 px wide or less.)
5. **"Each".** A product whose unit is not one of the venue's stored units reads "each" — the rule the product editor's `unitShortLabel` already uses (`apps/dashboard/src/widgets/product-editor.ts`, read, not run). _(2026-10-02, A216: `unitShortLabel` now returns an empty string for a product with no unit, and the editor's price button chooses Each itself; so the comment Task 5 writes above `#unitWord` should not cite it. And since A172 (#1053) a unit id the editor's list lacks reads "Unavailable selection" there, not Each.)_ Spanish: "la unidad". A stored unit reads "/ " and the abbreviation the listed product already carries (`Product.unit`), or its name when it has none, in the first content language. The stored-units list is still passed down, because a listed product with no stored unit carries `EACH_UNIT` (`packages/catalogue/src/operations.ts`, `sellableUnit`), recognisable only by `EACH_UNIT_ID`, which lives in `packages/catalogue/src/units.ts` — a module that imports `drizzle-orm` and `@waitron/db`, so the dashboard cannot import it (read, not run).
6. **Where a drop lands.** Hovering a category row targets that category; hovering a product or variant row targets the category the product is in; hovering All products targets the top level. A drop that would move nothing (every dragged row is already there) is not offered: no bar, no gap, and releasing moves nothing — which is also how "a drop where the drag started" cancels (spec §4).
7. **Selection after a drop.** A drop clears from the selection only the rows it moved, so a drag of an unselected row leaves the selection as it was (spec §4), and a drag of the selection still empties it (today's "drags the whole selected group and clears selection after moving").
8. **Add category during a search** clears the search, so the new row's name box is on screen.
9. **Rename** changes the name only; a category's parent changes through Move to… or a drag.
10. **Remembering is opt-in** (`rememberExpanded`), so the menus Prices table, the only other tree using `viewKey` with `initiallyCollapsed` (`apps/dashboard/src/widgets/menu-prices-table.ts`, read, not run), does not start remembering.
11. **One table property decides a row's click** in tree mode, `rowActivation(row): "toggle" | "click" | "none"`, rather than a boolean, because the All products row must be neither clickable nor a toggle.
12. **A move sends only the outermost rows.** A selection holding a category and something inside it sends only the category, for a drag and for Move to… alike (spec §4: its contents go with it). The server's `moveCatalogueItems` (`packages/catalogue/src/catalogue-items.ts`) re-files every listed product and re-parents every listed category to the destination, so a listed child would otherwise be pulled out of its moving parent (read, not run). Delete is left as it is: deleting a category and a product inside it already asks what happens to the contents.

## Existing test assertions this plan changes

The spec (§8) approves changes to tests asserting the breadcrumb, the Folders / All products switch, the header's Add product button, the New folder button, the folder-at-a-time listing, or the word "folder". Each task names the tests it touches. Three kinds of change appear:

- **Approved by §8** — listed per task.
- **Setup only** — a selector re-aimed past the new All products row, a category opened before reading a row inside it, a click on the removed header button replaced by the `add-product` event the menus send. The assertion is unchanged.
- **NEEDS THE OWNER** — an assertion that changes because the spec's design changes it, in a class §8 does not name: the empty table's box and Add button (spec §3 replaces them), the All products row's ⋮ and the unit after every price (spec §1 adds them), and the drag's look (spec §4 replaces it). Each is marked **NEEDS THE OWNER** where it changes, and listed again at the end.

## File Structure

| File | Change | Responsibility after this plan |
| --- | --- | --- |
| `packages/ui/src/components/wt-data-table.ts` | Modify | Tree mode gains groups, always-open branches, row activation, the expand-all button, toolbar slots, `searchTerm`, remembered open branches, phone indentation, and `isExpanded` / `setExpanded` / `revealRow` / `sortedSiblings` |
| `packages/ui/src/components/wt-data-table.test.ts` | Modify | New cases for every addition; existing cases unchanged |
| `packages/ui/src/components/wt-data-table.a11y.test.ts` | Modify | New states, both themes |
| `apps/dashboard/src/i18n/strings.ts` | Modify | Category wording, new strings, retired strings removed |
| `apps/dashboard/src/widgets/product-list.ts` | Modify | The whole tree: rows, counts, clicks, menus, name box, empty menu, drag, prices with units |
| `apps/dashboard/src/widgets/product-list.test.ts` | Modify | Tree, click, menu, name box, unit and empty-menu cases |
| `apps/dashboard/src/widgets/product-list.a11y.test.ts` | Modify | Category menu open, name box, mid-drag states |
| `apps/dashboard/src/widgets/catalogue-browser.ts` | Modify | Search box and Select mode slotted into the table's toolbar; saves names; reveals the addressed category; no breadcrumb, switch, New folder or category form |
| `apps/dashboard/src/widgets/catalogue-browser.test.ts` | Modify | Rewritten for the tree, per the lists in each task |
| `apps/dashboard/src/widgets/catalogue-browser.a11y.test.ts` | Modify | States follow the new screen |
| `apps/dashboard/src/screens/catalogue-screen.ts` | Modify | No header button; `category=`; adds from the menus; reveal after create; focus return |
| `apps/dashboard/src/screens/catalogue-screen.test.ts` | Modify | Adds start from the menus; address cases |
| `apps/dashboard/src/screens/catalogue-screen.a11y.test.ts` | Modify | Add starts from the menu event |
| `apps/dashboard/src/navigation.ts` | Modify | `catalogue: { product, category }` |
| `docs/developers/design-system.md` | Modify | The table's new API and the Products tree |
| `docs/developers/product-categories.md` | Modify | The screen as a tree |
| `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` | Modify | One dated pointer to the new spec |
| `docs/backlog.md` | Modify | A208 and A205 done |

No new source file: the table's additions belong in the table, and the product list already owns rows, cells and the drag.

## How to run things

- One `packages/ui` file: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts`
- One `apps/dashboard` file: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts`
- One case by name: add `-t "<part of the name>"`.
- Types: `pnpm --filter @waitron/ui typecheck` and `pnpm --filter @waitron/dashboard typecheck`.
- Lint and format of touched files: `pnpm exec eslint <files> && pnpm exec prettier --check <files>` (a `docs/` path is ignored by prettier whole; check one with `pnpm exec prettier --file-info <file>`).
- Root guards a task's change can reach: `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts`.
- A passing run ends with `Test Files  N passed (N)`; a failing one with `Tests  N failed`. Read the count — an unknown reporter or a stray `*/` in a doc comment prints `no tests ran` and exits 0 (memory: "no tests ran" has several causes).
- Before a heavy browser run, check headroom: `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`.

---
## Task 1: `wt-data-table` — categories-first groups, always-open branches, and a branch API

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` (properties after `rowParent`, `willUpdate`, `#sortByColumn`, `#treeRows`, `#toggle`, the tree branch of `render`)
- Test: `packages/ui/src/components/wt-data-table.test.ts` (new cases after "a branch the person expanded stays open when the rows are refreshed")
- Test: `packages/ui/src/components/wt-data-table.a11y.test.ts` (one new state)
- Modify: `docs/developers/design-system.md` (the `wt-data-table` row of the component table, and the tree-mode paragraph that starts "Supply `rowParent`")

**Interfaces:**
- Consumes: nothing new.
- Produces (on `WtDataTable<Row>`):
  - `rowGroup?: (row: Row) => number` — siblings sort by this first, smallest first, in either direction.
  - `rowCollapsible: (row: Row) => boolean` (default `() => true`) — a branch it returns false for is always open.
  - `isExpanded(key: string): boolean`
  - `setExpanded(key: string, expanded: boolean): void` — no event.
  - `sortedSiblings(rows: readonly Row[]): Row[]`
  - `revealRow(key: string): Promise<void>` — opens every closed branch above the row, then `scrollIntoView({ block: "nearest" })` on its `<tr>`.
  - Event `wt-expand-change`, `detail: { key: string; expanded: boolean }`, `bubbles` and `composed`, sent only for a person's toggle.
  - Private `#setOpen(keys: readonly string[], open: boolean): void` and `#rowsByKey(): Map<string, Row>`, which Tasks 2 and 3 extend.

- [ ] **Step 1: Write the failing tests**

Append after the test "a branch the person expanded stays open when the rows are refreshed" in `wt-data-table.test.ts`:

```ts
test("a smaller group sorts above a larger one among siblings, in both directions", async () => {
  const groupOf = new Map([
    ["zest", 0],
    ["apple", 1],
    ["bread", 1],
  ]);
  const rows: TreeRow[] = [
    { id: "food", parent: null, name: "Food" },
    { id: "apple", parent: "food", name: "Apple" },
    { id: "zest", parent: "food", name: "Zest" },
    { id: "bread", parent: "food", name: "Bread" },
  ];
  const el = await treeTable({ rows, rowGroup: (row: TreeRow) => groupOf.get(row.id) ?? 0 });
  const sort = el.shadowRoot!.querySelector<HTMLButtonElement>("th button.sort")!;
  sort.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "zest", "apple", "bread"]);
  sort.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "zest", "bread", "apple"]);
});

test("groups order a flat table's rows even with no sort column", async () => {
  const el = await table({ rowGroup: (row: Row) => (row.id === "a" ? 0 : 1) });
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
});

test("an always-open branch draws no toggle, starts open under initiallyCollapsed, and cannot be closed", async () => {
  const el = await treeTable({
    initiallyCollapsed: true,
    rowCollapsible: (row: TreeRow) => row.id !== "food",
  });
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  const food = el.shadowRoot!.querySelector('tr[data-row-key="food"]')!;
  expect(food.querySelector("button.tree-toggle")).toBeNull();
  expect(food.querySelector(".tree-spacer")).not.toBeNull();
  expect(food.getAttribute("aria-expanded")).toBe("true");
  el.setExpanded("food", false);
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
});

test("setExpanded opens and closes a branch, isExpanded says which, and neither reports a person's change", async () => {
  const el = await treeTable({ initiallyCollapsed: true });
  const changes = vi.fn();
  el.addEventListener("wt-expand-change", changes);
  expect(el.isExpanded("food")).toBe(false);
  el.setExpanded("food", true);
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  expect(el.isExpanded("food")).toBe(true);
  el.setExpanded("food", false);
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  expect(el.isExpanded("food")).toBe(false);
  expect(changes).not.toHaveBeenCalled();
});

test("a person's toggle reports the branch and whether it is now open, across shadow boundaries, and stops its click", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Categories"></wt-data-table>',
  )) as WtDataTable<TreeRow>;
  Object.assign(el, {
    rows: treeRows,
    columns: treeColumns,
    rowKey: (row: TreeRow) => row.id,
    rowParent: (row: TreeRow) => row.parent,
  });
  await el.updateComplete;
  const seen: unknown[] = [];
  const record = (event: Event) => seen.push((event as CustomEvent).detail);
  const clicks = vi.fn();
  document.addEventListener("wt-expand-change", record);
  document.addEventListener("click", clicks);
  onTestFinished(() => {
    document.removeEventListener("wt-expand-change", record);
    document.removeEventListener("click", clicks);
  });
  const toggle = () =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] button.tree-toggle')!;
  toggle().click();
  await el.updateComplete;
  toggle().click();
  await el.updateComplete;
  expect(seen).toEqual([
    { key: "food", expanded: false },
    { key: "food", expanded: true },
  ]);
  expect(clicks).not.toHaveBeenCalled();
});

test("sortedSiblings orders rows as the table draws siblings: by group, then by the sorted column", async () => {
  const el = await treeTable({
    sortKey: "name",
    sortDirection: "descending",
    rowGroup: (row: TreeRow) => (row.id === "drinks" ? 0 : 1),
  });
  const food = treeRows[0]!;
  const drinks = treeRows[3]!;
  expect(el.sortedSiblings([food, drinks]).map(({ id }) => id)).toEqual(["drinks", "food"]);
  el.rowGroup = undefined;
  expect(el.sortedSiblings([drinks, food]).map(({ id }) => id)).toEqual(["food", "drinks"]);
});

test("revealRow opens every closed branch above a row and scrolls the row into view", async () => {
  const el = await treeTable({ initiallyCollapsed: true });
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  await el.revealRow("eggs");
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
  expect(scrolled.mock.contexts[0]).toBe(el.shadowRoot!.querySelector('tr[data-row-key="eggs"]'));
});

test("revealRow of a key with no row opens nothing and scrolls nothing", async () => {
  const el = await treeTable({ initiallyCollapsed: true });
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  await el.revealRow("missing");
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  expect(scrolled).not.toHaveBeenCalled();
});

test("revealRow on a flat table opens nothing and scrolls the row into view", async () => {
  const el = await table();
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  await el.revealRow("a");
  expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
  expect(scrolled.mock.contexts[0]).toBe(el.shadowRoot!.querySelector('tr[data-row-key="a"]'));
});

test("revealRow stops at parents that point at each other", async () => {
  const el = await treeTable({ rows: loopingRows });
  await expect(el.revealRow("x")).resolves.toBeUndefined();
});
```

`loopingRows` is declared further down the file at module scope; the test body runs after the module has loaded, so it is in scope.

Append inside the `describe.each` of `wt-data-table.a11y.test.ts`, after "tree mode with a collapsed branch":

```ts
  test("tree mode with an always-open top branch", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Categories"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "all", parent: null, name: "All products" },
      { id: "food", parent: "all", name: "Food" },
      { id: "eggs", parent: "food", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.rowCollapsible = (row) => row.id !== "all";
    el.initiallyCollapsed = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t "group|always-open|setExpanded|person's toggle reports|sortedSiblings|revealRow"`
Expected: FAIL — the group cases sort by name alone; `setExpanded`, `isExpanded`, `sortedSiblings` and `revealRow` are not functions; no `wt-expand-change` arrives; the always-open case finds a toggle on "food".

- [ ] **Step 3: Implement**

In `wt-data-table.ts`, add after the `rowParent` property:

```ts
  /** Siblings sort by this number first, smallest first in either sort direction, and by the chosen
   * column only within a group. */
  @property({ attribute: false }) rowGroup?: (row: Row) => number;
  /** In tree mode, a branch this returns false for is always open: it draws no toggle, is never seeded
   * closed, and `setExpanded` cannot close it. */
  @property({ attribute: false }) rowCollapsible: (row: Row) => boolean = () => true;
```

Replace the seeding block at the top of `willUpdate` (from `const keys = new Set(` to `if (seeded) this.collapsed = next;`) with:

```ts
      const byKey = this.#rowsByKey();
      const next = new Set(this.collapsed);
      let seeded = false;
      for (const row of this.rows) {
        const parent = this.rowParent(row);
        if (parent === null || !byKey.has(parent) || this.seededBranches.has(parent)) continue;
        this.seededBranches.add(parent);
        if (!this.rowCollapsible(byKey.get(parent)!)) continue;
        next.add(parent);
        seeded = true;
      }
      if (seeded) this.collapsed = next;
```

Replace `#sortByColumn` with:

```ts
  /** Nulls sort last in either direction, and a tie keeps the incoming order. */
  #sortByColumn(
    rows: readonly Row[],
    column: DataTableColumn<Row> | undefined,
    indexOf: ReadonlyMap<Row, number>,
  ): Row[] {
    const group = this.rowGroup;
    if (column?.sortValue === undefined && group === undefined) return [...rows];
    const direction = this.sortDirection === "ascending" ? 1 : -1;
    return [...rows]
      .map((row) => ({
        row,
        index: indexOf.get(row)!,
        group: group?.(row) ?? 0,
        value: column?.sortValue?.(row),
      }))
      .sort((left, right) => {
        if (left.group !== right.group) return left.group - right.group;
        if (left.value == null && right.value == null) return left.index - right.index;
        if (left.value == null) return 1;
        if (right.value == null) return -1;
        const compared =
          typeof left.value === "number" && typeof right.value === "number"
            ? left.value - right.value
            : String(left.value).localeCompare(String(right.value), undefined, {
                numeric: true,
                sensitivity: "base",
              });
        return compared === 0 ? left.index - right.index : compared * direction;
      })
      .map(({ row }) => row);
  }
```

In `#treeRows`, change the walk's recursion line to keep an always-open branch open:

```ts
        if (
          hasChildren &&
          (!this.collapsed.has(key) || forcedOpen.has(key) || !this.rowCollapsible(row))
        )
          walk(key, depth + 1);
```

Replace `#toggle` with the branch API:

```ts
  #rowsByKey(): Map<string, Row> {
    const byKey = new Map<string, Row>();
    this.rows.forEach((row, index) => {
      const key = this.rowKey(row, index);
      if (!byKey.has(key)) byKey.set(key, row);
    });
    return byKey;
  }

  #setOpen(keys: readonly string[], open: boolean): void {
    const next = new Set(this.collapsed);
    for (const key of keys) {
      if (open) next.delete(key);
      else next.add(key);
    }
    this.collapsed = next;
  }

  #toggle(key: string): void {
    const expanded = this.collapsed.has(key);
    this.#setOpen([key], expanded);
    this.dispatchEvent(
      new CustomEvent("wt-expand-change", {
        detail: { key, expanded },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Whether a branch shows its children; a key the table has never closed reads as open. */
  isExpanded(key: string): boolean {
    return !this.collapsed.has(key);
  }

  /** Opens or closes one branch as its toggle would, without reporting it as a person's change. */
  setExpanded(key: string, expanded: boolean): void {
    const row = this.#rowsByKey().get(key);
    if (!expanded && row !== undefined && !this.rowCollapsible(row)) return;
    this.#setOpen([key], expanded);
  }

  /** The order the table draws these rows in when they share a parent. */
  sortedSiblings(rows: readonly Row[]): Row[] {
    return this.#sortedRows(rows, this.#sortColumn(this.#shownColumns()));
  }

  /** Opens every closed branch above the row with this key, then scrolls the row into view. */
  async revealRow(key: string): Promise<void> {
    const byKey = this.#rowsByKey();
    const closed: string[] = [];
    const seen = new Set<string>();
    const row = byKey.get(key);
    let parent = row !== undefined && this.rowParent ? this.rowParent(row) : null;
    while (parent !== null && byKey.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      if (this.collapsed.has(parent)) closed.push(parent);
      parent = this.rowParent!(byKey.get(parent)!);
    }
    if (closed.length > 0) this.#setOpen(closed, true);
    await this.updateComplete;
    this.shadowRoot!.querySelector(`tr[data-row-key="${CSS.escape(key)}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }
```

In the tree branch of `render`, replace the two lines

```ts
              const expanded = !this.collapsed.has(key) || ancestorOnly.has(key);
              const cellContext = { ancestorOnly: ancestorOnly.has(key) };
```

with

```ts
              const collapsible = this.rowCollapsible(row);
              const expanded = !collapsible || !this.collapsed.has(key) || ancestorOnly.has(key);
              const cellContext = { ancestorOnly: ancestorOnly.has(key) };
```

change the toggle condition `hasChildren && !cellContext.ancestorOnly` to `hasChildren && collapsible && !cellContext.ancestorOnly`, and the toggle's handler `@click=${() => this.#toggle(key)}` to:

```ts
                                      @click=${(event: Event) => {
                                        event.stopPropagation();
                                        this.#toggle(key);
                                      }}
```

- [ ] **Step 4: Run the tests to see them pass, and the whole file and its axe file**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts src/components/wt-data-table.a11y.test.ts && pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/menu-prices-table.test.ts src/widgets/product-list.test.ts`
Expected: PASS — `Test Files  2 passed (2)` twice. Every existing case passes unchanged; the menus Prices table and the product list are the table's two tree consumers today.

- [ ] **Step 5: Prove the guards by deletion**

Remove `if (left.group !== right.group) return left.group - right.group;` and rerun the two group cases: they FAIL. Restore it. Remove `if (!this.rowCollapsible(byKey.get(parent)!)) continue;` and rerun the always-open case: FAIL. Restore it. Restore each with the editor's undo, never by hand-typing (memory: probe removal loses the trailing newline).

- [ ] **Step 6: Update the design-system docs**

In `docs/developers/design-system.md`, in the `wt-data-table` row of the component table, after `` `initiallyCollapsed`, `` insert:

```markdown
`rowGroup` (`(row) => number` — siblings sort by it first, smallest first in either direction, and by the chosen column only within a group, as the Products tree keeps categories above products), `rowCollapsible` (`(row) => boolean` — a branch it refuses is always open, draws no toggle and is never seeded closed), 
```

and in the events cell, after the `wt-sort-change` entry, insert ``; `wt-expand-change` — `detail: { key, expanded }` (a person opening or closing one branch; not `setExpanded`)``. After the tree paragraph that ends "clearing search restores the branch's own collapsed state.", add:

```markdown
A tree also answers `isExpanded(key)`, opens or closes a branch with `setExpanded(key, expanded)`
(no event), reports the order it would draw a set of siblings in with `sortedSiblings(rows)`, and
`revealRow(key)` opens every closed branch above a row and scrolls the row into view.
```

- [ ] **Step 7: Typecheck, lint, format, commit**

Run: `pnpm --filter @waitron/ui typecheck && pnpm exec eslint packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts && pnpm exec prettier --check packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts`
Expected: no errors, `All matched files use Prettier code style!`

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts docs/developers/design-system.md
git commit -s -m "The shared table can keep one kind of row above another, keep a branch always open, and be opened from code

A tree screen can now sort its categories above its products whichever column is chosen, show a
top row that never closes, and open, close or reveal a branch without a person clicking it. A
person's own toggle is reported as wt-expand-change."
```

---
## Task 2: `wt-data-table` — rows that open or toggle in a tree, and a shallower indent on a phone

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` (`rowClick` doc comment, a new `rowActivation` property, the `.scroll` and tree CSS, the tree row template in `render`)
- Test: `packages/ui/src/components/wt-data-table.test.ts`
- Test: `packages/ui/src/components/wt-data-table.a11y.test.ts`
- Modify: `docs/developers/design-system.md` (the `rowClick` entry in the component table)

**Interfaces:**
- Consumes (Task 1): `#toggle(key)`, `rowCollapsible`.
- Produces: `rowActivation?: (row: Row) => "toggle" | "click" | "none"`. In tree mode, unset means `"click"` for every row. `"toggle"` gives a branch row (one with children, collapsible, not held open by a search) a stretched activator that opens and closes it, labelled like its toggle and carrying `aria-expanded`, and draws its arrow as `span.tree-arrow` (`aria-hidden`) instead of `button.tree-toggle`. `"click"` gives the row the same activator as a flat table's `rowClick`. `"none"` draws no activator. The tree's first-column span carries `--tree-depth` instead of an inline padding.

- [ ] **Step 1: Write the failing tests**

Append after the Task 1 cases in `wt-data-table.test.ts`:

```ts
test("a tree row with rowClick opens from its stretched activator, and its arrow still only toggles", async () => {
  const opened: string[] = [];
  const el = await treeTable({
    rowClick: (row: TreeRow) => opened.push(row.id),
    rowClickLabel: (row: TreeRow) => `Open ${row.name}`,
  });
  const activator = el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="eggs"] .row-activate',
  )!;
  expect(activator.getAttribute("aria-label")).toBe("Open Eggs");
  expect(activator.closest("tr")!.classList.contains("clickable")).toBe(true);
  activator.click();
  expect(opened).toEqual(["eggs"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(opened).toEqual(["eggs"]);
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("a toggling branch opens and closes from its row, says which it will do, and draws its arrow as a picture", async () => {
  const opened: string[] = [];
  const el = await treeTable({
    rowActivation: (row: TreeRow) => (row.id === "eggs" ? "click" : "toggle"),
    rowClick: (row: TreeRow) => opened.push(row.id),
    rowToggleLabel: (row: TreeRow, expanded: boolean) => `${expanded ? "Close" : "Open"} ${row.name}`,
  });
  const activator = () =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="break"] .row-activate')!;
  const arrow = () => el.shadowRoot!.querySelector('tr[data-row-key="break"] .tree-arrow')!;
  expect(activator().getAttribute("aria-label")).toBe("Close Breakfast");
  expect(activator().getAttribute("aria-expanded")).toBe("true");
  expect(el.shadowRoot!.querySelector('tr[data-row-key="break"] button.tree-toggle')).toBeNull();
  expect(arrow().getAttribute("aria-hidden")).toBe("true");
  expect(arrow().textContent!.trim()).toBe("▾");
  activator().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  expect(activator().getAttribute("aria-label")).toBe("Open Breakfast");
  expect(activator().getAttribute("aria-expanded")).toBe("false");
  expect(arrow().textContent!.trim()).toBe("▸");
  expect(opened).toEqual([]);
  // A toggling row with nothing under it has nothing to do, so it is not clickable.
  const drinks = el.shadowRoot!.querySelector('tr[data-row-key="drinks"]')!;
  expect(drinks.querySelector(".row-activate")).toBeNull();
  expect(drinks.classList.contains("clickable")).toBe(false);
});

test("a row whose activation is none draws no activator, even with rowClick set", async () => {
  const el = await treeTable({
    rowActivation: (row: TreeRow) => (row.id === "food" ? "none" : "click"),
    rowClick: (row: TreeRow) => row.id,
  });
  expect(el.shadowRoot!.querySelector('tr[data-row-key="food"] .row-activate')).toBeNull();
  expect(el.shadowRoot!.querySelector('tr[data-row-key="food"] button.tree-toggle')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('tr[data-row-key="drinks"] .row-activate')).not.toBeNull();
});

test("Enter on a toggling row opens and closes it, and reports each change once", async () => {
  const el = await treeTable({ rowActivation: () => "toggle" });
  const seen: unknown[] = [];
  el.addEventListener("wt-expand-change", (event) => seen.push((event as CustomEvent).detail));
  const activator = () =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] .row-activate')!;
  activator().focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  activator().focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  expect(seen).toEqual([
    { key: "food", expanded: false },
    { key: "food", expanded: true },
  ]);
});

test("a real click on a control inside a toggling row does not toggle it", async () => {
  const el = await treeTable({
    rowActivation: () => "toggle",
    columns: [
      ...treeColumns,
      {
        key: "action",
        label: "Actions",
        cell: (row: TreeRow) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ],
  });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('button[aria-label="Edit Food"]')!);
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
});

test("a real click on a pinned cell's empty space toggles a toggling tree row once", async () => {
  const el = await treeTable({
    rowActivation: () => "toggle",
    columns: [
      ...treeColumns,
      {
        key: "action",
        label: "Actions",
        pinned: "end",
        cell: (row: TreeRow) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ],
  });
  const cell = el.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="food"] td[data-pinned="end"]')!;
  const box = cell.getBoundingClientRect();
  await userEvent.click(cell, { position: { x: box.width - 2, y: 2 } });
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("a phone-width tree indents each level half as far, and no deeper than four levels", async () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const deep: TreeRow[] = ids.map((id, index) => ({
    id,
    parent: index === 0 ? null : ids[index - 1]!,
    name: id.toUpperCase(),
  }));
  const el = await treeTable({ rows: deep });
  host.style.setProperty("--wt-space-2", "8px");
  host.style.setProperty("--wt-space-4", "16px");
  const indent = (key: string) =>
    getComputedStyle(
      el.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-cell`)!,
    ).paddingInlineStart;
  el.style.width = "360px";
  expect(["a", "b", "e", "f"].map(indent)).toEqual(["0px", "8px", "32px", "32px"]);
  el.style.width = "600px";
  expect(["a", "b", "e", "f"].map(indent)).toEqual(["0px", "16px", "64px", "80px"]);
});

// A container query measures the box inside its border, which is what clientWidth reports here.
test("the phone indent starts at a 380px box, not at 381px, and a flat table is no size container", async () => {
  const el = await treeTable();
  host.style.setProperty("--wt-space-2", "8px");
  host.style.setProperty("--wt-space-4", "16px");
  const indent = () =>
    getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="break"] .tree-cell')!)
      .paddingInlineStart;
  const box = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  el.style.width = "383px";
  expect(box.clientWidth).toBe(381);
  expect(indent()).toBe("16px");
  el.style.width = "382px";
  expect(box.clientWidth).toBe(380);
  expect(indent()).toBe("8px");
  cleanup();
  const flat = await table();
  expect(getComputedStyle(flat.shadowRoot!.querySelector(".scroll")!).containerType).toBe("normal");
});

test("lines a toggling branch's name up with the text beside it", async () => {
  const el = await treeTable({
    rowActivation: () => "toggle",
    columns: [...treeColumns, { key: "id", label: "Key", cell: (r: TreeRow) => r.id }],
  });
  for (const row of el.shadowRoot!.querySelectorAll("tbody tr")) {
    const [name, key] = row.querySelectorAll("td");
    expect(
      Math.abs(textBox(name!.querySelector(".tree-cell")!).bottom - textBox(key!).bottom),
      row.getAttribute("data-row-key")!,
    ).toBeLessThanOrEqual(1);
  }
});
```

`@vitest/browser-playwright` declares `UserEventClickOptions extends PWClickOptions` (its `dist/index.d.ts`, read, not run), so `position` reaches Playwright's click; if the run refuses it, click the cell's own centre after giving its `Edit` button `margin-inline-start: 100px` in the cell template instead.

Append to `wt-data-table.a11y.test.ts`, inside the `describe.each`:

```ts
  test("tree mode with rows that toggle from the row and rows that open", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      '<wt-data-table aria-label="Categories"></wt-data-table>',
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "food", parent: null, name: "Food" },
      { id: "break", parent: "food", name: "Breakfast" },
      { id: "eggs", parent: "break", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.rowActivation = (row) => (row.id === "eggs" ? "click" : "toggle");
    el.rowClick = (row) => void row.id;
    el.rowClickLabel = (row) => `Open ${row.name}`;
    el.rowToggleLabel = (row, expanded) => `${expanded ? "Close" : "Open"} ${row.name}`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t "tree row with rowClick|toggling|activation is none|phone-width tree|phone indent starts"`
Expected: FAIL — a tree draws no `.row-activate`, `rowActivation` does nothing, and the indent stays 16 px a level at 360 px. Two of the new cases pass already and are there to hold the layering once the activator exists: "a real click on a control inside a toggling row does not toggle it" and "lines a toggling branch's name up with the text beside it".

- [ ] **Step 3: Implement**

Replace the `rowClick` doc comment with:

```ts
  /** When set, each row becomes activatable: a stretched, focusable button covers the row and calls
   * this on click. Per-row controls (the selection checkbox, the Edit/Delete menu) sit above the
   * activator, so they are never swallowed. In a tree, `rowActivation` can give a row a toggle instead. */
```

Add after `rowClickLabel`:

```ts
  /** In tree mode, what a click or Enter anywhere on a row does: "toggle" opens and closes a branch,
   * "click" calls `rowClick`, "none" leaves the row to its own controls. Unset, every row clicks. */
  @property({ attribute: false }) rowActivation?: (row: Row) => "toggle" | "click" | "none";
```

In the CSS, add a rule for the tree's scroll box, replace the `.tree-cell` rule, and add `.tree-arrow` and the container query:

```css
      /* The indent follows the table's own width, not the window's; a flat table needs neither. */
      .scroll.tree {
        container-type: inline-size;
      }
```

and in the tree branch of `render` change `<div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>` to `<div class="scroll tree" tabindex="0" role="region" aria-label=${label ?? nothing}>` (the flat branch's stays `class="scroll"`).

```css
      .tree-arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        font-size: var(--wt-font-size-lg);
        line-height: 1;
      }

      .tree-cell {
        display: inline-flex;
        align-items: baseline;
        padding-inline-start: calc(var(--tree-depth, 0) * var(--wt-space-4));
      }

      @container (max-width: 380px) {
        .tree-cell {
          padding-inline-start: calc(min(var(--tree-depth, 0), 4) * var(--wt-space-2));
        }
      }
```

Replace the tree branch's `entries.map(...)` callback in `render` with:

```ts
            ${entries.map(({ row, key, depth, hasChildren }) => {
              const collapsible = this.rowCollapsible(row);
              const held = ancestorOnly.has(key);
              const expanded = !collapsible || !this.collapsed.has(key) || held;
              const cellContext = { ancestorOnly: held };
              const branch = hasChildren && collapsible && !held;
              const mode = this.rowActivation?.(row) ?? "click";
              const toggles = mode === "toggle" && branch;
              const clicks = mode === "click" && this.rowClick !== undefined;
              const toggleLabel = this.rowToggleLabel
                ? this.rowToggleLabel(row, expanded)
                : expanded
                  ? this.collapseLabel
                  : this.expandLabel;
              const activate = toggles
                ? () => this.#toggle(key)
                : clicks
                  ? () => this.rowClick!(row)
                  : undefined;
              return html`<tr
                data-row-key=${key}
                role="row"
                class=${classMap({ clickable: activate !== undefined })}
                aria-level=${depth + 1}
                aria-expanded=${hasChildren ? String(expanded) : nothing}
              >
                ${this.#renderSelectCell(key, row, true)}
                ${shown.map(
                  (column, ci) =>
                    html`<td
                      role="gridcell"
                      data-align=${column.align ?? "start"}
                      data-pinned=${column.pinned ?? nothing}
                      data-row-activate=${column.activatesRow === false ? "false" : nothing}
                      @click=${
                        column.pinned && column.activatesRow !== false && activate !== undefined
                          ? (event: Event) => {
                              if (event.target === event.currentTarget) activate();
                            }
                          : nothing
                      }
                    >
                      ${
                        ci === 0
                          ? html`${
                              toggles
                                ? html`<button
                                    class="row-activate"
                                    aria-label=${toggleLabel}
                                    aria-expanded=${String(expanded)}
                                    @click=${(event: Event) => {
                                      event.stopPropagation();
                                      this.#toggle(key);
                                    }}
                                  ></button>`
                                : clicks
                                  ? html`<button
                                      class="row-activate"
                                      aria-label=${this.rowClickLabel(row)}
                                      @click=${() => this.rowClick!(row)}
                                    ></button>`
                                  : nothing
                            }<span class="tree-cell" style=${`--tree-depth: ${depth}`}>
                              ${
                                !branch
                                  ? html`<span class="tree-spacer"></span>`
                                  : toggles
                                    ? html`<span class="tree-arrow" aria-hidden="true"
                                        >${expanded ? "▾" : "▸"}</span
                                      >`
                                    : html`<button
                                        class="tree-toggle"
                                        aria-label=${toggleLabel}
                                        @click=${(event: Event) => {
                                          event.stopPropagation();
                                          this.#toggle(key);
                                        }}
                                      >
                                        ${expanded ? "▾" : "▸"}
                                      </button>`
                              }
                              ${column.cell(row, cellContext)}
                            </span>`
                          : column.cell(row, cellContext)
                      }
                    </td>`,
                )}
              </tr>`;
            })}
```

- [ ] **Step 4: Run the tests to see them pass, and the whole file and its axe file**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts src/components/wt-data-table.a11y.test.ts && pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/menu-prices-table.test.ts src/widgets/product-list.test.ts`
Expected: PASS, `Test Files  2 passed (2)` twice. The existing "each level of a tree is indented one step further than the level above it" must pass unchanged; it runs at Vitest's default viewport, so if it fails the breakpoint is wider than the box that viewport gives — print `el.shadowRoot.querySelector(".scroll").clientWidth` in the failing run and move the breakpoint below it, never the test.

- [ ] **Step 5: Prove the guards by deletion**

Change `const toggles = mode === "toggle" && branch;` to `const toggles = mode === "toggle";` and rerun "a toggling branch": the drinks assertions FAIL. Restore. Delete the `@container` block and rerun "a phone-width tree": FAIL. Restore both with undo.

- [ ] **Step 6: Docs**

In `docs/developers/design-system.md`'s component table, replace ``(`(row) => void` — on a plain (non-tree) table, makes each row clickable via a stretched activator button rendered in the first cell; ignored in tree mode)`` with ``(`(row) => void` — makes each row clickable via a stretched activator button rendered in the first cell, in a tree too)``, and after the `rowClickLabel` entry insert ``, `rowActivation` (`(row) => "toggle" | "click" | "none"` — in a tree, a "toggle" branch opens and closes from a click or Enter anywhere on its row and draws its arrow as a picture, "none" draws no activator; unset, every row clicks)``. Append to the tree paragraph: ``A tree whose box is 380px wide or less indents each level `--wt-space-2` instead of `--wt-space-4`, and no deeper than four levels; only a tree's box is a size container.``

- [ ] **Step 7: Typecheck, lint, format, guards, commit**

Run: `pnpm --filter @waitron/ui typecheck && pnpm exec eslint packages/ui/src/components/wt-data-table*.ts && pnpm exec prettier --check packages/ui/src/components/wt-data-table*.ts && pnpm exec vitest run scripts/style-token-names.test.ts`
Expected: no errors; `Test Files  1 passed (1)`.

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts docs/developers/design-system.md
git commit -s -m "A tree table's rows can open, or open and close their branch, from anywhere on the row

Each row of a tree now says what a click or Enter on it does: open the row, open or close its
branch, or nothing. On a phone-width table each level indents half as far, and no deeper than four."
```

---
## Task 3: `wt-data-table` — Expand all, toolbar slots, a consumer's search term, a tree search that opens the path, and remembered branches

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` (new properties; `willUpdate`; `#setOpen`; `#passesSearch` and `#visibleRows`; `#treeVisible`; `#emitSelection`; `#renderToolbar`; the tree branch of `render`; CSS for `.table-end`, `.expand-all`, `.columns-trigger`)
- Test: `packages/ui/src/components/wt-data-table.test.ts`
- Test: `packages/ui/src/components/wt-data-table.a11y.test.ts`
- Modify: `docs/developers/design-system.md`

**Interfaces:**
- Consumes (Task 1): `#setOpen`, `#rowsByKey`, `rowCollapsible`, `#toggle`.
- Produces:
  - `searchTerm: string` (default `""`) — narrows rows as a typed search would while `searchable` is false.
  - `expandAllLabel: string`, `collapseAllLabel: string` (default `""`) — in tree mode, a `button.expand-all` in the toolbar's end group reads `collapseAllLabel` while every collapsible branch is open, `expandAllLabel` otherwise; an empty `expandAllLabel` draws none.
  - `rememberExpanded: boolean` — with `initiallyCollapsed` and a `viewKey`, the open branches are kept in `localStorage` under `${viewKey}:expanded` as a JSON array of keys.
  - Slots `toolbar-start` (before the search box and filters) and `toolbar-end` (in `.table-end`, after Expand all, before Columns). A child carrying either slot attribute draws the toolbar.
  - `searchOpensPath: boolean` (default `false`) — in a tree, while a search term is typed, every row above a match is held open (even one that matches itself), and whatever passes the filters under a match is kept, closed as the person left it. Unset, the search behaves exactly as today: only a row kept solely to place a match is held open, and nothing under a match is kept. With filters alone the rule is today's either way.

- [ ] **Step 1: Write the failing tests**

Append to `wt-data-table.test.ts`:

```ts
test("a tree's Expand all opens every branch, then reads Collapse all, which closes them", async () => {
  const el = await treeTable({
    initiallyCollapsed: true,
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
  });
  const button = () => el.shadowRoot!.querySelector<HTMLButtonElement>(".table-end .expand-all")!;
  expect(button().textContent!.trim()).toBe("Expand all");
  button().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  expect(button().textContent!.trim()).toBe("Collapse all");
  button().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  expect(button().textContent!.trim()).toBe("Expand all");
});

test("Expand all reads Expand all again once one branch is closed, and Collapse all leaves an always-open branch open", async () => {
  const el = await treeTable({
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
    rowCollapsible: (row: TreeRow) => row.id !== "food",
  });
  const button = () => el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  expect(button().textContent!.trim()).toBe("Collapse all");
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="break"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(button().textContent!.trim()).toBe("Expand all");
  button().click();
  await el.updateComplete;
  button().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
});

test("draws no Expand all on a flat table, or on a tree given no label", async () => {
  expect(
    (await table({ expandAllLabel: "Expand all" })).shadowRoot!.querySelector(".expand-all"),
  ).toBeNull();
  cleanup();
  expect((await treeTable()).shadowRoot!.querySelector(".expand-all")).toBeNull();
});

test("puts what its consumer slots at the toolbar's start, before the search box, and at its end, before the chooser", async () => {
  const el = (await mount(
    `<wt-data-table aria-label="Users"
      ><button slot="toolbar-start" data-test="start">Find</button
      ><button slot="toolbar-end" data-test="end">Select</button></wt-data-table
    >`,
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns: choosable, rowKey: (row: Row) => row.id, searchable: true });
  await el.updateComplete;
  el.style.width = "1000px";
  const start = el.querySelector<HTMLElement>('[data-test="start"]')!;
  const end = el.querySelector<HTMLElement>('[data-test="end"]')!;
  expect(start.assignedSlot!.closest(".table-toolbar")).not.toBeNull();
  expect(end.assignedSlot!.closest(".table-end")).not.toBeNull();
  const search = el.shadowRoot!.querySelector(".table-search")!.getBoundingClientRect();
  expect(start.getBoundingClientRect().right).toBeLessThanOrEqual(search.left);
  expect(end.getBoundingClientRect().right).toBeLessThanOrEqual(trigger(el).getBoundingClientRect().left);
});

test("draws the toolbar for slotted controls alone", async () => {
  const el = (await mount(
    '<wt-data-table aria-label="Users"><button slot="toolbar-end">Select</button></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".table-toolbar .table-end slot[name=toolbar-end]")).not.toBeNull();
});

test("searchTerm narrows a table whose search box is off, keeping a tree match's ancestors", async () => {
  const el = await treeTable({
    rows: [...treeRows, { id: "cola", parent: "drinks", name: "Cola" }],
    searchTerm: " EGGS ",
  });
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
  el.searchTerm = "";
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks", "cola"]);
});

test("searchTerm is ignored while the table draws its own search box", async () => {
  const el = await table({ searchable: true, searchTerm: "ada" });
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
});

const pathRows: TreeRow[] = [
  { id: "food", parent: null, name: "Food" },
  { id: "break", parent: "food", name: "Food at breakfast" },
  { id: "eggs", parent: "break", name: "Eggs" },
  { id: "drinks", parent: null, name: "Drinks" },
];

test("without searchOpensPath a search keeps today's rule: a matching branch stays as it was, and nothing under a match is kept", async () => {
  const el = await treeTable({ initiallyCollapsed: true, rows: pathRows, searchTerm: "food" });
  expect(treeKeys(el)).toEqual(["food"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] button.tree-toggle')!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break"]);
  expect(el.shadowRoot!.querySelector('tr[data-row-key="break"] button.tree-toggle')).toBeNull();
});

test("while searching, a branch that matches and holds a match is held open without a toggle", async () => {
  const el = await treeTable({
    initiallyCollapsed: true,
    rows: pathRows,
    searchTerm: "food",
    searchOpensPath: true,
  });
  expect(treeKeys(el)).toEqual(["food", "break"]);
  expect(el.shadowRoot!.querySelector('tr[data-row-key="food"] button.tree-toggle')).toBeNull();
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="break"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
  el.searchTerm = "";
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("while searching, what passes the filters under a match stays reachable, closed as it was", async () => {
  const el = await treeTable({ initiallyCollapsed: true, searchTerm: "breakfast", searchOpensPath: true });
  expect(treeKeys(el)).toEqual(["food", "break"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="break"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
});

test("a filter alone holds open only a branch kept to place a match, not one that passes it", async () => {
  const columns: DataTableColumn<TreeRow>[] = [
    {
      key: "name",
      label: "Name",
      cell: (row) => row.name,
      sortValue: (row) => row.name,
      filter: {
        label: "Kind",
        allLabel: "Any kind",
        value: (row) => (row.id === "food" || row.id === "eggs" ? "keep" : "drop"),
        options: [
          { value: "keep", label: "Keep" },
          { value: "drop", label: "Drop" },
        ],
        initial: "keep",
      },
    },
  ];
  const el = await treeTable({ columns, initiallyCollapsed: true });
  expect(treeKeys(el)).toEqual(["food"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
});

test("remembers the branches a person opens under the view key, and opens them on the next visit", async () => {
  const props = { initiallyCollapsed: true, viewKey: "test.tree", rememberExpanded: true };
  const first = await treeTable(props);
  first.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await first.updateComplete;
  expect(JSON.parse(localStorage.getItem("test.tree:expanded")!)).toEqual(["food"]);
  cleanup();
  const second = await treeTable(props);
  expect(treeKeys(second)).toEqual(["food", "break", "drinks"]);
  second.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await second.updateComplete;
  expect(JSON.parse(localStorage.getItem("test.tree:expanded")!)).toEqual([]);
});

test("Expand all and Collapse all are remembered too", async () => {
  const el = await treeTable({
    initiallyCollapsed: true,
    viewKey: "test.tree",
    rememberExpanded: true,
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
  });
  el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!.click();
  await el.updateComplete;
  expect(JSON.parse(localStorage.getItem("test.tree:expanded")!).sort()).toEqual(["break", "food"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!.click();
  await el.updateComplete;
  expect(JSON.parse(localStorage.getItem("test.tree:expanded")!)).toEqual([]);
});

test("remembers nothing without rememberExpanded", async () => {
  const el = await treeTable({ initiallyCollapsed: true, viewKey: "test.tree" });
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(localStorage.getItem("test.tree:expanded")).toBeNull();
});

test.each([
  ["not JSON", "{"],
  ["a number", "5"],
  ["an object", '{"food":true}'],
  ["a key with no row", '["gone"]'],
])("a stored open list that is %s opens nothing", async (_label, stored) => {
  localStorage.setItem("test.tree:expanded", stored);
  const el = await treeTable({ initiallyCollapsed: true, viewKey: "test.tree", rememberExpanded: true });
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("a stored open list keeps its keys and drops anything that is not one", async () => {
  localStorage.setItem("test.tree:expanded", '[5, "food"]');
  const el = await treeTable({ initiallyCollapsed: true, viewKey: "test.tree", rememberExpanded: true });
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
});

test("blocked local storage leaves every branch closed, and opening one still works", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const el = await treeTable({ initiallyCollapsed: true, viewKey: "test.tree", rememberExpanded: true });
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
});

test("the Expand all button paints from the theme tokens and draws the focus ring", async () => {
  const el = await treeTable({ expandAllLabel: "Expand all", collapseAllLabel: "Collapse all" });
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(4, 5, 6)");
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  expect(getComputedStyle(button).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(button).color).toBe("rgb(10, 11, 12)");
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  button.focus();
  await userEvent.keyboard("{Tab}");
  button.focus();
  expect(button.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(button).outlineColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(button).outlineStyle).toBe("solid");
});
```

Append to `wt-data-table.a11y.test.ts`, inside the `describe.each`:

```ts
  test("a tree's toolbar with Expand all and slotted controls", async () => {
    type TreeRow = { id: string; parent: string | null; name: string };
    const el = (await mountThemed(
      `<wt-data-table aria-label="Categories"
        ><input slot="toolbar-start" type="search" aria-label="Search categories" /><button
          slot="toolbar-end"
          type="button"
        >Select</button></wt-data-table
      >`,
      theme,
    )) as WtDataTable<TreeRow>;
    el.columns = [
      { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
    ] satisfies DataTableColumn<TreeRow>[];
    el.rows = [
      { id: "food", parent: null, name: "Food" },
      { id: "eggs", parent: "food", name: "Eggs" },
    ];
    el.rowKey = (row) => row.id;
    el.rowParent = (row) => row.parent;
    el.expandAllLabel = "Expand all";
    el.collapseAllLabel = "Collapse all";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t "Expand all|toolbar|searchTerm|searchOpensPath|while searching|filter alone|remember|stored open list|blocked local storage leaves"`
Expected: FAIL — no `.expand-all`, no slots, `searchTerm` narrows nothing, a matching branch closes its matches, nothing is stored. Two cases pass already and pin today's behaviour against Step 3's change: "searchTerm is ignored while the table draws its own search box" (an unknown property changes nothing) and "a filter alone holds open only…". "without searchOpensPath a search keeps today's rule…" fails now only because `searchTerm` does not narrow yet; after Step 3 it pins today's search rule as the default.

- [ ] **Step 3: Implement**

Add the properties after `viewKey`:

```ts
  /** Narrows rows as a typed search would, for a table whose search box its consumer draws; ignored
   * while `searchable` draws the table's own. */
  @property() searchTerm = "";
  /** In tree mode, the toolbar's button that opens every branch; it reads `collapseAllLabel` while
   * every branch is open. Empty draws no button. */
  @property() expandAllLabel = "";
  @property() collapseAllLabel = "";
  /** With `initiallyCollapsed` and a `viewKey`, the browser's local storage keeps the branches a
   * person opens, under `${viewKey}:expanded`, and opens them on the next visit. */
  @property({ type: Boolean }) rememberExpanded = false;
  /** In a tree, while a search is typed, holds open every row above a match, and keeps what passes
   * the filters under a match reachable. Off, only a row kept solely to place a match is held open. */
  @property({ type: Boolean }) searchOpensPath = false;
```

Add the remembered set beside `seededBranches`:

```ts
  #remembered: Set<string> | null = null;

  #rememberedOpen(): Set<string> {
    if (this.#remembered) return this.#remembered;
    let parsed: unknown = [];
    if (this.rememberExpanded && this.viewKey) {
      try {
        parsed = JSON.parse(localStorage.getItem(`${this.viewKey}:expanded`) ?? "[]");
      } catch {
        // Blocked or malformed storage reads as nothing remembered.
      }
    }
    this.#remembered = new Set(
      Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [],
    );
    return this.#remembered;
  }
```

At the very top of `willUpdate`, before the seeding block:

```ts
    if (changed.has("viewKey") || changed.has("rememberExpanded")) this.#remembered = null;
```

In the seeding loop, replace `next.add(parent); seeded = true;` with:

```ts
        if (this.#rememberedOpen().has(parent)) continue;
        next.add(parent);
        seeded = true;
```

Replace `#setOpen` with:

```ts
  #setOpen(keys: readonly string[], open: boolean): void {
    const next = new Set(this.collapsed);
    const remembered = this.#rememberedOpen();
    for (const key of keys) {
      if (open) {
        next.delete(key);
        remembered.add(key);
      } else {
        next.add(key);
        remembered.delete(key);
      }
    }
    this.collapsed = next;
    if (!this.rememberExpanded || !this.viewKey) return;
    try {
      localStorage.setItem(`${this.viewKey}:expanded`, JSON.stringify([...remembered]));
    } catch {
      // The remembered branches are a convenience; the table works without them.
    }
  }
```

Replace `#passesSearch` and `#visibleRows` with:

```ts
  #term(): string {
    return (this.searchable ? this.searchText : this.searchTerm).trim().toLocaleLowerCase();
  }

  #passesSearch(row: Row): boolean {
    const term = this.#term();
    return term === "" || this.#searchHaystack(row).includes(term);
  }

  #activeFilters(): { value: (row: Row) => string | readonly string[]; selected: string }[] {
    return this.columns.flatMap((column) => {
      const selected = this.#activeFilter(column);
      return selected === "" ? [] : [{ value: column.filter!.value, selected }];
    });
  }

  #passesFilters(
    row: Row,
    active: readonly { value: (row: Row) => string | readonly string[]; selected: string }[],
  ): boolean {
    return active.every(({ value, selected }) => {
      const held = value(row);
      return typeof held === "string" ? held === selected : held.includes(selected);
    });
  }

  #visibleRows(): readonly Row[] {
    const active = this.#activeFilters();
    return this.rows.filter((row) => this.#passesFilters(row, active) && this.#passesSearch(row));
  }
```

Replace `#treeVisible` with:

```ts
  /** In tree mode a match's ancestors stay, so it is not shown as a false top-level row. With
   * `searchOpensPath` and a search typed, every ancestor is held open and what passes the filters
   * under a match stays reachable; otherwise only an ancestor kept solely for a match is held open. */
  #treeVisible(visible: readonly Row[]): {
    rows: readonly Row[];
    ancestorOnly: ReadonlySet<string>;
    heldOpen: ReadonlySet<string>;
  } {
    const parentOf = this.rowParent!;
    const keys = this.rows.map((row, index) => this.rowKey(row, index));
    const keyByRow = new Map<Row, string>();
    const rowByKey = new Map<string, Row>();
    this.rows.forEach((row, index) => {
      keyByRow.set(row, keys[index]!);
      if (!rowByKey.has(keys[index]!)) rowByKey.set(keys[index]!, row);
    });
    const matched = new Set(visible.map((row) => keyByRow.get(row)!));
    const ancestors = new Set<string>();
    this.rows.forEach((row, index) => {
      if (!matched.has(keys[index]!)) return;
      const visited = new Set<string>();
      let parentKey = parentOf(row);
      while (parentKey && !visited.has(parentKey)) {
        visited.add(parentKey);
        ancestors.add(parentKey);
        const parent = rowByKey.get(parentKey);
        parentKey = parent ? parentOf(parent) : null;
      }
    });
    const searching = this.searchOpensPath && this.#term() !== "";
    const below = new Set<string>();
    if (searching) {
      const active = this.#activeFilters();
      let grew = true;
      while (grew) {
        grew = false;
        this.rows.forEach((row, index) => {
          const key = keys[index]!;
          const parent = parentOf(row);
          if (matched.has(key) || below.has(key) || parent === null) return;
          if (!matched.has(parent) && !below.has(parent)) return;
          if (!this.#passesFilters(row, active)) return;
          below.add(key);
          grew = true;
        });
      }
    }
    const included = new Set([...matched, ...ancestors, ...below]);
    const ancestorOnly = new Set(
      [...ancestors].filter((key) => !matched.has(key) && !below.has(key)),
    );
    return {
      rows: this.rows.filter((_row, index) => included.has(keys[index]!)),
      ancestorOnly,
      heldOpen: searching ? ancestors : ancestorOnly,
    };
  }
```

In the tree branch of `render`, replace

```ts
    const { rows: treeRows, ancestorOnly } = treeVisible!;
    const entries = this.#treeRows(treeRows, ancestorOnly, sortColumn);
```

with

```ts
    const { rows: treeRows, ancestorOnly, heldOpen } = treeVisible!;
    const entries = this.#treeRows(treeRows, heldOpen, sortColumn);
```

and in the row callback (Task 2's version) replace `const held = ancestorOnly.has(key);` and `const cellContext = { ancestorOnly: held };` with:

```ts
              const held = heldOpen.has(key);
              const cellContext = { ancestorOnly: ancestorOnly.has(key) };
```

Add the expand-all pieces before `#renderToolbar`:

```ts
  #branchKeys(): string[] {
    const byKey = this.#rowsByKey();
    const parents = new Set<string>();
    for (const row of this.rows) {
      const parent = this.rowParent!(row);
      if (parent !== null && byKey.has(parent) && this.rowCollapsible(byKey.get(parent)!))
        parents.add(parent);
    }
    return [...parents];
  }

  #renderExpandAll() {
    if (!this.rowParent || this.expandAllLabel === "") return nothing;
    const branches = this.#branchKeys();
    const allOpen = branches.length > 0 && branches.every((key) => !this.collapsed.has(key));
    return html`<button
      type="button"
      class="expand-all"
      @click=${() => this.#setOpen(branches, !allOpen)}
    >
      ${allOpen ? this.collapseAllLabel : this.expandAllLabel}
    </button>`;
  }
```

Replace `#renderToolbar` with (the search box and filter templates are today's, unchanged):

```ts
  #renderToolbar() {
    const hasFilters = this.columns.some((column) => column.filter);
    const choosable = this.columns.filter((column) => column.choosable !== undefined);
    const slotted = (name: string) => this.querySelector(`:scope > [slot="${name}"]`) !== null;
    const start = slotted("toolbar-start");
    const end = slotted("toolbar-end");
    const expandAll = this.#renderExpandAll();
    if (
      !this.searchable &&
      !hasFilters &&
      choosable.length === 0 &&
      !start &&
      !end &&
      expandAll === nothing
    )
      return nothing;
    return html`<div class="table-toolbar">
      <slot name="toolbar-start"></slot>
      ${
        this.searchable
          ? html`<input
              class="table-search"
              type="search"
              name="search"
              autocomplete="off"
              aria-label=${this.searchLabel}
              placeholder=${this.searchPlaceholder || this.searchLabel}
              .value=${this.searchText}
              @input=${(event: Event) => {
                this.searchText = (event.target as HTMLInputElement).value;
              }}
            />`
          : nothing
      }
      ${
        hasFilters
          ? html`<div class="table-filters">
              ${this.columns.map((column) => {
                const active = this.#activeFilter(column);
                return column.filter
                  ? html`<wt-combobox
                      class="table-filter"
                      name=${`${column.key}-filter`}
                      data-filter=${column.key}
                      label=${column.filter.label}
                      hide-label
                      search="auto"
                      placeholder=${column.filter.allLabel}
                      searchPlaceholder=${this.filterSearchPlaceholder}
                      noResultsLabel=${this.filterNoResultsLabel}
                      .options=${[
                        { value: "", label: column.filter.allLabel },
                        ...column.filter.options,
                      ]}
                      .value=${active}
                      @wt-change=${(event: CustomEvent<{ value: string }>) => {
                        event.stopPropagation();
                        const value = event.detail.value;
                        // The combobox sends a change for a click on its already-chosen row too.
                        if (value === this.#activeFilter(column)) return;
                        const next = { ...this.filterSelections };
                        if (value === "" && column.filter!.initial === undefined)
                          delete next[column.key];
                        else next[column.key] = value;
                        this.filterSelections = next;
                        this.#persistView();
                        this.dispatchEvent(
                          new CustomEvent("wt-filter-change", {
                            detail: { filters: { ...this.filterSelections } },
                            bubbles: true,
                            composed: true,
                          }),
                        );
                      }}
                    ></wt-combobox>`
                  : nothing;
              })}
            </div>`
          : nothing
      }
      ${
        expandAll !== nothing || end || choosable.length > 0
          ? html`<div class="table-end">
              ${expandAll}<slot name="toolbar-end"></slot>${
                choosable.length > 0 ? this.#renderChooser(choosable) : nothing
              }
            </div>`
          : nothing
      }
    </div>`;
  }
```

In the CSS, remove `margin-inline-start: auto;` from `.columns-trigger`, rename the selector `.columns-trigger` to `.columns-trigger, .expand-all` (its other declarations unchanged), add `.expand-all:focus-visible` to the `.columns-trigger:focus-visible, .column-choice input:focus-visible` rule, and add:

```css
      .table-end {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-inline-start: auto;
      }
```

- [ ] **Step 4: Run the tests to see them pass, and the whole file and its axe file**

Run: `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts src/components/wt-data-table.a11y.test.ts && pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/menu-prices-table.test.ts src/widgets/menu-prices-table.a11y.test.ts src/widgets/product-list.test.ts`
Expected: PASS. Existing cases "the chooser sits at the toolbar's trailing end, after the filters", "a filtered tree keeps a match's ancestor chain and marks it ancestor-only", "typed search text stops narrowing once the search box is turned off", and the menus Prices table's "keeps a product's variants when the product is found by its name" pass unchanged — that table does not set `searchOpensPath`.

- [ ] **Step 5: Prove the guards by deletion**

Change `heldOpen: searching ? ancestors : ancestorOnly` to `heldOpen: ancestors` and rerun "a filter alone…": FAIL. Change it to `heldOpen: ancestorOnly` and rerun "while searching, a branch that matches…": FAIL. Delete `this.searchOpensPath && ` and rerun "without searchOpensPath a search keeps today's rule…": FAIL. Delete the `if (!this.#passesFilters(row, active)) return;` line: no case fails — add this one, which must then fail, and pass once the line is back:

```ts
test("while searching, a row under a match that the filters drop stays out", async () => {
  const columns: DataTableColumn<TreeRow>[] = [
    {
      key: "name",
      label: "Name",
      cell: (row) => row.name,
      sortValue: (row) => row.name,
      filter: {
        label: "Kind",
        allLabel: "Any kind",
        value: (row) => (row.id === "eggs" ? "drop" : "keep"),
        options: [
          { value: "keep", label: "Keep" },
          { value: "drop", label: "Drop" },
        ],
        initial: "keep",
      },
    },
  ];
  const el = await treeTable({ columns, searchTerm: "breakfast", searchOpensPath: true });
  expect(treeKeys(el)).toEqual(["food", "break"]);
  expect(el.shadowRoot!.querySelector('tr[data-row-key="break"] button.tree-toggle')).toBeNull();
});
```

Restore everything with undo and rerun the file: PASS.

- [ ] **Step 6: Docs**

In `docs/developers/design-system.md`'s component table, after `viewKey`, insert ``, `searchTerm` (narrows rows as a typed search would while `searchable` is off — for a screen that draws its own search box), `expandAllLabel` and `collapseAllLabel` (in a tree, a toolbar button that opens every branch, reading the second label while all are open), `rememberExpanded` (with `initiallyCollapsed` and `viewKey`, keeps the open branches in local storage under `${viewKey}:expanded`)``, and after the `empty-action` slot entry insert ``; `toolbar-start` and `toolbar-end` slots (a screen's own controls at the toolbar's start, and at its end before Columns)``. Insert ``, `searchOpensPath` (in a tree, while a search is typed, holds every row above a match open and keeps what is under a match reachable)`` after the `rememberExpanded` entry, and replace the tree paragraph's last sentence ("When search keeps an ancestor … collapsed state.") with:

```markdown
When search keeps an ancestor solely to reveal a matching descendant, the table opens that branch
without showing an ineffective collapse control; clearing search restores the branch's own collapsed
state. With `searchOpensPath`, as the Products tree sets it, every row above a match is held open
while a search is typed, even one that matches itself, and what passes the filters under a match
stays reachable, closed as the person left it. With filters alone, only a row kept solely to hold a
match's place is held open.
```

- [ ] **Step 7: Typecheck, lint, format, commit**

Run: `pnpm --filter @waitron/ui typecheck && pnpm exec eslint packages/ui/src/components/wt-data-table*.ts && pnpm exec prettier --check packages/ui/src/components/wt-data-table*.ts`
Expected: no errors.

```bash
git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts packages/ui/src/components/wt-data-table.a11y.test.ts docs/developers/design-system.md
git commit -s -m "A tree table can open everything at once, remember what was open, and take its search from its screen

The table's toolbar can hold a screen's own search box and buttons, and an Expand all / Collapse
all button. A tree can remember which branches a person opened, in this browser. While a search
is typed, every category above a match is held open, and what sits under a match can still be
opened."
```

---
## Task 4: Words — "category" for "folder", and "Any ordering"

**Files:**
- Modify: `apps/dashboard/src/i18n/strings.ts` (the `folders.*` block in `en` and in `es`, and `product.filter_ordering_all` in both)
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts` (the `{folders}` placeholder in `#operationDialog`)
- Test: `apps/dashboard/src/widgets/catalogue-browser.test.ts`
- Test: `apps/dashboard/src/widgets/product-list.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the strings below. Keys keep the `folders.` prefix. `folders.contents_delete`'s placeholder becomes `{categories}`.

- [ ] **Step 1: Write the failing tests**

In `catalogue-browser.test.ts`, add `import { en, es } from "../i18n/strings.js";` beside the other imports and append:

```ts
it.each([
  ["English", en],
  ["Spanish", es],
] as const)("says category, never folder, in every Products-screen string (%s)", (_name, strings) => {
  const screen = Object.entries(strings).filter(
    ([key]) =>
      /^(folders|catalogue|categories)\./.test(key) || key === "product.filter_ordering_all",
  );
  expect(screen.length).toBeGreaterThan(40);
  expect(screen.filter(([, text]) => /folder|carpeta/i.test(text))).toEqual([]);
});
```

In `product-list.test.ts`, inside `describe("product-list")`, append:

```ts
  it.each([
    ["en-GB", "Any ordering"],
    ["es-ES", "Cualquier pedido por separado"],
  ])("names the ordering filter's empty choice like the status filter's (%s)", async (locale, label) => {
    setLocale(locale);
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product()],
    });
    const select = (await tableRoot(el)).querySelector<WtCombobox>(
      'wt-combobox[data-filter="ordering"]',
    )!;
    expect(select.options[0]).toEqual({ value: "", label });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts src/widgets/product-list.test.ts -t "never folder|ordering filter's empty choice"`
Expected: FAIL — the scan lists every `folders.*` value naming a folder; the label reads "All products" / "Todos los productos".

- [ ] **Step 3: Implement**

In `strings.ts`, `en` block, change these values (keys unchanged):

```ts
  "folders.contents_move_up": "Move it up to the parent category",
  "folders.contents_delete":
    "Delete it too: {categories} and {products} (products become inactive)",
  "folders.count": "{count} categories",
  "folders.count_one": "1 category",
  "folders.routes_warning":
    "{count} kitchen routing rules name these categories and will be removed.",
  "folders.routes_warning_one": "1 kitchen routing rule names these categories and will be removed.",
  "folders.no_routing_rule": "No kitchen routing rule covers this category",
  "folders.summary_error":
    "What these categories hold could not be read, so they cannot be deleted yet.",
  "folders.view_folders": "Categories",
  "folders.search": "Search products and categories",
  "folders.new": "New category",
  "folders.breadcrumb": "Category path",
```

and `"product.filter_ordering_all": "Any ordering",`. In the `es` block:

```ts
  "folders.contents_move_up": "Subirlo a la categoría superior",
  "folders.contents_delete":
    "Eliminarlo también: {categories} y {products} (los productos se desactivan)",
  "folders.count": "{count} categorías",
  "folders.count_one": "1 categoría",
  "folders.routes_warning":
    "{count} reglas de envío a cocina nombran estas categorías y se eliminarán.",
  "folders.routes_warning_one": "1 regla de envío a cocina nombra estas categorías y se eliminará.",
  "folders.no_routing_rule": "Ninguna regla de envío a cocina cubre esta categoría",
  "folders.summary_error":
    "No se pudo leer lo que contienen estas categorías, así que aún no se pueden eliminar.",
  "folders.view_folders": "Categorías",
  "folders.search": "Buscar productos y categorías",
  "folders.new": "Nueva categoría",
  "folders.breadcrumb": "Ruta de categorías",
```

and `"product.filter_ordering_all": "Cualquier pedido por separado",`. (`folders.view_folders`, `folders.new` and `folders.breadcrumb` are reworded here and deleted when their last use goes, in Tasks 6 and 9.)

In `catalogue-browser.ts`, `#operationDialog`, change `.replace("{folders}", this.#plural("folders.count", totals.folders))` to `.replace("{categories}", this.#plural("folders.count", totals.folders))`.

- [ ] **Step 4: Update the assertions that read the old words (approved by §8: the word "folder")**

In `catalogue-browser.test.ts`:
- "marks only folders without an active own or inherited routing claim and clears the mark when claimed": `"No kitchen routing rule covers this folder"` → `"No kitchen routing rule covers this category"`, and `"Ninguna regla de envío a cocina cubre esta carpeta"` → `"Ninguna regla de envío a cocina cubre esta categoría"`.
- "shows folder contents and routes, defaults to moving up, and sends delete choice" and "counts overlapping selected folders once in the delete consent": `"1 folder and 2 products"` → `"1 category and 2 products"`.

- [ ] **Step 5: Run the two files**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts src/widgets/product-list.test.ts`
Expected: PASS, `Test Files  2 passed (2)`. "narrows the list to the products of one ordering" passes unchanged: it reads the label through `t()`.

- [ ] **Step 6: Typecheck, lint, format, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/catalogue-browser.ts apps/dashboard/src/widgets/catalogue-browser.test.ts apps/dashboard/src/widgets/product-list.test.ts && pnpm exec prettier --check apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/catalogue-browser.ts apps/dashboard/src/widgets/catalogue-browser.test.ts apps/dashboard/src/widgets/product-list.test.ts`

```bash
git add apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/catalogue-browser.ts apps/dashboard/src/widgets/catalogue-browser.test.ts apps/dashboard/src/widgets/product-list.test.ts
git commit -s -m "The Products screen says category, not folder, in English and Spanish

The ordering filter's empty choice now reads Any ordering, like Any status, so it is not
mistaken for the All products row the tree adds. The string keys keep their folders. prefix."
```

---

## Task 5: Prices show their unit

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts` (imports, two properties, `#unitWord`, the `price` column's cell, one `::part` rule)
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts` (two properties passed through)
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts` (passes them)
- Modify: `apps/dashboard/src/i18n/strings.ts` (two strings in each language)
- Test: `apps/dashboard/src/widgets/product-list.test.ts`, `apps/dashboard/src/screens/catalogue-screen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProductList.units: readonly Unit[]`, `ProductList.unitLanguage: string`; the same two on `CatalogueBrowser`; the price cell's `<span part="price-unit" data-test="price-unit">`.

- [ ] **Step 1: Write the failing tests**

In `product-list.test.ts` add `Unit` to the `../api/client.js` type import and append inside `describe("product-list")`:

```ts
  const kilo: Unit = {
    id: "kg",
    name: { en: "Kilogram", es: "Kilogramo" },
    abbreviation: { en: "kg", es: "kg" },
    precision: 3,
  };

  // \s+ also folds the no-break space Spanish writes before the sign.
  it.each([
    { locale: "en-GB", language: "en", each: "€19.00 each", weighed: "€48.00 / kg" },
    { locale: "es-ES", language: "es", each: "19,00 € la unidad", weighed: "48,00 € / kg" },
  ])("names the unit after each price in $locale", async ({ locale, language, each, weighed }) => {
    setLocale(locale);
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [
        product({ id: "plate", unitPrice: "19.00" }),
        product({ id: "ham", name: "Jamón", unitId: "kg", unit: kilo, unitPrice: "48.00" }),
      ],
      units: [kilo],
      unitLanguage: language,
    });
    const root = await tableRoot(el);
    const price = (key: string) =>
      cellUnder(root, key, t("product.price")).textContent!.replace(/\s+/g, " ").trim();
    expect(price("plate")).toBe(each);
    expect(price("ham")).toBe(weighed);
  });

  it("names a stored unit with no abbreviation by its name, and a variant by its product's unit", async () => {
    const tray: Unit = { id: "tray", name: { es: "bandeja" }, abbreviation: {}, precision: 0 };
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun", unitId: "tray", unit: tray, variants: [bunVariant] })],
      units: [tray],
      unitLanguage: "es",
    });
    const root = await tableRoot(el);
    root.querySelector<HTMLElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    const unit = (key: string) =>
      cellUnder(root, key, t("product.price")).querySelector('[data-test="price-unit"]')!
        .textContent!.trim();
    expect(unit("bun")).toBe("/ bandeja");
    expect(unit("bun:small")).toBe("/ bandeja");
  });

  it("draws the unit quietly, in the muted colour and the small size", async () => {
    const { el, host } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product()],
    });
    host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-font-size-sm", "11px");
    const unit = (await tableRoot(el)).querySelector<HTMLElement>('[data-test="price-unit"]')!;
    expect(unit.getAttribute("part")).toBe("price-unit");
    expect(getComputedStyle(unit).color).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(unit).fontSize).toBe("11px");
  });
```

In `catalogue-screen.test.ts`, inside `describe("catalogue-screen")`, append:

```ts
  it("hands the product list the stored units and the content language their names are read in", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(list(el).units).toEqual(units);
    expect(list(el).unitLanguage).toBe("es");
    await list(el).updateComplete;
    const products = list(el).shadowRoot!.querySelector("dashboard-product-list")!;
    expect(products.units).toEqual(units);
    expect(products.unitLanguage).toBe("es");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/screens/catalogue-screen.test.ts -t "unit"`
Expected: the four new cases FAIL — the price cell holds only the amount, and the properties are undefined. Older cases whose names contain "unit" pass.

- [ ] **Step 3: Implement**

`strings.ts`, `en`: `"product.price_each": "each",` and `"product.price_per": "/ {unit}",`; `es`: `"product.price_each": "la unidad",` and `"product.price_per": "/ {unit}",` (beside `product.price`).

`product-list.ts`: change the shared import to `import { formatMoney, resolveContentText } from "@waitron/shared";`, add `Unit` to the `../api/client.js` type import, and add after `optionLists`:

```ts
  /** The venue's stored units; a product whose unit is not among them is sold by the each. */
  @property({ attribute: false }) units: readonly Unit[] = [];
  /** The content language a stored unit's abbreviation is read in. */
  @property() unitLanguage = "en";
```

Add after `#price`:

```ts
  /** The rule the product editor's `unitShortLabel` uses: Each for a unit that is not stored, else
   * the abbreviation, or the name when it has none. A listed product with no stored unit still
   * carries one, the server's Each, so only the stored list tells the two apart. */
  #unitWord(product: Product): string {
    if (!this.units.some(({ id }) => id === product.unitId)) return t("product.price_each");
    const language = this.unitLanguage;
    const name =
      resolveContentText(product.unit.abbreviation, language, language) ||
      resolveContentText(product.unit.name, language, language);
    return t("product.price_per").replace("{unit}", name);
  }
```

Replace the `price` column's `cell` with:

```ts
        cell: (row) => {
          const vat = row.variant?.effective.vatClass;
          return html`<span data-test="price">${this.#price(row)}</span>
            <span part="price-unit" data-test="price-unit">${this.#unitWord(row.product)}</span>${
              vat === undefined || vat === row.product.vatClass
                ? nothing
                : html`<span part="vat-note" data-test="vat-note"
                    >${t("product.vat")}: ${vatClassName(vat)}</span
                  >`
            }`;
        },
```

and add to the styles:

```css
      wt-data-table::part(price-unit) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
```

`catalogue-browser.ts`: add `Unit` to the type import from `../api/client.js`, the properties

```ts
  @property({ attribute: false }) units: readonly Unit[] = [];
  @property() unitLanguage = "en";
```

and on `<dashboard-product-list>` add `.units=${this.units}` and `.unitLanguage=${this.unitLanguage}`.

`catalogue-screen.ts`: on `<dashboard-catalogue-browser>` add `.units=${this.units}` and `.unitLanguage=${this.contentLanguages?.languages[0] ?? "en"}` — the language the product editor reads unit names in (`language` in `product-editor.ts`, read, not run).

- [ ] **Step 4: Update the price assertions that read the whole cell (NEEDS THE OWNER — spec §1 adds the unit word to every price cell; §8 does not list it)**

Three existing cases compare the price cell's whole text with an amount, so the unit word breaks them. Each keeps its amount, read from the amount's own span; the new cases above hold the whole cell's text. In `product-list.test.ts`:

- "prices a variant with no price of its own at its product's price": its three `cellUnder(root, KEY, t("product.price")).textContent!.trim()` become `cellUnder(root, KEY, t("product.price")).querySelector('[data-test="price"]')!.textContent!.trim()`.
- "prices a product across its Active variants only, or at its own price when it has none": the same change on its two.
- "notes a variant's VAT under its price only where it differs from its product's": the same change on `cellUnder(root, "wine:w125", t("product.price"))`.

"shows a product price, or the range across its variants" uses `toContain` on the row and passes unchanged; "writes each price with the euro sign where $locale writes it", "shows a variant's own name, its effective price and main category" and "lines each name up with the price beside it, with a thumbnail, a placeholder or neither" already read `[data-test="price"]`.

- [ ] **Step 5: Run the three files**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/catalogue-browser.test.ts src/screens/catalogue-screen.test.ts`
Expected: PASS, and "lines each name up with the price beside it" still holds within 1 px.

- [ ] **Step 6: Typecheck, lint, format, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src && pnpm exec prettier --check apps/dashboard/src/widgets apps/dashboard/src/screens apps/dashboard/src/i18n`

```bash
git add apps/dashboard/src/widgets/product-list.ts apps/dashboard/src/widgets/product-list.test.ts apps/dashboard/src/widgets/catalogue-browser.ts apps/dashboard/src/screens/catalogue-screen.ts apps/dashboard/src/screens/catalogue-screen.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "Each price on the Products screen says what it is per: each, or the unit

A product with no stored unit reads, for example, €19.00 each; one sold by the kilo reads
€48.00 / kg. The unit is a quieter, smaller word after the amount."
```

---
## Task 6: The list is a tree under "All products", and the address names a category

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts`
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts`
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts`
- Modify: `apps/dashboard/src/navigation.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/product-list.test.ts`, `catalogue-browser.test.ts`, `catalogue-browser.a11y.test.ts`, `apps/dashboard/src/screens/catalogue-screen.test.ts`
- Modify: `docs/developers/design-system.md` (the empty-action paragraph that names `product-list.ts`), `docs/developers/product-categories.md` (its opening screen paragraph)

**Interfaces:**
- Consumes (Tasks 1–3): `rowGroup`, `rowCollapsible`, `rowActivation`, `rowToggleLabel`, `searchTerm`, `rememberExpanded`, `setExpanded`, `revealRow`, `wt-expand-change`.
- Produces:
  - `export const ROOT_KEY = "root"` from `product-list.ts` — the All products row's key. Category rows keep the key `folder:<id>`, products their id, variants `<productId>:<variantId>`.
  - `ProductList.search: string`; `ProductList.revealCategory(id: string): Promise<void>`; private `#rowByKey: Map<string, ListRow>`, `#table(): WtDataTable<ListRow> | null`, `#send(name: string, detail: unknown): void`.
  - Event `category-toggle` from `dashboard-product-list`, `detail: { categoryId: string; open: boolean }` — a person opened or closed a category.
  - `CatalogueBrowser.categoryId: string | null` (from the address); event `open-category`, `detail: { categoryId: string | null }` — the category the address should now name.
  - Address: `/manage/catalogue/category/<id>`.
  - `drop-items` `detail.folderId` is `null` for a drop on All products.
  - Removed: `ProductList.folders`, `showPath`, `emptyAction`, `emptyMessage`; `CatalogueBrowser.folderId`, `view`, `emptyAction`; events `open-folder`, `view-change`, `pointer-drag-move`, `pointer-drag-end`.

- [ ] **Step 1: Write the failing product-list tests**

In `product-list.test.ts`: import `ROOT_KEY` beside `ProductList` (`import { ProductList, ROOT_KEY } from "./product-list.js";`), add `vi` to the `vitest` import and `userEvent` to the `vitest/browser` import, and add to the `beforeEach` `localStorage.removeItem("waitron.products.table:expanded");`. Replace the two row helpers so they skip the All products row:

```ts
function productRows(root: ShadowRoot): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`tbody tr[data-row-key]:not([data-row-key="${ROOT_KEY}"])`)];
}

function rowKeys(root: ShadowRoot): string[] {
  return productRows(root).map((row) => row.getAttribute("data-row-key")!);
}
```

Add after `cellUnder`:

```ts
const drinks = { id: "d", name: "Drinks", parentId: null };
const beer = { id: "b", name: "Beer", parentId: "d" };
const food = { id: "f", name: "Food", parentId: null };

function treeProducts(): Product[] {
  return [
    product({ id: "cola", name: "Cola", primaryCategoryId: "d" }),
    product({ id: "ale", name: "Ale", primaryCategoryId: "d", active: false }),
    product({ id: "lager", name: "Lager", primaryCategoryId: "b" }),
    product({ id: "bread", name: "Bread", primaryCategoryId: null }),
  ];
}

async function mountTree(props: Partial<ProductList> = {}) {
  const { el } = await mountWidget<ProductList>("dashboard-product-list", {
    categories: [drinks, beer, food],
    products: treeProducts(),
    ...props,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  return { el, table, root: await tableRoot(el) };
}

/** Clicks a category row's own activator, as a click anywhere on the row does. */
async function openRow(el: ProductList, key: string): Promise<void> {
  const root = await tableRoot(el);
  root.querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] .row-activate`)!.click();
  await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
}

const counted = (categories: number, products: number) =>
  [
    ...(categories ? [t(categories === 1 ? "folders.count_one" : "folders.count").replace("{count}", String(categories))] : []),
    ...(products || !categories ? [t(products === 1 ? "folders.product_count_one" : "folders.product_count").replace("{count}", String(products))] : []),
  ].join(", ");
```

Append at the end of the file:

```ts
describe("the product list as a tree", () => {
  it("puts every category and product under an All products row that has no arrow, cannot be selected, and counts the catalogue", async () => {
    const { root } = await mountTree({ selecting: true });
    const top = root.querySelector<HTMLElement>(`tr[data-row-key="${ROOT_KEY}"]`)!;
    expect(root.querySelector("tbody tr")).toBe(top);
    expect(top.getAttribute("aria-level")).toBe("1");
    expect(top.getAttribute("aria-expanded")).toBe("true");
    expect(top.querySelector(".tree-toggle, .tree-arrow, .row-activate")).toBeNull();
    expect(top.querySelector('input[type="checkbox"]')).toBeNull();
    expect(top.textContent).toContain(t("folders.all_products"));
    expect(top.querySelector('[data-test="count-root"]')!.textContent!.trim()).toBe(counted(3, 3));
    expect(rowKeys(root)).toEqual(["folder:d", "folder:f", "bread"]);
    expect(root.querySelector('tr[data-row-key="bread"]')!.getAttribute("aria-level")).toBe("2");
  });

  it("nests a category's subcategories, then its products, under it, whichever column sorts the table", async () => {
    const { el, root, table } = await mountTree();
    await openRow(el, "folder:d");
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
    expect(root.querySelector('tr[data-row-key="folder:b"]')!.getAttribute("aria-level")).toBe("3");
    root.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:f", "folder:d", "folder:b", "cola", "bread"]);
    root.querySelector<HTMLButtonElement>('button[data-sort="price"]')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  });

  it("names what a category holds: its subcategories and its Active products", async () => {
    const { root } = await mountTree();
    const count = (id: string) =>
      root.querySelector(`[data-test="count-${id}"]`)!.textContent!.trim();
    expect(count("d")).toBe(counted(1, 1));
    expect(count("f")).toBe(counted(0, 0));
  });

  it("opens and closes a category from a click or Enter on its row, saying which it will do", async () => {
    const { el, root, table } = await mountTree();
    const activator = () =>
      root.querySelector<HTMLButtonElement>('tr[data-row-key="folder:d"] .row-activate')!;
    expect(activator().getAttribute("aria-label")).toBe(
      t("folders.open_named").replace("{name}", "Drinks"),
    );
    await openRow(el, "folder:d");
    expect(rowKeys(root)).toContain("cola");
    expect(activator().getAttribute("aria-label")).toBe(
      t("folders.close_named").replace("{name}", "Drinks"),
    );
    activator().focus();
    await userEvent.keyboard("{Enter}");
    await table.updateComplete;
    expect(rowKeys(root)).not.toContain("cola");
    expect(root.querySelector('tr[data-row-key="folder:d"] .tree-arrow')!.textContent!.trim()).toBe(
      "▸",
    );
  });

  it("reports a person opening or closing a category, and nothing for a product's variants", async () => {
    const { el, root, table } = await mountTree({
      products: [
        ...treeProducts(),
        product({ id: "bun", name: "Bun", primaryCategoryId: null, variants: [bunVariant] }),
      ],
    });
    const toggles: unknown[] = [];
    el.addEventListener("category-toggle", (event) => toggles.push((event as CustomEvent).detail));
    const raw = vi.fn();
    el.addEventListener("wt-expand-change", raw);
    await openRow(el, "folder:d");
    await openRow(el, "folder:d");
    root.querySelector<HTMLButtonElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(toggles).toEqual([
      { categoryId: "d", open: true },
      { categoryId: "d", open: false },
    ]);
    expect(raw).not.toHaveBeenCalled();
  });

  it("remembers which categories are open when the list is drawn again", async () => {
    const first = await mountTree();
    await openRow(first.el, "folder:d");
    cleanupWidgets();
    const second = await mountTree();
    expect(rowKeys(second.root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  });

  it("opens the category it is asked to reveal, and every category above it", async () => {
    const { el, root } = await mountTree();
    await el.revealCategory("b");
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "lager", "cola", "folder:f", "bread"]);
  });

  it("a search keeps the categories above a match open, finds a product by a variant's name, and clearing it restores what was open", async () => {
    const { el, root, table } = await mountTree({
      products: [
        ...treeProducts(),
        product({
          id: "bun",
          name: "Bun",
          primaryCategoryId: "b",
          variants: [{ ...bunVariant, name: "Large cup" }],
        }),
      ],
    });
    await openRow(el, "folder:d");
    el.search = "cup";
    await el.updateComplete;
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "bun"]);
    root.querySelector<HTMLButtonElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "bun", "bun:small"]);
    el.search = "";
    await el.updateComplete;
    await table.updateComplete;
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts -t "as a tree"`
Expected: FAIL — the whole file fails to load, every case with it: `SyntaxError: The requested module './product-list.js' does not provide an export named 'ROOT_KEY'`. (Once `ROOT_KEY` exists, the new cases still fail on their own: categories are not rows and `revealCategory` is not a function.)

- [ ] **Step 3: Implement the tree in `product-list.ts`**

Imports: `import { baseStyles, type DataTableColumn, type WtDataTable } from "@waitron/ui";`.

Replace the `ListRow` and `ProductRow` declarations with:

```ts
export const ROOT_KEY = "root";

type RootRow = { kind: "root"; key: typeof ROOT_KEY; parentKey: null };
type CategoryRow = { kind: "folder"; key: string; parentKey: string; folder: CategorySummary };
type ListRow = ProductRow | CategoryRow | RootRow;

interface ProductRow {
  kind: "product";
  key: string;
  parentKey: string;
  product: Product;
  variant: Product["variants"][number] | null;
}

function countOf(key: "folders.count" | "folders.product_count", count: number): string {
  return t(count === 1 ? `${key}_one` : key).replace("{count}", String(count));
}
```

Properties: delete `folders`, `showPath`, `emptyAction` and `emptyMessage`; add

```ts
  /** The search box's text; while it lasts, the table holds every category above a match open. */
  @property() search = "";
```

the fields `#rowByKey = new Map<string, ListRow>();` and `#counts = new Map<string | null, { categories: number; products: number }>();`, and to `willUpdate`:

```ts
    if (changed.has("categories") || changed.has("products")) this.#counts = this.#count();
```

Replace `#startDrag` and add the delegating handler before it:

```ts
  /** A mouse drags a category or product from anywhere on its row; a finger only from the grip, so it
   * can still scroll; a control on the row is never a drag handle. */
  readonly #pointerDown = (event: PointerEvent): void => {
    const path = event
      .composedPath()
      .filter((item): item is HTMLElement => item instanceof HTMLElement);
    const row = path.find((item) => item.matches("tr[data-row-key]"));
    const listed = row ? this.#rowByKey.get(row.dataset.rowKey!) : undefined;
    if (!row || !listed || listed.kind === "root") return;
    if (listed.kind === "product" && listed.variant !== null) return;
    if (path.some((item) => item.matches("input, a, wt-row-actions, wt-input, button:not(.row-activate, .drag-grip)")))
      return;
    const grip = path.some((item) => item.classList.contains("drag-grip"));
    this.#startDrag(event, listed.key, row, grip);
  };

  #startDrag(event: PointerEvent, key: string, row: HTMLElement, grip: boolean): void {
    if (this.#pointerDrag || event.button !== 0) return;
    if (event.pointerType === "touch" && !grip) return;
    this.#pointerDrag = {
      pointerId: event.pointerId,
      key,
      row,
      x: event.clientX,
      y: event.clientY,
      top: row.getBoundingClientRect().top,
      active: false,
    };
    document.addEventListener("pointermove", this.#moveDrag);
    document.addEventListener("pointerup", this.#endDrag);
    document.addEventListener("pointercancel", this.#endDrag);
  }
```

In `#moveDrag`, replace everything from `this.#clearDropTarget();` to the end of the function with:

```ts
    this.#clearDropTarget();
    const row = pointerElementsAt(event.clientX, event.clientY).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement &&
        item.matches(`tr[data-row-key^="folder:"], tr[data-row-key="${ROOT_KEY}"]`),
    );
    const key = row?.dataset.rowKey;
    const cell = row?.querySelector<HTMLElement>('[part~="folder-cell"]');
    if (
      cell &&
      key &&
      acceptsCatalogueDrop(this.#dragged, key === ROOT_KEY ? null : key.slice(7), this.categories)
    ) {
      this.#dropTarget = cell;
      cell.part.add("drop-target");
    }
    const hoverBox = this.#dropTarget?.closest("tr")?.getBoundingClientRect();
    const below = hoverBox ? hoverBox.bottom + 8 : event.clientY - (drag.y - drag.top);
    const top =
      hoverBox && below + drag.row.offsetHeight > window.innerHeight
        ? hoverBox.top - drag.row.offsetHeight - 8
        : below;
    drag.row.style.transform = `translateY(${top - drag.top}px)`;
  };
```

In `#endDrag`, delete the `if (drag.active) { this.dispatchEvent(new CustomEvent("pointer-drag-end", …)); }` block, and replace the drop block with one that files a drop on All products in no category — the breadcrumb that did so goes in this task, so the drop moves here rather than wait for Task 10:

```ts
    if (drag.active && event.type === "pointerup" && this.#dropTarget) {
      const key = this.#dropTarget.closest<HTMLElement>("tr[data-row-key]")!.dataset.rowKey!;
      this.#dropFolder(key === ROOT_KEY ? null : key.slice(7));
    }
```

`#dropFolder`'s parameter becomes `folderId: string | null`. (Task 10 replaces this drag's look; this task keeps it.)

In `#productColumns`, the name column: delete both `@pointerdown=${…}` attributes (on the `product-cell` span and on its grip) and replace its `searchValue` with:

```ts
        searchValue: ({ product }) =>
          [product.name, ...product.variants.map(({ name }) => name)].join(" "),
```

Replace `#rows` with:

```ts
  #rows(): ListRow[] {
    const known = new Set(this.categories.map(({ id }) => id));
    const keyOf = (id: string | null): string =>
      id !== null && known.has(id) ? `folder:${id}` : ROOT_KEY;
    return [
      { kind: "root", key: ROOT_KEY, parentKey: null },
      ...this.categories.map(
        (folder): CategoryRow => ({
          kind: "folder",
          key: `folder:${folder.id}`,
          parentKey: keyOf(folder.parentId),
          folder,
        }),
      ),
      ...this.products.flatMap((product): ProductRow[] => [
        {
          kind: "product",
          key: product.id,
          parentKey: keyOf(product.primaryCategoryId),
          product,
          variant: null,
        },
        ...product.variants.map(
          (variant): ProductRow => ({
            kind: "product",
            key: `${product.id}:${variant.id}`,
            parentKey: product.id,
            product,
            variant,
          }),
        ),
      ]),
    ];
  }

  /** What each category holds directly, and under `null` the whole catalogue, counted once per change
   * of the lists rather than once per row drawn. Inactive products are left out, as the default
   * Status filter hides them. */
  #count(): Map<string | null, { categories: number; products: number }> {
    const counts = new Map<string | null, { categories: number; products: number }>([
      [null, { categories: this.categories.length, products: 0 }],
    ]);
    const entry = (id: string) =>
      counts.get(id) ?? counts.set(id, { categories: 0, products: 0 }).get(id)!;
    for (const category of this.categories)
      if (category.parentId !== null) entry(category.parentId).categories++;
    for (const product of this.products) {
      if (!product.active) continue;
      counts.get(null)!.products++;
      if (product.primaryCategoryId !== null) entry(product.primaryCategoryId).products++;
    }
    return counts;
  }

  #contents(categoryId: string | null): string {
    const { categories, products } = this.#counts.get(categoryId) ?? { categories: 0, products: 0 };
    const parts = categories > 0 ? [countOf("folders.count", categories)] : [];
    if (products > 0 || categories === 0) parts.push(countOf("folders.product_count", products));
    return parts.join(", ");
  }
```

Replace `#columns` with:

```ts
  #columns(): DataTableColumn<ListRow>[] {
    return this.#productColumns().map((column) => ({
      key: column.key,
      label: column.label,
      align: column.align,
      choosable: column.choosable,
      pinned: column.pinned,
      cell: (row, context) => {
        if (row.kind === "product") return column.cell(row, context);
        if (row.kind === "root")
          return column.key === "name"
            ? html`<span part="folder-cell"
                ><wt-icon name="folder"></wt-icon><strong>${t("folders.all_products")}</strong
                ><span part="count" data-test="count-root">${this.#contents(null)}</span></span
              >`
            : nothing;
        const { folder } = row;
        if (column.key === "name")
          return html`<span part="folder-cell"
            ><button
              class="drag-grip"
              part="drag-grip"
              type="button"
              aria-label=${`${t("folders.drag")}: ${folder.name}`}
            >
              <wt-icon name="grip"></wt-icon></button
            ><wt-icon name="folder"></wt-icon><strong>${folder.name}</strong
            ><span part="count" data-test=${`count-${folder.id}`}>${this.#contents(folder.id)}</span
            >${
              this.unroutedFolderIds.includes(folder.id)
                ? html`<span
                    part="unrouted-folder"
                    data-test="unrouted-folder"
                    role="img"
                    aria-label=${t("folders.no_routing_rule")}
                    title=${t("folders.no_routing_rule")}
                    >*</span
                  >`
                : nothing
            }</span
          >`;
        if (column.key === "actions")
          return html`<wt-row-actions
            align="end"
            label=${`${t("staff.actions")}: ${folder.name}`}
            data-test=${`actions-folder-${folder.id}`}
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`rename-${folder.id}`}
              @click=${(event: Event) => this.#emitFolder(event, "rename-folder", folder.id)}
              >${t("folders.rename")}</wt-button
            ><wt-button
              align="start"
              variant="danger"
              data-test=${`delete-folder-${folder.id}`}
              @click=${(event: Event) => this.#emitFolder(event, "delete-folder", folder.id)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`;
        return nothing;
      },
      ...(column.sortValue
        ? {
            sortValue: (row: ListRow) =>
              row.kind === "product"
                ? column.sortValue!(row)
                : row.kind === "folder"
                  ? row.folder.name
                  : "",
          }
        : {}),
      ...(column.searchValue
        ? {
            // A variant is found through its product, whose text holds its variants' names.
            searchValue: (row: ListRow) =>
              row.kind === "product"
                ? row.variant === null
                  ? column.searchValue!(row)
                  : ""
                : row.kind === "root"
                  ? ""
                  : column.key === "name"
                    ? row.folder.name
                    : column.key === "reporting-category"
                      ? this.#category(row.folder.parentId)
                      : "",
          }
        : {}),
      ...(column.filter
        ? {
            filter: {
              ...column.filter,
              value: (row: ListRow) =>
                row.kind === "product"
                  ? column.filter!.value(row)
                  : column.filter!.options.map((option) => option.value),
            },
          }
        : {}),
    }));
  }
```

Add the reveal, the toggle report and the helpers before `render`:

```ts
  #table(): WtDataTable<ListRow> | null {
    return this.shadowRoot?.querySelector<WtDataTable<ListRow>>("wt-data-table") ?? null;
  }

  #send(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  readonly #expandChange = (event: CustomEvent<{ key: string; expanded: boolean }>): void => {
    event.stopPropagation();
    const { key, expanded } = event.detail;
    if (key.startsWith("folder:")) this.#send("category-toggle", { categoryId: key.slice(7), open: expanded });
  };

  /** Opens the category and every category above it, and scrolls it into view. */
  async revealCategory(id: string): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    table.setExpanded(`folder:${id}`, true);
    await table.revealRow(`folder:${id}`);
  }
```

Replace `render` with:

```ts
  override render() {
    const rows = this.#rows();
    this.#rowByKey = new Map(rows.map((row) => [row.key, row]));
    return html`<wt-data-table
      noMatchesMessage=${tableNoMatches()}
      filterSearchPlaceholder=${t("categories.combobox_search")}
      filterNoResultsLabel=${t("categories.combobox_no_results")}
      aria-label=${t("catalogue.title")}
      viewKey="waitron.products.table"
      rememberExpanded
      searchOpensPath
      columnsLabel=${t("table.columns")}
      sortKey="name"
      sortDirection="ascending"
      collapseLabel=${t("categories.collapse")}
      expandLabel=${t("categories.expand")}
      initiallyCollapsed
      .searchTerm=${this.search}
      .selectable=${this.selecting}
      .selected=${this.selected}
      .rowSelectable=${(row: ListRow) =>
        row.kind === "folder" || (row.kind === "product" && row.variant === null)}
      .selectionLabel=${(row: ListRow) =>
        row.kind === "folder"
          ? row.folder.name
          : row.kind === "product"
            ? (row.variant?.name ?? row.product.name)
            : ""}
      .rowGroup=${(row: ListRow) => (row.kind === "product" ? 1 : 0)}
      .rowCollapsible=${(row: ListRow) => row.kind !== "root"}
      .rowActivation=${(row: ListRow) =>
        row.kind === "folder" ? "toggle" : row.kind === "root" ? "none" : "click"}
      .rowToggleLabel=${(row: ListRow, expanded: boolean) =>
        row.kind === "folder"
          ? t(expanded ? "folders.close_named" : "folders.open_named").replace(
              "{name}",
              row.folder.name,
            )
          : t(expanded ? "categories.collapse" : "categories.expand")}
      .rows=${rows}
      .columns=${this.#columns()}
      .rowKey=${(row: ListRow) => row.key}
      .rowParent=${(row: ListRow) => row.parentKey}
      @pointerdown=${this.#pointerDown}
      @wt-expand-change=${this.#expandChange}
    ></wt-data-table>`;
  }
```

Add to the styles:

```css
      wt-data-table::part(count) {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
```

`strings.ts`: add `"folders.close_named": "Close {name}",` (en) and `"folders.close_named": "Cerrar {name}",` (es) beside `folders.open_named`; delete `folders.view_folders`, `folders.view_all`, `folders.breadcrumb` and `catalogue.no_products` (its last use, the list's empty sentence, goes with the empty box) from both blocks.

- [ ] **Step 4: Update the existing product-list tests (setup only — every assertion unchanged)**

- "renders one shared-table row per product": `querySelectorAll("tbody tr")` → `productRows(await tableRoot(el))`.
- "shows the staff name, not the customer-facing one and not the id" and "shows a visible placeholder instead of blank cells for unresolved category and modifier ids": `querySelector("tbody tr")!` → `productRows(await tableRoot(el))[0]!`.
- "shows a product price, or the range across its variants": `[...(await tableRoot(el)).querySelectorAll("tbody tr")]` → `productRows(await tableRoot(el))`.
- "expands a parent product to its variant rows": both `root.querySelectorAll("tbody tr")` → `productRows(root)` (`toHaveLength(1)` reads the same on the array).
- "renders no rows for an empty products list": `querySelectorAll("tbody tr").length` → `productRows(await tableRoot(el)).length`.
- "shows the main category, attached modifier list names, and no VAT or labels column": after `const root = await tableRoot(el);` add `await openRow(el, "folder:reporting");` — the product now sits inside that category, which starts closed.
- "shows a variant's own name, its effective price and main category": replace `root.querySelector<HTMLElement>(".tree-toggle")!.click();` with `await openRow(el, "folder:food");` followed by `root.querySelector<HTMLElement>('tr[data-row-key="wine"] .tree-toggle')!.click();`.
- `product-list.a11y.test.ts`: its `beforeEach(() => sessionStorage.clear());` becomes `beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });` — the list now remembers open categories in local storage, which would otherwise carry from one case to the next.

- [ ] **Step 5: Run the product-list file**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`
Expected: PASS, `Test Files  2 passed (2)`.

- [ ] **Step 6: Rewrite `catalogue-browser.ts` for the tree**

Imports: drop `type TemplateResult`, `categoryAncestors`, `currentLocale` and `tableNoMatches`; import `type ProductList` beside `acceptsCatalogueDrop` (`import { acceptsCatalogueDrop, type ProductList } from "./product-list.js";`).

Styles: delete the `.drop-target`, `.views`, `.breadcrumb`, `.breadcrumb ol`, `.breadcrumb li`, `.breadcrumb [aria-current]` and `.sep` rules.

Properties: delete `folderId`, `view` and `emptyAction`; add

```ts
  /** The category the address names; the browser opens it, and every category above it, once. */
  @property({ attribute: false }) categoryId: string | null = null;
```

Fields: delete `#dragged`, `#dropTarget`, `#clearDropTarget`, `#overCrumb`, `#dropCrumb`, `get #current`, `#visible` and `#breadcrumb`; add `#revealed: string | null = null;`. In `#drop`, delete its first line, `this.#clearDropTarget();`.

Replace `willUpdate` with:

```ts
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("search")) this.selected = [];
  }

  override updated(changed: PropertyValues): void {
    if (!changed.has("categoryId") && !changed.has("categories")) return;
    const id = this.categoryId;
    if (id === null || id === this.#revealed || !this.categories.some((category) => category.id === id))
      return;
    this.#revealed = id;
    void this.#list()?.revealCategory(id);
  }

  #list(): ProductList | null {
    return this.shadowRoot?.querySelector("dashboard-product-list") ?? null;
  }

  /** The address follows the category a person opens; closing it, or one above it, names its parent. */
  #categoryToggled(event: CustomEvent<{ categoryId: string; open: boolean }>): void {
    event.stopPropagation();
    const { categoryId, open } = event.detail;
    if (open) {
      this.#revealed = categoryId;
      this.#emit("open-category", { categoryId });
      return;
    }
    if (
      this.categoryId === null ||
      !categoryWithDescendants(categoryId, this.categories).has(this.categoryId)
    )
      return;
    const parentId = this.categories.find(({ id }) => id === categoryId)?.parentId ?? null;
    this.#revealed = parentId;
    this.#emit("open-category", { categoryId: parentId });
  }

  /** The category the address names, while it exists; New folder creates inside it. */
  #addressed(): string | null {
    return this.categories.some(({ id }) => id === this.categoryId) ? this.categoryId : null;
  }
```

`#navigate` loses its last caller; delete it. Replace `render` with:

```ts
  override render() {
    return html`<div class="toolbar">
        ${
          !this.operation && (this.summaryLoading || this.operationBusy)
            ? html`<wt-spinner></wt-spinner>`
            : nothing
        }
        <wt-input
          name="catalogue-search"
          type="search"
          label=${t("folders.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
        ${
          this.selecting
            ? html`<div class="action-bar">
                <span data-test="selected-count" aria-live="polite"
                  >${this.#plural("folders.selected", this.selected.length)}</span
                >
                <wt-button
                  data-test="move"
                  variant="secondary"
                  .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                  @click=${() => this.#openMove()}
                  >${t("folders.move")}</wt-button
                >
                <wt-button
                  data-test="delete"
                  variant="danger"
                  .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                  @click=${() => void this.#openDelete()}
                  >${t("action.delete")}</wt-button
                >
                <wt-button
                  data-test="cancel-selection"
                  variant="secondary"
                  @click=${() => {
                    this.selected = [];
                    this.selecting = false;
                  }}
                  >${t("folders.cancel_selection")}</wt-button
                >
              </div>`
            : html`<wt-button
                  data-test="select"
                  variant="secondary"
                  @click=${() => (this.selecting = true)}
                  >${t("folders.select")}</wt-button
                >
                <wt-button data-test="new-folder" @click=${() => this.#openForm(null)}
                  >${t("folders.new")}</wt-button
                >`
        }
      </div>
      <dashboard-product-list
        @drop-items=${(event: CustomEvent<{ keys: string[]; folderId: string | null }>) => {
          event.stopPropagation();
          void this.#drop(event.detail.keys, event.detail.folderId);
        }}
        .selecting=${this.selecting}
        .selected=${this.selected}
        @wt-selection-change=${(event: CustomEvent<{ selected: string[] }>) => {
          event.stopPropagation();
          this.selected = event.detail.selected;
        }}
        @wt-filter-change=${(event: Event) => {
          event.stopPropagation();
          this.selected = [];
        }}
        @delete-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          void this.#openDelete([`folder:${event.detail.folderId}`]);
        }}
        @category-toggle=${this.#categoryToggled}
        .categories=${this.categories}
        .products=${this.products}
        .search=${this.search}
        .madeAt=${this.madeAt}
        .unroutedFolderIds=${this.#unroutedFolderIds()}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        .units=${this.units}
        .unitLanguage=${this.unitLanguage}
        @rename-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          const value = this.categories.find(({ id }) => id === event.detail.folderId);
          if (value) this.#openForm(value);
        }}
      ></dashboard-product-list>
      <dashboard-category-form
        .open=${this.folderForm !== null}
        .value=${this.folderForm?.value ?? null}
        .defaultParentId=${this.#addressed()}
        .categories=${this.categories}
        .busy=${this.formBusy}
        .fieldErrors=${this.formErrors}
        @wt-submit=${(event: CustomEvent<{ value: CategoryInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.formBusy) this.folderForm = null;
        }}
      ></dashboard-category-form
      >${this.#operationDialog()}${
        this.dropError ? html`<p class="error" role="alert">${this.dropError}</p>` : nothing
      }`;
  }
```

- [ ] **Step 7: Screen, address and words**

`navigation.ts`: `catalogue: { product: "product", category: "category" },`.

`catalogue-screen.ts`:
- Replace the two `@state()` fields `folderId` and `view` with `@state() private categoryId: string | null = null;`.
- In the `UrlStateController` callback, replace the `folderId` and `view` lines with `this.categoryId = this.#url.read("category");`.
- Delete `#emptyAction`, `willUpdate`, and the `slot` parameter of `#renderAddProduct` (with its `slot=${ifDefined(slot)}` attribute and the `ifDefined` import).
- `#openCreate`: `this.newCategoryId = this.categories.some(({ id }) => id === this.categoryId) ? this.categoryId : null;`
- `#refocusAdd`'s comment loses its second clause: `/** The Add to menus step follows a create, so its closing dialog hands focus back to the Add product that started it. */`.
- On `<dashboard-catalogue-browser>`: delete `.folderId`, `.view`, `.emptyAction`, `@open-folder` and `@view-change`; add

```ts
              .categoryId=${this.categoryId}
              @open-category=${(event: CustomEvent<{ categoryId: string | null }>) => {
                event.stopPropagation();
                this.categoryId = event.detail.categoryId;
                this.#url.write({ category: this.categoryId }, true);
              }}
```

- [ ] **Step 8: Update `catalogue-browser.test.ts`**

Add `onTestFinished` to the `vitest` import and `import { ROOT_KEY } from "./product-list.js";`. Change the `rowKeys` helper to skip the All products row and add a toggle helper:

```ts
export async function rowKeys(el: CatalogueBrowser) {
  return [...(await tableOf(el)).shadowRoot!.querySelectorAll<HTMLElement>("tr[data-row-key]")]
    .map((row) => row.dataset.rowKey)
    .filter((key) => key !== ROOT_KEY);
}
/** Opens or closes a category the way a click on its row does. */
export async function toggleCategory(el: CatalogueBrowser, id: string) {
  const table = await tableOf(el);
  table.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="folder:${id}"] .row-activate`)!.click();
  await table.updateComplete;
}
```

Approved by §8 (breadcrumb, switch, folder-at-a-time listing) — **delete**: "finds a breadcrumb under a captured touch pointer", "refuses a dragged folder's ancestor or current breadcrumb when it is inside that folder", "lists all products with paths and no breadcrumb in all view" (returns as Expand all in Task 8), "emits breadcrumb navigation and view changes", and the `crumbs` helper; **replace** "moves a product to the top level through the first breadcrumb" with the same move through the All products row:

```ts
it("moves a product to the top level by dropping it on All products", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  const root = (await tableOf(el)).shadowRoot!;
  drag(
    await nameCell(el, "cola"),
    root.querySelector(`tr[data-row-key="${ROOT_KEY}"] [part~="folder-cell"]`)!,
  );
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["cola"], categoryIds: [] },
      null,
    ),
  );
});
```

**NEEDS THE OWNER** (spec §3 replaces the empty table's box on this screen; §8 does not list it) — **delete** "draws its screen's empty action in an empty folder, and not when a search finds nothing"; **replace** the `it.each` "says the dashboard's one no-matches sentence when its search finds nothing, and its own sentence in an empty folder (%s)" with

```ts
it.each(["en-GB", "es"])(
  "says the dashboard's one no-matches sentence when its search finds nothing (%s)",
  async (locale) => {
    setLocale(locale);
    const el = await mountBrowser({ products: [] });
    await typeSearch(el, "nothing like this");
    expect(await rowKeys(el)).toEqual([]);
    expect(await tableSentence(el)).toBe(tableNoMatches(locale));
    await typeSearch(el, "");
    expect((await tableOf(el)).shadowRoot!.querySelector(".empty")).toBeNull();
  },
);
```

and **replace** "says the dashboard's one no-matches sentence when a column filter hides every product" with

```ts
it("keeps the All products row and every category when a column filter hides every product", async () => {
  setLocale("es");
  const el = await mountBrowser();
  await chooseFilter(el, "active", "inactive");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f"]);
  expect((await tableOf(el)).shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"]`)).not.toBeNull();
  expect((await tableOf(el)).shadowRoot!.querySelector(".empty")).toBeNull();
});
```

Approved by §8 (folder-at-a-time listing) — **replace** each of these with the case shown:

"shows only direct children and breadcrumbs inside a folder" →

```ts
it("nests each category's subcategories, then its products, under it once it is opened, and draws no breadcrumb", async () => {
  const el = await mountBrowser();
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
  await toggleCategory(el, "d");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  const table = await tableOf(el);
  const level = (key: string) =>
    table.shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.getAttribute("aria-level");
  expect([ROOT_KEY, "folder:d", "folder:b", "cola", "bread"].map(level)).toEqual([
    "1",
    "2",
    "3",
    "3",
    "2",
  ]);
  expect(el.shadowRoot!.querySelector("nav")).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="view-all"]')).toBeNull();
});
```

"keeps folders through both product filters" →

```ts
it("keeps every category through both product filters", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await chooseFilter(el, "active", "inactive");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "folder:f"]);
  await chooseFilter(el, "ordering", "staff_only");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "folder:f"]);
});
```

"falls back to the top level for a missing folder" →

```ts
it("opens nothing when the address names a category that does not exist", async () => {
  const el = await mountBrowser({ categoryId: "gone" });
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
});

it("opens the category the address names, and every category above it, and scrolls it into view", async () => {
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  onTestFinished(() => scrolled.mockRestore());
  const el = await mountBrowser({
    products: [...PRODUCTS, product("stout", "Stout", "b")],
    categoryId: "b",
  });
  await vi.waitFor(async () =>
    expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "stout", "cola", "folder:f", "bread"]),
  );
  expect(scrolled.mock.contexts.at(-1)).toBe(
    (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="folder:b"]'),
  );
});

it("writes the category a person opens into the address, and its parent when they close it", async () => {
  const el = await mountBrowser({ products: [...PRODUCTS, product("stout", "Stout", "b")] });
  const sent: unknown[] = [];
  el.addEventListener("open-category", (event) => sent.push((event as CustomEvent).detail));
  await toggleCategory(el, "d");
  el.categoryId = "d";
  await toggleCategory(el, "b");
  el.categoryId = "b";
  await toggleCategory(el, "f");
  el.categoryId = "f";
  await toggleCategory(el, "b");
  await toggleCategory(el, "f");
  expect(sent).toEqual([
    { categoryId: "d" },
    { categoryId: "b" },
    { categoryId: "f" },
    { categoryId: null },
  ]);
});
```

(In the last case, closing `b` while the address names `f` writes nothing; closing `f`, which the address names, writes its parent, the top level.)

"searches globally and restores the previous folder when cleared" →

```ts
it("search keeps the categories above a match open, and clearing it restores what was open", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "f");
  await typeSearch(el, "COL");
  expect(await rowKeys(el)).toEqual(["folder:d", "cola"]);
  await typeSearch(el, "");
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "burger", "bread"]);
});
```

"searches folder paths and product variant names": the two expected lists become `["folder:d", "folder:b", "sized", "cola"]` and `["folder:d", "sized"]`.

"keeps a variant match on its parent until the manager expands it": the two expected lists become `["folder:d", "coffee"]` and `["folder:d", "coffee", "coffee:large"]`.

"emits folder navigation once and offers accessible folder actions" →

```ts
it("opens and closes a category from its row, and says which it will do", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const activator = () =>
    table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:d"] .row-activate')!;
  expect(activator().getAttribute("aria-label")).toBe("Open Drinks");
  await toggleCategory(el, "d");
  expect(activator().getAttribute("aria-label")).toBe("Close Drinks");
  expect(await rowKeys(el)).toContain("cola");
  await toggleCategory(el, "d");
  expect(await rowKeys(el)).not.toContain("cola");
  expect(
    table.shadowRoot!.querySelector('tr[data-row-key="folder:d"] wt-icon[name="folder"]'),
  ).not.toBeNull();
});
```

"a folder click still opens it without starting a drag" →

```ts
it("a click on a category's row opens it in place without starting a drag", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const activator = table.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="folder:d"] .row-activate',
  )!;
  pointerEvent(activator, "pointerdown");
  pointerEvent(activator, "pointerup");
  activator.click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "bread"]);
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});
```

"a drag ending on a folder's button does not also open it" →

```ts
it("a drag that ends on a category's row does not also open it", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const activator = table.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="folder:d"] .row-activate',
  )!;
  const box = activator.getBoundingClientRect();
  pointerEvent(activator, "pointerdown");
  activator.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      clientX: box.x + 25,
      clientY: box.y + 8,
    }),
  );
  pointerEvent(activator, "pointerup");
  activator.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
});
```

"shows the path only in global views and leaves folder product cells empty" →

```ts
it("shows each product's main category, and leaves a category row's other cells empty", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  const table = await tableOf(el);
  expect(table.shadowRoot!.querySelector('input[name="search"]')).toBeNull();
  expect(table.columns.some((column) => column.key === "reporting-category")).toBe(true);
  const row = table.shadowRoot!.querySelector('tr[data-row-key="folder:b"]')!;
  expect(
    [...row.querySelectorAll("td")].slice(1, -1).every((cell) => cell.textContent!.trim() === ""),
  ).toBe(true);
  expect(table.shadowRoot!.querySelector('tr[data-row-key="cola"]')!.textContent).toContain(
    "Drinks",
  );
});
```

Setup only (folder-at-a-time props gone, assertion unchanged):
- "marks only folders without an active own or inherited routing claim and clears the mark when claimed": replace the first `el.folderId = "d"; await el.updateComplete;` with `await toggleCategory(el, "d");`, and delete the later `el.folderId = null;` and the second `el.folderId = "d"; await el.updateComplete;` (`d` stays open).
- "selects folders and products but never variants": drop `folderId: "d",` from the mount and add `await toggleCategory(el, "d");` before `selectKeys`.
- "leaves selection mode on Cancel and restores the ordinary toolbar with no selected keys" (approved: the switch): the list `["select", "new-folder", "view-folders", "view-all"]` becomes `["select", "new-folder"]`.
- `it.each(["folder", "view", "search", "filter"])("clears selection on %s …")` (approved: folder-at-a-time, switch): becomes `it.each(["search", "filter"])` and its two `if (trigger === "folder")` / `"view"` lines go.
- "confirms %i product deletion with inactive and sales wording" (approved: the switch): `mountBrowser({ view: "all" })` → `mountBrowser()`, then `await toggleCategory(el, "d");` before `selectKeys` (cola is inside Drinks).
- "creates a folder under the current folder and closes after save", "renames a root folder without adopting the current folder", "keeps a refused folder save open with a field error", "creates a top-level folder when the addressed folder is missing": `folderId:` → `categoryId:` in the mount; assertions unchanged.
- "real pointer drag moves a product into a folder": the Food row is now covered by its activator, which Playwright refuses to drag onto by the name cell's centre; drop on its activator's corner instead — `await userEvent.dragAndDrop(await nameCell(el, "bread"), (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="folder:f"] .row-activate')!, { targetPosition: { x: 4, y: 4 } });`. (`@vitest/browser-playwright` declares `UserEventDragAndDropOptions extends PWDragAndDropOptions`, which carries `sourcePosition` and `targetPosition` — its `dist/index.d.ts`, read, not run. If the run refuses them, drop on the Food row's grip, `[data-row-key="folder:f"] .drag-grip`, which sits above the activator.)

- [ ] **Step 9: Update `catalogue-browser.a11y.test.ts` (approved: folder-at-a-time, switch)**

The state list becomes `["top", "open", "search", "form", "selection", "move", "delete"]`; delete the `folderId:` and `view:` mount properties; after the list's table has updated, add:

```ts
      if (state === "open") {
        const table = list.shadowRoot!.querySelector("wt-data-table")!;
        table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:d"] .row-activate')!.click();
        await table.updateComplete;
      }
```

- [ ] **Step 10: Update `catalogue-screen.test.ts`**

Approved by §8 (folder-at-a-time, switch): replace "reads and writes folder paths and passes the folder to new products" with

```ts
it("reads and writes the opened category in the address, and files a new product there", async () => {
  history.replaceState(null, "", "/manage/catalogue/category/c1");
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  const browser = el.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
  expect(browser.categoryId).toBe("c1");
  emit(browser, "open-category", { categoryId: "b" });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue/category/b");
  emit(browser, "open-category", { categoryId: "c1" });
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  await el.updateComplete;
  expect(editor(el).newCategoryId).toBe("c1");
  emit(editor(el), "wt-cancel", {});
  await el.updateComplete;
  emit(browser, "open-category", { categoryId: null });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  await el.updateComplete;
  expect(editor(el).newCategoryId).toBeNull();
});
```

and in "creates an unfiled product when the addressed folder no longer exists" change the address to `/manage/catalogue/category/gone`.

Setup only: the screen's list now remembers open categories in local storage, so add `afterEach(() => localStorage.clear());` beside `afterEach(cleanupWidgets);` in both `catalogue-screen.test.ts` and `catalogue-screen.a11y.test.ts`.

**NEEDS THE OWNER** (spec §3; replacements arrive in Task 7): delete "puts Add product under the empty product table's sentence, opening the same editor", "keeps the empty table's Add product disabled exactly while the header's is", "returns focus to the header's Add product after the first product is made from the empty table", "returns focus to the empty table's Add product after Cancel", and the helper `pressEmptyAdd`. Keep `afterDialogCloses`; Task 7 uses it.

- [ ] **Step 11: Run the four dashboard files**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/screens/catalogue-screen.test.ts src/screens/catalogue-screen.a11y.test.ts`
Expected: PASS, `Test Files  6 passed (6)`.

- [ ] **Step 12: Docs**

`docs/developers/design-system.md`, the empty-action paragraph: replace from "while `apps/dashboard/src/widgets/product-list.ts` takes an `emptyAction` render function" through "a catalogue search that matches nothing says so without the button." with:

```markdown
while the Products screen has no empty box at all: its tree always shows the All products row, whose
menu holds the screen's adds (spec `docs/superpowers/specs/2026-10-02-products-category-tree-design.md`
§3).
```

`docs/developers/product-categories.md`: replace the paragraph that begins "Open Drinks to see its direct subfolders" with:

```markdown
The screen is one tree. Its first row, **All products**, holds every category and every product
filed in none; each category opens in place, with its subcategories above its products. A click or
Enter on a category's row opens or closes it, and the categories a person opens are remembered in
that browser. Search finds products by name, variant name or category path and opens every category
on the way to a match; clearing it restores what was open. Status and ordering filters affect
products; categories stay. The address names the category last opened, as `category=`.
```

- [ ] **Step 13: Typecheck, lint, format, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src && pnpm exec prettier --check apps/dashboard/src && pnpm exec prettier --check docs/developers/design-system.md docs/developers/product-categories.md`
(`docs/` is prettier-ignored, so the last command checks nothing; it is listed to say so, not as evidence.)

```bash
git add apps/dashboard/src docs/developers/design-system.md docs/developers/product-categories.md
git commit -s -m "The Products screen is one tree under All products, and its address names a category

Every category opens in place, with its subcategories above its products, from a click or Enter on
its row; the ones a person opens are remembered in that browser. The breadcrumb and the Folders /
All products switch are gone. Search opens each category above a match. The address now reads
category=<id> in place of folder= and view=; old addresses are not kept, as the venue is not live."
```

---
## Task 7: Clicks and menus — a product row opens it (A205), every add starts from a ⋮ menu, and the header loses its button

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts`, `apps/dashboard/src/widgets/catalogue-browser.ts`, `apps/dashboard/src/screens/catalogue-screen.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/product-list.test.ts`, `product-list.a11y.test.ts`, `catalogue-browser.test.ts`, `apps/dashboard/src/screens/catalogue-screen.test.ts`, `catalogue-screen.a11y.test.ts`

**Interfaces:**
- Consumes (Task 6): `ROOT_KEY`, `#send`, `#table()`, `#rowByKey`, `revealRow`; the browser's `#list()`.
- Produces:
  - `ProductList.canAddProduct: boolean`; `ProductList.focusRowMenu(categoryId: string | null): void`; `ProductList.revealProduct(id: string): Promise<void>`.
  - Events from `dashboard-product-list`: `edit-product` (now also from a product or variant row's click, `detail: { productId }`), `add-product` (`detail: { categoryId: string | null }`), `add-category` (`detail: { parentId: string | null }`), `move-folder` (`detail: { folderId: string }`).
  - Menu `data-test`s: `actions-root`, `add-product-root`, `add-category-root`; per category `actions-folder-<id>`, `add-product-<id>`, `add-category-<id>`, `rename-<id>`, `move-<id>`, `delete-folder-<id>`; the divider `hr[part="menu-divider"]`.
  - `CatalogueBrowser.canAddProduct: boolean`, `CatalogueBrowser.focusRowMenu(categoryId: string | null): void`, `CatalogueBrowser.revealProduct(id: string): Promise<void>`.
  - The screen's header holds the title alone.

- [ ] **Step 1: Write the failing product-list tests**

Append inside `describe("the product list as a tree")` in `product-list.test.ts`:

```ts
  const menuItems = (menu: Element) =>
    [...menu.children].map((child) =>
      child.localName === "hr" ? "—" : child.textContent!.trim(),
    );

  it("opens a product from a click or Enter on its row, and a variant from its own row", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun", variants: [bunVariant] })],
    });
    const opened: string[] = [];
    el.addEventListener("edit-product", (event) =>
      opened.push((event as CustomEvent<{ productId: string }>).detail.productId),
    );
    const root = await tableRoot(el);
    const activator = (key: string) =>
      root.querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] .row-activate`)!;
    expect(activator("bun").getAttribute("aria-label")).toBe(
      `${t("action.edit")}: Croquetas de jamón`,
    );
    activator("bun").click();
    activator("bun").focus();
    await userEvent.keyboard("{Enter}");
    root.querySelector<HTMLElement>('tr[data-row-key="bun"] .tree-toggle')!.click();
    await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    activator("bun:small").click();
    expect(opened).toEqual(["bun", "bun", "small"]);
  });

  it("opens nothing from a click on a product's grip, its menu button or its selection box", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun" })],
      selecting: true,
    });
    const opened = vi.fn();
    el.addEventListener("edit-product", opened);
    const row = (await tableRoot(el)).querySelector('tr[data-row-key="bun"]')!;
    await userEvent.click(row.querySelector<HTMLElement>(".drag-grip")!);
    await userEvent.click(row.querySelector<HTMLElement>("wt-row-actions")!);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(row.querySelector<HTMLElement>('input[type="checkbox"]')!);
    expect(opened).not.toHaveBeenCalled();
  });

  it("opens nothing when a drag of a product is released on its own row", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [product({ id: "bun" }), product({ id: "roll", name: "Roll" })],
    });
    const opened = vi.fn();
    el.addEventListener("edit-product", opened);
    const root = await tableRoot(el);
    const own = root.querySelector<HTMLElement>('tr[data-row-key="bun"] .row-activate')!;
    const other = root.querySelector<HTMLElement>('tr[data-row-key="roll"] .row-activate')!;
    const at = (target: HTMLElement, from: HTMLElement, type: string) => {
      const box = from.getBoundingClientRect();
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: box.x + 4,
          clientY: box.y + 4,
        }),
      );
    };
    at(own, own, "pointerdown");
    at(own, other, "pointermove");
    at(own, own, "pointermove");
    at(own, own, "pointerup");
    own.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
  });

  it("offers Add product and Add category on All products, and those, a divider, Rename, Move to… and Delete on a category", async () => {
    const { root } = await mountTree();
    const all = root.querySelector('[data-test="actions-root"]')!;
    expect(all.getAttribute("label")).toBe(`${t("staff.actions")}: ${t("folders.all_products")}`);
    expect(menuItems(all)).toEqual([t("catalogue.add_product"), t("folders.add_category")]);
    expect(menuItems(root.querySelector('[data-test="actions-folder-d"]')!)).toEqual([
      t("catalogue.add_product"),
      t("folders.add_category"),
      "—",
      t("folders.rename"),
      t("folders.move"),
      t("action.delete"),
    ]);
  });

  it("asks for a product or a category inside the row whose menu was used", async () => {
    const { el, root } = await mountTree({ canAddProduct: true });
    const asked: unknown[] = [];
    for (const name of ["add-product", "add-category", "move-folder"])
      el.addEventListener(name, (event) => asked.push([name, (event as CustomEvent).detail]));
    for (const test of ["add-product-root", "add-category-root", "add-product-d", "add-category-d", "move-d"])
      root.querySelector<HTMLElement>(`[data-test="${test}"]`)!.click();
    expect(asked).toEqual([
      ["add-product", { categoryId: null }],
      ["add-category", { parentId: null }],
      ["add-product", { categoryId: "d" }],
      ["add-category", { parentId: "d" }],
      ["move-folder", { folderId: "d" }],
    ]);
  });

  it("keeps every Add product disabled, and sends nothing, while products cannot be added yet", async () => {
    const { el, root, table } = await mountTree();
    const asked = vi.fn();
    el.addEventListener("add-product", asked);
    const items = () => [...root.querySelectorAll<HTMLElement>('[data-test^="add-product-"]')];
    expect(items().map((item) => item.hasAttribute("disabled"))).toEqual([true, true, true]);
    items()[0]!.click();
    expect(asked).not.toHaveBeenCalled();
    el.canAddProduct = true;
    await el.updateComplete;
    await table.updateComplete;
    expect(items().map((item) => item.hasAttribute("disabled"))).toEqual([false, false, false]);
  });

  it("puts focus on a row's menu button when asked", async () => {
    const { el, root } = await mountTree();
    el.focusRowMenu("d");
    expect(root.activeElement).toBe(root.querySelector('[data-test="actions-folder-d"]'));
    el.focusRowMenu(null);
    expect(root.activeElement).toBe(root.querySelector('[data-test="actions-root"]'));
  });

  it("reveals a product by opening every category above it", async () => {
    const { el, root } = await mountTree();
    await el.revealProduct("lager");
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "lager", "cola", "folder:f", "bread"]);
  });

  it.each(["en-GB", "es-ES"])(
    "keeps every row's menu on screen and uncovered at 390 px, three categories deep (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        const { el } = await mountWidget<ProductList>("dashboard-product-list", {
          categories: [drinks, beer, { id: "k", name: "Kegs", parentId: "b" }],
          products: [
            product({
              id: "keg",
              name: "Cerveza-de-barril-artesana-de-temporada-con-nombre-largo",
              primaryCategoryId: "k",
            }),
          ],
        });
        await el.revealCategory("k");
        const table = el.shadowRoot!.querySelector("wt-data-table")!;
        expectRowMenusOnScreen(table, 5);
        // The phone indent: half a step a level, measured where a 390 px screen puts the list.
        const indent = (key: string) =>
          getComputedStyle(
            table.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-cell`)!,
          ).paddingInlineStart;
        expect(["folder:d", "folder:k", "keg"].map(indent)).toEqual(["8px", "24px", "32px"]);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
```

In `product-list.a11y.test.ts`, "renders accessibly with the row action menu open" would now open the All products menu, the first `wt-row-actions` in the table. Keep it on a product's menu — setup only — by changing `table.shadowRoot!.querySelector("wt-row-actions")!.show();` to `table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>('[data-test="actions-p1"]')!.show();`. Then append inside the `describe.each`:

```ts
  it("renders accessibly with the All products menu open", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products, canAddProduct: true },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>('[data-test="actions-root"]')!
      .show();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a category's menu open", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products, categories: [{ id: "cat-1", name: "Comida", parentId: null }], canAddProduct: true },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '[data-test="actions-folder-cat-1"]',
      )!
      .show();
    await expectNoA11yViolations(host);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts -t "opens a product|opens nothing|released on its own row|offers Add product|asks for|disabled|focus on a row|reveals a product|390 px, three"`
Expected: FAIL — product rows have no activator, the menus hold Rename and Delete alone, All products has no menu, and the methods are missing.

- [ ] **Step 3: Implement in `product-list.ts` and `strings.ts`**

`strings.ts`: add `"folders.add_category": "Add category",` (en) and `"folders.add_category": "Añadir categoría",` (es).

`product-list.ts`: add the property

```ts
  /** Whether a product can be made yet: the editor needs a content language and a unit. */
  @property({ type: Boolean }) canAddProduct = false;
```

add before `#columns`:

```ts
  #addItems(categoryId: string | null) {
    const test = categoryId ?? ROOT_KEY;
    return html`<wt-button
        align="start"
        variant="secondary"
        data-test=${`add-product-${test}`}
        ?disabled=${!this.canAddProduct}
        @click=${() => {
          if (this.canAddProduct) this.#send("add-product", { categoryId });
        }}
        >${t("catalogue.add_product")}</wt-button
      ><wt-button
        align="start"
        variant="secondary"
        data-test=${`add-category-${test}`}
        @click=${() => this.#send("add-category", { parentId: categoryId })}
        >${t("folders.add_category")}</wt-button
      >`;
  }
```

In `#columns`'s `cell`, the root branch becomes:

```ts
        if (row.kind === "root") {
          if (column.key === "name")
            return html`<span part="folder-cell"
              ><wt-icon name="folder"></wt-icon><strong>${t("folders.all_products")}</strong
              ><span part="count" data-test="count-root">${this.#contents(null)}</span></span
            >`;
          if (column.key === "actions")
            return html`<wt-row-actions
              align="end"
              data-test="actions-root"
              label=${`${t("staff.actions")}: ${t("folders.all_products")}`}
              >${this.#addItems(null)}</wt-row-actions
            >`;
          return nothing;
        }
```

and the category's `actions` branch becomes:

```ts
        if (column.key === "actions")
          return html`<wt-row-actions
            align="end"
            label=${`${t("staff.actions")}: ${folder.name}`}
            data-test=${`actions-folder-${folder.id}`}
            >${this.#addItems(folder.id)}<hr part="menu-divider" /><wt-button
              align="start"
              variant="secondary"
              data-test=${`rename-${folder.id}`}
              @click=${(event: Event) => this.#emitFolder(event, "rename-folder", folder.id)}
              >${t("folders.rename")}</wt-button
            ><wt-button
              align="start"
              variant="secondary"
              data-test=${`move-${folder.id}`}
              @click=${() => this.#send("move-folder", { folderId: folder.id })}
              >${t("folders.move")}</wt-button
            ><wt-button
              align="start"
              variant="danger"
              data-test=${`delete-folder-${folder.id}`}
              @click=${(event: Event) => this.#emitFolder(event, "delete-folder", folder.id)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`;
```

Add after `revealCategory`:

```ts
  /** Opens every category above a product and scrolls it into view. */
  async revealProduct(id: string): Promise<void> {
    await this.updateComplete;
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    await table.revealRow(id);
  }

  focusRowMenu(categoryId: string | null): void {
    const key = categoryId === null ? ROOT_KEY : `folder:${categoryId}`;
    this.#table()
      ?.shadowRoot?.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"] wt-row-actions`)
      ?.focus();
  }
```

On `<wt-data-table>` in `render`, add:

```ts
      .rowClick=${(row: ListRow) => {
        if (row.kind === "product")
          this.#send("edit-product", { productId: (row.variant ?? row.product).id });
      }}
      .rowClickLabel=${(row: ListRow) =>
        row.kind === "product" ? `${t("action.edit")}: ${(row.variant ?? row.product).name}` : ""}
```

and to the styles:

```css
      wt-data-table::part(menu-divider) {
        align-self: stretch;
        margin: var(--wt-space-1) 0;
        border: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }
```

- [ ] **Step 4: The phone case's menu count (NEEDS THE OWNER — the All products row's ⋮ is spec §1; §8 does not list it)**

In `product-list.test.ts`, "keeps every product row's menu on screen and uncovered at 390 px while the other columns scroll sideways (%s)": `expectRowMenusOnScreen(el.shadowRoot!.querySelector("wt-data-table")!, 2)` becomes `…, 3)` — the All products row's menu is on screen too, and is held to the same rule.

- [ ] **Step 5: Run the product-list files**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`
Expected: PASS, `Test Files  2 passed (2)`.

- [ ] **Step 6: Write the failing browser tests**

Append to `catalogue-browser.test.ts`:

```ts
it("Move to… on a category's menu opens the move dialog for that category alone", async () => {
  const el = await mountBrowser();
  (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>('[data-test="move-d"]')!.click();
  await el.updateComplete;
  expect(dialog(el)!.heading).toBe("Move 1 item");
  expect(el.shadowRoot!.querySelector("wt-combobox")!.options).toEqual([
    { value: "top", label: "All products (top level)" },
    { value: "f", label: "Food" },
  ]);
  await destination(el, "f");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("Add category on a category's menu opens the category form inside it", async () => {
  const el = await mountBrowser();
  (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>('[data-test="add-category-f"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  expect(form.open).toBe(true);
  expect(form.defaultParentId).toBe("f");
});

it("passes whether products can be added to every menu", async () => {
  const el = await mountBrowser({ canAddProduct: true });
  expect(
    (await tableOf(el)).shadowRoot!.querySelector('[data-test="add-product-root"]')!.hasAttribute("disabled"),
  ).toBe(false);
});
```

(The second case is replaced by the inline name box in Task 9.) Setup only: in "real pointer drag moves a product into a folder", Bread's row is now covered by its activator too, so drag from its corner: `await userEvent.dragAndDrop((await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="bread"] .row-activate')!, (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="folder:f"] .row-activate')!, { sourcePosition: { x: 4, y: 4 }, targetPosition: { x: 4, y: 4 } });`.

- [ ] **Step 7: Implement in `catalogue-browser.ts`**

Add the property `@property({ type: Boolean }) canAddProduct = false;`. Change `folderForm` to carry the parent:

```ts
  @state() private folderForm: { value: CategorySummary | null; parentId: string | null } | null =
    null;
```

```ts
  #openForm(value: CategorySummary | null, parentId = value ? value.parentId : this.#addressed()): void {
    this.formErrors = {};
    this.folderForm = { value, parentId };
  }
```

and on `<dashboard-category-form>` replace `.defaultParentId=${this.#addressed()}` with `.defaultParentId=${this.folderForm?.parentId ?? null}`. Make `#openMove` take the keys:

```ts
  #openMove(keys = this.selected): void {
    if (this.operationBusy || this.summaryLoading) return;
    this.summaryFailed = false;
    this.operationSelection = this.#selection(keys);
    this.destination = "";
    this.operationError = "";
    this.operation = "move";
  }
```

Add the two public methods after `#list()`:

```ts
  /** Opens every category above a product, once the browser has drawn the list that holds it. */
  async revealProduct(id: string): Promise<void> {
    await this.updateComplete;
    await this.#list()?.revealProduct(id);
  }

  focusRowMenu(categoryId: string | null): void {
    this.#list()?.focusRowMenu(categoryId);
  }
```

On `<dashboard-product-list>` add:

```ts
        .canAddProduct=${this.canAddProduct}
        @move-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.#openMove([`folder:${event.detail.folderId}`]);
        }}
        @add-category=${(event: CustomEvent<{ parentId: string | null }>) => {
          event.stopPropagation();
          this.#openForm(null, event.detail.parentId);
        }}
```

(`add-product` and `edit-product` pass through to the screen.)

- [ ] **Step 8: Implement in `catalogue-screen.ts`**

- Delete `#renderAddProduct` and the header's `<div class="actions">…</div>`; the header becomes `<div class="header"><h1>${t("nav.catalogue")}</h1></div>` and the CSS selector `.header, .actions` becomes `.header`.
- Replace `#addOpener` with

```ts
  /** The category whose menu started the open add, or null for All products; undefined while none is. */
  #addFrom: string | null | undefined = undefined;
```

- Replace `#openCreate` and `#refocusAdd`:

```ts
  #openCreate(categoryId: string | null): void {
    this.newCategoryId = this.categories.some(({ id }) => id === categoryId) ? categoryId : null;
    this.#editorGeneration++;
    this.#resetEditorState();
    this.editorValue = null;
    this.errorKey = null;
    this.editorOpen = true;
  }

  #browser() {
    return this.shadowRoot?.querySelector("dashboard-catalogue-browser") ?? null;
  }

  /** An add hands focus back to the ⋮ of the row it started from once its last window closes. */
  #refocusAdd(): void {
    const from = this.#addFrom;
    this.#addFrom = undefined;
    if (from !== undefined) this.#browser()?.focusRowMenu(from);
  }
```

- In `#save`, after `await this.#reloadProducts();` add:

```ts
      if (created) {
        await this.updateComplete;
        await this.#browser()?.revealProduct(created.id);
      }
```

- On `<dashboard-catalogue-browser>` add:

```ts
              .canAddProduct=${locales.length > 0 && this.units.length > 0}
              @add-product=${(event: CustomEvent<{ categoryId: string | null }>) => {
                event.stopPropagation();
                this.#addFrom = event.detail.categoryId;
                this.#openCreate(event.detail.categoryId);
              }}
```

- On `<dashboard-product-editor>` add `@wt-close=${() => { if (!this.editorOpen && this.placing === null) this.#refocusAdd(); }}`.
- `categoryId` no longer decides a new product's category; it stays for the address.

- [ ] **Step 9: Update the screen tests**

Setup only (the header button is gone; the add starts from the event a menu sends; assertions unchanged): in "creates the complete aggregate once, closes, then refreshes the list", "creates a related unit without replacing the dirty parent draft" and the `create` helper of `describe("the Add to menus step after a create")`, replace `el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();` with `emit(list(el), "add-product", { categoryId: null });`. In `catalogue-screen.a11y.test.ts`, "renders the Add to menus step that follows a create accessibly", replace the same click with:

```ts
    el.shadowRoot!.querySelector("dashboard-catalogue-browser")!.dispatchEvent(
      new CustomEvent("add-product", {
        detail: { categoryId: null },
        bubbles: true,
        composed: true,
      }),
    );
```

Approved by §8 (header Add product), with the spec §3 replacements for Task 6's deletions — in `catalogue-screen.test.ts` import `ROOT_KEY` from `../widgets/product-list.js`, then:

- Replace "draws no Add product button in the product table once it lists something" with:

```ts
  it("draws the title alone in the header", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const header = el.shadowRoot!.querySelector(".header")!;
    expect([...header.children].map((child) => child.localName)).toEqual(["h1"]);
    expect(el.shadowRoot!.querySelector("[data-test=add-product]")).toBeNull();
  });
```

- Add:

```ts
  it("opens the product editor, with no category, from the All products menu", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    (await productTable(el)).shadowRoot!.querySelector<HTMLElement>('[data-test="add-product-root"]')!.click();
    await el.updateComplete;
    expect(editor(el).open).toBe(true);
    expect(editor(el).value).toBeNull();
    expect(editor(el).newCategoryId).toBeNull();
  });

  it("files a new product in the category whose menu added it, and in none for a category that is gone", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    emit(list(el), "add-product", { categoryId: "c1" });
    await el.updateComplete;
    expect(editor(el).newCategoryId).toBe("c1");
    emit(editor(el), "wt-cancel", {});
    await el.updateComplete;
    emit(list(el), "add-product", { categoryId: "gone" });
    await el.updateComplete;
    expect(editor(el).newCategoryId).toBeNull();
  });

  it("keeps every menu's Add product disabled until the units have loaded", async () => {
    const api = stubApi({ listUnits: vi.fn().mockResolvedValue([]) });
    Object.assign(api, { liveData: new LiveData() });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    const item = async () =>
      (await productTable(el)).shadowRoot!.querySelector<HTMLElement>(
        '[data-test="add-product-root"]',
      )!;
    expect((await item()).hasAttribute("disabled")).toBe(true);
    vi.mocked(api.listUnits).mockResolvedValue(units);
    api.liveData.invalidate([{ type: "units", id: units[0]!.id }]);
    await vi.waitFor(async () => expect((await item()).hasAttribute("disabled")).toBe(false));
  });

  it("returns focus to the ⋮ of the row whose Add product made a product, once the Add to menus step closes", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const table = await productTable(el);
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product-root"]')!.click();
    await el.updateComplete;
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    await vi.waitFor(() => expect(step(el).open).toBe(true));
    step(el).shadowRoot!.querySelector<HTMLElement>('[data-test="skip"]')!.click();
    await vi.waitFor(() => expect(step(el).open).toBe(false));
    await afterDialogCloses(el);
    expect(table.shadowRoot!.activeElement).toBe(
      table.shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"] wt-row-actions`),
    );
  });

  it("returns focus to that row's ⋮ after the product editor is cancelled", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const table = await productTable(el);
    table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product-c1"]')!.click();
    await el.updateComplete;
    emit(editor(el), "wt-cancel", {});
    await vi.waitFor(() => expect(editor(el).open).toBe(false));
    await afterDialogCloses(el);
    expect(table.shadowRoot!.activeElement).toBe(
      table.shadowRoot!.querySelector('tr[data-row-key="folder:c1"] wt-row-actions'),
    );
  });

  it("opens the category a new product was saved into, so the product shows", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    const reveal = vi.spyOn(list(el), "revealProduct");
    emit(list(el), "add-product", { categoryId: "c1" });
    await el.updateComplete;
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledExactlyOnceWith("new"));
  });
```

`afterDialogCloses` is declared inside `describe("catalogue-screen")`; these cases go inside that `describe`, after it.

- Replace the end-of-file case from Task 6, "reads and writes the opened category in the address, and files a new product there", with the address half alone:

```ts
it("reads and writes the opened category in the address", async () => {
  history.replaceState(null, "", "/manage/catalogue/category/c1");
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  const browser = el.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
  expect(browser.categoryId).toBe("c1");
  emit(browser, "open-category", { categoryId: "b" });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue/category/b");
  emit(browser, "open-category", { categoryId: null });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue");
});
```

and delete "creates an unfiled product when the addressed folder no longer exists" (approved: folder-at-a-time; its point, a category that is gone, is now in "files a new product in the category whose menu added it, and in none for a category that is gone").

- [ ] **Step 10: Run every touched file**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/screens/catalogue-screen.test.ts src/screens/catalogue-screen.a11y.test.ts`
Expected: PASS, `Test Files  6 passed (6)`.

- [ ] **Step 11: Typecheck, lint, format, guards, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src && pnpm exec prettier --check apps/dashboard/src && pnpm exec vitest run scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts`

```bash
git add apps/dashboard/src
git commit -s -m "A product's row opens it, and every add starts from a row's menu

A click or Enter on a product's row opens it, and on a variant's row opens that variant (A205).
All products' menu offers Add product and Add category; each category's menu offers those, then
Rename, Move to… and Delete. The header's Add product button is gone. A new product is filed in
the category whose menu added it, that category opens to show it, and focus returns to the menu."
```

---
## Task 8: One toolbar — search, filters, Expand all, Select, Columns

**Files:**
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts` (its controls move into the list's slots; `.toolbar` and `.action-bar` CSS go)
- Modify: `apps/dashboard/src/widgets/product-list.ts` (forwards two slots; passes the Expand all labels)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/catalogue-browser.test.ts`

**Interfaces:**
- Consumes (Task 3): `wt-data-table`'s `toolbar-start` / `toolbar-end` slots, `expandAllLabel`, `collapseAllLabel`.
- Produces: `dashboard-product-list` forwards `toolbar-start` and `toolbar-end` (`<slot name="toolbar-start" slot="toolbar-start">`); the browser slots its search box into `toolbar-start` and a `div.actions` (spinner, Select or the Select-mode bar, New folder until Task 9) into `toolbar-end`.

- [ ] **Step 1: Write the failing tests**

Append to `catalogue-browser.test.ts`:

```ts
it("draws the search box, the filters, Expand all, Select and Columns on one line of one toolbar, in that order", async () => {
  const { page } = await import("vitest/browser");
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 720);
  try {
    const el = await mountBrowser();
    const table = await tableOf(el);
    const search = el.shadowRoot!.querySelector<HTMLElement>('[name="catalogue-search"]')!;
    const select = el.shadowRoot!.querySelector<HTMLElement>('[data-test="select"]')!;
    expect(search.assignedSlot!.assignedSlot!.closest(".table-toolbar")).toBe(
      table.shadowRoot!.querySelector(".table-toolbar"),
    );
    expect(select.parentElement!.assignedSlot!.assignedSlot!.closest(".table-end")).not.toBeNull();
    const boxes = [
      search,
      table.shadowRoot!.querySelector(".table-filters")!,
      table.shadowRoot!.querySelector(".expand-all")!,
      select,
      table.shadowRoot!.querySelector(".columns-trigger")!,
    ].map((element) => element.getBoundingClientRect());
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index]!.left, `item ${index}`).toBeGreaterThanOrEqual(boxes[index - 1]!.right);
      expect(boxes[index]!.top, `item ${index}`).toBeLessThan(boxes[0]!.bottom);
    }
    expect(el.shadowRoot!.querySelector(".toolbar")).toBeNull();
  } finally {
    await page.viewport(width, height);
  }
});

it("Expand all opens every category, and reads Collapse all until one is closed", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const button = () => table.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  expect(button().textContent!.trim()).toBe("Expand all");
  button().click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "cola", "folder:f", "burger", "bread"]);
  expect(button().textContent!.trim()).toBe("Collapse all");
  await toggleCategory(el, "f");
  expect(button().textContent!.trim()).toBe("Expand all");
});

it("puts Select mode's count, Move to…, Delete and Cancel at the toolbar's end", async () => {
  const el = await mountBrowser();
  await press(el, "select");
  const end = (await tableOf(el)).shadowRoot!.querySelector(".table-end")!;
  for (const test of ["selected-count", "move", "delete", "cancel-selection"]) {
    const control = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;
    expect(control.closest('[slot="toolbar-end"]')!.assignedSlot!.assignedSlot!.closest(".table-end"), test).toBe(end);
  }
});
```

Setup only: in "refuses a folder over itself or its descendants but highlights a sibling", the browser's own `.toolbar` is gone; move the pointer over the search box instead — `pointerEvent(el.shadowRoot!.querySelector('[name="catalogue-search"]')!, "pointermove");`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts -t "one toolbar|Expand all opens|toolbar's end"`
Expected: FAIL — the search box sits in the browser's own toolbar, and there is no `.expand-all`.

- [ ] **Step 3: Implement**

`strings.ts`: `"folders.expand_all": "Expand all",` and `"folders.collapse_all": "Collapse all",` (en); `"folders.expand_all": "Expandir todo",` and `"folders.collapse_all": "Contraer todo",` (es).

`product-list.ts`: on `<wt-data-table>` add `expandAllLabel=${t("folders.expand_all")}` and `collapseAllLabel=${t("folders.collapse_all")}`, and give it children:

```ts
    ><slot name="toolbar-start" slot="toolbar-start"></slot
      ><slot name="toolbar-end" slot="toolbar-end"></slot
    ></wt-data-table>`;
```

`catalogue-browser.ts`: delete the `.toolbar` and `.action-bar` CSS rules and add

```css
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
```

In `render`, delete the `<div class="toolbar">…</div>` wrapper and put its contents inside `<dashboard-product-list>…</dashboard-product-list>` as:

```ts
        <wt-input
          slot="toolbar-start"
          name="catalogue-search"
          type="search"
          label=${t("folders.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
        <div slot="toolbar-end" class="actions">
          ${
            !this.operation && (this.summaryLoading || this.operationBusy)
              ? html`<wt-spinner></wt-spinner>`
              : nothing
          }
          ${
            this.selecting
              ? html`<span data-test="selected-count" aria-live="polite"
                    >${this.#plural("folders.selected", this.selected.length)}</span
                  >
                  <wt-button
                    data-test="move"
                    variant="secondary"
                    .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                    @click=${() => this.#openMove()}
                    >${t("folders.move")}</wt-button
                  >
                  <wt-button
                    data-test="delete"
                    variant="danger"
                    .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                    @click=${() => void this.#openDelete()}
                    >${t("action.delete")}</wt-button
                  >
                  <wt-button
                    data-test="cancel-selection"
                    variant="secondary"
                    @click=${() => {
                      this.selected = [];
                      this.selecting = false;
                    }}
                    >${t("folders.cancel_selection")}</wt-button
                  >`
              : html`<wt-button
                    data-test="select"
                    variant="secondary"
                    @click=${() => (this.selecting = true)}
                    >${t("folders.select")}</wt-button
                  >
                  <wt-button data-test="new-folder" @click=${() => this.#openForm(null)}
                    >${t("folders.new")}</wt-button
                  >`
          }
        </div>
```

The `wt-input` rule stays: it styles the box, which now lays out in the table's toolbar through two `display: contents` slots.

- [ ] **Step 4: Run the browser files**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/widgets/product-list.test.ts`
Expected: PASS, including "keeps the search field usable at phone width" unchanged (the box keeps 90% of the width at 390 px).

- [ ] **Step 5: Typecheck, lint, format, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src && pnpm exec prettier --check apps/dashboard/src`

```bash
git add apps/dashboard/src
git commit -s -m "The Products screen has one toolbar: search, filters, Expand all, Select and Columns

The search box and Select mode now sit on the table's own toolbar, with an Expand all button that
reads Collapse all while every category is open."
```

---

## Task 9: Naming categories in place, and an empty catalogue's open menu

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts`
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts` (saves names; the category form, `#openForm`, `#save`, `#addressed` and New folder go)
- Modify: `apps/dashboard/src/screens/catalogue-screen.ts` (passes `loaded`)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/product-list.test.ts`, `catalogue-browser.test.ts`, `catalogue-browser.a11y.test.ts`, `apps/dashboard/src/screens/catalogue-screen.test.ts`

**Interfaces:**
- Consumes (Tasks 6–7): `#rows`, `#columns`, `#send`, `#table()`, `revealRow`, `wt-row-actions`' `show()`.
- Produces:
  - `export type CategoryNameDraft = { kind: "create"; parentId: string | null } | { kind: "rename"; categoryId: string }` from `product-list.ts`.
  - `ProductList.nameDraft: CategoryNameDraft | null`, `ProductList.nameError: string`, `ProductList.loaded: boolean`; a draft row keyed `draft:new`; the box `wt-input[name="category-name"][part="name-box"]`.
  - Events `name-commit` (`detail: { name: string }`, trimmed, at most once until a refusal or a new box) and `name-cancel` (`detail: {}`).
  - `rename-folder` now closes the menu (sent without stopping the click).
  - `CatalogueBrowser.loaded: boolean`.

- [ ] **Step 1: Write the failing product-list tests**

Add `onTestFinished` to the `vitest` import of `product-list.test.ts`, and a helper beside `openRow`:

```ts
const focusedName = (el: ProductList) =>
  el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.activeElement?.getAttribute("name");
```

Append inside `describe("the product list as a tree")`:

```ts
  it("puts a new category's name box inside the category it is added to, opened, holding the cursor", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "create", parentId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    expect(rowKeys(root)).toEqual(["folder:d", "folder:b", "draft:new", "cola", "folder:f", "bread"]);
    expect(root.querySelector('tr[data-row-key="draft:new"]')!.getAttribute("aria-level")).toBe("3");
    const box = root.querySelector('tr[data-row-key="draft:new"] wt-input')!;
    expect(box.getAttribute("part")).toBe("name-box");
    expect(box.getAttribute("label")).toBe(t("folders.name"));
  });

  it("sends the typed name, trimmed, on Enter or on leaving the box, and a cancel on Esc or on leaving it blank", async () => {
    const { el } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.addEventListener("name-cancel", () => sent.push("cancel"));
    const start = async (parentId: string | null) => {
      el.nameDraft = null;
      await el.updateComplete;
      el.nameDraft = { kind: "create", parentId };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    };
    await start(null);
    await userEvent.keyboard("  Juice  {Enter}");
    await start(null);
    await userEvent.keyboard("Tea{Tab}");
    await start("d");
    await userEvent.keyboard("Tea{Escape}");
    await start("d");
    await userEvent.keyboard("{Tab}");
    expect(sent).toEqual([{ name: "Juice" }, { name: "Tea" }, "cancel", "cancel"]);
  });

  it("sends a name once, shows a refusal under the box, and then lets Enter send again", async () => {
    const { el, root } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.nameDraft = { kind: "create", parentId: null };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    await userEvent.keyboard("Juice{Enter}{Enter}");
    expect(sent).toEqual([{ name: "Juice" }]);
    el.nameError = "That name is taken.";
    await el.updateComplete;
    const box = root.querySelector<HTMLElementTagNameMap["wt-input"]>('wt-input[name="category-name"]')!;
    await box.updateComplete;
    expect(box.shadowRoot!.querySelector("[data-error]")!.textContent).toBe("That name is taken.");
    await userEvent.keyboard("{Enter}");
    expect(sent).toEqual([{ name: "Juice" }, { name: "Juice" }]);
  });

  it("turns a category's name into the box, holding its name, for a rename", async () => {
    const { el, root } = await mountTree();
    el.nameDraft = { kind: "rename", categoryId: "d" };
    await el.updateComplete;
    await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    const row = root.querySelector('tr[data-row-key="folder:d"]')!;
    expect(row.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.value).toBe("Drinks");
    expect(row.querySelector("strong")).toBeNull();
    expect(row.querySelector(".row-activate")).toBeNull();
  });

  it("a rename's box sends a cancel on Esc, and on leaving it blank", async () => {
    const { el } = await mountTree();
    const sent: unknown[] = [];
    el.addEventListener("name-commit", (event) => sent.push((event as CustomEvent).detail));
    el.addEventListener("name-cancel", () => sent.push("cancel"));
    const rename = async () => {
      el.nameDraft = null;
      await el.updateComplete;
      el.nameDraft = { kind: "rename", categoryId: "d" };
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedName(el)).toBe("category-name"));
    };
    await rename();
    await userEvent.keyboard("Beverages{Escape}");
    await rename();
    await userEvent.keyboard("{Backspace}{Tab}");
    expect(sent).toEqual(["cancel", "cancel"]);
  });

  it("opens the All products menu, without moving focus, when the catalogue loads empty, and only that once", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    outside.focus();
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [],
      categories: [],
      loaded: true,
    });
    const menu = (await tableRoot(el)).querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-root"]',
    )!;
    const popup = () => menu.shadowRoot!.querySelector("[popover]")!;
    await vi.waitFor(() => expect(popup().matches(":popover-open")).toBe(true));
    expect(document.activeElement).toBe(outside);
    menu.hide();
    el.products = [];
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(popup().matches(":popover-open")).toBe(false);
  });

  it("leaves the menu closed before the catalogue has loaded, and for one with something in it", async () => {
    const { el } = await mountWidget<ProductList>("dashboard-product-list", {
      products: [],
      categories: [],
    });
    const popup = async () =>
      (await tableRoot(el)).querySelector('[data-test="actions-root"]')!.shadowRoot!.querySelector(
        "[popover]",
      )!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((await popup()).matches(":popover-open")).toBe(false);
    el.products = [product()];
    el.loaded = true;
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((await popup()).matches(":popover-open")).toBe(false);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts -t "name box|typed name|sends a name once|for a rename|rename's box|All products menu|menu closed before"`
Expected: FAIL — no draft row, no box, no `loaded`; "leaves the menu closed…" passes already (it holds the "once, and only when loaded empty" rule against Step 3).

- [ ] **Step 3: Implement in `product-list.ts` and `strings.ts`**

`strings.ts`: add `"folders.name": "Category name",` (en) and `"folders.name": "Nombre de la categoría",` (es); delete `folders.new` from both.

`product-list.ts`: add `import "@waitron/ui/src/components/wt-input.js";` and `PropertyValues` is already imported. Add beside `ROOT_KEY`:

```ts
const DRAFT_KEY = "draft:new";

export type CategoryNameDraft =
  | { kind: "create"; parentId: string | null }
  | { kind: "rename"; categoryId: string };

type DraftRow = { kind: "draft"; key: typeof DRAFT_KEY; parentKey: string };
```

and widen `type ListRow = ProductRow | CategoryRow | RootRow | DraftRow;`. Properties and fields:

```ts
  @property({ attribute: false }) nameDraft: CategoryNameDraft | null = null;
  /** The server's refusal of the name the box last sent, shown under the box. */
  @property() nameError = "";
  /** Whether the catalogue has loaded, so that an empty one is known to be empty. */
  @property({ type: Boolean }) loaded = false;
  #nameValue = "";
  /** Set once the box has sent its name or its cancel, until a refusal or a new box. */
  #nameSent = false;
  #emptyChecked = false;
```

Extend `willUpdate`:

```ts
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("extraLists") || changed.has("optionLists"))
      this.#listNames = modifierListNames(this.extraLists, this.optionLists);
    if (changed.has("categories") || changed.has("products")) this.#counts = this.#count();
    if (changed.has("nameDraft")) {
      const draft = this.nameDraft;
      this.#nameSent = false;
      this.#nameValue =
        draft?.kind === "rename"
          ? (this.categories.find(({ id }) => id === draft.categoryId)?.name ?? "")
          : "";
    }
    if (changed.has("nameError") && this.nameError !== "") this.#nameSent = false;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("nameDraft") && this.nameDraft) void this.#focusNameBox();
    if (this.loaded && !this.#emptyChecked) {
      this.#emptyChecked = true;
      if (this.products.length === 0 && this.categories.length === 0) void this.#openRootMenu();
    }
  }

  async #focusNameBox(): Promise<void> {
    const draft = this.nameDraft;
    const table = this.#table();
    if (!draft || !table) return;
    await table.updateComplete;
    await table.revealRow(draft.kind === "create" ? DRAFT_KEY : `folder:${draft.categoryId}`);
    const box = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="category-name"]',
    );
    if (!box) return;
    await box.updateComplete;
    box.focus();
    box.shadowRoot!.querySelector("input")!.select();
  }

  /** `show()` moves no focus, so the person's place on the page is kept. */
  async #openRootMenu(): Promise<void> {
    const table = this.#table();
    if (!table) return;
    await table.updateComplete;
    const menu = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-root"]',
    );
    if (!menu) return;
    await menu.updateComplete;
    menu.show();
  }

  #commitName(): void {
    if (this.#nameSent) return;
    const name = this.#nameValue.trim();
    if (name === "") {
      this.#cancelName();
      return;
    }
    this.#nameSent = true;
    this.#send("name-commit", { name });
  }

  #cancelName(): void {
    if (this.#nameSent) return;
    this.#nameSent = true;
    this.#send("name-cancel", {});
  }

  #nameBox() {
    return html`<wt-input
      part="name-box"
      name="category-name"
      label=${t("folders.name")}
      hide-label
      .value=${this.#nameValue}
      .error=${this.nameError}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#nameValue = event.detail.value;
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.#commitName();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.#cancelName();
        }
      }}
      @focusout=${() => {
        if (this.nameDraft === null || this.#nameSent) return;
        if (this.#nameValue.trim() === "") this.#cancelName();
        else this.#commitName();
      }}
    ></wt-input>`;
  }

  #renaming(id: string): boolean {
    return this.nameDraft?.kind === "rename" && this.nameDraft.categoryId === id;
  }
```

In `#rows`, after the categories, add the draft:

```ts
      ...(this.nameDraft?.kind === "create"
        ? [{ kind: "draft", key: DRAFT_KEY, parentKey: keyOf(this.nameDraft.parentId) } satisfies DraftRow]
        : []),
```

In `#columns`'s `cell`, add before the root branch:

```ts
        if (row.kind === "draft")
          return column.key === "name"
            ? html`<span part="folder-cell"><wt-icon name="folder"></wt-icon>${this.#nameBox()}</span>`
            : nothing;
```

In the category's name cell, replace `<strong>${folder.name}</strong>` with `${this.#renaming(folder.id) ? this.#nameBox() : html`<strong>${folder.name}</strong>`}`; in its menu, the Rename button's handler becomes `@click=${() => this.#send("rename-folder", { folderId: folder.id })}`. The `sortValue` mapper becomes:

```ts
            sortValue: (row: ListRow) =>
              row.kind === "product"
                ? column.sortValue!(row)
                : row.kind === "folder"
                  ? row.folder.name
                  : row.kind === "draft"
                    ? null
                    : "",
```

(a draft sorts after its sibling categories in either direction), and the `searchValue` mapper's `row.kind === "root" ? ""` becomes `row.kind === "root" || row.kind === "draft" ? ""`. In `#pointerDown`, `listed.kind === "root"` becomes `listed.kind === "root" || listed.kind === "draft"`. On `<wt-data-table>`, `.rowActivation` becomes:

```ts
      .rowActivation=${(row: ListRow) =>
        row.kind === "folder" && !this.#renaming(row.folder.id)
          ? "toggle"
          : row.kind === "product"
            ? "click"
            : "none"}
```

Add to the styles:

```css
      wt-data-table::part(name-box) {
        flex: 1 1 calc(var(--wt-tap-min) * 4);
        min-width: 0;
      }
```

- [ ] **Step 4: Run the product-list files**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing browser tests**

In `catalogue-browser.test.ts` add `import { codeMessage } from "../i18n/codes.js";` and the helpers:

```ts
async function menuAction(el: CatalogueBrowser, test: string) {
  (await tableOf(el)).shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!.click();
  await el.updateComplete;
}
async function nameBox(el: CatalogueBrowser) {
  const table = await tableOf(el);
  await vi.waitFor(() =>
    expect(table.shadowRoot!.activeElement?.getAttribute("name")).toBe("category-name"),
  );
  return table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    'wt-input[name="category-name"]',
  )!;
}
```

Approved by §8 (the New folder button; the rename's form goes with it) — replace "creates a folder under the current folder and closes after save" with:

```ts
it("Add category makes the typed category inside the category whose menu asked, and the box goes", async () => {
  const el = await mountBrowser();
  await menuAction(el, "add-category-d");
  await nameBox(el);
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:b", "draft:new", "cola", "folder:f", "bread"]);
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() =>
    expect(el.api.createCategory).toHaveBeenCalledExactlyOnceWith({ name: "Juice", parentId: "d" }),
  );
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
});
```

"creates a top-level folder when the addressed folder is missing" with:

```ts
it("Add category on All products makes a top-level category", async () => {
  const el = await mountBrowser({ categoryId: "gone" });
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() =>
    expect(el.api.createCategory).toHaveBeenCalledExactlyOnceWith({ name: "Juice", parentId: null }),
  );
});
```

"renames a root folder without adopting the current folder" with (the API call asserted is today's, unchanged):

```ts
it("renames a top-level category in place without adopting the addressed one", async () => {
  const el = await mountBrowser({ categoryId: "b" });
  await menuAction(el, "rename-d");
  const box = await nameBox(el);
  expect(box.value).toBe("Drinks");
  await userEvent.keyboard("Beverages{Enter}");
  await vi.waitFor(() =>
    expect(el.api.updateCategory).toHaveBeenCalledWith("d", { name: "Beverages", parentId: null }),
  );
});
```

"keeps a refused folder save open with a field error" with:

```ts
it("keeps a refused name in its box with the refusal under it, and Enter tries again", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.createCategory).mockRejectedValueOnce({ code: "category.invalid" });
  await menuAction(el, "add-category-d");
  const box = await nameBox(el);
  await userEvent.keyboard("Juice{Enter}");
  await vi.waitFor(() => expect(box.error).toBe(codeMessage("category.invalid")));
  expect(await rowKeys(el)).toContain("draft:new");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(el.api.createCategory).toHaveBeenCalledTimes(2));
});
```

and "Add category on a category's menu opens the category form inside it" (Task 7) with:

```ts
it("Esc, or leaving the box blank, adds nothing", async () => {
  const el = await mountBrowser();
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Tea{Escape}");
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("{Tab}");
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  expect(el.api.createCategory).not.toHaveBeenCalled();
});

it("makes one category from Enter pressed twice, or Enter then leaving the box", async () => {
  const el = await mountBrowser();
  let finish!: (value: CategorySummary) => void;
  vi.mocked(el.api.createCategory).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await menuAction(el, "add-category-root");
  await nameBox(el);
  await userEvent.keyboard("Juice{Enter}{Enter}{Tab}");
  finish(folder("j", "Juice", null));
  await vi.waitFor(async () => expect(await rowKeys(el)).not.toContain("draft:new"));
  expect(el.api.createCategory).toHaveBeenCalledOnce();
});

it("Add category clears a typed search, so its name box shows", async () => {
  const el = await mountBrowser();
  await typeSearch(el, "cola");
  await menuAction(el, "add-category-d");
  await nameBox(el);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="catalogue-search"]')!.value,
  ).toBe("");
});

it("keeps the old name, and sends nothing more, when a refused rename is left with Esc", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.updateCategory).mockRejectedValueOnce({ code: "category.invalid" });
  await menuAction(el, "rename-d");
  const box = await nameBox(el);
  await userEvent.keyboard("Beverages{Enter}");
  await vi.waitFor(() => expect(box.error).not.toBe(""));
  await userEvent.keyboard("{Escape}");
  const table = await tableOf(el);
  await vi.waitFor(() =>
    expect(table.shadowRoot!.querySelector('wt-input[name="category-name"]')).toBeNull(),
  );
  expect(el.api.updateCategory).toHaveBeenCalledOnce();
  expect(table.shadowRoot!.querySelector('tr[data-row-key="folder:d"] strong')!.textContent).toBe(
    "Drinks",
  );
});
```

Approved by §8 (New folder): in "leaves selection mode on Cancel and restores the ordinary toolbar with no selected keys", the list becomes `["select"]`. In `catalogue-browser.a11y.test.ts`, the state `"form"` becomes `"naming"`, and its block becomes:

```ts
      if (state === "naming") {
        const table = list.shadowRoot!.querySelector("wt-data-table")!;
        vi.mocked(el.api.createCategory).mockRejectedValueOnce({ code: "category.invalid" });
        table.shadowRoot!.querySelector<HTMLElement>('[data-test="add-category-d"]')!.click();
        await vi.waitFor(() =>
          expect(table.shadowRoot!.activeElement?.getAttribute("name")).toBe("category-name"),
        );
        await userEvent.keyboard("Juice{Enter}");
        await vi.waitFor(() =>
          expect(
            table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
          ).not.toBe(""),
        );
      }
```

placed after the list's table has updated. Add `expect` to that file's `vitest` import and `import { userEvent } from "vitest/browser";`; its API stub already has `createCategory: vi.fn()`, which this state alone makes refuse.

Append inside `describe("catalogue-screen")` in `catalogue-screen.test.ts`:

```ts
  it("tells the product list the catalogue has loaded only once its products have", async () => {
    const pending: ((value: Product[]) => void)[] = [];
    const api = stubApi({
      listProducts: vi.fn(() => new Promise<Product[]>((resolve) => pending.push(resolve))),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).loaded).toBe(false);
    for (const resolve of pending) resolve([]);
    await vi.waitFor(() => expect(list(el).loaded).toBe(true));
  });
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts src/screens/catalogue-screen.test.ts -t "Add category|renames a top-level|refused name|adds nothing|Enter pressed twice|clears a typed search|refused rename|has loaded"`
Expected: FAIL — the menus still open the category form, and the browser has no `loaded`.

- [ ] **Step 7: Implement in `catalogue-browser.ts` and the screen**

`catalogue-browser.ts`: import `type CategoryNameDraft` beside `ProductList` from `./product-list.js`; delete the bare `import "./category-form.js";` (the named import of its helpers stays), the `CategoryInput` type import, the `folderForm`, `formBusy` and `formErrors` states, `#openForm`, `#save`, `#addressed`, the `<dashboard-category-form>` element, and the `new-folder` button. Add:

```ts
  @property({ type: Boolean }) loaded = false;
  @state() private nameDraft: CategoryNameDraft | null = null;
  @state() private nameError = "";
  #nameBusy = false;

  async #saveName(event: CustomEvent<{ name: string }>): Promise<void> {
    event.stopPropagation();
    const draft = this.nameDraft;
    if (!draft || this.#nameBusy) return;
    this.#nameBusy = true;
    this.nameError = "";
    const parentId =
      draft.kind === "create"
        ? draft.parentId
        : (this.categories.find(({ id }) => id === draft.categoryId)?.parentId ?? null);
    try {
      if (draft.kind === "create") await this.api.createCategory({ name: event.detail.name, parentId });
      else await this.api.updateCategory(draft.categoryId, { name: event.detail.name, parentId });
      if (this.nameDraft === draft) this.nameDraft = null;
    } catch (error) {
      this.nameError = Object.values(categoryRefusalErrors(error, parentId))[0]!;
    } finally {
      this.#nameBusy = false;
    }
  }
```

On `<dashboard-product-list>`, replace the `@add-category` and `@rename-folder` handlers and add the rest:

```ts
        .nameDraft=${this.nameDraft}
        .nameError=${this.nameError}
        .loaded=${this.loaded}
        @add-category=${(event: CustomEvent<{ parentId: string | null }>) => {
          event.stopPropagation();
          this.search = "";
          this.nameError = "";
          this.nameDraft = { kind: "create", parentId: event.detail.parentId };
        }}
        @rename-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.nameError = "";
          this.nameDraft = { kind: "rename", categoryId: event.detail.folderId };
        }}
        @name-commit=${(event: CustomEvent<{ name: string }>) => void this.#saveName(event)}
        @name-cancel=${(event: Event) => {
          event.stopPropagation();
          if (this.#nameBusy) return;
          this.nameDraft = null;
          this.nameError = "";
        }}
```

`catalogue-screen.ts`: add `@state() private productsLoaded = false;`, set `this.productsLoaded = true;` in `#load` right after `await this.#reloadProducts();`, and pass `.loaded=${this.productsLoaded}` to the browser. Rerun Step 6's command: PASS.

- [ ] **Step 8: Run every touched file**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/screens/catalogue-screen.test.ts src/screens/catalogue-screen.a11y.test.ts src/widgets/category-form.test.ts`
Expected: PASS, `Test Files  7 passed (7)`. `category-form.test.ts` is unchanged: the form stays for the product editor's nested create (spec §2).

- [ ] **Step 9: Typecheck, lint, format, guards, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src && pnpm exec prettier --check apps/dashboard/src && pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`

```bash
git add apps/dashboard/src
git commit -s -m "Categories are added and renamed in place, and an empty catalogue opens its menu

Add category puts a name box on a new row inside that category; Enter, or leaving the box with
a name typed, saves it, and Esc or a blank box removes it. A refusal shows under the box and
the row stays. Rename turns the name into the same box. The New folder button and its form are
gone from this screen; the product editor keeps the form. With nothing in the catalogue, the
All products menu opens by itself, without taking focus."
```

---
## Task 10: A clearer drag — faded origin, lifted copy, gap, left-edge bar, hover-to-open, and several rows at once

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts` (the drag, its styles, the lifted copy)
- Modify: `apps/dashboard/src/widgets/catalogue-browser.ts` (`#drop` clears only what moved)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/widgets/catalogue-browser.test.ts`, `apps/dashboard/src/widgets/product-list.a11y.test.ts`
- Modify: `docs/developers/product-categories.md` (the drag sentence under "Moving and deleting")

**Interfaces:**
- Consumes (Tasks 1, 6, 9): `isExpanded`, `setExpanded`, `sortedSiblings`, `#rowByKey`, `#table()`, `#send`, `#pointerDown`, `DraftRow`.
- Produces:
  - `export const HOVER_OPEN_MS = 600` from `product-list.ts`.
  - Parts on the table's rows during a drag: `dragging` on each dragged row's `<tr>` (faded), `drop-target` on the target row's first `<td>` (the left-edge bar), `drop-gap-before` / `drop-gap-after` on each `<td>` of the row the gap opens beside.
  - `div.drag-ghost[data-test="drag-ghost"]` in the product list's own shadow root while a drag is live.
  - `drop-items` `detail: { keys: string[]; folderId: string | null }` — `null` is All products.
  - Removed: the row's `translateY` and the `top` / `row` fields of the pointer drag.

- [ ] **Step 1: Write the failing tests**

In `catalogue-browser.test.ts`, import `HOVER_OPEN_MS` beside `ROOT_KEY` from `./product-list.js`, then:

**NEEDS THE OWNER** (spec §4 replaces the drag's look; §8 does not list it) — replace "moves a dragged product into a folder" with:

```ts
it("a dragged product stays in place, faded, under a lifted copy, and moves on the drop", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const from = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="bread"]')!;
  const before = from.getBoundingClientRect().top;
  const destination = await nameCell(el, "folder:f");
  pointerEvent(await nameCell(el, "bread"), "pointerdown");
  pointerEvent(destination, "pointermove");
  await list.updateComplete;
  expect(from.part.contains("dragging")).toBe(true);
  expect(getComputedStyle(from).opacity).toBe("0.5");
  expect(from.style.transform).toBe("");
  expect(from.getBoundingClientRect().top).toBe(before);
  expect(list.shadowRoot!.querySelector('[data-test="drag-ghost"]')!.textContent!.trim()).toBe(
    "Bread",
  );
  const bar = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="folder:f"] td')!;
  expect(bar.part.contains("drop-target")).toBe(true);
  expect(getComputedStyle(bar).borderInlineStartStyle).toBe("solid");
  pointerEvent(destination, "pointerup");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
  await list.updateComplete;
  expect(from.part.contains("dragging")).toBe(false);
  expect(list.shadowRoot!.querySelector('[data-test="drag-ghost"]')).toBeNull();
});
```

and in "finds a folder under a captured touch pointer", "a cancelled pointer over a valid folder does not move the product" and "refuses a folder over itself or its descendants but highlights a sibling", read the marker on the row's first cell instead of the name cell: every `X.getAttribute("part")).toContain("drop-target")` becomes `X.closest("tr")!.querySelector("td")!.part.contains("drop-target")).toBe(true)`, and every `.not.toContain("drop-target")` becomes `.toBe(false)` on the same expression.

New cases:

```ts
it("opens a closed category after the hover delay, not before, and shows the gap where the product will land", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const el = await mountBrowser();
    const table = await tableOf(el);
    const cell = await nameCell(el, "bread");
    pointerEvent(cell, "pointerdown");
    pointerEvent(await nameCell(el, "folder:d"), "pointermove");
    vi.advanceTimersByTime(HOVER_OPEN_MS - 1);
    await table.updateComplete;
    expect(await rowKeys(el)).not.toContain("cola");
    vi.advanceTimersByTime(1);
    await table.updateComplete;
    expect(await rowKeys(el)).toContain("cola");
    expect(
      table.shadowRoot!.querySelector('tr[data-row-key="cola"] td')!.part.contains("drop-gap-before"),
    ).toBe(true);
    pointerEvent(cell, "pointercancel");
  } finally {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

it("leaves a closed category closed when a drag crosses it without stopping", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const el = await mountBrowser();
    const table = await tableOf(el);
    const cell = await nameCell(el, "bread");
    pointerEvent(cell, "pointerdown");
    pointerEvent(await nameCell(el, "folder:d"), "pointermove");
    vi.advanceTimersByTime(HOVER_OPEN_MS - 100);
    pointerEvent(await nameCell(el, "folder:f"), "pointermove");
    vi.advanceTimersByTime(200);
    await table.updateComplete;
    expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
    vi.advanceTimersByTime(HOVER_OPEN_MS);
    await table.updateComplete;
    expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "burger", "bread"]);
    pointerEvent(cell, "pointercancel");
  } finally {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  }
});

it("dropping on a product files the dragged row into that product's category", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  drag(await nameCell(el, "bread"), await nameCell(el, "cola"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "d",
    ),
  );
});

it("shows the gap after the last row when the dragged row would land last", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  const table = await tableOf(el);
  const cell = await nameCell(el, "cola");
  pointerEvent(cell, "pointerdown");
  pointerEvent(
    table.shadowRoot!.querySelector(`tr[data-row-key="${ROOT_KEY}"] [part~="folder-cell"]`)!,
    "pointermove",
  );
  const last = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="bread"] td')!;
  expect(last.part.contains("drop-gap-after")).toBe(true);
  expect(getComputedStyle(last).borderBottomStyle).toBe("dashed");
  pointerEvent(cell, "pointercancel");
});

it("Esc cancels a drag with nothing moved, and the click that ends it opens nothing", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const target = table.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="folder:f"] .row-activate',
  )!;
  pointerEvent(await nameCell(el, "bread"), "pointerdown");
  pointerEvent(target, "pointermove");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(table.shadowRoot!.querySelector('tr[data-row-key="bread"]')!.part.contains("dragging")).toBe(
    false,
  );
  // A person lets go of the button a moment after Esc, never within the same task.
  await new Promise((resolve) => setTimeout(resolve, 0));
  pointerEvent(target, "pointerup");
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("a drop where the drag started moves nothing and is never marked", async () => {
  const el = await mountBrowser();
  const table = await tableOf(el);
  const cell = await nameCell(el, "bread");
  pointerEvent(cell, "pointerdown");
  pointerEvent(await nameCell(el, "folder:f"), "pointermove");
  pointerEvent(cell, "pointermove");
  expect(table.shadowRoot!.querySelector('[part~="drop-target"]')).toBeNull();
  pointerEvent(cell, "pointerup");
  expect(el.api.moveCatalogueItems).not.toHaveBeenCalled();
});

it("in Select mode, dragging a selected row moves every selected row, from two categories, in one drop", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await toggleCategory(el, "f");
  await selectKeys(el, ["cola", "burger"]);
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  const table = await tableOf(el);
  pointerEvent(await nameCell(el, "cola"), "pointerdown");
  pointerEvent(await nameCell(el, "folder:b"), "pointermove");
  await list.updateComplete;
  for (const key of ["cola", "burger"])
    expect(
      table.shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.part.contains("dragging"),
      key,
    ).toBe(true);
  expect(list.shadowRoot!.querySelector('[data-test="drag-ghost"]')!.textContent!.trim()).toBe(
    "2 items",
  );
  pointerEvent(await nameCell(el, "folder:b"), "pointerup");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["cola", "burger"], categoryIds: [] },
      "b",
    ),
  );
  await vi.waitFor(() => expect(count(el)).toBe("0 selected"));
});

it("a selection holding a category and a product inside it moves the category alone, and the product goes with it", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await selectKeys(el, ["folder:d", "cola"]);
  drag(await nameCell(el, "cola"), await nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: [], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("Move to… with a category and something inside it selected sends the category alone", async () => {
  const el = await mountBrowser({ products: [...PRODUCTS, product("stout", "Stout", "b")] });
  await toggleCategory(el, "d");
  await toggleCategory(el, "b");
  await selectKeys(el, ["folder:d", "folder:b", "cola", "stout", "bread"]);
  await press(el, "move");
  expect(dialog(el)!.heading).toBe("Move 2 items");
  await destination(el, "f");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("dragging a row that is not selected moves only that row and keeps the selection", async () => {
  const el = await mountBrowser();
  await toggleCategory(el, "d");
  await selectKeys(el, ["cola"]);
  drag(await nameCell(el, "bread"), await nameCell(el, "folder:f"));
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledExactlyOnceWith(
      { productIds: ["bread"], categoryIds: [] },
      "f",
    ),
  );
  await el.updateComplete;
  expect(count(el)).toBe("1 selected");
});
```

Append inside the `describe.each` of `product-list.a11y.test.ts`:

```ts
  it("renders accessibly mid-drag", async () => {
    const { el, host } = await mountWidget<ProductList>(
      "dashboard-product-list",
      { products, categories: [{ id: "drinks", name: "Bebidas", parentId: null }] },
      theme,
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const at = (element: Element, type: string) => {
      const box = element.getBoundingClientRect();
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: box.x + 8,
          clientY: box.y + 8,
        }),
      );
    };
    const over = table.shadowRoot!.querySelector('tr[data-row-key="folder:drinks"] [part~="folder-cell"]')!;
    at(table.shadowRoot!.querySelector('[part~="product-cell"]')!, "pointerdown");
    at(over, "pointermove");
    await el.updateComplete;
    await expectNoA11yViolations(host);
    at(over, "pointercancel");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts -t "stays in place|hover delay|without stopping|on a product files|would land last|Esc cancels|where the drag started|two categories|inside it|not selected"`
Expected: FAIL — the whole file fails to load until `HOVER_OPEN_MS` exists: `SyntaxError: The requested module './product-list.js' does not provide an export named 'HOVER_OPEN_MS'`. Past that, the new cases fail on their own: the row moves under the pointer, no ghost, no gap, no hover-open, Esc does nothing, a category's contents are sent beside it, and a drop clears the whole selection.

- [ ] **Step 3: Implement**

`strings.ts`: `"folders.drag_count": "{count} items",` (en) and `"folders.drag_count": "{count} elementos",` (es).

`catalogue-browser.ts`: add

```ts
  /** A row inside a category that moves goes with it; listed as well, the server would re-file it
   * at the destination and pull it out of its category. */
  #outermost(selection: CatalogueSelection): CatalogueSelection {
    const under = (categoryId: string | null, self?: string) =>
      categoryId !== null &&
      selection.categoryIds.some(
        (id) => id !== self && categoryWithDescendants(id, this.categories).has(categoryId),
      );
    return {
      productIds: selection.productIds.filter(
        (id) => !under(this.products.find((product) => product.id === id)?.primaryCategoryId ?? null),
      ),
      categoryIds: selection.categoryIds.filter((id) => !under(id, id)),
    };
  }
```

In `#drop`, send `this.#outermost(this.#selection(keys))` instead of `this.#selection(keys)`, and replace `this.selected = [];` with `this.selected = this.selected.filter((key) => !keys.includes(key));`. In `#openMove`, `this.operationSelection = this.#selection(keys);` becomes `this.operationSelection = this.#outermost(this.#selection(keys));` (the dialog's count and its destination list follow). Delete keeps the whole selection: its consent already says what happens to a category's contents.

`product-list.ts`: add `state` to the `lit/decorators.js` import, and after `ROOT_KEY`:

```ts
/** How long a drag must rest on a closed category before it opens. */
export const HOVER_OPEN_MS = 600;
```

Replace the drag fields (`#dragged`, `#dropTarget`, `#pointerDrag`) with:

```ts
  #dragged: string[] = [];
  #pointerDrag: { pointerId: number; key: string; x: number; y: number; active: boolean } | null =
    null;
  /** The row a drop would file into — a category's key, or ROOT_KEY — while one is offered. */
  #target: string | undefined = undefined;
  #hover: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
  #pointer = { x: 0, y: 0 };
  @state() private ghost: { label: string; image: string | null; folder: boolean } | null = null;
```

Replace `disconnectedCallback`, `#clearDropTarget`, `#startDrag`, `#moveDrag`, `#endDrag` and `#dropFolder` (keep `#blockPostDragClick`) with:

```ts
  override disconnectedCallback(): void {
    if (this.#pointerDrag) this.#finishDrag();
    super.disconnectedCallback();
  }

  #startDrag(event: PointerEvent, key: string, grip: boolean): void {
    if (this.#pointerDrag || event.button !== 0) return;
    if (event.pointerType === "touch" && !grip) return;
    this.#pointerDrag = {
      pointerId: event.pointerId,
      key,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    document.addEventListener("pointermove", this.#moveDrag);
    document.addEventListener("pointerup", this.#endDrag);
    document.addEventListener("pointercancel", this.#endDrag);
    document.addEventListener("keydown", this.#dragKey, true);
  }

  readonly #moveDrag = (event: PointerEvent): void => {
    const drag = this.#pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = true;
      holdPageCursor();
      this.#dragged = this.selected.includes(drag.key) ? [...this.selected] : [drag.key];
      this.ghost = this.#ghostOf(this.#dragged);
      this.#send("drag-items", { keys: this.#dragged });
      void this.updateComplete
        .then(() => {
          this.#placeGhost();
          return this.#table()?.updateComplete;
        })
        .then(() => this.#paint());
    }
    this.#pointer = { x: event.clientX, y: event.clientY };
    this.#placeGhost();
    const over = pointerElementsAt(event.clientX, event.clientY).find(
      (item): item is HTMLElement => item instanceof HTMLElement && item.matches("tr[data-row-key]"),
    )?.dataset.rowKey;
    const target = over === undefined ? undefined : this.#dropTargetFor(over);
    const changed = target !== this.#target;
    this.#target = target;
    this.#hoverOpen(over);
    // The marks and the gap change only with the target, or when a branch opens (#hoverOpen).
    if (changed) this.#paint();
  };

  readonly #endDrag = (event: PointerEvent): void => {
    const drag = this.#pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const keys = this.#dragged;
    const target = this.#target;
    this.#finishDrag();
    if (!drag.active || event.type !== "pointerup") return;
    this.#blockNextClick(false);
    if (target !== undefined)
      this.#send("drop-items", { keys, folderId: target === ROOT_KEY ? null : target.slice(7) });
  };

  readonly #dragKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#pointerDrag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    this.#finishDrag();
    this.#blockNextClick(true);
  };

  /** A released drag still sends a click, which must not open the row it ends on. After Esc the
   * release comes later, so the block lasts until it. */
  #blockNextClick(untilRelease: boolean): void {
    document.addEventListener("click", this.#blockPostDragClick, true);
    const lift = () =>
      setTimeout(() => document.removeEventListener("click", this.#blockPostDragClick, true), 0);
    if (untilRelease) document.addEventListener("pointerup", lift, { once: true, capture: true });
    else lift();
  }

  #finishDrag(): void {
    const drag = this.#pointerDrag;
    document.removeEventListener("pointermove", this.#moveDrag);
    document.removeEventListener("pointerup", this.#endDrag);
    document.removeEventListener("pointercancel", this.#endDrag);
    document.removeEventListener("keydown", this.#dragKey, true);
    if (this.#hover) clearTimeout(this.#hover.timer);
    this.#hover = null;
    this.#pointerDrag = null;
    this.#target = undefined;
    this.#dragged = [];
    this.ghost = null;
    if (drag?.active) releasePageCursor();
    this.#paint();
    this.#send("drag-items", { keys: [] });
  }

  /** Over a category or All products a drop files into it; over a product or variant, into the
   * category that product is in. A drop that would move nothing is not offered. */
  #dropTargetFor(key: string): string | undefined {
    const row = this.#rowByKey.get(key);
    if (!row || row.kind === "draft") return undefined;
    const target =
      row.kind !== "product"
        ? row.key
        : row.variant === null
          ? row.parentKey
          : (this.#rowByKey.get(row.parentKey)?.parentKey ?? ROOT_KEY);
    if (!acceptsCatalogueDrop(this.#dragged, target === ROOT_KEY ? null : target.slice(7), this.categories))
      return undefined;
    return this.#dragged.some((dragged) => this.#rowByKey.get(dragged)?.parentKey !== target)
      ? target
      : undefined;
  }

  #hoverOpen(over: string | undefined): void {
    const table = this.#table();
    const closed =
      table !== null &&
      over !== undefined &&
      over === this.#target &&
      over.startsWith("folder:") &&
      !table.isExpanded(over);
    if (closed && this.#hover?.key === over) return;
    if (this.#hover) clearTimeout(this.#hover.timer);
    this.#hover = null;
    if (!closed || table === null || over === undefined) return;
    this.#hover = {
      key: over,
      timer: setTimeout(() => {
        this.#hover = null;
        if (!this.#pointerDrag?.active) return;
        table.setExpanded(over, true);
        void table.updateComplete.then(() => this.#paint());
      }, HOVER_OPEN_MS),
    };
  }

  /** The table re-renders rows in place as a branch opens, so the marks are set again by key. */
  #paint(): void {
    const root = this.#table()?.shadowRoot;
    if (!root) return;
    for (const name of ["dragging", "drop-target", "drop-gap-before", "drop-gap-after"])
      for (const element of root.querySelectorAll(`[part~="${name}"]`)) element.part.remove(name);
    if (!this.#pointerDrag?.active) return;
    const rowOf = (key: string) =>
      root.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
    for (const key of this.#dragged) rowOf(key)?.part.add("dragging");
    if (this.#target === undefined) return;
    rowOf(this.#target)?.querySelector("td")?.part.add("drop-target");
    const gap = this.#gap(this.#target);
    if (!gap) return;
    for (const cell of rowOf(gap.key)?.querySelectorAll(":scope > td") ?? [])
      cell.part.add(gap.side === "before" ? "drop-gap-before" : "drop-gap-after");
  }

  /** Where the first dragged row would land among the target's children, in the table's sort order:
   * products and categories have no order of their own. */
  #gap(target: string): { key: string; side: "before" | "after" } | undefined {
    const table = this.#table()!;
    const root = table.shadowRoot!;
    const moving = this.#rowByKey.get(this.#dragged[0]!);
    if (!moving || !table.isExpanded(target)) return undefined;
    const shown = (key: string) =>
      root.querySelector(`tr[data-row-key="${CSS.escape(key)}"]`) !== null;
    const siblings = [...this.#rowByKey.values()].filter(
      (row) => row.parentKey === target && !this.#dragged.includes(row.key) && shown(row.key),
    );
    const order = table.sortedSiblings([...siblings, moving]);
    const next = order[order.indexOf(moving) + 1];
    if (next) return { key: next.key, side: "before" };
    const rows = [...root.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")];
    const at = rows.findIndex((row) => row.dataset.rowKey === target);
    if (at === -1) return undefined;
    const level = Number(rows[at]!.getAttribute("aria-level"));
    let last = at;
    while (last + 1 < rows.length && Number(rows[last + 1]!.getAttribute("aria-level")) > level)
      last++;
    return { key: rows[last]!.dataset.rowKey!, side: "after" };
  }

  #ghostOf(keys: readonly string[]): { label: string; image: string | null; folder: boolean } {
    const first = this.#rowByKey.get(keys[0]!);
    const name =
      first?.kind === "folder" ? first.folder.name : first?.kind === "product" ? first.product.name : "";
    return {
      label: keys.length > 1 ? t("folders.drag_count").replace("{count}", String(keys.length)) : name,
      image: first?.kind === "product" ? first.product.image : null,
      folder: first?.kind === "folder",
    };
  }

  #placeGhost(): void {
    this.renderRoot
      .querySelector<HTMLElement>(".drag-ghost")
      ?.style.setProperty("transform", `translate(${this.#pointer.x}px, ${this.#pointer.y}px)`);
  }
```

In `#pointerDown`, the last line becomes `this.#startDrag(event, listed.key, grip);` (the `row` argument goes).

At the end of `render`'s template, after `</wt-data-table>`, add:

```ts
${
      this.ghost
        ? html`<div class="drag-ghost" data-test="drag-ghost" aria-hidden="true">
            ${
              this.ghost.image
                ? html`<img src=${`/media/${this.ghost.image}`} alt="" draggable="false" />`
                : this.ghost.folder
                  ? html`<wt-icon name="folder"></wt-icon>`
                  : html`<span class="ghost-thumb"></span>`
            }<span>${this.ghost.label}</span>
          </div>`
        : nothing
    }
```

In the styles, replace the `drop-target` and `dragging` part rules with:

```css
      wt-data-table::part(dragging) {
        opacity: var(--wt-opacity-disabled);
      }
      wt-data-table::part(drop-target) {
        border-inline-start: var(--wt-selected-ring);
      }
      wt-data-table::part(drop-gap-before) {
        padding-block-start: calc(var(--wt-space-3) + var(--wt-tap-min));
        border-block-start: var(--wt-field-line-width-active) dashed var(--wt-color-primary);
      }
      wt-data-table::part(drop-gap-after) {
        padding-block-end: calc(var(--wt-space-3) + var(--wt-tap-min));
        border-block-end: var(--wt-field-line-width-active) dashed var(--wt-color-primary);
      }
      /* Placed by a transform from the pointer's own coordinates, which are physical. */
      .drag-ghost {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: var(--wt-space-3) 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-lifted);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
        pointer-events: none;
      }
      .drag-ghost img,
      .ghost-thumb {
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        border-radius: var(--wt-radius-md);
        object-fit: cover;
        background: var(--wt-color-surface);
      }
```

- [ ] **Step 4: Run every touched file**

Run: `pnpm --filter @waitron/dashboard exec vitest run --project browser src/widgets/catalogue-browser.test.ts src/widgets/catalogue-browser.a11y.test.ts src/widgets/product-list.test.ts src/widgets/product-list.a11y.test.ts`
Expected: PASS. Unchanged and still passing: "drags the whole selected group and clears selection after moving", "a small pointer movement stays a click rather than lifting the row", "shows a refused drop at the bottom and keeps the selection for correction", "real pointer drag moves a product into a folder", "drags a product outside the selection alone and never offers a variant as a drag source", "ignores a right-button press on a product name", "keeps touch scrolling on the name cell and starts a drag from its grip".

- [ ] **Step 5: Prove two guards by deletion**

Delete the `return this.#dragged.some(…) ? target : undefined;` check (return `target`) and rerun "a drop where the drag started": FAIL. Restore. Change `#blockNextClick(true)` in `#dragKey` to `#blockNextClick(false)` and rerun "Esc cancels a drag": it FAILS on its row list — expected `["folder:d", "folder:f", "bread"]`, received `["folder:d", "folder:f", "burger", "bread"]` — because the block was lifted during the awaited task and the click opened Food. Restore both with undo.

- [ ] **Step 6: Docs**

In `docs/developers/product-categories.md`, replace "On a pointer device you can drag a product, folder or selection onto a folder or breadcrumb." with:

```markdown
On a pointer device you can drag a product, a category, or in Select mode every selected row,
onto a category, onto a product (to file beside it) or onto **All products** (to file in no
category). The row stays in place, faded, while a copy follows the pointer; the target shows a bar
on its left edge and a dashed gap where the row will land in the current sort; a closed category
opens after `HOVER_OPEN_MS` (600 ms, `apps/dashboard/src/widgets/product-list.ts`) of hovering.
Esc, or a drop where the drag started, moves nothing.
```

- [ ] **Step 7: Typecheck, lint, format, guards, commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm exec eslint apps/dashboard/src && pnpm exec prettier --check apps/dashboard/src && pnpm exec vitest run scripts/style-token-names.test.ts`

```bash
git add apps/dashboard/src docs/developers/product-categories.md
git commit -s -m "Dragging on the Products screen shows where a row will land

The dragged row stays in place, faded, while a copy follows the pointer. The target category gets
a bar on its left edge and a dashed gap opens where the row will land in the current sort; a
closed category opens after 600 ms of hovering (HOVER_OPEN_MS). Dropping on All products takes a
row out of every category. Esc, or a drop where the drag started, moves nothing. In Select mode,
dragging a selected row moves every selected row, from any categories; dragging an unselected
row moves it alone and keeps the selection."
```

---

## Task 11: Backlog, the remaining docs, and the look

**Files:**
- Modify: `docs/backlog.md` (the A205 and A208 entries)
- Modify: `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md` (one dated pointer)
- Modify: any further doc the sweep in Step 1 finds

**Interfaces:** none.

- [ ] **Step 1: Bring `docs/developers/product-categories.md` in line with the screen**

Tasks 6 and 10 rewrote its screen paragraph and its drag sentence; the rest of the file still describes folders and the old screen. Make these edits, keeping every route path (`/management-api/folders/…`), error code, column and file name exactly as they are — those are names, not words on the screen:

- Title: `# Product folders` → `# Product categories`.
- The opening paragraph: "organise products into folders" → "organise products into categories"; "Each folder is a reporting category with one internal name" → "Each category is a reporting category with one internal name, shown on the Products screen as a row of its tree"; "A product belongs to at most one folder; an unfiled product appears at the top level." → "A product belongs to at most one category; one in none sits directly under **All products**."
- "A folder has at most one parent … A product's folder is … which is not a folder row you can rename or delete." → "category" for each "folder".
- The red-asterisk paragraph: "beside a folder", "covers the folder or its parent folders", "covers the folder" → "category" / "parent categories".
- "renaming a folder does not rewrite recorded sale lines" → "renaming a category …"; "walk a product's folder ancestors, using the nearest claimed folder" → "category ancestors … nearest claimed category".
- "In the browser, variants sit under their product" → "In the tree, variants sit under their product".
- Under "Moving and deleting": "tick products and folders" → "tick products and categories"; "Pick a destination folder or" → "Pick a destination category or"; "A selected folder and its descendants" → "A selected category and its descendants"; after "Touch and keyboard users use the same selection actions." add "A selection holding a category and something inside it moves the category alone; its contents go with it."
- Replace "Navigating, searching or changing a filter clears the selection, so actions do not reach items you have hidden." with "Searching or changing a filter clears the selection, so actions do not reach items you have hidden. Opening or closing a category keeps it, so a selection can span categories; a selected row inside a closed category is still selected."
- "while the folder summary is being read" → "while the category summary is being read"; "Before deleting a non-empty folder" → "non-empty category"; "**Move it up to the parent folder** keeps the products active and moves the folder's direct products and subfolders to its parent. For a top-level folder they move to the top level." → "**Move it up to the parent category** keeps the products active and moves the category's direct products and subcategories to its parent. For a top-level category they move to **All products**."; "numbers of subfolders, products and routing rules removed (folder claims and exceptions)" → "subcategories … (category claims and exceptions)"; "An empty folder is deleted without confirmation. A folder's row-menu Delete uses the same path." → "category" twice; "Deleting a folder removes its station claim" → "Deleting a category …"; "after changing the folder tree" → "after changing the category tree".
- Under "API", the prose (not the routes): "`to` is a folder ID or null" → "a category ID or null"; "move two products and a folder together" → "and a category together"; "a missing folder is `category.not_found`" → "a missing category is …"; "a folder move into itself or its descendants" → "a category move …"; "Folder-summary counts" → "Category-summary counts"; "folder selection operations above" → "category selection operations above"; "dropped by the folder migrations" and "The folder migration does not convert" stay — they name the migrations by what they were called — and "The folder move/delete tests in `packages/catalogue/src/catalogue-items.db.test.ts`" stays.

Then sweep the rest of the tree for claims the change retired (patterns quoted, since zsh expands an unquoted glob):

Run: `grep -rn -i "breadcrumb\|New folder\|Folders / All products\|view=all\|folder=\|emptyAction\|open-folder\|view-change\|pointer-drag\|subfolder" docs apps/dashboard/src packages/ui/src --include='*.md' --include='*.ts' | grep -v "docs/superpowers/plans/2026-10-02\|docs/superpowers/specs/2026-10-02"`
and: `grep -n -i "folder" docs/developers/product-categories.md`
Expected: the first prints no line about the Products screen (a dated spec or plan gets a pointer, as in Step 2, never a rewrite); the second prints only route paths, the migration and test names listed above, and nothing that describes the screen. Fix whatever else either prints, in the file it is in.

- [ ] **Step 2: The dated pointer**

In `docs/superpowers/specs/2026-09-30-catalogue-menus-routing-design.md`, under the bullet beginning "- **Folder view.**", add:

```markdown
  > 2026-10-02: the folder view became a category tree; see
  > [2026-10-02-products-category-tree-design.md](2026-10-02-products-category-tree-design.md).
```

- [ ] **Step 3: The backlog**

After the PR exists (`/finish-branch` opens it), read its number with `gh pr view --json number -q .number`. In `docs/backlog.md`, replace the A205 paragraph ("**Clicking a product's row on the Products screen opens it (A205, …") with one line:

```markdown
**Clicking a product's row on the Products screen opens it (A205) — DONE in A208 (#N).**
```

and the A208 paragraph ("**The Products screen as a category tree (A208, …") with:

```markdown
**The Products screen as a category tree (A208) — DONE (#N).** Spec
[2026-10-02-products-category-tree-design.md](superpowers/specs/2026-10-02-products-category-tree-design.md);
plan [2026-10-02-products-category-tree.md](superpowers/plans/2026-10-02-products-category-tree.md).
```

with `N` the number `gh` printed.

- [ ] **Step 4: Look at it**

Start the dev stack from the worktree: `wa-wt demo feat-products-category-tree` (the worktree's name as `worktree.py` printed it). Enrol the till only if a screen needs it (it does not). Open `/manage/catalogue`, and with the demo venue's categories make one three levels deep if it has none (Add category on a category, twice). At **1280** and at **390** px wide, in **light** and **dark**, in **English** and **Spanish** (the account menu's language), look at, and save a screenshot of:

1. the tree three levels deep, every level open (Expand all), Main category column shown;
2. the empty screen: a fresh demo with every product and category deleted (`wa-wt reset demo <name>` restores it afterwards), showing All products with its menu open and nothing focused;
3. a drag of a product over a closed category, held until it opens: faded origin, lifted copy, left bar, dashed gap;
4. Add category's name box on a new row with a refusal under it — type the name of a category that already exists beside it and press Enter (if the server accepts duplicates, rename a category to an empty-after-trim name of spaces instead, which the box treats as a cancel, and say in the PR that no refusal could be produced by hand);
5. the price column: "each" and "/ kg" after the amounts, quieter than the amount;
6. the filters: "Any ordering" / "Cualquier pedido por separado".

Check at 390 that the ⋮ column stays at the right edge on every row, that a row four levels deep is indented no further than one three levels deep, and that the toolbar wraps without sideways page scroll. Put the screenshots in the PR. Anything wrong goes back to the task that owns it, with a test.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -s -m "Backlog: the Products screen as a category tree is done (A208), and with it A205"
```

Then tell the owner the branch is ready for `/finish-branch`, passing the worktree path and this plan.

---

## Existing assertions this plan changes — summary for the PR

**Approved by the spec (§8: breadcrumb, switch, header Add product, New folder, folder-at-a-time listing, the word "folder")**

- `apps/dashboard/src/widgets/catalogue-browser.test.ts`:
  - words: "marks only folders without an active own or inherited routing claim and clears the mark when claimed" (also its `folderId` setup), "shows folder contents and routes, defaults to moving up, and sends delete choice", "counts overlapping selected folders once in the delete consent";
  - deleted: "finds a breadcrumb under a captured touch pointer", "refuses a dragged folder's ancestor or current breadcrumb when it is inside that folder", "lists all products with paths and no breadcrumb in all view" (Task 8 adds Expand all), "emits breadcrumb navigation and view changes";
  - replaced: "moves a product to the top level through the first breadcrumb" (the same move through All products, Task 6), "shows only direct children and breadcrumbs inside a folder", "keeps folders through both product filters", "falls back to the top level for a missing folder", "searches globally and restores the previous folder when cleared", "emits folder navigation once and offers accessible folder actions", "a folder click still opens it without starting a drag", "a drag ending on a folder's button does not also open it", "shows the path only in global views and leaves folder product cells empty", "creates a folder under the current folder and closes after save", "renames a root folder without adopting the current folder" (same API call asserted), "keeps a refused folder save open with a field error", "creates a top-level folder when the addressed folder is missing";
  - expected row lists: "searches folder paths and product variant names", "keeps a variant match on its parent until the manager expands it";
  - lists and props: "leaves selection mode on Cancel and restores the ordinary toolbar with no selected keys", "clears selection on %s and keeps selection mode on" (folder and view cases go), "confirms %i product deletion with inactive and sales wording" (`view` prop).
- `apps/dashboard/src/widgets/catalogue-browser.a11y.test.ts`: the `folder`, `all` and `form` states become `open` and `naming`.
- `apps/dashboard/src/screens/catalogue-screen.test.ts`: "reads and writes folder paths and passes the folder to new products" (replaced), "creates an unfiled product when the addressed folder no longer exists" (deleted; its point is in "files a new product in the category whose menu added it, and in none for a category that is gone"), "draws no Add product button in the product table once it lists something" (replaced by "draws the title alone in the header").

**For the owner (forced by the spec's design, but in no class §8 names)**

- Spec §3, the empty table's box and Add button:
  - `catalogue-browser.test.ts`: "draws its screen's empty action in an empty folder, and not when a search finds nothing" (deleted); "says the dashboard's one no-matches sentence when its search finds nothing, and its own sentence in an empty folder (%s)" (its empty-folder half goes); "says the dashboard's one no-matches sentence when a column filter hides every product" (All products and the categories stay, so no sentence shows).
  - `catalogue-screen.test.ts`: "puts Add product under the empty product table's sentence, opening the same editor", "keeps the empty table's Add product disabled exactly while the header's is", "returns focus to the header's Add product after the first product is made from the empty table", "returns focus to the empty table's Add product after Cancel" — each deleted, with the replacement Task 7 or Task 9 names.
- Spec §1, the All products row's ⋮: `product-list.test.ts` "keeps every product row's menu on screen and uncovered at 390 px while the other columns scroll sideways (%s)" counts 3 menus, not 2.
- Spec §1, the unit after every price: `product-list.test.ts` "prices a variant with no price of its own at its product's price", "prices a product across its Active variants only, or at its own price when it has none" and "notes a variant's VAT under its price only where it differs from its product's" read the amount's own span instead of the whole cell (each amount unchanged; the new unit cases assert the whole cell).
- Spec §4, the drag's look: `catalogue-browser.test.ts` "moves a dragged product into a folder" (the row's `translateY` and the marker on the name cell); "finds a folder under a captured touch pointer", "a cancelled pointer over a valid folder does not move the product" and "refuses a folder over itself or its descendants but highlights a sibling" read the marker on the row's first cell.

**Setup only (assertion unchanged)**

- `product-list.test.ts`: the row helpers skip the All products row; "shows the main category, attached modifier list names, and no VAT or labels column" and "shows a variant's own name, its effective price and main category" open their category first.
- `product-list.a11y.test.ts`: "renders accessibly with the row action menu open" opens the product's menu by its `data-test`, since the first menu in the table is now All products' (which gets its own state); the file clears local storage between cases.
- `catalogue-browser.test.ts`: "selects folders and products but never variants" opens Drinks first; "real pointer drag moves a product into a folder" drags by the rows' activator corners; "refuses a folder over itself…" moves the pointer over the search box.
- `catalogue-screen.test.ts` and `catalogue-screen.a11y.test.ts` clear local storage after each case; "creates the complete aggregate once, closes, then refreshes the list", "creates a related unit without replacing the dirty parent draft", the Add to menus step's `create` helper, and "renders the Add to menus step that follows a create accessibly" start the add with the menus' `add-product` event.

---

## Self-review

**Spec coverage** — §1 header (Task 7), one toolbar (Task 8), filters wording (Task 4), the tree and All products row (Tasks 1, 6), category menu (Task 7), product rows and variants (Task 6), unrouted marker kept (Task 6 cell), clicks (Tasks 2, 6, 7), search (Tasks 3, 6), prices with units (Task 5). §2 Add product (Task 7), Add category and Rename (Task 9), category form kept for the editor (Task 9 Step 8). §3 empty screen (Task 9). §4 drag (Task 10), drop on All products (Task 6), touch from the grip only (Task 6 `#pointerDown`), several at once (Task 10), a category moving with its contents for a drag and for Move to… (Task 10, `#outermost`). §1 "a drag that ends where it started opens nothing" (Task 7, "opens nothing when a drag of a product is released on its own row"). §5 words (Tasks 4, 6–10 strings). §6.1 remembered (Tasks 3, 6), §6.2 Expand all (Tasks 3, 8), §6.3 `category=` (Task 6), §6.4 phone width (Tasks 2, 7), §6.5 Select mode without All products (Task 6 `rowSelectable`). §7 table changes with their own tests (Tasks 1–3). §8 every listed test (the tasks above), LOOK (Task 11), review path (Global Constraints).

**Placeholder scan** — no step defers code; the PR number in Task 11 is read with a stated command after the PR exists.

**Type consistency** — `ROOT_KEY`, `HOVER_OPEN_MS`, `CategoryNameDraft`, `ListRow` (`RootRow | CategoryRow | ProductRow | DraftRow`), `#rowByKey`, `#table()`, `#send`, `revealCategory`, `revealProduct`, `focusRowMenu`, `canAddProduct`, `nameDraft`, `nameError`, `loaded`, `search`, `units`, `unitLanguage`, `categoryId`; events `category-toggle`, `open-category`, `add-product`, `add-category`, `move-folder`, `rename-folder`, `delete-folder`, `name-commit`, `name-cancel`, `drag-items`, `drop-items`, `edit-product`; table API `rowGroup`, `rowCollapsible`, `rowActivation`, `searchTerm`, `expandAllLabel`, `collapseAllLabel`, `rememberExpanded`, `isExpanded`, `setExpanded`, `sortedSiblings`, `revealRow`, `searchOpensPath`, `wt-expand-change`; private helpers `#count`/`#counts`, `#outermost`, `#paint`, `#gap` — each is introduced once and used with the same name and shape after. `#dropFolder` takes `string | null` from Task 6 on; Task 10 removes it with the rest of the old drag.

**Defaults kept** — the table's new search rule is off unless `searchOpensPath` is set, so the menus Prices table keeps its behaviour; Tasks 1–3 run `menu-prices-table.test.ts` to show it.

**Review Focus** — each of the five lines has its test: crossing a category (Task 10, "leaves a closed category closed…"), Enter twice (Task 9, "makes one category from Enter pressed twice…"), Add category during a search (Task 9, "Add category clears a typed search…"), 390 px three deep (Task 7, "keeps every row's menu on screen…"), refused rename then Esc (Task 9, "keeps the old name…").

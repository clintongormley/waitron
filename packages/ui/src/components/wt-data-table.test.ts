import { html } from "lit";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

type Row = { id: string; name: string; count: number };

const rows: Row[] = [
  { id: "b", name: "Bea", count: 2 },
  { id: "a", name: "Ada", count: 10 },
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
  { key: "count", label: "Count", cell: (row) => row.count, sortValue: (row) => row.count },
  {
    key: "action",
    label: "Actions",
    cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
  },
];

function rowText(table: WtDataTable<Row>): string[] {
  return [...table.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.textContent!.replace(/\s+/g, ""),
  );
}

async function table(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id, ...props });
  await el.updateComplete;
  return el;
}

test("renders native table semantics and consumer-provided cells", async () => {
  const el = await table();
  const native = el.shadowRoot!.querySelector("table")!;
  expect(el.shadowRoot!.querySelector("[role=region]")!.getAttribute("aria-label")).toBe("Users");
  expect([...native.querySelectorAll("th")].map((cell) => cell.textContent?.trim())).toEqual([
    "Name",
    "Count",
    "Actions",
  ]);
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
  expect(native.querySelector('button[aria-label="Edit Bea"]')).not.toBeNull();
});

test("updates its accessible name when the host label changes", async () => {
  const el = await table();
  el.setAttribute("aria-label", "Devices");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[role=region]")!.getAttribute("aria-label")).toBe("Devices");
});

test("sorts without mutating the consumer's rows and toggles the direction", async () => {
  const input = [...rows];
  const el = await table({ rows: input });
  const name = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!;
  name.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
  expect(name.closest("th")!.getAttribute("aria-sort")).toBe("ascending");
  name.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
  expect(name.closest("th")!.getAttribute("aria-sort")).toBe("descending");
  expect(input).toEqual(rows);
});

test("sorts numbers numerically", async () => {
  const el = await table();
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="count"]')!.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Bea2Edit", "Ada10Edit"]);
});

test("applies the sortKey and sortDirection defaults on first render", async () => {
  const el = await table({ sortKey: "name", sortDirection: "ascending" });
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]); // Ada before Bea
});

test("emits wt-sort-change when a header is clicked", async () => {
  const el = await table();
  const events: { sortKey: string | null; sortDirection: string }[] = [];
  el.addEventListener("wt-sort-change", (e) => events.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(events).toEqual([{ sortKey: "name", sortDirection: "ascending" }]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(events).toEqual([
    { sortKey: "name", sortDirection: "ascending" },
    { sortKey: "name", sortDirection: "descending" },
  ]);
});

test("a header click is stopped at the table, so only wt-sort-change reaches the host", async () => {
  const el = await table();
  const clicks = vi.fn();
  const sorts = vi.fn();
  el.addEventListener("click", clicks);
  el.addEventListener("wt-sort-change", sorts);
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!.click();
  expect(sorts).toHaveBeenCalledOnce();
  expect(clicks).not.toHaveBeenCalled();
});

test("descending default sorts the other way", async () => {
  const el = await table({ sortKey: "count", sortDirection: "descending" });
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]); // 10 before 2
});

test("renders loading, error and empty states supplied by the consumer", async () => {
  const loading = await table({ loading: true, loadingMessage: "Loading users" });
  expect(loading.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
    "Loading users",
  );
  expect(loading.shadowRoot!.querySelector("table")).toBeNull();

  const failed = await table({ errorMessage: "Could not load users" });
  expect(failed.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
    "Could not load users",
  );
  expect(failed.shadowRoot!.querySelector("table")).toBeNull();

  const empty = await table({ rows: [], emptyMessage: "No users" });
  expect(empty.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain("No users");
  expect(empty.shadowRoot!.querySelector("table")).toBeNull();
});

test("keeps the table in a horizontally scrollable region", async () => {
  const el = await table();
  const region = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(getComputedStyle(region).overflowX).toBe("auto");
  expect(region.tabIndex).toBe(0);
});

test("shows no selection checkboxes unless selectable", async () => {
  const el = await table();
  expect(el.shadowRoot!.querySelector("[data-test=select-all]")).toBeNull();
  expect(el.shadowRoot!.querySelector("input[type=checkbox]")).toBeNull();
});

test("renders a checkbox per row and a select-all header when selectable", async () => {
  const el = await table({ selectable: true });
  expect(el.shadowRoot!.querySelector("[data-test=select-all]")).toBeTruthy();
  expect(el.shadowRoot!.querySelectorAll("tbody input[type=checkbox]").length).toBe(2);
});

test("reflects the selected keys and adds a row on toggle", async () => {
  const el = await table({ selectable: true, selected: ["a"] });
  expect(el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-a]")!.checked).toBe(
    true,
  );
  expect(el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-b]")!.checked).toBe(
    false,
  );
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-b]")!.click();
  expect(seen.at(-1)).toEqual(["a", "b"]);
});

test("removes a row from the selection on toggle", async () => {
  const el = await table({ selectable: true, selected: ["a", "b"] });
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-a]")!.click();
  expect(seen.at(-1)).toEqual(["b"]);
});

test("select-all selects every visible row, then clears them", async () => {
  const el = await table({ selectable: true, selected: [] });
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  const all = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  all.click();
  expect([...seen.at(-1)!].sort()).toEqual(["a", "b"]);
  el.selected = ["a", "b"];
  await el.updateComplete;
  all.click();
  expect(seen.at(-1)).toEqual([]);
});

test("select-all is indeterminate when only some rows are selected", async () => {
  const el = await table({ selectable: true, selected: ["a"] });
  const all = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  expect(all.indeterminate).toBe(true);
  expect(all.checked).toBe(false);
});

type TreeRow = { id: string; parent: string | null; name: string };
const treeRows: TreeRow[] = [
  { id: "food", parent: null, name: "Food" },
  { id: "break", parent: "food", name: "Breakfast" },
  { id: "eggs", parent: "break", name: "Eggs" },
  { id: "drinks", parent: null, name: "Drinks" },
];
const treeColumns: DataTableColumn<TreeRow>[] = [
  { key: "name", label: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
];
async function treeTable(props: Partial<WtDataTable<TreeRow>> = {}): Promise<WtDataTable<TreeRow>> {
  const el = (await mount(
    '<wt-data-table aria-label="Categories"></wt-data-table>',
  )) as WtDataTable<TreeRow>;
  Object.assign(el, {
    rows: treeRows,
    columns: treeColumns,
    rowKey: (r: TreeRow) => r.id,
    rowParent: (r: TreeRow) => r.parent,
    ...props,
  });
  await el.updateComplete;
  return el;
}

test("tree mode nests children under parents in order", async () => {
  const el = await treeTable();
  const keys = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) =>
    r.getAttribute("data-row-key"),
  );
  expect(keys).toEqual(["food", "break", "eggs", "drinks"]);
});

test("tree mode sets treegrid semantics and aria-level", async () => {
  const el = await treeTable();
  expect(el.shadowRoot!.querySelector("table")!.getAttribute("role")).toBe("treegrid");
  const rowFor = (key: string) => el.shadowRoot!.querySelector(`tbody tr[data-row-key="${key}"]`)!;
  expect(rowFor("food").getAttribute("aria-level")).toBe("1");
  expect(rowFor("eggs").getAttribute("aria-level")).toBe("3");
  expect(rowFor("food").getAttribute("aria-expanded")).toBe("true");
  expect(rowFor("eggs").hasAttribute("aria-expanded")).toBe(false); // leaf
});

test("collapsing a branch hides its descendants and flips aria-expanded", async () => {
  const el = await treeTable();
  const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tbody tr[data-row-key="break"] button.tree-toggle',
  )!;
  toggle.click();
  await el.updateComplete;
  const keys = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) =>
    r.getAttribute("data-row-key"),
  );
  expect(keys).toEqual(["food", "break", "drinks"]); // eggs hidden
  expect(
    el.shadowRoot!.querySelector('tbody tr[data-row-key="break"]')!.getAttribute("aria-expanded"),
  ).toBe("false");
});

test("collapsing a node with grandchildren hides all descendants recursively", async () => {
  const el = await treeTable();
  const toggle = el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tbody tr[data-row-key="food"] button.tree-toggle',
  )!;
  toggle.click();
  await el.updateComplete;
  const keys = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) =>
    r.getAttribute("data-row-key"),
  );
  expect(keys).toEqual(["food", "drinks"]); // break AND its child eggs both hidden
  expect(
    el.shadowRoot!.querySelector('tbody tr[data-row-key="food"]')!.getAttribute("aria-expanded"),
  ).toBe("false");
});

test("sorting orders siblings within their parent, not the whole list, in both directions", async () => {
  const rows: TreeRow[] = [
    { id: "food", parent: null, name: "Food" },
    { id: "z", parent: "food", name: "Zebra" },
    { id: "a", parent: "food", name: "Apple" },
    { id: "drinks", parent: null, name: "Drinks" },
  ];
  const el = await treeTable({ rows });
  const sortButton = el.shadowRoot!.querySelector<HTMLButtonElement>("th button.sort")!;
  const keys = () =>
    [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key"));

  sortButton.click();
  await el.updateComplete;
  expect(keys()).toEqual(["drinks", "food", "a", "z"]); // top level sorted; a,z sorted under food

  sortButton.click();
  await el.updateComplete;
  expect(keys()).toEqual(["food", "z", "a", "drinks"]); // top level reversed; z,a reversed under food
});

test("a row whose parent is absent renders at the top level", async () => {
  const el = await treeTable({ rows: [{ id: "eggs", parent: "missing", name: "Eggs" }] });
  const row = el.shadowRoot!.querySelector('tbody tr[data-row-key="eggs"]')!;
  expect(row.getAttribute("aria-level")).toBe("1");
});

// Nesting and selection arrived from two different branches and were merged by hand, so they are
// checked together as well as apart: a checkbox at every depth, a nested row's own key on the
// event, and select-all counting the rows a collapsed branch has hidden as not there.
test("tree mode and selection work together, and collapsing takes rows out of select-all", async () => {
  const el = await treeTable({ selectable: true, selected: [] });
  const boxKeys = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]")].map(
      (box) => box.dataset.test!.replace("select-", ""),
    );
  expect(boxKeys()).toEqual(["food", "break", "eggs", "drinks"]);

  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  // "eggs" is two levels down; its checkbox must report its own key, not its ancestor's.
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-eggs]")!.click();
  expect(seen.at(-1)).toEqual(["eggs"]);

  el.selected = [];
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tbody tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(boxKeys()).toEqual(["food", "drinks"]); // break and eggs are hidden, so are their boxes
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect([...seen.at(-1)!].sort()).toEqual(["drinks", "food"]);
});

test("a filtered tree keeps a match's ancestor chain and marks it ancestor-only", async () => {
  const treeRows: TreeRow[] = [
    { id: "food", parent: null, name: "Food" },
    { id: "break", parent: "food", name: "Breakfast" },
    { id: "eggs", parent: "break", name: "Eggs" },
  ];
  const seen: Record<string, boolean> = {};
  const el = (await mount(
    '<wt-data-table aria-label="Cats"></wt-data-table>',
  )) as WtDataTable<TreeRow>;
  Object.assign(el, {
    rows: treeRows,
    rowKey: (r: TreeRow) => r.id,
    rowParent: (r: TreeRow) => r.parent,
    searchable: true,
    columns: [
      {
        key: "name",
        label: "Name",
        searchValue: (r: TreeRow) => r.name,
        cell: (r: TreeRow, ctx: { ancestorOnly: boolean }) => {
          seen[r.id] = ctx.ancestorOnly;
          return r.name;
        },
      },
    ],
  });
  await el.updateComplete;
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "eggs";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  // Eggs matches; Food and Breakfast are kept only to hold Eggs' place.
  expect(Object.keys(seen).sort()).toEqual(["break", "eggs", "food"]);
  expect(seen.eggs).toBe(false);
  expect(seen.food).toBe(true);
  expect(seen.break).toBe(true);
});

test("searchable renders a search box that narrows rows", async () => {
  const el = await table({
    searchable: true,
    searchLabel: "Search users",
    columns: [
      {
        key: "name",
        label: "Name",
        cell: (r: Row) => r.name,
        sortValue: (r: Row) => r.name,
        searchValue: (r: Row) => r.name,
      },
      { key: "count", label: "Count", cell: (r: Row) => r.count },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  expect(input.getAttribute("aria-label")).toBe("Search users");
  input.value = "ad";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10"]);
  expect(el.shadowRoot!.querySelector(".table-filters")).toBeNull();
});

test("the search box shows its label as the placeholder unless a placeholder is given", async () => {
  const el = await table({ searchable: true, searchLabel: "Search products" });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  expect(input.placeholder).toBe("Search products");
  el.searchPlaceholder = "Name or code";
  await el.updateComplete;
  expect(input.placeholder).toBe("Name or code");
});

test("no toolbar is rendered when there is neither a search box nor a filter", async () => {
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
  // The toolbar must survive the no-match branch, or the search box vanishes the moment a term
  // clears every row and the person cannot edit or clear it.
  expect(el.shadowRoot!.querySelector(".table-toolbar")).not.toBeNull();
});

test("search matches a column that exposes only a sortValue", async () => {
  // The name column has neither searchValue nor sortValue, so it contributes nothing; count has a
  // sortValue but no searchValue, exercising the String(sortValue(row) ?? "") fallback branch.
  const el = await table({
    searchable: true,
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name },
      { key: "count", label: "Count", cell: (r: Row) => r.count, sortValue: (r: Row) => r.count },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "10";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10"]);
});

type RowS = { id: string; name: string; status: string };
// Active rows carry "Active" in their name so a narrowed set can be asserted on visible text while
// the filter still matches the lowercase status value the dropdown option carries.
const rowsS: RowS[] = [
  { id: "1", name: "Ada Active", status: "active" },
  { id: "2", name: "Bea Inactive", status: "off" },
];
const withStatus: DataTableColumn<RowS>[] = [
  { key: "name", label: "Name", cell: (r: RowS) => r.name, searchValue: (r: RowS) => r.name },
  {
    key: "status",
    label: "Status",
    cell: (r: RowS) => r.status,
    filter: {
      label: "Filter by status",
      allLabel: "Any status",
      value: (r: RowS) => r.status,
      options: [
        { value: "active", label: "Active" },
        { value: "off", label: "Inactive" },
      ],
    },
  },
];
function rowKeysS(el: WtDataTable<RowS>): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) =>
    r.getAttribute("data-row-key"),
  );
}
function rowTextS(el: WtDataTable<RowS>): string[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.textContent!.trim());
}
async function tableS(props: Partial<WtDataTable<RowS>> = {}): Promise<WtDataTable<RowS>> {
  const el = (await mount(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<RowS>;
  Object.assign(el, { rows: rowsS, rowKey: (r: RowS) => r.id, ...props });
  await el.updateComplete;
  return el;
}

test("renders one dropdown per filtered column and narrows on selection", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
  expect([...select.options].map((o) => o.textContent!.trim())).toEqual([
    "Any status",
    "Active",
    "Inactive",
  ]);
  select.value = "active";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowTextS(el).every((t) => t.includes("Active"))).toBe(true);
});

test("filter dropdowns render and narrow rows without a search box", async () => {
  const el = await tableS({ columns: withStatus });
  expect(el.shadowRoot!.querySelector(".table-search")).toBeNull();
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
  select.value = "off";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
});

test("typed search text stops narrowing once the search box is turned off", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "ada";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  el.searchable = false;
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
});

test("the search box and each filter dropdown carry a semantic name", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  expect(el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!.name).toBe("search");
  expect(
    el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!.name,
  ).toBe("status-filter");
});

test("the search box and filter dropdowns draw the focus ring when focused", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(4, 5, 6)");
  for (const selector of [".table-search", 'select[data-filter="status"]']) {
    const control = el.shadowRoot!.querySelector<HTMLElement>(selector)!;
    control.focus();
    expect(control.matches(":focus-visible"), selector).toBe(true);
    expect(getComputedStyle(control).outlineColor, selector).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(control).outlineStyle, selector).toBe("solid");
  }
});

test("the search box and filter dropdown paint from the theme tokens", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  const filter = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
  expect(getComputedStyle(search).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(search).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(search).color).toBe("rgb(10, 11, 12)");
  expect(search.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(filter).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(filter).backgroundColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(filter).color).toBe("rgb(10, 11, 12)");
  expect(filter.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
});

test("the toolbar stacks the filters under a full-width search box at phone width", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  el.style.width = "360px";
  await el.updateComplete;
  const toolbar = el
    .shadowRoot!.querySelector<HTMLElement>(".table-toolbar")!
    .getBoundingClientRect();
  const search = el
    .shadowRoot!.querySelector<HTMLElement>(".table-search")!
    .getBoundingClientRect();
  const filters = el
    .shadowRoot!.querySelector<HTMLElement>(".table-filters")!
    .getBoundingClientRect();
  expect(filters.top).toBeGreaterThanOrEqual(search.bottom);
  expect(search.width).toBeCloseTo(toolbar.width, 0);
});

test("the toolbar keeps the search box and filters on one line when wide", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  el.style.width = "1000px";
  await el.updateComplete;
  const toolbar = el
    .shadowRoot!.querySelector<HTMLElement>(".table-toolbar")!
    .getBoundingClientRect();
  const search = el
    .shadowRoot!.querySelector<HTMLElement>(".table-search")!
    .getBoundingClientRect();
  const filter = el
    .shadowRoot!.querySelector<HTMLElement>(".table-filter")!
    .getBoundingClientRect();
  expect(filter.top).toBeLessThan(search.bottom);
  expect(search.right).toBeLessThan(filter.left);
  expect(filter.right).toBeCloseTo(toolbar.right, 0);
  // Natural width, not stretched: the dropdown is far narrower than the space the search box fills.
  expect(filter.width).toBeLessThan(search.width / 2);
});

test("search and filter combine with AND", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
  input.value = "ada";
  input.dispatchEvent(new Event("input"));
  select.value = "off";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  // Ada is Active, so name=ada AND status=off yields nothing.
  expect(el.shadowRoot!.querySelector(".message")).not.toBeNull();
});

test("a column with no filter contributes no dropdown", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  expect(el.shadowRoot!.querySelectorAll("select[data-filter]").length).toBe(1);
});

test("restores a stored sort and filter from session storage under viewKey", async () => {
  sessionStorage.setItem(
    "test.table",
    JSON.stringify({ sortKey: "name", sortDirection: "descending", filters: { status: "off" } }),
  );
  const el = await tableS({
    viewKey: "test.table",
    searchable: true,
    columns: [{ ...withStatus[0]!, sortValue: (r: RowS) => r.name }, withStatus[1]!],
  });
  expect(el.sortKey).toBe("name");
  expect(el.sortDirection).toBe("descending");
  expect(rowKeysS(el)).toEqual(["2"]);
});

test("a restored filter's dropdown shows the restored choice", async () => {
  sessionStorage.setItem("test.shown", JSON.stringify({ filters: { status: "off" } }));
  const el = await tableS({ viewKey: "test.shown", searchable: true, columns: withStatus });
  expect(rowKeysS(el)).toEqual(["2"]);
  expect(
    el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!.value,
  ).toBe("off");
});

test("drops a stored filter value the column no longer offers, or that is not a string", async () => {
  sessionStorage.setItem("test.stale", JSON.stringify({ filters: { status: "deleted" } }));
  const stale = await tableS({
    viewKey: "test.stale",
    searchable: true,
    columns: [{ ...withStatus[0]!, sortValue: (r: RowS) => r.name }, withStatus[1]!],
  });
  expect(rowKeysS(stale)).toEqual(["1", "2"]);
  stale.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await stale.updateComplete;
  expect(JSON.parse(sessionStorage.getItem("test.stale")!).filters).toEqual({});
  cleanup();
  sessionStorage.setItem("test.numeric", JSON.stringify({ filters: { status: 1 } }));
  const numeric = await tableS({ viewKey: "test.numeric", searchable: true, columns: withStatus });
  expect(rowKeysS(numeric)).toEqual(["1", "2"]);
});

test("restores the view once columns arrive after the viewKey", async () => {
  sessionStorage.setItem(
    "test.delayed",
    JSON.stringify({ sortKey: "name", sortDirection: "ascending" }),
  );
  const el = (await mount(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  el.viewKey = "test.delayed";
  await el.updateComplete;
  Object.assign(el, { rows, columns, rowKey: (r: Row) => r.id });
  await el.updateComplete;
  expect(el.sortKey).toBe("name");
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
});

// A consumer may build filter options from data it has not loaded yet, so a stored value waits
// until its column offers any options and is judged against that first non-empty list.
test("a stored filter waits for its column's options to load before it is kept or dropped", async () => {
  sessionStorage.setItem("test.loading", JSON.stringify({ filters: { status: "off" } }));
  const unloaded: DataTableColumn<RowS>[] = [
    withStatus[0]!,
    { ...withStatus[1]!, filter: { ...withStatus[1]!.filter!, options: [] } },
  ];
  const el = await tableS({
    viewKey: "test.loading",
    searchable: true,
    columns: unloaded,
    rows: [],
  });
  el.columns = withStatus;
  el.rows = rowsS;
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
});

const sortableName: DataTableColumn<RowS> = { ...withStatus[0]!, sortValue: (r: RowS) => r.name };
const statusFilter = withStatus[1]!.filter!;
function statusOffering(options: { value: string; label: string }[]): DataTableColumn<RowS>[] {
  return [sortableName, { ...withStatus[1]!, filter: { ...statusFilter, options } }];
}
function statusSelect(el: WtDataTable<RowS>): HTMLSelectElement {
  return el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
}
function storedFilters(key: string): unknown {
  return JSON.parse(sessionStorage.getItem(key)!).filters;
}

// A consumer may leave a column out in one layout (a tree that shows the parent by nesting) and
// put it back in another, so a stored value outlives the column's absence.
test("a stored filter for a column that is not rendered waits for the column, and is not overwritten meanwhile", async () => {
  sessionStorage.setItem("test.absent", JSON.stringify({ filters: { status: "off" } }));
  const el = await tableS({ viewKey: "test.absent", searchable: true, columns: [sortableName] });
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(storedFilters("test.absent")).toEqual({ status: "off" });
  el.columns = [sortableName, withStatus[1]!];
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
  expect(statusSelect(el).value).toBe("off");
});

test("a stored filter is still dropped when its column appears with options that exclude it", async () => {
  sessionStorage.setItem("test.absent-stale", JSON.stringify({ filters: { status: "deleted" } }));
  const el = await tableS({
    viewKey: "test.absent-stale",
    searchable: true,
    columns: [sortableName],
  });
  el.columns = [sortableName, withStatus[1]!];
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(storedFilters("test.absent-stale")).toEqual({});
});

test("a chosen filter is cleared when its column's options stop offering it", async () => {
  const el = await tableS({ viewKey: "test.shrink", searchable: true, columns: withStatus });
  statusSelect(el).value = "off";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
  el.columns = statusOffering([{ value: "active", label: "Active" }]);
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(statusSelect(el).value).toBe("");
  expect(storedFilters("test.shrink")).toEqual({});
});

// An empty option list reads as "not loaded yet", the same rule a restored value follows.
test("a chosen filter waits, unapplied, while its column offers no options at all", async () => {
  const el = await tableS({ viewKey: "test.emptied", searchable: true, columns: withStatus });
  statusSelect(el).value = "off";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  el.columns = statusOffering([]);
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(statusSelect(el).value).toBe("");
  expect(storedFilters("test.emptied")).toEqual({ status: "off" });
  el.columns = withStatus;
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
  expect(statusSelect(el).value).toBe("off");
});

test("writes sort changes back to session storage", async () => {
  const el = await table({ viewKey: "test.table2", searchable: true });
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(JSON.parse(sessionStorage.getItem("test.table2")!).sortKey).toBe("name");
});

test("ignores a stored sort column that no longer exists", async () => {
  sessionStorage.setItem(
    "test.table3",
    JSON.stringify({ sortKey: "gone", sortDirection: "descending", filters: {} }),
  );
  const el = await table({ viewKey: "test.table3", sortKey: "name", sortDirection: "ascending" });
  expect(el.sortKey).toBe("name"); // fell back to the default, not "gone"
  // The direction belonged to the rejected column, so it is not applied to the default one.
  expect(el.sortDirection).toBe("ascending");
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
});

test("never stores search text, even alongside a real write", async () => {
  const el = await table({ viewKey: "test.table4", searchable: true });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "ada";
  input.dispatchEvent(new Event("input"));
  // A sort persists the view; the typed search term must not ride along.
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  const stored = JSON.parse(sessionStorage.getItem("test.table4")!);
  expect(stored.sortKey).toBe("name");
  expect(stored.search).toBeUndefined();
});

test("a throwing getItem does not break the table", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const el = await table({ viewKey: "test.table5" });
  expect(el.shadowRoot!.querySelector("table")).not.toBeNull();
});

test("a throwing setItem does not break the table", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const el = await table({ viewKey: "test.table6", searchable: true });
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(el.sortKey).toBe("name");
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
});

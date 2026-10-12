import { afterEach, expect, test, vi } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

type Row = { id: string; parent: string | null; name: string; kind: string };

const row = (id: string, parent: string | null, name: string, kind = "food"): Row => ({
  id,
  parent,
  name,
  kind,
});

// "Coffee" matches a search for coffee and holds a branch of its own, "Latte", that holds "Oat
// milk"; "Coffee cake" matches and holds nothing.
const menuRows: Row[] = [
  row("menu", null, "Menu"),
  row("coffee", "menu", "Coffee"),
  row("latte", "coffee", "Latte"),
  row("oat", "latte", "Oat milk"),
  row("tea", "menu", "Tea"),
  row("desserts", null, "Desserts"),
  row("cake", "desserts", "Coffee cake"),
];

const kindFilter: NonNullable<DataTableColumn<Row>["filter"]> = {
  label: "Filter by kind",
  allLabel: "Any kind",
  value: (r) => r.kind,
  options: [
    { value: "food", label: "Food" },
    { value: "drink", label: "Drink" },
  ],
};

const columns: DataTableColumn<Row>[] = [
  {
    key: "name",
    label: "Name",
    cell: (r) => r.name,
    sortValue: (r) => r.name,
    searchValue: (r) => r.name,
  },
  { key: "kind", label: "Kind", cell: (r) => r.kind, filter: kindFilter },
];

async function tree(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount('<wt-data-table aria-label="Menu"></wt-data-table>')) as WtDataTable<Row>;
  Object.assign(el, {
    rows: menuRows,
    columns,
    sortKey: "name",
    rowKey: (r: Row) => r.id,
    // Reads its row, as a consumer's would, so it fails if handed something that is not one.
    rowParent: (r: Row) => r.parent,
    ...props,
  });
  await el.updateComplete;
  return el;
}

function keys(el: WtDataTable<Row>): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((tr) =>
    tr.getAttribute("data-row-key"),
  );
}

function shownRow(el: WtDataTable<Row>, key: string): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"]`)!;
}

function expandAll(el: WtDataTable<Row>): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
}

async function flatSearch(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  return tree({
    flatTreeSearch: true,
    searchTerm: "coffee",
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
    ...props,
  });
}

test("a flat search offers a disclosure only on a match that holds rows, and reports what it draws", async () => {
  const el = await flatSearch();
  expect(keys(el)).toEqual(["coffee", "cake"]);
  expect(el.shownKeys()).toEqual(["coffee", "cake"]);
  expect(shownRow(el, "coffee").getAttribute("aria-expanded")).toBe("false");
  expect(el.isExpanded("coffee")).toBe(false);
  expect(shownRow(el, "cake").hasAttribute("aria-expanded")).toBe(false);
  expect(shownRow(el, "cake").querySelector(".tree-toggle")).toBeNull();
  shownRow(el, "coffee").querySelector<HTMLButtonElement>(".tree-toggle")!.click();
  await el.updateComplete;
  expect(el.isExpanded("coffee")).toBe(true);
  expect(el.shownKeys()).toEqual(["coffee", "latte", "cake"]);
});

test("a flat search over rows that name each other as parents draws each once below the other", async () => {
  const el = await flatSearch({
    rows: [row("one", "two", "Coffee one"), row("two", "one", "Coffee two")],
    rowCollapsible: () => false,
  });
  expect(keys(el)).toEqual(["one", "two", "two", "one"]);
});

test("Expand all in a flat search opens the branches inside a closed match too", async () => {
  const el = await flatSearch();
  expect(expandAll(el).textContent!.trim()).toBe("Expand all");
  expandAll(el).click();
  await el.updateComplete;
  expect(keys(el)).toEqual(["coffee", "latte", "oat", "cake"]);
  expect(expandAll(el).textContent!.trim()).toBe("Collapse all");
});

test("Expand all in a flat search leaves alone a branch expandAllIncludes leaves out", async () => {
  const el = await flatSearch({ expandAllIncludes: (r) => r.id !== "coffee" });
  expandAll(el).click();
  await el.updateComplete;
  expect(keys(el)).toEqual(["coffee", "cake"]);
});

test("in a flat search a branch that cannot close does not keep Expand all from reading Collapse all", async () => {
  const el = await flatSearch({ rowCollapsible: (r) => r.id !== "coffee" });
  expect(keys(el)).toEqual(["coffee", "latte", "cake"]);
  el.setExpanded("latte", true);
  await el.updateComplete;
  expect(keys(el)).toEqual(["coffee", "latte", "oat", "cake"]);
  expect(expandAll(el).textContent!.trim()).toBe("Collapse all");
});

test("closing a branch inside a flat search leaves it open in the tree once the search is cleared", async () => {
  const el = await flatSearch();
  const toggle = () => shownRow(el, "coffee").querySelector<HTMLButtonElement>(".tree-toggle")!;
  toggle().click();
  await el.updateComplete;
  toggle().click();
  await el.updateComplete;
  expect(keys(el)).toEqual(["coffee", "cake"]);
  el.searchTerm = "";
  await el.updateComplete;
  expect(shownRow(el, "coffee").getAttribute("aria-expanded")).toBe("true");
  expect(el.isExpanded("coffee")).toBe(true);
  expect(keys(el)).toContain("oat");
});

test("Expand all counts every branch, and opens one whose rows a filter hides for when it is cleared", async () => {
  const el = await tree({
    rows: [
      row("a", null, "A"),
      row("a1", "a", "A one", "drink"),
      row("b", null, "B"),
      row("b1", "b", "B one"),
    ],
    initiallyCollapsed: true,
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
    rowCollapsible: (r) => r.kind !== "none",
  });
  el.setExpanded("a", true);
  await el.updateComplete;
  expect(expandAll(el).textContent!.trim()).toBe("Expand all");
  el.setExpanded("a", false);
  el.chooseFilter("kind", ["food"]);
  await el.updateComplete;
  expect(keys(el)).toEqual(["a", "b"]);
  expandAll(el).click();
  await el.updateComplete;
  expect(keys(el)).toEqual(["a", "b", "b1"]);
  el.chooseFilter("kind", []);
  await el.updateComplete;
  expect(keys(el)).toEqual(["a", "a1", "b", "b1"]);
});

test("a search that opens the path shows every row below a match, wherever the rows list it", async () => {
  const el = await tree({
    rows: [
      row("food", null, "Food"),
      row("yolk", "eggs", "Yolk"),
      row("eggs", "break", "Eggs"),
      row("break", "food", "Breakfast"),
    ],
    searchOpensPath: true,
    searchTerm: "breakfast",
  });
  expect(keys(el)).toEqual(["food", "break", "eggs", "yolk"]);
});

test("isExpanded reports a branch the person closed as closed while a search draws it open", async () => {
  const el = await tree();
  el.setExpanded("coffee", false);
  await el.updateComplete;
  el.searchTerm = "oat";
  await el.updateComplete;
  expect(keys(el)).toEqual(["menu", "coffee", "latte", "oat"]);
  expect(el.isExpanded("coffee")).toBe(false);
  el.searchTerm = "";
  await el.updateComplete;
  expect(keys(el)).not.toContain("latte");
});

test("sortedSiblings keeps the rows' own order under a parent that keeps it, and sorts the rest", async () => {
  const rows = [
    row("parent", null, "Parent"),
    row("zed", "parent", "Zed"),
    row("alpha", "parent", "Alpha"),
    row("other", null, "Other"),
  ];
  const el = await tree({ rows, rowKeepsChildOrder: (r) => r.id === "parent" });
  expect(el.sortedSiblings([rows[1]!, rows[2]!])).toEqual([rows[1], rows[2]]);
  expect(el.sortedSiblings([rows[2]!, rows[1]!])).toEqual([rows[1], rows[2]]);
  expect(el.sortedSiblings([rows[3]!, rows[0]!])).toEqual([rows[3], rows[0]]);
  expect(el.sortedSiblings([])).toEqual([]);
});

test("revealRow remembers only the branches it had to open", async () => {
  const el = await tree({ rememberExpanded: true, viewKey: "reveal" });
  await el.revealRow("oat");
  expect(localStorage.getItem("reveal:expanded")).toBeNull();
  el.setExpanded("latte", false);
  await el.updateComplete;
  expect(JSON.parse(localStorage.getItem("reveal:expanded")!)).toEqual([]);
  await el.revealRow("oat");
  expect(keys(el)).toContain("oat");
  expect(JSON.parse(localStorage.getItem("reveal:expanded")!)).toEqual(["latte"]);
});

test("closing a branch with collapseDescendants closes the branches below it, not its leaves", async () => {
  const el = await tree({ collapseDescendants: true });
  el.setExpanded("menu", false);
  el.setExpanded("menu", true);
  el.setExpanded("coffee", true);
  el.setExpanded("latte", true);
  await el.updateComplete;
  el.rows = [...menuRows, row("foam", "tea", "Foam")];
  await el.updateComplete;
  expect(keys(el)).toContain("foam");
});

test("in a flat search of rows keyed by position, shownKeys reports the keys the rows are drawn with", async () => {
  const el = await flatSearch({
    rows: [
      row("menu", null, "Menu"),
      row("coffee", "0", "Coffee"),
      row("cake", "0", "Coffee cake"),
    ],
    rowKey: (_r: Row, index: number) => String(index),
  });
  expect(keys(el)).toEqual(["1", "2"]);
  expect(el.shownKeys()).toEqual(["1", "2"]);
});

test("asked about a key no row has, the expansion methods answer closed and change nothing", async () => {
  const el = await flatSearch({
    collapseDescendants: true,
    rowCollapsible: (r) => r.kind !== "none",
  });
  expect(el.isExpanded("ghost")).toBe(false);
  el.setExpanded("ghost", false);
  el.setExpanded("ghost", true);
  await el.updateComplete;
  expect(keys(el)).toEqual(["coffee", "cake"]);
  expect(el.filterValues("ghost")).toEqual([]);
});

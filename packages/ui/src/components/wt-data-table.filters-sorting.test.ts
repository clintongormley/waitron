import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mount, mountInShadowRoot } from "../test-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

type Row = { id: string; name: string; status: string; value?: string | number | null };

const statusFilter = {
  label: "Filter by status",
  allLabel: "Any status",
  value: (row: Row) => row.status,
  options: [
    { value: "active", label: "Active" },
    { value: "off", label: "Inactive" },
  ],
};

const nameColumn: DataTableColumn<Row> = {
  key: "name",
  label: "Name",
  cell: (row) => row.name,
  searchValue: (row) => row.name,
  sortValue: (row) => row.name,
};

async function table(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount(
    '<wt-data-table aria-label="Items"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rowKey: (row: Row) => row.id, ...props });
  await el.updateComplete;
  return el;
}

function rowKeys(el: WtDataTable<Row>): string[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}

function headerWidths(el: WtDataTable<Row>): number[] {
  return [...el.shadowRoot!.querySelectorAll("thead th")].map(
    (cell) => cell.getBoundingClientRect().width,
  );
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function openFilters(el: WtDataTable<Row>): Promise<void> {
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!;
  trigger.click();
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  await el.updateComplete;
}

async function offeredLabels(el: WtDataTable<Row>, key: string): Promise<string[]> {
  const filter = el.shadowRoot!.querySelector<WtCombobox>(`[data-filter="${key}"]`)!;
  await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  await filter.updateComplete;
  return [...filter.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].map((option) =>
    option.textContent!.trim(),
  );
}

async function withViewport<T>(width: number, run: () => Promise<T>): Promise<T> {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  await page.viewport(width, 800);
  try {
    return await run();
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
}

const widthRows: Row[] = [
  { id: "1", name: "Ada", status: "active" },
  { id: "2", name: "A much longer product name than the rest", status: "off" },
];

const initialActive: DataTableColumn<Row>[] = [
  nameColumn,
  {
    key: "status",
    label: "Status",
    cell: (row) => row.status,
    filter: { ...statusFilter, initial: "active" },
  },
];

test("a filter whose options are replaced on the same filter object offers the new options", async () => {
  const filter = { ...statusFilter };
  const columns: DataTableColumn<Row>[] = [
    nameColumn,
    { key: "status", label: "Status", cell: (row) => row.status, filter },
  ];
  const el = await table({ rows: widthRows, columns });
  await openFilters(el);
  filter.options = [...statusFilter.options, { value: "paused", label: "Paused" }];
  el.columns = [...columns];
  await el.updateComplete;
  expect(await offeredLabels(el, "status")).toEqual(["Any status", "Active", "Inactive", "Paused"]);
});

test("choosing all again on a filter whose initial choice is already overridden reports nothing", async () => {
  const el = await table({ rows: widthRows, columns: initialActive });
  const seen: unknown[] = [];
  el.addEventListener("wt-filter-change", (event) => seen.push((event as CustomEvent).detail));
  el.chooseFilter("status", []);
  el.chooseFilter("status", []);
  await el.updateComplete;
  expect(seen).toEqual([{ filters: { status: "" } }]);
  expect(rowKeys(el)).toEqual(["1", "2"]);
});

test("Clear all shows every row of a single-choice filter with an initial choice, keeping the column widths", async () => {
  await withViewport(1280, async () => {
    const el = await table({ rows: widthRows, columns: initialActive });
    await openFilters(el);
    await frame();
    expect(rowKeys(el)).toEqual(["1"]);
    const before = headerWidths(el);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
    await el.updateComplete;
    expect(rowKeys(el)).toEqual(["1", "2"]);
    expect(headerWidths(el)).toEqual(before);
  });
});

test("closing the full-screen Filters after a choice keeps the column widths the choice was made at", async () => {
  await withViewport(390, async () => {
    const el = await table({ rows: widthRows, columns: initialActive });
    await frame();
    const before = headerWidths(el);
    await openFilters(el);
    el.chooseFilter("status", []);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-close")!.click();
    await el.updateComplete;
    await frame();
    expect(rowKeys(el)).toEqual(["1", "2"]);
    expect(headerWidths(el)).toEqual(before);
  });
});

test("a row keyed by its drawn position is ticked by whether that drawn row may be selected", async () => {
  const el = await table({
    rows: [
      { id: "b", name: "Bea", status: "off" },
      { id: "a", name: "Ada", status: "active" },
    ],
    columns: [nameColumn],
    rowKey: (_row, index) => String(index),
    sortKey: "name",
    selectable: true,
    rowSelectionAllowed: (row) => row.id === "a",
  });
  expect(el.shadowRoot!.querySelector('tr[data-row-key="0"]')!.textContent).toContain("Ada");
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-0]")!.click();
  expect(seen).toEqual([["0"]]);
});

const valueColumn: DataTableColumn<Row> = {
  key: "value",
  label: "Value",
  cell: (row) => String(row.value),
  sortValue: (row) => row.value,
};

async function sortedKeys(rowsIn: Row[], direction: "ascending" | "descending") {
  const el = await table({
    rows: rowsIn,
    columns: [nameColumn, valueColumn],
    sortKey: "value",
    sortDirection: direction,
  });
  return rowKeys(el);
}

test("a column mixing text and numbers orders text against numbers by their written form", async () => {
  const input: Row[] = [
    { id: "b", name: "B", status: "", value: "b" },
    { id: "2", name: "Two", status: "", value: 2 },
    { id: "a", name: "A", status: "", value: "a" },
    { id: "10", name: "Ten", status: "", value: 10 },
    { id: "c", name: "C", status: "", value: "c" },
  ];
  expect(await sortedKeys(input, "ascending")).toEqual(["2", "10", "a", "b", "c"]);
  expect(await sortedKeys(input, "descending")).toEqual(["c", "b", "a", "10", "2"]);
});

type TreeRow = { id: string; parent: string | null; name: string };

const treeColumns: DataTableColumn<TreeRow>[] = [
  {
    key: "name",
    label: "Name",
    cell: (row) => row.name,
    searchValue: (row) => row.name,
    sortValue: (row) => row.name,
  },
];

async function treeTable(props: Partial<WtDataTable<TreeRow>>): Promise<WtDataTable<TreeRow>> {
  const el = (await mount(
    '<wt-data-table aria-label="Menu"></wt-data-table>',
  )) as WtDataTable<TreeRow>;
  Object.assign(el, {
    columns: treeColumns,
    rowKey: (row: TreeRow) => row.id,
    rowParent: (row: TreeRow) => row.parent,
    flatTreeSearch: true,
    ...props,
  });
  await el.updateComplete;
  return el;
}

test("a flat tree search puts equally close matches in their group order", async () => {
  const el = await treeTable({
    rows: [
      { id: "p1", parent: null, name: "Apple" },
      { id: "p2", parent: null, name: "Apple" },
      { id: "p3", parent: null, name: "Apple" },
    ],
    rowGroup: (row) => ({ p1: 2, p2: 0, p3: 1 })[row.id]!,
    searchTerm: "apple",
  });
  expect(el.shownKeys()).toEqual(["p2", "p3", "p1"]);
});

test("a flat tree search reports each row by the key its position gives it", async () => {
  const el = await treeTable({
    rows: [
      { id: "a", parent: null, name: "Coffee" },
      { id: "b", parent: "0", name: "Iced coffee" },
      { id: "c", parent: null, name: "Tea" },
    ],
    rowKey: (_row, index) => String(index),
    searchTerm: "coffee",
  });
  expect(el.shownKeys().sort()).toEqual(["0", "1"]);
});

test("a flat table asked for flat tree search still searches its rows", async () => {
  const el = await table({
    rows: [
      { id: "1", name: "Coffee", status: "" },
      { id: "2", name: "Tea", status: "" },
    ],
    columns: [nameColumn],
    flatTreeSearch: true,
    searchTerm: "coffee",
  });
  expect(el.shownKeys()).toEqual(["1"]);
  expect(rowKeys(el)).toEqual(["1"]);
});

test("a search reads rows, columns and column order replaced in the same update", async () => {
  const rowsIn: Row[] = [
    { id: "1", name: "Ada", status: "zebra" },
    { id: "2", name: "Bea", status: "lion" },
  ];
  const tag = (read: (row: Row) => string): DataTableColumn<Row> => ({
    key: "tag",
    label: "Tag",
    cell: read,
    searchValue: read,
    choosable: "shown",
  });
  const other: DataTableColumn<Row> = {
    key: "other",
    label: "Other",
    cell: () => "",
    choosable: "shown",
  };
  const el = await table({
    rows: rowsIn,
    columns: [nameColumn, tag((row) => row.name), other],
    searchTerm: "zebra",
  });
  expect(rowKeys(el)).toEqual([]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-reorder="tag"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  el.rows = [...rowsIn];
  el.columns = [nameColumn, tag((row) => row.status), other];
  await el.updateComplete;
  expect(rowKeys(el)).toEqual(["1"]);
});

test("Clear all reports the cleared filters across shadow boundaries", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Items"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows: widthRows, columns: initialActive, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  const seen: unknown[] = [];
  const listen = (event: Event) => seen.push((event as CustomEvent).detail);
  document.addEventListener("wt-filter-change", listen);
  onTestFinished(() => document.removeEventListener("wt-filter-change", listen));
  await openFilters(el);
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
  expect(seen).toEqual([{ filters: { status: "" } }]);
});

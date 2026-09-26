import { html } from "lit";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
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

test("sorts ascending when the consumer names a sort key but no direction", async () => {
  const el = await table({ sortKey: "name" });
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
  expect(
    el.shadowRoot!.querySelector('[data-sort="name"]')!.closest("th")!.getAttribute("aria-sort"),
  ).toBe("ascending");
});

test("a third header click returns the table to ascending", async () => {
  const el = await table();
  const name = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!;
  name.click();
  await el.updateComplete;
  name.click();
  await el.updateComplete;
  name.click();
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
  expect(name.closest("th")!.getAttribute("aria-sort")).toBe("ascending");
});

test("wt-sort-change bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  let received: { sortKey: string | null; sortDirection: string } | undefined;
  document.addEventListener(
    "wt-sort-change",
    (event) => {
      received = (event as CustomEvent<{ sortKey: string | null; sortDirection: string }>).detail;
    },
    { once: true },
  );
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!.click();
  expect(received).toEqual({ sortKey: "name", sortDirection: "ascending" });
});

type SortRow = { id: string; value: string | number | null };

async function sortTable(sortRows: SortRow[]): Promise<WtDataTable<SortRow>> {
  const el = (await mount(
    '<wt-data-table aria-label="Values"></wt-data-table>',
  )) as WtDataTable<SortRow>;
  Object.assign(el, {
    rows: sortRows,
    rowKey: (row: SortRow) => row.id,
    sortKey: "value",
    columns: [
      {
        key: "value",
        label: "Value",
        cell: (row: SortRow) => String(row.value ?? ""),
        sortValue: (row: SortRow) => row.value,
      },
    ],
  });
  await el.updateComplete;
  return el;
}

function sortedKeys(el: WtDataTable<SortRow>): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-row-key"),
  );
}

test("rows with no value sort last in both directions and keep their own order", async () => {
  const el = await sortTable([
    { id: "zoe", value: "Zoe" },
    { id: "first-blank", value: null },
    { id: "wim", value: "Wim" },
    { id: "second-blank", value: null },
  ]);
  expect(sortedKeys(el)).toEqual(["wim", "zoe", "first-blank", "second-blank"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="value"]')!.click();
  await el.updateComplete;
  expect(sortedKeys(el)).toEqual(["zoe", "wim", "first-blank", "second-blank"]);
});

test("a column of decimals sorts by size, not as text", async () => {
  const el = await sortTable([
    { id: "larger", value: 1.5 },
    { id: "smaller", value: 1.25 },
  ]);
  expect(sortedKeys(el)).toEqual(["smaller", "larger"]);
});

test("a column that mixes numbers and text still orders its rows", async () => {
  const el = await sortTable([
    { id: "text", value: "n/a" },
    { id: "number", value: 10 },
  ]);
  expect(sortedKeys(el)).toEqual(["number", "text"]);
});

test("text ending in a number sorts 9 before 10", async () => {
  const el = await sortTable([
    { id: "ten", value: "Table 10" },
    { id: "nine", value: "Table 9" },
  ]);
  expect(sortedKeys(el)).toEqual(["nine", "ten"]);
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

const alignedColumns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => row.name },
  { key: "count", label: "Count", cell: (row) => row.count, align: "end" },
];

test("a column asking for end alignment aligns its header and its cells to the end", async () => {
  const el = await table({ columns: alignedColumns });
  const [nameHead, countHead] = [...el.shadowRoot!.querySelectorAll<HTMLElement>("th")];
  const [nameCell, countCell] = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr:first-child td"),
  ];
  expect(nameHead!.getAttribute("data-align")).toBe("start");
  expect(countHead!.getAttribute("data-align")).toBe("end");
  expect(nameCell!.getAttribute("data-align")).toBe("start");
  expect(countCell!.getAttribute("data-align")).toBe("end");
  expect(getComputedStyle(nameHead!).textAlign).toBe("start");
  expect(getComputedStyle(countHead!).textAlign).toBe("end");
  expect(getComputedStyle(nameCell!).textAlign).toBe("start");
  expect(getComputedStyle(countCell!).textAlign).toBe("end");
});

test("only a sortable column offers a sort button, and one not sorted by reports no order", async () => {
  const el = await table({ sortKey: "name" });
  const [name, count, actions] = [...el.shadowRoot!.querySelectorAll("th")];
  expect(name!.getAttribute("aria-sort")).toBe("ascending");
  expect(count!.getAttribute("aria-sort")).toBe("none");
  expect(actions!.hasAttribute("aria-sort")).toBe(false);
  expect(name!.querySelector("button.sort")).not.toBeNull();
  expect(actions!.querySelector("button")).toBeNull();
  expect(actions!.textContent!.trim()).toBe("Actions");
});

test("the column being sorted shows an arrow for its direction and the others show none", async () => {
  const el = await table({ sortKey: "name" });
  const indicator = (key: string) =>
    el.shadowRoot!.querySelector(`[data-sort="${key}"] .indicator`)!.textContent!.trim();
  expect(indicator("name")).toBe("▲");
  expect(indicator("count")).toBe("");
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(indicator("name")).toBe("▼");
  expect(indicator("count")).toBe("");
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

test("shows 'Loading' while loading when the consumer supplies no message", async () => {
  const el = await table({ loading: true });
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain("Loading");
});

test("a table given no rows at all shows the default empty message", async () => {
  const el = (await mount("<wt-data-table></wt-data-table>")) as WtDataTable<Row>;
  el.columns = columns;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain("No results");
  expect(el.shadowRoot!.querySelector("table")).toBeNull();
});

test("keys each row by its position when the consumer supplies no row key", async () => {
  const el = (await mount("<wt-data-table></wt-data-table>")) as WtDataTable<Row>;
  Object.assign(el, { rows, columns });
  await el.updateComplete;
  expect(
    [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key")),
  ).toEqual(["0", "1"]);
});

test("leaves the scrollable region unnamed when the host carries no label", async () => {
  const el = (await mount("<wt-data-table></wt-data-table>")) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[role=region]")!.hasAttribute("aria-label")).toBe(false);
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

test("labels the checkboxes generically when the consumer names none", async () => {
  const el = await table({ selectable: true });
  expect(el.shadowRoot!.querySelector("[data-test=select-all]")!.getAttribute("aria-label")).toBe(
    "Select all",
  );
  expect(el.shadowRoot!.querySelector("[data-test=select-b]")!.getAttribute("aria-label")).toBe(
    "Select row",
  );
});

test("starts with an empty selection, so the first box ticked reports only that row", async () => {
  const el = await table({ selectable: true });
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-b]")!.click();
  expect(seen.at(-1)).toEqual(["b"]);
});

test("select-all adds the rows not selected yet and keeps the ones already selected", async () => {
  const el = await table({ selectable: true, selected: ["a"] });
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(seen.at(-1)).toEqual(["a", "b"]);
});

test("wt-selection-change bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id, selectable: true });
  await el.updateComplete;
  let received: string[] | undefined;
  document.addEventListener(
    "wt-selection-change",
    (event) => {
      received = (event as CustomEvent<{ selected: string[] }>).detail.selected;
    },
    { once: true },
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-b]")!.click();
  expect(received).toEqual(["b"]);
});

test("the select-all box is ticked only when every visible row is selected", async () => {
  const el = await table({ selectable: true, selected: [] });
  const all = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  expect(all.checked).toBe(false);
  expect(all.indeterminate).toBe(false);
  el.selected = ["a", "b"];
  await el.updateComplete;
  expect(all.checked).toBe(true);
  expect(all.indeterminate).toBe(false);
});

test("ticking a box reports the selection and stops the raw change event at the table", async () => {
  const el = await table({ selectable: true });
  const changes = vi.fn();
  const selections = vi.fn();
  el.shadowRoot!.addEventListener("change", changes);
  el.addEventListener("wt-selection-change", selections);
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-b]")!.click();
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(selections).toHaveBeenCalledTimes(2);
  expect(changes).not.toHaveBeenCalled();
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
function treeKeys(el: WtDataTable<TreeRow>): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-row-key"),
  );
}

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

test("tree mode can start every branch collapsed and still lets each one expand", async () => {
  const el = await treeTable({ initiallyCollapsed: true });
  const keys = () =>
    [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key"));
  expect(keys()).toEqual(["food", "drinks"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tbody tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(keys()).toEqual(["food", "break", "drinks"]);
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

test("labels the tree toggle Collapse when the branch is open and Expand when it is closed", async () => {
  const el = await treeTable();
  const toggle = () =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      'tbody tr[data-row-key="food"] button.tree-toggle',
    )!;
  expect(toggle().getAttribute("aria-label")).toBe("Collapse");
  toggle().click();
  await el.updateComplete;
  expect(toggle().getAttribute("aria-label")).toBe("Expand");
});

test("names each tree toggle after its own row when a toggle label is given", async () => {
  const el = await treeTable({
    rowToggleLabel: (row: TreeRow, expanded: boolean) =>
      `${expanded ? "Hide" : "Show"} inside ${row.name}`,
  });
  const toggle = (key: string) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      `tbody tr[data-row-key="${key}"] button.tree-toggle`,
    )!;
  expect(toggle("food").getAttribute("aria-label")).toBe("Hide inside Food");
  expect(toggle("break").getAttribute("aria-label")).toBe("Hide inside Breakfast");
  toggle("break").click();
  await el.updateComplete;
  expect(toggle("break").getAttribute("aria-label")).toBe("Show inside Breakfast");
  expect(toggle("food").getAttribute("aria-label")).toBe("Hide inside Food");
});

test("seeds branches collapsed when the rows arrive after the flag", async () => {
  const el = await treeTable({ rows: [], initiallyCollapsed: true });
  el.rows = treeRows;
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("seeds branches collapsed when the parent lookup arrives after the rows", async () => {
  const el = await treeTable({ initiallyCollapsed: true, rowParent: undefined });
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  el.rowParent = (row: TreeRow) => row.parent;
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("seeds branches collapsed when the flag is turned on after the rows", async () => {
  const el = await treeTable();
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  el.initiallyCollapsed = true;
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("a branch the person expanded stays open when the rows are refreshed", async () => {
  const el = await treeTable({ initiallyCollapsed: true });
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tbody tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  el.rows = [...treeRows];
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
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
    initiallyCollapsed: true,
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
  // Search controls visibility while these otherwise-collapsed ancestors hold a match's place. Do
  // not offer a collapse button whose clicks cannot hide the required matching descendant.
  expect(el.shadowRoot!.querySelector('tr[data-row-key="food"] button.tree-toggle')).toBeNull();
  expect(el.shadowRoot!.querySelector('tr[data-row-key="break"] button.tree-toggle')).toBeNull();
});

test("a search in a tree keeps a match's ancestors and drops everything else", async () => {
  const el = await treeTable({
    rows: [...treeRows, { id: "cola", parent: "drinks", name: "Cola" }],
    searchable: true,
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "eggs";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
});

// Each of these two rows names the other as its parent, so walking up the chain from either one
// never reaches a top-level row.
const loopingRows: TreeRow[] = [
  { id: "x", parent: "y", name: "Ex" },
  { id: "y", parent: "x", name: "Why" },
];

test("rows whose parents point at each other leave the table empty instead of circling", async () => {
  const el = await treeTable({ rows: loopingRows });
  expect(el.shadowRoot!.querySelector("table")).not.toBeNull();
  expect(treeKeys(el)).toEqual([]);
});

test("the select-all box is not ticked when nothing is on screen to select", async () => {
  const el = await treeTable({ rows: loopingRows, selectable: true });
  const all = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  expect(all.checked).toBe(false);
  expect(all.indeterminate).toBe(false);
});

test("a tree keys its rows by position when the consumer supplies no row key", async () => {
  const el = (await mount(
    '<wt-data-table aria-label="Categories"></wt-data-table>',
  )) as WtDataTable<TreeRow>;
  Object.assign(el, {
    rows: [
      { id: "ignored-top", parent: null, name: "Food" },
      { id: "ignored-child", parent: "0", name: "Breakfast" },
    ],
    columns: treeColumns,
    rowParent: (row: TreeRow) => row.parent,
  });
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["0", "1"]);
  expect(el.shadowRoot!.querySelector('tr[data-row-key="1"]')!.getAttribute("aria-level")).toBe(
    "2",
  );
});

const twoColumnTree: DataTableColumn<TreeRow>[] = [
  { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
  { key: "code", label: "Code", cell: (row) => row.id, align: "end" },
];

test("only a tree row's first cell carries the indentation and the toggle", async () => {
  const el = await treeTable({ columns: twoColumnTree });
  const [first, second] = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('tr[data-row-key="food"] td'),
  ];
  expect(first!.querySelector(".tree-cell")).not.toBeNull();
  expect(first!.querySelector("button.tree-toggle")).not.toBeNull();
  expect(second!.querySelector(".tree-cell")).toBeNull();
  expect(second!.textContent!.trim()).toBe("food");
});

test("a tree aligns an end-aligned column to the end and the rest to the start", async () => {
  const el = await treeTable({ columns: twoColumnTree });
  const [first, second] = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('tr[data-row-key="food"] td'),
  ];
  expect(first!.getAttribute("data-align")).toBe("start");
  expect(second!.getAttribute("data-align")).toBe("end");
  expect(getComputedStyle(first!).textAlign).toBe("start");
  expect(getComputedStyle(second!).textAlign).toBe("end");
});

test("each level of a tree is indented one step further than the level above it", async () => {
  const el = await treeTable();
  host.style.setProperty("--wt-space-4", "16px");
  const indent = (key: string) =>
    getComputedStyle(
      el.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-cell`)!,
    ).paddingInlineStart;
  expect(indent("food")).toBe("0px");
  expect(indent("break")).toBe("16px");
  expect(indent("eggs")).toBe("32px");
});

test("the tree toggle points down while a branch is open and right once it is closed", async () => {
  const el = await treeTable();
  const toggle = () =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] button.tree-toggle')!;
  expect(toggle().textContent!.trim()).toBe("▾");
  toggle().click();
  await el.updateComplete;
  expect(toggle().textContent!.trim()).toBe("▸");
});

test("a row with no children keeps a spacer as wide as a toggle, so the labels line up", async () => {
  const el = await treeTable();
  host.style.setProperty("--wt-tap-min", "44px");
  const spacer = el.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="eggs"] .tree-spacer');
  expect(spacer).not.toBeNull();
  expect(spacer!.getBoundingClientRect().width).toBe(44);
});

test("a tree names its scrollable region from the host label", async () => {
  const el = await treeTable();
  expect(el.shadowRoot!.querySelector("[role=region]")!.getAttribute("aria-label")).toBe(
    "Categories",
  );
});

test("the selection cell is a grid cell in a tree and carries no role in a plain table", async () => {
  const flat = await table({ selectable: true });
  expect(flat.shadowRoot!.querySelector("td.select")!.hasAttribute("role")).toBe(false);
  const tree = await treeTable({ selectable: true });
  expect(tree.shadowRoot!.querySelector("td.select")!.getAttribute("role")).toBe("gridcell");
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

test("labels the search box 'Search' when the consumer names none", async () => {
  const el = await table({ searchable: true });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  expect(input.getAttribute("aria-label")).toBe("Search");
  expect(input.placeholder).toBe("Search");
});

test("says 'No matches' when a search clears the table and the consumer named no message", async () => {
  const el = await table({
    searchable: true,
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "zzz";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toContain("No matches");
});

test("a search term matches with its surrounding spaces trimmed and its case ignored", async () => {
  const el = await table({
    searchable: true,
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "  ADA  ";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada"]);
});

// A row's search text is its columns' text joined by single spaces. A column that supplies none
// contributes an empty slot, so its neighbours' text ends up two spaces apart — which is what the
// term below matches, and what an invented placeholder in that slot would break.
test("a column with no text of its own adds nothing to a row's search text", async () => {
  const el = await table({
    searchable: true,
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
      { key: "note", label: "Note", cell: () => "" },
      {
        key: "count",
        label: "Count",
        cell: (r: Row) => r.count,
        searchValue: (r: Row) => String(r.count),
      },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "ada  10";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10"]);
});

test("a column whose sortable value is missing adds nothing to a row's search text", async () => {
  const el = await table({
    searchable: true,
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
      { key: "note", label: "Note", cell: () => "", sortValue: () => null },
      {
        key: "count",
        label: "Count",
        cell: (r: Row) => r.count,
        searchValue: (r: Row) => String(r.count),
      },
    ],
  });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "ada  10";
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

test("a filter whose value is one string keeps only the rows equal to the chosen option", async () => {
  type Stated = { id: string; state: string };
  const el = (await mount(
    '<wt-data-table aria-label="Stated"></wt-data-table>',
  )) as WtDataTable<Stated>;
  Object.assign(el, {
    rows: [
      { id: "1", state: "active" },
      { id: "2", state: "inactive" },
    ],
    rowKey: (r: Stated) => r.id,
    columns: [
      {
        key: "state",
        label: "State",
        cell: (r: Stated) => r.state,
        filter: {
          label: "State",
          allLabel: "Any state",
          value: (r: Stated) => r.state,
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
      },
    ],
  });
  await el.updateComplete;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="state"]')!;
  select.value = "active";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(
    [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key")),
  ).toEqual(["1"]);
});

test("a filter whose value is a list keeps a row when the list holds the chosen option", async () => {
  type Tagged = { id: string; name: string; tags: string[] };
  const el = (await mount(
    '<wt-data-table aria-label="Tagged"></wt-data-table>',
  )) as WtDataTable<Tagged>;
  Object.assign(el, {
    rows: [
      { id: "1", name: "Both", tags: ["a", "b"] },
      { id: "2", name: "Only b", tags: ["b"] },
      { id: "3", name: "None", tags: [] },
    ],
    rowKey: (r: Tagged) => r.id,
    columns: [
      {
        key: "tags",
        label: "Tags",
        cell: (r: Tagged) => r.name,
        filter: {
          label: "Tag",
          allLabel: "Any tag",
          value: (r: Tagged) => r.tags,
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      },
    ],
  });
  await el.updateComplete;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="tags"]')!;
  const keys = () =>
    [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key"));
  select.value = "a";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(keys()).toEqual(["1"]);
  select.value = "b";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(keys()).toEqual(["1", "2"]);
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

const twoFilterRows: RowS[] = [
  { id: "1", name: "Ada", status: "active" },
  { id: "2", name: "Bea", status: "active" },
  { id: "3", name: "Ada", status: "off" },
];
const twoFilterColumns: DataTableColumn<RowS>[] = [
  {
    key: "name",
    label: "Name",
    cell: (row) => row.name,
    filter: {
      label: "Filter by name",
      allLabel: "Anyone",
      value: (row) => row.name,
      options: [
        { value: "Ada", label: "Ada" },
        { value: "Bea", label: "Bea" },
      ],
    },
  },
  withStatus[1]!,
];

test("choosing a filter in one column keeps the choice already made in another", async () => {
  const el = await tableS({ rows: twoFilterRows, columns: twoFilterColumns });
  const nameFilter = () =>
    el.shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="name"]')!;
  nameFilter().value = "Ada";
  nameFilter().dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "3"]);
  statusSelect(el).value = "active";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  expect(nameFilter().value).toBe("Ada");
});

test("choosing the all option again removes the stored filter choice", async () => {
  const el = await tableS({ viewKey: "test.cleared", columns: withStatus });
  statusSelect(el).value = "active";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(storedFilters("test.cleared")).toEqual({ status: "active" });
  statusSelect(el).value = "";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(storedFilters("test.cleared")).toEqual({});
  expect(rowKeysS(el)).toEqual(["1", "2"]);
});

/** The status filter starting on "active" before anyone chooses: the products list's shape. */
const initiallyActive = statusOffering(statusFilter.options).map((column) =>
  column.filter ? { ...column, filter: { ...column.filter, initial: "active" } } : column,
);

test("a filter with an initial choice starts on it, and its dropdown shows it", async () => {
  const el = await tableS({ viewKey: "test.initial", columns: initiallyActive });
  expect(rowKeysS(el)).toEqual(["1"]);
  expect(statusSelect(el).value).toBe("active");
});

test("choosing the all option over an initial choice shows every row, and is remembered", async () => {
  const el = await tableS({ viewKey: "test.initial-all", columns: initiallyActive });
  statusSelect(el).value = "";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(storedFilters("test.initial-all")).toEqual({ status: "" });
  cleanup();
  const again = await tableS({ viewKey: "test.initial-all", columns: initiallyActive });
  expect(rowKeysS(again)).toEqual(["1", "2"]);
  expect(statusSelect(again).value).toBe("");
});

test("an initial choice the column does not offer narrows nothing", async () => {
  const el = await tableS({
    columns: initiallyActive.map((column) =>
      column.filter ? { ...column, filter: { ...column.filter, initial: "retired" } } : column,
    ),
  });
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(statusSelect(el).value).toBe("");
});

test("a stored all choice is dropped for a column that has no initial choice", async () => {
  sessionStorage.setItem("test.plain-all", JSON.stringify({ filters: { status: "" } }));
  const el = await tableS({
    viewKey: "test.plain-all",
    columns: statusOffering(statusFilter.options),
  });
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(storedFilters("test.plain-all")).toEqual({});
});

test("a stored all choice does not wait for a column that is not rendered", async () => {
  sessionStorage.setItem("test.absent-all", JSON.stringify({ filters: { status: "" } }));
  await tableS({ viewKey: "test.absent-all", columns: [sortableName] });
  expect(storedFilters("test.absent-all")).toEqual({});
  cleanup();
  const again = await tableS({ viewKey: "test.absent-all", columns: initiallyActive });
  expect(rowKeysS(again)).toEqual(["1"]);
  expect(statusSelect(again).value).toBe("active");
});

// The stored choice here is the FIRST of the two options: a dropdown that marked every option as
// chosen would still show the last one, and pass a test written around the last option.
test("a restored filter's dropdown shows the choice even when it is not the last option", async () => {
  sessionStorage.setItem("test.first", JSON.stringify({ filters: { status: "active" } }));
  const el = await tableS({ viewKey: "test.first", columns: withStatus });
  expect(rowKeysS(el)).toEqual(["1"]);
  expect(statusSelect(el).value).toBe("active");
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

test("clearing select-all leaves selected rows that a filter has hidden", async () => {
  const el = await tableS({ selectable: true, selected: ["1", "2"], columns: withStatus });
  statusSelect(el).value = "off";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent<{ selected: string[] }>).detail.selected),
  );
  const all = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  expect(all.checked).toBe(true);
  all.click();
  expect(seen.at(-1)).toEqual(["1"]);
});

test("restores the view stored under a new viewKey when the key changes", async () => {
  sessionStorage.setItem("test.first", JSON.stringify({ filters: { status: "off" } }));
  sessionStorage.setItem("test.second", JSON.stringify({ filters: { status: "active" } }));
  const el = await tableS({ viewKey: "test.first", searchable: true, columns: withStatus });
  expect(rowKeysS(el)).toEqual(["2"]);
  el.viewKey = "test.second";
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
});

test("reads the stored view once, so a later write does not pull back the person's choice", async () => {
  const stored = JSON.stringify({ filters: { status: "off" } });
  sessionStorage.setItem("test.once", stored);
  const el = await tableS({ viewKey: "test.once", searchable: true, columns: withStatus });
  expect(rowKeysS(el)).toEqual(["2"]);
  statusSelect(el).value = "active";
  statusSelect(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  sessionStorage.setItem("test.once", stored);
  el.columns = [...withStatus];
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  expect(statusSelect(el).value).toBe("active");
});

test("ignores a stored sort key naming a column the table cannot sort by", async () => {
  sessionStorage.setItem(
    "test.unsortable",
    JSON.stringify({ sortKey: "action", sortDirection: "descending" }),
  );
  const el = await table({ viewKey: "test.unsortable" });
  expect(el.sortKey).toBeNull();
  expect(el.sortDirection).toBe("ascending");
});

test("ignores a stored sort direction that is neither ascending nor descending", async () => {
  for (const sortDirection of ["sideways", ""]) {
    sessionStorage.setItem("test.direction", JSON.stringify({ sortKey: "name", sortDirection }));
    const el = await table({ viewKey: "test.direction" });
    expect(el.sortDirection).toBe("ascending");
    expect(rowText(el)).toEqual(["Ada10Edit", "Bea2Edit"]);
    cleanup();
  }
});

test("ignores a stored filters value that is not an object", async () => {
  sessionStorage.setItem("test.notobject", JSON.stringify({ filters: "off" }));
  const el = await tableS({
    viewKey: "test.notobject",
    searchable: true,
    columns: [sortableName, withStatus[1]!],
  });
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(storedFilters("test.notobject")).toEqual({});
});

test("drops stored filter values that are not text, even with no column to judge them", async () => {
  sessionStorage.setItem(
    "test.types",
    JSON.stringify({ filters: { ghost: 1, phantom: "", status: "off" } }),
  );
  const el = await tableS({
    viewKey: "test.types",
    searchable: true,
    columns: [sortableName, withStatus[1]!],
  });
  expect(rowKeysS(el)).toEqual(["2"]);
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(storedFilters("test.types")).toEqual({ status: "off" });
});

test("writes nothing to session storage when no viewKey is set", async () => {
  const el = await table();
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(sessionStorage.length).toBe(0);
});

test("no clickable rows and no stretched activator unless rowClick is set", async () => {
  const el = await table();
  expect(el.shadowRoot!.querySelector(".row-activate")).toBeNull();
  expect(el.shadowRoot!.querySelector("tr.clickable")).toBeNull();
});

test("activates a row on click when rowClick is set", async () => {
  const clicked: string[] = [];
  const el = await table({
    rowClick: (row: Row) => clicked.push(row.id),
    rowClickLabel: (row: Row) => `Open ${row.name}`,
  });
  // The rows are unsorted, so the first rendered row is Bea (id "b").
  const activate = el.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!;
  expect(activate.getAttribute("aria-label")).toBe("Open Bea");
  expect(activate.closest("tr")!.classList.contains("clickable")).toBe(true);
  activate.click();
  expect(clicked).toEqual(["b"]);
});

test("labels a row's activator 'Open row' when the consumer names none", async () => {
  const el = await table({ rowClick: (row: Row) => row.id });
  expect(el.shadowRoot!.querySelector(".row-activate")!.getAttribute("aria-label")).toBe(
    "Open row",
  );
});

test("an in-cell control's click is not also wired to the row activator", async () => {
  // A synthetic click proves wiring only; the next test's real click proves the layering.
  const clicked: string[] = [];
  const el = await table({ rowClick: (row: Row) => clicked.push(row.id) });
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Edit Bea"]')!.click();
  expect(clicked).toEqual([]);
});

test("paints the focused clickable row from a token", async () => {
  const el = await table({ rowClick: (row: Row) => row.id });
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 40, 50)");
  const activate = el.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!;
  const cell = activate.closest("td")!;
  // Before focus, the cell paints no raised background of its own.
  expect(getComputedStyle(cell).backgroundColor).not.toBe("rgb(30, 40, 50)");
  activate.focus();
  // Via :focus-within, because getComputedStyle cannot force a hover state.
  expect(getComputedStyle(cell).backgroundColor).toBe("rgb(30, 40, 50)");
});

test("a real pointer click on an in-cell control does not fall through to the row activator", async () => {
  // The stretched activator overlays the whole row, so only a real pointer click, which hit-tests
  // on-screen position, shows whether the Edit button is lifted above it.
  const clicked: string[] = [];
  const el = await table({ rowClick: (row: Row) => clicked.push(row.id) });
  const edit = el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Edit Bea"]')!;
  await userEvent.click(edit);
  expect(clicked).toEqual([]); // the click reached Edit, not the activator beneath it
});

test("a clickable row gets exactly one activator, and it sits in the row's first cell", async () => {
  const el = await table({ rowClick: (row: Row) => row.id });
  const firstRow = el.shadowRoot!.querySelector("tbody tr")!;
  expect(firstRow.querySelectorAll(".row-activate").length).toBe(1);
  expect(firstRow.querySelector("td")!.querySelector(".row-activate")).not.toBeNull();
});

test("a plain table tells every cell its row is a match, not an ancestor standing in for one", async () => {
  const seen: { key: string; context: { ancestorOnly: boolean } }[] = [];
  const recording = (key: string): DataTableColumn<Row> => ({
    key,
    label: key,
    cell: (row, context) => {
      seen.push({ key, context });
      return row.name;
    },
  });
  await table({
    rowClick: (row: Row) => row.id,
    columns: [recording("first"), recording("second")],
  });
  expect([...new Set(seen.map((entry) => entry.key))].sort()).toEqual(["first", "second"]);
  for (const entry of seen) expect(entry.context).toEqual({ ancestorOnly: false });
});

const choosable: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => row.name, sortValue: (row) => row.name },
  {
    key: "count",
    label: "Count",
    cell: (row) => row.count,
    sortValue: (row) => row.count,
    choosable: "shown",
  },
  {
    key: "extra",
    label: "Extra",
    cell: (row) => `x${row.id}`,
    searchValue: (row) => `extra-${row.id}`,
    choosable: "hidden",
  },
];

/** What the chooser helpers read, from a table of any row type. */
type AnyTable = Pick<WtDataTable, "shadowRoot" | "updateComplete">;

function headers(el: AnyTable): string[] {
  return [...el.shadowRoot!.querySelectorAll("thead th")].map((cell) => cell.textContent!.trim());
}

function chooserBoxes(el: AnyTable): HTMLInputElement[] {
  return [
    ...el.shadowRoot!.querySelectorAll<HTMLInputElement>(".columns-panel input[type=checkbox]"),
  ];
}

function chooserBox(el: AnyTable, key: string): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>(
    `.columns-panel input[data-column="${key}"]`,
  )!;
}

function trigger(el: AnyTable): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!;
}

function panel(el: AnyTable): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".columns-panel")!;
}

async function choose(el: AnyTable, key: string): Promise<void> {
  chooserBox(el, key).click();
  await el.updateComplete;
}

test("no column chooser is drawn when no column is choosable", async () => {
  const el = await table({ searchable: true });
  expect(el.shadowRoot!.querySelector(".columns-trigger")).toBeNull();
  expect(el.shadowRoot!.querySelector(".columns-panel")).toBeNull();
});

test("a choosable column starts shown or hidden as it asks, and an unchoosable one is always shown and not offered", async () => {
  const el = await table({ columns: choosable });
  expect(headers(el)).toEqual(["Name", "Count"]);
  expect(rowText(el)).toEqual(["Bea2", "Ada10"]);
  expect(chooserBoxes(el).map((box) => box.closest("label")!.textContent!.trim())).toEqual([
    "Count",
    "Extra",
  ]);
  expect(chooserBoxes(el).map((box) => box.checked)).toEqual([true, false]);
  expect(chooserBoxes(el).map((box) => box.name)).toEqual(["count-column", "extra-column"]);
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([false, false]);
});

test("the chooser sits at the toolbar's trailing end, after the filters", async () => {
  const cols: DataTableColumn<RowS>[] = [withStatus[0]!, { ...withStatus[1]!, choosable: "shown" }];
  const el = await tableS({ columns: cols });
  el.style.width = "600px";
  await el.updateComplete;
  const toolbar = el.shadowRoot!.querySelector(".table-toolbar")!.getBoundingClientRect();
  const filter = el.shadowRoot!.querySelector(".table-filter")!.getBoundingClientRect();
  const button = trigger(el).getBoundingClientRect();
  expect(button.right).toBeCloseTo(toolbar.right, 0);
  expect(filter.right).toBeLessThan(button.left - 100);
});

test("the chooser draws in the toolbar even with no search box or filter", async () => {
  const el = await table({ columns: choosable });
  const toolbar = el.shadowRoot!.querySelector(".table-toolbar")!;
  expect(toolbar.querySelector(".columns-trigger")).not.toBeNull();
  expect(toolbar.querySelector(".table-search")).toBeNull();
  expect(toolbar.querySelector(".table-filters")).toBeNull();
});

test("the chooser's button and group read 'Columns' unless the consumer names them", async () => {
  const el = await table({ columns: choosable });
  expect(trigger(el).textContent!.trim()).toBe("Columns");
  expect(panel(el).getAttribute("role")).toBe("group");
  expect(panel(el).getAttribute("aria-label")).toBe("Columns");
  el.columnsLabel = "Columnas";
  await el.updateComplete;
  expect(trigger(el).textContent!.trim()).toBe("Columnas");
  expect(panel(el).getAttribute("aria-label")).toBe("Columnas");
});

test("ticking a hidden column shows its header and cells, and unticking hides them again", async () => {
  const el = await table({ columns: choosable });
  await choose(el, "extra");
  expect(chooserBox(el, "extra").checked).toBe(true);
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  expect(rowText(el)).toEqual(["Bea2xb", "Ada10xa"]);
  await choose(el, "count");
  expect(chooserBox(el, "count").checked).toBe(false);
  expect(headers(el)).toEqual(["Name", "Extra"]);
  expect(rowText(el)).toEqual(["Beaxb", "Adaxa"]);
});

test("a selectable table keeps its selection column while columns are hidden", async () => {
  const el = await table({ columns: choosable, selectable: true, selected: [] });
  await choose(el, "count");
  expect(headers(el)).toEqual(["", "Name"]);
  expect(el.shadowRoot!.querySelector("thead th.select [data-test=select-all]")).not.toBeNull();
  const firstRow = el.shadowRoot!.querySelector('tbody tr[data-row-key="b"]')!;
  expect([...firstRow.querySelectorAll("td")].map((cell) => cell.textContent!.trim())).toEqual([
    "",
    "Bea",
  ]);
});

test("hiding a clickable table's first column moves the row activator to the first shown cell", async () => {
  const cols: DataTableColumn<Row>[] = [
    { ...choosable[1]! },
    { key: "name", label: "Name", cell: (row) => row.name },
  ];
  const el = await table({ columns: cols, rowClick: (row: Row) => row.id });
  await choose(el, "count");
  const cells = el.shadowRoot!.querySelectorAll('tbody tr[data-row-key="b"] td');
  expect(cells.length).toBe(1);
  expect(cells[0]!.querySelector(".row-activate")).not.toBeNull();
});

const choosableTree: DataTableColumn<TreeRow>[] = [
  { ...treeColumns[0]!, choosable: "shown" },
  { key: "code", label: "Code", cell: (row) => row.id, choosable: "hidden" },
];

test("a tree shows and hides chosen columns, and its first shown column carries the toggle", async () => {
  const el = await treeTable({ columns: choosableTree, selectable: true, selected: [] });
  expect(headers(el)).toEqual(["", "Name"]);
  await choose(el, "code");
  expect(headers(el)).toEqual(["", "Name", "Code"]);
  await choose(el, "name");
  expect(headers(el)).toEqual(["", "Code"]);
  const cells = [...el.shadowRoot!.querySelectorAll<HTMLElement>('tr[data-row-key="food"] td')];
  expect(cells.length).toBe(2);
  expect(cells[0]!.classList.contains("select")).toBe(true);
  expect(cells[1]!.querySelector("button.tree-toggle")).not.toBeNull();
  expect(cells[1]!.textContent!.trim()).toContain("food");
  expect(cells[1]!.getAttribute("role")).toBe("gridcell");
});

test("a tree without selection hides a chosen column's header and cells", async () => {
  const el = await treeTable({ columns: choosableTree });
  await choose(el, "code");
  expect(headers(el)).toEqual(["Name", "Code"]);
  expect(
    [...el.shadowRoot!.querySelectorAll('tr[data-row-key="eggs"] td')].map((cell) =>
      cell.textContent!.trim(),
    ),
  ).toEqual(["Eggs", "eggs"]);
});

test("the last shown column cannot be hidden: its box is disabled until another is shown", async () => {
  const all: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", cell: (row) => row.name, choosable: "shown" },
    { ...choosable[1]! },
    { ...choosable[2]! },
  ];
  const el = await table({ columns: all });
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([false, false, false]);
  await choose(el, "name");
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([false, true, false]);
  await choose(el, "extra");
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([false, false, false]);
});

test("an always-shown column counts, so the one choosable column beside it can still be hidden", async () => {
  const el = await table({ columns: [choosable[0]!, choosable[1]!] });
  expect(chooserBox(el, "count").disabled).toBe(false);
  await choose(el, "count");
  expect(headers(el)).toEqual(["Name"]);
  expect(chooserBox(el, "count").disabled).toBe(false);
});

test("when every column starts hidden, the first one is shown and cannot be hidden", async () => {
  const hidden: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", cell: (row) => row.name, choosable: "hidden" },
    { key: "count", label: "Count", cell: (row) => row.count, choosable: "hidden" },
  ];
  const el = await table({ columns: hidden });
  expect(headers(el)).toEqual(["Name"]);
  expect(chooserBoxes(el).map((box) => [box.checked, box.disabled])).toEqual([
    [true, true],
    [false, false],
  ]);
});

test("a stored choice hiding every column still leaves the first one shown", async () => {
  localStorage.setItem("test.none:columns", JSON.stringify({ name: false, count: false }));
  const cols: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", cell: (row) => row.name, choosable: "shown" },
    { ...choosable[1]! },
  ];
  const el = await table({ columns: cols, viewKey: "test.none" });
  expect(headers(el)).toEqual(["Name"]);
  expect(chooserBox(el, "name").disabled).toBe(true);
});

test("a hidden column's filter dropdown stays drawn and keeps filtering", async () => {
  const cols: DataTableColumn<RowS>[] = [withStatus[0]!, { ...withStatus[1]!, choosable: "shown" }];
  const el = await tableS({ columns: cols });
  await choose(el, "status");
  expect(headers(el)).toEqual(["Name"]);
  const select = statusSelect(el);
  select.value = "off";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
});

test("a hidden column stops sorting the rows, and showing it again restores its sort", async () => {
  const el = await table({ columns: choosable, sortKey: "count", sortDirection: "descending" });
  expect(rowText(el)).toEqual(["Ada10", "Bea2"]);
  await choose(el, "count");
  expect(rowText(el)).toEqual(["Bea", "Ada"]);
  expect(el.sortKey).toBe("count");
  expect(el.sortDirection).toBe("descending");
  expect(el.shadowRoot!.querySelector('th[aria-sort="none"] [data-sort="name"]')).not.toBeNull();
  await choose(el, "count");
  expect(rowText(el)).toEqual(["Ada10", "Bea2"]);
});

test("a hidden column stops sorting a tree's siblings, and showing it again restores its sort", async () => {
  const cols: DataTableColumn<TreeRow>[] = [
    choosableTree[0]!,
    { key: "code", label: "Code", cell: (row) => row.id },
  ];
  const el = await treeTable({ columns: cols, sortKey: "name", sortDirection: "descending" });
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  el.sortDirection = "ascending";
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["drinks", "food", "break", "eggs"]);
  await choose(el, "name");
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  await choose(el, "name");
  expect(treeKeys(el)).toEqual(["drinks", "food", "break", "eggs"]);
});

test("search still reads a hidden column", async () => {
  const el = await table({ columns: choosable, searchable: true });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "extra-a";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(rowText(el)).toEqual(["Ada10"]);
});

test("a chooser change reports every shown column's key, in column order, across shadow boundaries", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns: choosable, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  const seen: string[][] = [];
  document.addEventListener("wt-columns-change", (event) =>
    seen.push((event as CustomEvent<{ shown: string[] }>).detail.shown),
  );
  const rawChange = vi.fn();
  el.shadowRoot!.addEventListener("change", rawChange);
  await choose(el, "extra");
  await choose(el, "count");
  expect(seen).toEqual([
    ["name", "count", "extra"],
    ["name", "extra"],
  ]);
  expect(rawChange).not.toHaveBeenCalled();
});

test("remembers the chosen columns in local storage under the view key", async () => {
  const el = await table({ columns: choosable, viewKey: "test.cols" });
  await choose(el, "extra");
  expect(JSON.parse(localStorage.getItem("test.cols:columns")!)).toEqual({ extra: true });
  await choose(el, "count");
  expect(JSON.parse(localStorage.getItem("test.cols:columns")!)).toEqual({
    extra: true,
    count: false,
  });
  expect(sessionStorage.getItem("test.cols:columns")).toBeNull();
});

test("writes nothing to local storage when no viewKey is set", async () => {
  const el = await table({ columns: choosable });
  await choose(el, "extra");
  expect(localStorage.length).toBe(0);
});

test("restores the chosen columns from local storage under the view key", async () => {
  localStorage.setItem("test.restore:columns", JSON.stringify({ count: false, extra: true }));
  const el = await table({ columns: choosable, viewKey: "test.restore" });
  expect(headers(el)).toEqual(["Name", "Extra"]);
  expect(chooserBoxes(el).map((box) => box.checked)).toEqual([false, true]);
});

test("restores the chosen columns once columns arrive after the viewKey", async () => {
  localStorage.setItem("test.late:columns", JSON.stringify({ extra: true }));
  const el = (await mount(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  el.viewKey = "test.late";
  await el.updateComplete;
  Object.assign(el, { rows, columns: choosable, rowKey: (r: Row) => r.id });
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
});

test("restores the chosen columns when session storage is blocked", async () => {
  localStorage.setItem("test.nosession:columns", JSON.stringify({ count: false }));
  const realGetItem = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (this === sessionStorage) throw new Error("blocked");
    return realGetItem.call(this, key);
  });
  const el = await table({ columns: choosable, viewKey: "test.nosession" });
  expect(headers(el)).toEqual(["Name"]);
});

test("a stored entry for a column that is not choosable is ignored", async () => {
  localStorage.setItem("test.fixed:columns", JSON.stringify({ name: false }));
  const el = await table({ columns: choosable, viewKey: "test.fixed" });
  expect(headers(el)).toEqual(["Name", "Count"]);
});

test("a stored entry that is not true or false is ignored", async () => {
  // Each value reads the opposite of its column's default if taken for its truthiness.
  localStorage.setItem("test.odd:columns", JSON.stringify({ count: 0, extra: "yes" }));
  const el = await table({ columns: choosable, viewKey: "test.odd" });
  expect(headers(el)).toEqual(["Name", "Count"]);
});

test("a stored entry that is not true or false does not stop the others applying", async () => {
  localStorage.setItem("test.mixed:columns", JSON.stringify({ count: "no", extra: true }));
  const el = await table({ columns: choosable, viewKey: "test.mixed" });
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
});

for (const [label, stored] of [
  ["malformed JSON", "{"],
  ["null", "null"],
  ["a number", "7"],
  ["a list", "[false, false]"],
  ["text", '"yes"'],
] as const) {
  test(`a stored column choice that is ${label} is ignored like a first visit`, async () => {
    localStorage.setItem("test.bad:columns", stored);
    const el = await table({ columns: choosable, viewKey: "test.bad" });
    expect(headers(el)).toEqual(["Name", "Count"]);
    await choose(el, "extra");
    expect(JSON.parse(localStorage.getItem("test.bad:columns")!)).toEqual({ extra: true });
  });
}

test("blocked local storage leaves the default columns, and choosing still works", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const el = await table({ columns: choosable, viewKey: "test.blocked" });
  expect(headers(el)).toEqual(["Name", "Count"]);
  const changes = vi.fn();
  el.addEventListener("wt-columns-change", changes);
  await choose(el, "extra");
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  expect(changes).toHaveBeenCalledOnce();
});

test("restores the chosen columns stored under a new viewKey when the key changes", async () => {
  localStorage.setItem("test.second:columns", JSON.stringify({ extra: true }));
  const el = await table({ columns: choosable, viewKey: "test.first" });
  expect(headers(el)).toEqual(["Name", "Count"]);
  el.viewKey = "test.second";
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
});

test("a new viewKey with no stored columns starts from the default columns", async () => {
  const el = await table({ columns: choosable, viewKey: "test.before" });
  await choose(el, "extra");
  el.viewKey = "test.nothing";
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Count"]);
});

test("the column choice and the sort and filter memory are stored apart", async () => {
  const el = await table({ columns: choosable, viewKey: "test.apart" });
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-sort="name"]')!.click();
  await choose(el, "extra");
  expect(JSON.parse(sessionStorage.getItem("test.apart")!).sortKey).toBe("name");
  expect(JSON.parse(sessionStorage.getItem("test.apart")!).columns).toBeUndefined();
  expect(localStorage.getItem("test.apart")).toBeNull();
});

test("the chooser button opens and closes its panel and says whether it is open", async () => {
  const el = await table({ columns: choosable });
  expect(panel(el).matches(":popover-open")).toBe(false);
  expect(trigger(el).getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger(el));
  expect(panel(el).matches(":popover-open")).toBe(true);
  await vi.waitFor(() => expect(trigger(el).getAttribute("aria-expanded")).toBe("true"));
  await userEvent.click(trigger(el));
  expect(panel(el).matches(":popover-open")).toBe(false);
  await vi.waitFor(() => expect(trigger(el).getAttribute("aria-expanded")).toBe("false"));
});

test("Escape closes the chooser and returns focus to its button, and goes no further", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  chooserBox(el, "count").focus();
  const outer = vi.fn();
  host.addEventListener("keydown", outer);
  await userEvent.keyboard("{Escape}");
  expect(panel(el).matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(trigger(el));
  expect(outer).not.toHaveBeenCalled();
});

test("an Escape that closes the chooser is marked handled, so a dialog around it stays open", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  panel(el).dispatchEvent(escape);
  expect(panel(el).matches(":popover-open")).toBe(false);
  expect(escape.defaultPrevented).toBe(true);
});

test("Escape on the chooser button closes the open panel and goes no further", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  trigger(el).focus();
  const outer = vi.fn();
  host.addEventListener("keydown", outer);
  await userEvent.keyboard("{Escape}");
  expect(panel(el).matches(":popover-open")).toBe(false);
  expect(outer).not.toHaveBeenCalled();
});

test("an Escape already handled, or pressed while closed, is left alone", async () => {
  const el = await table({ columns: choosable });
  const closed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  trigger(el).dispatchEvent(closed);
  expect(closed.defaultPrevented).toBe(false);
  await userEvent.click(trigger(el));
  const handled = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  handled.preventDefault();
  panel(el).dispatchEvent(handled);
  expect(panel(el).matches(":popover-open")).toBe(true);
  const other = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  panel(el).dispatchEvent(other);
  expect(other.defaultPrevented).toBe(false);
  expect(panel(el).matches(":popover-open")).toBe(true);
});

test("a press outside the chooser closes it, and a press inside it does not", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  await userEvent.click(chooserBox(el, "extra").closest("label")!);
  expect(panel(el).matches(":popover-open")).toBe(true);
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  await userEvent.click(el.shadowRoot!.querySelector("table")!);
  expect(panel(el).matches(":popover-open")).toBe(false);
});

test("the chooser panel opens under its button, aligned to its end, over the table", async () => {
  // Narrower than the screen on both sides, so the alignment is observed rather than a clamp.
  const el = await table({ columns: choosable, searchable: true });
  el.style.width = "300px";
  el.style.marginInlineStart = "50px";
  await el.updateComplete;
  const tableTop = el.shadowRoot!.querySelector("table")!.getBoundingClientRect().top;
  const firstFrame = new Promise<DOMRect>((resolve) => {
    trigger(el).addEventListener(
      "click",
      () => requestAnimationFrame(() => resolve(panel(el).getBoundingClientRect())),
      { once: true },
    );
  });
  await userEvent.click(trigger(el));
  const bounds = await firstFrame;
  const anchor = trigger(el).getBoundingClientRect();
  expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
  expect(bounds.right).toBeCloseTo(anchor.right, 0);
  expect(el.shadowRoot!.querySelector("table")!.getBoundingClientRect().top).toBe(tableTop);
  expect(bounds.bottom).toBeGreaterThan(tableTop);
});

test("a chooser near the screen's leading edge holds its panel 8px inside it", async () => {
  const cols: DataTableColumn<Row>[] = [
    choosable[0]!,
    { ...choosable[1]!, label: "A much longer column name than the button" },
  ];
  const el = await table({ columns: cols });
  el.style.position = "fixed";
  el.style.insetInlineStart = "0";
  el.style.insetBlockStart = "0";
  el.style.width = "120px";
  await userEvent.click(trigger(el));
  expect(panel(el).getBoundingClientRect().left).toBeCloseTo(8, 0);
});

test("a chooser near the screen's trailing edge holds its panel 8px inside it", async () => {
  const el = await table({ columns: choosable });
  el.style.position = "fixed";
  el.style.insetInlineEnd = "0";
  el.style.insetBlockStart = "0";
  el.style.width = "300px";
  await userEvent.click(trigger(el));
  expect(panel(el).getBoundingClientRect().right).toBeCloseTo(innerWidth - 8, 0);
});

function manyChoosable(count: number): DataTableColumn<Row>[] {
  return [
    choosable[0]!,
    ...Array.from({ length: count }, (_, index) => ({
      key: `extra${index}`,
      label: `Extra ${index}`,
      cell: (row: Row) => `${row.id}${index}`,
      choosable: "shown" as const,
    })),
  ];
}

test("a chooser near the screen's bottom edge holds its panel 8px inside it", async () => {
  const el = await table({ columns: manyChoosable(7) });
  el.style.position = "fixed";
  el.style.insetInlineStart = "0";
  el.style.insetBlockEnd = "0";
  el.style.width = "300px";
  await userEvent.click(trigger(el));
  const bounds = panel(el).getBoundingClientRect();
  expect(bounds.bottom).toBeCloseTo(innerHeight - 8, 0);
  expect(bounds.top).toBeLessThan(trigger(el).getBoundingClientRect().bottom);
});

test("a chooser panel taller than the screen stays 8px inside it and scrolls its choices", async () => {
  const el = await table({ columns: manyChoosable(40) });
  el.style.position = "fixed";
  el.style.insetInlineStart = "0";
  el.style.insetBlockStart = "0";
  el.style.width = "300px";
  await userEvent.click(trigger(el));
  const popup = panel(el);
  const bounds = popup.getBoundingClientRect();
  expect(bounds.top).toBeCloseTo(8, 0);
  expect(bounds.bottom).toBeCloseTo(innerHeight - 8, 0);
  expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
  popup.scrollTop = popup.scrollHeight;
  const last = chooserBox(el, "extra39");
  const lastBounds = last.getBoundingClientRect();
  expect(lastBounds.top).toBeGreaterThanOrEqual(bounds.top);
  expect(lastBounds.bottom).toBeLessThanOrEqual(bounds.bottom);
});

test("the chooser's button and panel paint from the theme tokens", async () => {
  const el = await table({ columns: choosable });
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-primary", "rgb(13, 14, 15)");
  const button = trigger(el);
  expect(getComputedStyle(button).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(button).color).toBe("rgb(10, 11, 12)");
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(52);
  await userEvent.click(button);
  const popup = panel(el);
  expect(getComputedStyle(popup).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(popup).backgroundColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(popup).color).toBe("rgb(10, 11, 12)");
  const box = chooserBox(el, "count");
  expect(getComputedStyle(box).accentColor).toBe("rgb(13, 14, 15)");
  expect(box.closest("label")!.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
});

test("the chooser's button and boxes draw the focus ring when focused", async () => {
  const el = await table({ columns: choosable });
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(4, 5, 6)");
  trigger(el).focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Tab}");
  for (const control of [chooserBox(el, "count"), trigger(el)]) {
    control.focus();
    expect(control.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(control).outlineColor).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(control).outlineStyle).toBe("solid");
  }
});

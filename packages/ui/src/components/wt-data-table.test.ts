import { html } from "lit";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { chooseOption, cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
// For its `parkPointer` command type only.
import type {} from "../a11y-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-button.js";
import "./wt-data-table.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-row-actions.js";

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

test("an unselectable row has no checkbox, and select-all counts only selectable rows", async () => {
  const el = await table({ selectable: true, rowSelectable: (row) => row.id !== "b" });
  expect(el.shadowRoot!.querySelector("[data-test=select-a]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=select-b]")).toBeNull();
  expect(el.shadowRoot!.querySelector('tr[data-row-key="b"] td.select')).not.toBeNull();
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(seen).toEqual([["a"]]);
  el.selected = ["a"];
  await el.updateComplete;
  const header = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  expect(header.checked).toBe(true);
  expect(header.indeterminate).toBe(false);
  header.click();
  expect(seen.at(-1)).toEqual([]);
});

test("an unselectable row leaves the other rows’ position keys unchanged", async () => {
  const el = await table({
    selectable: true,
    rowKey: (_row, index) => String(index),
    rowSelectable: (row) => row.id !== "b",
  });
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(seen.at(-1)).toEqual(["1"]);
  expect(el.shadowRoot!.querySelector("[data-test=select-0]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=select-1]")).not.toBeNull();
});

test("unselectable tree rows keep their empty grid cell and never enter select-all", async () => {
  const el = await treeTable({ selectable: true, rowSelectable: (row) => row.id !== "food" });
  const cell = el.shadowRoot!.querySelector('tr[data-row-key="food"] td.select')!;
  expect(cell.getAttribute("role")).toBe("gridcell");
  expect(cell.querySelector("input")).toBeNull();
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(seen.at(-1)).not.toContain("food");
  expect(seen.at(-1)!.length).toBeGreaterThan(0);
  el.selected = seen.at(-1)!;
  await el.updateComplete;
  el.rowSelectable = () => false;
  await el.updateComplete;
  const header = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!;
  expect(header.checked).toBe(false);
  expect(header.indeterminate).toBe(false);
});

test("a row that becomes unselectable leaves the next individual selection", async () => {
  const el = await table({ selectable: true, selected: ["b"] });
  el.rowSelectable = (row) => row.id !== "b";
  await el.updateComplete;
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-a]")!.click();
  expect(seen).toEqual([["a"]]);
});

test("clearing select-all drops a row that became unselectable", async () => {
  const el = await table({ selectable: true, selected: ["a", "b"] });
  el.rowSelectable = (row) => row.id !== "b";
  await el.updateComplete;
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(seen).toEqual([[]]);
});

test("a hidden unselectable row leaves selection while a hidden selectable row stays", async () => {
  const el = await tableS({
    selectable: true,
    selected: ["1", "2"],
    rows: [...rowsS, { id: "3", name: "Cy", status: "off" }],
    columns: withStatus,
    rowSelectable: (row) => row.id !== "2",
  });
  await chooseOption(statusSelect(el), "active");
  await el.updateComplete;
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-all]")!.click();
  expect(seen).toEqual([[]]);
  el.selected = ["1", "2", "3"];
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-1]")!.click();
  expect(seen.at(-1)).toEqual(["3"]);
});

test("pruning selection uses the sorted row’s position key", async () => {
  const el = await table({
    selectable: true,
    selected: ["1"],
    sortKey: "name",
    rowKey: (_row, index) => String(index),
    rowSelectable: (row) => row.id !== "b",
  });
  const seen: string[][] = [];
  el.addEventListener("wt-selection-change", (event) =>
    seen.push((event as CustomEvent).detail.selected),
  );
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=select-0]")!.click();
  expect(seen).toEqual([["0"]]);
});

test("reports a user filter change once across the shadow boundary and not on restore", async () => {
  sessionStorage.setItem("test.filter-event", JSON.stringify({ filters: { status: "off" } }));
  const seen: CustomEvent[] = [];
  const native = vi.fn();
  const listen = (event: Event) => seen.push(event as CustomEvent);
  document.addEventListener("wt-filter-change", listen);
  document.addEventListener("change", native);
  onTestFinished(() => {
    document.removeEventListener("wt-filter-change", listen);
    document.removeEventListener("change", native);
  });
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<RowS>;
  Object.assign(el, {
    rows: rowsS,
    columns: withStatus,
    rowKey: (row: RowS) => row.id,
    viewKey: "test.filter-event",
  });
  await el.updateComplete;
  expect(seen).toEqual([]);
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  expect(select.value).toBe("off");
  await chooseOption(select, "active");
  expect(seen).toHaveLength(1);
  expect(seen[0]!.detail).toEqual({ filters: { status: "active" } });
  expect(seen[0]!.bubbles).toBe(true);
  expect(seen[0]!.composed).toBe(true);
  expect(native).not.toHaveBeenCalled();
  await chooseOption(select, "");
  expect(seen[1]!.detail).toEqual({ filters: {} });
  expect(seen[0]!.detail).toEqual({ filters: { status: "active" } });
});

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
  expect(el.isExpanded("food")).toBe(true);
  el.setExpanded("food", false);
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  expect(el.isExpanded("food")).toBe(true);
});

test("a branch closed before it became always-open is drawn open, with no toggle", async () => {
  const el = await treeTable({ initiallyCollapsed: true });
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  el.rowCollapsible = (row: TreeRow) => row.id !== "food";
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  const food = el.shadowRoot!.querySelector('tr[data-row-key="food"]')!;
  expect(food.querySelector("button.tree-toggle")).toBeNull();
  expect(food.getAttribute("aria-expanded")).toBe("true");
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

test("revealRow of a row whose parent is not in the table scrolls it into view", async () => {
  const el = await treeTable({
    rows: [...treeRows, { id: "stray", parent: "gone", name: "Stray" }],
    initiallyCollapsed: true,
  });
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  await el.revealRow("stray");
  expect(treeKeys(el)).toEqual(["food", "drinks", "stray"]);
  expect(scrolled).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
  expect(scrolled.mock.contexts[0]).toBe(el.shadowRoot!.querySelector('tr[data-row-key="stray"]'));
});

test("revealRow stops at parents that point at each other", async () => {
  const el = await treeTable({ rows: loopingRows });
  await expect(el.revealRow("x")).resolves.toBeUndefined();
});

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
    rowToggleLabel: (row: TreeRow, expanded: boolean) =>
      `${expanded ? "Close" : "Open"} ${row.name}`,
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
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>('button[aria-label="Edit Food"]')!,
  );
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
  const cell = el.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="food"] td[data-pinned="end"]',
  )!;
  const box = cell.getBoundingClientRect();
  await userEvent.click(cell, { position: { x: box.width - 2, y: 2 } });
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

/** A resize is reported after layout and before the next paint, so the table has seen a new width by
 * the second frame. */
async function frames(): Promise<void> {
  for (let i = 0; i < 2; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
}

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
  await frames();
  expect(el.hasAttribute("narrow")).toBe(true);
  expect(["a", "b", "e", "f"].map(indent)).toEqual(["0px", "8px", "32px", "32px"]);
  el.style.width = "600px";
  await frames();
  expect(el.hasAttribute("narrow")).toBe(false);
  expect(["a", "b", "e", "f"].map(indent)).toEqual(["0px", "16px", "64px", "80px"]);
});

test("a row that joins its parent is indented as its parent is, at either width, and is still a level down", async () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const deep: TreeRow[] = ids.map((id, index) => ({
    id,
    parent: index === 0 ? null : ids[index - 1]!,
    name: id.toUpperCase(),
  }));
  const el = await treeTable({ rows: deep, rowJoinsParent: (row) => row.id === "f" });
  host.style.setProperty("--wt-space-2", "8px");
  host.style.setProperty("--wt-space-4", "16px");
  const indent = (key: string) =>
    getComputedStyle(
      el.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"] .tree-cell`)!,
    ).paddingInlineStart;
  el.style.width = "360px";
  await frames();
  expect(["d", "e", "f"].map(indent)).toEqual(["24px", "32px", "32px"]);
  el.style.width = "600px";
  await frames();
  expect(["d", "e", "f"].map(indent)).toEqual(["48px", "64px", "64px"]);
  const level = (key: string) =>
    el.shadowRoot!.querySelector(`tr[data-row-key="${key}"]`)!.getAttribute("aria-level");
  expect([level("e"), level("f")]).toEqual(["5", "6"]);
});

test("a row that joins its parent sits on the band colour, pinned cell too, and still shows hover", async () => {
  type Joined = TreeRow & { joins?: boolean };
  const el = (await mount(
    '<wt-data-table aria-label="Products"></wt-data-table>',
  )) as WtDataTable<Joined>;
  Object.assign(el, {
    rows: [
      { id: "bun", parent: null, name: "Bun" },
      { id: "small", parent: "bun", name: "Small", joins: true },
    ] satisfies Joined[],
    columns: [
      { key: "name", label: "Name", cell: (row: Joined) => row.name },
      { key: "actions", label: "Actions", pinned: "end", cell: () => "⋮" },
    ] satisfies DataTableColumn<Joined>[],
    rowKey: (row: Joined) => row.id,
    rowParent: (row: Joined) => row.parent,
    rowJoinsParent: (row: Joined) => row.joins === true,
    rowClick: () => {},
  });
  await el.updateComplete;
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 40, 50)");
  const cells = (key: string) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>(`tr[data-row-key="${key}"] td`),
  ];
  for (const cell of cells("small"))
    expect(getComputedStyle(cell).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(cells("bun")[0]!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(cells("bun")[1]!).backgroundColor).toBe("rgb(7, 8, 9)");
  await userEvent.hover(cells("small")[0]!);
  onTestFinished(() => commands.parkPointer());
  for (const cell of cells("small"))
    expect(getComputedStyle(cell).backgroundColor).toBe("rgb(30, 40, 50)");
  el.rowClick = undefined;
  await el.updateComplete;
  await commands.parkPointer();
  await userEvent.hover(cells("small")[0]!);
  expect(el.shadowRoot!.querySelector('tr[data-row-key="small"]')!.matches(".clickable")).toBe(
    false,
  );
  for (const cell of cells("small"))
    expect(getComputedStyle(cell).backgroundColor).toBe("rgb(30, 40, 50)");
});

test("a branch's toggle button is exposed as a part, so a screen can size and colour it", async () => {
  const el = await treeTable();
  const toggle = el.shadowRoot!.querySelector('tr[data-row-key="food"] button.tree-toggle')!;
  expect(toggle.part.contains("tree-toggle")).toBe(true);
});

// The width compared is the scroll box's inside its border, which is what clientWidth reports here.
test("the phone indent starts at a 440px box, not at 441px, and a flat table never takes it", async () => {
  const el = await treeTable();
  host.style.setProperty("--wt-space-2", "8px");
  host.style.setProperty("--wt-space-4", "16px");
  const indent = () =>
    getComputedStyle(
      el.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="break"] .tree-cell')!,
    ).paddingInlineStart;
  const box = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  el.style.width = "443px";
  await frames();
  expect(box.clientWidth).toBe(441);
  expect(indent()).toBe("16px");
  el.style.width = "442px";
  await frames();
  expect(box.clientWidth).toBe(440);
  expect(indent()).toBe("8px");
  cleanup();
  const flat = await table();
  flat.style.width = "360px";
  await frames();
  expect(flat.hasAttribute("narrow")).toBe(false);
});

test("a tree that becomes a flat table drops its phone indent", async () => {
  const el = await treeTable();
  el.style.width = "360px";
  await frames();
  expect(el.hasAttribute("narrow")).toBe(true);
  el.rowParent = undefined;
  await el.updateComplete;
  await frames();
  expect(el.hasAttribute("narrow")).toBe(false);
});

test("a tree stops watching its width while it is out of the page, and watches again when it returns", async () => {
  const el = await treeTable();
  el.style.width = "600px";
  await frames();
  expect(el.hasAttribute("narrow")).toBe(false);
  el.remove();
  await frames();
  expect(el.hasAttribute("narrow")).toBe(false);
  el.style.width = "360px";
  host.append(el);
  await frames();
  expect(el.hasAttribute("narrow")).toBe(true);
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

test("a tree without rowClick draws no activator on a row left to click", async () => {
  const el = await treeTable();
  expect(el.shadowRoot!.querySelector(".row-activate")).toBeNull();
  expect(el.shadowRoot!.querySelector("tr.clickable")).toBeNull();
});

test("a toggling row's activator stops its click once it has toggled", async () => {
  const el = await treeTable({ rowActivation: () => "toggle" });
  const clicks = vi.fn();
  el.addEventListener("click", clicks);
  el.shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] .row-activate')!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  expect(clicks).not.toHaveBeenCalled();
});

test("a real click on a control inside a toggling tree row's pinned cell does not toggle it", async () => {
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
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>('button[aria-label="Edit Food"]')!,
  );
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
});

test.each([
  { position: "unpinned", pinned: undefined },
  { position: "pinned", pinned: "end" as const },
])(
  "a $position tree column can keep its blank space outside row activation",
  async ({ pinned }) => {
    const el = await treeTable({
      rowActivation: () => "toggle",
      columns: [
        ...treeColumns,
        {
          key: "action",
          label: "Actions",
          pinned,
          activatesRow: false,
          cell: (row: TreeRow) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
        },
      ],
    });
    const cell = el.shadowRoot!.querySelector<HTMLElement>(
      'tr[data-row-key="food"] td:last-child',
    )!;
    const box = cell.getBoundingClientRect();
    expect(el.shadowRoot!.elementFromPoint(box.x + 2, box.y + 2)).toBe(cell);
    await userEvent.click(cell, { position: { x: 2, y: 2 } });
    await el.updateComplete;
    expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
  },
);

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
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toBe("Nothing matches");
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

test("says 'Nothing matches your search or filters.' when a search clears the table and the consumer named no message", async () => {
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
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toContain(
    "Nothing matches your search or filters.",
  );
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

test("an empty source table shows only its empty state, even with an initial filter", async () => {
  const status = withStatus[1]!;
  const el = await tableS({
    rows: [],
    searchable: true,
    columns: [withStatus[0]!, { ...status, filter: { ...status.filter!, initial: "active" } }],
    emptyMessage: "No users yet",
  });
  expect(el.shadowRoot!.querySelector(".table-toolbar")).toBeNull();
  expect(el.shadowRoot!.querySelector(".empty")!.textContent).toContain("No users yet");
});

test("a filter on its initial choice counts in the panel badge and can be cleared", async () => {
  const status = withStatus[1]!;
  const el = await tableS({
    columns: [withStatus[0]!, { ...status, filter: { ...status.filter!, initial: "active" } }],
  });
  const root = el.shadowRoot!;
  const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
  expect(trigger.textContent).toContain("1");
  expect(rowKeysS(el)).toEqual(["1"]);
  trigger.click();
  await el.updateComplete;
  expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(true);
  expect(root.querySelector(".filters-panel h2")!.textContent).toBe("Filters");
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "");
  await el.updateComplete;
  expect(trigger.textContent).not.toContain("1");
  expect(rowKeysS(el)).toEqual(["1", "2"]);
});

test("Filters shows plain named sections with choices always available and no per-filter Clear", async () => {
  const el = await tableS({ columns: withStatus });
  const root = el.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  await el.updateComplete;
  const panel = root.querySelector<HTMLElement>(".filters-panel")!;
  const section = panel.querySelector<HTMLElement>('[data-section="status"]')!;
  expect(section.querySelector("h3")?.textContent?.trim()).toBe("Filter by status");
  expect(section.querySelector("details, summary, .filter-clear")).toBeNull();
  expect(section.textContent).not.toContain("(2)");
  const filter = section.querySelector<WtCombobox>("wt-combobox")!;
  await chooseOption(filter, "active");
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  await chooseOption(filter, "");
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
});

test("a hidden column's filter remains in the panel and clear all restores every row", async () => {
  const el = await tableS({
    columns: [withStatus[0]!, { ...withStatus[1]!, choosable: "hidden" }],
    viewKey: "test.hidden-filter",
  });
  const root = el.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  await el.updateComplete;
  const filter = root.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  expect(filter).not.toBeNull();
  await chooseOption(filter, "active");
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  expect(root.querySelector(".filters-trigger")!.textContent).toContain("1");
  root.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(root.querySelector(".filters-trigger")!.textContent).not.toContain("1");
});

test("a filtered heading marks only its active column and focuses that panel section", async () => {
  const el = await tableS({
    columns: [withStatus[0]!, { ...withStatus[1]!, key: "other-status" }, withStatus[1]!],
  });
  const root = el.shadowRoot!;
  expect(root.querySelector("[data-filter-mark]")).toBeNull();
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "off");
  await el.updateComplete;
  const mark = root.querySelector<HTMLButtonElement>('[data-filter-mark="status"]')!;
  expect(mark.getAttribute("aria-label")).toBe("Filter by status: Filtered");
  expect(
    mark.querySelector("wt-icon")!.shadowRoot!.querySelector("path")!.getAttribute("d"),
  ).toBeTruthy();
  expect(root.querySelector('[data-filter-mark="name"]')).toBeNull();
  mark.click();
  await el.updateComplete;
  expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(true);
  const filter = root.querySelector<WtCombobox>('[data-section="status"] .table-filter')!;
  expect(filter.shadowRoot!.activeElement).toBe(filter.shadowRoot!.querySelector(".trigger"));
});

test("the Filters panel closes from its own button and returns focus to its trigger", async () => {
  const el = await tableS({ columns: withStatus });
  const root = el.shadowRoot!;
  const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
  trigger.click();
  await el.updateComplete;
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  root.querySelector<HTMLButtonElement>(".filters-close")!.click();
  await el.updateComplete;
  expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(root.activeElement).toBe(trigger);
});

test("the Filters trigger closes its open panel", async () => {
  const el = await tableS({ columns: withStatus });
  const root = el.shadowRoot!;
  const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
  trigger.click();
  await el.updateComplete;
  trigger.click();
  await el.updateComplete;
  expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("a pointer click on the open Filters trigger closes the panel", async () => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(1280, 900);
  try {
    const el = await tableS({ columns: withStatus });
    const root = el.shadowRoot!;
    const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
    await userEvent.click(trigger);
    expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(true);
    await userEvent.click(trigger);
    expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(false);
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("restoring source rows does not announce a closed Filters panel as expanded", async () => {
  const el = await tableS({ columns: withStatus });
  const root = el.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  el.rows = [];
  await el.updateComplete;
  el.rows = rowsS;
  await el.updateComplete;
  expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(false);
  expect(root.querySelector(".filters-trigger")!.getAttribute("aria-expanded")).toBe("false");
});

test("a press outside the Filters panel closes it and updates its trigger", async () => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(1280, 900);
  try {
    const el = await tableS({ columns: withStatus });
    const root = el.shadowRoot!;
    const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
    await userEvent.click(trigger);
    expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(true);
    await userEvent.click(root.querySelector("table")!);
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(false);
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("opening Filters moves focus inside; Escape closes it without reaching a surrounding dialog", async () => {
  const status = withStatus[1]!;
  const el = await tableS({
    columns: [withStatus[0]!, { ...status, filter: { ...status.filter!, initial: "active" } }],
  });
  const root = el.shadowRoot!;
  const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
  const parent = document.createElement("div");
  let escaped = 0;
  parent.addEventListener("keydown", (event) => {
    if (event.key === "Escape") escaped++;
  });
  parent.append(el);
  host.append(parent);
  await userEvent.click(trigger);
  const filter = root.querySelector<WtCombobox>(".filter-section .table-filter")!;
  expect(filter.shadowRoot!.activeElement).toBe(filter.shadowRoot!.querySelector(".trigger"));
  expect(rowKeysS(el)).toEqual(["1"]);
  await userEvent.keyboard("{Escape}");
  expect(root.querySelector(".filters-panel")!.matches(":popover-open")).toBe(false);
  expect(root.activeElement).toBe(trigger);
  expect(escaped).toBe(0);
});

test("a restored filter appears in the badge and clear all updates stored choices", async () => {
  sessionStorage.setItem("test.filters-panel", JSON.stringify({ filters: { status: "off" } }));
  const el = await tableS({ columns: withStatus, viewKey: "test.filters-panel" });
  const root = el.shadowRoot!;
  expect(root.querySelector(".filters-trigger")!.textContent).toContain("1");
  expect(rowKeysS(el)).toEqual(["2"]);
  root.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
  expect(JSON.parse(sessionStorage.getItem("test.filters-panel")!).filters).toEqual({});
});

test("Clear all reports a change once, even when pressed again", async () => {
  const el = await tableS({ columns: withStatus });
  const changes: Record<string, string>[] = [];
  el.addEventListener("wt-filter-change", (event) =>
    changes.push((event as CustomEvent<{ filters: Record<string, string> }>).detail.filters),
  );
  await chooseOption(el.shadowRoot!.querySelector<WtCombobox>('[data-filter="status"]')!, "off");
  const clear = el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!;
  clear.click();
  await el.updateComplete;
  clear.click();
  await el.updateComplete;
  expect(changes).toEqual([{ status: "off" }, {}]);
});

test("the Filters badge counts separate active columns", async () => {
  const el = await tableS({ rows: twoFilterRows, columns: twoFilterColumns });
  const root = el.shadowRoot!;
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="name"]')!, "Ada");
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "active");
  await el.updateComplete;
  expect(root.querySelector(".filters-trigger")!.textContent).toContain("2");
  expect(rowKeysS(el)).toEqual(["1"]);
});

test("clear all removes a saved choice while its options are waiting", async () => {
  sessionStorage.setItem("test.filters-waiting", JSON.stringify({ filters: { status: "off" } }));
  const el = await tableS({
    columns: statusOffering([]),
    viewKey: "test.filters-waiting",
  });
  const root = el.shadowRoot!;
  expect(root.querySelector(".filters-trigger")!.textContent).not.toContain("1");
  root.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
  await el.updateComplete;
  expect(JSON.parse(sessionStorage.getItem("test.filters-waiting")!).filters).toEqual({});
  el.columns = withStatus;
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
});

test("a column's Any choice removes its saved choice while options are waiting", async () => {
  sessionStorage.setItem("test.filter-waiting", JSON.stringify({ filters: { status: "off" } }));
  const el = await tableS({ columns: statusOffering([]), viewKey: "test.filter-waiting" });
  await chooseOption(el.shadowRoot!.querySelector<WtCombobox>('[data-filter="status"]')!, "");
  await el.updateComplete;
  expect(JSON.parse(sessionStorage.getItem("test.filter-waiting")!).filters).toEqual({});
  el.columns = withStatus;
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "2"]);
});

test("a filter that hides every source row keeps the Filters button available", async () => {
  const status = withStatus[1]!;
  const el = await tableS({
    rows: [rowsS[1]!],
    columns: [withStatus[0]!, { ...status, filter: { ...status.filter!, initial: "active" } }],
    noMatchesMessage: "No matching users",
  });
  expect(rowKeysS(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector(".filters-trigger")).not.toBeNull();
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toContain("No matching users");
});

test.each([390, 1280])("the Filters panel fits its %i px viewport", async (width) => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(width, 900);
  try {
    const el = await tableS({ columns: withStatus });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const panel = el.shadowRoot!.querySelector<HTMLElement>(".filters-panel")!;
    const box = panel.getBoundingClientRect();
    if (width === 390) {
      expect(box.left).toBeCloseTo(0, 0);
      expect(box.width).toBeCloseTo(390, 0);
      expect(box.height).toBeCloseTo(900, 0);
    } else {
      expect(box.width).toBeLessThan(390);
      expect(box.right).toBeLessThanOrEqual(1280);
      expect(box.left).toBeGreaterThanOrEqual(0);
    }
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("the desktop Filters panel opens just beside a table when there is room", async () => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(1280, 900);
  try {
    const el = await tableS({ columns: withStatus });
    el.style.width = "300px";
    el.style.marginInlineStart = "50px";
    el.style.marginBlockStart = "40px";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const table = el.getBoundingClientRect();
    const panel = el
      .shadowRoot!.querySelector<HTMLElement>(".filters-panel")!
      .getBoundingClientRect();
    expect(panel.left).toBeCloseTo(table.right + 8, 0);
    expect(panel.top).toBeCloseTo(table.top, 0);
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("the Filters panel fills a phone after it was opened beside a desktop table", async () => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(1280, 900);
  try {
    const el = await tableS({ columns: withStatus });
    const root = el.shadowRoot!;
    const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
    const panel = root.querySelector<HTMLElement>(".filters-panel")!;
    trigger.click();
    panel.hidePopover();
    await page.viewport(390, 900);
    trigger.click();
    expect(panel.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(panel.getBoundingClientRect().width).toBeCloseTo(390, 0);
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("an open Filters panel remains reachable when the viewport becomes a phone", async () => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(1280, 900);
  try {
    const el = await tableS({ columns: withStatus });
    const root = el.shadowRoot!;
    root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const panel = root.querySelector<HTMLElement>(".filters-panel")!;
    await page.viewport(390, 900);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.getBoundingClientRect().left).toBeCloseTo(0, 0);
    expect(panel.getBoundingClientRect().width).toBeCloseTo(390, 0);
    expect(
      root.querySelector<HTMLButtonElement>(".filters-close")!.getBoundingClientRect().right,
    ).toBeLessThanOrEqual(390);
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("Tab stays inside the full-screen Filters panel on a phone", async () => {
  const previousWidth = innerWidth;
  const previousHeight = innerHeight;
  await page.viewport(390, 900);
  try {
    const el = await tableS({
      columns: [...withStatus, { ...withStatus[1]!, key: "other-status" }],
    });
    const root = el.shadowRoot!;
    root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
    const panel = root.querySelector<HTMLElement>(".filters-panel")!;
    const first = panel.querySelector<WtCombobox>(".filter-section .table-filter")!;
    expect(first.shadowRoot!.activeElement).toBe(first.shadowRoot!.querySelector(".trigger"));
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(root.activeElement).toBe(panel.querySelector(".filters-close"));
    const combobox = panel.querySelectorAll<WtCombobox>("wt-combobox")[1]!;
    const last = combobox.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
    last.focus();
    await userEvent.keyboard("{Tab}");
    expect(panel.contains(root.activeElement)).toBe(true);
    expect(root.activeElement).toBe(panel.querySelector(".filters-clear-all"));
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(root.activeElement).toBe(combobox);
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("the Filters panel and filtered heading mark paint from theme tokens", async () => {
  const status = withStatus[1]!;
  const el = await tableS({
    columns: [withStatus[0]!, { ...status, filter: { ...status.filter!, initial: "active" } }],
  });
  host.style.setProperty("--wt-color-surface", "rgb(12, 23, 34)");
  host.style.setProperty("--wt-color-border", "rgb(45, 56, 67)");
  host.style.setProperty("--wt-color-primary", "rgb(78, 89, 100)");
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  const root = el.shadowRoot!;
  const panel = root.querySelector<HTMLElement>(".filters-panel")!;
  const mark = root.querySelector<HTMLElement>(".filter-mark")!;
  const badge = root.querySelector<HTMLElement>(".filters-count")!;
  expect(getComputedStyle(panel).backgroundColor).toBe("rgb(12, 23, 34)");
  expect(getComputedStyle(panel).borderTopColor).toBe("rgb(45, 56, 67)");
  expect(getComputedStyle(mark).color).toBe("rgb(78, 89, 100)");
  expect(getComputedStyle(badge).backgroundColor).toBe("rgb(78, 89, 100)");
});

test("renders one dropdown per filtered column and narrows on selection", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  expect(select.options.map((o) => o.label)).toEqual(["Any status", "Active", "Inactive"]);
  await chooseOption(select, "active");
  await el.updateComplete;
  expect(rowTextS(el).every((t) => t.includes("Active"))).toBe(true);
});

test("each filter is a compact dropdown named by its label, showing its all option until one is chosen", async () => {
  const el = await tableS({ columns: withStatus });
  const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  expect(filter.label).toBe("Filter by status");
  expect(filter.hideLabel).toBe(true);
  expect(filter.search).toBe("auto");
  expect(filter.options).toEqual([
    { value: "", label: "Any status" },
    { value: "active", label: "Active" },
    { value: "off", label: "Inactive" },
  ]);
  expect(filter.value).toBe("");
  await filter.updateComplete;
  const shown = () => filter.shadowRoot!.querySelector(".trigger .value")!.textContent!.trim();
  expect(shown()).toBe("Any status");
  await chooseOption(filter, "off");
  expect(shown()).toBe("Inactive");
});

test("a table filter keeps the width of its longest choice as the selection changes", async () => {
  const status = withStatus[1]!;
  const el = await tableS({
    columns: [
      withStatus[0]!,
      {
        ...status,
        filter: {
          ...status.filter!,
          options: [status.filter!.options[0]!, { value: "off", label: "Awaiting review" }],
        },
      },
    ],
  });
  const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  await filter.updateComplete;
  const width = filter.getBoundingClientRect().width;
  await chooseOption(filter, "active");
  await el.updateComplete;
  await filter.updateComplete;
  expect(filter.getBoundingClientRect().width).toBeCloseTo(width, 0);
  await chooseOption(filter, "off");
  await el.updateComplete;
  await filter.updateComplete;
  expect(filter.getBoundingClientRect().width).toBeCloseTo(width, 0);
  expect(
    filter.shadowRoot!.querySelector<HTMLElement>(".trigger .value")!.scrollWidth,
  ).toBeLessThanOrEqual(
    filter.shadowRoot!.querySelector<HTMLElement>(".trigger .value")!.clientWidth,
  );
});

test("the all filter option is painted as a chosen value", async () => {
  const el = await tableS({ columns: withStatus });
  const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  await filter.updateComplete;
  const shown = filter.shadowRoot!.querySelector<HTMLElement>(".trigger .value")!;
  expect(shown.textContent).toBe("Any status");
  expect(shown.classList.contains("placeholder")).toBe(false);
  expect(getComputedStyle(shown).fontStyle).toBe("normal");
});

test("picking a row in a filter's open list narrows the rows and reports the choice", async () => {
  const el = await tableS({ columns: withStatus });
  const seen: unknown[] = [];
  el.addEventListener("wt-filter-change", (event) => seen.push((event as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  await filter.updateComplete;
  const row = [...filter.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent!.trim() === "Inactive",
  )!;
  await userEvent.click(row);
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
  expect(seen).toEqual([{ filters: { status: "off" } }]);
});

test("a filter dropdown's own change stays inside the table", async () => {
  const escaped = vi.fn();
  document.addEventListener("wt-change", escaped);
  onTestFinished(() => document.removeEventListener("wt-change", escaped));
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<RowS>;
  Object.assign(el, { rows: rowsS, columns: withStatus, rowKey: (row: RowS) => row.id });
  await el.updateComplete;
  await chooseOption(
    el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!,
    "off",
  );
  expect(escaped).not.toHaveBeenCalled();
});

test("noMatchesMessage shows when a filter, with nothing searched, hides every row", async () => {
  const el = await tableS({
    columns: withStatus,
    rows: [rowsS[1]!],
    noMatchesMessage: "Hidden by a filter",
  });
  expect(el.shadowRoot!.querySelector(".table-search")).toBeNull();
  await chooseOption(
    el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!,
    "active",
  );
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector(".message")!.textContent).toBe("Hidden by a filter");
  expect(el.shadowRoot!.querySelector(".table-toolbar")).not.toBeNull();
});

test("filter dropdowns render and narrow rows without a search box", async () => {
  const el = await tableS({ columns: withStatus });
  expect(el.shadowRoot!.querySelector(".table-search")).toBeNull();
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  await chooseOption(select, "off");
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
  expect(el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!.name).toBe(
    "status-filter",
  );
});

test("the search box draws a primary border, and a filter dropdown the 2px primary line, when focused", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  host.style.setProperty("--wt-color-primary", "rgb(7, 8, 9)");
  const search = el.shadowRoot!.querySelector<HTMLElement>(".table-search")!;
  search.focus();
  expect(search.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(search).borderColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(search).outlineStyle).toBe("none");
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!.focus();
  expect(getComputedStyle(filter.shadowRoot!.querySelector(".field")!).boxShadow).toBe(
    "rgb(7, 8, 9) 0px -2px 0px 0px inset",
  );
});

test("the search box and filter dropdown paint from the theme tokens", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-close")!.focus();
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-field-fill", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-color-field-line", "rgb(16, 17, 18)");
  host.style.setProperty("--wt-color-field-value", "rgb(19, 20, 21)");
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  const filter = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  const box = filter.shadowRoot!.querySelector(".field")!;
  expect(getComputedStyle(search).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(search).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(search).color).toBe("rgb(10, 11, 12)");
  expect(search.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(box).backgroundColor).toBe("rgb(13, 14, 15)");
  expect(getComputedStyle(box).boxShadow).toBe("rgb(16, 17, 18) 0px -1px 0px 0px inset");
  expect(getComputedStyle(filter.shadowRoot!.querySelector(".trigger")!).color).toBe(
    "rgb(19, 20, 21)",
  );
  expect(filter.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
});

test("the search box rounds its corners to the medium radius, not into a pill", async () => {
  const el = await tableS({ searchable: true });
  host.style.setProperty("--wt-radius-md", "7px");
  host.style.setProperty("--wt-radius-full", "9999px");
  const style = getComputedStyle(el.shadowRoot!.querySelector(".table-search")!);
  expect([
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]).toEqual(["7px", "7px", "7px", "7px"]);
});

test("the toolbar keeps a usable search box beside the Filters button at phone width", async () => {
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
    .shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!
    .getBoundingClientRect();
  expect(filters.top).toBeGreaterThanOrEqual(search.bottom);
  expect(search.width).toBeCloseTo(toolbar.width, 0);
});

test("the toolbar keeps the search box and Filters button on one line when wide", async () => {
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
    .shadowRoot!.querySelector<HTMLElement>(".filters-trigger")!
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
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
  input.value = "ada";
  input.dispatchEvent(new Event("input"));
  await chooseOption(select, "off");
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
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="state"]')!;
  await chooseOption(select, "active");
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
  const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="tags"]')!;
  const keys = () =>
    [...el.shadowRoot!.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-row-key"));
  await chooseOption(select, "a");
  await el.updateComplete;
  expect(keys()).toEqual(["1"]);
  await chooseOption(select, "b");
  await el.updateComplete;
  expect(keys()).toEqual(["1", "2"]);
});

test("a column with no filter contributes no dropdown", async () => {
  const el = await tableS({ searchable: true, columns: withStatus });
  expect(el.shadowRoot!.querySelectorAll("wt-combobox[data-filter]").length).toBe(1);
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
  expect(el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!.value).toBe(
    "off",
  );
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
function statusSelect(el: WtDataTable<RowS>): WtCombobox {
  return el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;
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
  await chooseOption(statusSelect(el), "off");
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
  await chooseOption(statusSelect(el), "off");
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
    el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="name"]')!;
  await chooseOption(nameFilter(), "Ada");
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1", "3"]);
  await chooseOption(statusSelect(el), "active");
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["1"]);
  expect(nameFilter().value).toBe("Ada");
});

test("choosing the all option again removes the stored filter choice", async () => {
  const el = await tableS({ viewKey: "test.cleared", columns: withStatus });
  await chooseOption(statusSelect(el), "active");
  await el.updateComplete;
  expect(storedFilters("test.cleared")).toEqual({ status: "active" });
  await chooseOption(statusSelect(el), "");
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

/** Eight statuses and the all row: more than a filter's list shows without a search box. */
const manyStatuses = statusOffering(
  Array.from({ length: 8 }, (_, index) => ({ value: `s${index}`, label: `Status ${index}` })),
);

/** Opens the filter's list, reads its search box's placeholder, then searches for text no row has
 * and reads the list's empty text. */
async function filterSearchWording(filter: WtCombobox): Promise<[string, string]> {
  const root = filter.getRootNode() as ShadowRoot;
  if (!root.querySelector(".filters-panel")!.matches(":popover-open"))
    root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  await filter.updateComplete;
  const search = filter.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  const placeholder = search.placeholder;
  await userEvent.type(search, "zzz");
  await filter.updateComplete;
  return [placeholder, filter.shadowRoot!.querySelector(".empty")!.textContent!.trim()];
}

test("a long filter's search box and empty list read the table's filter wording", async () => {
  const el = await tableS({
    columns: manyStatuses,
    filterSearchPlaceholder: "Buscar",
    filterNoResultsLabel: "Sin resultados",
  });
  expect(await filterSearchWording(statusSelect(el))).toEqual(["Buscar", "Sin resultados"]);
});

test("a long filter's search box and empty list read English wording by default", async () => {
  const el = await tableS({ columns: manyStatuses });
  expect(await filterSearchWording(statusSelect(el))).toEqual(["Search", "No results"]);
});

/** Opens the filter's list and clicks the row labelled `label`, as a person would. */
async function clickFilterRow(filter: WtCombobox, label: string): Promise<void> {
  const root = filter.getRootNode() as ShadowRoot;
  if (!root.querySelector(".filters-panel")!.matches(":popover-open"))
    root.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  await userEvent.click(filter.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
  await filter.updateComplete;
  const row = [...filter.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent!.trim() === label,
  )!;
  await userEvent.click(row);
  await filter.updateComplete;
}

test("clicking the all row while nothing is chosen reports nothing and remembers nothing", async () => {
  const el = await tableS({ viewKey: "test.reclick-all", columns: withStatus });
  const seen: unknown[] = [];
  el.addEventListener("wt-filter-change", (event) => seen.push((event as CustomEvent).detail));
  await clickFilterRow(statusSelect(el), "Any status");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(sessionStorage.getItem("test.reclick-all")).toBeNull();
});

test("clicking the row of a filter's initial choice reports nothing and remembers nothing", async () => {
  const el = await tableS({ viewKey: "test.reclick-initial", columns: initiallyActive });
  const seen: unknown[] = [];
  el.addEventListener("wt-filter-change", (event) => seen.push((event as CustomEvent).detail));
  await clickFilterRow(statusSelect(el), "Active");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(sessionStorage.getItem("test.reclick-initial")).toBeNull();
  expect(rowKeysS(el)).toEqual(["1"]);
});

test("clicking the row of a restored filter choice reports nothing and leaves the stored view alone", async () => {
  sessionStorage.setItem("test.reclick-restored", JSON.stringify({ filters: { status: "off" } }));
  const el = await tableS({ viewKey: "test.reclick-restored", columns: withStatus });
  const stored = sessionStorage.getItem("test.reclick-restored");
  const seen: unknown[] = [];
  el.addEventListener("wt-filter-change", (event) => seen.push((event as CustomEvent).detail));
  await clickFilterRow(statusSelect(el), "Inactive");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(sessionStorage.getItem("test.reclick-restored")).toBe(stored);
  expect(rowKeysS(el)).toEqual(["2"]);
});

test("choosing the all option over an initial choice shows every row, and is remembered", async () => {
  const el = await tableS({ viewKey: "test.initial-all", columns: initiallyActive });
  await chooseOption(statusSelect(el), "");
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
  await chooseOption(statusSelect(el), "off");
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
  await chooseOption(statusSelect(el), "active");
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

function chooserOpen(el: AnyTable): boolean {
  return (panel(el) as HTMLElement & { open: boolean }).open;
}

test("customise lists every column and fixes the first and pinned columns in place", async () => {
  const columns: DataTableColumn<Row>[] = [
    choosable[0]!,
    choosable[1]!,
    { key: "actions", label: "Actions", cell: () => "Edit", pinned: "end" },
  ];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const rows = [...panel(el).querySelectorAll<HTMLElement>("[data-column-row]")];
  expect(rows.map((row) => row.dataset.columnRow)).toEqual(["name", "count", "actions"]);
  expect(rows[0]!.querySelector("[data-reorder]")).toBeNull();
  expect(rows[1]!.querySelector("[data-reorder]")).not.toBeNull();
  expect(rows[2]!.querySelector("[data-reorder]")).toBeNull();
  expect(chooserBox(el, "name").disabled).toBe(true);
  expect(chooserBox(el, "actions").disabled).toBe(true);
});

test("a movable column without a visibility choice has a muted label", async () => {
  const columns: DataTableColumn<Row>[] = [
    choosable[0]!,
    choosable[1]!,
    { key: "id", label: "ID", cell: (row) => row.id },
  ];
  const el = await table({ columns });
  el.style.setProperty("--wt-color-text-muted", "rgb(71, 83, 97)");
  await el.updateComplete;
  const row = panel(el).querySelector<HTMLElement>('[data-column-row="id"]')!;
  expect(row.querySelector("[data-reorder]")).not.toBeNull();
  expect(chooserBox(el, "id").disabled).toBe(true);
  expect(getComputedStyle(row.querySelector(".column-name")!).color).toBe("rgb(71, 83, 97)");
});

test("the eye icon reflects column visibility and its toggle names the action", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  const eye = () => chooserBox(el, "extra").closest("label")!.querySelector("wt-icon")!;
  expect(eye().getAttribute("name")).toBe("eye-closed");
  expect(chooserBox(el, "extra").getAttribute("aria-label")).toBe("Show Extra");
  await choose(el, "extra");
  expect(eye().getAttribute("name")).toBe("eye-open");
  expect(chooserBox(el, "extra").getAttribute("aria-label")).toBe("Hide Extra");
});

test("Customise actions use the shared buttons", async () => {
  const el = await table({ columns: choosable });
  const actions = [...panel(el).querySelectorAll("[slot=footer]")];
  expect(actions.map((action) => action.tagName)).toEqual(["WT-BUTTON", "WT-BUTTON"]);
  expect(actions.map((action) => action.textContent!.trim())).toEqual(["Restore defaults", "Done"]);
});

test("keyboard reordering changes the table and keeps the row menu last", async () => {
  const columns: DataTableColumn<Row>[] = [
    choosable[0]!,
    choosable[1]!,
    { ...choosable[2]!, choosable: "shown" },
    { key: "actions", label: "Actions", cell: () => "Edit", pinned: "end" },
  ];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const handle = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  handle.focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Extra", "Count", "Actions"]);
  expect(panel(el).querySelector('[data-reorder="extra"]')).toBe(el.shadowRoot!.activeElement);
  expect(panel(el).querySelector('[role="status"]')?.textContent).toContain("2");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Count", "Extra", "Actions"]);
});

test("repeated ArrowDown moves keep focus on the moved column's handle", async () => {
  const columns: DataTableColumn<Row>[] = [
    choosable[0]!,
    choosable[1]!,
    { ...choosable[2]!, choosable: "shown" },
    { key: "id", label: "ID", cell: (row) => row.id, choosable: "shown" },
    { key: "actions", label: "Actions", cell: () => "Edit", pinned: "end" },
  ];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const handle = panel(el).querySelector<HTMLButtonElement>('[data-reorder="count"]')!;
  handle.focus();
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Extra", "Count", "ID", "Actions"]);
  expect(el.shadowRoot!.activeElement).toBe(handle);
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Extra", "ID", "Count", "Actions"]);
  expect(el.shadowRoot!.activeElement).toBe(handle);
});

test("the position announcement is available to assistive technology without adding a visible row", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  const status = panel(el).querySelector<HTMLElement>('[role="status"]')!;
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.getBoundingClientRect().width).toBeLessThanOrEqual(1);
});

test("Restore defaults resets the declared order and column visibility", async () => {
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns, viewKey: "test.restore-defaults" });
  await userEvent.click(trigger(el));
  panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!.focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  await choose(el, "count");
  expect(headers(el)).toEqual(["Name", "Extra"]);
  panel(el).querySelector<HTMLButtonElement>("[data-restore-columns]")!.click();
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  expect(chooserBox(el, "count").checked).toBe(true);
  expect(localStorage.getItem("test.restore-defaults:column-order")).toBeNull();
  expect(localStorage.getItem("test.restore-defaults:columns")).toBeNull();
  const again = await table({ columns, viewKey: "test.restore-defaults" });
  expect(headers(again)).toEqual(["Name", "Count", "Extra"]);
});

test("a moved column's order is stored and restored on the next table", async () => {
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns, viewKey: "test.moved-order" });
  await userEvent.click(trigger(el));
  panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!.focus();
  await userEvent.keyboard("{ArrowUp}");
  expect(localStorage.getItem("test.moved-order:column-order")).toBe('["extra","count"]');
  const again = await table({ columns, viewKey: "test.moved-order" });
  expect(headers(again)).toEqual(["Name", "Extra", "Count"]);
});

test("a stored order ignores removed columns and inserts new ones in their declared place", async () => {
  localStorage.setItem("test.order:column-order", JSON.stringify(["extra", "removed", "count"]));
  const columns = [
    choosable[0]!,
    choosable[1]!,
    { key: "new", label: "New", cell: (row: Row) => row.name, choosable: "shown" as const },
    { ...choosable[2]!, choosable: "shown" as const },
  ];
  const el = await table({ columns, viewKey: "test.order" });
  expect(headers(el)).toEqual(["Name", "Extra", "Count", "New"]);
});

test("a new column declared before stored columns keeps its declared place", async () => {
  localStorage.setItem("test.new-before:column-order", '["extra","count"]');
  const columns = [
    choosable[0]!,
    { key: "new", label: "New", cell: (row: Row) => row.id },
    choosable[1]!,
    { ...choosable[2]!, choosable: "shown" as const },
  ];
  const el = await table({ columns, viewKey: "test.new-before" });
  expect(headers(el)).toEqual(["Name", "New", "Extra", "Count"]);
});

test("dragging a column handle moves it to the pointed movable row", async () => {
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const source = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  const destination = panel(el).querySelector<HTMLElement>('[data-column-row="count"]')!;
  const start = source.getBoundingClientRect();
  const end = destination.getBoundingClientRect();
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
      composed: true,
      clientX: start.x + start.width / 2,
      clientY: start.y + start.height / 2,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
      clientX: end.x + end.width / 2,
      clientY: end.y + end.height / 2,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      bubbles: true,
      clientX: end.x + end.width / 2,
      clientY: end.y + end.height / 2,
    }),
  );
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Extra", "Count"]);
});

test("a secondary pointer cannot start a column drag", async () => {
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const source = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  const target = panel(el).querySelector<HTMLElement>('[data-column-row="count"]')!;
  const y = target.getBoundingClientRect().top + 1;
  source.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, button: 2, bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 3, clientY: y }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3, clientY: y }));
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  expect(document.body.style.cursor).not.toBe("grabbing");
});

test("a short pointer movement and another pointer cannot reorder a column", async () => {
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const source = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  const target = panel(el).querySelector<HTMLElement>('[data-column-row="count"]')!;
  const startY = source.getBoundingClientRect().top + 1;
  const targetY = target.getBoundingClientRect().top + 1;
  source.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 4, button: 0, clientY: startY }),
  );
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 4, clientY: startY + 1 }));
  expect(document.body.style.cursor).not.toBe("grabbing");
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4, clientY: targetY }));
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  source.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 5, button: 0, clientY: startY }),
  );
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 6, clientY: targetY }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 6, clientY: targetY }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, clientY: targetY }));
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  expect(document.body.style.cursor).not.toBe("grabbing");
});

test("canceling a column drag restores the page cursor and permits a later drag", async () => {
  const originalCursor = document.body.style.cursor;
  onTestFinished(() => {
    document.body.style.cursor = originalCursor;
  });
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const source = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  const target = panel(el).querySelector<HTMLElement>('[data-column-row="count"]')!;
  const startY = source.getBoundingClientRect().top + 1;
  const targetBox = target.getBoundingClientRect();
  const targetY = targetBox.top + 1;
  const targetX = targetBox.left + targetBox.width / 2;
  document.body.style.cursor = "crosshair";
  source.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 7, button: 0, clientY: startY }),
  );
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientY: targetY }));
  expect(document.body.style.cursor).toBe("grabbing");
  document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 7 }));
  expect(document.body.style.cursor).toBe("crosshair");
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  source.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 8, button: 0, clientY: startY }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 8, clientX: targetX, clientY: targetY }),
  );
  document.dispatchEvent(
    new PointerEvent("pointerup", { pointerId: 8, clientX: targetX, clientY: targetY }),
  );
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Extra", "Count"]);
  expect(document.body.style.cursor).toBe("crosshair");
});

test("dropping outside the Customise dialog leaves column order unchanged", async () => {
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const source = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  const target = panel(el).querySelector<HTMLElement>('[data-column-row="count"]')!;
  const start = source.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 9,
      button: 0,
      clientX: start.left + start.width / 2,
      clientY: start.top + start.height / 2,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 9,
      clientX: end.left + end.width / 2,
      clientY: end.top + end.height / 2,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 9,
      clientX: 1,
      clientY: end.top + end.height / 2,
    }),
  );
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
});

test("Escape during a column drag restores the page cursor", async () => {
  const originalCursor = document.body.style.cursor;
  onTestFinished(() => {
    document.body.style.cursor = originalCursor;
  });
  const columns = [choosable[0]!, choosable[1]!, { ...choosable[2]!, choosable: "shown" as const }];
  const el = await table({ columns });
  await userEvent.click(trigger(el));
  const source = panel(el).querySelector<HTMLButtonElement>('[data-reorder="extra"]')!;
  const start = source.getBoundingClientRect();
  source.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 10,
      button: 0,
      clientY: start.top + start.height / 2,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 10,
      clientY: start.top + start.height / 2 + 6,
    }),
  );
  expect(document.body.style.cursor).toBe("grabbing");
  await userEvent.keyboard("{Escape}");
  expect(chooserOpen(el)).toBe(false);
  expect(document.body.style.cursor).toBe(originalCursor);
});

async function choose(el: AnyTable, key: string): Promise<void> {
  chooserBox(el, key).click();
  await el.updateComplete;
}

test("no column chooser is drawn when no column is choosable", async () => {
  const el = await table({ searchable: true });
  expect(el.shadowRoot!.querySelector(".columns-trigger")).toBeNull();
  expect(el.shadowRoot!.querySelector(".columns-panel")).toBeNull();
});

test("a choosable column starts shown or hidden as it asks, and an unchoosable one is listed but fixed", async () => {
  const cols: DataTableColumn<Row>[] = [
    ...choosable,
    { key: "id", label: "ID", cell: (row) => row.id, choosable: "shown" },
  ];
  const el = await table({ columns: cols });
  expect(headers(el)).toEqual(["Name", "Count", "ID"]);
  expect(rowText(el)).toEqual(["Bea2b", "Ada10a"]);
  expect(
    chooserBoxes(el).map((box) =>
      box.closest(".column-choice")!.querySelector(".column-name")!.textContent!.trim(),
    ),
  ).toEqual(["Name", "Count", "Extra", "ID"]);
  expect(chooserBoxes(el).map((box) => box.checked)).toEqual([true, true, false, true]);
  expect(chooserBoxes(el).map((box) => box.name)).toEqual([
    "name-column",
    "count-column",
    "extra-column",
    "id-column",
  ]);
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([true, false, false, false]);
});

test("the chooser sits at the toolbar's trailing end, after the filters", async () => {
  const cols: DataTableColumn<RowS>[] = [withStatus[0]!, { ...withStatus[1]!, choosable: "shown" }];
  const el = await tableS({ columns: cols });
  el.style.width = "600px";
  await el.updateComplete;
  const toolbar = el.shadowRoot!.querySelector(".table-toolbar")!.getBoundingClientRect();
  const filter = el.shadowRoot!.querySelector(".table-filter")!.getBoundingClientRect();
  const button = trigger(el).getBoundingClientRect();
  expect(button.right).toBeGreaterThanOrEqual(toolbar.right - 8);
  expect(filter.right).toBeLessThan(button.left - 100);
});

test("the chooser draws in the toolbar even with no search box or filter", async () => {
  const el = await table({ columns: choosable });
  const toolbar = el.shadowRoot!.querySelector(".table-toolbar")!;
  expect(toolbar.querySelector(".columns-trigger")).not.toBeNull();
  expect(toolbar.querySelector(".table-search")).toBeNull();
  expect(toolbar.querySelector(".table-filters")).toBeNull();
});

test("the chooser's icon button and dialog read their accessible names", async () => {
  const el = await table({ columns: choosable });
  expect(trigger(el).getAttribute("aria-label")).toBe("Customise columns");
  expect(trigger(el).querySelector("wt-icon")).not.toBeNull();
  expect(panel(el).getAttribute("heading")).toBe("Customise");
  el.customiseColumnsLabel = "Personalizar columnas";
  el.customiseLabel = "Personalizar";
  await el.updateComplete;
  expect(trigger(el).getAttribute("aria-label")).toBe("Personalizar columnas");
  expect(panel(el).getAttribute("heading")).toBe("Personalizar");
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
  await choose(el, "extra");
  await choose(el, "count");
  expect(headers(el)).toEqual(["", "Name", "Extra"]);
  expect(el.shadowRoot!.querySelector("thead th.select [data-test=select-all]")).not.toBeNull();
  const firstRow = el.shadowRoot!.querySelector('tbody tr[data-row-key="b"]')!;
  expect([...firstRow.querySelectorAll("td")].map((cell) => cell.textContent!.trim())).toEqual([
    "",
    "Bea",
    "xb",
  ]);
});

test("a clickable table keeps its first column and its row activator", async () => {
  const cols: DataTableColumn<Row>[] = [
    { ...choosable[1]! },
    { key: "name", label: "Name", cell: (row) => row.name },
  ];
  const el = await table({ columns: cols, rowClick: (row: Row) => row.id });
  await choose(el, "count");
  const cells = el.shadowRoot!.querySelectorAll('tbody tr[data-row-key="b"] td');
  expect(cells.length).toBe(2);
  expect(cells[0]!.querySelector(".row-activate")).not.toBeNull();
});

const choosableTree: DataTableColumn<TreeRow>[] = [
  { ...treeColumns[0]!, choosable: "shown" },
  { key: "code", label: "Code", cell: (row) => row.id, choosable: "hidden" },
];

test("a tree keeps its first column and toggle while other columns are chosen", async () => {
  const cols: DataTableColumn<TreeRow>[] = [
    ...choosableTree,
    { key: "other", label: "Other", cell: (row) => row.id, choosable: "shown" },
  ];
  const el = await treeTable({ columns: cols, selectable: true, selected: [] });
  expect(headers(el)).toEqual(["", "Name", "Other"]);
  await choose(el, "code");
  expect(headers(el)).toEqual(["", "Name", "Code", "Other"]);
  await choose(el, "name");
  expect(headers(el)).toEqual(["", "Name", "Code", "Other"]);
  const cells = [...el.shadowRoot!.querySelectorAll<HTMLElement>('tr[data-row-key="food"] td')];
  expect(cells.length).toBe(4);
  expect(cells[0]!.classList.contains("select")).toBe(true);
  expect(cells[1]!.querySelector("button.tree-toggle")).not.toBeNull();
  expect(cells[1]!.textContent!.trim()).toContain("Food");
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

test("the fixed first column cannot be hidden while other choices remain available", async () => {
  const all: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", cell: (row) => row.name, choosable: "shown" },
    { ...choosable[1]! },
    { ...choosable[2]! },
  ];
  const el = await table({ columns: all });
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([true, true, false]);
  await choose(el, "name");
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([true, true, false]);
  await choose(el, "extra");
  expect(chooserBoxes(el).map((box) => box.disabled)).toEqual([true, false, false]);
});

test("the last visible movable column cannot be hidden beside the fixed first column", async () => {
  const el = await table({ columns: [choosable[0]!, choosable[1]!] });
  expect(chooserBox(el, "count").disabled).toBe(true);
  await choose(el, "count");
  expect(headers(el)).toEqual(["Name", "Count"]);
  expect(chooserBox(el, "count").disabled).toBe(true);
});

test("when every column starts hidden, the first and one movable column are shown", async () => {
  const hidden: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", cell: (row) => row.name, choosable: "hidden" },
    { key: "count", label: "Count", cell: (row) => row.count, choosable: "hidden" },
    { key: "extra", label: "Extra", cell: (row) => row.id, choosable: "hidden" },
  ];
  const el = await table({ columns: hidden });
  expect(headers(el)).toEqual(["Name", "Count"]);
  expect(chooserBoxes(el).map((box) => [box.checked, box.disabled])).toEqual([
    [true, true],
    [true, true],
    [false, false],
  ]);
});

test("a stored choice hiding every column still leaves the first and one movable shown", async () => {
  localStorage.setItem("test.none:columns", JSON.stringify({ name: false, count: false }));
  const cols: DataTableColumn<Row>[] = [
    { key: "name", label: "Name", cell: (row) => row.name, choosable: "shown" },
    { ...choosable[1]! },
  ];
  const el = await table({ columns: cols, viewKey: "test.none" });
  expect(headers(el)).toEqual(["Name", "Count"]);
  expect(chooserBox(el, "name").disabled).toBe(true);
  expect(chooserBox(el, "count").disabled).toBe(true);
});

test("a stored choice cannot hide the last movable column", async () => {
  localStorage.setItem("test.last-movable:columns", JSON.stringify({ count: false }));
  const cols: DataTableColumn<Row>[] = [
    choosable[0]!,
    choosable[1]!,
    { key: "actions", label: "Actions", cell: () => "Edit", pinned: "end" },
  ];
  const el = await table({ columns: cols, viewKey: "test.last-movable" });
  expect(headers(el)).toEqual(["Name", "Count", "Actions"]);
  expect(chooserBox(el, "count").checked).toBe(true);
  expect(chooserBox(el, "count").disabled).toBe(true);
});

test("a hidden column's filter dropdown stays drawn and keeps filtering", async () => {
  const cols: DataTableColumn<RowS>[] = [
    withStatus[0]!,
    { ...withStatus[1]!, choosable: "shown" },
    { key: "id", label: "ID", cell: (row) => row.id, choosable: "shown" },
  ];
  const el = await tableS({ columns: cols });
  await choose(el, "status");
  expect(headers(el)).toEqual(["Name", "ID"]);
  const select = statusSelect(el);
  await chooseOption(select, "off");
  await el.updateComplete;
  expect(rowKeysS(el)).toEqual(["2"]);
});

test("a hidden column stops sorting the rows, and showing it again restores its sort", async () => {
  const el = await table({ columns: choosable, sortKey: "count", sortDirection: "descending" });
  expect(rowText(el)).toEqual(["Ada10", "Bea2"]);
  await choose(el, "extra");
  await choose(el, "count");
  expect(rowText(el)).toEqual(["Beaxb", "Adaxa"]);
  expect(el.sortKey).toBe("count");
  expect(el.sortDirection).toBe("descending");
  expect(el.shadowRoot!.querySelector('th[aria-sort="none"] [data-sort="name"]')).not.toBeNull();
  await choose(el, "count");
  expect(rowText(el)).toEqual(["Ada10xa", "Bea2xb"]);
});

test("the fixed first column keeps sorting a tree's siblings", async () => {
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
  expect(treeKeys(el)).toEqual(["drinks", "food", "break", "eggs"]);
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
  expect(chooserBoxes(el).map((box) => box.checked)).toEqual([true, false, true]);
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
  localStorage.setItem("test.nosession:columns", JSON.stringify({ count: false, extra: true }));
  const realGetItem = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (this === sessionStorage) throw new Error("blocked");
    return realGetItem.call(this, key);
  });
  const el = await table({ columns: choosable, viewKey: "test.nosession" });
  expect(headers(el)).toEqual(["Name", "Extra"]);
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

test("the chooser button opens its dialog and Done closes it", async () => {
  const el = await table({ columns: choosable });
  expect(chooserOpen(el)).toBe(false);
  expect(trigger(el).getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger(el));
  expect(chooserOpen(el)).toBe(true);
  await vi.waitFor(() => expect(trigger(el).getAttribute("aria-expanded")).toBe("true"));
  await userEvent.click(
    panel(el).querySelector<HTMLElement>('wt-button[slot="footer"]:last-child')!,
  );
  expect(chooserOpen(el)).toBe(false);
  await vi.waitFor(() => expect(trigger(el).getAttribute("aria-expanded")).toBe("false"));
});

test("Escape closes the chooser and returns focus to its button, and goes no further", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  chooserBox(el, "count").focus();
  const outer = vi.fn();
  host.addEventListener("keydown", outer);
  await userEvent.keyboard("{Escape}");
  expect(chooserOpen(el)).toBe(false);
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
  await el.updateComplete;
  expect(chooserOpen(el)).toBe(false);
  expect(escape.defaultPrevented).toBe(true);
});

test("Escape on the chooser button closes the open panel and goes no further", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  trigger(el).focus();
  const outer = vi.fn();
  host.addEventListener("keydown", outer);
  await userEvent.keyboard("{Escape}");
  expect(chooserOpen(el)).toBe(false);
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
  expect(chooserOpen(el)).toBe(true);
  const other = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  panel(el).dispatchEvent(other);
  expect(other.defaultPrevented).toBe(false);
  expect(chooserOpen(el)).toBe(true);
});

test("an inside choice keeps the dialog open, and a native close updates its state", async () => {
  const el = await table({ columns: choosable });
  await userEvent.click(trigger(el));
  await userEvent.click(chooserBox(el, "extra").closest("label")!);
  expect(chooserOpen(el)).toBe(true);
  expect(headers(el)).toEqual(["Name", "Count", "Extra"]);
  panel(el).shadowRoot!.querySelector("dialog")!.close();
  await vi.waitFor(() => expect(chooserOpen(el)).toBe(false));
});

test("the Customise dialog overlays the table without moving it", async () => {
  const el = await table({ columns: choosable, searchable: true });
  const tableTop = el.shadowRoot!.querySelector("table")!.getBoundingClientRect().top;
  await userEvent.click(trigger(el));
  const dialog = panel(el).shadowRoot!.querySelector("dialog")!;
  const bounds = dialog.getBoundingClientRect();
  expect(dialog.open).toBe(true);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(innerWidth);
  expect(el.shadowRoot!.querySelector("table")!.getBoundingClientRect().top).toBe(tableTop);
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

test("a long Customise list scrolls within the screen and reaches its last choice", async () => {
  const el = await table({ columns: manyChoosable(40) });
  await userEvent.click(trigger(el));
  const popup = panel(el).querySelector<HTMLElement>(".columns-list")!;
  const bounds = popup.getBoundingClientRect();
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(innerHeight);
  expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
  popup.scrollTop = popup.scrollHeight;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
  host.style.setProperty("--wt-color-surface-raised", "rgb(8, 9, 10)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-primary", "rgb(13, 14, 15)");
  const button = trigger(el);
  expect(getComputedStyle(button).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(button).color).toBe("rgb(10, 11, 12)");
  expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(52);
  await userEvent.click(button);
  const popup = panel(el).shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(popup).borderColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(popup).backgroundColor).toBe("rgb(8, 9, 10)");
  expect(getComputedStyle(popup).color).toBe("rgb(10, 11, 12)");
  const box = chooserBox(el, "extra");
  expect(getComputedStyle(box.nextElementSibling!).color).toBe("rgb(13, 14, 15)");
  expect(box.closest(".column-choice")!.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
});

test("the chooser's button and boxes draw the focus ring when focused", async () => {
  const el = await table({ columns: choosable });
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(4, 5, 6)");
  trigger(el).focus();
  await userEvent.keyboard("{Enter}");
  const control = chooserBox(el, "extra");
  control.focus();
  expect(control.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(control.nextElementSibling!).outlineColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(control.nextElementSibling!).outlineStyle).toBe("solid");
  panel(el).querySelector<HTMLElement>('wt-button[slot="footer"]:last-child')!.click();
  await el.updateComplete;
  trigger(el).focus();
  expect(trigger(el).matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(trigger(el)).outlineColor).toBe("rgb(4, 5, 6)");
});

test("a focused table search marks its existing border without an outer ring", async () => {
  const el = await table({ searchable: true, searchLabel: "Search users" });
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-primary", "rgb(4, 5, 6)");
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  expect(getComputedStyle(search).borderColor).toBe("rgb(1, 2, 3)");
  search.focus();
  expect(search.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(search).borderColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(search).outlineStyle).toBe("none");
});

const wide = "A long cell that keeps its table wider than the box around it";
const pinnedColumns = (pinned?: "end"): DataTableColumn<Row>[] => [
  { key: "name", label: "Name", cell: (row) => `${row.name}: ${wide}` },
  { key: "count", label: "Count", cell: (row) => `${row.count}: ${wide}` },
  {
    key: "action",
    label: "Actions",
    pinned,
    cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
  },
];

test.each([
  { label: "Actions", buttonText: "⋮" },
  { label: "Acciones", buttonText: "⋮" },
  { label: "Actions", buttonText: "Longer action" },
])(
  "a one-row table gives its pinned $label column only the width its heading or $buttonText button needs",
  async ({ label, buttonText }) => {
    const el = await table({
      rows: [rows[0]!],
      columns: [
        { key: "name", label: "Name", cell: (row) => row.name },
        {
          key: "actions",
          label,
          pinned: "end",
          cell: () => html`<button aria-label="More actions">${buttonText}</button>`,
        },
      ],
    });
    el.style.width = "1000px";
    await el.updateComplete;

    const heading = el.shadowRoot!.querySelector<HTMLTableCellElement>("th[data-pinned=end]")!;
    const cell = el.shadowRoot!.querySelector<HTMLTableCellElement>("td[data-pinned=end]")!;
    const button = cell.querySelector("button")!;
    const labelRange = document.createRange();
    labelRange.selectNodeContents(heading);
    const contentWidth = Math.max(
      labelRange.getBoundingClientRect().width,
      button.getBoundingClientRect().width,
    );
    const style = getComputedStyle(heading);
    const neededWidth =
      contentWidth + parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd);

    expect(heading.getBoundingClientRect().width).toBeLessThanOrEqual(neededWidth + 2);
    expect(cell.getBoundingClientRect().width).toBeCloseTo(
      heading.getBoundingClientRect().width,
      0,
    );
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
    expect(el.shadowRoot!.querySelector("th")!.getBoundingClientRect().width).toBeGreaterThan(
      heading.getBoundingClientRect().width * 2,
    );
  },
);

test.each([
  { label: "Open", width: 1000 },
  { label: "Abrir", width: 390 },
])("a pinned $label link keeps its content width at $width px", async ({ label, width }) => {
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  await page.viewport(width === 1000 ? 1280 : 390, 900);
  try {
    const el = await table({
      rows: [rows[0]!],
      columns: [
        { key: "name", label: "Name", cell: (row) => row.name },
        {
          key: "open",
          label,
          pinned: "end",
          cell: () => html`<a href="#open">${label}</a>`,
        },
      ],
    });
    el.style.width = `${width}px`;
    await el.updateComplete;

    const heading = el.shadowRoot!.querySelector<HTMLTableCellElement>("th[data-pinned=end]")!;
    const cell = el.shadowRoot!.querySelector<HTMLTableCellElement>("td[data-pinned=end]")!;
    const link = cell.querySelector("a")!;
    const style = getComputedStyle(heading);
    const neededWidth =
      link.getBoundingClientRect().width +
      parseFloat(style.paddingInlineStart) +
      parseFloat(style.paddingInlineEnd);

    expect(heading.getBoundingClientRect().width).toBeLessThanOrEqual(neededWidth + 2);
    expect(cell.getBoundingClientRect().width).toBeCloseTo(
      heading.getBoundingClientRect().width,
      0,
    );
    expect(el.shadowRoot!.querySelector("th")!.getBoundingClientRect().width).toBeGreaterThan(
      heading.getBoundingClientRect().width * 2,
    );
  } finally {
    await page.viewport(previousWidth, previousHeight);
  }
});

test("a pinned Actions column keeps its content width when another column follows it", async () => {
  const el = await table({
    rows: [rows[0]!],
    columns: [
      { key: "name", label: "Name", cell: (row) => row.name },
      {
        key: "actions",
        label: "Actions",
        pinned: "end",
        cell: () => html`<button aria-label="More actions">⋮</button>`,
      },
      { key: "note", label: "Note", cell: () => "Ready" },
    ],
  });
  el.style.width = "1000px";
  await el.updateComplete;

  const heading = el.shadowRoot!.querySelector<HTMLTableCellElement>("th[data-pinned=end]")!;
  const cell = el.shadowRoot!.querySelector<HTMLTableCellElement>("td[data-pinned=end]")!;
  const button = cell.querySelector("button")!;
  const labelRange = document.createRange();
  labelRange.selectNodeContents(heading);
  const style = getComputedStyle(heading);
  const neededWidth =
    Math.max(labelRange.getBoundingClientRect().width, button.getBoundingClientRect().width) +
    parseFloat(style.paddingInlineStart) +
    parseFloat(style.paddingInlineEnd);

  expect(heading.getBoundingClientRect().width).toBeLessThanOrEqual(neededWidth + 2);
});

test("a tree table gives a pinned Open column only the width of its links", async () => {
  const el = await treeTable({
    columns: [
      { key: "name", label: "Name", cell: (row) => row.name },
      { key: "open", label: "Open", pinned: "end", cell: () => html`<a href="#open">Open</a>` },
    ],
  });
  el.style.width = "1000px";
  await el.updateComplete;

  const heading = el.shadowRoot!.querySelector<HTMLTableCellElement>("th[data-pinned=end]")!;
  const cell = el.shadowRoot!.querySelector<HTMLTableCellElement>("td[data-pinned=end]")!;
  const link = cell.querySelector("a")!;
  const style = getComputedStyle(heading);
  const neededWidth =
    link.getBoundingClientRect().width +
    parseFloat(style.paddingInlineStart) +
    parseFloat(style.paddingInlineEnd);

  expect(heading.getBoundingClientRect().width).toBeLessThanOrEqual(neededWidth + 2);
  expect(cell.getBoundingClientRect().width).toBeCloseTo(heading.getBoundingClientRect().width, 0);
});

test("a multi-word Actions heading wraps instead of taking half a phone-width table", async () => {
  const el = await table({
    rows: [rows[0]!],
    columns: [
      { key: "name", label: "Name", cell: (row) => row.name },
      { key: "actions", label: "Actions for this row", pinned: "end", cell: () => "⋮" },
    ],
  });
  el.style.width = "390px";
  await el.updateComplete;
  const heading = el.shadowRoot!.querySelector("th[data-pinned=end]")!;
  expect(heading.getBoundingClientRect().width).toBeLessThan(el.getBoundingClientRect().width / 3);
});

async function narrowTable(pinned?: "end", props: Partial<WtDataTable<Row>> = {}) {
  const el = await table({ columns: pinnedColumns(pinned), ...props });
  el.style.width = "240px";
  await el.updateComplete;
  const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  return { el, scroll };
}

async function scrollTo(scroll: HTMLElement, left: number): Promise<void> {
  scroll.scrollLeft = left;
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

test("a pinned last column stays inside the box, uncovered, at both ends of a sideways scroll", async () => {
  const { el, scroll } = await narrowTable("end");
  for (const left of [0, scroll.scrollWidth]) {
    await scrollTo(scroll, left);
    const box = scroll.getBoundingClientRect();
    for (const name of ["Bea", "Ada"]) {
      const edit = el.shadowRoot!.querySelector(`button[aria-label="Edit ${name}"]`)!;
      const cell = edit.closest("td")!.getBoundingClientRect();
      expect(cell.right, `${name} at scrollLeft ${left}`).toBeLessThanOrEqual(box.right);
      expect(cell.left, `${name} at scrollLeft ${left}`).toBeGreaterThanOrEqual(box.left);
      const at = edit.getBoundingClientRect();
      expect(el.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2)).toBe(edit);
    }
  }
  // Unscrolled, the column before it runs on under the pinned one, so the hit test above is the
  // pinned cell winning, not an empty space.
  await scrollTo(scroll, 0);
  const count = el.shadowRoot!.querySelector("tbody td:nth-child(2)")!.getBoundingClientRect();
  const pinned = el.shadowRoot!.querySelector("tbody td:nth-child(3)")!.getBoundingClientRect();
  expect(count.right).toBeGreaterThan(pinned.left);
});

test("an unpinned last column is off the box until the table is scrolled", async () => {
  const { el, scroll } = await narrowTable();
  const edit = el.shadowRoot!.querySelector('button[aria-label="Edit Bea"]')!;
  expect(edit.closest("td")!.getBoundingClientRect().left).toBeGreaterThan(
    scroll.getBoundingClientRect().right,
  );
});

test("a table with no pinned column marks no cell", async () => {
  const el = await table();
  expect(el.shadowRoot!.querySelectorAll("th, td")).not.toHaveLength(0);
  expect(el.shadowRoot!.querySelectorAll("[data-pinned]")).toHaveLength(0);
});

test("a tree table keeps its pinned column inside the box", async () => {
  const el = await treeTable({
    columns: [
      { key: "name", label: "Name", cell: (r) => `${r.name}: ${wide}` },
      {
        key: "action",
        label: "Actions",
        pinned: "end",
        cell: (r) => html`<button aria-label=${`Edit ${r.name}`}>Edit</button>`,
      },
    ],
  });
  el.style.width = "240px";
  await el.updateComplete;
  const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  const box = scroll.getBoundingClientRect();
  for (const cell of el.shadowRoot!.querySelectorAll("th:last-child, td:last-child"))
    expect(cell.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
});

test("a pinned column paints the row's background at rest and on hover, and draws its edge from tokens", async () => {
  const { el } = await narrowTable("end");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 40, 50)");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  const header = el.shadowRoot!.querySelector("th:last-child")!;
  const row = el.shadowRoot!.querySelector("tbody tr")!;
  const cell = row.querySelector("td:last-child")!;
  for (const pinned of [header, cell]) {
    expect(getComputedStyle(pinned).backgroundColor).toBe("rgb(7, 8, 9)");
    expect(getComputedStyle(pinned, "::before").borderInlineStartColor).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(pinned, "::before").borderInlineStartStyle).toBe("solid");
  }
  await userEvent.hover(row.querySelector("td")!);
  onTestFinished(() => commands.parkPointer());
  expect(getComputedStyle(row).backgroundColor).toBe("rgb(30, 40, 50)");
  expect(getComputedStyle(cell).backgroundColor).toBe("rgb(30, 40, 50)");
});

test("a pinned column in a clickable row paints the row's hover and focus background", async () => {
  const { el } = await narrowTable("end", { rowClick: (row: Row) => row.id });
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 40, 50)");
  const cell = el.shadowRoot!.querySelector("tbody tr td:last-child")!;
  await userEvent.hover(el.shadowRoot!.querySelector("tbody td")!);
  onTestFinished(() => commands.parkPointer());
  expect(getComputedStyle(cell).backgroundColor).toBe("rgb(30, 40, 50)");
  await commands.parkPointer();
  expect(getComputedStyle(cell).backgroundColor).not.toBe("rgb(30, 40, 50)");
  el.shadowRoot!.querySelector<HTMLButtonElement>(".row-activate")!.focus();
  expect(getComputedStyle(cell).backgroundColor).toBe("rgb(30, 40, 50)");
});

test.each(["light", "dark"] as const)(
  "a pinned column paints its theme's row background, at rest and on hover (%s theme)",
  async (theme) => {
    const { el } = await narrowTable("end");
    host.setAttribute("data-theme", theme);
    const table = el.shadowRoot!.querySelector("table")!;
    const row = el.shadowRoot!.querySelector("tbody tr")!;
    const cell = row.querySelector("td:last-child")!;
    const surface = getComputedStyle(table).backgroundColor;
    expect(getComputedStyle(el.shadowRoot!.querySelector("th:last-child")!).backgroundColor).toBe(
      surface,
    );
    expect(getComputedStyle(cell).backgroundColor).toBe(surface);
    await userEvent.hover(row.querySelector("td")!);
    onTestFinished(() => commands.parkPointer());
    expect(getComputedStyle(cell).backgroundColor).toBe(getComputedStyle(row).backgroundColor);
  },
);

test("a clickable row's lifted controls pass under a pinned column, not over it", async () => {
  const el = await table({
    rowClick: (row: Row) => row.id,
    columns: [
      { key: "name", label: "Name", cell: (row) => row.name },
      { key: "count", label: "Count", cell: (row) => html`<button>${row.count}: ${wide}</button>` },
      pinnedColumns("end")[2]!,
    ],
  });
  el.style.width = "240px";
  await el.updateComplete;
  const edit = el.shadowRoot!.querySelector('button[aria-label="Edit Bea"]')!;
  const passing = edit.closest("tr")!.querySelector("td:nth-child(2) button")!;
  const at = edit.getBoundingClientRect();
  expect(passing.getBoundingClientRect().right).toBeGreaterThan(at.right);
  expect(el.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2)).toBe(edit);
});

// A point inside the cell's padding, clear of its button, where a real pointer lands on the cell.
async function clickPinnedPadding(el: WtDataTable<Row>): Promise<void> {
  const cell = el.shadowRoot!.querySelector<HTMLElement>("tbody tr td:last-child")!;
  const box = cell.getBoundingClientRect();
  const at = { x: 2, y: 2 };
  expect(el.shadowRoot!.elementFromPoint(box.x + at.x, box.y + at.y)).toBe(cell);
  await userEvent.click(cell, { position: at });
}

test("a real click on a pinned cell's empty space opens its clickable row once", async () => {
  const clicked: string[] = [];
  const { el } = await narrowTable("end", { rowClick: (row: Row) => clicked.push(row.id) });
  await clickPinnedPadding(el);
  expect(clicked).toEqual(["b"]);
});

test.each([
  { position: "unpinned", pinned: undefined },
  { position: "pinned", pinned: "end" as const },
])("a $position column can keep its blank space outside row activation", async ({ pinned }) => {
  const clicked: string[] = [];
  const el = await table({
    rowClick: (row: Row) => clicked.push(row.id),
    columns: [
      { key: "name", label: "Name", cell: (row) => row.name },
      {
        key: "action",
        label: "Action",
        pinned,
        activatesRow: false,
        cell: (row) => html`<button aria-label=${`Edit ${row.name}`}>Edit</button>`,
      },
    ],
  });
  const cell = el.shadowRoot!.querySelector<HTMLElement>("tbody tr td:last-child")!;
  const box = cell.getBoundingClientRect();
  expect(el.shadowRoot!.elementFromPoint(box.x + 2, box.y + 2)).toBe(cell);
  await userEvent.click(cell, { position: { x: 2, y: 2 } });
  expect(clicked).toEqual([]);
});

test("a real click on a control inside a pinned cell does not open its clickable row", async () => {
  const clicked: string[] = [];
  const { el } = await narrowTable("end", { rowClick: (row: Row) => clicked.push(row.id) });
  await userEvent.click(el.shadowRoot!.querySelector('button[aria-label="Edit Bea"]')!);
  expect(clicked).toEqual([]);
});

test("a real click on an unpinned cell of a clickable row with a pinned column opens it once", async () => {
  const clicked: string[] = [];
  const { el } = await narrowTable("end", { rowClick: (row: Row) => clicked.push(row.id) });
  const cell = el.shadowRoot!.querySelector<HTMLElement>("tbody tr td")!;
  const box = cell.getBoundingClientRect();
  expect(el.shadowRoot!.elementFromPoint(box.x + 2, box.y + 2)).toBe(
    cell.querySelector(".row-activate"),
  );
  await userEvent.click(cell, { position: { x: 2, y: 2 } });
  expect(clicked).toEqual(["b"]);
});

test("a real click on a shared button inside a pinned cell does not also open its clickable row", async () => {
  const clicked: string[] = [];
  const pressed: string[] = [];
  const el = await table({
    rowClick: (row: Row) => clicked.push(row.id),
    columns: [
      ...pinnedColumns().slice(0, 2),
      {
        key: "action",
        label: "Actions",
        pinned: "end",
        cell: (row) => html`<wt-button @click=${() => pressed.push(row.id)}>Edit</wt-button>`,
      },
    ],
  });
  el.style.width = "240px";
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector("wt-button")!);
  expect(pressed).toEqual(["b"]);
  expect(clicked).toEqual([]);
});

test("a click on a pinned cell's empty space raises no error in a table without rowClick", async () => {
  const { el } = await narrowTable("end");
  const errors: string[] = [];
  const record = (event: ErrorEvent) => errors.push(event.message);
  addEventListener("error", record);
  onTestFinished(() => removeEventListener("error", record));
  await clickPinnedPadding(el);
  expect(errors).toEqual([]);
});

/** The glyph box of a text node; two runs in the same font share a baseline when these bottoms match. */
function textBox(parent: Element): DOMRect {
  const text = [...parent.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
  )!;
  const range = document.createRange();
  range.selectNodeContents(text);
  return range.getBoundingClientRect();
}

test("lines a multi-line cell's first line up with the buttons beside it, at the row's top", async () => {
  registerIcons({ "baseline-kebab": "M7 2h2v2H7zM7 7h2v2H7zM7 12h2v2H7z" });
  const el = await table({
    rows: [{ id: "a", name: "Kitchen printer", count: 1 }],
    columns: [
      {
        key: "name",
        label: "Name",
        cell: (row) =>
          html`<strong data-test="first-line">${row.name}</strong>
            <div>Network</div>
            <div>192.168.1.50:9100</div>
            <div>Seen on Kitchen tablet</div>`,
      },
      { key: "add", label: "Add", cell: () => html`<wt-button variant="primary">Add</wt-button>` },
      {
        key: "actions",
        label: "Actions",
        pinned: "end",
        cell: () =>
          html`<wt-row-actions label="More" icon="baseline-kebab" align="end"
            ><wt-button align="start">Edit</wt-button></wt-row-actions
          >`,
      },
    ],
  });
  const root = el.shadowRoot!;
  const row = root.querySelector("tbody tr")!.getBoundingClientRect();
  const firstLine = textBox(root.querySelector('[data-test="first-line"]')!);
  const add = root.querySelector<HTMLElement>("tbody td > wt-button")!;
  const addText = textBox(add);
  const addBox = add.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(add.closest("td")!).paddingTop);
  const icon = root.querySelector("wt-row-actions")!.shadowRoot!.querySelector("wt-icon")!;
  const iconBox = icon.getBoundingClientRect();
  const iconMiddle = iconBox.top + iconBox.height / 2;

  expect(Math.abs(addText.bottom - firstLine.bottom), "the two baselines").toBeLessThanOrEqual(2);
  expect(addBox.top - row.top, "the button's distance from the row's top").toBeLessThanOrEqual(
    padding + 2,
  );
  expect(iconMiddle, "the menu icon against the first line").toBeGreaterThanOrEqual(firstLine.top);
  expect(iconMiddle, "the menu icon against the first line").toBeLessThanOrEqual(firstLine.bottom);
});

test("lines each tree row's name up with the text beside it, with a toggle or without", async () => {
  const el = await treeTable({
    columns: [...treeColumns, { key: "id", label: "Key", cell: (r: TreeRow) => r.id }],
  });
  for (const row of el.shadowRoot!.querySelectorAll("tbody tr")) {
    const [name, key] = row.querySelectorAll("td");
    const beside = textBox(key!).bottom;
    expect(
      Math.abs(textBox(name!.querySelector(".tree-cell")!).bottom - beside),
      row.getAttribute("data-row-key")!,
    ).toBeLessThanOrEqual(1);
  }
});

async function emptyTable(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount(
    `<wt-data-table aria-label="Users"
      ><wt-button slot="empty-action" data-test="add">Add user</wt-button></wt-data-table
    >`,
  )) as WtDataTable<Row>;
  Object.assign(el, {
    rows: [],
    columns,
    rowKey: (row: Row) => row.id,
    emptyMessage: "No users yet.",
    ...props,
  });
  await el.updateComplete;
  return el;
}

test("a table with no rows draws its sentence in a padded box with the table's border and corners", async () => {
  const el = await emptyTable();
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-radius-md", "7px");
  host.style.setProperty("--wt-space-6", "31px");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  const box = el.shadowRoot!.querySelector(".empty")!;
  expect(box.querySelector('[role="status"]')!.textContent).toContain("No users yet.");
  const style = getComputedStyle(box);
  expect(style.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(style.borderTopStyle).toBe("solid");
  expect(style.borderTopWidth).toBe("1px");
  expect(style.borderBottomLeftRadius).toBe("7px");
  expect(style.paddingTop).toBe("31px");
  expect(style.paddingLeft).toBe("31px");
  expect(style.backgroundColor).toBe("rgb(7, 8, 9)");
  const sentence = box.querySelector(".message")!.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  expect(sentence.left - frame.left).toBeCloseTo(frame.right - sentence.right, 0);
});

test("an empty table shows the button its screen puts in the empty-action slot, centred under the sentence", async () => {
  const el = await emptyTable();
  const button = el.querySelector<HTMLElement>("[data-test=add]")!;
  expect(button.assignedSlot).not.toBeNull();
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  await userEvent.click(button);
  expect(clicked).toHaveBeenCalledOnce();
  const box = el.shadowRoot!.querySelector(".empty")!.getBoundingClientRect();
  const sentence = el.shadowRoot!.querySelector(".empty .message")!.getBoundingClientRect();
  const action = button.getBoundingClientRect();
  expect(action.width).toBeGreaterThan(0);
  expect(action.top).toBeGreaterThanOrEqual(sentence.bottom);
  expect(action.bottom).toBeLessThanOrEqual(box.bottom);
  expect(action.left - box.left).toBeCloseTo(box.right - action.right, 0);
});

test("a table with rows does not show the empty-action button", async () => {
  const el = await emptyTable({ rows });
  const button = el.querySelector<HTMLElement>("[data-test=add]")!;
  expect(button.assignedSlot).toBeNull();
  expect(button.getBoundingClientRect().width).toBe(0);
  expect(el.shadowRoot!.querySelector(".empty")).toBeNull();
});

test("when nothing matches, the same box holds the sentence and no empty-action button", async () => {
  const el = await emptyTable({
    rows,
    searchable: true,
    noMatchesMessage: "Nothing matches",
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
    ],
  });
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "zzz";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  const box = el.shadowRoot!.querySelector(".empty")!;
  expect(box.querySelector('[role="status"]')!.textContent).toBe("Nothing matches");
  expect(getComputedStyle(box).borderTopColor).toBe("rgb(1, 2, 3)");
  const button = el.querySelector<HTMLElement>("[data-test=add]")!;
  expect(button.assignedSlot).toBeNull();
  expect(button.getBoundingClientRect().width).toBe(0);
});

test("an empty table whose screen puts nothing in the empty-action slot draws a box the same height as the no-matches box", async () => {
  const sentence = "Nothing to show.";
  const empty = await table({ rows: [], emptyMessage: sentence });
  const searched = await emptyTable({
    rows,
    searchable: true,
    noMatchesMessage: sentence,
    columns: [
      { key: "name", label: "Name", cell: (r: Row) => r.name, searchValue: (r: Row) => r.name },
    ],
  });
  const input = searched.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "zzz";
  input.dispatchEvent(new Event("input"));
  await searched.updateComplete;
  const box = (el: Element) => el.shadowRoot!.querySelector(".empty")!.getBoundingClientRect();
  expect(box(empty).width).toBeCloseTo(box(searched).width, 1);
  expect(box(empty).height).toBeGreaterThan(0);
  expect(box(empty).height).toBeCloseTo(box(searched).height, 1);
});

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
  expect(end.getBoundingClientRect().right).toBeLessThanOrEqual(
    trigger(el).getBoundingClientRect().left,
  );
});

test("draws the toolbar for slotted controls alone", async () => {
  const el = (await mount(
    '<wt-data-table aria-label="Users"><button slot="toolbar-end">Select</button></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector(".table-toolbar .table-end slot[name=toolbar-end]"),
  ).not.toBeNull();
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
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
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
  const el = await treeTable({
    initiallyCollapsed: true,
    searchTerm: "breakfast",
    searchOpensPath: true,
  });
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
  first
    .shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] button.tree-toggle')!
    .click();
  await first.updateComplete;
  expect(JSON.parse(localStorage.getItem("test.tree:expanded")!)).toEqual(["food"]);
  cleanup();
  const second = await treeTable(props);
  expect(treeKeys(second)).toEqual(["food", "break", "drinks"]);
  second
    .shadowRoot!.querySelector<HTMLButtonElement>('tr[data-row-key="food"] button.tree-toggle')!
    .click();
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
  const el = await treeTable({
    initiallyCollapsed: true,
    viewKey: "test.tree",
    rememberExpanded: true,
  });
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("a stored open list keeps its keys and drops anything that is not one", async () => {
  localStorage.setItem("test.tree:expanded", '[5, "food"]');
  const el = await treeTable({
    initiallyCollapsed: true,
    viewKey: "test.tree",
    rememberExpanded: true,
  });
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
});

test("blocked local storage leaves every branch closed, and opening one still works", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const el = await treeTable({
    initiallyCollapsed: true,
    viewKey: "test.tree",
    rememberExpanded: true,
  });
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

test("expandAllIncludes limits Expand all, Collapse all and the button's label to the branches it names", async () => {
  const el = await treeTable({
    initiallyCollapsed: true,
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
    expandAllIncludes: (row: TreeRow) => row.id === "food",
  });
  const button = () => el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  expect(button().textContent!.trim()).toBe("Expand all");
  button().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  expect(button().textContent!.trim()).toBe("Collapse all");
  el.setExpanded("break", true);
  await el.updateComplete;
  button().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  expect(button().textContent!.trim()).toBe("Expand all");
  el.setExpanded("food", true);
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks"]);
});

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

test("Collapse all never counts an always-open branch as closed", async () => {
  const el = await treeTable({
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
    rowCollapsible: (row: TreeRow) => row.id !== "food",
  });
  el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!.click();
  await el.updateComplete;
  expect(el.isExpanded("food")).toBe(true);
  expect(el.isExpanded("break")).toBe(false);
});

test("Expand all passes over a row whose parent is not in the table", async () => {
  const el = await treeTable({
    rows: [...treeRows, { id: "stray", parent: "gone", name: "Stray" }],
    initiallyCollapsed: true,
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
    rowCollapsible: (row: TreeRow) => row.id !== "drinks",
  });
  const button = () => el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
  button().click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "eggs", "drinks", "stray"]);
  expect(button().textContent!.trim()).toBe("Collapse all");
});

test("Expand all reads Expand all on a tree with no branch to open", async () => {
  const el = await treeTable({
    rows: [{ id: "food", parent: null, name: "Food" }],
    expandAllLabel: "Expand all",
    collapseAllLabel: "Collapse all",
  });
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!.textContent!.trim()).toBe(
    "Expand all",
  );
});

test("draws the toolbar for a control slotted at its start alone", async () => {
  const el = (await mount(
    '<wt-data-table aria-label="Users"><button slot="toolbar-start">Find</button></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".table-toolbar slot[name=toolbar-start]")).not.toBeNull();
  expect(el.shadowRoot!.querySelector(".table-end")).toBeNull();
});

test("rememberExpanded without a view key neither reads nor writes the browser's storage", async () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const el = await treeTable({ initiallyCollapsed: true, rememberExpanded: true });
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="food"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "break", "drinks"]);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test("a stored open list is not read without rememberExpanded", async () => {
  localStorage.setItem("test.tree:expanded", '["food"]');
  const el = await treeTable({ initiallyCollapsed: true, viewKey: "test.tree" });
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
});

test("a view key given after the first draw opens the branches remembered under it", async () => {
  const el = await treeTable({ initiallyCollapsed: true, rememberExpanded: true });
  expect(treeKeys(el)).toEqual(["food", "drinks"]);
  localStorage.setItem("test.tree:expanded", '["drinks"]');
  el.viewKey = "test.tree";
  el.rows = [...treeRows, { id: "cola", parent: "drinks", name: "Cola" }];
  await el.updateComplete;
  expect(treeKeys(el)).toEqual(["food", "drinks", "cola"]);
});

test("writing the open list back drops what was stored that is not a key", async () => {
  localStorage.setItem("test.tree:expanded", '[5, "food"]');
  const el = await treeTable({
    initiallyCollapsed: true,
    viewKey: "test.tree",
    rememberExpanded: true,
  });
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    'tr[data-row-key="break"] button.tree-toggle',
  )!.click();
  await el.updateComplete;
  expect(JSON.parse(localStorage.getItem("test.tree:expanded")!)).toEqual(["food", "break"]);
});

test("while searching, a row under a branch that does not match stays out", async () => {
  const el = await treeTable({
    rows: [...treeRows, { id: "cola", parent: "drinks", name: "Cola" }],
    searchTerm: "eggs",
    searchOpensPath: true,
  });
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
});

test("while searching, rows two levels under a match stay reachable", async () => {
  const el = await treeTable({
    initiallyCollapsed: true,
    searchTerm: "food",
    searchOpensPath: true,
  });
  expect(treeKeys(el)).toEqual(["food"]);
  for (const key of ["food", "break"]) {
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      `tr[data-row-key="${key}"] button.tree-toggle`,
    )!.click();
    await el.updateComplete;
  }
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
});

test("while searching, a row that matches or sits under a match is not marked ancestor-only", async () => {
  const seen: Record<string, boolean> = {};
  const el = await treeTable({
    rows: [
      { id: "food", parent: null, name: "Food" },
      { id: "break", parent: "food", name: "Breakfast" },
      { id: "eggs", parent: "break", name: "Eggs with food" },
    ],
    columns: [
      {
        key: "name",
        label: "Name",
        sortValue: (row) => row.name,
        cell: (row, context) => {
          seen[row.id] = context.ancestorOnly;
          return row.name;
        },
      },
    ],
    searchTerm: "food",
    searchOpensPath: true,
  });
  expect(treeKeys(el)).toEqual(["food", "break", "eggs"]);
  expect(seen).toEqual({ food: false, break: false, eggs: false });
});

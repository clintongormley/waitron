import { afterEach, expect, test, vi } from "vitest";
import { chooseOption, chooseOptions, cleanup, mount } from "../test-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

type Person = { id: string; name: string; status: string };

const people: Person[] = [
  { id: "1", name: "Ada", status: "active" },
  { id: "2", name: "Bea", status: "off" },
  { id: "3", name: "Cy", status: "paused" },
];

const statusFilter = {
  label: "Filter by status",
  allLabel: "Any status",
  value: (person: Person) => person.status,
  options: [
    { value: "active", label: "Active" },
    { value: "off", label: "Inactive" },
    { value: "paused", label: "Paused" },
  ],
};

const name: DataTableColumn<Person> = {
  key: "name",
  label: "Name",
  cell: (person) => person.name,
  sortValue: (person) => person.name,
};

function statusColumn(filter: Partial<NonNullable<DataTableColumn<Person>["filter"]>>) {
  return {
    key: "status",
    label: "Status",
    cell: (person: Person) => person.status,
    filter: { ...statusFilter, ...filter },
  } satisfies DataTableColumn<Person>;
}

async function peopleTable(props: Partial<WtDataTable<Person>>): Promise<WtDataTable<Person>> {
  const el = (await mount(
    '<wt-data-table aria-label="People"></wt-data-table>',
  )) as WtDataTable<Person>;
  Object.assign(el, { rows: people, rowKey: (person: Person) => person.id, ...props });
  await el.updateComplete;
  return el;
}

function shownKeys(el: HTMLElement): (string | null)[] {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-row-key"),
  );
}

function filterChanges(el: WtDataTable<Person>): unknown[] {
  const changes: unknown[] = [];
  el.addEventListener("wt-filter-change", (event) =>
    changes.push((event as CustomEvent<{ filters: unknown }>).detail.filters),
  );
  return changes;
}

async function clearAll(el: WtDataTable<Person>): Promise<void> {
  el.shadowRoot!.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
  await el.updateComplete;
}

const statusSelect = (el: WtDataTable<Person>) =>
  el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!;

test("Clear all over a filter with an initial choice reports the all choice once, and nothing when pressed again", async () => {
  const el = await peopleTable({ columns: [name, statusColumn({ initial: "active" })] });
  const changes = filterChanges(el);
  await chooseOption(statusSelect(el), "off");
  expect(shownKeys(el)).toEqual(["2"]);
  await clearAll(el);
  expect(shownKeys(el)).toEqual(["1", "2", "3"]);
  await clearAll(el);
  expect(changes).toEqual([{ status: "off" }, { status: "" }]);
});

test("Clear all over a multi-select filter with an initial choice reports the all choice once, and nothing when pressed again", async () => {
  const el = await peopleTable({
    columns: [
      name,
      statusColumn({ initial: "active", multiple: { countLabel: (count) => `${count} statuses` } }),
    ],
  });
  const changes = filterChanges(el);
  await chooseOptions(statusSelect(el), ["off", "paused"]);
  await el.updateComplete;
  expect(shownKeys(el)).toEqual(["2", "3"]);
  await clearAll(el);
  expect(shownKeys(el)).toEqual(["1", "2", "3"]);
  await clearAll(el);
  expect(changes).toEqual([{ status: ["off", "paused"] }, { status: [] }]);
});

test("a stored multi-select choice holding a value that is not text is ignored whole", async () => {
  sessionStorage.setItem("people.mixed", JSON.stringify({ filters: { status: [1, "off"] } }));
  const el = await peopleTable({
    viewKey: "people.mixed",
    columns: [name, statusColumn({ multiple: { countLabel: (count) => `${count} statuses` } })],
  });
  expect(shownKeys(el)).toEqual(["1", "2", "3"]);
  expect(statusSelect(el).values).toEqual([]);
});

test("a stored ascending sort overrides a table that sorts descending by default", async () => {
  sessionStorage.setItem(
    "people.sorted",
    JSON.stringify({ sortKey: "name", sortDirection: "ascending" }),
  );
  const el = await peopleTable({
    viewKey: "people.sorted",
    columns: [name],
    sortKey: "name",
    sortDirection: "descending",
  });
  expect(el.sortDirection).toBe("ascending");
  expect(shownKeys(el)).toEqual(["1", "2", "3"]);
});

type Node = { id: string; parent: string | null; name: string };

const menu: Node[] = [
  { id: "food", parent: null, name: "Food" },
  { id: "eggs", parent: "food", name: "Eggs" },
  { id: "drinks", parent: null, name: "Drinks" },
  { id: "tea", parent: "drinks", name: "Tea" },
];

const nodeColumns: DataTableColumn<Node>[] = [
  {
    key: "name",
    label: "Name",
    cell: (node) => node.name,
    sortValue: (node) => node.name,
    searchValue: (node) => node.name,
  },
];

async function menuTable(props: Partial<WtDataTable<Node>>): Promise<WtDataTable<Node>> {
  const el = (await mount(
    '<wt-data-table aria-label="Menu"></wt-data-table>',
  )) as WtDataTable<Node>;
  Object.assign(el, {
    rows: menu,
    columns: nodeColumns,
    rowKey: (node: Node) => node.id,
    rowParent: (node: Node) => node.parent,
    sortKey: "name",
    ...props,
  });
  await el.updateComplete;
  return el;
}

async function clickToggle(el: WtDataTable<Node>, key: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLButtonElement>(
    `tr[data-row-key="${key}"] .tree-toggle`,
  )!.click();
  await el.updateComplete;
}

test("turning rememberExpanded on opens a remembered branch that arrives afterwards", async () => {
  localStorage.setItem("menu.later:expanded", JSON.stringify(["drinks"]));
  const el = await menuTable({
    viewKey: "menu.later",
    initiallyCollapsed: true,
    rows: menu.filter((node) => node.id !== "tea"),
  });
  expect(shownKeys(el)).toEqual(["drinks", "food"]);
  el.rememberExpanded = true;
  el.rows = menu;
  await el.updateComplete;
  expect(shownKeys(el)).toEqual(["drinks", "tea", "food"]);
});

test("while a flat search shows matches, a match the person opened stays open when the rows are handed over again", async () => {
  const el = await menuTable({
    initiallyCollapsed: true,
    flatTreeSearch: true,
    searchTerm: "food",
  });
  expect(shownKeys(el)).toEqual(["food"]);
  await clickToggle(el, "food");
  expect(shownKeys(el)).toEqual(["food", "eggs"]);
  el.rows = [...menu];
  await el.updateComplete;
  expect(shownKeys(el)).toEqual(["food", "eggs"]);
});

test("a stored multi-select choice drops a value its column no longer offers and keeps the rest", async () => {
  sessionStorage.setItem("people.gone", JSON.stringify({ filters: { status: ["off", "gone"] } }));
  const el = await peopleTable({
    viewKey: "people.gone",
    columns: [name, statusColumn({ multiple: { countLabel: (count) => `${count} statuses` } })],
  });
  expect(shownKeys(el)).toEqual(["2"]);
  expect(statusSelect(el).values).toEqual(["off"]);
  expect(JSON.parse(sessionStorage.getItem("people.gone")!).filters).toEqual({ status: ["off"] });
});

test("a chosen filter still applies when new columns arrive, and the new column is drawn", async () => {
  const el = await peopleTable({ columns: [name, statusColumn({})] });
  await chooseOption(statusSelect(el), "off");
  expect(shownKeys(el)).toEqual(["2"]);
  el.columns = [
    name,
    statusColumn({}),
    { key: "id", label: "Number", cell: (person) => person.id },
  ];
  await el.updateComplete;
  expect(shownKeys(el)).toEqual(["2"]);
  expect(
    [...el.shadowRoot!.querySelectorAll("thead th")].map((th) => th.textContent!.trim()),
  ).toEqual(["Name", "Status", "Number"]);
});

test("Clear all clears a choice in one column while another column's multi-select still shows its initial choice", async () => {
  const el = await peopleTable({
    columns: [
      {
        ...name,
        filter: {
          label: "Filter by name",
          allLabel: "Anyone",
          value: (person) => person.name,
          options: people.map((person) => ({ value: person.name, label: person.name })),
        },
      },
      statusColumn({ initial: "off", multiple: { countLabel: (count) => `${count} statuses` } }),
    ],
  });
  const changes = filterChanges(el);
  expect(shownKeys(el)).toEqual(["2"]);
  await chooseOption(
    el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="name"]')!,
    "Bea",
  );
  expect(shownKeys(el)).toEqual(["2"]);
  await clearAll(el);
  expect(shownKeys(el)).toEqual(["1", "2", "3"]);
  expect(changes).toEqual([{ name: "Bea" }, { status: [] }]);
});

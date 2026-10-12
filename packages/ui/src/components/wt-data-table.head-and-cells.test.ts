import { html } from "lit";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption, cleanup, mount } from "../test-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-button.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

type Row = { id: string; parent: string | null; name: string; status: string };

const rows: Row[] = [
  { id: "food", parent: null, name: "Food", status: "active" },
  { id: "eggs", parent: "food", name: "Eggs", status: "off" },
  { id: "drinks", parent: null, name: "Drinks", status: "active" },
];

const statusFilter: NonNullable<DataTableColumn<Row>["filter"]> = {
  label: "Filter by status",
  allLabel: "Any status",
  value: (row) => row.status,
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
};
const statusColumn: DataTableColumn<Row> = {
  key: "status",
  label: "Status",
  cell: (row) => row.status,
  filter: statusFilter,
};

async function table(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount('<wt-data-table aria-label="Menu"></wt-data-table>')) as WtDataTable<Row>;
  Object.assign(el, { rows, columns: [nameColumn], rowKey: (row: Row) => row.id, ...props });
  await el.updateComplete;
  return el;
}

function box(element: Element): DOMRect {
  return element.getBoundingClientRect();
}

async function wide(): Promise<void> {
  const width = innerWidth;
  const height = innerHeight;
  await page.viewport(1280, 844);
  onTestFinished(() => page.viewport(width, height));
}

for (const controls of ["none", "selectable", "row controls"] as const) {
  test(`each column group's heading sits over its own columns, with ${controls}`, async () => {
    await wide();
    const cell = (key: string) => (row: Row) => `${key} ${row.name}`;
    const el = await table({
      columns: [
        { key: "a", label: "A", group: "Kitchen", cell: cell("a") },
        { key: "b", label: "B", group: "Kitchen", cell: cell("b") },
        { key: "c", label: "C", group: "Kitchen", cell: cell("c") },
        { key: "d", label: "D", cell: cell("d") },
        { key: "e", label: "E", group: "Bar", cell: cell("e") },
      ],
      selectable: controls === "selectable",
      rowControls: controls === "row controls" ? (row) => html`<b>${row.id}</b>` : undefined,
    });
    const root = el.shadowRoot!;
    const groups = [...root.querySelectorAll<HTMLElement>('thead th[scope="colgroup"]')];
    expect(groups.map((group) => group.textContent!.trim())).toEqual(["Kitchen", "Bar"]);
    const heading = (label: string) =>
      box(
        [...root.querySelectorAll('thead th[scope="col"]')].find(
          (th) => th.textContent!.trim() === label,
        )!,
      );
    expect(box(groups[0]!).left).toBeCloseTo(heading("A").left, 0);
    expect(box(groups[0]!).right).toBeCloseTo(heading("C").right, 0);
    expect(box(groups[1]!).left).toBeCloseTo(heading("E").left, 0);
    expect(box(groups[1]!).right).toBeCloseTo(heading("E").right, 0);
  });
}

test("only a heading whose filter narrows the rows is named as filtered", async () => {
  const el = await table({ columns: [nameColumn, statusColumn] });
  const root = el.shadowRoot!;
  const named = () =>
    [...root.querySelectorAll('thead th[scope="col"]')].map((th) => th.getAttribute("aria-label"));
  expect(named()).toEqual([null, null]);
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "active");
  await el.updateComplete;
  expect(named()).toEqual([null, "Status: Filtered"]);
});

for (const tree of [false, true]) {
  test(`centred row controls are a row-controls setting: a selectable table without them stays on the baseline, tree ${tree}`, async () => {
    const el = await table({
      selectable: true,
      rowControlsAlign: "center",
      rowParent: tree ? (row) => row.parent : undefined,
    });
    for (const cell of el.shadowRoot!.querySelectorAll("tbody td"))
      expect(getComputedStyle(cell).verticalAlign).toBe("baseline");
  });

  test(`only the actions column shrinks to its menu among the end-pinned columns, tree ${tree}`, async () => {
    await wide();
    const button = (row: Row) => html`<button>Edit ${row.id}</button>`;
    const el = await table({
      columns: [
        nameColumn,
        { key: "notes", label: "Notes", pinned: "end", cell: button },
        { key: "actions", label: "Actions", pinned: "end", cell: button },
        { key: "extra", label: "Extra", pinned: "end", cell: (row) => row.id },
      ],
      rowParent: tree ? (row) => row.parent : undefined,
    });
    const width = (label: string) =>
      box(
        [...el.shadowRoot!.querySelectorAll("thead th")].find(
          (th) => th.textContent!.trim() === label,
        )!,
      ).width;
    const content = box(el.shadowRoot!.querySelector('tbody tr[data-row-key="food"] td button')!);
    // The actions column is as wide as its button and the cell's padding, no wider; the other
    // end-pinned column before the last, holding the same button, takes a share of the spare width.
    expect(width("Actions")).toBeLessThan(content.width + 40);
    expect(width("Notes")).toBeGreaterThan(content.width + 80);
  });
}

const filterRows: Row[] = [
  { id: "1", parent: null, name: "Ada Active", status: "active" },
  { id: "2", parent: null, name: "Bea Inactive", status: "off" },
];

test("row controls the consumer adds while a filter holds the widths take their own width", async () => {
  await wide();
  const el = await table({ rows: filterRows, columns: [nameColumn, statusColumn] });
  const root = el.shadowRoot!;
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "active");
  await el.updateComplete;
  el.rowControls = (row) => html`<button>Move ${row.name}</button>`;
  await el.updateComplete;
  const controls = root.querySelector("tbody tr td.select")!;
  const button = controls.querySelector("button")!;
  expect(box(button).right).toBeLessThanOrEqual(box(controls).right);
  expect(box(root.querySelector("table")!).right).toBeLessThanOrEqual(
    box(root.querySelector(".scroll")!).right + 0.5,
  );
});

test("the chooser draws a column that cannot be hidden muted, and one that can in the text colour", async () => {
  const el = await table({
    columns: [
      nameColumn,
      { key: "a", label: "A", cell: (row) => row.id, choosable: "shown" },
      { key: "b", label: "B", cell: (row) => row.id },
      { key: "c", label: "C", cell: (row) => row.id, choosable: "hidden" },
    ],
  });
  const root = el.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".columns-trigger")!.click();
  await el.updateComplete;
  const colour = (key: string) =>
    getComputedStyle(root.querySelector(`[data-column-row="${key}"]`)!).color;
  expect(colour("b")).toBe(colour("name"));
  expect(colour("a")).not.toBe(colour("b"));
  expect(colour("c")).toBe(colour("a"));
});

test("an arrow key on a column's grip moves the column and goes no further", async () => {
  const el = await table({
    columns: [
      nameColumn,
      { key: "a", label: "A", cell: (row) => row.id, choosable: "shown" },
      { key: "b", label: "B", cell: (row) => row.id, choosable: "shown" },
    ],
  });
  const root = el.shadowRoot!;
  root.querySelector<HTMLButtonElement>(".columns-trigger")!.click();
  await el.updateComplete;
  const outside = vi.fn();
  document.addEventListener("keydown", outside);
  onTestFinished(() => document.removeEventListener("keydown", outside));
  const press = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  expect(root.querySelector('button[data-reorder="a"]')!.dispatchEvent(press)).toBe(false);
  await el.updateComplete;
  expect(outside).not.toHaveBeenCalled();
  expect([...root.querySelectorAll("thead th")].map((th) => th.textContent!.trim())).toEqual([
    "Name",
    "B",
    "A",
  ]);
});

test("Tab in the full-screen Filters panel moves on from Clear all and from a filter that is not the last", async () => {
  const width = innerWidth;
  const height = innerHeight;
  await page.viewport(390, 900);
  onTestFinished(() => page.viewport(width, height));
  const el = await table({
    columns: [nameColumn, statusColumn, { ...statusColumn, key: "other" }],
  });
  const root = el.shadowRoot!;
  const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
  trigger.click();
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  const panel = root.querySelector<HTMLElement>(".filters-panel")!;
  await vi.waitFor(() => expect(panel.hasAttribute("data-fullscreen")).toBe(true));
  panel.querySelector<HTMLButtonElement>(".filters-clear-all")!.focus();
  await userEvent.keyboard("{Tab}");
  expect(root.activeElement).toBe(panel.querySelector(".filters-close"));
  const [first, second] = panel.querySelectorAll<WtCombobox>("wt-combobox");
  first!.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.focus();
  await userEvent.keyboard("{Tab}");
  expect(root.activeElement).toBe(second);
});

test("Escape in the Filters panel beside the rows closes it, returns focus to Filters and is consumed", async () => {
  await wide();
  const el = await table({ columns: [nameColumn, statusColumn] });
  const root = el.shadowRoot!;
  const trigger = root.querySelector<HTMLButtonElement>(".filters-trigger")!;
  const panel = root.querySelector<HTMLElement>(".filters-panel")!;
  await vi.waitFor(() => expect(panel.hasAttribute("data-side")).toBe(true));
  trigger.click();
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  await el.updateComplete;
  expect(panel.hidden).toBe(false);
  const close = panel.querySelector<HTMLButtonElement>(".filters-close")!;
  close.focus();
  const press = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  expect(close.dispatchEvent(press)).toBe(false);
  await el.updateComplete;
  expect(panel.hidden).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(root.activeElement).toBe(trigger);
});

const treeProps = { rowParent: (row: Row) => row.parent };

test("a branch the person closed is drawn open while a search holds it open for a match below", async () => {
  const el = await table(treeProps);
  el.setExpanded("food", false);
  await el.updateComplete;
  el.searchTerm = "eggs";
  await el.updateComplete;
  const food = el.shadowRoot!.querySelector('tr[data-row-key="food"]')!;
  expect(food.getAttribute("aria-expanded")).toBe("true");
  expect(el.shadowRoot!.querySelector('tr[data-row-key="eggs"]')).not.toBeNull();
});

test("a top-level row is never drawn joined to a parent, even when rowJoinsParent says so", async () => {
  const background = async (props: Partial<WtDataTable<Row>>) => {
    const el = await table({ ...treeProps, ...props });
    const cell = (key: string) =>
      getComputedStyle(el.shadowRoot!.querySelector(`tr[data-row-key="${key}"] td`)!)
        .backgroundColor;
    const colours = [cell("food"), cell("eggs")];
    cleanup();
    return colours;
  };
  const [plainRoot, plainChild] = await background({});
  const [joinedRoot, joinedChild] = await background({ rowJoinsParent: () => true });
  expect(joinedRoot).toBe(plainRoot);
  expect(joinedChild).not.toBe(plainChild);
});

test("clicking the empty space of an end-pinned cell opens a tree row", async () => {
  const opened = vi.fn();
  const el = await table({
    ...treeProps,
    columns: [nameColumn, { key: "menu", label: "Menu", pinned: "end", cell: () => "" }],
    rowClick: opened,
  });
  el.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="eggs"] td[data-pinned="end"]',
  )!.click();
  expect(opened).toHaveBeenCalledWith(rows[1]);
});

test("clicking an end-pinned cell of a tree row that opens nothing does nothing", async () => {
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.message);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  onTestFinished(() => window.removeEventListener("error", onError));
  const el = await table({
    ...treeProps,
    columns: [nameColumn, { key: "menu", label: "Menu", pinned: "end", cell: () => "" }],
  });
  el.shadowRoot!.querySelector<HTMLElement>(
    'tr[data-row-key="eggs"] td[data-pinned="end"]',
  )!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toEqual([]);
});

test("in a tree row that opens something, a click on a cell opens it unless the column opts out", async () => {
  await wide();
  const opened = vi.fn();
  const el = await table({
    ...treeProps,
    columns: [
      nameColumn,
      { key: "status", label: "Status", cell: (row) => row.status },
      { key: "own", label: "Own", activatesRow: false, cell: (row) => row.id },
    ],
    rowClick: opened,
  });
  const cells = el.shadowRoot!.querySelectorAll('tr[data-row-key="eggs"] td');
  const hit = (cell: Element) => el.shadowRoot!.elementFromPoint(box(cell).x + 2, box(cell).y + 2);
  expect(hit(cells[2]!)).toBe(cells[2]);
  const activator = hit(cells[1]!) as HTMLButtonElement;
  expect(activator.matches(".row-activate")).toBe(true);
  activator.click();
  expect(opened).toHaveBeenCalledWith(rows[1]);
});

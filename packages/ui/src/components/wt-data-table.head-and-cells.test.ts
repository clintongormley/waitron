import { html } from "lit";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  chooseOption,
  cleanup,
  elementPixels,
  emulateForcedColours,
  mount,
} from "../test-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-button.js";
import "./wt-switch.js";
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

async function clickPadding(cell: Element, x = 3): Promise<void> {
  const { left, top } = box(cell);
  const position = { x, y: 3 };
  const root = cell.getRootNode() as ShadowRoot;
  expect(root.elementFromPoint(left + position.x, top + position.y)).toBe(cell);
  await userEvent.click(cell, { position });
}

test.each(["tree", "pinned"] as const)("sorts from blank %s heading space once", async (mode) => {
  const pinned = mode === "pinned";
  const sortable = { ...nameColumn, sortValue: (row: Row) => row.name };
  const el = await table({
    rows: pinned ? Array.from({ length: 20 }, (_, i) => ({ ...rows[0]!, id: String(i) })) : rows,
    columns: pinned
      ? [
          {
            ...statusColumn,
            cell: () => "Long status ".repeat(18),
            sortValue: (row) => row.status,
          },
          { ...sortable, pinned: "end" },
        ]
      : [sortable, statusColumn],
    rowParent: pinned ? undefined : (row) => row.parent,
    sortKey: pinned ? "status" : undefined,
  });
  const root = el.shadowRoot!;
  const style = document.createElement("style");
  style.textContent = "wt-data-table::part(tree-heading) { margin-inline-start: 100px; }";
  el.parentElement!.append(style);
  const scroll = root.querySelector<HTMLElement>(".scroll")!;
  if (pinned) {
    el.style.width = "300px";
    el.style.setProperty("--wt-table-max", "180px");
    // Playwright reveals the heading before clicking. Let it count the visible sticky strip.
    const tester = document.createElement("style");
    tester.textContent = ".scroll { scroll-padding-block-start: 0 !important; }";
    root.append(tester);
    scroll.scrollTo(200, 110);
    expect(scroll.scrollLeft).toBe(200);
    expect(scroll.scrollTop).toBe(110);
  }
  const button = root.querySelector<HTMLButtonElement>('[data-sort="name"]')!;
  const cell = button.closest("th")!;
  const x = pinned ? 4 : 70;
  expect(box(cell).left + x).toBeLessThan(box(button).left);
  const sort = vi.fn();
  el.addEventListener("wt-sort-change", sort);
  await clickPadding(cell, x);
  await el.updateComplete;
  expect(sort).toHaveBeenCalledTimes(1);
  expect(root.activeElement).toBe(button);
  expect([...root.querySelectorAll("th[aria-sort]")]).toEqual([cell]);
  expect(cell.getAttribute("aria-sort")).toBe("ascending");
  expect(getComputedStyle(cell).cursor).toBe("pointer");
  if (pinned) {
    expect(scroll.scrollLeft).toBe(200);
    expect(scroll.scrollTop).toBe(110);
  }
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(sort).toHaveBeenCalledTimes(2);
  expect(cell.getAttribute("aria-sort")).toBe("descending");
});

test("sorts from a visible heading without scrolling to its hidden button", async () => {
  const el = await table({
    columns: [
      { ...nameColumn, sortValue: (row) => row.name, cell: (row) => `${row.name} `.repeat(50) },
      statusColumn,
    ],
  });
  el.style.width = "300px";
  const root = el.shadowRoot!;
  const scroll = root.querySelector<HTMLElement>(".scroll")!;
  scroll.scrollLeft = 200;
  const button = root.querySelector<HTMLButtonElement>("button.sort")!;
  const cell = button.closest("th")!;
  expect(box(button).right).toBeLessThan(box(scroll).left);
  // Playwright can aim at the visible padding without revealing the whole heading.
  const visiblePadding = document.createElement("span");
  visiblePadding.style.cssText =
    "position: absolute; inset: 3px auto auto 240px; width: 12px; height: 12px";
  cell.append(visiblePadding);
  const scrollAtPress: number[] = [];
  visiblePadding.addEventListener("pointerdown", () => scrollAtPress.push(scroll.scrollLeft));
  const sort = vi.fn();
  el.addEventListener("wt-sort-change", sort);
  await clickPadding(visiblePadding);
  expect(scrollAtPress).toEqual([200]);
  expect(sort).toHaveBeenCalledTimes(1);
  expect(root.activeElement).toBe(button);
  expect(scroll.scrollLeft).toBe(200);
});

test.each(["sort", "checkbox"] as const)(
  "finishes a press on the cell's own %s in its padding",
  async (kind) => {
    const el = await table({
      columns: [{ ...nameColumn, sortValue: (row) => row.name }],
      selectable: kind === "checkbox",
    });
    const root = el.shadowRoot!;
    const control = root.querySelector(kind === "sort" ? ".sort" : '[data-test="select-food"]')!;
    const cell = control.closest("th, td")!;
    const from = box(control);
    const to = box(cell);
    const x = from.left + from.width / 2;
    const y = from.top - 2;
    const hit = root.elementFromPoint(x, y);
    expect(cell.contains(hit)).toBe(true);
    expect(control.contains(hit)).toBe(false);
    const change = vi.fn();
    el.addEventListener(kind === "sort" ? "wt-sort-change" : "wt-selection-change", change);
    await userEvent.dragAndDrop(control, cell, {
      sourcePosition: { x: from.width / 2, y: 1 },
      targetPosition: { x: x - to.left, y: y - to.top },
    });
    expect(change).toHaveBeenCalledTimes(1);
  },
);

test.each([
  { tree: false, activation: "click", grip: false },
  { tree: true, activation: "toggle", grip: true },
  { tree: true, activation: "none", grip: false },
] as const)(
  "ticks from blank selection space once ($activation)",
  async ({ tree, activation, grip }) => {
    const open = vi.fn();
    const el = await table({
      selectable: true,
      rowParent: tree ? (row) => row.parent : undefined,
      rowActivation: () => activation,
      rowClick: open,
      rowControls: grip ? () => html`<button>Move</button>` : undefined,
    });
    const root = el.shadowRoot!;
    const changes: string[][] = [];
    el.addEventListener("wt-selection-change", (event) => {
      const { selected } = (event as CustomEvent<{ selected: string[] }>).detail;
      el.selected = selected;
      changes.push(selected);
    });
    const expand = vi.fn();
    el.addEventListener("wt-expand-change", expand);
    const click = vi.fn();
    el.addEventListener("click", click);
    const rowBox = root.querySelector<HTMLInputElement>('[data-test="select-food"]')!;
    const cell = rowBox.closest("td")!;
    await clickPadding(cell);
    expect(changes).toEqual([["food"]]);
    expect(click).toHaveBeenCalledTimes(1);
    expect(root.activeElement).toBe(rowBox);
    expect(getComputedStyle(cell).cursor).toBe("pointer");
    expect(open).not.toHaveBeenCalled();
    expect(expand).not.toHaveBeenCalled();
    await userEvent.keyboard(" ");
    expect(changes).toEqual([["food"], []]);
    await userEvent.click(rowBox);
    expect(changes).toEqual([["food"], [], ["food"]]);
    await el.updateComplete;
    const selectAll = root.querySelector<HTMLInputElement>('[data-test="select-all"]')!;
    const heading = selectAll.closest("th")!;
    expect(selectAll.indeterminate).toBe(true);
    await clickPadding(heading);
    expect(changes).toHaveLength(4);
    expect(changes[3]).toEqual(expect.arrayContaining(["food", "drinks"]));
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
    expect(getComputedStyle(heading).cursor).toBe("pointer");
  },
);

test("padding beside a grip without a checkbox still opens its row", async () => {
  const open = vi.fn();
  const el = await table({ rowControls: () => html`<button>Move</button>`, rowClick: open });
  const root = el.shadowRoot!;
  const cell = root.querySelector("tbody td.select")!;
  const { left, top } = box(cell);
  const hit = root.elementFromPoint(left + 3, top + 3)!;
  const landed = box(hit);
  await userEvent.click(hit, { position: { x: left + 3 - landed.left, y: top + 3 - landed.top } });
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0]?.[0]).toEqual(rows[0]);
});

test("a supplied row control in a shadow root keeps its click", async () => {
  const el = await table({
    selectable: true,
    rowControls: (row) => html`<wt-switch label=${`Available: ${row.name}`}></wt-switch>`,
  });
  const toggle = el.shadowRoot!.querySelector("wt-switch")!;
  await toggle.updateComplete;
  const selection = vi.fn();
  el.addEventListener("wt-selection-change", selection);
  await userEvent.click(page.getByRole("switch", { name: "Available: Food" }));
  expect(toggle.checked).toBe(true);
  expect(selection).not.toHaveBeenCalled();
});

test("a joined row's contrast marker stays visible past its checkbox", async () => {
  onTestFinished(() => emulateForcedColours(null));
  await emulateForcedColours("active");
  const el = await table({
    rowParent: (row) => row.parent,
    rowJoinsParent: (row) => row.id === "eggs",
  });
  const row = el.shadowRoot!.querySelector('tr[data-row-key="eggs"]')!;
  const pixelsOnLeadingEdge = async () => {
    const at = await elementPixels(el);
    const { left, top, height } = box(row);
    return [0, 1, 2, 3].map((offset) => at(left + offset, top + height / 2).join());
  };
  const edge = await pixelsOnLeadingEdge();
  expect(edge).toContain("0,0,0");
  el.selectable = true;
  await el.updateComplete;
  expect(await pixelsOnLeadingEdge()).toEqual(edge);
});

test.each([false, true])(
  "changes only opted-in body padding at the table's own width, tree %s",
  async (tree) => {
    const el = await table({
      rowParent: tree ? (row) => row.parent : undefined,
      wrapToFit: true,
      topAligned: true,
      columns: [
        { ...nameColumn, cell: () => html`<button style="min-height: 44px">Open</button>` },
        {
          key: "details",
          label: "Details",
          cell: (row) =>
            row.id === "drinks"
              ? "A description with enough text to wrap onto several separate lines at the smaller width. ".repeat(
                  5,
                )
              : "",
        },
      ],
    });
    const root = el.shadowRoot!;
    const head = root.querySelector("th")!;
    const cell = root.querySelector("tbody td")!;
    const headerPadding = getComputedStyle(head).padding;
    const inline = getComputedStyle(cell).paddingInline;
    const ordinary = getComputedStyle(cell).paddingBlock;
    const row = cell.closest("tr")!;
    el.style.width = "540px";
    el.denseRows = true;
    await el.updateComplete;
    expect(getComputedStyle(cell).paddingBlock).toBe("2px");
    expect(box(row).height).toBeGreaterThanOrEqual(48);
    expect(box(row).height).toBeLessThanOrEqual(52);
    el.style.setProperty("--wt-space-1", "10px");
    expect(getComputedStyle(cell).paddingBlock).toBe("5px");
    el.style.removeProperty("--wt-space-1");
    el.style.width = "320px";
    await vi.waitFor(() => expect(el.hasAttribute("narrow")).toBe(true));
    expect(getComputedStyle(cell).paddingBlock).toBe("4px");
    expect(box(row).height).toBeGreaterThanOrEqual(52);
    expect(box(row).height).toBeLessThanOrEqual(56);
    expect(box(root.querySelector('tr[data-row-key="drinks"]')!).height).toBeGreaterThan(53);
    expect(getComputedStyle(head).padding).toBe(headerPadding);
    expect(getComputedStyle(cell).paddingInline).toBe(inline);
    el.style.setProperty("--wt-space-2", "14px");
    expect(getComputedStyle(cell).paddingBlock).toBe("7px");
    el.denseRows = false;
    await el.updateComplete;
    expect(getComputedStyle(cell).paddingBlock).toBe(ordinary);
    expect(el.hasAttribute("narrow")).toBe(tree);
    const parent = el.parentElement!;
    el.style.width = "540px";
    el.denseRows = true;
    await vi.waitFor(() => expect(getComputedStyle(cell).paddingBlock).toBe("2px"));
    el.remove();
    el.style.width = "320px";
    parent.append(el);
    await vi.waitFor(() => expect(getComputedStyle(cell).paddingBlock).toBe("7px"));
  },
);

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

test("wrapToFit wraps headings and text at spaces to fit the box, keeps a no-wrap item whole, and scrolls only when even that cannot fit", async () => {
  const words = "one two three four five six seven eight nine ten";
  const columns: DataTableColumn<Row>[] = [
    { key: "name", label: `Name ${words}`, cell: (row) => `${row.name} ${words}` },
    {
      key: "tag",
      label: "Tag",
      cell: () => html`<span data-test="whole" style="white-space: nowrap">kept on one line</span>`,
    },
    { key: "actions", label: "Actions", pinned: "end", cell: () => "Edit" },
  ];
  const measure = async (frameWidth: number, wrapToFit: boolean) => {
    const el = await table({ columns, wrapToFit });
    el.parentElement!.style.inlineSize = `${frameWidth}px`;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = el.shadowRoot!;
    const scroll = root.querySelector<HTMLElement>(".scroll")!;
    const heading = root.querySelector<HTMLElement>("thead th")!;
    const whole = root.querySelector<HTMLElement>("[data-test=whole]")!;
    const lines = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    };
    const result = {
      attribute: el.hasAttribute("wrap-to-fit"),
      overflow: scroll.scrollWidth - scroll.clientWidth,
      headingLines: lines(heading),
      wholeLines: lines(whole),
      cellsHoldTheirContent: [...root.querySelectorAll<HTMLElement>("th, td")].every(
        (cell) => cell.scrollWidth <= cell.clientWidth + 1,
      ),
    };
    cleanup();
    return result;
  };

  const plain = await measure(400, false);
  expect(plain).toMatchObject({ attribute: false, headingLines: 1, wholeLines: 1 });
  expect(plain.overflow).toBeGreaterThan(50);

  const fitted = await measure(400, true);
  expect(fitted.attribute).toBe(true);
  expect(fitted.overflow).toBeLessThanOrEqual(1);
  expect(fitted.headingLines).toBeGreaterThan(1);
  expect(fitted).toMatchObject({ wholeLines: 1, cellsHoldTheirContent: true });

  const tooNarrow = await measure(120, true);
  expect(tooNarrow.overflow).toBeGreaterThan(50);
  expect(tooNarrow).toMatchObject({ wholeLines: 1, cellsHoldTheirContent: true });
});

test("a capped table holds grouped, wrapped headings together and reveals rows below both", async () => {
  const el = await table({
    rows: Array.from({ length: 40 }, (_, index) => ({
      id: `r${index}`,
      parent: null,
      name: `Product ${index}`,
      status: "active",
    })),
    columns: [
      { ...nameColumn, group: "Kitchen", label: "Product name used by staff" },
      { ...statusColumn, group: "Kitchen", label: "Availability for ordering" },
    ],
    wrapToFit: true,
  });
  el.style.width = "300px";
  el.style.setProperty("--wt-table-max", "240px");
  const root = el.shadowRoot!;
  const scroll = root.querySelector<HTMLElement>(".scroll")!;
  scroll.scrollTop = scroll.scrollHeight;
  await new Promise(requestAnimationFrame);
  expect(scroll.scrollTop).toBeGreaterThan(0);
  const group = root.querySelector('th[scope="colgroup"]')!.getBoundingClientRect();
  const heading = root.querySelector('th[scope="col"]')!.getBoundingClientRect();
  expect(group.bottom).toBeLessThanOrEqual(heading.top + 0.5);
  await el.revealRow("r0");
  const row = root.querySelector('tr[data-row-key="r0"]')!.getBoundingClientRect();
  expect(row.top).toBeGreaterThanOrEqual(
    root.querySelector('th[scope="col"]')!.getBoundingClientRect().bottom - 0.5,
  );
});

test("cell inline spacing preserves the narrow tree target and leaves other spacing alone", async () => {
  const previous = { width: innerWidth, height: innerHeight };
  onTestFinished(() => page.viewport(previous.width, previous.height));
  await page.viewport(390, 844);
  const el = await table({ rowParent: (row) => row.parent, searchable: true });
  await vi.waitFor(() => expect(el.hasAttribute("narrow")).toBe(true));
  const root = el.shadowRoot!;
  const cell = root.querySelector<HTMLElement>('tbody tr[data-row-key="food"] td')!;
  const toggle = cell.querySelector<HTMLElement>(".tree-toggle")!;
  const toolbar = root.querySelector<HTMLElement>(".table-toolbar")!;
  const toolbarGap = getComputedStyle(toolbar).gap;
  expect(getComputedStyle(cell).paddingInlineStart).toBe("12px");
  el.style.setProperty("--wt-space-3", "16px");
  expect(getComputedStyle(cell).paddingInlineStart).toBe("16px");
  el.style.removeProperty("--wt-space-3");
  el.style.setProperty("--wt-table-cell-padding-inline", "var(--wt-space-1)");
  for (const painted of root.querySelectorAll("th, td")) {
    expect(getComputedStyle(painted).paddingInlineStart).toBe("4px");
    expect(getComputedStyle(painted).paddingBlockStart).toBe("12px");
  }
  expect(box(toggle).width).toBe(44);
  expect(box(toggle).height).toBe(44);
  expect(box(toggle).left).toBeGreaterThanOrEqual(box(cell).left);
  expect(getComputedStyle(toggle).marginInlineStart).toBe("-4px");
  expect(getComputedStyle(toolbar).gap).toBe(toolbarGap);
});

test("resolves default cell spacing at a part-local heading override", async () => {
  const el = await table();
  const root = el.shadowRoot!;
  el.style.setProperty("--wt-table-cell-padding-inline", "var(--wt-space-2)");
  for (const cell of root.querySelectorAll("th, td"))
    expect(getComputedStyle(cell).paddingInlineStart).toBe("8px");
  el.style.removeProperty("--wt-table-cell-padding-inline");
  const style = document.createElement("style");
  style.textContent = "wt-data-table::part(table-head) { --wt-space-3: var(--wt-space-1); }";
  document.head.append(style);
  onTestFinished(() => style.remove());
  const heading = root.querySelector("th")!;
  expect(getComputedStyle(heading).paddingBlockStart).toBe("4px");
  expect(getComputedStyle(root.querySelector("td")!).paddingInlineStart).toBe("12px");
  expect(getComputedStyle(heading).paddingInlineStart).toBe("4px");
});

test("a tree row that spans the unpinned columns draws its heading across them and keeps its pinned cells", async () => {
  const offered: string[][] = [];
  const priceColumn: DataTableColumn<Row> = { key: "price", label: "Price", cell: () => "1" };
  const actionsColumn: DataTableColumn<Row> = {
    key: "actions",
    label: "Actions",
    cell: (row) => `edit ${row.id}`,
    pinned: "end",
  };
  const el = await table({
    columns: [nameColumn, statusColumn, priceColumn, actionsColumn],
    rowParent: (row: Row) => row.parent,
    rowSpansUnpinnedColumns: (row: Row, columns: readonly DataTableColumn<Row>[]) => {
      offered.push(columns.map((column) => column.key));
      return row.id === "food";
    },
  });
  const cells = (key: string) =>
    [...el.shadowRoot!.querySelectorAll(`tr[data-row-key="${key}"] td`)].map((td) => [
      td.textContent!.replace(/\s+/g, " ").trim(),
      td.getAttribute("colspan"),
    ]);
  expect(offered[0]).toEqual(["name", "status", "price"]);
  expect(cells("food")).toEqual([
    ["▾ Food", "3"],
    ["edit food", null],
  ]);
  expect(cells("eggs")).toEqual([
    ["Eggs", null],
    ["off", null],
    ["1", null],
    ["edit eggs", null],
  ]);
  el.rowSpansUnpinnedColumns = (row: Row) => row.id === "eggs";
  await el.updateComplete;
  expect(cells("food")).toEqual([
    ["▾ Food", null],
    ["active", null],
    ["1", null],
    ["edit food", null],
  ]);
  expect(cells("eggs")).toEqual([
    ["Eggs", "3"],
    ["edit eggs", null],
  ]);
});

test("a tree's Select all is unavailable only when its own check leaves no row to pick", async () => {
  const all = (el: WtDataTable<Row>) =>
    el.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-all"]')!;
  const tree = { selectable: true, rowParent: (row: Row) => row.parent };
  const unfiltered = await table({ ...tree, rowSelectAll: (_row, filtered) => !filtered });
  expect(all(unfiltered).disabled).toBe(false);
  unfiltered.rowSelectAll = () => false;
  await unfiltered.updateComplete;
  expect(all(unfiltered).disabled).toBe(true);
  const unchecked = await table({ ...tree, rowSelectable: () => false });
  expect(all(unchecked).disabled).toBe(false);
});

test("a focused control in a tree cell keeps its focus when the columns are reordered", async () => {
  const editColumn: DataTableColumn<Row> = {
    key: "edit",
    label: "Edit",
    cell: (row) => html`<button data-edit=${row.id}>Edit</button>`,
  };
  const el = await table({
    columns: [nameColumn, statusColumn, editColumn],
    rowParent: (row: Row) => row.parent,
  });
  const button = () => el.shadowRoot!.querySelector<HTMLButtonElement>('[data-edit="eggs"]')!;
  const focused = button();
  focused.focus();
  el.columns = [nameColumn, editColumn, statusColumn];
  await el.updateComplete;
  const cells = el.shadowRoot!.querySelectorAll('tr[data-row-key="eggs"] td');
  expect(cells[1]!.contains(focused)).toBe(true);
  expect(button()).toBe(focused);
  expect(el.shadowRoot!.activeElement).toBe(focused);
});

test("columns a layout hides while a filter holds the widths release the held widths", async () => {
  await wide();
  const extra: DataTableColumn<Row> = { key: "extra", label: "Extra", cell: (row) => row.id };
  const el = await table({ rows: filterRows, columns: [nameColumn, statusColumn, extra] });
  const root = el.shadowRoot!;
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "active");
  await el.updateComplete;
  expect(root.querySelector("table")!.hasAttribute("data-locked-columns")).toBe(true);
  el.layoutHiddenColumns = ["extra"];
  await el.updateComplete;
  expect(root.querySelector("table")!.hasAttribute("data-locked-columns")).toBe(false);
  expect(root.querySelectorAll("colgroup col")).toHaveLength(0);
  el.layoutHiddenColumns = undefined;
  await el.updateComplete;
  expect(root.querySelector("table")!.hasAttribute("data-locked-columns")).toBe(false);
});

test("widths a filter holds are let go and redrawn when the table's own width changes", async () => {
  await wide();
  const el = await table({ rows: filterRows, columns: [nameColumn, statusColumn] });
  el.style.display = "block";
  el.style.width = "900px";
  const frames = async () => {
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
    await el.updateComplete;
  };
  await frames();
  const root = el.shadowRoot!;
  await chooseOption(root.querySelector<WtCombobox>('[data-filter="status"]')!, "active");
  await el.updateComplete;
  const native = root.querySelector("table")!;
  expect(native.hasAttribute("data-locked-columns")).toBe(true);
  el.style.width = "1000px";
  await frames();
  expect(native.hasAttribute("data-locked-columns")).toBe(false);
});

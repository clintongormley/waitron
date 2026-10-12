import { html } from "lit";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseOption, cleanup, host, mount } from "../test-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

type Item = { id: string; parent: string | null; name: string; status: string };

const items: Item[] = [
  { id: "food", parent: null, name: "Food", status: "on" },
  { id: "eggs", parent: "food", name: "Eggs", status: "off" },
  { id: "drinks", parent: null, name: "Drinks", status: "on" },
];

const nameColumn: DataTableColumn<Item> = {
  key: "name",
  label: "Name",
  cell: (item) => item.name,
  sortValue: (item) => item.name,
  searchValue: (item) => item.name,
};

const moreColumn: DataTableColumn<Item> = {
  key: "more",
  label: "More",
  cell: (item) => item.name,
  choosable: "shown",
};

const statusColumn: DataTableColumn<Item> = {
  key: "status",
  label: "Status",
  cell: (item) => item.status,
  choosable: "shown",
  filter: {
    label: "Filter by status",
    allLabel: "Any status",
    value: (item) => item.status,
    options: [
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
  },
};

async function itemTable(props: Partial<WtDataTable<Item>> = {}): Promise<WtDataTable<Item>> {
  const el = (await mount(
    '<wt-data-table aria-label="Items"></wt-data-table>',
  )) as WtDataTable<Item>;
  Object.assign(el, {
    rows: items,
    columns: [nameColumn, statusColumn, moreColumn],
    rowKey: (item: Item) => item.id,
    ...props,
  });
  await el.updateComplete;
  return el;
}

/** A resize is reported after layout and before the next paint, and the table acts on it a frame
 * later, so by the third frame it has. */
async function frames(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
}

const part = (el: WtDataTable<Item>, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;

/** Takes the table out of the page and puts it back where it was, as a framework moving it does. */
async function reattach(el: WtDataTable<Item>, before?: () => void): Promise<void> {
  el.remove();
  before?.();
  host.append(el);
  await frames();
}

test("a fresh table with filters and choosable columns starts with Filters and Customise closed, rows unboxed and nothing announced", async () => {
  const el = await itemTable();
  expect(part(el, ".filters-trigger").getAttribute("aria-expanded")).toBe("false");
  expect(part(el, ".columns-trigger").getAttribute("aria-expanded")).toBe("false");
  expect(el.hasAttribute("sticky-header")).toBe(false);
  await userEvent.click(part(el, ".columns-trigger"));
  await el.updateComplete;
  expect(part(el, ".column-move-status").textContent!.trim()).toBe("");
});

test("the row-controls heading and a column's move handle have default accessible names", async () => {
  const el = await itemTable({ rowControls: (item) => html`<button>Drag ${item.name}</button>` });
  expect(part(el, "thead th.select").getAttribute("aria-label")).toBe("Row controls");
  await userEvent.click(part(el, ".columns-trigger"));
  await el.updateComplete;
  expect(part(el, '[data-reorder="status"]').getAttribute("aria-label")).toBe("Move Status");
});

test("an error closes an open Filters panel, which stays closed once the error clears", async () => {
  const el = await itemTable();
  await userEvent.click(part(el, ".filters-trigger"));
  await el.updateComplete;
  expect(part(el, ".filters-trigger").getAttribute("aria-expanded")).toBe("true");
  el.errorMessage = "Could not load";
  await el.updateComplete;
  el.errorMessage = "";
  await el.updateComplete;
  expect(part(el, ".filters-trigger").getAttribute("aria-expanded")).toBe("false");
});

test("a phone-width tree keeps its narrow layout when its rows are handed over again", async () => {
  const el = await itemTable({ rowParent: (item) => item.parent, columns: [nameColumn] });
  el.style.width = "360px";
  await frames();
  expect(el.hasAttribute("narrow")).toBe(true);
  el.rows = [...items];
  await el.updateComplete;
  await frames();
  expect(el.hasAttribute("narrow")).toBe(true);
});

test("a wide table's open side Filters panel stays open when the table is moved in the page", async () => {
  const el = await itemTable();
  el.style.width = "1280px";
  await frames();
  await userEvent.click(part(el, ".filters-trigger"));
  await el.updateComplete;
  expect(part(el, ".filters-trigger").getAttribute("aria-expanded")).toBe("true");
  await reattach(el);
  await el.updateComplete;
  expect(part(el, ".filters-trigger").getAttribute("aria-expanded")).toBe("true");
});

test("a searchable table moved into a phone-width place stacks its search", async () => {
  const el = await itemTable({ searchable: true, columns: [nameColumn] });
  el.style.width = "1280px";
  await frames();
  expect(el.hasAttribute("stacked-search")).toBe(false);
  await reattach(el, () => {
    el.style.width = "390px";
  });
  await vi.waitFor(() => expect(el.hasAttribute("stacked-search")).toBe(true));
});

test("removing the table mid column drag gives the page its cursor back", async () => {
  const originalCursor = document.body.style.cursor;
  onTestFinished(() => {
    document.body.style.cursor = originalCursor;
  });
  const el = await itemTable();
  await userEvent.click(part(el, ".columns-trigger"));
  await el.updateComplete;
  const source = part(el, '[data-reorder="more"]');
  const target = part(el, '[data-column-row="status"]');
  const startY = source.getBoundingClientRect().top + 1;
  const targetY = target.getBoundingClientRect().top + 1;
  document.body.style.cursor = "crosshair";
  source.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 21, button: 0, clientY: startY }),
  );
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 21, clientY: targetY }));
  expect(document.body.style.cursor).toBe("grabbing");
  el.remove();
  expect(document.body.style.cursor).toBe("crosshair");
});

async function stickyTable(): Promise<{ el: WtDataTable<Item>; scroll: HTMLElement }> {
  const el = await itemTable({ columns: [nameColumn], stickyHeader: true });
  el.style.height = "400px";
  await frames();
  return { el, scroll: part(el, ".scroll") };
}

const headHeight = (el: WtDataTable<Item>) =>
  `${part(el, "thead").getBoundingClientRect().height}px`;

test("a sticky table's scroll padding follows its headings as they grow", async () => {
  const { el, scroll } = await stickyTable();
  const before = headHeight(el);
  expect(scroll.style.scrollPaddingBlockStart).toBe(before);
  el.style.setProperty("--wt-space-3", "40px");
  await frames();
  expect(headHeight(el)).not.toBe(before);
  expect(scroll.style.scrollPaddingBlockStart).toBe(headHeight(el));
});

test("a sticky table moved in the page still follows its headings as they grow", async () => {
  const { el, scroll } = await stickyTable();
  const before = headHeight(el);
  await reattach(el);
  el.style.setProperty("--wt-space-3", "40px");
  await frames();
  expect(headHeight(el)).not.toBe(before);
  expect(scroll.style.scrollPaddingBlockStart).toBe(headHeight(el));
});

class ForwardingSearch extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      '<wt-data-table aria-label="Forwarded"><slot name="search" slot="toolbar-search"></slot></wt-data-table>';
  }
}
customElements.define("forwarding-search-a539", ForwardingSearch);

test("a toolbar-search slot forwarded from a wrapper stacks only when the wrapper is given a search", async () => {
  const wrapper = (await mount(
    "<forwarding-search-a539></forwarding-search-a539>",
  )) as ForwardingSearch;
  const el = wrapper.shadowRoot!.querySelector("wt-data-table") as WtDataTable<Item>;
  Object.assign(el, {
    rows: items,
    columns: [nameColumn, statusColumn],
    rowKey: (item: Item) => item.id,
  });
  el.style.width = "390px";
  await el.updateComplete;
  await frames();
  expect(el.hasAttribute("stacked-search")).toBe(false);
  const search = document.createElement("input");
  search.slot = "search";
  search.setAttribute("aria-label", "Search items");
  wrapper.append(search);
  el.style.width = "391px";
  await vi.waitFor(() => expect(el.hasAttribute("stacked-search")).toBe(true));
});

const longNames: Item[] = [
  { id: "1", parent: null, name: "A name long enough to widen its column", status: "on" },
  { id: "2", parent: null, name: "Bo", status: "off" },
];

/** Chooses Off, leaving only the short name, and returns the Name column's width from before. */
async function holdWidths(el: WtDataTable<Item>): Promise<number> {
  const nameWidth = () => part(el, "thead th").getBoundingClientRect().width;
  const before = nameWidth();
  await chooseOption(
    el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[data-filter="status"]')!,
    "off",
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(nameWidth()).toBeCloseTo(before, 0);
  return before;
}

test("columns held at their widths by a filter fit the rows again once new rows arrive", async () => {
  const el = await itemTable({ rows: longNames, columns: [nameColumn, statusColumn] });
  el.style.width = "900px";
  await frames();
  const held = await holdWidths(el);
  el.rows = [...longNames];
  await el.updateComplete;
  expect(part(el, "thead th").getBoundingClientRect().width).not.toBeCloseTo(held, 0);
});

test("columns held at their widths by a filter fit the rows again once selection is switched on and off", async () => {
  const el = await itemTable({ rows: longNames, columns: [nameColumn, statusColumn] });
  el.style.width = "900px";
  await frames();
  const held = await holdWidths(el);
  el.selectable = true;
  await el.updateComplete;
  el.selectable = false;
  await el.updateComplete;
  expect(part(el, "thead th").getBoundingClientRect().width).not.toBeCloseTo(held, 0);
});

test.each([
  ["a 640 px", "640px", true],
  ["a wide", "1280px", false],
])(
  "switching search on in %s table draws the toolbar in its final layout from the first frame",
  async (_, width, stacked) => {
    const el = await itemTable();
    el.style.width = width;
    await frames();
    expect(el.hasAttribute("stacked-search")).toBe(false);
    el.searchable = true;
    await el.updateComplete;
    expect(el.hasAttribute("stacked-search")).toBe(stacked);
    await frames();
    expect(el.hasAttribute("stacked-search")).toBe(stacked);
  },
);

test("the toolbar's buttons and the Customise dialog's grips and eyes each draw a picture", async () => {
  const el = await itemTable();
  await userEvent.click(part(el, ".columns-trigger"));
  await el.updateComplete;
  const hidden = el.shadowRoot!.querySelector<HTMLInputElement>(
    '[data-column-row="more"] input[type=checkbox]',
  )!;
  hidden.click();
  await el.updateComplete;
  const icons = [...el.shadowRoot!.querySelectorAll("wt-icon")];
  expect(new Set(icons.map((icon) => icon.getAttribute("name")))).toEqual(
    new Set(["table-filter", "table-customise", "column-grip", "eye-open", "eye-closed"]),
  );
  for (const icon of icons) {
    await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(icon.shadowRoot!.querySelector("svg path"), icon.getAttribute("name")!).not.toBeNull();
  }
});

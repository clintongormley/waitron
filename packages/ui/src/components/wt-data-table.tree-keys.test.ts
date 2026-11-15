import { html } from "lit";
import { userEvent } from "vitest/browser";
import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";
import "./wt-input.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

type Row = { id: string; parent: string | null; name: string };

// Sorted by name the tree reads: Desserts > Coffee cake; Menu > Coffee > Latte > Oat milk; Menu > Tea.
const rows: Row[] = [
  { id: "menu", parent: null, name: "Menu" },
  { id: "coffee", parent: "menu", name: "Coffee" },
  { id: "latte", parent: "coffee", name: "Latte" },
  { id: "oat", parent: "latte", name: "Oat milk" },
  { id: "tea", parent: "menu", name: "Tea" },
  { id: "desserts", parent: null, name: "Desserts" },
  { id: "cake", parent: "desserts", name: "Coffee cake" },
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
];

async function tree(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount('<wt-data-table aria-label="Menu"></wt-data-table>')) as WtDataTable<Row>;
  Object.assign(el, {
    rows,
    columns,
    sortKey: "name",
    rowKey: (r: Row) => r.id,
    rowParent: (r: Row) => r.parent,
    expandLabel: "Open",
    collapseLabel: "Close",
    ...props,
  });
  await el.updateComplete;
  return el;
}

const shownRow = (el: WtDataTable<Row>, key: string): HTMLElement =>
  el.shadowRoot!.querySelector<HTMLElement>(`tbody tr[data-row-key="${key}"]`)!;

const focusedRow = (el: WtDataTable<Row>): string | undefined =>
  (el.shadowRoot!.activeElement as HTMLElement | null)?.closest("tr")?.dataset.rowKey;

const toggle = (el: WtDataTable<Row>, key: string): HTMLButtonElement =>
  shownRow(el, key).querySelector<HTMLButtonElement>(".tree-toggle")!;

test("the branch toggle says whether its branch is open", async () => {
  const el = await tree();
  expect(toggle(el, "coffee").getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(toggle(el, "coffee"));
  await el.updateComplete;
  expect(toggle(el, "coffee").getAttribute("aria-expanded")).toBe("false");
  expect(shownRow(el, "coffee").getAttribute("aria-expanded")).toBe("false");
});

test("Down and Up move between the rows shown, skipping a closed branch's rows", async () => {
  const el = await tree();
  el.setExpanded("coffee", false);
  await el.updateComplete;
  toggle(el, "coffee").focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(focusedRow(el)).toBe("tea");
  // A row with no control of its own takes the focus itself, outside the tab order.
  expect(el.shadowRoot!.activeElement).toBe(shownRow(el, "tea"));
  expect(shownRow(el, "tea").getAttribute("tabindex")).toBe("-1");
  await userEvent.keyboard("{ArrowDown}");
  expect(focusedRow(el)).toBe("tea");
  await userEvent.keyboard("{ArrowUp}");
  expect(el.shadowRoot!.activeElement).toBe(toggle(el, "coffee"));
  await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
  expect(focusedRow(el)).toBe("desserts");
  await userEvent.keyboard("{ArrowUp}");
  expect(focusedRow(el)).toBe("desserts");
});

test("Right opens a closed branch then steps into it; Left closes an open one then steps out", async () => {
  const el = await tree({ initiallyCollapsed: true });
  toggle(el, "menu").focus();
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect(el.isExpanded("menu")).toBe(true);
  expect(toggle(el, "menu").getAttribute("aria-expanded")).toBe("true");
  expect(focusedRow(el)).toBe("menu");
  await userEvent.keyboard("{ArrowRight}");
  expect(focusedRow(el)).toBe("coffee");
  await userEvent.keyboard("{ArrowDown}{ArrowRight}");
  expect(focusedRow(el)).toBe("tea");
  await userEvent.keyboard("{ArrowLeft}");
  expect(focusedRow(el)).toBe("menu");
  await userEvent.keyboard("{ArrowLeft}");
  await el.updateComplete;
  expect(el.isExpanded("menu")).toBe(false);
  expect(focusedRow(el)).toBe("menu");
  await userEvent.keyboard("{ArrowLeft}");
  expect(focusedRow(el)).toBe("menu");
});

test("a row that opens itself is reached on its row button, and Enter still opens it", async () => {
  const el = await tree({ initiallyCollapsed: true, rowActivation: () => "toggle" });
  shownRow(el, "desserts").querySelector<HTMLButtonElement>(".row-activate")!.focus();
  await userEvent.keyboard("{ArrowDown}");
  const activate = shownRow(el, "menu").querySelector<HTMLButtonElement>(".row-activate")!;
  expect(el.shadowRoot!.activeElement).toBe(activate);
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(el.isExpanded("menu")).toBe(true);
  expect(activate.getAttribute("aria-expanded")).toBe("true");
});

test("arrow keys typed in a field inside a cell, or with a modifier held, are left alone", async () => {
  const el = await tree({
    columns: [
      columns[0]!,
      {
        key: "note",
        label: "Note",
        cell: (r) => html`<wt-input label=${`Note ${r.id}`}></wt-input>`,
      },
      {
        key: "own",
        label: "Own keys",
        cell: () =>
          html`<button
              data-test="prevents"
              @keydown=${(event: KeyboardEvent) => event.preventDefault()}
            >
              Own</button
            ><button data-test="declares" aria-keyshortcuts="ArrowDown ArrowLeft">Grip</button>`,
      },
    ],
  });
  for (const own of ["prevents", "declares"]) {
    shownRow(el, "coffee").querySelector<HTMLButtonElement>(`[data-test="${own}"]`)!.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowLeft}");
    expect(focusedRow(el)).toBe("coffee");
    expect(el.isExpanded("coffee")).toBe(true);
  }

  const field = shownRow(el, "coffee").querySelector("wt-input")!;
  await userEvent.click(field);
  const inner = field.shadowRoot!.activeElement;
  expect(inner).not.toBeNull();
  await userEvent.keyboard("{ArrowDown}{ArrowUp}{ArrowLeft}");
  expect(el.isExpanded("coffee")).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(field);
  expect(field.shadowRoot!.activeElement).toBe(inner);

  toggle(el, "coffee").focus();
  for (const modifier of ["Shift", "Alt", "Control", "Meta"])
    await userEvent.keyboard(`{${modifier}>}{ArrowDown}{ArrowLeft}{/${modifier}}`);
  expect(el.shadowRoot!.activeElement).toBe(toggle(el, "coffee"));
  expect(el.isExpanded("coffee")).toBe(true);
});

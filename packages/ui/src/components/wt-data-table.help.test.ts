import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

type Row = { id: string; name: string; status: string };

const rows: Row[] = [
  { id: "1", name: "Ada", status: "active" },
  { id: "2", name: "Grace", status: "off" },
];

const help = { text: "Whether it can be sold now.", label: "Help: Availability" };

const nameColumn: DataTableColumn<Row> = { key: "name", label: "Name", cell: (row) => row.name };

function availability(extra: Partial<DataTableColumn<Row>> = {}): DataTableColumn<Row> {
  return { key: "status", label: "Availability", cell: (row) => row.status, help, ...extra };
}

async function table(columns: DataTableColumn<Row>[], attributes = ""): Promise<WtDataTable<Row>> {
  const el = (await mount(
    `<wt-data-table aria-label="Products" ${attributes}></wt-data-table>`,
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  return el;
}

function badgeOf(el: WtDataTable<Row>): WtHelpTooltip {
  return el.shadowRoot!.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
}

function badgeButton(el: WtDataTable<Row>): HTMLButtonElement {
  return badgeOf(el).shadowRoot!.querySelector("button")!;
}

function headerOf(el: WtDataTable<Row>, label: string): HTMLElement {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>('thead th[role="columnheader"]')].find(
    (th) => th.textContent!.includes(label),
  )!;
}

async function turnHelp(on: boolean, el: WtDataTable<Row>): Promise<void> {
  setHelpMode(on);
  await badgeOf(el)?.updateComplete;
  await el.updateComplete;
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function headerBoxes(el: WtDataTable<Row>) {
  return [...el.shadowRoot!.querySelectorAll("th")].map((th) => {
    const { left, top, width, height } = th.getBoundingClientRect();
    return { left, top, width, height };
  });
}

test("a column with help hangs a badge over its label's top trailing corner while help is on", async () => {
  const el = await table([nameColumn, availability()]);
  await turnHelp(true, el);
  const label = el.shadowRoot!.querySelector(".head-label")!.getBoundingClientRect();
  const centre = centreOf(badgeButton(el));
  expect(Math.abs(centre.x - label.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - label.top)).toBeLessThanOrEqual(1);
});

test("it adds no scroll and moves nothing", async () => {
  const plain = await table([nameColumn, availability({ help: undefined })]);
  const before = headerBoxes(plain);
  cleanup();

  const el = await table([nameColumn, availability()]);
  const scroll = el.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  for (const on of [false, true]) {
    await turnHelp(on, el);
    expect(scroll.scrollWidth).toBe(scroll.clientWidth);
    expect(scroll.scrollHeight).toBe(scroll.clientHeight);
    expect(headerBoxes(el)).toEqual(before);
  }

  // Control: the same badge hung over the heading cell's own corner pushes past the box.
  const th = headerOf(el, "Availability");
  th.style.position = "relative";
  th.append(badgeOf(el));
  await badgeOf(el).updateComplete;
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
});

test("a sortable column's badge is beside the sort button, not inside it", async () => {
  const el = await table([nameColumn, availability({ sortValue: (row) => row.status })]);
  await turnHelp(true, el);
  const badge = badgeOf(el);
  expect(badge.closest("button.sort")).toBeNull();
  expect(el.shadowRoot!.querySelector("button.sort")).not.toBeNull();
  const th = headerOf(el, "Availability");
  const sortBefore = th.getAttribute("aria-sort");
  await userEvent.click(page.elementLocator(badgeButton(el)));
  const popup = badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await el.updateComplete;
  expect(th.getAttribute("aria-sort")).toBe(sortBefore);
});

test("with sticky-header the badge is not cut off", async () => {
  const el = await table([nameColumn, availability()], "sticky-header");
  await turnHelp(true, el);
  const scroll = el.shadowRoot!.querySelector(".scroll")!.getBoundingClientRect();
  expect(badgeButton(el).getBoundingClientRect().top).toBeGreaterThanOrEqual(scroll.top);
});

test("the badge takes its name from help.label", async () => {
  const el = await table([
    nameColumn,
    availability({ help: { text: "Si se puede vender.", label: "Ayuda: Disponibilidad" } }),
  ]);
  await turnHelp(true, el);
  await expect
    .element(page.elementLocator(badgeButton(el)))
    .toHaveAccessibleName("Ayuda: Disponibilidad");
});

test("a heading with help is still named by its label alone", async () => {
  const el = await table([nameColumn, availability()]);
  await turnHelp(true, el);
  const th = headerOf(el, "Availability");
  expect(th.getAttribute("aria-label")).toBe("Availability");

  // Control: without the label the heading's content holds the badge's text too.
  th.removeAttribute("aria-label");
  expect(th.textContent).toContain(help.text);
  cleanup();

  const filtered = await table([
    nameColumn,
    availability({
      filter: {
        label: "Filter by availability",
        allLabel: "Any",
        value: (row) => row.status,
        options: [{ value: "active", label: "Active" }],
        initial: "active",
      },
    }),
  ]);
  expect(headerOf(filtered, "Availability").getAttribute("aria-label")).toBe(
    `Availability: ${filtered.filteredColumnLabel}`,
  );
});

test("a column without help renders its heading as before", async () => {
  const el = await table([nameColumn, availability({ help: undefined })]);
  expect(el.shadowRoot!.querySelector(".head-label")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-help-tooltip")).toBeNull();
  expect(headerOf(el, "Availability").hasAttribute("aria-label")).toBe(false);
});

test("while help is off the badge cannot be reached", async () => {
  const el = await table([nameColumn, availability()]);
  const badge = badgeOf(el);
  expect(badge.checkVisibility()).toBe(false);
  badgeButton(el).focus();
  expect(badge.shadowRoot!.activeElement).toBeNull();
});

test("in a right-to-left page it hangs over the label's top left corner", async () => {
  const el = await table([nameColumn, availability()]);
  el.setAttribute("dir", "rtl");
  await turnHelp(true, el);
  const label = el.shadowRoot!.querySelector(".head-label")!.getBoundingClientRect();
  const centre = centreOf(badgeButton(el));
  expect(Math.abs(centre.x - label.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - label.top)).toBeLessThanOrEqual(1);
});

test("an open column help box sets its own plain weight rather than the heading's bold", async () => {
  const el = await table([nameColumn, availability()]);
  host.style.setProperty("--wt-font-weight-normal", "300");
  host.style.setProperty("--wt-font-weight-bold", "800");
  await turnHelp(true, el);
  const badge = badgeOf(el);
  await userEvent.click(page.elementLocator(badgeButton(el)));
  const popup = badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  expect(getComputedStyle(headerOf(el, "Availability")).fontWeight).toBe("800");
  expect(getComputedStyle(popup).fontWeight).toBe("300");
});

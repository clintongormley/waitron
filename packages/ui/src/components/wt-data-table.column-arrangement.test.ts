import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount, mountInShadowRoot } from "../test-helpers.js";
import type { DataTableColumn, WtDataTable } from "./wt-data-table.js";
import "./wt-data-table.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "b", name: "Bea" },
  { id: "a", name: "Ada" },
];

const nameColumn: DataTableColumn<Row> = {
  key: "name",
  label: "Name",
  cell: (row) => row.name,
  sortValue: (row) => row.name,
};

function movable(key: string): DataTableColumn<Row> {
  return { key, label: key.toUpperCase(), cell: () => key, choosable: "shown" };
}

const actions: DataTableColumn<Row> = {
  key: "actions",
  label: "Actions",
  cell: () => "Edit",
  pinned: "end",
};

const dragColumns: DataTableColumn<Row>[] = [
  nameColumn,
  ...["m1", "m2", "m3", "m4"].map(movable),
  actions,
];

async function table(props: Partial<WtDataTable<Row>> = {}): Promise<WtDataTable<Row>> {
  const el = (await mount(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns: dragColumns, rowKey: (row: Row) => row.id, ...props });
  await el.updateComplete;
  return el;
}

function headers(el: WtDataTable<Row>): string[] {
  return [...el.shadowRoot!.querySelectorAll("thead th")].map((cell) => cell.textContent!.trim());
}

function trigger(el: WtDataTable<Row>): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(".columns-trigger")!;
}

function panel(el: WtDataTable<Row>): HTMLElement & { open: boolean } {
  return el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(".columns-panel")!;
}

function handle(el: WtDataTable<Row>, key: string): HTMLButtonElement {
  return panel(el).querySelector<HTMLButtonElement>(`[data-reorder="${key}"]`)!;
}

function columnRow(el: WtDataTable<Row>, key: string): HTMLElement {
  return panel(el).querySelector<HTMLElement>(`[data-column-row="${key}"]`)!;
}

function announcement(el: WtDataTable<Row>): string {
  return panel(el).querySelector('[role="status"]')!.textContent!.trim();
}

function rests(el: WtDataTable<Row>): Record<string, DOMRect> {
  return Object.fromEntries(
    [...panel(el).querySelectorAll<HTMLElement>("[data-column-row]")].map((row) => [
      row.dataset.columnRow!,
      row.getBoundingClientRect(),
    ]),
  );
}

function centre(box: DOMRect): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** Presses `key`'s handle at its centre with the main button, without focusing it. */
function grab(el: WtDataTable<Row>, key: string, pointerId: number, button = 0) {
  const point = centre(handle(el, key).getBoundingClientRect());
  handle(el, key).dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId,
      button,
      bubbles: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
    }),
  );
  return point;
}

function send(type: string, pointerId: number, x: number, y: number): void {
  document.dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y }));
}

function shownChanges(el: HTMLElement | Document): string[][] {
  const seen: string[][] = [];
  const listen = (event: Event) =>
    seen.push((event as CustomEvent<{ shown: string[] }>).detail.shown);
  el.addEventListener("wt-columns-change", listen);
  onTestFinished(() => el.removeEventListener("wt-columns-change", listen));
  return seen;
}

async function openChooser(el: WtDataTable<Row>): Promise<void> {
  await userEvent.click(trigger(el));
  await el.updateComplete;
}

function keepCursor(): void {
  const original = document.body.style.cursor;
  onTestFinished(() => {
    document.body.style.cursor = original;
  });
}

test("a stored column order that cannot be read under a new view key leaves the declared order", async () => {
  localStorage.setItem("arrange.first:column-order", JSON.stringify(["m3", "m1", "m2", "m4"]));
  localStorage.setItem("arrange.broken:column-order", "{not json");
  const el = await table({ viewKey: "arrange.first" });
  expect(headers(el)).toEqual(["Name", "M3", "M1", "M2", "M4", "Actions"]);
  el.viewKey = "arrange.broken";
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M1", "M2", "M3", "M4", "Actions"]);
});

test("columns missing from a stored order keep their declared places ahead of the stored ones", async () => {
  localStorage.setItem("arrange.new-first:column-order", JSON.stringify(["m3", "m4"]));
  const el = await table({ viewKey: "arrange.new-first" });
  expect(headers(el)).toEqual(["Name", "M1", "M2", "M3", "M4", "Actions"]);
});

test("a pinned column is drawn even when it asks to start hidden", async () => {
  const el = await table({
    columns: [nameColumn, movable("m1"), { ...actions, choosable: "hidden" }],
  });
  expect(headers(el)).toEqual(["Name", "M1", "Actions"]);
});

test("moving a column announces its new position out of the total", async () => {
  const el = await table();
  await openChooser(el);
  handle(el, "m3").focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(announcement(el)).toBe("M3, 3 of 6");
});

test("ArrowUp on the first movable column and ArrowDown on the last change nothing", async () => {
  const el = await table({ viewKey: "arrange.edges" });
  const seen = shownChanges(el);
  await openChooser(el);
  handle(el, "m1").focus();
  await userEvent.keyboard("{ArrowUp}");
  handle(el, "m4").focus();
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M1", "M2", "M3", "M4", "Actions"]);
  expect(seen).toEqual([]);
  expect(announcement(el)).toBe("");
  expect(localStorage.getItem("arrange.edges:column-order")).toBeNull();
});

test("a table with no view key remembers no column order", async () => {
  const el = await table();
  await openChooser(el);
  handle(el, "m2").focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M1", "M3", "M4", "Actions"]);
  expect(localStorage.length).toBe(0);
});

test("a moved column is reported, in the new order, across shadow boundaries", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns: dragColumns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  const seen = shownChanges(document);
  await openChooser(el);
  handle(el, "m2").focus();
  await userEvent.keyboard("{ArrowUp}");
  expect(seen).toEqual([["name", "m2", "m1", "m3", "m4", "actions"]]);
});

test("Restore defaults clears the move announcement and reports the declared columns across shadow boundaries", async () => {
  const el = (await mountInShadowRoot(
    '<wt-data-table aria-label="Users"></wt-data-table>',
  )) as WtDataTable<Row>;
  Object.assign(el, { rows, columns: dragColumns, rowKey: (row: Row) => row.id });
  await el.updateComplete;
  await openChooser(el);
  handle(el, "m2").focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(announcement(el)).not.toBe("");
  const seen = shownChanges(document);
  panel(el).querySelector<HTMLElement>("[data-restore-columns]")!.click();
  await el.updateComplete;
  expect(seen).toEqual([["name", "m1", "m2", "m3", "m4", "actions"]]);
  expect(announcement(el)).toBe("");
});

test("a letter key in the Customise dialog leaves it open", async () => {
  const el = await table();
  await openChooser(el);
  panel(el).querySelector<HTMLInputElement>('input[data-column="m1"]')!.focus();
  await userEvent.keyboard("a");
  await el.updateComplete;
  expect(panel(el).open).toBe(true);
});

test("a columns update that reorders the movable columns cancels a running drag", async () => {
  keepCursor();
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  const start = grab(el, "m1", 21);
  const y = centre(rest.m3!).y;
  send("pointermove", 21, start.x, y);
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(true);
  el.columns = [nameColumn, movable("m1"), movable("m3"), movable("m2"), movable("m4"), actions];
  await el.updateComplete;
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(false);
  send("pointermove", 21, start.x, y + 2);
  send("pointerup", 21, start.x, y + 2);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M1", "M3", "M2", "M4", "Actions"]);
});

test("dragging a column without focusing its handle leaves keyboard focus where it was", async () => {
  const el = await table();
  await openChooser(el);
  const box = panel(el).querySelector<HTMLInputElement>('input[data-column="m4"]')!;
  box.focus();
  const rest = rests(el);
  const start = grab(el, "m1", 22);
  const y = centre(rest.m3!).y;
  send("pointermove", 22, start.x, y);
  send("pointerup", 22, start.x, y);
  await el.updateComplete;
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M1", "M4", "Actions"]);
  expect(el.shadowRoot!.activeElement).toBe(box);
});

test("a drag with the secondary button moves no column", async () => {
  keepCursor();
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  const start = grab(el, "m1", 23, 2);
  const y = centre(rest.m3!).y;
  send("pointermove", 23, start.x, y);
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(false);
  send("pointerup", 23, start.x, y);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M1", "M2", "M3", "M4", "Actions"]);
});

test("a second pointer pressed on another handle mid-drag does not take the drag over", async () => {
  keepCursor();
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  const start = grab(el, "m1", 24);
  const y = centre(rest.m3!).y;
  send("pointermove", 24, start.x, y);
  grab(el, "m4", 25);
  send("pointermove", 24, start.x, y + 1);
  send("pointerup", 24, start.x, y + 1);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M1", "M4", "Actions"]);
  send("pointerup", 25, start.x, y + 1);
});

test("another pointer's movement, release and cancel neither lift, drop nor end the drag", async () => {
  keepCursor();
  document.body.style.cursor = "crosshair";
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  const start = grab(el, "m1", 26);
  const y = centre(rest.m3!).y;
  send("pointermove", 27, start.x, y);
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(false);
  expect(document.body.style.cursor).toBe("crosshair");
  send("pointermove", 26, start.x, y);
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(true);
  send("pointerup", 27, start.x, y);
  document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 27 }));
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M1", "M2", "M3", "M4", "Actions"]);
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(true);
  send("pointerup", 26, start.x, y);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M1", "M4", "Actions"]);
});

test("a pointer moved exactly 5 px from where it pressed lifts the row", async () => {
  keepCursor();
  const el = await table();
  await openChooser(el);
  const start = grab(el, "m2", 28);
  send("pointermove", 28, start.x, start.y + 5);
  expect(columnRow(el, "m2").hasAttribute("data-dragging")).toBe(true);
  document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 28 }));
});

test("pressing and releasing a handle without moving changes nothing, keeps the page cursor and leaves the pointer free", async () => {
  keepCursor();
  document.body.style.cursor = "crosshair";
  const el = await table();
  const seen = shownChanges(el);
  await openChooser(el);
  const rest = rests(el);
  const start = grab(el, "m1", 29);
  send("pointerup", 29, start.x, start.y);
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(announcement(el)).toBe("");
  expect(document.body.style.cursor).toBe("crosshair");
  send("pointermove", 29, start.x, centre(rest.m3!).y);
  expect(columnRow(el, "m1").hasAttribute("data-dragging")).toBe(false);
  expect(document.body.style.cursor).toBe("crosshair");
});

test("rows a column is dragged up past slide down, and land when it drops", async () => {
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  const height = rest.m3!.height;
  const start = grab(el, "m3", 30);
  const y = centre(rest.m1!).y;
  send("pointermove", 30, start.x, y);
  await vi.waitFor(() => {
    expect(columnRow(el, "m1").getBoundingClientRect().top).toBeCloseTo(rest.m1!.top + height, 0);
    expect(columnRow(el, "m2").getBoundingClientRect().top).toBeCloseTo(rest.m2!.top + height, 0);
  });
  expect(columnRow(el, "m4").getBoundingClientRect().top).toBeCloseTo(rest.m4!.top, 0);
  send("pointerup", 30, start.x, y);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M3", "M1", "M2", "M4", "Actions"]);
});

test("a row passed and then left behind by the drag returns to where it rests", async () => {
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  const height = rest.m1!.height;
  const start = grab(el, "m1", 31);
  send("pointermove", 31, start.x, centre(rest.m3!).y);
  await vi.waitFor(() =>
    expect(columnRow(el, "m3").getBoundingClientRect().top).toBeCloseTo(rest.m3!.top - height, 0),
  );
  send("pointermove", 31, start.x, centre(rest.m2!).y);
  await vi.waitFor(() =>
    expect(columnRow(el, "m3").getBoundingClientRect().top).toBeCloseTo(rest.m3!.top, 0),
  );
  expect(columnRow(el, "m2").getBoundingClientRect().top).toBeCloseTo(rest.m2!.top - height, 0);
  document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 31 }));
});

test("a drop on a row's left or top edge lands on that row, and one on its right edge lands nowhere", async () => {
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  let start = grab(el, "m1", 32);
  send("pointermove", 32, start.x, centre(rest.m3!).y);
  send("pointerup", 32, rest.m3!.left, rest.m3!.top);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M1", "M4", "Actions"]);

  start = grab(el, "m1", 33);
  send("pointermove", 33, start.x, centre(rest.m1!).y);
  send("pointerup", 33, rest.m1!.right, centre(rest.m1!).y);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M1", "M4", "Actions"]);

  start = grab(el, "m1", 34);
  send("pointermove", 34, start.x, centre(rest.m1!).y);
  send("pointerup", 34, rest.m1!.right + 40, centre(rest.m1!).y);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M1", "M4", "Actions"]);
});

test("a drop on the line between two rows lands on the lower one", async () => {
  const el = await table();
  await openChooser(el);
  const rest = rests(el);
  expect(rest.m3!.bottom).toBeCloseTo(rest.m4!.top, 5);
  const start = grab(el, "m1", 35);
  send("pointermove", 35, start.x, centre(rest.m3!).y);
  send("pointerup", 35, start.x, rest.m4!.top);
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "M2", "M3", "M4", "M1", "Actions"]);
});

const longHeading = "VeryLongColumnHeadingThatCannotWrap";

const filteredColumns: DataTableColumn<Row>[] = [
  nameColumn,
  {
    key: "kind",
    label: "Kind",
    cell: (row) => row.id,
    choosable: "shown",
    filter: {
      label: "Filter by kind",
      allLabel: "Any kind",
      value: (row) => row.id,
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    },
  },
  { key: "note", label: longHeading, cell: () => "note", choosable: "shown" },
];

function longHeadingFits(el: WtDataTable<Row>): boolean {
  const heading = [...el.shadowRoot!.querySelectorAll<HTMLElement>("thead th")].find((cell) =>
    cell.textContent!.includes(longHeading),
  )!;
  return heading.scrollWidth <= heading.clientWidth;
}

test("Restore defaults after a filter choice sizes each column from its own heading", async () => {
  localStorage.setItem("arrange.filtered:column-order", JSON.stringify(["note", "kind"]));
  const el = await table({ columns: filteredColumns, viewKey: "arrange.filtered" });
  expect(headers(el)).toEqual(["Name", longHeading, "Kind"]);
  el.chooseFilter("kind", ["a"]);
  await el.updateComplete;
  panel(el).querySelector<HTMLElement>("[data-restore-columns]")!.click();
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Kind", longHeading]);
  expect(longHeadingFits(el)).toBe(true);
});

test("a new view key's stored order after a filter choice sizes each column from its own heading", async () => {
  localStorage.setItem("arrange.note-first:column-order", JSON.stringify(["note", "kind"]));
  localStorage.setItem("arrange.kind-first:column-order", JSON.stringify(["kind", "note"]));
  const el = await table({ columns: filteredColumns, viewKey: "arrange.note-first" });
  el.chooseFilter("kind", ["a"]);
  await el.updateComplete;
  el.viewKey = "arrange.kind-first";
  await el.updateComplete;
  expect(headers(el)).toEqual(["Name", "Kind", longHeading]);
  expect(longHeadingFits(el)).toBe(true);
});

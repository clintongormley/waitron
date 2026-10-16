import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-tables-panel.js";
import type { FloorPlanTablesPanel } from "./floor-plan-tables-panel.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { DraftTable, FloorPlanDraft } from "./floor-plan-draft.js";

let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  cleanupWidgets();
});

const table = (
  key: string,
  label: string,
  placed = false,
  seats: number | null = null,
): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats,
  fixed: false,
  placement: placed ? { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } : null,
  parts: null,
  keptSize: null,
});

const draft: FloorPlanDraft = {
  tables: [
    table("m1", "Terrace 1", true),
    table("m2", "Terrace 10"),
    table("m3", "Terrace 2"),
    table("m4", "Terrace bar 3"),
  ],
};

async function mount(props: Partial<FloorPlanTablesPanel> = {}) {
  const mounted = await mountWidget<FloorPlanTablesPanel>("floor-plan-tables-panel", {
    draft,
    ...props,
  });
  await mounted.el.updateComplete;
  return mounted;
}

async function open(props: Partial<FloorPlanTablesPanel> = {}): Promise<FloorPlanTablesPanel> {
  return (await mount(props)).el;
}

const rows = (el: FloorPlanTablesPanel) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-table]"),
];
const nameOf = (r: HTMLElement) => r.querySelector("[data-name]")!.textContent!.trim();
const row = (el: FloorPlanTablesPanel, label: string) => rows(el).find((r) => nameOf(r) === label)!;
const toggle = (r: HTMLElement) =>
  r.querySelector<HTMLButtonElement>("button[data-action=toggle]")!;

function listen(el: FloorPlanTablesPanel) {
  const changes: FloorPlanDraft[] = [];
  const selects: (string | null)[] = [];
  el.addEventListener("floor-plan-change", (e) =>
    changes.push((e as CustomEvent<{ draft: FloorPlanDraft }>).detail.draft),
  );
  el.addEventListener("floor-plan-select", (e) =>
    selects.push((e as CustomEvent<{ key: string | null }>).detail.key),
  );
  return { changes, selects };
}

it("lists the tables in numeric order, placed ones marked", async () => {
  const el = await open();
  expect(el.shadowRoot!.querySelector("h2")!.textContent!.trim()).toBe("Tables");
  expect(rows(el).map(nameOf)).toEqual(["Terrace 1", "Terrace 2", "Terrace 10", "Terrace bar 3"]);
  expect(
    rows(el)
      .filter((r) => r.querySelector("[data-marker=placed]") !== null)
      .map(nameOf),
  ).toEqual(["Terrace 1"]);
});

it("sorts a name with leading spaces by its trimmed name", async () => {
  const el = await open({
    draft: { tables: [...draft.tables, table("m5", "  Terrace 3")] },
  });
  expect(rows(el).map(nameOf)).toEqual([
    "Terrace 1",
    "Terrace 2",
    "Terrace 3",
    "Terrace 10",
    "Terrace bar 3",
  ]);
});

it("shows each row's marker, name, seats and a bin, under Name and Seats heads", async () => {
  const el = await open({
    draft: { tables: [table("m1", "Terrace 1", true, 4), table("m3", "Terrace 2")] },
  });
  const [placed, spare] = rows(el);
  expect(placed!.querySelector("[data-marker]")!.getAttribute("data-marker")).toBe("placed");
  expect(spare!.querySelector("[data-marker]")!.getAttribute("data-marker")).toBe("spare");
  expect(placed!.querySelector("[data-seats]")!.textContent!.trim()).toBe("4");
  expect(spare!.querySelector("[data-seats]")!.textContent!.trim()).toBe("—");
  expect(
    spare!
      .querySelector("button[data-action=delete], wt-button[data-action=delete]")!
      .getAttribute("aria-label"),
  ).toBe("Delete Terrace 2");
  const heads = [...el.shadowRoot!.querySelectorAll("[data-head]")].map((h) =>
    h.textContent!.trim(),
  );
  expect(heads).toEqual(["Name", "Seats", "Made of"]);
  expect(el.shadowRoot!.querySelector("[data-legend]")).toBeNull();
});

it("starts the Name and Seats heads where each row's name and seats start", async () => {
  const el = await open({ draft: { tables: [table("m1", "Terrace 1", true, 4)] } });
  const [nameHead, seatsHead] = [...el.shadowRoot!.querySelectorAll("[data-head]")].map(
    (head) => head.getBoundingClientRect().left,
  );
  const [first] = rows(el);
  expect(first!.querySelector("[data-name]")!.getBoundingClientRect().left).toBeCloseTo(
    nameHead!,
    0,
  );
  expect(first!.querySelector("[data-seats]")!.getBoundingClientRect().left).toBeCloseTo(
    seatsHead!,
    0,
  );
});

it("every row, placed or spare, has a bin", async () => {
  const el = await open();
  expect(rows(el).map((r) => r.querySelector("[data-action=delete]") !== null)).toEqual([
    true,
    true,
    true,
    true,
  ]);
});

it("omits the legend in Spanish", async () => {
  setLocale("es-ES");
  const el = await open();
  expect(el.shadowRoot!.querySelector("[data-legend]")).toBeNull();
});

it("draws a placed marker as a filled square and a spare one as an outlined square", async () => {
  const { el, host } = await mount();
  host.style.setProperty("--wt-color-primary", "rgb(21, 22, 23)");
  host.style.setProperty("--wt-color-text-muted", "rgb(41, 42, 43)");
  const placed = getComputedStyle(row(el, "Terrace 1").querySelector("[data-marker]")!);
  const spare = getComputedStyle(row(el, "Terrace 2").querySelector("[data-marker]")!);
  expect(placed.backgroundColor).toBe("rgb(21, 22, 23)");
  expect(placed.borderRadius).toBe("0px");
  expect(spare.borderRadius).toBe("0px");
  expect(spare.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(spare.borderTopColor).toBe("rgb(41, 42, 43)");
  expect(spare.borderTopWidth).toBe("2px");
});

it("pressing an unplaced table places it at the first free spot and selects it", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  toggle(row(el, "Terrace 2")).click();
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tables.find((t) => t.key === "m3")!.placement).toEqual({
    x: 9,
    y: 0,
    width: 8,
    height: 8,
    shape: "rect",
    rotation: 0,
  });
  expect(selects).toEqual(["m3"]);
});

it("pressing an unplaced table with a remembered place puts it back there and selects it", async () => {
  const at = { x: 30, y: 4, width: 5, height: 7, shape: "round" as const, rotation: 45 };
  const el = await open({ places: new Map([["m3", at]]) });
  const { changes, selects } = listen(el);
  toggle(row(el, "Terrace 2")).click();
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tables.find((t) => t.key === "m3")!.placement).toEqual(at);
  expect(selects).toEqual(["m3"]);
});

it("clicking a table off the plan puts it back at the size it kept", async () => {
  const kept: DraftTable = { ...table("m3", "Terrace 2"), keptSize: { width: 2, height: 3 } };
  const el = await open({ draft: { tables: [table("m1", "Terrace 1", true), kept] } });
  const { changes } = listen(el);
  toggle(row(el, "Terrace 2")).click();
  expect(changes[0]!.tables.find((t) => t.key === "m3")!.placement).toEqual({
    x: 9,
    y: 0,
    width: 2,
    height: 3,
    shape: "rect",
    rotation: 0,
  });
});

it("pressing a placed table takes it off", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  toggle(row(el, "Terrace 1")).click();
  expect(changes).toHaveLength(1);
  expect(changes[0]!.tables.find((t) => t.key === "m1")!.placement).toBeNull();
  expect(selects).toEqual([]);
});

it("taking off the selected table clears the selection", async () => {
  const el = await open({ selected: "m1" });
  const { changes, selects } = listen(el);
  toggle(row(el, "Terrace 1")).click();
  expect(changes).toHaveLength(1);
  expect(selects).toEqual([null]);
});

it("presses on the plan as a toggle", async () => {
  const el = await open();
  expect(toggle(row(el, "Terrace 1")).getAttribute("aria-pressed")).toBe("true");
  expect(toggle(row(el, "Terrace 2")).getAttribute("aria-pressed")).toBe("false");
});

it("marks the selected table's row as current", async () => {
  const el = await open({ selected: "m1" });
  expect(rows(el).map((r) => r.getAttribute("aria-current"))).toEqual(["true", null, null, null]);
});

it("names a table with a blank name Unnamed", async () => {
  const el = await open({
    draft: { tables: [table("m1", "  "), table("m2", "Terrace 1")] },
  });
  expect(rows(el).map(nameOf)).toEqual(["Terrace 1", "Unnamed"]);
});

it("leaves out its heading inside a sheet, whose toggle already names it", async () => {
  const el = await open({ inSheet: true });
  expect(el.shadowRoot!.querySelector("h2")).toBeNull();
});

it("writes a marked table's message under its name in the error colour, as its description", async () => {
  const el = await open({ marks: new Map([["m2", "Booked 12 Oct, 21:00"]]) });
  el.style.setProperty("--wt-color-danger", "rgb(7, 8, 9)");
  const markedRow = rows(el).find((r) => r.dataset.table === "m2")!;
  const mark = markedRow.querySelector<HTMLElement>("[data-mark]")!;
  expect(nameOf(markedRow)).toBe("Terrace 10");
  expect(mark.textContent!.trim()).toBe("Booked 12 Oct, 21:00");
  const text = document.createRange();
  text.selectNodeContents(mark);
  expect(text.getBoundingClientRect().left).toBeCloseTo(
    markedRow.querySelector("[data-name]")!.getBoundingClientRect().left,
    0,
  );
  expect(getComputedStyle(mark).color).toBe("rgb(7, 8, 9)");
  const described = toggle(markedRow).getAttribute("aria-describedby")!;
  expect(el.shadowRoot!.getElementById(described)).toBe(mark);
  expect(mark.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    markedRow.querySelector("[data-name]")!.getBoundingClientRect().bottom,
  );
  for (const other of rows(el).filter((r) => r !== markedRow)) {
    expect(other.querySelector("[data-mark]")).toBeNull();
    expect(toggle(other).hasAttribute("aria-describedby")).toBe(false);
  }
});

it("the bin asks the page to delete the table and changes nothing itself", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  const asks: unknown[] = [];
  el.addEventListener("floor-plan-delete-ask", (e) => asks.push((e as CustomEvent).detail));
  row(el, "Terrace 2").querySelector<HTMLElement>("[data-action=delete]")!.click();
  expect(asks).toEqual([{ key: "m3" }]);
  expect(changes).toEqual([]);
  expect(selects).toEqual([]);
});

it("starts with Add tables and Add joined table", async () => {
  const el = await open();
  const elements = [...el.shadowRoot!.children].filter((c) => c.tagName !== "STYLE");
  expect(
    [...elements[0]!.children].map((c) => c.matches("wt-button") && c.getAttribute("data-action")),
  ).toEqual(["add-tables", "add-joined-table"]);
});

it("Add tables asks the page to open its dialog", async () => {
  const el = await open();
  let asked = 0;
  el.addEventListener("floor-plan-add-tables", () => asked++);
  const add = el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!;
  expect(add.textContent!.trim()).toBe("Add tables");
  add.click();
  expect(asked).toBe(1);
});

const joined: FloorPlanDraft = {
  tables: [
    table("c1", "Counter 1", true, 4),
    table("c3", "Counter 3", false, 2),
    table("c4", "Counter 4", false, 6),
    table("c5", "Counter 5", false, 4),
    { ...table("long", "Long table", true, 10), parts: ["c4", "c5", "c3"] },
    table("s2", "Stool 2", false, 1),
  ],
};

const madeOf = (r: HTMLElement) => r.querySelector("[data-made-of]")!.textContent!.trim();

it("shows a part greyed with its joined table's name, and a joined table's parts shortened", async () => {
  const { el, host } = await mount({ draft: joined });
  host.style.setProperty("--wt-color-text-muted", "rgb(41, 42, 43)");
  const part = row(el, "Counter 4");
  expect(part.querySelector("[data-marker]")!.getAttribute("data-marker")).toBe("joined");
  expect(madeOf(part)).toBe("in Long table");
  expect(getComputedStyle(part.querySelector("[data-name]")!).color).toBe("rgb(41, 42, 43)");
  expect(getComputedStyle(part.querySelector("[data-seats]")!).color).toBe("rgb(41, 42, 43)");
  expect(toggle(part).getAttribute("aria-disabled")).toBe("true");
  expect(toggle(part).disabled).toBe(false);
  expect(madeOf(row(el, "Long table"))).toBe("Counter 3, 4, 5");
  expect(madeOf(row(el, "Counter 1"))).toBe("—");
  expect(row(el, "Long table").querySelector("[data-marker]")!.getAttribute("data-marker")).toBe(
    "placed",
  );
  expect(toggle(row(el, "Counter 1")).hasAttribute("aria-disabled")).toBe(false);
  expect(rows(el).every((r) => r.querySelector("[data-action=delete]") !== null)).toBe(true);
  const heads = [...el.shadowRoot!.querySelectorAll("[data-head]")].map((h) =>
    h.textContent!.trim(),
  );
  expect(heads).toEqual(["Name", "Seats", "Made of"]);
  expect(el.shadowRoot!.querySelector("[data-legend]")).toBeNull();
});

it("tells a part's joined table once, in its toggle's name, and describes a marked part by its mark alone", async () => {
  const el = await open({ draft: joined, marks: new Map([["c4", "Booked 12 Oct, 21:00"]]) });
  const marked = toggle(row(el, "Counter 4"));
  await expect.element(marked).toHaveAccessibleName(/^Counter 4\b.*\bin Long table$/);
  await expect.element(marked).toHaveAccessibleDescription("Booked 12 Oct, 21:00");
  const part = toggle(row(el, "Counter 3"));
  await expect.element(part).toHaveAccessibleName(/^Counter 3\b.*\bin Long table$/);
  await expect.element(part).toHaveAccessibleDescription("");
});

it("writes — in Made of for a joined table with no parts", async () => {
  const el = await open({
    draft: { tables: [{ ...table("long", "Long table", true, 10), parts: [] }] },
  });
  expect(madeOf(row(el, "Long table"))).toBe("—");
});

it("draws a part's marker as a grey square", async () => {
  const { el, host } = await mount({ draft: joined });
  host.style.setProperty("--wt-color-text-muted", "rgb(41, 42, 43)");
  const marker = getComputedStyle(row(el, "Counter 3").querySelector("[data-marker]")!);
  expect(marker.backgroundColor).toBe("rgb(41, 42, 43)");
  expect(marker.borderRadius).not.toBe("9999px");
});

it("clicking a part changes nothing and selects nothing", async () => {
  const el = await open({ draft: joined });
  const { changes, selects } = listen(el);
  let noRoom = 0;
  el.addEventListener("floor-plan-no-room", () => noRoom++);
  toggle(row(el, "Counter 4")).click();
  expect(changes).toEqual([]);
  expect(selects).toEqual([]);
  expect(noRoom).toBe(0);
});

it("Add joined table asks the page to open its window", async () => {
  const el = await open();
  const asked: unknown[] = [];
  el.addEventListener("floor-plan-add-joined-table", (e) => asked.push((e as CustomEvent).detail));
  const add = el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-joined-table]")!;
  expect(add.getAttribute("variant")).toBe("secondary");
  expect(add.textContent!.trim()).toBe("Add joined table");
  add.click();
  expect(asked).toEqual([{}]);
});

it("puts Add tables and Add joined table side by side", async () => {
  const el = await open();
  const add = el.shadowRoot!.querySelector("wt-button[data-action=add-tables]")!;
  const joinedButton = el.shadowRoot!.querySelector("wt-button[data-action=add-joined-table]")!;
  const [a, b] = [add.getBoundingClientRect(), joinedButton.getBoundingClientRect()];
  expect(b.top).toBeCloseTo(a.top, 0);
  expect(b.left).toBeGreaterThan(a.right);
});

it("shows the list in Spanish", async () => {
  setLocale("es-ES");
  const el = await open({ draft: joined });
  const heads = [...el.shadowRoot!.querySelectorAll("[data-head]")].map((h) =>
    h.textContent!.trim(),
  );
  expect(heads).toEqual(["Nombre", "Plazas", "Formada por"]);
  expect(madeOf(row(el, "Counter 4"))).toBe("en Long table");
  expect(el.shadowRoot!.querySelector("[data-legend]")).toBeNull();
  expect(
    el.shadowRoot!.querySelector("wt-button[data-action=add-joined-table]")!.textContent!.trim(),
  ).toBe("Añadir mesa unida");
});

it("starts the Made of head where each row's Made of starts", async () => {
  const el = await open({ draft: joined });
  const madeOfHead = [...el.shadowRoot!.querySelectorAll("[data-head]")].at(-1)!;
  for (const r of rows(el))
    expect(r.querySelector("[data-made-of]")!.getBoundingClientRect().left).toBeCloseTo(
      madeOfHead.getBoundingClientRect().left,
      0,
    );
});

it("A671: clicking a placed name selects without taking it off", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  await userEvent.click(row(el, "Terrace 1").querySelector<HTMLElement>("[data-name]")!);
  expect(changes).toEqual([]);
  expect(selects).toEqual(["m1"]);
});

it("A671: clicking an unplaced name leaves the plan and selection alone", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  await userEvent.click(row(el, "Terrace 2").querySelector<HTMLElement>("[data-name]")!);
  expect(changes).toEqual([]);
  expect(selects).toEqual([]);
});

it("A671: a short name stays on one line in the desktop panel", async () => {
  const el = await open({ draft: { tables: [table("c1", "Counter 1", true, 4)] } });
  el.style.width = "288px";
  await el.updateComplete;
  const name = row(el, "Counter 1").querySelector<HTMLElement>("[data-name]")!;
  const text = document.createRange();
  text.selectNodeContents(name);
  expect(text.getClientRects()).toHaveLength(1);
});

it.each(["Arial", "Verdana"])(
  "A671: a short name stays on one line with fallback font %s",
  async (font) => {
    const el = await open({ draft: { tables: [table("c1", "Counter 1", true, 4)] } });
    el.style.width = "288px";
    el.style.setProperty("--wt-font-family", font);
    await el.updateComplete;
    const name = row(el, "Counter 1").querySelector<HTMLElement>("[data-name]")!;
    const text = document.createRange();
    text.selectNodeContents(name);
    expect(text.getClientRects()).toHaveLength(1);
    el.selected = "c1";
    await el.updateComplete;
    text.selectNodeContents(row(el, "Counter 1").querySelector("[data-name]")!);
    expect(text.getClientRects()).toHaveLength(1);
  },
);

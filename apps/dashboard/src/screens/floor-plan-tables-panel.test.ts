import { afterEach, beforeEach, expect, it } from "vitest";
import type { WtButton, WtFormActions, WtModal } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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

const table = (key: string, label: string, placed = false): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats: null,
  fixed: false,
  placement: placed ? { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } : null,
});

const draft: FloorPlanDraft = {
  tables: [
    table("m1", "Terrace 1", true),
    table("m2", "Terrace 10"),
    table("m3", "Terrace 2"),
    table("m4", "Terrace bar 3"),
  ],
  joins: [],
};

async function mount(props: Partial<FloorPlanTablesPanel> = {}) {
  let n = 0;
  const mounted = await mountWidget<FloorPlanTablesPanel>("floor-plan-tables-panel", {
    draft,
    zoneName: "Terrace",
    nextKey: () => `new:${++n}`,
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
const row = (el: FloorPlanTablesPanel, label: string) =>
  rows(el).find((r) => r.textContent!.trim() === label)!;

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

it("lists the tables in numeric order, placed ones muted", async () => {
  const el = await open();
  expect(el.shadowRoot!.querySelector("h2")!.textContent!.trim()).toBe("Tables");
  expect(rows(el).map((r) => r.textContent!.trim())).toEqual([
    "Terrace 1",
    "Terrace 2",
    "Terrace 10",
    "Terrace bar 3",
  ]);
  expect(
    rows(el)
      .filter((r) => r.hasAttribute("data-placed"))
      .map((r) => r.textContent!.trim()),
  ).toEqual(["Terrace 1"]);
});

it("pressing an unplaced table places it at the first free spot and selects it", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  row(el, "Terrace 2").click();
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

it("pressing a placed table selects it and changes nothing", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  row(el, "Terrace 1").click();
  expect(selects).toEqual(["m1"]);
  expect(changes).toEqual([]);
});

it("paints a placed table's row in the muted text colour", async () => {
  const { el, host } = await mount();
  host.style.setProperty("--wt-color-text-muted", "rgb(41, 42, 43)");
  host.style.setProperty("--wt-color-text", "rgb(11, 12, 13)");
  const inner = (label: string) => row(el, label).shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(inner("Terrace 1")).color).toBe("rgb(41, 42, 43)");
  expect(getComputedStyle(inner("Terrace 2")).color).toBe("rgb(11, 12, 13)");
});

it("names a table with a blank name Unnamed", async () => {
  const el = await open({
    draft: { tables: [table("m1", "  "), table("m2", "Terrace 1")], joins: [] },
  });
  expect(rows(el).map((r) => r.textContent!.trim())).toEqual(["Unnamed", "Terrace 1"]);
});

it("leaves out its heading inside a sheet, whose toggle already names it", async () => {
  const el = await open({ inSheet: true });
  expect(el.shadowRoot!.querySelector("h2")).toBeNull();
});

it("writes a refused table's reason after its name in the error colour", async () => {
  const el = await open({ refused: { key: "m2", reason: "Booked 12 Oct, 21:00" } });
  el.style.setProperty("--wt-color-danger", "rgb(7, 8, 9)");
  const refusedRow = rows(el).find((r) => r.dataset.table === "m2")!;
  expect(refusedRow.textContent!.trim()).toBe("Terrace 10 — Booked 12 Oct, 21:00");
  expect(getComputedStyle(refusedRow.querySelector(".refused")!).color).toBe("rgb(7, 8, 9)");
  expect(row(el, "Terrace 2").querySelector(".refused")).toBeNull();
});

const addDialog = (el: FloorPlanTablesPanel) =>
  el.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-tables]")!;
const addField = <T extends HTMLElement = HTMLElement & { value: string; error: string }>(
  el: FloorPlanTablesPanel,
  name: string,
) => addDialog(el).querySelector<T>(`[name=${name}]`)!;
const nameFields = (el: FloorPlanTablesPanel) => [
  ...addDialog(el).querySelectorAll<HTMLElement & { value: string; label: string; error: string }>(
    "[name=table-name]",
  ),
];
const addAction = (el: FloorPlanTablesPanel, action: string) =>
  addDialog(el).querySelector<WtButton>(`wt-button[data-action=${action}]`)!;
const formError = (el: FloorPlanTablesPanel) =>
  addDialog(el).querySelector<WtFormActions>("wt-form-actions")!.error;

async function openAdd(props: Partial<FloorPlanTablesPanel> = {}) {
  const el = await open(props);
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!.click();
  await el.updateComplete;
  await addDialog(el).updateComplete;
  return el;
}

async function set(el: FloorPlanTablesPanel, field: Element, value: string): Promise<void> {
  await chooseOption(field, value);
  await el.updateComplete;
}

async function setNames(el: FloorPlanTablesPanel, names: string[]): Promise<void> {
  await set(el, addField(el, "table-count"), String(names.length));
  await set(el, addField(el, "naming"), "custom");
  for (const [i, name] of names.entries()) await set(el, nameFields(el)[i]!, name);
}

async function pressAdd(el: FloorPlanTablesPanel): Promise<void> {
  addAction(el, "add-confirm").click();
  await el.updateComplete;
}

const added = (changes: FloorPlanDraft[]) => changes[0]!.tables.slice(draft.tables.length);

it("Add tables opens with one table, four seats and the zone's name as prefix", async () => {
  const el = await openAdd();
  expect(addDialog(el).open).toBe(true);
  expect(addField(el, "table-count").value).toBe("1");
  expect(addField(el, "seats").value).toBe("4");
  expect(addField(el, "naming").value).toBe("automatic");
  expect(addField(el, "prefix").value).toBe("Terrace");
  expect(addField<HTMLElement & { hint: string }>(el, "prefix").hint).toBe("Terrace 11");
  expect(addField<HTMLElement & { checked: boolean }>(el, "fixed").checked).toBe(false);
  expect(addAction(el, "add-confirm").variant).toBe("primary");
  expect(addAction(el, "add-confirm").disabled).toBe(false);
});

it("the hint gives the first and last names for more than one table", async () => {
  const el = await openAdd();
  await set(el, addField(el, "table-count"), "5");
  expect(addField<HTMLElement & { hint: string }>(el, "prefix").hint).toBe(
    "Terrace 11 to Terrace 15",
  );
});

it("automatic names number on from the highest with the prefix", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "table-count"), "3");
  await pressAdd(el);
  expect(changes).toHaveLength(1);
  expect(added(changes)).toEqual(
    ["Terrace 11", "Terrace 12", "Terrace 13"].map((label, i) => ({
      key: `new:${i + 1}`,
      id: null,
      liveTableId: null,
      label,
      seats: 4,
      fixed: false,
      placement: null,
    })),
  );
  expect(addDialog(el).open).toBe(false);
});

it("a name used in another zone counts for the numbering", async () => {
  const el = await openAdd({ takenElsewhere: new Set(["Terrace 40"]) });
  expect(addField<HTMLElement & { hint: string }>(el, "prefix").hint).toBe("Terrace 41");
});

it("a changed prefix names the tables with it", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "prefix"), "Terrace bar");
  expect(addField<HTMLElement & { hint: string }>(el, "prefix").hint).toBe("Terrace bar 4");
  await pressAdd(el);
  expect(added(changes).map((t) => t.label)).toEqual(["Terrace bar 4"]);
});

it("custom naming shows one name field per table", async () => {
  const el = await openAdd();
  await set(el, addField(el, "table-count"), "3");
  await set(el, addField(el, "naming"), "custom");
  expect(addField(el, "prefix")).toBeNull();
  expect(nameFields(el).map((f) => f.label)).toEqual(["Name 1", "Name 2", "Name 3"]);
  expect(nameFields(el).every((f) => f.hasAttribute("required"))).toBe(true);
});

it("adds the custom names as typed, trimmed", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await setNames(el, [" Patio 1 ", "Patio 2"]);
  await pressAdd(el);
  expect(added(changes).map((t) => t.label)).toEqual(["Patio 1", "Patio 2"]);
});

it("a custom name in use is refused beside its field", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await setNames(el, ["Patio 1", "Terrace 2"]);
  await pressAdd(el);
  expect(nameFields(el)[0]!.error).toBe("");
  expect(nameFields(el)[1]!.error).toBe("A table with that name already exists");
  expect(formError(el)).toBe("Correct the highlighted fields to continue.");
  expect(changes).toEqual([]);
  expect(addDialog(el).open).toBe(true);
  expect(addAction(el, "add-confirm").disabled).toBe(true);
  await set(el, nameFields(el)[1]!, "Patio 2");
  expect(nameFields(el)[1]!.error).toBe("");
  expect(formError(el)).toBe("");
  expect(addAction(el, "add-confirm").disabled).toBe(false);
});

it("a custom name used in another zone, or twice in the batch, is refused the same way", async () => {
  const el = await openAdd({ takenElsewhere: new Set(["Bar 1"]) });
  const { changes } = listen(el);
  await setNames(el, ["Bar 1", "Patio", " Patio"]);
  await pressAdd(el);
  expect(nameFields(el).map((f) => f.error)).toEqual([
    "A table with that name already exists",
    "",
    "A table with that name already exists",
  ]);
  expect(formError(el)).toBe("Correct the highlighted fields to continue.");
  expect(changes).toEqual([]);
});

it("an empty custom name asks for a name", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await setNames(el, ["Patio 1", " "]);
  await pressAdd(el);
  expect(nameFields(el)[1]!.error).toBe("Enter a name.");
  expect(formError(el)).toBe("Correct the highlighted fields to continue.");
  expect(addAction(el, "add-confirm").disabled).toBe(true);
  expect(changes).toEqual([]);
});

it("a count outside 1 to 100 is refused beside its field", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  for (const value of ["", "0", "101", "2.5"]) {
    await set(el, addField(el, "table-count"), value);
    await pressAdd(el);
    expect(addField(el, "table-count").error).toBe("Enter 1 to 100.");
    expect(addAction(el, "add-confirm").disabled).toBe(true);
  }
  await set(el, addField(el, "table-count"), "100");
  expect(addField(el, "table-count").error).toBe("");
  expect(addAction(el, "add-confirm").disabled).toBe(false);
  expect(changes).toEqual([]);
});

it("a seat count outside 0 to 999 is refused beside its field", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "seats"), "1000");
  await pressAdd(el);
  expect(addField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(changes).toEqual([]);
  await set(el, addField(el, "seats"), "0");
  await pressAdd(el);
  expect(added(changes).map((t) => t.seats)).toEqual([0]);
});

it("Fixed in place adds fixed tables", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "table-count"), "2");
  const fixed = addField<HTMLElement & { checked: boolean }>(el, "fixed");
  fixed.checked = true;
  fixed.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  await pressAdd(el);
  expect(added(changes).map((t) => t.fixed)).toEqual([true, true]);
});

it("an empty seat count adds tables with no seats", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "seats"), "");
  await pressAdd(el);
  expect(added(changes).map((t) => t.seats)).toEqual([null]);
});

it("Cancel adds nothing", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "table-count"), "3");
  addAction(el, "add-cancel").click();
  await expect.poll(() => addDialog(el).open).toBe(false);
  expect(changes).toEqual([]);
});

it("opens afresh after an add", async () => {
  const el = await openAdd();
  await set(el, addField(el, "table-count"), "3");
  await pressAdd(el);
  el.draft = { tables: [...draft.tables, table("x", "Terrace 11")], joins: [] };
  el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!.click();
  await el.updateComplete;
  expect(addField(el, "table-count").value).toBe("1");
  expect(addField<HTMLElement & { hint: string }>(el, "prefix").hint).toBe("Terrace 12");
});

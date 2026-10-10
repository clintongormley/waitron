import { afterEach, beforeEach, expect, it } from "vitest";
import type { WtButton, WtFormActions, WtModal } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-add-tables.js";
import type { FloorPlanAddTables } from "./floor-plan-add-tables.js";
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

const table = (key: string, label: string): DraftTable => ({
  key,
  id: key,
  liveTableId: null,
  label,
  seats: null,
  fixed: false,
  placement: null,
});

const draft: FloorPlanDraft = {
  tables: [
    table("m1", "Terrace 1"),
    table("m2", "Terrace 10"),
    table("m3", "Terrace 2"),
    table("m4", "Terrace bar 3"),
  ],
  joins: [],
};

function listen(el: FloorPlanAddTables) {
  const changes: FloorPlanDraft[] = [];
  el.addEventListener("floor-plan-change", (e) =>
    changes.push((e as CustomEvent<{ draft: FloorPlanDraft }>).detail.draft),
  );
  return { changes };
}

async function mount(props: Partial<FloorPlanAddTables> = {}): Promise<FloorPlanAddTables> {
  let n = 0;
  const { el } = await mountWidget<FloorPlanAddTables>("floor-plan-add-tables", {
    draft,
    zoneName: "Terrace",
    nextKey: () => `new:${++n}`,
    ...props,
  });
  await el.updateComplete;
  return el;
}

async function show(el: FloorPlanAddTables): Promise<void> {
  el.show();
  await el.updateComplete;
  await addDialog(el).updateComplete;
}

const addDialog = (el: FloorPlanAddTables) =>
  el.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-tables]")!;
const addField = <T extends HTMLElement = HTMLElement & { value: string; error: string }>(
  el: FloorPlanAddTables,
  name: string,
) => addDialog(el).querySelector<T>(`[name=${name}]`)!;
const nameFields = (el: FloorPlanAddTables) => [
  ...addDialog(el).querySelectorAll<HTMLElement & { value: string; label: string; error: string }>(
    "[name=table-name]",
  ),
];
const addAction = (el: FloorPlanAddTables, action: string) =>
  addDialog(el).querySelector<WtButton>(`wt-button[data-action=${action}]`)!;
const formError = (el: FloorPlanAddTables) =>
  addDialog(el).querySelector<WtFormActions>("wt-form-actions")!.error;

async function openAdd(props: Partial<FloorPlanAddTables> = {}) {
  const el = await mount(props);
  await show(el);
  return el;
}

/** The names preview as a sighted person sees it: its text, drawn with a box. */
function preview(el: FloorPlanAddTables): string {
  const line = addDialog(el).querySelector<HTMLElement>("[data-preview]")!;
  const box = line.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return line.textContent!.trim();
}

async function set(el: FloorPlanAddTables, field: Element, value: string): Promise<void> {
  await chooseOption(field, value);
  await el.updateComplete;
}

async function setNames(el: FloorPlanAddTables, names: string[]): Promise<void> {
  await set(el, addField(el, "table-count"), String(names.length));
  await set(el, addField(el, "naming"), "custom");
  for (const [i, name] of names.entries()) await set(el, nameFields(el)[i]!, name);
}

async function pressAdd(el: FloorPlanAddTables): Promise<void> {
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
  expect(addField<HTMLElement & { hint: string }>(el, "prefix").hint).toBe("");
  expect(preview(el)).toBe("Terrace 11");
  expect(addField<HTMLElement & { checked: boolean }>(el, "fixed").checked).toBe(false);
  expect(addAction(el, "add-confirm").variant).toBe("primary");
  expect(addAction(el, "add-confirm").disabled).toBe(false);
});

it("the preview gives the first and last names for more than one table", async () => {
  const el = await openAdd();
  await set(el, addField(el, "table-count"), "5");
  expect(preview(el)).toBe("Terrace 11 to Terrace 15");
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
  expect(preview(el)).toBe("Terrace 41");
});

it("a changed prefix names the tables with it", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  await set(el, addField(el, "prefix"), "Terrace bar");
  expect(preview(el)).toBe("Terrace bar 4");
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
  await show(el);
  expect(addField(el, "table-count").value).toBe("1");
  expect(preview(el)).toBe("Terrace 12");
});

it("a refused Add moves focus to the first field it marks", async () => {
  const el = await openAdd();
  await setNames(el, ["Patio 1", "Terrace 2"]);
  await pressAdd(el);
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(nameFields(el)[1]);
  await set(el, addField(el, "table-count"), "0");
  await pressAdd(el);
  await expect.poll(() => el.shadowRoot!.activeElement).toBe(addField(el, "table-count"));
});

it("a count or seats written as other than plain digits is refused", async () => {
  const el = await openAdd();
  const { changes } = listen(el);
  for (const value of ["1e1", " 5", "0x2"]) {
    await set(el, addField(el, "table-count"), value);
    await pressAdd(el);
    expect(addField(el, "table-count").error).toBe("Enter 1 to 100.");
  }
  await set(el, addField(el, "table-count"), "2");
  await set(el, addField(el, "seats"), "1e1");
  await pressAdd(el);
  expect(addField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(changes).toEqual([]);
});

it("the preview shows a prefix holding $& as typed", async () => {
  const el = await openAdd();
  await set(el, addField(el, "prefix"), "A$&B");
  await set(el, addField(el, "table-count"), "3");
  expect(preview(el)).toBe("A$&B 1 to A$&B 3");
});

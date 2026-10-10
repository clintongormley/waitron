import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-table-panel.js";
import type { FloorPlanTablePanel } from "./floor-plan-table-panel.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { FloorPlan } from "../api/client.js";
import { draftFromPlan, patchTable, placeTable, type FloorPlanDraft } from "./floor-plan-draft.js";

let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  cleanupWidgets();
});

const m1Placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

const plan: FloorPlan = {
  zoneId: "z1",
  revision: 3,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [
    { id: "m1", liveTableId: "l1", label: "T1", seats: 4, fixed: false, placement: m1Placement },
    { id: "m2", liveTableId: "l2", label: "T2", seats: 2, fixed: true, placement: null },
    { id: null, liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
  ],
  joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
};

const opened = (): FloorPlanDraft => draftFromPlan(plan);

type Field = HTMLElement & { value: string; error: string; checked: boolean };

async function open(props: Partial<FloorPlanTablePanel> = {}): Promise<FloorPlanTablePanel> {
  const { el } = await mountWidget<FloorPlanTablePanel>("floor-plan-table-panel", {
    draft: opened(),
    tableKey: "m1",
    ...props,
  });
  await el.updateComplete;
  return el;
}

const field = (el: FloorPlanTablePanel, name: string) =>
  el.shadowRoot!.querySelector<Field>(`[name=${name}]`);
const action = (el: FloorPlanTablePanel, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`);

interface Change {
  draft: FloorPlanDraft;
  mergeKey?: string;
}

function listen(el: FloorPlanTablePanel) {
  const changes: Change[] = [];
  const selects: (string | null)[] = [];
  el.addEventListener("floor-plan-change", (e) => {
    const detail = (e as CustomEvent<Change>).detail;
    changes.push(detail);
    el.draft = detail.draft;
  });
  el.addEventListener("floor-plan-select", (e) =>
    selects.push((e as CustomEvent<{ key: string | null }>).detail.key),
  );
  return { changes, selects };
}

async function set(el: FloorPlanTablePanel, name: string, value: string): Promise<void> {
  await chooseOption(field(el, name)!, value);
  await el.updateComplete;
}

const tableOf = (change: Change | undefined, key: string) =>
  change!.draft.tables.find((t) => t.key === key);

it("shows the selected table's values", async () => {
  const el = await open();
  expect(field(el, "table-name")!.value).toBe("T1");
  expect(field(el, "seats")!.value).toBe("4");
  expect(field(el, "fixed")!.checked).toBe(false);
  expect(field(el, "shape")!.value).toBe("rect");
  expect(field(el, "width")!.value).toBe("8");
  expect(field(el, "height")!.value).toBe("8");
  expect(field(el, "rotation")!.value).toBe("0");
});

it("typing a name sends one merged change", async () => {
  const el = await open();
  const { changes } = listen(el);
  await set(el, "table-name", "T1a");
  await set(el, "table-name", "T1ab");
  expect(changes).toHaveLength(2);
  expect(changes.map((c) => c.mergeKey)).toEqual(["label:m1", "label:m1"]);
  expect(tableOf(changes[1], "m1")!.label).toBe("T1ab");
});

it("an empty seat count sends no seats", async () => {
  const el = await open();
  const { changes } = listen(el);
  await set(el, "seats", "");
  expect(changes).toHaveLength(1);
  expect(changes[0]!.mergeKey).toBe("seats:m1");
  expect(tableOf(changes[0], "m1")!.seats).toBeNull();
});

interface Invalid {
  key: string;
  field: string;
  text: string | null;
  message?: () => string;
}

function listenInvalid(el: FloorPlanTablePanel): Invalid[] {
  const sent: Invalid[] = [];
  el.addEventListener("floor-plan-invalid", (e) => sent.push((e as CustomEvent<Invalid>).detail));
  return sent;
}

/** Types as a person does: one input event per character, after clearing the field. */
async function typeInto(el: FloorPlanTablePanel, name: string, keys: string): Promise<void> {
  const input = field(el, name)!.shadowRoot!.querySelector("input")!;
  await userEvent.clear(input);
  await userEvent.type(input, keys);
  await el.updateComplete;
}

it("a seat count typed past 999 asks the page to refuse it, sending only the valid prefixes", async () => {
  const el = await open();
  const { changes } = listen(el);
  const invalid = listenInvalid(el);
  await typeInto(el, "seats", "1000");
  expect(changes.map((c) => tableOf(c, "m1")!.seats)).toEqual([null, 1, 10, 100]);
  expect(invalid.at(-1)).toMatchObject({ key: "m1", field: "seats", text: "1000" });
  expect(invalid.at(-1)!.message!()).toBe("Enter 0 to 999.");
});

it("a fraction or a trailing point is refused", async () => {
  const el = await open();
  const { changes } = listen(el);
  const invalid = listenInvalid(el);
  await typeInto(el, "width", "1.5");
  expect(changes.map((c) => tableOf(c, "m1")!.placement!.width)).toEqual([1]);
  expect(invalid.filter((i) => i.text !== null).map((i) => i.text)).toEqual(["", "1.", "1.5"]);
  expect(invalid.at(-1)!.message!()).toBe("Enter 1 to 99.");
  await typeInto(el, "seats", "4.");
  expect(invalid.at(-1)).toMatchObject({ field: "seats", text: "4." });
});

it("a valid value after a refusal tells the page the field is fine", async () => {
  const el = await open();
  const { changes } = listen(el);
  const invalid = listenInvalid(el);
  await typeInto(el, "seats", "1000");
  const input = field(el, "seats")!.shadowRoot!.querySelector("input")!;
  await userEvent.type(input, "{Backspace}");
  expect(invalid.at(-1)).toMatchObject({ key: "m1", field: "seats", text: null });
  expect(tableOf(changes.at(-1), "m1")!.seats).toBe(100);
});

it("shows the refused text the page hands back, and the draft's value once it goes", async () => {
  const el = await open({
    fieldError: { field: "seats", message: "Enter 0 to 999.", text: "1000" },
  });
  expect(field(el, "seats")!.value).toBe("1000");
  expect(field(el, "seats")!.error).toBe("Enter 0 to 999.");
  el.fieldError = null;
  await el.updateComplete;
  expect(field(el, "seats")!.value).toBe("4");
  expect(field(el, "seats")!.error).toBe("");
});

it("shows a draft value again over text typed into the field", async () => {
  const el = await open();
  listen(el);
  listenInvalid(el);
  await typeInto(el, "height", "0");
  expect(field(el, "height")!.value).toBe("0");
  el.draft = patchTable(el.draft, "m1", { label: "T1x" });
  await el.updateComplete;
  expect(field(el, "height")!.value).toBe("8");
});

it("Fixed in place, shape, width, height and rotation each send their change", async () => {
  const el = await open();
  const { changes } = listen(el);
  const fixed = field(el, "fixed")!;
  fixed.shadowRoot!.querySelector("input")!.click();
  await el.updateComplete;
  expect(tableOf(changes.at(-1), "m1")!.fixed).toBe(true);
  expect(changes.at(-1)!.mergeKey).toBeUndefined();
  await set(el, "shape", "round");
  expect(tableOf(changes.at(-1), "m1")!.placement!.shape).toBe("round");
  await set(el, "width", "10");
  expect(tableOf(changes.at(-1), "m1")!.placement!.width).toBe(10);
  expect(changes.at(-1)!.mergeKey).toBe("width:m1");
  await set(el, "height", "6");
  expect(tableOf(changes.at(-1), "m1")!.placement!.height).toBe(6);
  expect(changes.at(-1)!.mergeKey).toBe("height:m1");
  await set(el, "rotation", "45");
  expect(tableOf(changes.at(-1), "m1")!.placement).toEqual({
    x: 2,
    y: 3,
    width: 10,
    height: 6,
    shape: "round",
    rotation: 45,
  });
  expect(changes).toHaveLength(5);
});

it("offers rotation in 15° steps from 0° to 345°", async () => {
  const el = await open();
  const options = (
    field(el, "rotation") as unknown as { options: { value: string; label: string }[] }
  ).options;
  expect(options).toHaveLength(24);
  expect(options[0]).toEqual({ value: "0", label: "0°" });
  expect(options[1]).toEqual({ value: "15", label: "15°" });
  expect(options.at(-1)).toEqual({ value: "345", label: "345°" });
});

it("names its fields and actions in Spanish", async () => {
  setLocale("es-ES");
  const el = await open();
  const label = (name: string) => (field(el, name) as unknown as { label: string }).label;
  expect(label("table-name")).toBe("Nombre");
  expect(label("shape")).toBe("Forma");
  expect(label("width")).toBe("Ancho");
  expect(label("height")).toBe("Largo");
  expect(label("rotation")).toBe("Giro");
  const shapes = (field(el, "shape") as unknown as { options: { label: string }[] }).options;
  expect(shapes.map((o) => o.label)).toEqual(["Rectángulo", "Redonda"]);
  expect(action(el, "remove")!.textContent!.trim()).toBe("Quitar del plano");
  el.tableKey = "m2";
  await el.updateComplete;
  expect(action(el, "place")!.textContent!.trim()).toBe("Colocar");
});

it("an unplaced table offers Place and no shape or size", async () => {
  const el = await open({ tableKey: "m2" });
  const { changes } = listen(el);
  for (const name of ["shape", "width", "height", "rotation"]) expect(field(el, name)).toBeNull();
  expect(action(el, "remove")).toBeNull();
  expect(action(el, "place")!.textContent!.trim()).toBe("Place");
  action(el, "place")!.click();
  expect(changes).toHaveLength(1);
  expect(tableOf(changes[0], "m2")!.placement).toEqual(
    placeTable(opened(), "m2").tables.find((t) => t.key === "m2")!.placement,
  );
  expect(tableOf(changes[0], "m2")!.placement).not.toBeNull();
});

it("Remove from plan makes the table a spare", async () => {
  const el = await open();
  const { changes } = listen(el);
  expect(action(el, "place")).toBeNull();
  expect(action(el, "remove")!.textContent!.trim()).toBe("Remove from plan");
  action(el, "remove")!.click();
  expect(tableOf(changes[0], "m1")!.placement).toBeNull();
});

it("Delete removes the table and clears the selection", async () => {
  const el = await open();
  const { changes, selects } = listen(el);
  expect(action(el, "delete")!.textContent!.trim()).toBe("Delete");
  action(el, "delete")!.click();
  expect(changes).toHaveLength(1);
  expect(tableOf(changes[0], "m1")).toBeUndefined();
  expect(changes[0]!.draft.joins).toEqual([]);
  expect(selects).toEqual([null]);
});

it("a table offered for adoption has Remove from plan but no Delete", async () => {
  const placed = placeTable(opened(), "live:l9");
  const el = await open({ draft: placed, tableKey: "live:l9" });
  expect(action(el, "remove")).not.toBeNull();
  expect(action(el, "delete")).toBeNull();
  el.draft = patchTable(placed, "live:l9", { placement: null });
  await el.updateComplete;
  expect(action(el, "place")).not.toBeNull();
  expect(action(el, "delete")).toBeNull();
});

it("shows a refusal under the field it names", async () => {
  const el = await open({ fieldError: { field: "seats", message: "Too many seats" } });
  expect(field(el, "seats")!.error).toBe("Too many seats");
  expect(field(el, "table-name")!.error).toBe("");
  el.fieldError = { field: "label", message: "A table with that name already exists" };
  await el.updateComplete;
  expect(field(el, "table-name")!.error).toBe("A table with that name already exists");
  expect(field(el, "seats")!.error).toBe("");
});

it("shows a refusal of Fixed in place under the switch", async () => {
  const el = await open({ fieldError: { field: "fixed", message: "Not allowed" } });
  const note = el.shadowRoot!.querySelector("[data-error=fixed]")!;
  expect(note.textContent!.trim()).toBe("Not allowed");
  expect((field(el, "fixed") as unknown as { description: string }).description).toBe(
    "Not allowed",
  );
});

it("shows nothing for a table the draft does not hold", async () => {
  const el = await open({ tableKey: "gone" });
  expect(el.shadowRoot!.querySelector("[name]")).toBeNull();
});

const joinRows = (el: FloorPlanTablePanel) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-join]"),
];

it("lists the table's joins and removes one", async () => {
  const el = await open();
  const { changes } = listen(el);
  expect(el.shadowRoot!.querySelector("[data-joins-heading]")!.textContent!.trim()).toBe("Joins");
  expect(
    joinRows(el).map((row) => row.querySelector("[data-join-text]")!.textContent!.trim()),
  ).toEqual(["with T2 · seats 6"]);
  joinRows(el)[0]!.querySelector<HTMLElement>("[data-test=remove-join]")!.click();
  expect(changes).toHaveLength(1);
  expect(changes[0]!.draft.joins).toEqual([]);
  await el.updateComplete;
  expect(joinRows(el)).toEqual([]);
});

it("names a join's unnamed table Unnamed and lists several with commas", async () => {
  let draft = patchTable(opened(), "m2", { label: " " });
  draft = { ...draft, joins: [{ key: "j1", seats: 8, tableKeys: ["m2", "m1", "live:l9"] }] };
  const el = await open({ draft });
  expect(joinRows(el)[0]!.querySelector("[data-join-text]")!.textContent!.trim()).toBe(
    "with Unnamed, T9 · seats 8",
  );
});

it("shows only the joins the selected table is in", async () => {
  const el = await open({ tableKey: "live:l9" });
  expect(joinRows(el)).toEqual([]);
});

it("Add join asks the page to open the dialog for this table", async () => {
  const el = await open();
  const asked: unknown[] = [];
  el.addEventListener("floor-plan-add-join", (e) => asked.push((e as CustomEvent).detail));
  const add = action(el, "add-join")!;
  expect(add.textContent!.trim()).toBe("Add join");
  add.click();
  expect(asked).toEqual([{ tableKey: "m1" }]);
});

it("shows the joins in Spanish", async () => {
  setLocale("es-ES");
  const el = await open();
  expect(el.shadowRoot!.querySelector("[data-joins-heading]")!.textContent!.trim()).toBe("Uniones");
  expect(joinRows(el)[0]!.querySelector("[data-join-text]")!.textContent!.trim()).toBe(
    "con T2 · 6 plazas",
  );
  expect(action(el, "add-join")!.textContent!.trim()).toBe("Añadir unión");
});

it("shows a join's table name as typed, even one that looks like a placeholder", async () => {
  const draft = patchTable(opened(), "m2", { label: "$& {seats}" });
  const el = await open({ draft });
  expect(joinRows(el)[0]!.querySelector("[data-join-text]")!.textContent!.trim()).toBe(
    "with $& {seats} · seats 6",
  );
});

it("names each Remove after its join's tables", async () => {
  const draft = {
    ...opened(),
    joins: [...opened().joins, { key: "j2", seats: 8, tableKeys: ["m1", "m2", "live:l9"] }],
  };
  const el = await open({ draft });
  const labels = joinRows(el).map((row) =>
    row.querySelector("[data-test=remove-join]")!.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["Remove: T2", "Remove: T2, T9"]);
  setLocale("es-ES");
  await el.updateComplete;
  expect(
    joinRows(el)[0]!.querySelector("[data-test=remove-join]")!.getAttribute("aria-label"),
  ).toBe("Eliminar: T2");
});

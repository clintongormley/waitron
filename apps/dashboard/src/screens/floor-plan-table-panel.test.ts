import { afterEach, beforeEach, expect, it } from "vitest";
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
  let n = 0;
  const { el } = await mountWidget<FloorPlanTablePanel>("floor-plan-table-panel", {
    draft: opened(),
    tableKey: "m1",
    nextJoinKey: () => `join:${++n}`,
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

it("a seat count out of range is refused beside the field and changes nothing", async () => {
  const el = await open();
  const { changes } = listen(el);
  await set(el, "seats", "1000");
  expect(changes).toEqual([]);
  expect(field(el, "seats")!.error).toBe("Enter 0 to 999.");
  await set(el, "seats", "6");
  expect(field(el, "seats")!.error).toBe("");
  expect(tableOf(changes[0], "m1")!.seats).toBe(6);
});

it("a size out of range is refused beside the field and changes nothing", async () => {
  const el = await open();
  const { changes } = listen(el);
  await set(el, "width", "0");
  await set(el, "height", "1.5");
  expect(changes).toEqual([]);
  expect(field(el, "width")!.error).toBe("Enter 1 to 99.");
  expect(field(el, "height")!.error).toBe("Enter 1 to 99.");
});

it("a refused value's sentence goes when another table is selected", async () => {
  const el = await open();
  listen(el);
  await set(el, "seats", "abc");
  expect(field(el, "seats")!.error).toBe("Enter 0 to 999.");
  el.tableKey = "m2";
  await el.updateComplete;
  expect(field(el, "seats")!.error).toBe("");
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

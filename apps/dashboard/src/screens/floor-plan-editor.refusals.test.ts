import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import "@waitron/dashboard-modules";
import type { WtButton, WtFloorPlanCanvas, WtSheet } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-editor.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";
import type { DashboardApi, FloorPlan } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  addTables,
  deleteTable,
  draftFromPlan,
  moveTable,
  patchTable,
  type FloorPlanDraft,
} from "./floor-plan-draft.js";

const originalUrl = location.href;
let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
  setLocale("en-GB");
});
afterEach(() => {
  setLocale(originalLocale);
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});

const placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

function plan(): FloorPlan {
  return {
    zoneId: "z1",
    revision: 3,
    savedAt: "2026-10-01T10:00:00.000Z",
    tables: [
      { id: "m1", liveTableId: "l1", label: "T1", seats: 4, fixed: false, placement },
      { id: "m2", liveTableId: "l2", label: "T2", seats: 2, fixed: true, placement: null },
      { id: null, liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
    ],
    joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
  };
}

const opened = (): FloorPlanDraft => draftFromPlan(plan());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getFloorPlan: vi.fn().mockResolvedValue(plan()),
    listZones: vi
      .fn()
      .mockResolvedValue([{ id: "z1", name: "Terrace", displayOrder: 0, active: true }]),
    listTables: vi.fn().mockResolvedValue([]),
    saveFloorPlan: vi.fn().mockReturnValue(new Promise(() => {})),
    ...overrides,
  } as unknown as DashboardApi;
}

const refusing = (error: unknown) => stubApi({ saveFloorPlan: vi.fn().mockRejectedValue(error) });

async function flush(el: FloorPlanEditor): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function open(api: DashboardApi): Promise<FloorPlanEditor> {
  history.replaceState(null, "", "/manage/floor-plan/zone/z1");
  const { el } = await mountWidget<FloorPlanEditor>("dashboard-floor-plan-editor", { api });
  await flush(el);
  return el;
}

const canvas = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas")!;
const button = (el: FloorPlanEditor, action: string) =>
  el.shadowRoot!.querySelector<WtButton>(`wt-button[data-action=${action}]`)!;
const message = (el: FloorPlanEditor) => el.shadowRoot!.querySelector("wt-form-actions")!.error;

async function change(el: FloorPlanEditor, draft: FloorPlanDraft): Promise<void> {
  canvas(el).dispatchEvent(
    new CustomEvent("floor-plan-change", { detail: { draft }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function press(el: FloorPlanEditor, action: string): Promise<void> {
  button(el, action).click();
  await flush(el);
}

const renamed = (draft: FloorPlanDraft, key: string, label: string) =>
  patchTable(draft, key, { label });

function withT5(): FloorPlanDraft {
  let n = 0;
  return addTables(opened(), [{ label: "T5", seats: 2, fixed: false }], () => `new:${++n}`);
}

const taken = { code: "table.label_taken", params: { label: "Patio 1" } };
const invalid = (field: string) => ({ code: "floor_plan.invalid", params: { field } });

it("a taken name selects its table and shows the generic sentence", async () => {
  const el = await open(refusing(taken));
  await change(el, renamed(opened(), "m2", "Patio 1"));
  await press(el, "save");
  expect(canvas(el).selected).toBe("m2");
  expect(el.fieldError).toEqual({
    key: "m2",
    field: "label",
    message: "A table with that name already exists",
  });
  expect(message(el)).toBe("Correct the highlighted fields to continue.");
  expect(button(el, "save").disabled).toBe(false);
});

it("a taken name no draft table carries shows the code's own sentence and selects nothing", async () => {
  const el = await open(refusing({ code: "table.label_taken", params: { label: "Bar 3" } }));
  await change(el, renamed(opened(), "m2", "Patio 1"));
  await press(el, "save");
  expect(canvas(el).selected).toBeNull();
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("A table with that name already exists");
});

it("an invalid field selects the table that was sent at its index", async () => {
  const write = deferred<never>();
  const el = await open(stubApi({ saveFloorPlan: vi.fn().mockReturnValue(write.promise) }));
  const moved = moveTable(opened(), "m1", 5, 4);
  await change(el, moved);
  await press(el, "save");
  await change(el, deleteTable(moved, "m1"));
  write.reject(invalid("tables.1.seats"));
  await flush(el);
  expect(canvas(el).selected).toBe("m2");
  expect(el.fieldError?.key).toBe("m2");
  expect(el.fieldError?.field).toBe("seats");
  expect(el.fieldError?.message).toBe("Check the floor plan's tables and try again");
  expect(message(el)).toBe("Correct the highlighted fields to continue.");
});

it("a placement field the panel shows is named by its own name", async () => {
  const el = await open(refusing(invalid("tables.0.placement.width")));
  await change(el, moveTable(opened(), "m1", 5, 4));
  await press(el, "save");
  expect(el.fieldError?.field).toBe("width");
});

it("a refusal naming a field of an unplaced table stays until that field changes", async () => {
  const el = await open(refusing(invalid("tables.1.placement.width")));
  const moved = moveTable(opened(), "m1", 5, 4);
  await change(el, moved);
  await press(el, "save");
  expect(el.fieldError?.key).toBe("m2");
  await change(el, patchTable(moved, "m2", { seats: 3 }));
  expect(el.fieldError?.field).toBe("width");
  await change(el, patchTable(moved, "m2", { placement }));
  expect(el.fieldError).toBeNull();
});

it("a refusal naming an index the save did not send, or no label, selects nothing", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValueOnce(invalid("tables.7.label"))
    .mockRejectedValueOnce({ code: "table.label_taken" });
  const el = await open(stubApi({ saveFloorPlan }));
  await change(el, moveTable(opened(), "m1", 5, 4));
  await press(el, "save");
  expect(canvas(el).selected).toBeNull();
  expect(message(el)).toBe("Check the floor plan's tables and try again");
  await press(el, "save");
  expect(canvas(el).selected).toBeNull();
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("A table with that name already exists");
});

it("an invalid field of a table deleted since sending selects nothing", async () => {
  const write = deferred<never>();
  const el = await open(stubApi({ saveFloorPlan: vi.fn().mockReturnValue(write.promise) }));
  await change(el, withT5());
  await press(el, "save");
  await change(el, deleteTable(withT5(), "new:1"));
  write.reject(invalid("tables.3.label"));
  await flush(el);
  expect(canvas(el).selected).toBeNull();
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("Check the floor plan's tables and try again");
});

it("an invalid field the panel does not show selects the table and shows the refusal's own sentence", async () => {
  const el = await open(refusing(invalid("tables.0.placement.x")));
  await change(el, moveTable(opened(), "m1", 5, 4));
  await press(el, "save");
  expect(canvas(el).selected).toBe("m1");
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("Check the floor plan's tables and try again");
});

it("a refusal about a join selects nothing and shows its own sentence", async () => {
  const el = await open(refusing(invalid("joins.0.tableKeys")));
  await change(el, moveTable(opened(), "m1", 5, 4));
  canvas(el).dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key: "m1" }, bubbles: true, composed: true }),
  );
  await press(el, "save");
  expect(canvas(el).selected).toBe("m1");
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("Check the floor plan's tables and try again");
});

it("a booked table the draft deleted is named, and Undo brings it back", async () => {
  const el = await open(refusing({ code: "table.booked", params: { tableId: "l2" } }));
  await change(el, deleteTable(opened(), "m2"));
  await press(el, "save");
  expect(message(el)).toBe("T2: This table has an upcoming booking. Move the booking first");
  expect(el.fieldError).toBeNull();
  expect(button(el, "save").disabled).toBe(false);
  await press(el, "undo");
  // m2 has no placement, so the canvas never draws it; a quiet Save means the draft is as opened.
  expect(button(el, "save").disabled).toBe(true);
});

it("a booked table's name is shown as typed, whatever characters it holds", async () => {
  const odd: FloorPlan = {
    ...plan(),
    tables: plan().tables.map((t) => (t.id === "m2" ? { ...t, label: "T$&{message}$'" } : t)),
  };
  const el = await open(
    stubApi({
      getFloorPlan: vi.fn().mockResolvedValue(odd),
      saveFloorPlan: vi.fn().mockRejectedValue({ code: "table.booked", params: { tableId: "l2" } }),
    }),
  );
  await change(el, deleteTable(draftFromPlan(odd), "m2"));
  await press(el, "save");
  expect(message(el)).toBe(
    "T$&{message}$': This table has an upcoming booking. Move the booking first",
  );
});

it("a booked table the opened plan does not hold shows the code's own sentence", async () => {
  const el = await open(refusing({ code: "table.booked", params: { tableId: "l7" } }));
  await change(el, deleteTable(opened(), "m2"));
  await press(el, "save");
  expect(message(el)).toBe("This table has an upcoming booking. Move the booking first");
});

it("a failure with no field shows the server's sentence and leaves Save enabled", async () => {
  const el = await open(refusing({ code: "server.internal" }));
  await change(el, moveTable(opened(), "m1", 5, 4));
  await press(el, "save");
  expect(message(el)).toBe("Something went wrong, try again");
  expect(el.fieldError).toBeNull();
  expect(canvas(el).selected).toBeNull();
  expect(button(el, "save").disabled).toBe(false);
});

it("an empty name stops the save, selects its table and keeps Save disabled until fixed", async () => {
  const api = stubApi();
  const el = await open(api);
  await change(el, renamed(opened(), "m2", "  "));
  await press(el, "save");
  expect(api.saveFloorPlan).not.toHaveBeenCalled();
  expect(canvas(el).selected).toBe("m2");
  expect(el.fieldError).toEqual({ key: "m2", field: "label", message: "Enter a name." });
  expect(message(el)).toBe("Correct the highlighted fields to continue.");
  expect(button(el, "save").disabled).toBe(true);
  await change(el, renamed(opened(), "m2", "T2b"));
  expect(button(el, "save").disabled).toBe(false);
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("");
});

it("an empty name is told in Spanish", async () => {
  const el = await open(stubApi());
  setLocale("es-ES");
  await change(el, renamed(opened(), "m2", ""));
  await press(el, "save");
  expect(el.fieldError?.message).toBe("Escribe un nombre.");
});

it("a repeated name stops the save the same way", async () => {
  const api = stubApi();
  const el = await open(api);
  await change(el, renamed(opened(), "live:l9", "T1"));
  await press(el, "save");
  expect(api.saveFloorPlan).not.toHaveBeenCalled();
  expect(canvas(el).selected).toBe("live:l9");
  expect(el.fieldError).toEqual({
    key: "live:l9",
    field: "label",
    message: "A table with that name already exists",
  });
  expect(button(el, "save").disabled).toBe(true);
});

it("a fix that leaves another name failing moves the mark to it", async () => {
  const el = await open(stubApi());
  const both = renamed(renamed(opened(), "m2", ""), "live:l9", "T1");
  await change(el, both);
  await press(el, "save");
  expect(el.fieldError?.key).toBe("m2");
  await change(el, renamed(both, "m2", "T2"));
  expect(el.fieldError?.key).toBe("live:l9");
  expect(canvas(el).selected).toBe("live:l9");
  expect(button(el, "save").disabled).toBe(true);
});

it("typing into the marked table keeps the mark there while its name repeats another", async () => {
  const el = await open(stubApi());
  const start = renamed(renamed(opened(), "m1", ""), "live:l9", "T");
  await change(el, start);
  await press(el, "save");
  expect(el.fieldError?.key).toBe("m1");
  await change(el, renamed(start, "m1", "T"));
  expect(el.fieldError).toEqual({
    key: "m1",
    field: "label",
    message: "A table with that name already exists",
  });
  expect(canvas(el).selected).toBe("m1");
  expect(button(el, "save").disabled).toBe(true);
  await change(el, renamed(start, "m1", "T1"));
  expect(el.fieldError).toBeNull();
  expect(canvas(el).selected).toBe("m1");
  expect(button(el, "save").disabled).toBe(false);
});

it("once the marked table passes, the mark and selection move to the next empty name", async () => {
  const el = await open(stubApi());
  const start = renamed(renamed(opened(), "m1", ""), "m2", "");
  await change(el, start);
  await press(el, "save");
  expect(el.fieldError?.key).toBe("m1");
  await change(el, renamed(start, "m1", "T"));
  expect(el.fieldError).toEqual({ key: "m2", field: "label", message: "Enter a name." });
  expect(canvas(el).selected).toBe("m2");
});

it("deleting the marked table moves the mark to the next failing name", async () => {
  const el = await open(stubApi());
  const start = renamed(renamed(opened(), "m2", ""), "live:l9", "T1");
  await change(el, start);
  await press(el, "save");
  expect(el.fieldError?.key).toBe("m2");
  await change(el, deleteTable(start, "m2"));
  expect(el.fieldError?.key).toBe("live:l9");
  expect(canvas(el).selected).toBe("live:l9");
});

it("the next change to the refused field clears its sentence", async () => {
  const el = await open(refusing(taken));
  const patio = renamed(opened(), "m2", "Patio 1");
  await change(el, patio);
  await press(el, "save");
  await change(el, patchTable(patio, "m2", { seats: 3 }));
  expect(el.fieldError).not.toBeNull();
  await change(el, renamed(patio, "m2", "Patio 2"));
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("");
});

it("Undo that changes the refused field clears its sentence", async () => {
  const el = await open(refusing(taken));
  await change(el, renamed(opened(), "m2", "Patio 1"));
  await press(el, "save");
  await press(el, "undo");
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("");
});

it("the next Save clears a refusal's mark", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValueOnce(taken)
    .mockReturnValue(new Promise(() => {}));
  const el = await open(stubApi({ saveFloorPlan }));
  await change(el, renamed(opened(), "m2", "Patio 1"));
  await press(el, "save");
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(2);
  expect(el.fieldError).toBeNull();
  expect(message(el)).toBe("");
});

it("Save does not send while a Load newer plan read is pending", async () => {
  const newer = deferred<FloorPlan>();
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValue({ code: "floor_plan.out_of_date", params: { zoneId: "z1", revision: 4 } });
  const getFloorPlan = vi.fn().mockResolvedValueOnce(plan()).mockReturnValueOnce(newer.promise);
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await change(el, moveTable(opened(), "m1", 5, 4));
  await press(el, "save");
  await press(el, "load-newer");
  expect(button(el, "save").disabled).toBe(true);
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(1);
  newer.resolve({ ...plan(), revision: 4 });
  await flush(el);
  await change(el, moveTable(opened(), "m1", 6, 4));
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(2);
  expect(saveFloorPlan.mock.calls[1]![1].revision).toBe(4);
});

it("a save still pending on one zone does not stop Save on the next", async () => {
  const saveFloorPlan = vi.fn().mockReturnValue(new Promise(() => {}));
  const bar: FloorPlan = { ...plan(), zoneId: "z2", tables: [plan().tables[0]!], joins: [] };
  const getFloorPlan = vi.fn((zoneId: string) => Promise.resolve(zoneId === "z2" ? bar : plan()));
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await change(el, moveTable(opened(), "m1", 5, 4));
  await press(el, "save");
  history.pushState(null, "", "/manage/floor-plan/zone/z2");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  await change(el, moveTable(draftFromPlan(bar), "m1", 9, 4));
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(2);
  expect(saveFloorPlan.mock.calls[1]![0]).toBe("z2");
});

it("at 390 px a refusal that selects a table opens the sheet", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 844);
  onTestFinished(() => page.viewport(...before));
  const el = await open(refusing({ code: "table.label_taken", params: { label: "Patio 2" } }));
  const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
  await expect.poll(sheet).not.toBeNull();
  expect(sheet()!.expanded).toBe(false);
  await change(el, renamed(opened(), "m2", "Patio 2"));
  await press(el, "save");
  expect(canvas(el).selected).toBe("m2");
  expect(sheet()!.expanded).toBe(true);
});

it("at 390 px the editor's own name check opens the sheet on the table it selects", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 844);
  onTestFinished(() => page.viewport(...before));
  const el = await open(stubApi());
  const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
  await expect.poll(sheet).not.toBeNull();
  await change(el, renamed(opened(), "m2", "T1"));
  await press(el, "save");
  expect(canvas(el).selected).toBe("m2");
  expect(sheet()!.expanded).toBe(true);
});

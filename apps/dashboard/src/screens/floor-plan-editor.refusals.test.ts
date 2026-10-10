import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@waitron/dashboard-modules";
import type { WtButton, WtFloorPlanCanvas, WtSheet } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-editor.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";
import type { FloorPlanTablesPanel } from "./floor-plan-tables-panel.js";
import type { DashboardApi, FloorPlan } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  addTables,
  deleteTable,
  draftFromPlan,
  moveTable,
  patchTable,
  rotateTable,
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

const booked = (params: Record<string, unknown>) => ({ code: "table.booked", params });

/** The plan with m2 placed, away from m1. */
function placedM2(): FloorPlan {
  return {
    ...plan(),
    tables: plan().tables.map((t) =>
      t.id === "m2" ? { ...t, placement: { ...placement, x: 20, shape: "round" as const } } : t,
    ),
  };
}

function openPlaced(saveFloorPlan: DashboardApi["saveFloorPlan"]): Promise<FloorPlanEditor> {
  return open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(placedM2()), saveFloorPlan }));
}

const drawn = (el: FloorPlanEditor, key: string) => canvas(el).tables.find((t) => t.key === key);
const panelRow = (el: FloorPlanEditor, key: string) =>
  el
    .shadowRoot!.querySelector("floor-plan-tables-panel")!
    .shadowRoot!.querySelector<HTMLElement>(`wt-button[data-table="${key}"]`);

it("a booked table the draft deleted comes back as opened, marked with its booking, and selected", async () => {
  const el = await openPlaced(
    vi.fn().mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
  );
  await change(el, moveTable(deleteTable(draftFromPlan(placedM2()), "m2"), "m1", 5, 4));
  expect(drawn(el, "m2")).toBeUndefined();
  await press(el, "save");
  expect(drawn(el, "m2")).toEqual({
    key: "m2",
    label: "T2",
    fixed: true,
    placement: { ...placement, x: 20, shape: "round" },
    refused: "Booked 12 Oct, 21:00",
  });
  expect(drawn(el, "m1")?.refused).toBeUndefined();
  expect(canvas(el).selected).toBe("m2");
  expect(message(el)).toBe("");
  expect(el.fieldError).toBeNull();
  expect(button(el, "save").disabled).toBe(false);
  await press(el, "undo");
  expect(drawn(el, "m2")).toBeUndefined();
  await press(el, "redo");
  expect(drawn(el, "m2")?.refused).toBeUndefined();
});

it("at 390 px a booked table comes back above the sheet the refusal opens, with its reason", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 844);
  onTestFinished(() => page.viewport(...before));
  const low: FloorPlan = {
    ...plan(),
    tables: plan().tables.map((t) =>
      t.id === "m2" ? { ...t, placement: { ...placement, y: 40 } } : t,
    ),
  };
  const el = await open(
    stubApi({
      getFloorPlan: vi.fn().mockResolvedValue(low),
      saveFloorPlan: vi
        .fn()
        .mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
    }),
  );
  const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
  await expect.poll(sheet).not.toBeNull();
  await change(el, deleteTable(draftFromPlan(low), "m2"));
  await press(el, "save");
  expect(sheet()!.expanded).toBe(true);
  const root = canvas(el).shadowRoot!;
  const reason = () => root.querySelector(".refused-reason[data-key=m2]")!.getBoundingClientRect();
  const box = () => root.querySelector("button[data-key=m2]")!.getBoundingClientRect();
  await expect.poll(() => reason().bottom <= sheet()!.getBoundingClientRect().top + 0.5).toBe(true);
  expect(reason().top).toBeGreaterThanOrEqual(box().bottom);
  expect(box().top).toBeGreaterThanOrEqual(
    Math.max(0, root.querySelector(".viewport")!.getBoundingClientRect().top) - 0.5,
  );
  expect(window.scrollY).toBe(0);
  expect(
    el.shadowRoot!.querySelector("wt-button[data-action=save]")!.getBoundingClientRect().top,
  ).toBeGreaterThanOrEqual(0);
});

it("at 390 px a booked refusal of the selected table with the sheet already open lifts its reason above the sheet", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 844);
  onTestFinished(() => page.viewport(...before));
  const low: FloorPlan = {
    ...plan(),
    tables: plan().tables.map((t) =>
      t.id === "m2" ? { ...t, placement: { ...placement, y: 40 } } : t,
    ),
  };
  const el = await open(
    stubApi({
      getFloorPlan: vi.fn().mockResolvedValue(low),
      saveFloorPlan: vi
        .fn()
        .mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
    }),
  );
  const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
  await expect.poll(sheet).not.toBeNull();
  sheet()!.shadowRoot!.querySelector<HTMLElement>("button")!.click();
  await el.updateComplete;
  canvas(el).dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key: "m2" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const root = canvas(el).shadowRoot!;
  const box = () => root.querySelector("button[data-key=m2]")!.getBoundingClientRect();
  await expect.poll(() => box().bottom <= sheet()!.getBoundingClientRect().top + 0.5).toBe(true);
  await change(el, deleteTable(draftFromPlan(low), "m2"));
  await press(el, "save");
  expect(sheet()!.expanded).toBe(true);
  expect(canvas(el).selected).toBe("m2");
  const reason = () => root.querySelector(".refused-reason[data-key=m2]")?.getBoundingClientRect();
  await expect.poll(() => reason()).toBeDefined();
  await expect
    .poll(() => reason()!.bottom <= sheet()!.getBoundingClientRect().top + 0.5)
    .toBe(true);
  expect(window.scrollY).toBe(0);
});

it("a booked table's mark goes at the next Save, which sends it back", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValueOnce(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" }))
    .mockReturnValue(new Promise(() => {}));
  const el = await openPlaced(saveFloorPlan);
  await change(el, moveTable(deleteTable(draftFromPlan(placedM2()), "m2"), "m1", 5, 4));
  await press(el, "save");
  expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(2);
  expect(saveFloorPlan.mock.calls[1]![1].tables.map((t: { key: string }) => t.key)).toEqual([
    "m1",
    "live:l9",
    "m2",
  ]);
  expect(saveFloorPlan.mock.calls[1]![1].joins).toEqual([{ seats: 6, tableKeys: ["m1", "m2"] }]);
  expect(drawn(el, "m2")?.refused).toBeUndefined();
});

it("a booked table's mark goes when it is moved, rotated, edited or deleted again, not when another changes", async () => {
  const el = await openPlaced(
    vi.fn().mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
  );
  const refusedOnce = async (): Promise<FloorPlanDraft> => {
    await change(el, deleteTable(draftFromPlan(placedM2()), "m2"));
    await press(el, "save");
    expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
    return el["draft"]!;
  };
  let restored = await refusedOnce();
  await change(el, moveTable(restored, "m1", 9, 9));
  expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
  for (const edit of [
    (d: FloorPlanDraft) => moveTable(d, "m2", 30, 4),
    (d: FloorPlanDraft) => rotateTable(d, "m2", 90),
    (d: FloorPlanDraft) => patchTable(d, "m2", { seats: 3 }),
    (d: FloorPlanDraft) => deleteTable(d, "m2"),
  ]) {
    await change(el, edit(restored));
    expect(drawn(el, "m2")?.refused).toBeUndefined();
    expect(panelRow(el, "m2")?.textContent?.trim() ?? "gone").not.toContain("Booked");
    restored = await refusedOnce();
  }
});

it("a booked table whose delete was the only change comes back with its join, leaving Save quiet", async () => {
  const el = await openPlaced(
    vi.fn().mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
  );
  await change(el, deleteTable(draftFromPlan(placedM2()), "m2"));
  await press(el, "save");
  expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
  expect(el["draft"]!.joins).toEqual([{ key: "j1", seats: 6, tableKeys: ["m1", "m2"] }]);
  expect(button(el, "save").disabled).toBe(true);
});

it("a booked table taken out of a join of three, as the only change, leaves Save quiet when it comes back", async () => {
  const three: FloorPlan = {
    ...placedM2(),
    tables: [
      ...placedM2().tables,
      { id: "m3", liveTableId: "l3", label: "T3", seats: 2, fixed: false, placement: null },
    ],
    joins: [{ id: "j1", seats: 8, tableIds: ["m1", "m2", "m3"] }],
  };
  const el = await open(
    stubApi({
      getFloorPlan: vi.fn().mockResolvedValue(three),
      saveFloorPlan: vi
        .fn()
        .mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
    }),
  );
  await change(el, deleteTable(draftFromPlan(three), "m2"));
  expect(el["draft"]!.joins).toEqual([{ key: "j1", seats: 8, tableKeys: ["m1", "m3"] }]);
  await press(el, "save");
  expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
  expect(el["draft"]!.joins).toEqual([{ key: "j1", seats: 8, tableKeys: ["m1", "m2", "m3"] }]);
  expect(button(el, "save").disabled).toBe(true);
});

it("a booked table comes back as last saved when the re-read after that save failed", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockResolvedValueOnce({ revision: 4, ids: {} })
    .mockRejectedValueOnce(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" }));
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(placedM2())
    .mockRejectedValue({ code: "server.internal" });
  const el = await open(stubApi({ getFloorPlan, saveFloorPlan }));
  const moved = moveTable(draftFromPlan(placedM2()), "m2", 30, 10);
  await change(el, moved);
  await press(el, "save");
  await change(el, deleteTable(moved, "m2"));
  await press(el, "save");
  expect(drawn(el, "m2")?.placement).toMatchObject({ x: 30, y: 10 });
  expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
  expect(button(el, "save").disabled).toBe(true);
});

it("the tables list is handed the same refused value until the mark changes", async () => {
  const el = await openPlaced(
    vi.fn().mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
  );
  const panel = () =>
    el.shadowRoot!.querySelector<FloorPlanTablesPanel>("floor-plan-tables-panel")!;
  await change(el, moveTable(deleteTable(draftFromPlan(placedM2()), "m2"), "m1", 5, 4));
  await press(el, "save");
  const first = panel().refused;
  expect(first).toEqual({ key: "m2", reason: "Booked 12 Oct, 21:00" });
  canvas(el).dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key: "m1" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(canvas(el).selected).toBe("m1");
  expect(panel().refused).toBe(first);
  setLocale("es-ES");
  await el.updateComplete;
  expect(panel().refused).toEqual({ key: "m2", reason: "Reservada el 12 oct, 21:00" });
});

it("Reload clears a booked table's mark", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" }));
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(placedM2())
    .mockResolvedValue({ ...placedM2(), revision: 4 });
  const el = await open(stubApi({ getFloorPlan, saveFloorPlan }));
  await change(el, moveTable(deleteTable(draftFromPlan(placedM2()), "m2"), "m1", 5, 4));
  await press(el, "save");
  expect(drawn(el, "m2")?.refused).toBe("Booked 12 Oct, 21:00");
  saveFloorPlan.mockRejectedValueOnce({
    code: "floor_plan.out_of_date",
    params: { zoneId: "z1", revision: 4 },
  });
  await press(el, "save");
  await press(el, "load-newer");
  expect(drawn(el, "m2")).toMatchObject({ key: "m2" });
  expect(drawn(el, "m2")?.refused).toBeUndefined();
});

it("a booked table's reason is told in Spanish", async () => {
  setLocale("es-ES");
  const el = await openPlaced(
    vi.fn().mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
  );
  await change(el, deleteTable(draftFromPlan(placedM2()), "m2"));
  await press(el, "save");
  expect(drawn(el, "m2")?.refused).toBe("Reservada el 12 oct, 21:00");
});

it("a booked table refused with no date or time is marked with the code's own sentence", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValueOnce(booked({ tableId: "l2" }))
    .mockRejectedValueOnce(booked({ tableId: "l2", time: "21:00" }));
  const el = await openPlaced(saveFloorPlan);
  const sentence = "This table has an upcoming booking. Move the booking first";
  for (let i = 0; i < 2; i++) {
    await change(el, deleteTable(draftFromPlan(placedM2()), "m2"));
    await press(el, "save");
    expect(drawn(el, "m2")?.refused).toBe(sentence);
    expect(message(el)).toBe("");
  }
});

it("a deleted unplaced table that is refused comes back in the tables list with its reason", async () => {
  const el = await open(refusing(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })));
  await change(el, deleteTable(opened(), "m2"));
  expect(panelRow(el, "m2")).toBeNull();
  await press(el, "save");
  expect(panelRow(el, "m2")!.textContent!.trim()).toBe("T2 — Booked 12 Oct, 21:00");
  expect(panelRow(el, "m1")!.textContent!.trim()).toBe("T1");
  expect(drawn(el, "m2")).toBeUndefined();
  expect(message(el)).toBe("");
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

it("Save does not send while a Reload read is pending", async () => {
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

it("at 390 px a booked table put back opens the sheet on it", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 844);
  onTestFinished(() => page.viewport(...before));
  const el = await openPlaced(
    vi.fn().mockRejectedValue(booked({ tableId: "l2", date: "2026-10-12", time: "21:00" })),
  );
  const sheet = () => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");
  await expect.poll(sheet).not.toBeNull();
  await change(el, deleteTable(draftFromPlan(placedM2()), "m2"));
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

const tablePanel = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["floor-plan-table-panel"]>(
    "floor-plan-table-panel",
  )!;
const panelField = (el: FloorPlanEditor, name: string) =>
  tablePanel(el).shadowRoot!.querySelector<HTMLElement & { error: string; value: string }>(
    `[name=${name}]`,
  )!;

it("a taken name from Save shows under the table's name field", async () => {
  const el = await open(refusing(taken));
  await change(el, renamed(opened(), "m2", "Patio 1"));
  await press(el, "save");
  expect(tablePanel(el).tableKey).toBe("m2");
  expect(panelField(el, "table-name").error).toBe("A table with that name already exists");
  expect(panelField(el, "seats").error).toBe("");
});

it("a refusal shows only on the table it names, and comes back with it", async () => {
  const el = await open(refusing(invalid("tables.1.seats")));
  await change(el, patchTable(opened(), "m2", { seats: 5 }));
  await press(el, "save");
  expect(panelField(el, "seats").error).toBe("Check the floor plan's tables and try again");
  canvas(el).dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key: "m1" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(tablePanel(el).tableKey).toBe("m1");
  expect(tablePanel(el).fieldErrors).toEqual([]);
  expect(panelField(el, "seats").error).toBe("");
  canvas(el).dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key: "m2" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(panelField(el, "seats").error).toBe("Check the floor plan's tables and try again");
});

/** Types as a person does: one input event per character, after clearing the field. */
async function typeIntoPanel(el: FloorPlanEditor, name: string, keys: string): Promise<void> {
  const input = panelField(el, name).shadowRoot!.querySelector("input")!;
  await userEvent.clear(input);
  await userEvent.type(input, keys);
  await el.updateComplete;
  await tablePanel(el).updateComplete;
}

/** Wide enough for the side panel, so typing reaches a field a collapsed sheet would hide. */
async function wide(): Promise<void> {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(1280, 800);
  onTestFinished(() => page.viewport(...before));
}

async function select(el: FloorPlanEditor, key: string): Promise<void> {
  canvas(el).dispatchEvent(
    new CustomEvent("wt-table-select", { detail: { key }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("a seat count typed past 999 disables Save and says so until it is fixed", async () => {
  await wide();
  const api = stubApi();
  const el = await open(api);
  await select(el, "m1");
  await typeIntoPanel(el, "seats", "1000");
  expect(panelField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(panelField(el, "seats").value).toBe("1000");
  expect(message(el)).toBe("Correct the highlighted fields to continue.");
  expect(button(el, "save").disabled).toBe(true);
  await press(el, "save");
  expect(api.saveFloorPlan).not.toHaveBeenCalled();
  const input = panelField(el, "seats").shadowRoot!.querySelector("input")!;
  await userEvent.type(input, "{Backspace}{Backspace}");
  await el.updateComplete;
  expect(panelField(el, "seats").error).toBe("");
  expect(message(el)).toBe("");
  expect(button(el, "save").disabled).toBe(false);
  await press(el, "save");
  expect(vi.mocked(api.saveFloorPlan).mock.calls[0]![1].tables[0]!.seats).toBe(10);
});

it("a width with a fraction is refused and keeps Save disabled", async () => {
  await wide();
  const el = await open(stubApi());
  await select(el, "m1");
  await typeIntoPanel(el, "width", "1.5");
  expect(panelField(el, "width").error).toBe("Enter 1 to 99.");
  expect(panelField(el, "width").value).toBe("1.5");
  expect(button(el, "save").disabled).toBe(true);
});

it("Undo of another field clears a typed refusal and shows the draft's value", async () => {
  await wide();
  const el = await open(stubApi());
  await select(el, "m1");
  await typeIntoPanel(el, "seats", "1000");
  await typeIntoPanel(el, "table-name", "Patio");
  expect(panelField(el, "seats").error).toBe("Enter 0 to 999.");
  await press(el, "undo");
  await tablePanel(el).updateComplete;
  expect(el.fieldError).toBeNull();
  expect(panelField(el, "seats").error).toBe("");
  expect(panelField(el, "seats").value).toBe("100");
  expect(button(el, "save").disabled).toBe(false);
});

it("a typed refusal stays on its table while another is selected", async () => {
  await wide();
  const el = await open(stubApi());
  await select(el, "m1");
  await typeIntoPanel(el, "seats", "1000");
  await select(el, "m2");
  expect(panelField(el, "seats").error).toBe("");
  expect(button(el, "save").disabled).toBe(true);
  await select(el, "m1");
  expect(panelField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(panelField(el, "seats").value).toBe("1000");
});

it("a second refused field keeps the first's refused text and reason, and Save waits for both", async () => {
  await wide();
  const api = stubApi();
  const el = await open(api);
  await select(el, "m1");
  await typeIntoPanel(el, "seats", "1000");
  await typeIntoPanel(el, "width", "1.5");
  expect(panelField(el, "seats").value).toBe("1000");
  expect(panelField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(panelField(el, "width").value).toBe("1.5");
  expect(panelField(el, "width").error).toBe("Enter 1 to 99.");
  expect(button(el, "save").disabled).toBe(true);
  await typeIntoPanel(el, "width", "9");
  expect(panelField(el, "width").error).toBe("");
  expect(panelField(el, "seats").value).toBe("1000");
  expect(panelField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(message(el)).toBe("Correct the highlighted fields to continue.");
  expect(button(el, "save").disabled).toBe(true);
  await typeIntoPanel(el, "seats", "12");
  expect(message(el)).toBe("");
  expect(button(el, "save").disabled).toBe(false);
  await press(el, "save");
  const sent = vi.mocked(api.saveFloorPlan).mock.calls[0]![1].tables[0]!;
  expect([sent.seats, sent.placement!.width]).toEqual([12, 9]);
});

it("a refused field typed into a new table while it is saved stays marked under its master id", async () => {
  await wide();
  const write = deferred<{ revision: number; ids: Record<string, string> }>();
  const el = await open(
    stubApi({
      saveFloorPlan: vi.fn().mockReturnValue(write.promise),
      getFloorPlan: vi
        .fn()
        .mockResolvedValueOnce(plan())
        .mockReturnValue(new Promise(() => {})),
    }),
  );
  await change(el, withT5());
  await select(el, "new:1");
  await press(el, "save");
  await typeIntoPanel(el, "seats", "1000");
  write.resolve({ revision: 4, ids: { m1: "m1", m2: "m2", "live:l9": "m9", "new:1": "m5" } });
  await flush(el);
  await tablePanel(el).updateComplete;
  expect(tablePanel(el).tableKey).toBe("m5");
  expect(panelField(el, "seats").value).toBe("1000");
  expect(panelField(el, "seats").error).toBe("Enter 0 to 999.");
  expect(button(el, "save").disabled).toBe(true);
});

it("a table saved new while other edits were made comes back when its delete is refused as booked", async () => {
  await wide();
  const write = deferred<{ revision: number; ids: Record<string, string> }>();
  const reread = deferred<FloorPlan>();
  const t5 = { ...placement, x: 20 };
  const afterSave: FloorPlan = {
    ...plan(),
    revision: 4,
    tables: [
      ...plan().tables.slice(0, 2),
      { id: "m9", liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
      { id: "m5", liveTableId: "l5", label: "T5", seats: 2, fixed: false, placement: t5 },
    ],
  };
  const saveFloorPlan = vi
    .fn()
    .mockReturnValueOnce(write.promise)
    .mockRejectedValueOnce(booked({ tableId: "l5", date: "2026-10-12", time: "21:00" }));
  const getFloorPlan = vi.fn().mockResolvedValueOnce(plan()).mockReturnValueOnce(reread.promise);
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  const added = patchTable(withT5(), "new:1", { placement: t5 });
  await change(el, added);
  await press(el, "save");
  await change(el, moveTable(added, "m1", 5, 4));
  write.resolve({ revision: 4, ids: { m1: "m1", m2: "m2", "live:l9": "m9", "new:1": "m5" } });
  await flush(el);
  reread.resolve(afterSave);
  await flush(el);
  expect(button(el, "save").disabled).toBe(false);
  await select(el, "m5");
  await tablePanel(el).updateComplete;
  tablePanel(el).shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=delete]")!.click();
  await el.updateComplete;
  expect(drawn(el, "m5")).toBeUndefined();
  await press(el, "save");
  expect(drawn(el, "m5")?.refused).toBe("Booked 12 Oct, 21:00");
  expect(canvas(el).selected).toBe("m5");
  expect(message(el)).toBe("");
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WtButton, WtFloorPlanCanvas } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-editor.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";
import type { DashboardApi, FloorPlan } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  addTables,
  draftFromPlan,
  moveTable,
  patchTable,
  rekeyDraft,
  saveFromDraft,
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

const m1Placement = { x: 2, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };
const t5Placement = { x: 20, y: 3, width: 8, height: 8, shape: "rect" as const, rotation: 0 };

function plan(m1x = 2): FloorPlan {
  return {
    zoneId: "z1",
    revision: 3,
    savedAt: "2026-10-01T10:00:00.000Z",
    tables: [
      {
        id: "m1",
        liveTableId: "l1",
        label: "T1",
        seats: 4,
        fixed: false,
        placement: { ...m1Placement, x: m1x },
      },
      { id: "m2", liveTableId: "l2", label: "T2", seats: 2, fixed: true, placement: null },
      { id: null, liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
    ],
    joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
  };
}

const savedIds = { m1: "m1", m2: "m2", "live:l9": "m9" };

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
    saveFloorPlan: vi.fn().mockResolvedValue({ revision: 4, ids: savedIds }),
    ...overrides,
  } as unknown as DashboardApi;
}

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
  el.shadowRoot!.querySelector<WtButton>(`wt-button[data-action=${action}]`);
const placed = (el: FloorPlanEditor, key: string) =>
  canvas(el).tables.find((t) => t.key === key)!.placement!;
const message = (el: FloorPlanEditor) => el.shadowRoot!.querySelector("wt-form-actions")!.error;

async function fromCanvas(el: FloorPlanEditor, type: string, detail: unknown): Promise<void> {
  canvas(el).dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  await el.updateComplete;
}

async function move(el: FloorPlanEditor, key: string, x: number, y = 4): Promise<void> {
  await fromCanvas(el, "wt-table-move", { key, x, y });
}

async function press(el: FloorPlanEditor, action: string): Promise<void> {
  button(el, action)!.click();
  await flush(el);
}

function expectSave(el: FloorPlanEditor, look: "quiet" | "awake"): void {
  expect(button(el, "save")!.variant).toBe(look === "quiet" ? "secondary" : "primary");
  expect(button(el, "save")!.disabled).toBe(look === "quiet");
}

function withT5(label = "T5"): FloorPlanDraft {
  let n = 0;
  const added = addTables(
    draftFromPlan(plan()),
    [{ label, seats: 2, fixed: false }],
    () => `new:${++n}`,
  );
  return patchTable(added, "new:1", { placement: t5Placement });
}

it("a press that reaches an untouched Save's handler sends nothing and shows nothing", async () => {
  const api = stubApi();
  const el = await open(api);
  // A host `.click()` reaches the listener even while the inner button is disabled.
  await press(el, "save");
  expect(api.saveFloorPlan).not.toHaveBeenCalled();
  expect(message(el)).toBe("");
});

it("Save sends the draft with a key per table and joins as keys", async () => {
  const api = stubApi();
  const el = await open(api);
  await move(el, "m1", 5);
  await press(el, "save");
  const moved = moveTable(draftFromPlan(plan()), "m1", 5, 4);
  expect(api.saveFloorPlan).toHaveBeenCalledWith("z1", saveFromDraft(3, moved));
  const body = vi.mocked(api.saveFloorPlan).mock.calls[0]![1];
  expect(body.tables[0]!.placement!.x).toBe(5);
  expect(body.joins).toEqual([{ seats: 6, tableKeys: ["m1", "m2"] }]);
});

it("a save marks the sent draft saved at once and reads the plan again", async () => {
  const reread = deferred<FloorPlan>();
  const getFloorPlan = vi.fn().mockResolvedValueOnce(plan()).mockReturnValueOnce(reread.promise);
  const api = stubApi({ getFloorPlan });
  const el = await open(api);
  await move(el, "m1", 5);
  await press(el, "save");
  expectSave(el, "quiet");
  expect(button(el, "undo")!.disabled).toBe(true);
  reread.resolve(plan(5));
  await flush(el);
  expect(getFloorPlan).toHaveBeenCalledTimes(2);
  expect(placed(el, "m1").x).toBe(5);
  expectSave(el, "quiet");
});

it("an edit made while the save is pending is kept, and Save stays active", async () => {
  const write = deferred<{ revision: number; ids: Record<string, string> }>();
  const api = stubApi({ saveFloorPlan: vi.fn().mockReturnValue(write.promise) });
  const el = await open(api);
  await move(el, "m1", 5);
  await press(el, "save");
  await move(el, "m1", 7);
  write.resolve({ revision: 4, ids: savedIds });
  await flush(el);
  expect(placed(el, "m1").x).toBe(7);
  expectSave(el, "awake");
  expect(button(el, "undo")!.disabled).toBe(true);
});

it("a selected new table keeps its selection under its master id", async () => {
  const api = stubApi({
    saveFloorPlan: vi.fn().mockResolvedValue({ revision: 4, ids: { ...savedIds, "new:1": "m5" } }),
    getFloorPlan: vi
      .fn()
      .mockResolvedValueOnce(plan())
      .mockReturnValueOnce(new Promise(() => {})),
  });
  const el = await open(api);
  await fromCanvas(el, "floor-plan-change", { draft: withT5() });
  await fromCanvas(el, "floor-plan-select", { key: "new:1" });
  await press(el, "save");
  expect(canvas(el).selected).toBe("m5");
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1", "m5"]);
});

it("a failed re-read after a save shows as a read's failure, and the next Save sends master ids", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockResolvedValue({ revision: 4, ids: { ...savedIds, "new:1": "m5" } });
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(plan())
    .mockRejectedValueOnce({ code: "server.internal" })
    .mockReturnValue(new Promise(() => {}));
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await fromCanvas(el, "floor-plan-change", { draft: withT5() });
  await press(el, "save");
  expect(message(el)).toBe("Something went wrong, try again");
  expectSave(el, "quiet");
  await move(el, "m5", 22);
  expect(message(el)).toBe("");
  await press(el, "save");
  const body = saveFloorPlan.mock.calls[1]![1] as ReturnType<typeof saveFromDraft>;
  expect(body.revision).toBe(4);
  expect(body.tables).toContainEqual(expect.objectContaining({ id: "m5", key: "m5", label: "T5" }));
  expect(body.tables).toContainEqual(expect.objectContaining({ id: "m9", key: "m9" }));
  expect(body.tables.every((t) => !/^(new|live):/.test(t.key))).toBe(true);
  expect(body.joins).toEqual([{ seats: 6, tableKeys: ["m1", "m2"] }]);
});

it("a first save's re-read gives a new table its live table", async () => {
  const first: FloorPlan = { ...plan(), revision: 0, savedAt: null };
  const after: FloorPlan = {
    ...plan(),
    revision: 1,
    tables: [
      ...plan().tables.slice(0, 2),
      { id: "m9", liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
      { id: "m5", liveTableId: "l5", label: "T5", seats: 2, fixed: false, placement: t5Placement },
    ],
  };
  const api = stubApi({
    getFloorPlan: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(after),
    saveFloorPlan: vi.fn().mockResolvedValue({ revision: 1, ids: { ...savedIds, "new:1": "m5" } }),
  });
  const el = await open(api);
  await fromCanvas(el, "floor-plan-change", { draft: withT5() });
  await press(el, "save");
  expectSave(el, "quiet");
  // The server's own plan, live table ids included, is now the saved state.
  await fromCanvas(el, "floor-plan-change", { draft: draftFromPlan(after) });
  expectSave(el, "quiet");
  expect(el.shadowRoot!.querySelector("[data-note]")!.textContent!.trim()).toBe(
    "Saved changes reach the till's tables when the next business day starts.",
  );
});

it("a label sent with spaces is saved trimmed, so trimming it by hand is no change", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockResolvedValue({ revision: 4, ids: { ...savedIds, "new:1": "m5" } });
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(plan())
    .mockReturnValue(new Promise(() => {}));
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await fromCanvas(el, "floor-plan-change", { draft: withT5(" T5 ") });
  await press(el, "save");
  const body = saveFloorPlan.mock.calls[0]![1] as ReturnType<typeof saveFromDraft>;
  expect(body.tables.find((t) => t.key === "new:1")!.label).toBe("T5");
  expectSave(el, "quiet");
  const typed = patchTable(rekeyDraft(withT5(" T5 "), { ...savedIds, "new:1": "m5" }), "m5", {
    label: "T5",
  });
  await fromCanvas(el, "floor-plan-change", { draft: typed });
  expectSave(el, "quiet");
});

it("a read's failure does not replace an action's message", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValueOnce({
      code: "floor_plan.out_of_date",
      params: { zoneId: "z1", revision: 4 },
    })
    .mockRejectedValueOnce({ code: "server.internal" });
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(plan())
    .mockRejectedValueOnce({ code: "connection.failed" });
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await move(el, "m1", 5);
  await press(el, "save");
  await press(el, "save");
  expect(message(el)).toBe("Something went wrong, try again");
  await press(el, "load-newer");
  expect(getFloorPlan).toHaveBeenCalledTimes(2);
  expect(message(el)).toBe("Something went wrong, try again");
  expect(placed(el, "m1").x).toBe(5);
});

it("a re-read answer does not replace a draft changed since the save", async () => {
  const reread = deferred<FloorPlan>();
  const getFloorPlan = vi.fn().mockResolvedValueOnce(plan()).mockReturnValueOnce(reread.promise);
  const el = await open(stubApi({ getFloorPlan }));
  await move(el, "m1", 5);
  await press(el, "save");
  await move(el, "m1", 7);
  reread.resolve(plan(5));
  await flush(el);
  expect(placed(el, "m1").x).toBe(7);
  expectSave(el, "awake");
});

it("a save in progress keeps a second press from sending", async () => {
  const write = deferred<{ revision: number; ids: Record<string, string> }>();
  const saveFloorPlan = vi.fn().mockReturnValue(write.promise);
  const el = await open(stubApi({ saveFloorPlan }));
  await move(el, "m1", 5);
  await press(el, "save");
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(1);
});

it("an older copy offers the newer plan, keeping Save available", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValue({ code: "floor_plan.out_of_date", params: { zoneId: "z1", revision: 4 } });
  const el = await open(stubApi({ saveFloorPlan }));
  expect(button(el, "load-newer")).toBeNull();
  await move(el, "m1", 5);
  await press(el, "save");
  expect(message(el)).toBe("Someone else changed this floor plan. Reload it and try again");
  expect(button(el, "load-newer")!.textContent!.trim()).toBe("Load newer plan");
  expectSave(el, "awake");
});

it("Load newer plan replaces the draft and writes nothing", async () => {
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValue({ code: "floor_plan.out_of_date", params: { zoneId: "z1", revision: 4 } });
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(plan())
    .mockResolvedValueOnce({ ...plan(7), revision: 4 });
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await move(el, "m1", 5);
  await press(el, "save");
  await press(el, "load-newer");
  expect(placed(el, "m1").x).toBe(7);
  expectSave(el, "quiet");
  expect(button(el, "undo")!.disabled).toBe(true);
  expect(button(el, "load-newer")).toBeNull();
  expect(message(el)).toBe("");
  expect(saveFloorPlan).toHaveBeenCalledTimes(1);
  await move(el, "m1", 9);
  await press(el, "save");
  expect(saveFloorPlan.mock.calls[1]![1].revision).toBe(4);
});

it("a save's answer that lands after Load newer plan began is ignored, and Save still sends", async () => {
  const write = deferred<{ revision: number; ids: Record<string, string> }>();
  const saveFloorPlan = vi
    .fn()
    .mockRejectedValueOnce({
      code: "floor_plan.out_of_date",
      params: { zoneId: "z1", revision: 4 },
    })
    .mockReturnValueOnce(write.promise)
    .mockResolvedValue({ revision: 5, ids: savedIds });
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(plan())
    .mockResolvedValueOnce({ ...plan(7), revision: 4 })
    .mockReturnValue(new Promise(() => {}));
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  await move(el, "m1", 5);
  await press(el, "save");
  await press(el, "save");
  await press(el, "load-newer");
  write.resolve({ revision: 9, ids: savedIds });
  await flush(el);
  expect(placed(el, "m1").x).toBe(7);
  expectSave(el, "quiet");
  await move(el, "m1", 9);
  await press(el, "save");
  expect(saveFloorPlan).toHaveBeenCalledTimes(3);
  expect(saveFloorPlan.mock.calls[2]![1].revision).toBe(4);
});

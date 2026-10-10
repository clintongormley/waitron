import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtButton, WtFloorPlanCanvas, WtModal, WtSheet } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-editor.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";
import type { DashboardApi, FloorPlan } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { addTables, draftFromPlan, patchTable, type FloorPlanDraft } from "./floor-plan-draft.js";

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

function terrace(revision = 3): FloorPlan {
  return {
    zoneId: "z1",
    revision,
    savedAt: revision === 0 ? null : "2026-10-01T10:00:00.000Z",
    tables: [
      { id: "m1", liveTableId: "l1", label: "T1", seats: 4, fixed: false, placement },
      { id: "m2", liveTableId: "l2", label: "T2", seats: 2, fixed: false, placement: null },
    ],
    joins: [],
  };
}

const bar: FloorPlan = {
  zoneId: "z2",
  revision: 1,
  savedAt: "2026-10-01T10:00:00.000Z",
  tables: [{ id: "b1", liveTableId: "l5", label: "B1", seats: 2, fixed: false, placement }],
  joins: [],
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getFloorPlan: vi.fn((zoneId: string) => Promise.resolve(zoneId === "z2" ? bar : terrace())),
    listZones: vi.fn().mockResolvedValue([
      { id: "z1", name: "Terrace", displayOrder: 0, active: true },
      { id: "z2", name: "Bar", displayOrder: 1, active: true },
    ]),
    listTables: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: FloorPlanEditor): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function open(
  api: DashboardApi = stubApi(),
  path = "/manage/floor-plan/zone/z1",
): Promise<FloorPlanEditor> {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<FloorPlanEditor>("dashboard-floor-plan-editor", { api });
  await flush(el);
  return el;
}

const canvas = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<WtFloorPlanCanvas>("wt-floor-plan-canvas")!;
const button = (el: FloorPlanEditor, action: string) =>
  el.shadowRoot!.querySelector<WtButton>(`wt-button[data-action=${action}]`)!;
const heading = (el: FloorPlanEditor) => el.shadowRoot!.querySelector("h1")!.textContent!.trim();
const placed = (el: FloorPlanEditor, key: string) =>
  canvas(el).tables.find((t) => t.key === key)!.placement;

async function fromCanvas(el: FloorPlanEditor, type: string, detail: unknown): Promise<void> {
  canvas(el).dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  await el.updateComplete;
}

async function press(el: FloorPlanEditor, action: string): Promise<void> {
  button(el, action).click();
  await el.updateComplete;
}

function expectSaveQuiet(el: FloorPlanEditor): void {
  expect(button(el, "save").variant).toBe("secondary");
  expect(button(el, "save").disabled).toBe(true);
}

function expectSaveAwake(el: FloorPlanEditor): void {
  expect(button(el, "save").variant).toBe("primary");
  expect(button(el, "save").disabled).toBe(false);
}

it("opens the zone the URL names, headed with its name", async () => {
  const api = stubApi();
  const el = await open(api);
  expect(api.getFloorPlan).toHaveBeenCalledWith("z1");
  expect(api.listTables).toHaveBeenCalledWith({ includeDisabled: true });
  expect(heading(el)).toBe("Terrace");
});

it("heads a zone the zone list lacks as Floor plan", async () => {
  const el = await open(stubApi({ listZones: vi.fn().mockResolvedValue([]) }));
  expect(heading(el)).toBe("Floor plan");
});

it("draws placed tables and leaves unplaced ones off the canvas", async () => {
  const el = await open();
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1"]);
  expect(canvas(el).tables[0]).toEqual({ key: "m1", label: "T1", fixed: false, placement });
});

it("says what a first save does, and when a saved plan's changes reach the till", async () => {
  const first = await open(
    stubApi({
      getFloorPlan: vi.fn().mockResolvedValue(terrace(0)) as DashboardApi["getFloorPlan"],
    }),
  );
  expect(first.shadowRoot!.querySelector("[data-note]")!.textContent!.trim()).toBe(
    "Your first save goes live now; later changes, tomorrow.",
  );
  cleanupWidgets();
  const saved = await open();
  expect(saved.shadowRoot!.querySelector("[data-note]")!.textContent!.trim()).toBe(
    "Your changes will go live tomorrow.",
  );
});

it("a move from the canvas changes the draft and wakes Save", async () => {
  const el = await open();
  expectSaveQuiet(el);
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  expect(placed(el, "m1")).toMatchObject({ x: 5, y: 4 });
  expectSaveAwake(el);
});

it("Undo puts the move back and quiets Save; Redo brings it back", async () => {
  const el = await open();
  expect(button(el, "undo").disabled).toBe(true);
  expect(button(el, "redo").disabled).toBe(true);
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  expect(button(el, "undo").disabled).toBe(false);
  await press(el, "undo");
  expect(placed(el, "m1")!.x).toBe(2);
  expectSaveQuiet(el);
  expect(button(el, "undo").disabled).toBe(true);
  expect(button(el, "redo").disabled).toBe(false);
  await press(el, "redo");
  expect(placed(el, "m1")!.x).toBe(5);
  expectSaveAwake(el);
  expect(button(el, "redo").disabled).toBe(true);
});

it("a change after Undo empties Redo", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  await press(el, "undo");
  await fromCanvas(el, "wt-table-rotate", { key: "m1", rotation: 90 });
  expect(button(el, "redo").disabled).toBe(true);
});

it("a turn from the canvas turns the table", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-rotate", { key: "m1", rotation: 90 });
  expect(placed(el, "m1")!.rotation).toBe(90);
  expectSaveAwake(el);
});

it("selecting a table is not a change", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  expect(canvas(el).selected).toBe("m1");
  expectSaveQuiet(el);
  expect(button(el, "undo").disabled).toBe(true);
});

it("a move of a table the draft does not have adds no step", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-move", { key: "m9", x: 5, y: 4 });
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  await press(el, "undo");
  expect(button(el, "undo").disabled).toBe(true);
});

it("takes a panel's change and merges typing", async () => {
  const el = await open();
  const d = draftFromPlan(terrace());
  await fromCanvas(el, "floor-plan-change", {
    draft: patchTable(d, "m1", { label: "T1a" }),
    mergeKey: "label:m1",
  });
  await fromCanvas(el, "floor-plan-change", {
    draft: patchTable(d, "m1", { label: "T1ab" }),
    mergeKey: "label:m1",
  });
  expect(canvas(el).tables[0]!.label).toBe("T1ab");
  await press(el, "undo");
  expect(canvas(el).tables[0]!.label).toBe("T1");
  expect(button(el, "undo").disabled).toBe(true);
});

it("takes a panel's selection", async () => {
  const el = await open();
  await fromCanvas(el, "floor-plan-select", { key: "m1" });
  expect(canvas(el).selected).toBe("m1");
  await fromCanvas(el, "floor-plan-select", { key: null });
  expect(canvas(el).selected).toBeNull();
});

it("Undo that removes the selected table clears the selection", async () => {
  const el = await open();
  let n = 0;
  const added: FloorPlanDraft = addTables(
    draftFromPlan(terrace()),
    [{ label: "T3", seats: 2, fixed: false }],
    () => `new:${++n}`,
  );
  await fromCanvas(el, "floor-plan-change", { draft: added });
  await fromCanvas(el, "floor-plan-select", { key: "new:1" });
  await press(el, "undo");
  expect(canvas(el).selected).toBeNull();
});

it("Undo keeps the selection of a table it does not remove", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  await press(el, "undo");
  expect(canvas(el).selected).toBe("m1");
});

it("another zone in the address loads that zone afresh", async () => {
  const api = stubApi();
  const el = await open(api);
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  history.pushState(null, "", "/manage/floor-plan/zone/z2");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  expect(api.getFloorPlan).toHaveBeenLastCalledWith("z2");
  expect(heading(el)).toBe("Bar");
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["b1"]);
  expect(canvas(el).selected).toBeNull();
  expect(button(el, "undo").disabled).toBe(true);
  expectSaveQuiet(el);
});

it("a late answer for the zone it left is dropped", async () => {
  let answerTerrace!: (plan: FloorPlan) => void;
  const api = stubApi({
    getFloorPlan: vi.fn((zoneId: string) =>
      zoneId === "z2"
        ? Promise.resolve(bar)
        : new Promise<FloorPlan>((resolve) => {
            answerTerrace = resolve;
          }),
    ) as DashboardApi["getFloorPlan"],
  });
  const el = await open(api);
  history.pushState(null, "", "/manage/floor-plan/zone/z2");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  expect(heading(el)).toBe("Bar");
  answerTerrace(terrace());
  await flush(el);
  expect(heading(el)).toBe("Bar");
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["b1"]);
});

it("a load failure shows its sentence and no canvas", async () => {
  const el = await open(
    stubApi({
      getFloorPlan: vi.fn().mockRejectedValue({ code: "zone.not_found" }),
    }),
  );
  expect(el.shadowRoot!.querySelector("[data-load-error]")!.textContent!.trim()).toBe(
    "That zone no longer exists",
  );
  expect(el.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
  expect(el.shadowRoot!.querySelector("a[data-action=close]")).not.toBeNull();
});

it("Close links to the way back, or to /manage when it is not a dashboard path", async () => {
  const close = (el: FloorPlanEditor) =>
    el.shadowRoot!.querySelector("a[data-action=close]")!.getAttribute("href");
  const back = await open(stubApi(), "/manage/floor-plan/zone/z1?back=%2Fmanage%2Foverview");
  expect(close(back)).toBe("/manage/overview");
  cleanupWidgets();
  const evil = await open(
    stubApi(),
    `/manage/floor-plan/zone/z1?back=${encodeURIComponent("https://evil.example/")}`,
  );
  expect(close(evil)).toBe("/manage");
  cleanupWidgets();
  const elsewhere = await open(stubApi(), "/manage/floor-plan/zone/z1?back=%2Flogin");
  expect(close(elsewhere)).toBe("/manage");
  cleanupWidgets();
  const none = await open();
  expect(close(none)).toBe("/manage");
});

it("takes its draft scope again when put back in the page", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-move", { key: "m1", x: 5, y: 4 });
  const parent = el.parentNode!;
  el.remove();
  await el.updateComplete;
  parent.append(el);
  await el.updateComplete;
  expectSaveAwake(el);
  await press(el, "undo");
  expectSaveQuiet(el);
});

it("names the canvas's fixed tables and turn handle in the dashboard's language", async () => {
  setLocale("es-ES");
  const plan = terrace();
  plan.tables[0] = { ...plan.tables[0]!, fixed: true };
  const el = await open(
    stubApi({ getFloorPlan: vi.fn().mockResolvedValue(plan) as DashboardApi["getFloorPlan"] }),
  );
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await canvas(el).updateComplete;
  const root = canvas(el).shadowRoot!;
  expect(root.querySelector(".table[data-key=m1]")!.getAttribute("aria-label")).toBe("T1, Fija");
  expect(root.querySelector(".rotate-handle")!.getAttribute("aria-label")).toBe("Girar T1");
});

it("a live language switch renames the canvas's fixed tables and turn handle", async () => {
  const plan = terrace();
  plan.tables[0] = { ...plan.tables[0]!, fixed: true };
  const el = await open(
    stubApi({ getFloorPlan: vi.fn().mockResolvedValue(plan) as DashboardApi["getFloorPlan"] }),
  );
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await canvas(el).updateComplete;
  const root = canvas(el).shadowRoot!;
  const marker = () => root.querySelector(".table[data-key=m1]")!.getAttribute("aria-label");
  const handle = () => root.querySelector(".rotate-handle")!.getAttribute("aria-label");
  expect([marker(), handle()]).toEqual(["T1, Fixed", "Rotate T1"]);
  setLocale("es-ES");
  await el.updateComplete;
  await canvas(el).updateComplete;
  expect(marker()).toBe("T1, Fija");
  expect(handle()).toBe("Girar T1");
});

it("a change of selection hands the canvas the same tables and copy", async () => {
  const el = await open();
  const tables = canvas(el).tables;
  const copy = canvas(el).copy;
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  expect(canvas(el).tables).toBe(tables);
  expect(canvas(el).copy).toBe(copy);
});

it("a late answer for a zone it left for no zone is dropped", async () => {
  let answerTerrace!: (plan: FloorPlan) => void;
  const api = stubApi({
    getFloorPlan: vi.fn(
      () =>
        new Promise<FloorPlan>((resolve) => {
          answerTerrace = resolve;
        }),
    ) as DashboardApi["getFloorPlan"],
  });
  const el = await open(api);
  history.pushState(null, "", "/manage/floor-plan");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  answerTerrace(terrace());
  await flush(el);
  expect(el.shadowRoot!.querySelector("wt-floor-plan-canvas")).toBeNull();
  expect(heading(el)).toBe("Floor plan");
});

it("a late failure for the zone it left is dropped", async () => {
  let failTerrace!: (error: unknown) => void;
  const api = stubApi({
    getFloorPlan: vi.fn((zoneId: string) =>
      zoneId === "z2"
        ? Promise.resolve(bar)
        : new Promise<FloorPlan>((_, reject) => {
            failTerrace = reject;
          }),
    ) as DashboardApi["getFloorPlan"],
  });
  const el = await open(api);
  history.pushState(null, "", "/manage/floor-plan/zone/z2");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flush(el);
  failTerrace({ code: "zone.not_found" });
  await flush(el);
  expect(el.shadowRoot!.querySelector("[data-load-error]")).toBeNull();
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["b1"]);
});

async function viewport(width: number, height: number): Promise<void> {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(width, height);
  onTestFinished(() => page.viewport(...before));
}

const sheet = (el: FloorPlanEditor) => el.shadowRoot!.querySelector<WtSheet>("wt-sheet");

it("puts the panel beside the canvas at 1280 px and in a collapsed sheet at 390 px", async () => {
  await viewport(1280, 800);
  const el = await open();
  await expect
    .poll(() => el.shadowRoot!.querySelector(".side floor-plan-tables-panel"))
    .not.toBeNull();
  expect(sheet(el)).toBeNull();
  await page.viewport(390, 844);
  await expect.poll(() => sheet(el)).not.toBeNull();
  expect(sheet(el)!.querySelector("floor-plan-tables-panel")).not.toBeNull();
  expect(el.shadowRoot!.querySelector(".side")).toBeNull();
  expect(sheet(el)!.expanded).toBe(false);
  expect(sheet(el)!.heading).toBe("Tables");
});

it("the sheet's heading names the selected table", async () => {
  await viewport(390, 844);
  const el = await open();
  await expect.poll(() => sheet(el)).not.toBeNull();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  expect(sheet(el)!.heading).toBe("T1");
});

it("keeps the same canvas when the page narrows past 600 px", async () => {
  await viewport(1280, 800);
  const el = await open();
  await expect.poll(() => el.shadowRoot!.querySelector("floor-plan-tables-panel")).not.toBeNull();
  const before = canvas(el);
  await page.viewport(390, 844);
  await expect.poll(() => sheet(el)).not.toBeNull();
  expect(canvas(el)).toBe(before);
});

it("tells the panel when it sits in the sheet", async () => {
  await viewport(390, 844);
  const el = await open();
  await expect.poll(() => sheet(el)).not.toBeNull();
  expect(
    sheet(el)!.querySelector<HTMLElement & { inSheet: boolean }>("floor-plan-tables-panel")!
      .inSheet,
  ).toBe(true);
});

const panelOf = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["floor-plan-tables-panel"]>(
    "floor-plan-tables-panel",
  )!;

const addDialogOf = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["floor-plan-add-tables"]>(
    "floor-plan-add-tables",
  )!;
const addModal = (el: FloorPlanEditor) =>
  addDialogOf(el).shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-tables]")!;
const addField = (el: FloorPlanEditor, name: string) =>
  addModal(el).querySelector<HTMLElement & { value: string }>(`[name=${name}]`)!;

async function openAddTables(el: FloorPlanEditor): Promise<void> {
  panelOf(el).shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!.click();
  await addDialogOf(el).updateComplete;
  await addModal(el).updateComplete;
}

async function setAddField(el: FloorPlanEditor, name: string, value: string): Promise<void> {
  await chooseOption(addField(el, name), value);
  await addDialogOf(el).updateComplete;
}

async function addViaDialog(el: FloorPlanEditor, count: number): Promise<void> {
  await openAddTables(el);
  await setAddField(el, "table-count", String(count));
  addModal(el).querySelector<HTMLElement>("wt-button[data-action=add-confirm]")!.click();
  await el.updateComplete;
}

async function addTablesHint(el: FloorPlanEditor): Promise<string> {
  await openAddTables(el);
  return addModal(el).querySelector("[data-preview]")!.textContent!.trim();
}

const venueTable = (id: string, label: string, zoneId: string | null, active: boolean) => ({
  id,
  label,
  zoneId,
  capacity: null,
  active,
  createdAt: "2026-10-01T10:00:00.000Z",
});

it("counts this zone's switched-off tables no draft table follows as taken", async () => {
  const el = await open(
    stubApi({
      listTables: vi.fn().mockResolvedValue([venueTable("l7", "Terrace 30", "z1", false)]),
    }),
  );
  expect(await addTablesHint(el)).toBe("Terrace 31");
});

it("counts other zones' tables as taken, but not this zone's live or followed tables", async () => {
  const el = await open(
    stubApi({
      listTables: vi
        .fn()
        .mockResolvedValue([
          venueTable("l1", "Terrace 50", "z1", false),
          venueTable("l8", "Terrace 60", "z1", true),
          venueTable("l9", "Terrace 20", "z2", true),
          venueTable("l10", "Terrace 9", null, false),
        ]),
    }),
  );
  expect(addDialogOf(el).zoneName).toBe("Terrace");
  expect([...addDialogOf(el).takenElsewhere].sort()).toEqual(["Terrace 20", "Terrace 9"]);
  expect(await addTablesHint(el)).toBe("Terrace 21");
});

it("gives added tables keys no draft table holds, through saves, undo and redo", async () => {
  const saveFloorPlan = vi.fn().mockResolvedValue({
    revision: 4,
    ids: { m1: "m1", m2: "m2", "new:1": "m5", "new:2": "m6" },
  });
  const saved = terrace(4);
  saved.tables.push(
    { id: "m5", liveTableId: "l5", label: "Terrace 1", seats: 4, fixed: false, placement: null },
    { id: "m6", liveTableId: "l6", label: "Terrace 2", seats: 4, fixed: false, placement: null },
  );
  const getFloorPlan = vi.fn().mockResolvedValueOnce(terrace()).mockResolvedValue(saved);
  const el = await open(stubApi({ saveFloorPlan, getFloorPlan }));
  const keysUnique = () => {
    const keys = panelOf(el).draft.tables.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    return keys;
  };
  await addViaDialog(el, 2);
  expect(keysUnique()).toEqual(["m1", "m2", "new:1", "new:2"]);
  await press(el, "save");
  await expect.poll(() => panelOf(el).draft.tables.map((t) => t.key)).toContain("m5");
  expect(keysUnique()).toEqual(["m1", "m2", "m5", "m6"]);
  await addViaDialog(el, 2);
  expect(keysUnique()).toEqual(["m1", "m2", "m5", "m6", "new:3", "new:4"]);
  await press(el, "undo");
  expect(keysUnique()).toEqual(["m1", "m2", "m5", "m6"]);
  await addViaDialog(el, 1);
  expect(keysUnique()).toEqual(["m1", "m2", "m5", "m6", "new:5"]);
  await press(el, "undo");
  keysUnique();
  await press(el, "redo");
  expect(keysUnique()).toEqual(["m1", "m2", "m5", "m6", "new:5"]);
});

const sizes: [[number, number], [number, number]][] = [
  [
    [1280, 800],
    [390, 844],
  ],
  [
    [390, 844],
    [1280, 800],
  ],
];
for (const [from, to] of sizes) {
  it(`keeps Add tables open with its typed names when the page goes from ${from[0]} to ${to[0]} px`, async () => {
    await viewport(...from);
    const el = await open();
    await expect.poll(() => sheet(el) !== null).toBe(from[0] < 600);
    await openAddTables(el);
    await setAddField(el, "table-count", "2");
    await setAddField(el, "naming", "custom");
    await setAddField(el, "table-name", "Patio 1");
    const before = panelOf(el);
    await page.viewport(...to);
    await expect.poll(() => sheet(el) !== null).toBe(to[0] < 600);
    expect(panelOf(el)).not.toBe(before);
    await el.updateComplete;
    expect(addModal(el).open).toBe(true);
    expect(addField(el, "table-name").value).toBe("Patio 1");
    expect(addField(el, "table-count").value).toBe("2");
  });
}

const tablePanel = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["floor-plan-table-panel"]>(
    "floor-plan-table-panel",
  );

it("Undo of a Delete brings back the table and its join", async () => {
  const joined: FloorPlan = {
    ...terrace(),
    joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
  };
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(joined) }));
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  tablePanel(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=delete]")!.click();
  await el.updateComplete;
  expect(canvas(el).tables.map((t) => t.key)).toEqual([]);
  expect(canvas(el).selected).toBeNull();
  expect(tablePanel(el)).toBeNull();
  await press(el, "undo");
  expectSaveQuiet(el);
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1"]);
  const panel = el.shadowRoot!.querySelector("floor-plan-tables-panel")!;
  expect(panel.draft.joins).toEqual([{ key: "j1", seats: 6, tableKeys: ["m1", "m2"] }]);
});

it("puts the selected table's panel above the tables list, beside the canvas and in the sheet", async () => {
  await viewport(1280, 800);
  const el = await open();
  await expect.poll(() => el.shadowRoot!.querySelector(".side")).not.toBeNull();
  expect(tablePanel(el)).toBeNull();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  const side = el.shadowRoot!.querySelector(".side")!;
  expect([...side.children].map((c) => c.localName)).toEqual([
    "floor-plan-table-panel",
    "floor-plan-tables-panel",
  ]);
  expect(tablePanel(el)!.tableKey).toBe("m1");
  await page.viewport(390, 844);
  await expect.poll(() => sheet(el)).not.toBeNull();
  expect([...sheet(el)!.children].map((c) => c.localName)).toEqual([
    "floor-plan-table-panel",
    "floor-plan-tables-panel",
  ]);
});

it("a panel's typed name goes into the draft and Undo takes the whole typing back", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  const name = tablePanel(el)!.shadowRoot!.querySelector("[name=table-name]")!;
  await chooseOption(name, "T1a");
  await el.updateComplete;
  await chooseOption(name, "T1ab");
  await el.updateComplete;
  expect(canvas(el).tables[0]!.label).toBe("T1ab");
  await press(el, "undo");
  expect(canvas(el).tables[0]!.label).toBe("T1");
  expect(button(el, "undo").disabled).toBe(true);
});

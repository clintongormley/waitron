import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtFloorPlanCanvas, WtModal, WtSheet } from "@waitron/ui";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./floor-plan-editor.js";
import type { FloorPlanEditor } from "./floor-plan-editor.js";
import type { DashboardApi, FloorPlan, PlanPlacement } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { DASHBOARD_ICONS } from "../icons.js";
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

it("draws the editor in an open full-window modal named after the zone", async () => {
  await viewport(1280, 800);
  const el = await open();
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal[size=full]")!;
  expect(modal).not.toBeNull();
  expect(modal.open).toBe(true);
  expect(modal.getAttribute("aria-label")).toBe("Terrace");
  for (const part of ["header", "wt-floor-plan-canvas", ".side"])
    expect(modal.contains(el.shadowRoot!.querySelector(part))).toBe(true);
});

it("names the modal Floor plan for a zone the zone list lacks", async () => {
  const el = await open(stubApi({ listZones: vi.fn().mockResolvedValue([]) }));
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal[size=full]")!;
  expect(modal.getAttribute("aria-label")).toBe("Floor plan");
});

it("keeps a load failure and its Cancel inside the modal", async () => {
  const el = await open(
    stubApi({
      getFloorPlan: vi.fn().mockRejectedValue({ code: "zone.not_found" }),
    }),
  );
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal[size=full]")!;
  expect(modal.open).toBe(true);
  expect(modal.contains(el.shadowRoot!.querySelector("[data-load-error]"))).toBe(true);
  expect(modal.contains(el.shadowRoot!.querySelector("[data-action=close]"))).toBe(true);
});

it("draws placed tables and leaves unplaced ones off the canvas", async () => {
  const el = await open();
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1"]);
  expect(canvas(el).tables[0]).toEqual({ key: "m1", label: "T1", fixed: false, placement });
});

it.each([
  [
    "en-GB",
    "Your first save goes live now; later changes tomorrow, unless you “Reset to saved plan” on the till.",
    "Changes will go live tomorrow, unless you “Reset to saved plan” on the till.",
  ],
  [
    "es-ES",
    "Tu primer guardado se aplica ya; los cambios posteriores, mañana, salvo que uses «Volver al plano guardado» en el TPV.",
    "Los cambios se aplicarán mañana, salvo que uses «Volver al plano guardado» en el TPV.",
  ],
])(
  "says under the zone's name what a first save does, and when a saved plan's changes reach the till (%s)",
  async (locale, firstNote, laterNote) => {
    setLocale(locale);
    const note = (el: FloorPlanEditor) => {
      const header = el.shadowRoot!.querySelector("header")!;
      const p = header.querySelector("[data-note]")!;
      expect(header.querySelector("h1")!.compareDocumentPosition(p)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(p.compareDocumentPosition(header.querySelector("wt-form-actions")!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      return p.textContent!.trim();
    };
    const first = await open(
      stubApi({
        getFloorPlan: vi.fn().mockResolvedValue(terrace(0)) as DashboardApi["getFloorPlan"],
      }),
    );
    expect(note(first)).toBe(firstNote);
    cleanupWidgets();
    const saved = await open();
    expect(note(saved)).toBe(laterNote);
  },
);

it.each([
  ["en-GB", "Undo", "Redo", "Cancel"],
  ["es-ES", "Deshacer", "Rehacer", "Cancelar"],
])(
  "draws Undo and Redo as round icon buttons named by their labels, and Cancel as a link (%s)",
  async (locale, undo, redo, cancel) => {
    setLocale(locale);
    const el = await open();
    for (const [action, name] of [
      ["undo", undo],
      ["redo", redo],
    ] as const) {
      const b = button(el, action);
      expect(b.shape).toBe("round");
      expect(b.variant).toBe("secondary");
      expect(b.getAttribute("aria-label")).toBe(name);
      expect(b.textContent!.trim()).toBe("");
      expect(b.querySelector(`wt-icon[name=${action}]`)).not.toBeNull();
      expect(DASHBOARD_ICONS[action]).toMatch(/^M/);
    }
    expect(el.shadowRoot!.querySelector("a[data-action=close]")!.textContent!.trim()).toBe(cancel);
  },
);

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

it("Cancel links to the way back, or to /manage when it is not a dashboard path", async () => {
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
  const unparsable = await open(
    stubApi(),
    `/manage/floor-plan/zone/z1?back=${encodeURIComponent("http://[")}`,
  );
  expect(close(unparsable)).toBe("/manage");
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

it("at 1280 px puts Add tables at the bottom of a side column taller than its list", async () => {
  await viewport(1280, 800);
  const el = await open();
  await expect.poll(() => el.shadowRoot!.querySelector(".side")).not.toBeNull();
  const column = el.shadowRoot!.querySelector<HTMLElement>(".side")!;
  const add = column
    .querySelector("floor-plan-tables-panel")!
    .shadowRoot!.querySelector<HTMLElement>("wt-button[data-action=add-tables]")!;
  expect(column.scrollHeight).toBe(column.clientHeight);
  expect(add.getBoundingClientRect().bottom).toBeCloseTo(column.getBoundingClientRect().bottom, 0);
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

const modalBody = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<WtModal>("wt-modal[size=full]")!.shadowRoot!.querySelector(".body")!;

it("at 1280 px fills the modal's height with the canvas and a side column as tall", async () => {
  await viewport(1280, 800);
  const el = await open();
  await expect.poll(() => el.shadowRoot!.querySelector(".side")).not.toBeNull();
  const space = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-5"));
  const body = modalBody(el).getBoundingClientRect();
  const box = canvas(el).getBoundingClientRect();
  const side = el.shadowRoot!.querySelector(".side")!.getBoundingClientRect();
  expect(body.bottom - box.bottom).toBeLessThanOrEqual(space + 0.5);
  expect(Math.abs(side.height - box.height)).toBeLessThanOrEqual(0.5);
});

it("decides the sheet by the modal's width, not the width of the page around the editor", async () => {
  await viewport(1280, 800);
  const el = await open();
  el.parentElement!.style.width = "500px";
  await frames(3);
  await el.updateComplete;
  expect(sheet(el)).toBeNull();
  expect(el.shadowRoot!.querySelector(".side")).not.toBeNull();
});

it("at 390 px docks the sheet over the bottom of the canvas, and nothing else scrolls", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  const body = modalBody(el);
  for (const step of ["collapsed", "expanded"]) {
    if (step === "expanded") await expandSheet(el);
    await frames(2);
    const box = canvas(el).getBoundingClientRect();
    const docked = sheet(el)!.getBoundingClientRect();
    expect(Math.abs(docked.bottom - box.bottom), step).toBeLessThanOrEqual(0.5);
    expect(docked.top, step).toBeGreaterThan(box.top);
    expect(body.scrollHeight, step).toBe(body.clientHeight);
  }
});

/** Terrace with T1 and T2 low on the canvas, where an expanded sheet at 390 × 844 covers them. */
const lowApi = () =>
  stubApi({
    getFloorPlan: vi.fn().mockResolvedValue({
      ...terrace(),
      tables: terrace().tables.map((t) => ({
        ...t,
        placement: { ...placement, y: t.id === "m1" ? 40 : 70 },
      })),
    }),
  });

/** Whether what the canvas draws for `key` (its box, handle and reason) sits between the canvas's
 *  visible top and the sheet's top. */
function aboveSheet(el: FloorPlanEditor, key: string): boolean {
  const root = canvas(el).shadowRoot!;
  const parts = [
    ...[...root.querySelectorAll<HTMLElement>("[data-key]")].filter((n) => n.dataset.key === key),
    ...root.querySelectorAll(".rotate-handle"),
  ].map((n) => n.getBoundingClientRect());
  const viewTop = Math.max(0, root.querySelector(".viewport")!.getBoundingClientRect().top);
  const sheetTop = sheet(el)!.getBoundingClientRect().top;
  return (
    parts.length > 0 &&
    Math.max(...parts.map((r) => r.bottom)) <= sheetTop + 0.5 &&
    Math.min(...parts.map((r) => r.top)) >= viewTop - 0.5
  );
}

async function expandSheet(el: FloorPlanEditor): Promise<void> {
  sheet(el)!.shadowRoot!.querySelector<HTMLElement>("button")!.click();
  await el.updateComplete;
}

it("at 390 px scrolls a table selected under the open sheet up above it", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await expandSheet(el);
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
});

it("at 390 px scrolls the selected table above the sheet when the sheet opens", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
  await expandSheet(el);
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
});

it("at 390 px lifts the selected table above the sheet the user taps open", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await userEvent.click(sheet(el)!.shadowRoot!.querySelector<HTMLElement>("button")!);
  await expect.poll(() => sheet(el)!.expanded).toBe(true);
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
});

it("at 390 px scrolls each newly selected table above the open sheet", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await expandSheet(el);
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
  expect(aboveSheet(el, "m2")).toBe(false);
  await fromCanvas(el, "wt-table-select", { key: "m2" });
  await expect.poll(() => aboveSheet(el, "m2")).toBe(true);
});

it("at 390 px keeps the selected table above the sheet when the sheet grows before the user scrolls", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
  sheet(el)!.style.paddingTop = "400px";
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
});

it("at 390 px lifts a table above the open sheet by scrolling the canvas, never the page", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await expandSheet(el);
  await fromCanvas(el, "wt-table-select", { key: "m2" });
  await expect.poll(() => aboveSheet(el, "m2")).toBe(true);
  expect(window.scrollY).toBe(0);
  expect(button(el, "save").getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
});

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
}

it("at 390 px leaves the user's own pan alone when the sheet grows after it", async () => {
  await viewport(390, 844);
  const el = await open(lowApi());
  await expect.poll(() => sheet(el)).not.toBeNull();
  await expandSheet(el);
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await expect.poll(() => aboveSheet(el, "m1")).toBe(true);
  const view = canvas(el).shadowRoot!.querySelector(".viewport")!;
  const table = canvas(el).shadowRoot!.querySelector("button[data-key=m1]")!;
  await userEvent.wheel(table, { delta: { y: -2000 } });
  await expect.poll(() => view.scrollTop).toBe(0);
  const pageY = window.scrollY;
  const height = sheet(el)!.getBoundingClientRect().height;
  sheet(el)!.style.paddingTop = "100px";
  await frames(3);
  await el.updateComplete;
  await canvas(el).updateComplete;
  expect(sheet(el)!.getBoundingClientRect().height).toBeGreaterThan(height);
  expect(view.scrollTop).toBe(0);
  expect(window.scrollY).toBe(pageY);
});

it("leaves the canvas where it is at 1280 px", async () => {
  await viewport(1280, 800);
  const el = await open(lowApi());
  await expect.poll(() => el.shadowRoot!.querySelector(".side")).not.toBeNull();
  const scrolled = () => [
    window.scrollY,
    canvas(el).shadowRoot!.querySelector(".viewport")!.scrollTop,
  ];
  const before = scrolled();
  const reveal = vi.spyOn(canvas(el), "reveal");
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await canvas(el).updateComplete;
  expect(reveal).not.toHaveBeenCalled();
  expect(scrolled()).toEqual(before);
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

const venueTable = (id: string, label: string, zoneId: string, planTableId: string | null) => ({
  id,
  label,
  zoneId,
  planTableId,
  createdAt: "2026-10-01T10:00:00.000Z",
});

it("counts this zone's tables without a master no draft table follows as taken", async () => {
  const el = await open(
    stubApi({
      listTables: vi.fn().mockResolvedValue([venueTable("l7", "Terrace 30", "z1", null)]),
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
          venueTable("l1", "Terrace 50", "z1", null),
          venueTable("l8", "Terrace 60", "z1", "m8"),
          venueTable("l9", "Terrace 20", "z2", "m9"),
          venueTable("l10", "Terrace 9", "z3", null),
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

const listRow = (el: FloorPlanEditor, key: string) =>
  el
    .shadowRoot!.querySelector("floor-plan-tables-panel")!
    .shadowRoot!.querySelector<HTMLElement>(`li[data-table="${key}"]`)!;
const deleteDialog = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=delete-table]");

async function askDelete(el: FloorPlanEditor, key: string): Promise<WtModal> {
  listRow(el, key).querySelector<HTMLElement>("wt-button[data-action=delete]")!.click();
  await el.updateComplete;
  const dialog = deleteDialog(el)!;
  await dialog.updateComplete;
  return dialog;
}

const closeOf = (dialog: WtModal) =>
  new Promise((resolve) => dialog.addEventListener("wt-close", resolve, { once: true }));

const joinedTerrace = (): FloorPlan => ({
  ...terrace(),
  joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
});

it.each([
  ["en-GB", "Delete T2?", "It leaves the tables list and the plan.", "Cancel", "Delete"],
  ["es-ES", "¿Eliminar T2?", "Sale de la lista de mesas y del plano.", "Cancelar", "Eliminar"],
])(
  "the bin asks before deleting, in a compact dialog (%s)",
  async (locale, head, text, no, yes) => {
    setLocale(locale);
    const el = await open();
    expect(deleteDialog(el)?.open ?? false).toBe(false);
    const dialog = await askDelete(el, "m2");
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("size")).toBe("compact");
    expect(dialog.heading).toBe(head);
    expect(dialog.querySelector("[data-delete-text]")!.textContent!.trim()).toBe(text);
    expect(button(el, "delete-cancel").textContent!.trim()).toBe(no);
    expect(button(el, "delete-confirm").textContent!.trim()).toBe(yes);
    expect(button(el, "delete-confirm").variant).toBe("danger");
    expect(button(el, "delete-confirm").disabled).toBe(false);
    expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1"]);
    expectSaveQuiet(el);
  },
);

it("Cancel on the delete question changes nothing and closes it", async () => {
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(joinedTerrace()) }));
  const dialog = await askDelete(el, "m2");
  const closed = closeOf(dialog);
  await press(el, "delete-cancel");
  await closed;
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(el.shadowRoot!.querySelector("floor-plan-tables-panel")!.draft.tables).toHaveLength(2);
  expectSaveQuiet(el);
  expect(button(el, "undo").disabled).toBe(true);
});

it("Escape on the delete question changes nothing, closes it and does not start leaving", async () => {
  const el = await open();
  let leaving = 0;
  el.shadowRoot!.querySelector("a.close")!.addEventListener("click", (event) => {
    event.preventDefault();
    leaving++;
  });
  const dialog = await askDelete(el, "m2");
  const closed = closeOf(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(leaving).toBe(0);
  expect(el.shadowRoot!.querySelector("floor-plan-tables-panel")!.draft.tables).toHaveLength(2);
  expectSaveQuiet(el);
});

it("Delete on the question removes the table and its join as one step, clears its selection and closes", async () => {
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(joinedTerrace()) }));
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  const dialog = await askDelete(el, "m1");
  const closed = closeOf(dialog);
  await press(el, "delete-confirm");
  await closed;
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  const panel = el.shadowRoot!.querySelector("floor-plan-tables-panel")!;
  expect(panel.draft.tables.map((t) => t.key)).toEqual(["m2"]);
  expect(panel.draft.joins).toEqual([]);
  expect(canvas(el).selected).toBeNull();
  expectSaveAwake(el);
  await press(el, "undo");
  expectSaveQuiet(el);
  expect(button(el, "undo").disabled).toBe(true);
});

it("Delete on the question keeps the selection of another table", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  const dialog = await askDelete(el, "m2");
  const closed = closeOf(dialog);
  await press(el, "delete-confirm");
  await closed;
  await el.updateComplete;
  expect(canvas(el).selected).toBe("m1");
  expect(el.shadowRoot!.querySelector("floor-plan-tables-panel")!.draft.tables).toHaveLength(1);
});

it("hands the tables list the selection, so the selected table's row is current", async () => {
  const el = await open();
  expect(listRow(el, "m1").getAttribute("aria-current")).toBeNull();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await el.shadowRoot!.querySelector("floor-plan-tables-panel")!.updateComplete;
  expect(listRow(el, "m1").getAttribute("aria-current")).toBe("true");
  expect(listRow(el, "m2").getAttribute("aria-current")).toBeNull();
});

it("taking a saved placed table off through its row wakes Save; Undo puts it back and quiets Save", async () => {
  const el = await open();
  listRow(el, "m1").querySelector<HTMLElement>("button[data-action=toggle]")!.click();
  await el.updateComplete;
  expect(canvas(el).tables).toEqual([]);
  expectSaveAwake(el);
  await press(el, "undo");
  expect(placed(el, "m1")).toEqual(placement);
  expectSaveQuiet(el);
});

async function toggleRow(el: FloorPlanEditor, key: string): Promise<void> {
  listRow(el, key).querySelector<HTMLElement>("button[data-action=toggle]")!.click();
  await el.updateComplete;
  await el.shadowRoot!.querySelector("floor-plan-tables-panel")!.updateComplete;
}

const odd = { x: 30, y: 12, width: 12, height: 6, shape: "round" as const, rotation: 90 };
const withM1 = (at: PlanPlacement | null): FloorPlan => ({
  ...terrace(),
  tables: terrace().tables.map((t) => (t.id === "m1" ? { ...t, placement: at } : t)),
});

it("a table taken off through its row goes back to the same place when pressed again, which is no change", async () => {
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(withM1(odd)) }));
  await toggleRow(el, "m1");
  expect(canvas(el).tables).toEqual([]);
  await toggleRow(el, "m1");
  expect(placed(el, "m1")).toEqual(odd);
  expectSaveQuiet(el);
});

it("an Undo that takes a table off remembers where it stood", async () => {
  const el = await open();
  const draft = patchTable(draftFromPlan(terrace()), "m2", { placement: odd });
  await fromCanvas(el, "floor-plan-change", { draft });
  await press(el, "undo");
  await el.shadowRoot!.querySelector("floor-plan-tables-panel")!.updateComplete;
  await toggleRow(el, "m2");
  expect(placed(el, "m2")).toEqual(odd);
});

it("forgets where tables stood when another zone opens", async () => {
  const getFloorPlan = vi
    .fn()
    .mockResolvedValueOnce(withM1(odd))
    .mockResolvedValueOnce(bar)
    .mockResolvedValueOnce(withM1(null));
  const el = await open(stubApi({ getFloorPlan }));
  await toggleRow(el, "m1");
  for (const zone of ["z2", "z1"]) {
    history.pushState(null, "", `/manage/floor-plan/zone/${zone}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
  }
  expect(heading(el)).toBe("Terrace");
  await toggleRow(el, "m1");
  expect(placed(el, "m1")).toEqual(expect.objectContaining({ width: 8, height: 8, rotation: 0 }));
  expect(placed(el, "m1")).not.toEqual(odd);
});

const fullFloor = { x: 0, y: 0, width: 999, height: 999, shape: "rect" as const, rotation: 0 };
const message = (el: FloorPlanEditor) => el.shadowRoot!.querySelector("wt-form-actions")!.error;

it.each([
  ["en-GB", "No room on the plan."],
  ["es-ES", "No hay sitio en el plano."],
])(
  "pressing a never-placed table on a plan with no free spot says so and changes nothing (%s)",
  async (locale, text) => {
    setLocale(locale);
    const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(withM1(fullFloor)) }));
    await toggleRow(el, "m2");
    expect(message(el)).toBe(text);
    expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1"]);
    expectSaveQuiet(el);
    expect(button(el, "undo").disabled).toBe(true);
  },
);

it("the no-room message goes at the draft's next change", async () => {
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(withM1(fullFloor)) }));
  await toggleRow(el, "m2");
  expect(message(el)).toBe("No room on the plan.");
  await toggleRow(el, "m1");
  expect(message(el)).toBe("");
  await toggleRow(el, "m2");
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["m2"]);
  expect(message(el)).toBe("");
});

it("the no-room message goes when Undo steps the draft back", async () => {
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(withM1(fullFloor)) }));
  await fromCanvas(el, "wt-table-rotate", { key: "m1", rotation: 90 });
  await toggleRow(el, "m2");
  expect(message(el)).toBe("No room on the plan.");
  await press(el, "undo");
  expect(placed(el, "m1")!.rotation).toBe(0);
  expect(message(el)).toBe("");
});

it("a save's refusal stays when the draft changes after it", async () => {
  const saveFloorPlan = vi.fn().mockRejectedValue({ code: "server.internal" });
  const el = await open(stubApi({ saveFloorPlan }));
  await fromCanvas(el, "wt-table-rotate", { key: "m1", rotation: 90 });
  await press(el, "save");
  await flush(el);
  expect(message(el)).toBe("Something went wrong, try again");
  await toggleRow(el, "m2");
  expect(canvas(el).tables.map((t) => t.key)).toEqual(["m1", "m2"]);
  expect(message(el)).toBe("Something went wrong, try again");
  await press(el, "undo");
  expect(message(el)).toBe("Something went wrong, try again");
});

const hintText = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector("[data-hint]")?.textContent!.trim() ?? null;

it.each([
  [
    "en-GB",
    "Select a table on the plan to change it. Click a table below to put it on the plan or take it off; it returns to the same spot.",
  ],
  [
    "es-ES",
    "Selecciona una mesa en el plano para cambiarla. Pulsa una mesa de abajo para ponerla en el plano o quitarla; vuelve al mismo sitio.",
  ],
])("with nothing selected, a hint sits above the tables list (%s)", async (locale, text) => {
  setLocale(locale);
  await viewport(1280, 800);
  const el = await open();
  await expect.poll(() => el.shadowRoot!.querySelector(".side")).not.toBeNull();
  expect(hintText(el)).toBe(text);
  const side = el.shadowRoot!.querySelector(".side")!;
  expect([...side.children].map((c) => c.localName)).toEqual(["p", "floor-plan-tables-panel"]);
  expect(side.firstElementChild!.hasAttribute("data-hint")).toBe(true);
  await page.viewport(390, 844);
  await expect.poll(() => sheet(el)).not.toBeNull();
  expect([...sheet(el)!.children].map((c) => c.localName)).toEqual([
    "p",
    "floor-plan-tables-panel",
  ]);
  expect(hintText(el)).toBe(text);
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  expect(hintText(el)).toBeNull();
});

it("Undo of a Delete brings back the table and its join", async () => {
  const joined: FloorPlan = {
    ...terrace(),
    joins: [{ id: "j1", seats: 6, tableIds: ["m1", "m2"] }],
  };
  const el = await open(stubApi({ getFloorPlan: vi.fn().mockResolvedValue(joined) }));
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await askDelete(el, "m1");
  await press(el, "delete-confirm");
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
  expect(el.shadowRoot!.querySelector("[data-hint]")).toBeNull();
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

const joinDialogOf = (el: FloorPlanEditor) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["floor-plan-add-join"]>(
    "floor-plan-add-join",
  )!;
const joinModal = (el: FloorPlanEditor) =>
  joinDialogOf(el).shadowRoot!.querySelector<WtModal>("wt-modal[data-dialog=add-join]")!;
const joinField = (el: FloorPlanEditor, name: string) =>
  joinModal(el).querySelector<HTMLElement & { value: string; values: string[] }>(`[name=${name}]`)!;

async function openAddJoin(el: FloorPlanEditor): Promise<void> {
  tablePanel(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=add-join]")!.click();
  await joinDialogOf(el).updateComplete;
  await joinModal(el).updateComplete;
}

async function addJoinOf(el: FloorPlanEditor, others: string[], seats: string): Promise<void> {
  await openAddJoin(el);
  await chooseOptions(joinField(el, "join-tables"), others);
  await chooseOption(joinField(el, "join-seats"), seats);
  await joinDialogOf(el).updateComplete;
  joinModal(el).querySelector<HTMLElement>("wt-button[data-action=join-confirm]")!.click();
  await el.updateComplete;
  await expect.poll(() => joinModal(el).open).toBe(false);
}

it("Add join from the selected table's panel adds a join with a fresh key each time", async () => {
  const el = await open();
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await addJoinOf(el, ["m2"], "6");
  expect(tablePanel(el)!.draft.joins).toEqual([
    { key: "join:1", seats: 6, tableKeys: ["m1", "m2"] },
  ]);
  expect(button(el, "save").variant).toBe("primary");
  await press(el, "undo");
  expect(tablePanel(el)!.draft.joins).toEqual([]);
  await addJoinOf(el, ["m2"], "5");
  expect(tablePanel(el)!.draft.joins.map((j) => j.key)).toEqual(["join:2"]);
});

for (const [from, to] of sizes) {
  it(`keeps Add join open with its chosen table when the page goes from ${from[0]} to ${to[0]} px`, async () => {
    await viewport(...from);
    const el = await open();
    await expect.poll(() => sheet(el) !== null).toBe(from[0] < 600);
    await fromCanvas(el, "wt-table-select", { key: "m1" });
    await openAddJoin(el);
    await chooseOptions(joinField(el, "join-tables"), ["m2"]);
    await joinDialogOf(el).updateComplete;
    const before = tablePanel(el);
    await page.viewport(...to);
    await expect.poll(() => sheet(el) !== null).toBe(to[0] < 600);
    expect(tablePanel(el)).not.toBe(before);
    await el.updateComplete;
    expect(joinModal(el).open).toBe(true);
    expect(joinField(el, "join-tables").values).toEqual(["m2"]);
  });
}

it("a save answer arriving while Add join is open re-keys its chosen table", async () => {
  const withT9 = (revision: number, id: string): FloorPlan => ({
    ...terrace(revision),
    tables: [
      ...terrace(revision).tables,
      { id, liveTableId: "l9", label: "T9", seats: null, fixed: false, placement: null },
    ],
  });
  let answer!: (value: { revision: number; ids: Record<string, string> }) => void;
  const api = stubApi({
    getFloorPlan: vi.fn().mockResolvedValueOnce(terrace(3)).mockResolvedValue(withT9(4, "m9")),
    saveFloorPlan: vi.fn(
      () =>
        new Promise<{ revision: number; ids: Record<string, string> }>((resolve) => {
          answer = resolve;
        }),
    ),
  });
  const el = await open(api);
  await fromCanvas(el, "floor-plan-change", {
    draft: addTables(
      draftFromPlan(terrace(3)),
      [{ label: "T9", seats: null, fixed: false }],
      () => "new:9",
    ),
  });
  button(el, "save").click();
  await el.updateComplete;
  await fromCanvas(el, "wt-table-select", { key: "m1" });
  await openAddJoin(el);
  await chooseOptions(joinField(el, "join-tables"), ["new:9"]);
  answer({ revision: 4, ids: { "new:9": "m9" } });
  await flush(el);
  await flush(el);
  expect(panelOf(el).draft.tables.map((t) => t.key)).toContain("m9");
  expect(joinModal(el).open).toBe(true);
  expect(joinField(el, "join-tables").values).toEqual(["m9"]);
  await chooseOption(joinField(el, "join-seats"), "4");
  await joinDialogOf(el).updateComplete;
  joinModal(el).querySelector<HTMLElement>("wt-button[data-action=join-confirm]")!.click();
  await el.updateComplete;
  expect(tablePanel(el)!.draft.joins).toEqual([
    { key: "join:1", seats: 4, tableKeys: ["m1", "m9"] },
  ]);
  await tablePanel(el)!.updateComplete;
  expect(tablePanel(el)!.shadowRoot!.querySelector("[data-join-text]")!.textContent!.trim()).toBe(
    "with T9 · seats 4",
  );
});

it("does not reserve an unfollowed live name backed by this zone's master plan", async () => {
  const el = await open(
    stubApi({
      listTables: vi.fn().mockResolvedValue([
        {
          id: "l8",
          label: "Terrace 30",
          zoneId: "z1",
          planTableId: "m8",
          createdAt: "2026-10-01",
        },
      ]),
    }),
  );
  expect(await addTablesHint(el)).toBe("Terrace 1");
});

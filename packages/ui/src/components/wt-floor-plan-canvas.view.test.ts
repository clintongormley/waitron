import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import type { PlanCanvasTable, TableRotate, WtFloorPlanCanvas } from "./wt-floor-plan-canvas.js";
import "./wt-floor-plan-canvas.js";

afterEach(cleanup);

const table = (key: string, x: number, y: number): PlanCanvasTable => ({
  key,
  label: key,
  fixed: false,
  placement: { x, y, width: 8, height: 8, rotation: 0, shape: "rect" },
});

async function settled(el: WtFloorPlanCanvas): Promise<void> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

async function canvas(selected: string | null = null): Promise<WtFloorPlanCanvas> {
  const el = (await mount(
    '<wt-floor-plan-canvas style="width: 600px; height: 360px"></wt-floor-plan-canvas>',
  )) as WtFloorPlanCanvas;
  el.tables = [table("T1", 10, 10), table("T2", 100, 100)];
  el.selected = selected;
  await settled(el);
  return el;
}

const part = (el: WtFloorPlanCanvas, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part="${name}"]`)!;
const button = (el: WtFloorPlanCanvas) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="T1"]')!;

function pointer(
  target: EventTarget,
  type: string,
  id: number,
  x: number,
  y: number,
  pointerType = "touch",
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: id,
      pointerType,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

function centre(node: HTMLElement): { x: number; y: number } {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function events(el: WtFloorPlanCanvas, name: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(name, (e) => seen.push((e as CustomEvent<unknown>).detail));
  return seen;
}

it("a finger on an unselected table pans without moving or selecting it", async () => {
  const el = await canvas();
  const moves = events(el, "wt-table-move");
  const selections = events(el, "wt-table-select");
  const before = button(el).getBoundingClientRect();
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 24, at.y - 36);
  await el.updateComplete;
  const after = button(el).getBoundingClientRect();
  pointer(window, "pointerup", 1, at.x - 24, at.y - 36);
  expect(moves).toEqual([]);
  expect(selections).toEqual([]);
  expect(after.left).toBeCloseTo(before.left - 24);
  expect(after.top).toBeCloseTo(before.top - 36);
});

it("a touch tap selects the table so the next touch can move it", async () => {
  const el = await canvas();
  const selections = events(el, "wt-table-select");
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointerup", 1, at.x, at.y);
  expect(selections).toEqual([{ key: "T1" }]);
  el.selected = "T1";
  await el.updateComplete;
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + 24, at.y + 12);
  pointer(window, "pointerup", 1, at.x + 24, at.y + 12);
  expect(moves).toEqual([{ key: "T1", x: 12, y: 11 }]);
});

it("one finger on the empty grid pans the view", async () => {
  const el = await canvas("T1");
  const selections = events(el, "wt-table-select");
  const at = centre(part(el, "viewport"));
  pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 48, at.y - 24);
  pointer(window, "pointerup", 1, at.x - 48, at.y - 24);
  await el.updateComplete;
  expect(part(el, "viewport").scrollLeft).toBe(48);
  expect(part(el, "viewport").scrollTop).toBe(24);
  expect(selections).toEqual([]);
});

it("a pinch enlarges tables about the fingers' midpoint without editing the plan", async () => {
  const el = await canvas();
  const moves = events(el, "wt-table-move");
  const selections = events(el, "wt-table-select");
  const at = centre(button(el));
  pointer(part(el, "grid"), "pointerdown", 1, at.x - 48, at.y);
  pointer(part(el, "grid"), "pointerdown", 2, at.x + 48, at.y);
  pointer(window, "pointermove", 1, at.x - 96, at.y);
  pointer(window, "pointermove", 2, at.x + 96, at.y);
  await el.updateComplete;
  const box = button(el).getBoundingClientRect();
  expect(box.width).toBeCloseTo(192);
  expect(box.left + box.width / 2).toBeCloseTo(at.x);
  expect(box.top + box.height / 2).toBeCloseTo(at.y);
  pointer(window, "pointerup", 1, at.x - 96, at.y);
  pointer(window, "pointerup", 2, at.x + 96, at.y);
  expect(moves).toEqual([]);
  expect(selections).toEqual([]);
});

function wheel(el: WtFloorPlanCanvas, deltaY: number, ctrlKey = true, deltaMode = 0): void {
  const at = centre(button(el));
  part(el, "viewport").dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      ctrlKey,
      deltaY,
      deltaMode,
    }),
  );
}

async function doubled(el: WtFloorPlanCanvas): Promise<void> {
  const at = centre(button(el));
  pointer(part(el, "grid"), "pointerdown", 1, at.x - 48, at.y);
  pointer(part(el, "grid"), "pointerdown", 2, at.x + 48, at.y);
  pointer(window, "pointermove", 1, at.x - 96, at.y);
  pointer(window, "pointermove", 2, at.x + 96, at.y);
  pointer(window, "pointerup", 1, at.x - 96, at.y);
  pointer(window, "pointerup", 2, at.x + 96, at.y);
  await el.updateComplete;
}

it("a second finger cancels a table move and pinches without committing the draft", async () => {
  const el = await canvas("T1");
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + 24, at.y);
  pointer(part(el, "grid"), "pointerdown", 2, at.x + 120, at.y);
  pointer(window, "pointerup", 1, at.x + 24, at.y);
  pointer(window, "pointerup", 2, at.x + 120, at.y);
  await el.updateComplete;
  expect(moves).toEqual([]);
  expect(button(el).getBoundingClientRect().width).toBe(96);
  expect(centre(button(el))).toEqual(at);
});

it("at twice the zoom a touch move still advances by grid squares", async () => {
  const el = await canvas("T1");
  await doubled(el);
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + 48, at.y + 24);
  pointer(window, "pointerup", 1, at.x + 48, at.y + 24);
  expect(moves).toEqual([{ key: "T1", x: 12, y: 11 }]);
});

it("at twice the zoom a resize changes two squares for 48 screen pixels", async () => {
  const el = await canvas("T1");
  await doubled(el);
  const changes = events(el, "wt-table-resize");
  const handle = el.shadowRoot!.querySelector<HTMLElement>(
    '[part="resize-handle"][data-side="right"]',
  )!;
  const at = centre(handle);
  pointer(handle, "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + 48, at.y);
  pointer(window, "pointerup", 1, at.x + 48, at.y);
  expect(changes).toEqual([{ key: "T1", x: 10, y: 10, width: 10, height: 8 }]);
});

const corner = (el: WtFloorPlanCanvas, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(
    `[part="resize-corner-handle"][data-corner="${name}"]`,
  )!;

it("at twice the zoom a corner drag changes two squares each way for 48 screen pixels", async () => {
  const el = await canvas("T1");
  await doubled(el);
  const changes = events(el, "wt-table-resize");
  const handle = corner(el, "bottom-right");
  const at = centre(handle);
  pointer(handle, "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + 48, at.y + 48);
  pointer(window, "pointerup", 1, at.x + 48, at.y + 48);
  expect(changes).toEqual([{ key: "T1", x: 10, y: 10, width: 10, height: 10 }]);
});

it("a finger on a selected table's corner resizes it; once unselected, a finger at the same spot, on the grid, pans", async () => {
  const el = await canvas("T1");
  const changes = events(el, "wt-table-resize");
  const selections = events(el, "wt-table-select");
  const moves = events(el, "wt-table-move");
  const at = centre(corner(el, "bottom-right"));
  pointer(corner(el, "bottom-right"), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + 24, at.y + 24);
  pointer(window, "pointerup", 1, at.x + 24, at.y + 24);
  expect(changes).toEqual([{ key: "T1", x: 10, y: 10, width: 10, height: 10 }]);
  el.selected = null;
  await el.updateComplete;
  const before = button(el).getBoundingClientRect();
  const target = el.shadowRoot!.elementFromPoint(at.x, at.y)!;
  pointer(target, "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 24, at.y - 36);
  await el.updateComplete;
  const after = button(el).getBoundingClientRect();
  pointer(window, "pointerup", 1, at.x - 24, at.y - 36);
  expect(changes).toHaveLength(1);
  expect(moves).toEqual([]);
  expect(selections).toEqual([]);
  expect(after.left).toBeCloseTo(before.left - 24);
  expect(after.top).toBeCloseTo(before.top - 36);
});

it("at twice the zoom a turn still follows the table's visible centre", async () => {
  const el = await canvas("T1");
  await doubled(el);
  const turns = events(el, "wt-table-rotate");
  const at = centre(button(el));
  pointer(part(el, "rotate-handle"), "pointerdown", 1, at.x, at.y - 100);
  pointer(window, "pointermove", 1, at.x + 100, at.y);
  pointer(window, "pointerup", 1, at.x + 100, at.y);
  expect(turns).toEqual([{ key: "T1", rotation: 90, x: 10, y: 10 }]);
});

it("Ctrl+wheel zooms around the pointer and plain wheel pans", async () => {
  const el = await canvas();
  const at = centre(button(el));
  wheel(el, -100);
  await el.updateComplete;
  expect(button(el).getBoundingClientRect().width).toBe(192);
  expect(centre(button(el))).toEqual(at);
  const top = button(el).getBoundingClientRect().top;
  wheel(el, 36, false);
  await el.updateComplete;
  expect(button(el).getBoundingClientRect().top).toBe(top - 36);
});

it("a native click following a touch pan cannot select or clear a table", async () => {
  const el = await canvas();
  const selections = events(el, "wt-table-select");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 24, at.y);
  pointer(window, "pointerup", 1, at.x - 24, at.y);
  button(el).dispatchEvent(
    new PointerEvent("click", { bubbles: true, composed: true, pointerType: "touch", detail: 1 }),
  );
  part(el, "grid").dispatchEvent(
    new PointerEvent("click", { bubbles: true, composed: true, pointerType: "touch", detail: 1 }),
  );
  expect(selections).toEqual([]);
});

it("a finger that pauses before moving still pans instead of moving an unselected table", async () => {
  const el = await canvas();
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    pointer(button(el), "pointerdown", 1, at.x, at.y);
    vi.advanceTimersByTime(500);
    pointer(window, "pointermove", 1, at.x - 24, at.y - 12);
    pointer(window, "pointermove", 1, at.x - 48, at.y - 36);
    pointer(window, "pointerup", 1, at.x - 48, at.y - 36);
    await el.updateComplete;
    expect(part(el, "viewport").scrollLeft).toBe(48);
    expect(part(el, "viewport").scrollTop).toBe(36);
    expect(moves).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("a native click after a touch tap does not select the same table twice", async () => {
  const el = await canvas();
  const selections = events(el, "wt-table-select");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointerup", 1, at.x, at.y);
  button(el).dispatchEvent(
    new PointerEvent("click", { bubbles: true, composed: true, pointerType: "touch", detail: 1 }),
  );
  expect(selections).toEqual([{ key: "T1" }]);
});

it("two successive empty-grid touch taps each clear the selection", async () => {
  const el = await canvas("T1");
  const selections = events(el, "wt-table-select");
  const at = centre(part(el, "viewport"));
  for (let i = 0; i < 2; i++) {
    pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y);
    pointer(window, "pointerup", 1, at.x, at.y);
  }
  expect(selections).toEqual([{ key: null }, { key: null }]);
});

it("a pen pans an unselected table and taps it to select, then drags it", async () => {
  const el = await canvas();
  const moves = events(el, "wt-table-move");
  const selections = events(el, "wt-table-select");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y, "pen");
  pointer(window, "pointermove", 1, at.x - 24, at.y, "pen");
  pointer(window, "pointerup", 1, at.x - 24, at.y, "pen");
  expect(moves).toEqual([]);
  pointer(button(el), "pointerdown", 1, at.x, at.y, "pen");
  pointer(window, "pointerup", 1, at.x, at.y, "pen");
  expect(selections).toEqual([{ key: "T1" }]);
  el.selected = "T1";
  await el.updateComplete;
  pointer(button(el), "pointerdown", 1, at.x, at.y, "pen");
  pointer(window, "pointermove", 1, at.x + 12, at.y, "pen");
  pointer(window, "pointerup", 1, at.x + 12, at.y, "pen");
  expect(moves).toEqual([{ key: "T1", x: 11, y: 10 }]);
});

it("a mouse drags an unselected table straight away at twice the zoom", async () => {
  const el = await canvas();
  await doubled(el);
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y, "mouse");
  pointer(window, "pointermove", 1, at.x + 24, at.y - 48, "mouse");
  pointer(window, "pointerup", 1, at.x + 24, at.y - 48, "mouse");
  expect(moves).toEqual([{ key: "T1", x: 11, y: 8 }]);
});

it("wheel zoom stays between half and four times the original grid", async () => {
  const el = await canvas();
  wheel(el, -10000);
  await el.updateComplete;
  expect(button(el).getBoundingClientRect().width).toBe(384);
  wheel(el, 10000);
  await el.updateComplete;
  expect(button(el).getBoundingClientRect().width).toBe(48);
});

it("zoomed to half, the blank margin still ends where a table at x 0 is drawn", async () => {
  const el = await canvas();
  el.tables = [table("T1", 0, 0)];
  await settled(el);
  wheel(el, 10000);
  await settled(el);
  const grid = part(el, "grid");
  const g = grid.getBoundingClientRect();
  const b = button(el).getBoundingClientRect();
  const style = getComputedStyle(grid);
  expect(b.width).toBe(48);
  expect(parseFloat(style.paddingLeft) / 2).toBeCloseTo(b.left - g.left);
  expect(parseFloat(style.paddingTop) / 2).toBeCloseTo(b.top - g.top);
});

it("an empty zoomed-out grid still fills the viewport without scrollbars", async () => {
  const el = await canvas();
  el.tables = [];
  await el.updateComplete;
  part(el, "viewport").dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, ctrlKey: true, deltaY: 100 }),
  );
  await settled(el);
  const viewport = part(el, "viewport");
  expect(part(el, "grid").getBoundingClientRect().width).toBe(600);
  expect(part(el, "grid").getBoundingClientRect().height).toBe(360);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
});

it("zooming preserves the bottom overlay's allowance in screen pixels", async () => {
  const el = await canvas();
  await doubled(el);
  const before = part(el, "viewport").scrollHeight;
  el.bottomInset = 120;
  await el.updateComplete;
  expect(part(el, "viewport").scrollHeight - before).toBe(120);
});

it("a refused table's reason stays centred beneath it after zooming", async () => {
  const el = await canvas();
  el.tables = [{ ...el.tables[0]!, refused: "Booked at 21:00" }, el.tables[1]!];
  await el.updateComplete;
  await doubled(el);
  const reason = part(el, "refused-reason").getBoundingClientRect();
  const box = button(el).getBoundingClientRect();
  expect(reason.left + reason.width / 2).toBeCloseTo(box.left + box.width / 2);
  expect(reason.top).toBeGreaterThanOrEqual(box.bottom);
});

it("panning back from the far edge responds without dragging through an overshoot", async () => {
  const el = await canvas();
  const viewport = part(el, "viewport");
  const at = centre(viewport);
  pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 5000, at.y - 5000);
  pointer(window, "pointermove", 1, at.x - 4976, at.y - 4988);
  pointer(window, "pointerup", 1, at.x - 4976, at.y - 4988);
  await el.updateComplete;
  expect(viewport.scrollLeft).toBe(viewport.scrollWidth - viewport.clientWidth - 24);
  expect(viewport.scrollTop).toBe(viewport.scrollHeight - viewport.clientHeight - 12);
});

it("wheel motion in lines and pages uses screen distances on both axes", async () => {
  const el = await canvas();
  const viewport = part(el, "viewport");
  viewport.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      composed: true,
      cancelable: true,
      deltaX: 2,
      deltaY: 3,
      deltaMode: 1,
    }),
  );
  await el.updateComplete;
  expect(viewport.scrollLeft).toBe(32);
  expect(viewport.scrollTop).toBe(48);
  viewport.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      composed: true,
      cancelable: true,
      deltaX: 0.5,
      deltaY: 0.5,
      deltaMode: 2,
    }),
  );
  await el.updateComplete;
  expect(viewport.scrollLeft).toBe(332);
  expect(viewport.scrollTop).toBe(228);
});

it("a cancelled touch and a disconnected canvas cannot keep moving the view", async () => {
  const el = await canvas();
  const viewport = part(el, "viewport");
  const at = centre(viewport);
  pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointercancel", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 24, at.y);
  await el.updateComplete;
  expect(viewport.scrollLeft).toBe(0);
  pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y);
  el.remove();
  pointer(window, "pointermove", 1, at.x - 24, at.y);
  await el.updateComplete;
  expect(viewport.scrollLeft).toBe(0);
});

it("a pinch starting on empty grid cannot turn its second finger on a selected table into a move", async () => {
  const el = await canvas("T1");
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(part(el, "grid"), "pointerdown", 1, at.x - 100, at.y);
  pointer(button(el), "pointerdown", 2, at.x, at.y);
  pointer(window, "pointermove", 2, at.x + 100, at.y);
  pointer(window, "pointerup", 2, at.x + 100, at.y);
  pointer(window, "pointerup", 1, at.x - 100, at.y);
  await el.updateComplete;
  expect(moves).toEqual([]);
  expect(button(el).getBoundingClientRect().width).toBe(192);
});

it("an extra finger on a selected table cannot edit it while a pinch is waiting for all fingers to lift", async () => {
  const el = await canvas("T1");
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(part(el, "grid"), "pointerdown", 1, at.x - 48, at.y);
  pointer(part(el, "grid"), "pointerdown", 2, at.x + 48, at.y);
  pointer(window, "pointerup", 1, at.x - 48, at.y);
  pointer(button(el), "pointerdown", 3, at.x, at.y);
  pointer(window, "pointermove", 3, at.x + 24, at.y);
  pointer(window, "pointerup", 3, at.x + 24, at.y);
  pointer(window, "pointerup", 2, at.x + 48, at.y);
  expect(moves).toEqual([]);
  pointer(button(el), "pointerdown", 4, at.x, at.y);
  pointer(window, "pointermove", 4, at.x + 24, at.y);
  pointer(window, "pointerup", 4, at.x + 24, at.y);
  expect(moves).toEqual([{ key: "T1", x: 12, y: 10 }]);
});

it("zooming out keeps the turn handle and resize targets at their token sizes", async () => {
  const el = await canvas("T1");
  el.style.setProperty("--wt-tap-min", "60px");
  el.style.setProperty("--wt-space-5", "28px");
  wheel(el, 100);
  await el.updateComplete;
  const arrow = part(el, "rotate-handle").getBoundingClientRect();
  expect(arrow.width).toBe(60);
  expect(arrow.height).toBe(60);
  const areas = el.shadowRoot!.querySelectorAll<HTMLElement>(
    '[part="resize-handle"], [part="resize-corner-handle"]',
  );
  expect(areas).toHaveLength(8);
  for (const handle of areas) {
    expect(handle.getBoundingClientRect().width).toBe(28);
    expect(handle.getBoundingClientRect().height).toBe(28);
  }
});

it("zooming out keeps the turn handle its token gap above the middle of the table's top side", async () => {
  const el = await canvas("T1");
  el.style.setProperty("--wt-space-5", "28px");
  el.style.setProperty("--wt-space-1", "6px");
  wheel(el, 100);
  await el.updateComplete;
  const arrow = part(el, "rotate-handle").getBoundingClientRect();
  const box = button(el).getBoundingClientRect();
  // --wt-space-5 / 2 + --wt-space-1: 14 + 6.
  expect(arrow.bottom).toBeCloseTo(box.top - 20, 0);
  expect(arrow.left + arrow.width / 2).toBeCloseTo(box.left + box.width / 2, 0);
});

it("zoomed-out handles at the plan's corner remain inside the grid", async () => {
  const el = await canvas("T1");
  el.tables = [
    { ...table("T1", 0, 0), placement: { ...table("T1", 0, 0).placement, rotation: 225 } },
  ];
  await el.updateComplete;
  wheel(el, 100);
  await el.updateComplete;
  const grid = part(el, "grid").getBoundingClientRect();
  const arrow = part(el, "rotate-handle").getBoundingClientRect();
  expect(arrow.width).toBeGreaterThanOrEqual(44);
  expect(arrow.left).toBeGreaterThanOrEqual(grid.left);
  expect(arrow.top).toBeGreaterThanOrEqual(grid.top);
});

it("a selected table's touch drag moves only the table and leaves the view still", async () => {
  const el = await canvas("T1");
  const viewport = part(el, "viewport");
  viewport.scrollLeft = 60;
  viewport.scrollTop = 60;
  const moves = events(el, "wt-table-move");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 24, at.y - 36);
  pointer(window, "pointerup", 1, at.x - 24, at.y - 36);
  await el.updateComplete;
  expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([60, 60]);
  expect(moves).toEqual([{ key: "T1", x: 8, y: 7 }]);
});

it("a mouse tap selects once through its native click", async () => {
  const el = await canvas();
  const selections = events(el, "wt-table-select");
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y, "mouse");
  pointer(window, "pointerup", 1, at.x, at.y, "mouse");
  button(el).dispatchEvent(
    new PointerEvent("click", { bubbles: true, composed: true, pointerType: "mouse", detail: 1 }),
  );
  expect(selections).toEqual([{ key: "T1" }]);
});

it("reconnecting the canvas installs one gesture listener and pans once", async () => {
  const el = await canvas();
  const parent = el.parentElement!;
  el.remove();
  parent.appendChild(el);
  await settled(el);
  const viewport = part(el, "viewport");
  const at = centre(viewport);
  pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 24, at.y - 36);
  pointer(window, "pointerup", 1, at.x - 24, at.y - 36);
  await el.updateComplete;
  expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([24, 36]);
});

it("wheel input during a table edit cannot change its scale or scroll", async () => {
  const el = await canvas("T1");
  const at = centre(button(el));
  const moves = events(el, "wt-table-move");
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  wheel(el, -100);
  wheel(el, 24, false);
  await el.updateComplete;
  expect(button(el).getBoundingClientRect().width).toBe(96);
  expect(part(el, "viewport").scrollTop).toBe(0);
  pointer(window, "pointermove", 1, at.x + 24, at.y);
  pointer(window, "pointerup", 1, at.x + 24, at.y);
  expect(moves).toEqual([{ key: "T1", x: 12, y: 10 }]);
});

it("a keyboard turn at twice zoom gives back only the corner margin already scrolled away", async () => {
  const el = await canvas("T1");
  el.tables = [
    {
      ...table("T1", 0, 0),
      placement: { ...table("T1", 0, 0).placement, width: 60, height: 60, rotation: 45 },
    },
    table("T2", 70, 0),
  ];
  el.addEventListener("wt-table-rotate", (event) => {
    const { key, rotation, x, y } = (event as CustomEvent<TableRotate>).detail;
    queueMicrotask(() => {
      el.tables = el.tables.map((t) =>
        t.key === key ? { ...t, placement: { ...t.placement, rotation, x, y } } : t,
      );
    });
  });
  await settled(el);
  await doubled(el);
  const viewport = part(el, "viewport");
  viewport.scrollLeft = 24;
  viewport.scrollTop = 24;
  await settled(el);
  const other = el.shadowRoot!.querySelector<HTMLElement>('[data-key="T2"]')!;
  const before = centre(other);
  part(el, "rotate-handle").focus({ preventScroll: true });
  await userEvent.keyboard("{ArrowLeft}");
  await settled(el);
  expect(el.tables[0]!.placement.rotation).toBe(30);
  expect(centre(other)).toEqual(before);
});

it("at twice zoom a corner-bound table stops at (2, 2), where its drawn outline meets the plan's edge", async () => {
  const el = await canvas("T1");
  el.tables = [
    { ...table("T1", 10, 10), placement: { ...table("T1", 10, 10).placement, rotation: 45 } },
    table("T2", 26, 0),
  ];
  await settled(el);
  await doubled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  const scroll = [part(el, "viewport").scrollLeft, part(el, "viewport").scrollTop];
  const at = centre(button(el));
  pointer(button(el), "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x - 240, at.y - 240);
  await el.updateComplete;
  expect(centre(button(el)).x).toBeCloseTo(at.x - 192);
  expect(centre(button(el)).y).toBeCloseTo(at.y - 192);
  const now = part(el, "grid").getBoundingClientRect();
  expect({ width: now.width, height: now.height }).toEqual({
    width: grid.width,
    height: grid.height,
  });
  expect([part(el, "viewport").scrollLeft, part(el, "viewport").scrollTop]).toEqual(scroll);
  pointer(window, "pointercancel", 1, at.x - 240, at.y - 240);
});

it("a mouse can pan empty grid and its release click clears the selection", async () => {
  const el = await canvas("T1");
  const selections = events(el, "wt-table-select");
  const at = centre(part(el, "viewport"));
  pointer(part(el, "grid"), "pointerdown", 1, at.x, at.y, "mouse");
  pointer(window, "pointermove", 1, at.x - 48, at.y - 24, "mouse");
  pointer(window, "pointerup", 1, at.x - 48, at.y - 24, "mouse");
  part(el, "grid").dispatchEvent(
    new PointerEvent("click", { bubbles: true, composed: true, pointerType: "mouse", detail: 1 }),
  );
  await el.updateComplete;
  expect([part(el, "viewport").scrollLeft, part(el, "viewport").scrollTop]).toEqual([48, 24]);
  expect(selections).toEqual([{ key: null }]);
});

it("a zoomed-out grid keeps a screen pixel for each line and a full-size turn symbol", async () => {
  const el = await canvas("T1");
  el.style.setProperty("--wt-font-size-lg", "24px");
  wheel(el, 100);
  await el.updateComplete;
  const scale = button(el).getBoundingClientRect().width / 96;
  const image = getComputedStyle(part(el, "grid")).backgroundImage;
  const stroke = Number(image.match(/([\d.]+)px/)![1]);
  expect.soft(stroke * scale).toBeGreaterThanOrEqual(1);
  const icon = part(el, "rotate-handle").querySelector<HTMLElement>("wt-icon")!;
  expect(icon.getBoundingClientRect().width).toBe(24);
  expect(icon.getBoundingClientRect().height).toBe(24);
});

it("a fractional-width refusal remains centred after zoom without rounding its left edge", async () => {
  const el = await canvas();
  el.tables = [{ ...el.tables[0]!, refused: "Booked at 21:00" }, el.tables[1]!];
  await el.updateComplete;
  await doubled(el);
  const reason = part(el, "refused-reason");
  reason.style.width = "99.9921875px";
  el.requestUpdate();
  await el.updateComplete;
  const text = reason.getBoundingClientRect();
  const box = button(el).getBoundingClientRect();
  expect(text.left + text.width / 2).toBeCloseTo(box.left + box.width / 2);
});

const pokingOut: PlanCanvasTable = {
  ...table("Corner", 0, 0),
  placement: { ...table("Corner", 0, 0).placement, rotation: 45 },
};

/** `T1` at (20, 10) in a box `style`, at zoom 1 or doubled, pressed with a mouse and moved two
 *  squares right and down without release; returns the pointer. */
async function draggingIn(style: string, zoom: number) {
  const el = (await mount(
    `<wt-floor-plan-canvas style="${style}"></wt-floor-plan-canvas>`,
  )) as WtFloorPlanCanvas;
  el.tables = [table("T1", 20, 10)];
  await settled(el);
  await settled(el);
  if (zoom === 2) await doubled(el);
  await settled(el);
  const viewport = part(el, "viewport");
  const grid = part(el, "grid").getBoundingClientRect();
  const before = {
    grid: { width: grid.width, height: grid.height },
    scroll: { width: viewport.scrollWidth, height: viewport.scrollHeight },
  };
  const from = centre(button(el));
  const to = { x: from.x + 24 * zoom, y: from.y + 24 * zoom };
  pointer(button(el), "pointerdown", 1, from.x, from.y, "mouse");
  pointer(window, "pointermove", 1, to.x, to.y, "mouse");
  await settled(el);
  return { el, to, before };
}

const offsetOf = (el: WtFloorPlanCanvas, node: Element) => {
  const grid = part(el, "grid").getBoundingClientRect();
  const box = node.getBoundingClientRect();
  return { left: box.left - grid.left, top: box.top - grid.top };
};

it.each([1, 2])(
  "at zoom %i, a table that pokes out set by the parent during a drag grows the room, scrolled away under the pointer, and an undo gives it back",
  async (zoom) => {
    const { el, to, before } = await draggingIn("width: 600px; height: 360px", zoom);
    const viewport = part(el, "viewport");
    const room = offsetOf(el, button(el));
    const scroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
    const under = centre(button(el));
    el.tables = [table("T1", 20, 10), pokingOut];
    await settled(el);
    await settled(el);
    expect(offsetOf(el, button(el))).toEqual({
      left: room.left + 24 * zoom,
      top: room.top + 24 * zoom,
    });
    expect({ left: viewport.scrollLeft, top: viewport.scrollTop }).toEqual({
      left: scroll.left + 24 * zoom,
      top: scroll.top + 24 * zoom,
    });
    expect(centre(button(el))).toEqual(under);
    const corner = el.shadowRoot!.querySelector('[data-key="Corner"]')!.getBoundingClientRect();
    const now = part(el, "grid").getBoundingClientRect();
    expect(corner.left).toBeGreaterThanOrEqual(now.left);
    expect(corner.top).toBeGreaterThanOrEqual(now.top);
    pointer(window, "pointerup", 1, to.x, to.y, "mouse");
    await settled(el);
    el.tables = [table("T1", 20, 10)];
    await settled(el);
    await settled(el);
    const back = part(el, "grid").getBoundingClientRect();
    expect({ width: back.width, height: back.height }).toEqual(before.grid);
    expect({ width: viewport.scrollWidth, height: viewport.scrollHeight }).toEqual(before.scroll);
  },
);

it("a table that pokes out only on the left, set by the parent during a drag, grows the room on the left alone, scrolled away under the pointer", async () => {
  const { el } = await draggingIn("width: 600px; height: 360px", 1);
  const viewport = part(el, "viewport");
  const room = offsetOf(el, button(el));
  const scroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
  const under = centre(button(el));
  const leftOnly: PlanCanvasTable = {
    ...table("Corner", 0, 20),
    placement: { ...table("Corner", 0, 20).placement, rotation: 45 },
  };
  el.tables = [table("T1", 20, 10), leftOnly];
  await settled(el);
  await settled(el);
  expect(offsetOf(el, button(el))).toEqual({ left: room.left + 24, top: room.top });
  expect({ left: viewport.scrollLeft, top: viewport.scrollTop }).toEqual({
    left: scroll.left + 24,
    top: scroll.top,
  });
  expect(centre(button(el))).toEqual(under);
});

it.each([
  ["an undo of a drop", true],
  ["a refused drop", false],
])(
  "the room a parent-set table grew during a drag stays after the release, and %s gives it back",
  async (_, applied) => {
    const { el, to, before } = await draggingIn("width: 600px; height: 360px", 1);
    const viewport = part(el, "viewport");
    // T1 drawn at its draft, (22, 12).
    const room = offsetOf(el, button(el));
    const square = (dx: number, dy: number) => ({
      left: room.left + 12 * dx,
      top: room.top + 12 * dy,
    });
    el.tables = [table("T1", 20, 10), pokingOut];
    await settled(el);
    el.tables = [table("T1", 20, 10)];
    await settled(el);
    expect(offsetOf(el, button(el))).toEqual(square(2, 2));
    pointer(window, "pointerup", 1, to.x, to.y, "mouse");
    await settled(el);
    await settled(el);
    // Back at (20, 10) until the parent answers, with the two squares of room kept.
    expect(offsetOf(el, button(el))).toEqual(square(0, 0));
    if (applied) {
      el.tables = [table("T1", 22, 12)];
      await settled(el);
      await settled(el);
      expect(offsetOf(el, button(el))).toEqual(square(2, 2));
    }
    el.tables = [table("T1", 20, 10)];
    await settled(el);
    await settled(el);
    expect(offsetOf(el, button(el))).toEqual(square(-2, -2));
    const back = part(el, "grid").getBoundingClientRect();
    expect({ width: back.width, height: back.height }).toEqual(before.grid);
    expect({ width: viewport.scrollWidth, height: viewport.scrollHeight }).toEqual(before.scroll);
  },
);

it.each([1, 2])(
  "at zoom %i, a table that pokes out set by the parent during a drag grows a box that takes its height from the plan once, and steadily",
  async (zoom) => {
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.message);
    window.addEventListener("error", onError);
    onTestFinished(() => window.removeEventListener("error", onError));
    const { el, to } = await draggingIn("width: 600px", zoom);
    const start = part(el, "grid").getBoundingClientRect().height;
    const under = centre(button(el));
    el.tables = [table("T1", 20, 10), pokingOut];
    const heights: number[] = [];
    for (let frame = 0; frame < 6; frame++) {
      await settled(el);
      heights.push(part(el, "grid").getBoundingClientRect().height);
    }
    // With no height of its own the box cannot scroll the room away, so the table drops below the
    // pointer by the room.
    expect(centre(button(el)).y).toBeCloseTo(under.y + 24 * zoom, 1);
    pointer(window, "pointerup", 1, to.x, to.y, "mouse");
    for (let frame = 0; frame < 4; frame++) {
      await settled(el);
      heights.push(part(el, "grid").getBoundingClientRect().height);
    }
    expect(heights.at(-1)).toBe(start + 24 * zoom);
    expect(Math.max(...heights)).toBe(start + 24 * zoom);
    expect(Math.min(...heights)).toBe(start + 24 * zoom);
    expect(errors).toEqual([]);
  },
);

function overlap(a: DOMRect, b: DOMRect): number {
  const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return Math.max(0, across) * Math.max(0, down);
}

const refusedAt = (rotation: number, y: number): PlanCanvasTable => ({
  ...table("T1", 10, y),
  refused: "Table is in use",
  placement: { ...table("T1", 10, y).placement, height: 4, rotation },
});

const ZOOMS = [
  [0.5, 10000],
  [1, 0],
  [4, -10000],
] as const;

/** A refused 8 × 4 `T1` at (10, `y`) turned `rotation`, at `zoom` (reached by a Ctrl+wheel of
 *  `deltaY`), with --wt-space-1 4px and --wt-space-5 24px; selected, it shows its size badge after
 *  a keyboard resize the parent does not apply. */
async function feedbackCanvas(
  deltaY: number,
  { y = 10, rotation = 0, selected = true } = {},
): Promise<WtFloorPlanCanvas> {
  const el = (await mount(
    '<wt-floor-plan-canvas style="width: 600px; height: 500px; --wt-space-1: 4px; --wt-space-5: 24px"></wt-floor-plan-canvas>',
  )) as WtFloorPlanCanvas;
  el.tables = [refusedAt(rotation, y)];
  el.selected = selected ? "T1" : null;
  await settled(el);
  if (deltaY !== 0) {
    wheel(el, deltaY);
    await settled(el);
  }
  if (selected) {
    button(el).focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await settled(el);
  }
  return el;
}

it.each(ZOOMS)(
  "at zoom %s, a selected table's size badge and refusal sit clear of its turn arrow at every turn, moved only where the arrow reaches lower than the table and its dots",
  async (zoom, deltaY) => {
    const el = await feedbackCanvas(deltaY);
    // The bottom dot's hit area reaches --wt-space-5 / 2, at the control scale, past the table.
    const dot = 12 * Math.max(1, 1 / zoom) * zoom;
    let moved = 0;
    for (let rotation = 0; rotation < 360; rotation += 15) {
      el.tables = [refusedAt(rotation, 10)];
      await el.updateComplete;
      const at = `${rotation}°`;
      const arrow = part(el, "rotate-handle").getBoundingClientRect();
      const badge = part(el, "size-badge").getBoundingClientRect();
      const reason = part(el, "refused-reason").getBoundingClientRect();
      const box = button(el).getBoundingClientRect();
      expect(overlap(arrow, badge), at).toBe(0);
      expect(overlap(arrow, reason), at).toBe(0);
      expect(overlap(badge, reason), at).toBe(0);
      expect(badge.top, at).toBeCloseTo(Math.max(box.bottom + dot, arrow.bottom) + 4 * zoom, 0);
      if (arrow.bottom > box.bottom + dot) moved++;
    }
    // The turns whose arrow reaches below the dots, so both rules were checked.
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(24);
  },
);

it("an unselected refused table turned 180° keeps its reason one --wt-space-1 under it, with no turn arrow to clear", async () => {
  const el = await feedbackCanvas(0, { rotation: 180, selected: false });
  expect(el.shadowRoot!.querySelector('[part="rotate-handle"]')).toBeNull();
  const box = button(el).getBoundingClientRect();
  expect(part(el, "refused-reason").getBoundingClientRect().top).toBeCloseTo(box.bottom + 4, 0);
});

it.each(ZOOMS)(
  "at zoom %s, the grid runs 8 squares past the lowest table or, lower still, its turn arrow, selected or not, so it holds the size badge and refusal at every turn and scrolls no further",
  async (zoom, deltaY) => {
    const unselected = await feedbackCanvas(deltaY, { y: 200, rotation: 180, selected: false });
    const plain = part(unselected, "grid").getBoundingClientRect().height;
    cleanup();
    const el = await feedbackCanvas(deltaY, { y: 200, rotation: 180 });
    expect(part(el, "grid").getBoundingClientRect().height).toBe(plain);
    const square = 12 * zoom;
    let lower = 0;
    for (let rotation = 0; rotation < 360; rotation += 15) {
      el.tables = [refusedAt(rotation, 200)];
      await el.updateComplete;
      const at = `${rotation}°`;
      const grid = part(el, "grid").getBoundingClientRect();
      const box = button(el).getBoundingClientRect();
      const arrow = part(el, "rotate-handle").getBoundingClientRect();
      const lowest = (Math.max(box.bottom, arrow.bottom) - grid.top) / square;
      expect(grid.height / square, at).toBe(Math.ceil(lowest - 0.01) + 8);
      for (const name of ["size-badge", "refused-reason"]) {
        const bottom = part(el, name).getBoundingClientRect().bottom;
        expect(bottom, `${at} ${name}`).toBeLessThanOrEqual(grid.bottom);
      }
      expect(part(el, "viewport").scrollHeight, at).toBe(grid.height);
      if (arrow.bottom > box.bottom) lower++;
    }
    expect(lower).toBeGreaterThan(0);
  },
);

it.each([
  [180, ...ZOOMS[0]],
  [180, ...ZOOMS[1]],
  [180, ...ZOOMS[2]],
  [90, ...ZOOMS[0]],
  [90, ...ZOOMS[1]],
  [90, ...ZOOMS[2]],
])(
  "a table turned %s° at zoom %s, scrolled to the grid's far corner, stays put when the selection is cleared",
  async (rotation, _zoom, deltaY) => {
    const el = (await mount(
      '<wt-floor-plan-canvas style="width: 600px; height: 300px"></wt-floor-plan-canvas>',
    )) as WtFloorPlanCanvas;
    el.tables = [
      {
        ...table("T1", 200, 200),
        placement: { ...table("T1", 200, 200).placement, height: 4, rotation },
      },
    ];
    el.selected = "T1";
    await settled(el);
    if (deltaY !== 0) {
      wheel(el, deltaY);
      await settled(el);
    }
    const viewport = part(el, "viewport");
    viewport.scrollLeft = viewport.scrollWidth;
    viewport.scrollTop = viewport.scrollHeight;
    await settled(el);
    const before = button(el).getBoundingClientRect();
    el.selected = null;
    await settled(el);
    const after = button(el).getBoundingClientRect();
    expect({ left: after.left, top: after.top }).toEqual({ left: before.left, top: before.top });
  },
);

it.each(
  ZOOMS.flatMap(([zoom, deltaY]) => [8, 1].map((side) => [side, side, zoom, deltaY] as const)),
)(
  "a %s × %s table at zoom %s: the grid runs 8 squares right of and below the table or, further still, its turn arrow, and scrolls no further, at every turn",
  async (side, _side, zoom, deltaY) => {
    const el = (await mount(
      '<wt-floor-plan-canvas style="width: 600px; height: 300px"></wt-floor-plan-canvas>',
    )) as WtFloorPlanCanvas;
    const at200 = (rotation: number): PlanCanvasTable => ({
      ...table("T1", 200, 200),
      placement: { ...table("T1", 200, 200).placement, width: side, height: side, rotation },
    });
    el.tables = [at200(0)];
    el.selected = "T1";
    await settled(el);
    if (deltaY !== 0) {
      wheel(el, deltaY);
      await settled(el);
    }
    const square = 12 * zoom;
    let further = 0;
    for (let rotation = 0; rotation < 360; rotation += 15) {
      el.tables = [at200(rotation)];
      await el.updateComplete;
      const at = `${rotation}°`;
      const grid = part(el, "grid").getBoundingClientRect();
      const box = button(el).getBoundingClientRect();
      const arrow = part(el, "rotate-handle").getBoundingClientRect();
      const rightmost = (Math.max(box.right, arrow.right) - grid.left) / square;
      const lowest = (Math.max(box.bottom, arrow.bottom) - grid.top) / square;
      expect(grid.width / square, at).toBe(Math.ceil(rightmost - 0.01) + 8);
      expect(grid.height / square, at).toBe(Math.ceil(lowest - 0.01) + 8);
      expect(arrow.right, at).toBeLessThanOrEqual(grid.right);
      const viewport = part(el, "viewport");
      expect({ width: viewport.scrollWidth, height: viewport.scrollHeight }, at).toEqual({
        width: grid.width,
        height: grid.height,
      });
      if (arrow.right > box.right) further++;
    }
    expect(further).toBeGreaterThan(0);
  },
);

it.each(ZOOMS)(
  "at zoom %s, a table at the plan's (0, 0) keeps its turn arrow inside the grid's top and left at every turn",
  async (_zoom, deltaY) => {
    const el = await canvas("T1");
    if (deltaY !== 0) {
      wheel(el, deltaY);
      await settled(el);
    }
    for (let rotation = 0; rotation < 360; rotation += 15) {
      el.tables = [
        { ...table("T1", 0, 0), placement: { ...table("T1", 0, 0).placement, rotation } },
      ];
      await el.updateComplete;
      const grid = part(el, "grid").getBoundingClientRect();
      const arrow = part(el, "rotate-handle").getBoundingClientRect();
      expect(arrow.left, `${rotation}°`).toBeGreaterThanOrEqual(grid.left);
      expect(arrow.top, `${rotation}°`).toBeGreaterThanOrEqual(grid.top);
    }
  },
);

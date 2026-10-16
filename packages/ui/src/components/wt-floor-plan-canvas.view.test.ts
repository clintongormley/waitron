import { afterEach, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { PlanCanvasTable, WtFloorPlanCanvas } from "./wt-floor-plan-canvas.js";
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

it("at twice the zoom a turn still follows the table's visible centre", async () => {
  const el = await canvas("T1");
  await doubled(el);
  const turns = events(el, "wt-table-rotate");
  const at = centre(button(el));
  pointer(part(el, "rotate-handle"), "pointerdown", 1, at.x, at.y - 100);
  pointer(window, "pointermove", 1, at.x + 100, at.y);
  pointer(window, "pointerup", 1, at.x + 100, at.y);
  expect(turns).toEqual([{ key: "T1", rotation: 90 }]);
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

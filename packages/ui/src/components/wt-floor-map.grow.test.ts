import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, mountInShadowRoot } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapDrop, FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

const t = (id: string, label: string, placement: Partial<PlanPlacement> = {}): FloorMapTable => ({
  id,
  label,
  placement: { x: 0, y: 0, width: 8, height: 4, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  dot: null,
  joinId: null,
  description: "Free",
});

// T1 is drawn at left 150, top 75, 37.5 px a square: its 12 × 8 crop fitted in 600 × 300.
const t1 = t("t1", "T1", { x: 10, y: 5 });

let drops: FloorMapDrop[];
const onDrop = (e: Event) => drops.push((e as CustomEvent<FloorMapDrop>).detail);

beforeEach(() => {
  drops = [];
  document.addEventListener("wt-table-drag-end", onDrop);
});

afterEach(() => {
  document.removeEventListener("wt-table-drag-end", onDrop);
  vi.useRealTimers();
  cleanup();
});

async function settled(el: WtFloorMap): Promise<void> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

async function map(tables: FloorMapTable[]): Promise<WtFloorMap> {
  const el = (await mountInShadowRoot(
    `<wt-floor-map style="width: 600px; height: 300px"></wt-floor-map>`,
  )) as WtFloorMap;
  el.tables = tables;
  await settled(el);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return el;
}

const ratioOf = (el: WtFloorMap) => el.style.getPropertyValue("--floor-map-ratio");

const button = (el: WtFloorMap, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="table"][data-table-id="${id}"]`)!;

async function leftOf(el: WtFloorMap, id: string): Promise<number> {
  await el.updateComplete;
  return button(el, id).getBoundingClientRect().left - el.getBoundingClientRect().left;
}

function at(el: WtFloorMap, x: number, y: number): { clientX: number; clientY: number } {
  const box = el.getBoundingClientRect();
  return { clientX: box.left + x, clientY: box.top + y };
}

function pointer(target: EventTarget, type: string, client: object): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      ...client,
    }),
  );
}

function hold(el: WtFloorMap, x: number, y: number): void {
  const client = at(el, x, y);
  const target = el.shadowRoot!.elementFromPoint(client.clientX, client.clientY) ?? el;
  pointer(target, "pointerdown", client);
  vi.advanceTimersByTime(500);
}

const move = (el: WtFloorMap, x: number, y: number) => pointer(window, "pointermove", at(el, x, y));
const up = (el: WtFloorMap, x: number, y: number) => pointer(window, "pointerup", at(el, x, y));

function zoom(el: WtFloorMap, x: number, y: number, deltaY: number): void {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    composed: true,
    cancelable: true,
    ctrlKey: true,
    deltaY,
    ...at(el, x, y),
  });
  (el.shadowRoot!.elementFromPoint(event.clientX, event.clientY) ?? el).dispatchEvent(event);
}

it("publishes its tables' crop, width over height, as --floor-map-ratio on its own host", async () => {
  const el = await map([t1]);
  expect(Number(ratioOf(el))).toBe(12 / 8);
});

it("publishes a ratio of 1 with no tables", async () => {
  const el = await map([]);
  expect(ratioOf(el)).toBe("1");
});

it("publishes the new crop's ratio when the tables are replaced", async () => {
  const el = await map([t1]);
  el.tables = [t1, t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 })];
  await el.updateComplete;
  expect(Number(ratioOf(el))).toBe(20 / 8);
});

it("a drag keeps the travel it made before the scale changed", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  expect(await leftOf(el, "t1")).toBe(225);
  zoom(el, 300, 150, -100);
  const zoomed = await leftOf(el, "t1");
  move(el, 375, 150);
  expect(await leftOf(el, "t1")).toBe(zoomed);
  move(el, 375 + 2 * 75, 150);
  expect(await leftOf(el, "t1")).toBe(zoomed + 2 * 75);
  up(el, 375 + 2 * 75, 150);
  expect(drops).toEqual([{ tableId: "t1", x: 14, y: 5, targetId: null }]);
});

it("a move that changes no place still counts towards the travel kept when the scale changes", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 357, 150);
  move(el, 393, 150);
  zoom(el, 300, 150, -100);
  move(el, 398, 150);
  up(el, 398, 150);
  expect(drops).toEqual([{ tableId: "t1", x: 13, y: 5, targetId: null }]);
});

it("a second drag starts its travel afresh", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  zoom(el, 300, 150, -100);
  move(el, 525, 150);
  up(el, 525, 150);
  await el.updateComplete;
  const box = button(el, "t1").getBoundingClientRect();
  const outer = el.getBoundingClientRect();
  const x = box.left - outer.left + box.width / 2;
  const y = box.top - outer.top + box.height / 2;
  hold(el, x, y);
  move(el, x + 75, y);
  up(el, x + 75, y);
  expect(drops).toEqual([
    { tableId: "t1", x: 14, y: 5, targetId: null },
    { tableId: "t1", x: 11, y: 5, targetId: null },
  ]);
});

/** A host whose height follows the published ratio, as the till's CSS makes it. */
async function growingMap(tables: FloorMapTable[]): Promise<WtFloorMap> {
  const el = (await mountInShadowRoot(
    `<wt-floor-map style="display: block; width: 360px; aspect-ratio: var(--floor-map-ratio)"></wt-floor-map>`,
  )) as WtFloorMap;
  el.tables = tables;
  await settled(el);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return el;
}

function centreOf(el: WtFloorMap, id: string): { x: number; y: number } {
  const box = button(el, id).getBoundingClientRect();
  const outer = el.getBoundingClientRect();
  return { x: box.left - outer.left + box.width / 2, y: box.top - outer.top + box.height / 2 };
}

/** Holds `id` at its centre and moves the pointer `squares` across and down at the drawn scale. */
async function holdAndMove(el: WtFloorMap, id: string, across: number, down: number) {
  const scale = button(el, id).getBoundingClientRect().width / 8;
  const from = centreOf(el, id);
  hold(el, from.x, from.y);
  const to = { x: from.x + across * scale, y: from.y + down * scale };
  move(el, to.x, to.y);
  await settled(el);
  return { from, to };
}

function drawnInside(el: WtFloorMap, id: string): boolean {
  const box = button(el, id).getBoundingClientRect();
  const outer = el.getBoundingClientRect();
  return (
    box.left >= outer.left &&
    box.top >= outer.top &&
    box.right <= outer.right &&
    box.bottom <= outer.bottom
  );
}

const widthOf = (el: WtFloorMap, id: string) => button(el, id).getBoundingClientRect().width;
const heightOfHost = (el: WtFloorMap) => el.getBoundingClientRect().height;

// T1 in the growing host: its 12 × 8 crop at 30 px a square, the host 360 × 240. Kept inside the
// test page's 414 px width, past which a press finds no table.
it("grows the plan while a table is held past its right edge, and fits it", async () => {
  const el = await growingMap([t1]);
  expect(widthOf(el, "t1")).toBe(240);
  await holdAndMove(el, "t1", 4, 0);
  expect(Number(ratioOf(el))).toBe(16 / 8);
  expect(heightOfHost(el)).toBe(180);
  expect(widthOf(el, "t1")).toBe(180);
  expect(drawnInside(el, "t1")).toBe(true);
});

it("grows the plan while a table is held past its bottom edge, and fits it", async () => {
  const el = await growingMap([t1]);
  await holdAndMove(el, "t1", 0, 6);
  expect(Number(ratioOf(el))).toBe(12 / 14);
  expect(heightOfHost(el)).toBe(420);
  expect(drawnInside(el, "t1")).toBe(true);
});

it("a drag that grew the plan lands where it is drawn", async () => {
  const el = await growingMap([t1]);
  const { to } = await holdAndMove(el, "t1", 4, 0);
  up(el, to.x, to.y);
  expect(drops).toEqual([{ tableId: "t1", x: 14, y: 5, targetId: null }]);
});

it("dragging the edge table inward does not shrink the plan during the drag", async () => {
  const el = await growingMap([t1, t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 })]);
  const before = heightOfHost(el);
  const scale = widthOf(el, "t1") / 8;
  const from = centreOf(el, "t2");
  hold(el, from.x, from.y);
  move(el, from.x - 4 * scale, from.y);
  await settled(el);
  expect(Number(ratioOf(el))).toBe(20 / 8);
  expect(heightOfHost(el)).toBe(before);
});

it("a release whose new tables have the drag's crop keeps the view where the drag left it", async () => {
  // T0 holds the left edge, so the moved tables' crop is the drag's crop.
  const t0 = t("t0", "T0", { x: 0, y: 5, width: 4, height: 4 });
  const el = await growingMap([t0, t1]);
  const { to } = await holdAndMove(el, "t1", 4, 0);
  expect(Number(ratioOf(el))).toBe(26 / 8);
  const during = button(el, "t1").getBoundingClientRect();
  document.addEventListener(
    "wt-table-drag-end",
    () => (el.tables = [t0, { ...t1, placement: { ...t1.placement, x: 14 } }]),
    { once: true },
  );
  up(el, to.x, to.y);
  await settled(el);
  expect(Number(ratioOf(el))).toBe(26 / 8);
  expect(button(el, "t1").getBoundingClientRect().toJSON()).toEqual(during.toJSON());
  expect(drawnInside(el, "t1")).toBe(true);
});

it("a drag out and back, released on the same tables, returns to the tables' ratio and fit", async () => {
  const el = await growingMap([t1]);
  const { from, to } = await holdAndMove(el, "t1", 4, 0);
  expect(Number(ratioOf(el))).toBe(16 / 8);
  const scale = widthOf(el, "t1") / 8;
  move(el, to.x - 4 * scale, to.y);
  await settled(el);
  expect(Number(ratioOf(el))).toBe(16 / 8);
  up(el, to.x - 4 * scale, from.y);
  await settled(el);
  expect(drops).toEqual([{ tableId: "t1", x: 10, y: 5, targetId: null }]);
  expect(Number(ratioOf(el))).toBe(12 / 8);
  expect(heightOfHost(el)).toBe(240);
  expect(widthOf(el, "t1")).toBe(240);
});

it("after a pan, a drag past the edge changes neither the ratio nor the scale", async () => {
  const el = await growingMap([t1]);
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 20 });
  el.dispatchEvent(event);
  await settled(el);
  await holdAndMove(el, "t1", 4, 0);
  expect(Number(ratioOf(el))).toBe(12 / 8);
  expect(heightOfHost(el)).toBe(240);
  expect(widthOf(el, "t1")).toBe(240);
});

it("a fixed table's drag changes neither the ratio nor the scale", async () => {
  const el = await growingMap([{ ...t1, fixed: true }]);
  await holdAndMove(el, "t1", 4, 0);
  expect(Number(ratioOf(el))).toBe(12 / 8);
  expect(heightOfHost(el)).toBe(240);
  expect(widthOf(el, "t1")).toBe(240);
});

it("tables replaced mid-drag restart the drag's crop from the new tables", async () => {
  const el = await growingMap([t1, t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 })]);
  await holdAndMove(el, "t1", 2, 0);
  expect(Number(ratioOf(el))).toBe(20 / 8);
  el.tables = [t1];
  await settled(el);
  expect(Number(ratioOf(el))).toBe(14 / 8);
});

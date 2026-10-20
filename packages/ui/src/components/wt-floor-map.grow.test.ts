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
  outline: null,
  pulse: null,
  cue: null,
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

/** Holds `id` at its centre and moves the pointer `across` and `down` squares at the drawn scale. */
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

const marked = (el: WtFloorMap) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-drop-target]")].map(
    (b) => b.dataset["tableId"],
  );

it("a release after the plan refitted under a still finger drops on the table it marks", async () => {
  const t2 = t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 });
  const el = await growingMap([t1, t2]);
  const from = centreOf(el, "t1");
  const box = button(el, "t2").getBoundingClientRect();
  const outer = el.getBoundingClientRect();
  // Just inside T2's right edge, so the move takes T1 past the plan's edge.
  const to = { x: box.right - outer.left - 6, y: from.y };
  hold(el, from.x, from.y);
  move(el, to.x, to.y);
  await settled(el);
  expect(Number(ratioOf(el))).toBe(24 / 8);
  expect(marked(el)).toEqual(["t2"]);
  const client = at(el, to.x, to.y);
  // The refit has moved T2 out from under the finger.
  expect(
    el.shadowRoot!.elementsFromPoint(client.clientX, client.clientY).includes(button(el, "t2")),
  ).toBe(false);
  up(el, to.x, to.y);
  expect(drops).toEqual([{ tableId: "t1", x: 22, y: 5, targetId: "t2" }]);
});

it("a release after the marked table left the tables drops on no table", async () => {
  const t2 = t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 });
  const el = await growingMap([t1, t2]);
  const from = centreOf(el, "t1");
  const to = centreOf(el, "t2");
  hold(el, from.x, from.y);
  move(el, to.x, to.y);
  await settled(el);
  expect(marked(el)).toEqual(["t2"]);
  el.tables = [t1];
  await settled(el);
  expect(marked(el)).toEqual([]);
  up(el, to.x, to.y);
  expect(drops).toEqual([expect.objectContaining({ tableId: "t1", targetId: null })]);
});

it("a release after the marked table joined a merge it does not head drops on no table", async () => {
  const t2 = t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 });
  const el = await growingMap([t1, t2]);
  const from = centreOf(el, "t1");
  const to = centreOf(el, "t2");
  hold(el, from.x, from.y);
  move(el, to.x, to.y);
  await settled(el);
  expect(marked(el)).toEqual(["t2"]);
  // The merge is drawn as one button, headed by T0, the first label.
  el.tables = [
    t1,
    { ...t2, joinId: "j" },
    { ...t("t0", "T0", { x: 26, y: 5, width: 4, height: 4 }), joinId: "j" },
  ];
  await settled(el);
  expect(marked(el)).toEqual([]);
  up(el, to.x, to.y);
  expect(drops).toEqual([expect.objectContaining({ tableId: "t1", targetId: null })]);
});

it("a fixed table's drag draws no line to a marked table that joined a merge it does not head", async () => {
  const t2 = t("t2", "T2", { x: 22, y: 5, width: 4, height: 4 });
  const fixed = { ...t1, fixed: true };
  const el = await growingMap([fixed, t2]);
  const from = centreOf(el, "t1");
  const to = centreOf(el, "t2");
  hold(el, from.x, from.y);
  move(el, to.x, to.y);
  await settled(el);
  expect(marked(el)).toEqual(["t2"]);
  expect(el.shadowRoot!.querySelector('[part="drag-link"]')).not.toBeNull();
  el.tables = [
    fixed,
    { ...t2, joinId: "j" },
    { ...t("t0", "T0", { x: 26, y: 5, width: 4, height: 4 }), joinId: "j" },
  ];
  await settled(el);
  expect(marked(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector('[part="drag-link"]')).toBeNull();
  up(el, to.x, to.y);
  expect(drops).toEqual([expect.objectContaining({ tableId: "t1", targetId: null })]);
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

/** Drags T1 3 squares right (ratio 15 / 8), then 2 down: the drag's crop is 15 × 10, ratio 3 / 2
 * again, so the host is back to its first size while the view is fitted to that crop. */
async function dragAnL(el: WtFloorMap): Promise<{ x: number; y: number }> {
  const { to } = await holdAndMove(el, "t1", 3, 0);
  expect(widthOf(el, "t1")).toBe(192);
  const end = { x: to.x, y: to.y + 2 * 24 };
  move(el, end.x, end.y);
  await settled(el);
  expect(Number(ratioOf(el))).toBe(12 / 8);
  expect(widthOf(el, "t1")).toBe(192);
  return end;
}

it("an L-shaped drag released on the same tables returns to the tables' fit", async () => {
  const el = await growingMap([t1]);
  const end = await dragAnL(el);
  up(el, end.x, end.y);
  await settled(el);
  expect(drops).toEqual([{ tableId: "t1", x: 13, y: 7, targetId: null }]);
  expect(heightOfHost(el)).toBe(240);
  expect(widthOf(el, "t1")).toBe(240);
});

it("an L-shaped drag released where the parent moves the table fits the moved tables", async () => {
  const el = await growingMap([t1]);
  const end = await dragAnL(el);
  // The till sets the pending place in its drop handler and re-renders the map a microtask later.
  document.addEventListener(
    "wt-table-drag-end",
    () =>
      queueMicrotask(() => {
        el.tables = [{ ...t1, placement: { ...t1.placement, x: 13, y: 7 } }];
      }),
    { once: true },
  );
  up(el, end.x, end.y);
  await settled(el);
  expect(heightOfHost(el)).toBe(240);
  expect(widthOf(el, "t1")).toBe(240);
  expect(await leftOf(el, "t1")).toBe(60);
  expect(drawnInside(el, "t1")).toBe(true);
});

it("a hold straight after an L-shaped drag's release refits when the hold ends", async () => {
  const el = await growingMap([t1]);
  const end = await dragAnL(el);
  up(el, end.x, end.y);
  const back = centreOf(el, "t1");
  hold(el, back.x, back.y);
  await settled(el);
  expect(widthOf(el, "t1")).toBe(192);
  up(el, back.x, back.y);
  await settled(el);
  expect(widthOf(el, "t1")).toBe(240);
});

it("a pan during a grown drag keeps the host's shape and stops the growth", async () => {
  const el = await growingMap([t1]);
  const { to } = await holdAndMove(el, "t1", 4, 0);
  expect(Number(ratioOf(el))).toBe(16 / 8);
  el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 1 }));
  await settled(el);
  expect(Number(ratioOf(el))).toBe(16 / 8);
  expect(heightOfHost(el)).toBe(180);
  expect(widthOf(el, "t1")).toBe(180);
  const further = { x: to.x + 2 * 22.5, y: to.y };
  move(el, further.x, further.y);
  await settled(el);
  expect(Number(ratioOf(el))).toBe(16 / 8);
  expect(widthOf(el, "t1")).toBe(180);
  up(el, further.x, further.y);
  await settled(el);
  expect(drops).toEqual([{ tableId: "t1", x: 16, y: 5, targetId: null }]);
  // Released, the host takes the tables' shape again, and the person's view is kept.
  expect(Number(ratioOf(el))).toBe(12 / 8);
  expect(heightOfHost(el)).toBe(240);
  expect(widthOf(el, "t1")).toBe(180);
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

it("a map removed while an L-shaped drag's refit waits does not update when the frame comes", async () => {
  const el = await growingMap([t1]);
  const end = await dragAnL(el);
  up(el, end.x, end.y);
  el.remove();
  const update = vi.spyOn(el, "requestUpdate");
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(update).not.toHaveBeenCalled();
});

it("a map left in place while an L-shaped drag's refit waits updates when the frame comes", async () => {
  const el = await growingMap([t1]);
  const end = await dragAnL(el);
  up(el, end.x, end.y);
  const update = vi.spyOn(el, "requestUpdate");
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(update).toHaveBeenCalled();
});

it("a diagonal drag keeps the travel it made on both axes across two scale changes", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 225);
  zoom(el, 300, 150, -100);
  move(el, 525, 375);
  zoom(el, 300, 150, -100);
  move(el, 675, 525);
  up(el, 675, 525);
  // 2 squares at 37.5 px, 2 more at 75 px, 1 more at 150 px, on each axis.
  expect(drops).toEqual([{ tableId: "t1", x: 15, y: 10, targetId: null }]);
});

it("a move while the host is hidden leaves the drag's travel as it was", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  await settled(el);
  // Read before hiding: a hidden host's box is empty, so at() would point elsewhere.
  const client = at(el, 375, 150);
  el.style.display = "none";
  await settled(el);
  pointer(window, "pointermove", client);
  await settled(el);
  el.style.display = "block";
  await settled(el);
  pointer(window, "pointermove", client);
  await settled(el);
  pointer(window, "pointerup", client);
  expect(drops).toEqual([{ tableId: "t1", x: 12, y: 5, targetId: null }]);
});

it("a hold released on a view kept over new tables keeps that view", async () => {
  const el = await map([t1]);
  el.tables = [t1, t("t2", "T2", { x: 30, y: 5, width: 4, height: 4 })];
  await settled(el);
  const kept = await leftOf(el, "t1");
  hold(el, 300, 150);
  up(el, 300, 150);
  await settled(el);
  expect(await leftOf(el, "t1")).toBe(kept);
});

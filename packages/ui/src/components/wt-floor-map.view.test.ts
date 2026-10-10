import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mountInShadowRoot } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapDrop, FloorMapTable, FloorMapTap, WtFloorMap } from "./wt-floor-map.js";
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

// Fitted in 600 × 300 at left 150, top 75, 300 × 150, 37.5 px a square; the crop's centre at (300, 150).
const t1 = t("t1", "T1", { x: 10, y: 5 });
// Beside t1 the crop is 16 × 8 squares, still 37.5 px a square: t2 at left 75, t1 at left 225, top 75
// (left of the test page's 414 px viewport, where `elementsFromPoint` finds nothing).
const t2 = t("t2", "T2", { x: 6, y: 5, width: 4, height: 4 });

let taps: FloorMapTap[];
let drops: FloorMapDrop[];
const onTap = (e: Event) => taps.push((e as CustomEvent<FloorMapTap>).detail);
const onDrop = (e: Event) => drops.push((e as CustomEvent<FloorMapDrop>).detail);

beforeEach(() => {
  taps = [];
  drops = [];
  document.addEventListener("wt-table-tap", onTap);
  document.addEventListener("wt-table-drag-end", onDrop);
});

afterEach(() => {
  document.removeEventListener("wt-table-tap", onTap);
  document.removeEventListener("wt-table-drag-end", onDrop);
  vi.useRealTimers();
  cleanup();
});

async function settled(el: WtFloorMap): Promise<void> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

async function map(tables: FloorMapTable[], fakeTimers = true, style = ""): Promise<WtFloorMap> {
  const el = (await mountInShadowRoot(
    `<wt-floor-map style="width: 600px; height: 300px; ${style}"></wt-floor-map>`,
  )) as WtFloorMap;
  el.tables = tables;
  await settled(el);
  if (fakeTimers) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return el;
}

const button = (el: WtFloorMap, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="table"][data-table-id="${id}"]`)!;

async function boxOf(el: WtFloorMap, id: string) {
  await el.updateComplete;
  const outer = el.getBoundingClientRect();
  const box = button(el, id).getBoundingClientRect();
  return {
    left: box.left - outer.left,
    top: box.top - outer.top,
    width: box.width,
    height: box.height,
  };
}

interface Press {
  pointerId?: number;
  pointerType?: string;
}

function at(el: WtFloorMap, x: number, y: number): { clientX: number; clientY: number } {
  const box = el.getBoundingClientRect();
  return { clientX: box.left + x, clientY: box.top + y };
}

function pointer(target: EventTarget, type: string, client: object, press: Press): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: press.pointerId ?? 1,
      pointerType: press.pointerType ?? "touch",
      button: 0,
      ...client,
    }),
  );
}

function down(el: WtFloorMap, x: number, y: number, press: Press = {}): void {
  const client = at(el, x, y);
  const target = el.shadowRoot!.elementFromPoint(client.clientX, client.clientY) ?? el;
  pointer(target, "pointerdown", client, press);
}

const move = (el: WtFloorMap, x: number, y: number, press: Press = {}) =>
  pointer(window, "pointermove", at(el, x, y), press);
const up = (el: WtFloorMap, x: number, y: number, press: Press = {}) =>
  pointer(window, "pointerup", at(el, x, y), press);

function tapAt(el: WtFloorMap, x: number, y: number, press: Press = {}): void {
  down(el, x, y, press);
  up(el, x, y, press);
}

function drag(el: WtFloorMap, from: [number, number], to: [number, number]): void {
  down(el, ...from);
  move(el, ...to);
  up(el, ...to);
}

function hold(el: WtFloorMap, x: number, y: number): void {
  down(el, x, y);
  vi.advanceTimersByTime(500);
}

function wheel(el: WtFloorMap, x: number, y: number, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    composed: true,
    cancelable: true,
    ...at(el, x, y),
    ...init,
  });
  (el.shadowRoot!.elementFromPoint(event.clientX, event.clientY) ?? el).dispatchEvent(event);
  return event;
}

function pinch(el: WtFloorMap, a: [number, number], b: [number, number], bTo: [number, number]) {
  down(el, ...a, { pointerId: 1 });
  down(el, ...b, { pointerId: 2 });
  move(el, ...bTo, { pointerId: 2 });
  up(el, ...a, { pointerId: 1 });
  up(el, ...bTo, { pointerId: 2 });
}

it("dragging empty space pans the map", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [120, 40]);
  expect(await boxOf(el, "t1")).toMatchObject({ left: 250, top: 95 });
});

it("a drag that starts on a table pans too, before the hold", async () => {
  const el = await map([t1]);
  down(el, 300, 150);
  vi.advanceTimersByTime(100);
  move(el, 320, 150);
  expect((await boxOf(el, "t1")).left).toBe(170);
  up(el, 320, 150);
  vi.advanceTimersByTime(1000);
  expect(taps).toEqual([]);
});

it("a pan stops with the plan's centre at the map's edge", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [1020, 20]);
  expect((await boxOf(el, "t1")).left).toBe(450);
  drag(el, [580, 20], [-1420, 20]);
  expect((await boxOf(el, "t1")).left).toBe(-150);
  drag(el, [20, 280], [20, 1280]);
  expect((await boxOf(el, "t1")).top).toBe(225);
  drag(el, [20, 280], [20, -720]);
  expect((await boxOf(el, "t1")).top).toBe(-75);
});

it("a double tap on empty space fits again", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  expect((await boxOf(el, "t1")).left).toBe(200);
  tapAt(el, 20, 20);
  tapAt(el, 20, 20);
  expect((await boxOf(el, "t1")).left).toBe(150);
});

it("a double click on empty space fits again", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  tapAt(el, 20, 20, { pointerType: "mouse" });
  tapAt(el, 20, 20, { pointerType: "mouse" });
  expect((await boxOf(el, "t1")).left).toBe(150);
});

it("a double tap on a table does not fit", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  tapAt(el, 300, 150);
  tapAt(el, 300, 150);
  expect((await boxOf(el, "t1")).left).toBe(200);
});

it("a click on a table then on empty space close by opens the table and does not fit", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  // t1 now spans 200 to 500 across; (190, 150) is empty, 20 px from (210, 150).
  await el.updateComplete;
  tapAt(el, 210, 150, { pointerType: "mouse" });
  tapAt(el, 190, 150, { pointerType: "mouse" });
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect((await boxOf(el, "t1")).left).toBe(200);
});

it("a touch tap on a table then on empty space close by opens the table and does not fit", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  // t1 now spans 200 to 500 across; (190, 150) is empty, 20 px from (210, 150).
  await el.updateComplete;
  tapAt(el, 210, 150);
  tapAt(el, 190, 150);
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect((await boxOf(el, "t1")).left).toBe(200);
});

it("a tap on empty space then one on a table close by opens the table and does not fit", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  await el.updateComplete;
  // t1 now spans 200 to 500 across; (190, 150) is empty, 20 px from (210, 150).
  tapAt(el, 190, 150);
  tapAt(el, 210, 150);
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect((await boxOf(el, "t1")).left).toBe(200);
});

it("pinching zooms about the fingers", async () => {
  const el = await map([t1]);
  pinch(el, [200, 150], [300, 150], [400, 150]);
  expect(await boxOf(el, "t1")).toEqual({ left: 100, top: 0, width: 600, height: 300 });
});

it("a pinch and Ctrl+wheel are measured from the map's own corner", async () => {
  const el = await map([t1], true, "margin: 20px 0 0 40px");
  pinch(el, [300, 100], [300, 200], [300, 300]);
  expect(await boxOf(el, "t1")).toEqual({ left: 0, top: 50, width: 600, height: 300 });
  tapAt(el, 20, 20);
  tapAt(el, 20, 20);
  wheel(el, 300, 150, { deltaY: -100, ctrlKey: true });
  expect(await boxOf(el, "t1")).toEqual({ left: 0, top: 0, width: 600, height: 300 });
});

it("zoom stops at half and at four times the fitted size", async () => {
  const el = await map([t1]);
  pinch(el, [250, 150], [350, 150], [260, 150]);
  expect((await boxOf(el, "t1")).width).toBe(150);
  pinch(el, [295, 150], [305, 150], [600, 150]);
  expect((await boxOf(el, "t1")).width).toBe(1200);
});

it("the wheel pans, and Ctrl+wheel zooms about the pointer", async () => {
  const el = await map([t1]);
  const pan = wheel(el, 20, 20, { deltaY: 100 });
  expect(await boxOf(el, "t1")).toMatchObject({ left: 150, top: -25 });
  expect(pan.defaultPrevented).toBe(true);
  const sideways = wheel(el, 20, 20, { deltaX: 40 });
  expect(await boxOf(el, "t1")).toMatchObject({ left: 110, top: -25 });
  expect(sideways.defaultPrevented).toBe(true);
  tapAt(el, 20, 280);
  tapAt(el, 20, 280);
  expect((await boxOf(el, "t1")).left).toBe(150);
  const zoom = wheel(el, 300, 150, { deltaY: -100, ctrlKey: true });
  expect(await boxOf(el, "t1")).toEqual({ left: 0, top: 0, width: 600, height: 300 });
  expect(zoom.defaultPrevented).toBe(true);
});

it("a wheel in lines moves 16 px a line, and one in pages the map's width or height a page", async () => {
  const el = await map([t1]);
  const refit = () => {
    tapAt(el, 20, 280);
    tapAt(el, 20, 280);
  };
  wheel(el, 20, 20, { deltaY: 1 });
  expect((await boxOf(el, "t1")).top).toBe(74);
  refit();
  wheel(el, 20, 20, { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE });
  expect((await boxOf(el, "t1")).top).toBe(59);
  refit();
  wheel(el, 20, 20, { deltaX: 2, deltaMode: WheelEvent.DOM_DELTA_LINE });
  expect((await boxOf(el, "t1")).left).toBe(118);
  refit();
  wheel(el, 20, 20, { deltaX: 0.25, deltaY: 0.25, deltaMode: WheelEvent.DOM_DELTA_PAGE });
  expect(await boxOf(el, "t1")).toMatchObject({ left: 0, top: 0 });
  refit();
  wheel(el, 300, 150, { deltaY: -6.25, deltaMode: WheelEvent.DOM_DELTA_LINE, ctrlKey: true });
  expect(await boxOf(el, "t1")).toEqual({ left: 0, top: 0, width: 600, height: 300 });
});

it("a resize after a pan keeps the person's view, and one after a fit fits", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  el.style.width = "500px";
  await settled(el);
  expect(await boxOf(el, "t1")).toMatchObject({ left: 200, width: 300 });
  tapAt(el, 20, 20);
  tapAt(el, 20, 20);
  el.style.width = "300px";
  await settled(el);
  expect((await boxOf(el, "t1")).width).toBe(200);
});

it("a resize after a pinch or a wheel keeps the person's view", async () => {
  const el = await map([t1]);
  pinch(el, [200, 150], [300, 150], [400, 150]);
  el.style.width = "500px";
  await settled(el);
  expect((await boxOf(el, "t1")).width).toBe(600);
  const other = await map([t1]);
  wheel(other, 20, 20, { deltaY: 10 });
  other.style.width = "300px";
  await settled(other);
  expect((await boxOf(other, "t1")).width).toBe(300);
});

it("a new fitKey fits again, and a resize after it fits", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  el.fitKey = "z2";
  expect((await boxOf(el, "t1")).left).toBe(150);
  el.style.width = "300px";
  await settled(el);
  expect((await boxOf(el, "t1")).width).toBe(200);
});

it("a re-read keeps the person's view", async () => {
  const el = await map([t1]);
  drag(el, [20, 20], [70, 20]);
  el.tables = [t1, t2];
  expect(await boxOf(el, "t1")).toMatchObject({ left: 200, width: 300 });
});

it("an empty map ignores a pan, a pinch and the wheel", async () => {
  const el = await map([]);
  drag(el, [20, 20], [70, 20]);
  pinch(el, [200, 150], [300, 150], [400, 150]);
  expect(wheel(el, 20, 20, { deltaY: 100 }).defaultPrevented).toBe(true);
  el.tables = [t1];
  expect(await boxOf(el, "t1")).toMatchObject({ left: 150, width: 300 });
});

it("a real click on empty space after a pan moves nothing and focuses nothing", async () => {
  const el = await map([t1], false);
  drag(el, [20, 20], [70, 20]);
  expect((await boxOf(el, "t1")).left).toBe(200);
  const focused = document.activeElement;
  await userEvent.click(el, { position: { x: 20, y: 20 } });
  expect((await boxOf(el, "t1")).left).toBe(200);
  expect(document.activeElement).toBe(focused);
  expect(el.shadowRoot!.activeElement).toBeNull();
});

it("a real click on a table focuses it without panning", async () => {
  const el = await map([t1], false);
  drag(el, [400, 20], [100, 20]);
  expect((await boxOf(el, "t1")).left).toBe(-150);
  await userEvent.click(el, { position: { x: 75, y: 150 } });
  expect((await boxOf(el, "t1")).left).toBe(-150);
  expect(el.shadowRoot!.activeElement).toBe(button(el, "t1"));
});

it("a hold then a drag draws the table under the finger in whole squares, and drops it", async () => {
  const el = await map([t1]);
  let heard: CustomEvent<FloorMapDrop> | undefined;
  document.addEventListener("wt-table-drag-end", (e) => (heard = e as CustomEvent<FloorMapDrop>), {
    once: true,
  });
  hold(el, 300, 150);
  move(el, 375, 150);
  expect((await boxOf(el, "t1")).left).toBe(225);
  move(el, 392, 150);
  expect((await boxOf(el, "t1")).left).toBe(225);
  move(el, 395, 170);
  expect(await boxOf(el, "t1")).toMatchObject({ left: 262.5, top: 112.5 });
  move(el, 375, 155);
  up(el, 375, 155);
  expect(drops).toEqual([{ tableId: "t1", x: 12, y: 5, targetId: null }]);
  expect(heard!.bubbles).toBe(true);
  expect(heard!.composed).toBe(true);
  expect(await boxOf(el, "t1")).toMatchObject({ left: 150, top: 75 });
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
});

it("a hold's drag asks for a drawing only when the table moves to another square", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  await el.updateComplete;
  const update = vi.spyOn(el, "requestUpdate");
  move(el, 380, 150);
  move(el, 392, 152);
  expect(update).not.toHaveBeenCalled();
  move(el, 395, 150);
  expect(update).toHaveBeenCalled();
  expect((await boxOf(el, "t1")).left).toBe(262.5);
});

it("a drag after a re-read moves the table from where the re-read put it", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  el.tables = [{ ...t1, placement: { ...t1.placement, x: 11 } }];
  await el.updateComplete;
  move(el, 340, 150);
  expect((await boxOf(el, "t1")).left).toBe(225);
  up(el, 340, 150);
  expect(drops).toEqual([{ tableId: "t1", x: 12, y: 5, targetId: null }]);
});

it("a pinch reads the map's box once, however many moves it has", async () => {
  const el = await map([t1]);
  const a = at(el, 200, 150);
  const b = at(el, 300, 150);
  const moves = [350, 400, 450].map((x) => at(el, x, 150));
  const box = vi.spyOn(el, "getBoundingClientRect");
  pointer(el.shadowRoot!.elementFromPoint(a.clientX, a.clientY)!, "pointerdown", a, {
    pointerId: 1,
  });
  pointer(el.shadowRoot!.elementFromPoint(b.clientX, b.clientY)!, "pointerdown", b, {
    pointerId: 2,
  });
  for (const to of moves) pointer(window, "pointermove", to, { pointerId: 2 });
  expect(box).toHaveBeenCalledTimes(1);
  box.mockRestore();
  pointer(window, "pointerup", moves[2]!, { pointerId: 2 });
  pointer(window, "pointerup", a, { pointerId: 1 });
  expect((await boxOf(el, "t1")).width).toBe(750);
});

it("a second pinch reads the map's box again", async () => {
  const el = await map([t1], true, "margin-left: 40px");
  pinch(el, [200, 150], [300, 150], [400, 150]);
  up(el, 400, 150, { pointerId: 2 });
  up(el, 200, 150, { pointerId: 1 });
  el.style.marginLeft = "0px";
  tapAt(el, 20, 20);
  tapAt(el, 20, 20);
  pinch(el, [200, 150], [300, 150], [400, 150]);
  expect(await boxOf(el, "t1")).toEqual({ left: 100, top: 0, width: 600, height: 300 });
});

it("a held drag on a zoomed map moves by the zoomed square", async () => {
  const el = await map([t1]);
  pinch(el, [200, 150], [300, 150], [400, 150]);
  hold(el, 300, 150);
  move(el, 375, 225);
  expect(await boxOf(el, "t1")).toMatchObject({ left: 175, top: 75 });
  up(el, 375, 225);
  expect(drops).toEqual([{ tableId: "t1", x: 11, y: 6, targetId: null }]);
});

it("a merge moves as one and sends its first member", async () => {
  const a = { ...t("a", "4", { x: 10, y: 5 }), joinId: "j" };
  const b = { ...t("b", "5", { x: 18, y: 5 }), joinId: "j" };
  const el = await map([b, a]);
  const before = await boxOf(el, "a");
  hold(el, before.left + 10, before.top + 10);
  move(el, before.left + 10 + (before.width / 16) * 3, before.top + 10);
  expect((await boxOf(el, "a")).left).toBeCloseTo(before.left + (before.width / 16) * 3, 5);
  up(el, before.left + 10 + (before.width / 16) * 3, before.top + 10);
  expect(drops).toEqual([{ tableId: "a", x: 13, y: 5, targetId: null }]);
});

it("a drop over another table names it", async () => {
  const el = await map([t1, t2]);
  expect(await boxOf(el, "t2")).toEqual({ left: 75, top: 75, width: 150, height: 150 });
  hold(el, 300, 150);
  move(el, 150, 150);
  expect((await boxOf(el, "t1")).left).toBe(75);
  expect((await boxOf(el, "t2")).left).toBe(75);
  up(el, 150, 150);
  expect(drops).toEqual([{ tableId: "t1", x: 6, y: 5, targetId: "t2" }]);
});

it("a drop over the dragged table's own drawing names no target", async () => {
  const el = await map([t2, t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  up(el, 375, 150);
  expect(drops).toEqual([{ tableId: "t1", x: 12, y: 5, targetId: null }]);
});

it("a drag past the top or left stops at 0", async () => {
  const el = await map([t("t", "T", { x: 1, y: 1 })]);
  hold(el, 300, 150);
  move(el, 100, -50);
  up(el, 100, -50);
  expect(drops).toEqual([{ tableId: "t", x: 0, y: 0, targetId: null }]);
});

it("a held press on empty space that moves draws nothing and sends nothing", async () => {
  const el = await map([t1]);
  hold(el, 20, 20);
  move(el, 120, 20);
  expect((await boxOf(el, "t1")).left).toBe(150);
  up(el, 120, 20);
  expect(drops).toEqual([]);
});

it("a cancelled drag sends nothing and puts the table back", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  expect((await boxOf(el, "t1")).left).toBe(225);
  pointer(window, "pointercancel", at(el, 375, 150), {});
  expect(drops).toEqual([]);
  expect((await boxOf(el, "t1")).left).toBe(150);
});

it("the drop event bubbles out of a shadow root", async () => {
  const el = await map([t1]);
  const heard: Event[] = [];
  const listen = (e: Event) => heard.push(e);
  document.addEventListener("wt-table-drag-end", listen);
  hold(el, 300, 150);
  move(el, 375, 150);
  up(el, 375, 150);
  document.removeEventListener("wt-table-drag-end", listen);
  expect(heard).toHaveLength(1);
  expect(heard[0]!.composed).toBe(true);
});

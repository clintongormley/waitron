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

// Its crop is 12 × 8 squares; fitted in 600 × 300 at left 150, top 75, 37.5 px a square.
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

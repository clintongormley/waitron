import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, mountInShadowRoot } from "../test-helpers.js";
import { applyTokens } from "../tokens/index.js";
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

// Alone, fitted in 600 × 300 at left 150, top 75, 300 × 150, 37.5 px a square.
const t1 = t("t1", "T1", { x: 10, y: 5 });
const fixedT1: FloorMapTable = { ...t1, fixed: true };
// Beside t1 the crop is 16 × 8 squares, still 37.5 px a square: t2 at left 75, t1 at left 225, top
// 75; t2's centre (150, 150), t1's (375, 150).
const t2 = t("t2", "T2", { x: 6, y: 5, width: 4, height: 4 });

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

async function map(tables: FloorMapTable[]): Promise<WtFloorMap> {
  const el = (await mountInShadowRoot(
    `<wt-floor-map style="width: 600px; height: 300px"></wt-floor-map>`,
  )) as WtFloorMap;
  applyTokens((el.getRootNode() as ShadowRoot).host as HTMLElement);
  el.tables = tables;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return el;
}

const part = (el: WtFloorMap, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part="${name}"]`);

const button = (el: WtFloorMap, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="table"][data-table-id="${id}"]`)!;

/** `--wt-color-primary` as the map's shadow root computes it. */
function primaryOf(el: WtFloorMap): string {
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-primary)";
  el.shadowRoot!.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

const targets = (el: WtFloorMap) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-drop-target]")].map(
    (b) => b.dataset["tableId"],
  );

async function boxIn(el: WtFloorMap, inner: Element) {
  await el.updateComplete;
  const outer = el.getBoundingClientRect();
  const box = inner.getBoundingClientRect();
  return {
    left: box.left - outer.left,
    top: box.top - outer.top,
    width: box.width,
    height: box.height,
  };
}

function at(el: WtFloorMap, x: number, y: number): { clientX: number; clientY: number } {
  const box = el.getBoundingClientRect();
  return { clientX: box.left + x, clientY: box.top + y };
}

function pointer(target: EventTarget, type: string, client: object, pointerId = 1): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId,
    pointerType: "touch",
    button: 0,
    ...client,
  });
  target.dispatchEvent(event);
  return event;
}

function down(el: WtFloorMap, x: number, y: number, pointerId = 1): PointerEvent {
  const client = at(el, x, y);
  const target = el.shadowRoot!.elementFromPoint(client.clientX, client.clientY) ?? el;
  return pointer(target, "pointerdown", client, pointerId);
}

const move = (el: WtFloorMap, x: number, y: number) => pointer(window, "pointermove", at(el, x, y));
const up = (el: WtFloorMap, x: number, y: number) => pointer(window, "pointerup", at(el, x, y));

function hold(el: WtFloorMap, x: number, y: number): void {
  down(el, x, y);
  vi.advanceTimersByTime(500);
}

it("marks the table under a dragged table as the drop target, and clears it on release", async () => {
  const el = await map([t1, t2]);
  hold(el, 300, 150);
  move(el, 150, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual(["t2"]);
  move(el, 390, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual([]);
  move(el, 150, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual(["t2"]);
  up(el, 150, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual([]);
  expect(drops).toEqual([{ tableId: "t1", x: 6, y: 5, targetId: "t2" }]);
});

it("a cancelled drag clears the drop target", async () => {
  const el = await map([t1, t2]);
  hold(el, 300, 150);
  move(el, 150, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual(["t2"]);
  pointer(window, "pointercancel", at(el, 150, 150));
  await el.updateComplete;
  expect(targets(el)).toEqual([]);
});

it("a drag that stays in one square still marks a target it comes over", async () => {
  // t2 4 × 4 at x 10, below t1, 25 px a square: from 6 px above t1's bottom edge, 10 px up passes the
  // 8 px slop and 11 px down is over t2, both in the press's own square.
  const below = t("t2", "T2", { x: 10, y: 9, width: 4, height: 4 });
  const el = await map([t1, below]);
  const t1Box = await boxIn(el, button(el, "t1"));
  const bottom = t1Box.top + t1Box.height;
  hold(el, t1Box.left + 10, bottom - 6);
  move(el, t1Box.left + 10, bottom - 16);
  await el.updateComplete;
  expect(button(el, "t1").hasAttribute("data-held")).toBe(true);
  expect(targets(el)).toEqual([]);
  move(el, t1Box.left + 10, bottom + 5);
  await el.updateComplete;
  expect(targets(el)).toEqual(["t2"]);
  expect((await boxIn(el, button(el, "t1"))).top).toBe(t1Box.top);
  up(el, t1Box.left + 10, bottom + 5);
  expect(drops).toEqual([{ tableId: "t1", x: 10, y: 5, targetId: "t2" }]);
});

it("a fixed table stays put while its copy follows the finger", async () => {
  const el = await map([fixedT1]);
  hold(el, 300, 150);
  move(el, 375, 190);
  expect(await boxIn(el, button(el, "t1"))).toMatchObject({ left: 150, top: 75 });
  const ghost = part(el, "ghost")!;
  expect(await boxIn(el, ghost)).toEqual({ left: 225, top: 112.5, width: 300, height: 150 });
  move(el, 375, 150);
  expect(getComputedStyle(ghost).opacity).toBe("0.5");
  expect(getComputedStyle(ghost).pointerEvents).toBe("none");
  const shape = ghost.querySelector<HTMLElement>('[part="shape"]')!;
  expect(shape.dataset["fill"]).toBe("free");
  expect(getComputedStyle(shape).pointerEvents).toBe("none");
  expect(await boxIn(el, shape)).toEqual({ left: 225, top: 75, width: 300, height: 150 });
  expect(part(el, "drag-link")).toBeNull();
});

it("a movable table's drag draws no copy and no line", async () => {
  const el = await map([t1, t2]);
  hold(el, 300, 150);
  move(el, 150, 150);
  expect((await boxIn(el, button(el, "t1"))).left).toBe(75);
  expect(part(el, "ghost")).toBeNull();
  expect(part(el, "drag-link")).toBeNull();
});

it("a merge with one fixed member stays put, and its copy holds every member", async () => {
  const a = { ...t("a", "4", { x: 10, y: 5 }), joinId: "j" };
  const b = { ...t("b", "5", { x: 18, y: 5 }), joinId: "j", fixed: true };
  const el = await map([a, b]);
  const before = await boxIn(el, button(el, "a"));
  const square = before.width / 16;
  hold(el, before.left + 10, before.top + 10);
  move(el, before.left + 10 + square * 3, before.top + 10);
  expect((await boxIn(el, button(el, "a"))).left).toBe(before.left);
  const ghost = part(el, "ghost")!;
  expect((await boxIn(el, ghost)).left).toBeCloseTo(before.left + square * 3, 5);
  expect(ghost.querySelectorAll('[part="shape"]')).toHaveLength(2);
});

it("a fixed table's copy over another table draws a line to it", async () => {
  const el = await map([fixedT1, t2]);
  hold(el, 300, 150);
  move(el, 150, 150);
  await el.updateComplete;
  expect((await boxIn(el, part(el, "ghost")!)).left).toBe(75);
  const link = part(el, "drag-link")!;
  expect(await boxIn(el, link)).toEqual({ left: 0, top: 0, width: 600, height: 300 });
  expect(getComputedStyle(link).pointerEvents).toBe("none");
  const line = link.querySelector("line")!;
  expect(["x1", "y1", "x2", "y2"].map((name) => Number(line.getAttribute(name)))).toEqual([
    375, 150, 150, 150,
  ]);
  expect(getComputedStyle(line).strokeWidth).toBe("1px");
  expect(getComputedStyle(line).stroke).toBe(primaryOf(el));
  expect(targets(el)).toEqual(["t2"]);
  const ring = (id: string) => {
    const style = getComputedStyle(button(el, id).querySelector('[part="shape"]')!);
    return [style.outlineStyle, style.outlineColor, style.outlineWidth, style.outlineOffset];
  };
  expect(ring("t2")[0]).not.toBe("none");
  expect(ring("t2")).toEqual(ring("t1"));
  // The copy now covers t2 here; the target is still found through it.
  move(el, 160, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual(["t2"]);
  move(el, 100, 280);
  await el.updateComplete;
  expect(part(el, "drag-link")).toBeNull();
  expect(targets(el)).toEqual([]);
});

it("a fixed table's copy goes on release, and the drop is still sent", async () => {
  const el = await map([fixedT1, t2]);
  hold(el, 300, 150);
  move(el, 150, 150);
  up(el, 150, 150);
  await el.updateComplete;
  expect(part(el, "ghost")).toBeNull();
  expect(part(el, "drag-link")).toBeNull();
  expect(drops).toEqual([{ tableId: "t1", x: 6, y: 5, targetId: "t2" }]);
});

it("a re-read without the held table ends the drag and sends no drop", async () => {
  const el = await map([t1, t2]);
  hold(el, 300, 150);
  move(el, 340, 150);
  el.tables = [t2];
  await el.updateComplete;
  up(el, 340, 150);
  expect(drops).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-held]")).toBeNull();
});

it("a re-read that drops then restores the held table does not bring the drag back", async () => {
  const el = await map([t1, t2]);
  hold(el, 300, 150);
  move(el, 340, 150);
  el.tables = [t2];
  await el.updateComplete;
  el.tables = [t1, t2];
  await el.updateComplete;
  move(el, 380, 150);
  expect((await boxIn(el, button(el, "t1"))).left).toBe(225);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
  up(el, 380, 150);
  expect(drops).toEqual([]);
});

it("a re-read without the target takes its line away", async () => {
  const el = await map([fixedT1, t2]);
  hold(el, 300, 150);
  move(el, 150, 150);
  await el.updateComplete;
  expect(part(el, "drag-link")).not.toBeNull();
  el.tables = [fixedT1];
  await el.updateComplete;
  expect(part(el, "drag-link")).toBeNull();
  expect(part(el, "ghost")).not.toBeNull();
});

it("a drag over a target still lets a press reach the page", async () => {
  const el = await map([fixedT1, t2]);
  const heard: Event[] = [];
  const listen = (e: Event) => heard.push(e);
  hold(el, 300, 150);
  move(el, 150, 150);
  await el.updateComplete;
  expect(targets(el)).toEqual(["t2"]);
  document.addEventListener("pointerdown", listen);
  document.addEventListener("keydown", listen);
  const press = down(el, 300, 150, 2);
  const key = new KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  button(el, "t1").dispatchEvent(key);
  document.removeEventListener("pointerdown", listen);
  document.removeEventListener("keydown", listen);
  expect(heard).toEqual([press, key]);
  expect(press.defaultPrevented).toBe(false);
  expect(key.defaultPrevented).toBe(false);
});

it("a re-read that moves the held table by the drag's own distance draws and drops from the new place", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 375, 150);
  await el.updateComplete;
  el.tables = [{ ...t1, placement: { ...t1.placement, x: 12 } }];
  await el.updateComplete;
  move(el, 376, 150);
  expect((await boxIn(el, button(el, "t1"))).left).toBe(300);
  up(el, 376, 150);
  expect(drops).toEqual([{ tableId: "t1", x: 14, y: 5, targetId: null }]);
});

it("a re-read that moves the held table down while the drag goes down draws and drops from the new place", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 300, 188);
  await el.updateComplete;
  el.tables = [{ ...t1, placement: { ...t1.placement, y: 4 } }];
  await el.updateComplete;
  move(el, 300, 225);
  expect((await boxIn(el, button(el, "t1"))).top).toBe(112.5);
  up(el, 300, 225);
  expect(drops).toEqual([{ tableId: "t1", x: 10, y: 6, targetId: null }]);
});

it("a re-read that moves the held table up by the drag's own distance drops from the new place", async () => {
  const el = await map([t1]);
  hold(el, 300, 150);
  move(el, 300, 188);
  await el.updateComplete;
  el.tables = [{ ...t1, placement: { ...t1.placement, y: 6 } }];
  await el.updateComplete;
  move(el, 300, 189);
  up(el, 300, 189);
  expect(drops).toEqual([{ tableId: "t1", x: 10, y: 7, targetId: null }]);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, mountInShadowRoot } from "../test-helpers.js";
import { mountThemed } from "../a11y-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapTable, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

const t = (id: string, placement: Partial<PlanPlacement>): FloorMapTable => ({
  id,
  label: id.toUpperCase(),
  placement: { x: 0, y: 0, width: 4, height: 4, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  dot: null,
  joinId: null,
  description: "Free",
});

// t1 and t2 alone fit 600 × 300 at 100/3 px a square, the view's origin at (200/3, 250/3): t1 at
// left 66.7, t2 at left 400, both top 83.3. t3, added after that fit, is drawn at top 316.7, below
// the map's bottom edge; the least pan that brings it in moves the view up 150, which puts the fit's
// centre on the top edge, the pan limit.
const t1 = t("t1", { x: 0, y: 0 });
const t2 = t("t2", { x: 10, y: 0 });
const t3 = t("t3", { x: 5, y: 7 });

let heard: KeyboardEvent[];
const onKey = (e: Event) => heard.push(e as KeyboardEvent);

beforeEach(() => {
  heard = [];
  document.addEventListener("keydown", onKey);
});

afterEach(() => {
  document.removeEventListener("keydown", onKey);
  cleanup();
});

async function settled(el: WtFloorMap): Promise<void> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

const MAP = '<wt-floor-map style="width: 600px; height: 300px"></wt-floor-map>';

/** Fits `fitted`, then draws `tables` in that view. */
async function map(
  tables: FloorMapTable[],
  fitted: FloorMapTable[] = tables,
  around = (m: string) => m,
): Promise<WtFloorMap> {
  const outer = await mountInShadowRoot(around(MAP));
  const el = (
    outer.localName === "wt-floor-map" ? outer : outer.querySelector("wt-floor-map")!
  ) as WtFloorMap;
  el.tables = fitted;
  await settled(el);
  el.tables = tables;
  await el.updateComplete;
  return el;
}

const button = (el: WtFloorMap, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="table"][data-table-id="${id}"]`)!;

const tabStops = (el: WtFloorMap) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>('[part="table"]')].map(
    (b) => `${b.dataset["tableId"]}:${b.getAttribute("tabindex")}`,
  );

const focused = (el: WtFloorMap) =>
  (el.shadowRoot!.activeElement as HTMLElement | null)?.dataset["tableId"] ?? null;

async function boxOf(el: WtFloorMap, id: string) {
  await el.updateComplete;
  const outer = el.getBoundingClientRect();
  const box = button(el, id).getBoundingClientRect();
  return {
    left: box.left - outer.left,
    top: box.top - outer.top,
    right: box.right - outer.left,
    bottom: box.bottom - outer.top,
  };
}

async function press(key: string): Promise<KeyboardEvent> {
  heard = [];
  await userEvent.keyboard(`{${key}}`);
  return heard.at(-1)!;
}

it("puts exactly one table in the Tab order, the first in reading order", async () => {
  const el = await map([t3, t2, t1]);
  expect(tabStops(el)).toEqual(["t3:-1", "t2:-1", "t1:0"]);
});

it("Tab enters the map once and leaves it on the next Tab", async () => {
  const el = await map(
    [t3, t2, t1],
    [t3, t2, t1],
    (m) => `<div><button id="before">Before</button>${m}<button id="after">After</button></div>`,
  );
  const root = el.getRootNode() as ShadowRoot;
  root.querySelector<HTMLButtonElement>("#before")!.focus();
  await userEvent.keyboard("{Tab}");
  expect(focused(el)).toBe("t1");
  await userEvent.keyboard("{Tab}");
  expect(root.activeElement?.id).toBe("after");
});

it("the arrow keys move between tables in reading order, Home and End to the ends", async () => {
  const el = await map([t3, t2, t1]);
  button(el, "t1").focus();
  const moves: [string, string][] = [
    ["ArrowLeft", "t1"],
    ["ArrowRight", "t2"],
    ["ArrowDown", "t3"],
    ["ArrowDown", "t3"],
    ["ArrowRight", "t3"],
    ["ArrowLeft", "t2"],
    ["ArrowUp", "t1"],
    ["ArrowUp", "t1"],
    ["End", "t3"],
    ["Home", "t1"],
  ];
  for (const [key, id] of moves) {
    const event = await press(key);
    expect([key, focused(el), event.defaultPrevented]).toEqual([key, id, true]);
  }
});

it("a key that is not a move passes through", async () => {
  const el = await map([t1, t2, t3]);
  button(el, "t1").focus();
  const event = await press("a");
  expect([focused(el), event.defaultPrevented]).toEqual(["t1", false]);
});

it("the table last focused is the tab stop", async () => {
  const el = await map([t1, t2, t3]);
  button(el, "t1").focus();
  await press("ArrowRight");
  await el.updateComplete;
  expect(tabStops(el)).toEqual(["t1:-1", "t2:0", "t3:-1"]);
  el.tables = [t1, t3];
  await el.updateComplete;
  expect(tabStops(el)).toEqual(["t1:0", "t3:-1"]);
});

it("a table pressed becomes the tab stop", async () => {
  const el = await map([t1, t2]);
  await userEvent.click(button(el, "t2").querySelector('[part="shape"]')!);
  await el.updateComplete;
  expect(tabStops(el)).toEqual(["t1:-1", "t2:0"]);
});

it("a press on another table while one is focused moves the tab stop", async () => {
  const el = await map([t1, t2]);
  button(el, "t1").focus();
  await userEvent.click(button(el, "t2").querySelector('[part="shape"]')!);
  await el.updateComplete;
  expect([focused(el), ...tabStops(el)]).toEqual(["t2", "t1:-1", "t2:0"]);
});

it("arrowing to a table below the edge pans it in without scrolling the map or its parent", async () => {
  const el = await map(
    [t1, t2, t3],
    [t1, t2],
    (m) => `<div style="height: 200px; overflow: auto">${m}<div style="height: 400px"></div></div>`,
  );
  const parent = el.parentElement!;
  expect((await boxOf(el, "t3")).top).toBeCloseTo(316.67, 1);
  button(el, "t2").focus({ preventScroll: true });
  expect(parent.scrollTop).toBe(0);
  await press("ArrowDown");
  expect(focused(el)).toBe("t3");
  const box = await boxOf(el, "t3");
  expect(box.top).toBeCloseTo(166.67, 1);
  expect(box.bottom).toBeCloseTo(300, 1);
  expect(box.left).toBeCloseTo(233.33, 1);
  expect(parent.scrollTop).toBe(0);
  expect([el.scrollLeft, el.scrollTop]).toEqual([0, 0]);
});

it("arrowing to a table above or left of the edge pans it in by the least distance", async () => {
  const left = t("left", { x: -10, y: 0 });
  const above = t("above", { x: 5, y: -6 });
  const el = await map([t1, t2, left, above], [t1, t2]);
  expect(await boxOf(el, "left")).toMatchObject({ left: expect.closeTo(-266.67, 1) });
  button(el, "t1").focus();
  await press("ArrowLeft");
  expect(focused(el)).toBe("left");
  const leftBox = await boxOf(el, "left");
  expect(leftBox.left).toBeCloseTo(0, 1);
  await press("Home");
  expect(focused(el)).toBe("above");
  const aboveBox = await boxOf(el, "above");
  expect(aboveBox.top).toBeCloseTo(0, 1);
  expect(aboveBox.left).toBeCloseTo(466.67, 1);
});

it("an arrow key to a table already in view moves nothing", async () => {
  const el = await map([t1, t2]);
  const before = await boxOf(el, "t2");
  button(el, "t1").focus();
  await press("ArrowRight");
  expect(await boxOf(el, "t2")).toEqual(before);
});

it("an arrow key's pan survives a resize", async () => {
  const el = await map([t1, t2, t3], [t1, t2]);
  button(el, "t2").focus();
  await press("ArrowDown");
  expect((await boxOf(el, "t3")).top).toBeCloseTo(166.67, 1);
  el.style.width = "500px";
  await settled(el);
  expect((await boxOf(el, "t3")).top).toBeCloseTo(166.67, 1);
});

it("a resize after an arrow key that moved nothing still fits", async () => {
  const el = await map([t1, t2]);
  button(el, "t1").focus();
  await press("ArrowRight");
  el.style.width = "500px";
  await settled(el);
  // Fitted to 500 × 300: 500/18 px a square, top (300 - 8 × 500/18) / 2 + 2 × 500/18.
  expect((await boxOf(el, "t2")).top).toBeCloseTo(94.44, 1);
});

it("an arrow key that does not come from a table moves nothing", async () => {
  const el = await map([t1, t2]);
  const event = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  el.shadowRoot!.querySelector('[role="group"]')!.dispatchEvent(event);
  expect([focused(el), event.defaultPrevented]).toEqual([null, false]);
});

it("a map whose tables all go has no tab stop", async () => {
  const el = await map([t1, t2]);
  el.tables = [];
  await el.updateComplete;
  expect(tabStops(el)).toEqual([]);
});

it("an arrow, Home or End key with Alt, Ctrl or Meta held passes through", async () => {
  const el = await map([t1, t2, t3]);
  button(el, "t2").focus();
  for (const init of [
    { key: "ArrowLeft", altKey: true },
    { key: "Home", ctrlKey: true },
    { key: "End", metaKey: true },
  ]) {
    // Dispatched, not typed: a real Alt+ArrowLeft would take the test page back.
    const event = new KeyboardEvent("keydown", {
      ...init,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    button(el, "t2").dispatchEvent(event);
    expect([init.key, focused(el), event.defaultPrevented]).toEqual([init.key, "t2", false]);
  }
});

it("focus coming back to the table last focused asks for no drawing, and another table does", async () => {
  const el = await map(
    [t1, t2],
    [t1, t2],
    (m) => `<div><button id="outside">Outside</button>${m}</div>`,
  );
  const outside = (el.getRootNode() as ShadowRoot).querySelector<HTMLButtonElement>("#outside")!;
  button(el, "t1").focus();
  outside.focus();
  await el.updateComplete;
  const update = vi.spyOn(el, "requestUpdate");
  button(el, "t1").focus();
  expect(update).not.toHaveBeenCalled();
  button(el, "t2").focus();
  expect(update).toHaveBeenCalled();
  await el.updateComplete;
  expect(tabStops(el)).toEqual(["t1:-1", "t2:0"]);
});

it("new tables given with a new fitKey are the ones the arrow keys and the tab stop read", async () => {
  const el = await map([t1, t2]);
  button(el, "t1").focus();
  const t4 = t("t4", { x: 4, y: 0 });
  el.tables = [t1, t4, t2];
  el.fitKey = "z2";
  await el.updateComplete;
  await press("ArrowRight");
  expect(focused(el)).toBe("t4");
  el.tables = [t2, t4];
  el.fitKey = "z3";
  await el.updateComplete;
  expect(tabStops(el)).toEqual(["t2:-1", "t4:0"]);
  await press("End");
  expect(focused(el)).toBe("t2");
  await press("Home");
  expect(focused(el)).toBe("t4");
});

it("a focused table that joins a merge keeps the merge as the tab stop", async () => {
  const el = await map([t1, t2, t3]);
  button(el, "t3").focus();
  await el.updateComplete;
  el.tables = [t1, { ...t2, joinId: "j" }, { ...t3, joinId: "j" }];
  await el.updateComplete;
  expect(tabStops(el)).toEqual(["t1:-1", "t2:0"]);
});

it("an arrow key pans by the zoomed scale", async () => {
  const el = await map([t1, t2]);
  // Ctrl+wheel at the map's top-left corner doubles the scale to 200/3 px a square: t1 at left
  // 133.3, top 166.7, its lower part below the edge; t2 at left 800, off the right edge.
  const corner = el.getBoundingClientRect();
  el.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: corner.left,
      clientY: corner.top,
      deltaY: -100,
      ctrlKey: true,
    }),
  );
  expect(await boxOf(el, "t2")).toMatchObject({ left: expect.closeTo(800, 1) });
  button(el, "t1").focus();
  await press("ArrowRight");
  const box = await boxOf(el, "t2");
  expect([box.left, box.top, box.right, box.bottom].map(Math.round)).toEqual([333, 33, 600, 300]);
});

describe("arrowing to a table wider than the map", () => {
  // Fitted at 25 px a square, the view's origin at (50, 75), the crop's centre at (10, 3). Ctrl+wheel
  // ×4 about (200, 200) gives 100 px a square and the origin (-400, -300): `wide` 1000 px across
  // from left 100, top 100 to 300. A plain wheel's deltaX then moves the view left by that much.
  const a = t("a", { x: 0, y: 0, width: 2, height: 2 });
  const b = t("b", { x: 18, y: 0, width: 2, height: 2 });
  const wide = t("wide", { x: 5, y: 4, width: 10, height: 2 });

  function wheelAt(el: WtFloorMap, x: number, y: number, init: WheelEventInit): void {
    const corner = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: corner.left + x,
        clientY: corner.top + y,
        ...init,
      }),
    );
  }

  async function arrowToWide(deltaX: number) {
    const el = await map([a, b, wide]);
    wheelAt(el, 200, 200, { deltaY: -200, ctrlKey: true });
    if (deltaX !== 0) wheelAt(el, 0, 0, { deltaX });
    const before = await boxOf(el, "wide");
    button(el, "b").focus({ preventScroll: true });
    await press("ArrowRight");
    expect(focused(el)).toBe("wide");
    const after = await boxOf(el, "wide");
    return [before, after].map((box) => [box.left, box.top, box.right, box.bottom].map(Math.round));
  }

  it("a gap on the left: its left edge comes to the map's left edge", async () => {
    expect(await arrowToWide(0)).toEqual([
      [100, 100, 1100, 300],
      [0, 100, 1000, 300],
    ]);
  });

  it("a gap on the right: its right edge comes to the map's right edge", async () => {
    expect(await arrowToWide(600)).toEqual([
      [-500, 100, 500, 300],
      [-400, 100, 600, 300],
    ]);
  });

  it("its left edge exactly on the map's left edge: nothing moves", async () => {
    expect(await arrowToWide(100)).toEqual([
      [0, 100, 1000, 300],
      [0, 100, 1000, 300],
    ]);
  });

  it("covering the whole map past both edges: nothing moves", async () => {
    expect(await arrowToWide(300)).toEqual([
      [-200, 100, 800, 300],
      [-200, 100, 800, 300],
    ]);
  });
});

it("a keydown on a table still reaches the page", async () => {
  const el = await map([t1, t2]);
  button(el, "t1").focus();
  const event = await press("ArrowRight");
  expect(event.key).toBe("ArrowRight");
});

/** Reads the map's pixels from a real screenshot, as "r,g,b" at a point in page px. */
async function pixels(el: WtFloorMap): Promise<(x: number, y: number) => number[]> {
  // With `save: false` the screenshot comes back as the base64 string itself.
  const shot: unknown = await page.screenshot({ element: el, base64: true, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${shot as string}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const box = el.getBoundingClientRect();
  const k = image.width / box.width;
  return (x, y) => [
    ...context
      .getImageData(Math.round((x - box.left) * k), Math.round((y - box.top) * k), 1, 1)
      .data.slice(0, 3),
  ];
}

const rgb = (colour: string) => colour.match(/\d+/g)!.slice(0, 3).map(Number);

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

async function touching(): Promise<WtFloorMap> {
  const el = (await mountThemed(
    '<wt-floor-map style="width: 400px; height: 200px"></wt-floor-map>',
    "light",
  )) as WtFloorMap;
  el.reducedMotion = true;
  el.tables = [{ ...t("a", { x: 0 }), dot: "ready" }, t("b", { x: 4 }), t("c", { x: 8 })];
  await settled(el);
  return el;
}

it("a focused table's ring is drawn over the table beside it", async () => {
  const el = await touching();
  const b = button(el, "b");
  b.focus();
  await press("Shift");
  expect(b.matches(":focus-visible")).toBe(true);
  const ring = rgb(getComputedStyle(b).outlineColor);
  const box = b.getBoundingClientRect();
  const c = button(el, "c").getBoundingClientRect();
  const read = await pixels(el);
  const fill = read(c.left + c.width / 2, c.top + c.height / 2);
  // The ring lies 2 to 4 px right of the button, over c; the screenshot is scaled, so read across it.
  const across = [2, 3, 4].map((d) => read(box.right + d, box.top + box.height / 2));
  expect(across.some((p) => distance(p, ring) < distance(p, fill))).toBe(true);
});

it("a dot is drawn over a focused table beside it", async () => {
  const el = await touching();
  const b = button(el, "b");
  b.focus();
  await press("Shift");
  const dot = el.shadowRoot!.querySelector('[part="dot"]')!;
  const colour = rgb(getComputedStyle(dot).backgroundColor);
  const box = dot.getBoundingClientRect();
  const read = await pixels(el);
  const fill = read(box.left - 20, box.top + 20);
  // The dot's centre is a's top-right corner; its lower right quarter lies over b, inside its ring.
  const overB = read(box.left + box.width * 0.6, box.top + box.height * 0.6);
  expect(distance(overB, colour)).toBeLessThan(distance(overB, fill));
});

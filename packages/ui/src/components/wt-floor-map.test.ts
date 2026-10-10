import { afterEach, expect, it } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import { type FloorMapTable, type WtFloorMap, mapLabel, mergeLabel } from "./wt-floor-map.js";
import "./wt-floor-map.js";

afterEach(cleanup);

const t = (
  id: string,
  label: string,
  placement: Partial<PlanPlacement> = {},
  over: Partial<FloorMapTable> = {},
): FloorMapTable => ({
  id,
  label,
  placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  dot: null,
  joinId: null,
  description: "Free",
  ...over,
});

const t1 = t("t1", "T1", { x: 10, y: 5, width: 8, height: 4 });

/** Waits for the ResizeObserver's reading to reach the drawing. */
async function settled(el: WtFloorMap): Promise<void> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
}

async function map(
  tables: FloorMapTable[],
  props: Partial<Pick<WtFloorMap, "fitKey" | "copy" | "reducedMotion">> = {},
): Promise<WtFloorMap> {
  const el = (await mount(
    '<wt-floor-map style="width: 600px; height: 300px"></wt-floor-map>',
  )) as WtFloorMap;
  el.tables = tables;
  Object.assign(el, props);
  await settled(el);
  return el;
}

const button = (el: WtFloorMap, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="table"][data-table-id="${id}"]`)!;

const within = (el: WtFloorMap, part: string, id: string) =>
  button(el, id).querySelector<HTMLElement>(`[part="${part}"]`);

function boxOf(el: WtFloorMap, id: string) {
  const outer = el.getBoundingClientRect();
  const box = button(el, id).getBoundingClientRect();
  return {
    left: box.left - outer.left,
    top: box.top - outer.top,
    width: box.width,
    height: box.height,
  };
}

it("fits the zone's tables to the map when it first draws them", async () => {
  const el = await map([t1]);
  expect(boxOf(el, "t1")).toEqual({ left: 150, top: 75, width: 300, height: 150 });
});

it("turns a table about its centre", async () => {
  const el = await map([t("t1", "T1", { x: 10, y: 5, width: 8, height: 4, rotation: 90 })]);
  const m = new DOMMatrix(getComputedStyle(within(el, "shape", "t1")!).transform);
  expect(m.a).toBeCloseTo(0);
  expect(m.b).toBeCloseTo(1);
  expect(m.c).toBeCloseTo(-1);
  expect(m.d).toBeCloseTo(0);
  expect(m.e).toBeCloseTo(0);
  expect(m.f).toBeCloseTo(0);
  const box = boxOf(el, "t1");
  expect(box.width).toBeCloseTo(100);
  expect(box.height).toBeCloseTo(200);
  const shape = within(el, "shape", "t1")!.getBoundingClientRect();
  const outer = button(el, "t1").getBoundingClientRect();
  expect(shape.left - outer.left).toBeCloseTo(0);
  expect(shape.top - outer.top).toBeCloseTo(0);
  expect(shape.width).toBeCloseTo(100);
  expect(shape.height).toBeCloseTo(200);
});

it("draws a round table as a circle", async () => {
  const el = await map([t("r", "R", { shape: "round" }), t("s", "S", { x: 10 })]);
  expect(within(el, "shape", "r")!.dataset["shape"]).toBe("round");
  expect(getComputedStyle(within(el, "shape", "r")!).borderTopLeftRadius).toBe("50%");
  host.style.setProperty("--wt-radius-sm", "5px");
  expect(getComputedStyle(within(el, "shape", "s")!).borderTopLeftRadius).toBe("5px");
});

it("draws a merge as one button named with its tables in number order", async () => {
  const el = await map([
    t("ten", "10", { x: 8, y: 0 }, { joinId: "j1" }),
    t("four", "4", { x: 0, y: 0 }, { joinId: "j1" }),
  ]);
  const buttons = el.shadowRoot!.querySelectorAll('[part="table"]');
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.querySelectorAll('[part="shape"]')).toHaveLength(2);
  expect(button(el, "four")).toBe(buttons[0]);
  expect(within(el, "name", "four")!.textContent).toBe("4+10");
  expect(button(el, "four").getAttribute("aria-label")).toBe("4+10, Free");
  // crop 20 × 12 in 600 × 300: scale 25, so the union 16 × 8 is 400 × 200 px and "10" sits 200 px in
  expect(boxOf(el, "four")).toEqual({ left: 100, top: 50, width: 400, height: 200 });
  const shapes = [...buttons[0]!.querySelectorAll<HTMLElement>('[part="shape"]')];
  const left = button(el, "four").getBoundingClientRect().left;
  expect(shapes.map((s) => s.getBoundingClientRect().left - left)).toEqual([0, 200]);
});

it("keeps unjoined tables and different merges apart", async () => {
  const el = await map([
    t("a", "A", { x: 0 }, { joinId: "j1" }),
    t("b", "B", { x: 10 }, { joinId: "j2" }),
    t("c", "C", { x: 20 }),
    t("d", "D", { x: 30 }),
  ]);
  const ids = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[part="table"]')].map(
    (b) => b.dataset["tableId"],
  );
  expect(ids).toEqual(["a", "b", "c", "d"]);
});

it("names a merge's shared first word once", () => {
  expect(mapLabel(["Terrace 4", "Terrace 5"])).toBe("Terrace 4+5");
  expect(mapLabel(["4", "10"])).toBe("4+10");
  expect(mapLabel(["Bar 1", "Stool 2"])).toBe("Bar 1+Stool 2");
  expect(mapLabel(["Bar 1", "Bar"])).toBe("Bar 1+Bar");
  expect(mapLabel([" 1", " 2"])).toBe(" 1+ 2");
  expect(mapLabel(["Terrace 4"])).toBe("Terrace 4");
  expect(mapLabel([])).toBe("");
});

it("names a merge in number order whatever order its labels come in, as the map does", async () => {
  expect(mergeLabel(["Terrace 10", "Terrace 4"])).toBe("Terrace 4+10");
  expect(mergeLabel(["10", "9", "4"])).toBe("4+9+10");
  expect(mergeLabel(["Terrace 4"])).toBe("Terrace 4");
  expect(mergeLabel([])).toBe("");
  const labels = ["Terrace 10", "Terrace 4"];
  mergeLabel(labels);
  expect(labels).toEqual(["Terrace 10", "Terrace 4"]);
  const el = await map([
    t("t10", "Terrace 10", { x: 10, y: 4, width: 4, height: 4 }, { joinId: "m" }),
    t("t4", "Terrace 4", { x: 14, y: 4, width: 4, height: 4 }, { joinId: "m" }),
  ]);
  expect(within(el, "name", "t4")!.textContent).toBe(mergeLabel(labels));
});

const small = [
  t("b1", "B1", { width: 2, height: 2 }),
  t("b2", "B2", { x: 36, y: 16, width: 3, height: 3 }),
];

it("hides a turned table's name by its own size, not its turned box", async () => {
  const el = await map([...small, t("l", "L", { x: 20, y: 8, width: 2, height: 8, rotation: 45 })]);
  expect(boxOf(el, "l").width).toBeCloseTo((300 / 23) * Math.SQRT2 * 5, 0);
  expect(within(el, "name", "l")).toBeNull();
  expect(button(el, "l").getAttribute("aria-label")).toBe("L, Free");
});

it("hides a name drawn under 28 px and keeps it as the accessible name", async () => {
  const el = await map(small);
  expect(boxOf(el, "b1").width).toBeCloseTo(600 / 23, 1);
  expect(within(el, "name", "b1")).toBeNull();
  expect(button(el, "b1").getAttribute("aria-label")).toBe("B1, Free");
  expect(within(el, "name", "b2")!.textContent).toBe("B2");
});

it("shows a merge's name by its whole box", async () => {
  // At scale 300/23 each member's shorter side is 2 squares (26 px), the union's 3 (39 px).
  const el = await map([
    ...small,
    t("m1", "M1", { x: 10, y: 4, width: 2, height: 3 }, { joinId: "m" }),
    t("m2", "M2", { x: 12, y: 4, width: 2, height: 3 }, { joinId: "m" }),
  ]);
  expect(within(el, "name", "m1")!.textContent).toBe("M1+M2");
});

it("paints a table from its fill's tokens", async () => {
  const el = await map([t("t1", "T1", {}, { fill: "bill" })]);
  host.style.setProperty("--wt-color-table-bill", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-on-table-bill", "rgb(4, 5, 6)");
  expect(getComputedStyle(within(el, "shape", "t1")!).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(within(el, "name", "t1")!).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(button(el, "t1")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

it("paints a merge's name in its fill, so the seam between its tables does not cross it", async () => {
  const el = await map([
    t("ten", "10", { x: 8, y: 0 }, { joinId: "j1", fill: "seated" }),
    t("four", "4", { x: 0, y: 0 }, { joinId: "j1", fill: "seated" }),
  ]);
  host.style.setProperty("--wt-color-table-seated", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-space-1", "5px");
  const name = getComputedStyle(within(el, "name", "four")!);
  expect(name.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(name.paddingLeft).toBe("5px");
  expect(name.paddingRight).toBe("5px");
});

it("leaves a single table's name unpadded and unpainted, so it has the table's whole width", async () => {
  const el = await map([t("t1", "T1", {}, { fill: "seated" })]);
  host.style.setProperty("--wt-space-1", "5px");
  const name = getComputedStyle(within(el, "name", "t1")!);
  expect([name.paddingLeft, name.paddingRight, name.backgroundColor]).toEqual([
    "0px",
    "0px",
    "rgba(0, 0, 0, 0)",
  ]);
});

it("paints the map's background from the surface token", async () => {
  const el = await map([t1]);
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  expect(getComputedStyle(el).backgroundColor).toBe("rgb(10, 11, 12)");
});

it("outlines every table in the field-line colour", async () => {
  const el = await map([t1]);
  host.style.setProperty("--wt-color-field-line", "rgb(7, 8, 9)");
  const style = getComputedStyle(within(el, "shape", "t1")!);
  expect(style.borderTopColor).toBe("rgb(7, 8, 9)");
  expect(style.borderTopWidth).toBe("1px");
  expect(style.borderTopStyle).toBe("solid");
});

it("shows one dot in its colour", async () => {
  const el = await map([
    t("r", "R", {}, { dot: "ready" }),
    t("f", "F", { x: 10 }, { dot: "forgotten" }),
    t("n", "N", { x: 20 }),
  ]);
  host.style.setProperty("--wt-color-success", "rgb(1, 1, 1)");
  host.style.setProperty("--wt-color-danger", "rgb(2, 2, 2)");
  host.style.setProperty("--wt-color-surface", "rgb(3, 3, 3)");
  const ready = within(el, "dot", "r")!;
  expect(ready.dataset["dot"]).toBe("ready");
  expect(getComputedStyle(ready).backgroundColor).toBe("rgb(1, 1, 1)");
  expect(getComputedStyle(ready).borderTopColor).toBe("rgb(3, 3, 3)");
  expect(getComputedStyle(within(el, "dot", "f")!).backgroundColor).toBe("rgb(2, 2, 2)");
  expect(within(el, "dot", "n")).toBeNull();
  expect(button(el, "r").querySelectorAll('[part="dot"]')).toHaveLength(1);
});

it("sits the dot on the table's top-right corner", async () => {
  const el = await map([t("r", "R", {}, { dot: "ready" })]);
  const dot = within(el, "dot", "r")!.getBoundingClientRect();
  const box = button(el, "r").getBoundingClientRect();
  expect(dot.left + dot.width / 2).toBeCloseTo(box.right);
  expect(dot.top + dot.height / 2).toBeCloseTo(box.top);
});

it("shows a merge's dot whichever member carries it", async () => {
  const el = await map([
    t("four", "4", { x: 0 }, { joinId: "j1" }),
    t("ten", "10", { x: 8 }, { joinId: "j1", dot: "ready" }),
  ]);
  expect(within(el, "dot", "four")!.dataset["dot"]).toBe("ready");
});

it("draws a dot above a touching table listed after it", async () => {
  const el = await map([t("a", "A", { x: 0 }, { dot: "ready" }), t("b", "B", { x: 8 })]);
  const dot = within(el, "dot", "a")!;
  // The dot takes no taps; letting it be hit here makes the hit test read the paint order.
  dot.style.pointerEvents = "auto";
  const box = dot.getBoundingClientRect();
  const hit = el.shadowRoot!.elementFromPoint(box.right - 2, box.top + box.height / 2);
  expect(hit).toBe(dot);
});

it("keeps the dot under a later sibling that covers the map", async () => {
  const outer = await mount(
    '<div style="position: relative"><wt-floor-map style="width: 600px; height: 300px"></wt-floor-map><div style="position: absolute; inset: 0"></div></div>',
  );
  const el = outer.firstElementChild as WtFloorMap;
  const cover = outer.lastElementChild!;
  el.tables = [t("r", "R", {}, { dot: "ready" })];
  await settled(el);
  const dot = within(el, "dot", "r")!;
  dot.style.pointerEvents = "auto";
  const box = dot.getBoundingClientRect();
  expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(cover);
});

it("flashes the dot unless motion is reduced", async () => {
  const el = await map([t("r", "R", {}, { dot: "ready" })], { reducedMotion: false });
  expect(getComputedStyle(within(el, "dot", "r")!).animationName).not.toBe("none");
  expect(getComputedStyle(within(el, "dot", "r")!).animationDuration).toBe("1s");
  el.reducedMotion = true;
  await el.updateComplete;
  expect(getComputedStyle(within(el, "dot", "r")!).animationName).toBe("none");
});

it("follows the browser's motion setting when told nothing", async () => {
  const el = await map([t("r", "R", {}, { dot: "ready" })]);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  expect(getComputedStyle(within(el, "dot", "r")!).animationName === "none").toBe(reduced);
});

it("names the tables' group from its copy", async () => {
  const el = await map([t1]);
  const group = el.shadowRoot!.querySelector('[role="group"]')!;
  expect(group.getAttribute("aria-label")).toBe("Tables");
  expect(group.contains(button(el, "t1"))).toBe(true);
  el.copy = { label: "Mesas" };
  await el.updateComplete;
  expect(group.getAttribute("aria-label")).toBe("Mesas");
});

it("keeps the view when the tables change", async () => {
  const el = await map([t1]);
  el.tables = [t1, t("t2", "T2", { x: 60, y: 5, width: 8, height: 4 })];
  await settled(el);
  expect(boxOf(el, "t1").width).toBe(300);
  expect(boxOf(el, "t1").left).toBe(150);
});

it("fits again when fitKey changes", async () => {
  const el = await map([t1], { fitKey: "z1" });
  el.tables = [t1, t("t2", "T2", { x: 60, y: 5, width: 8, height: 4 })];
  await settled(el);
  el.fitKey = "z2";
  await el.updateComplete;
  expect(boxOf(el, "t1").width).toBeCloseTo((600 / 62) * 8, 1);
});

it("fits again when the map is resized", async () => {
  const el = await map([t1]);
  el.style.width = "300px";
  await settled(el);
  expect(boxOf(el, "t1")).toEqual({ left: 50, top: 100, width: 200, height: 100 });
});

it("draws an empty group with no tables", async () => {
  const el = await map([]);
  expect(el.shadowRoot!.querySelector('[role="group"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[part="table"]')).toBeNull();
});

it("fits the first tables it is given after drawing none", async () => {
  const el = await map([]);
  el.tables = [t1];
  await el.updateComplete;
  expect(boxOf(el, "t1")).toEqual({ left: 150, top: 75, width: 300, height: 150 });
});

it("keeps each table's button when the tables are reordered", async () => {
  const a = t("a", "A", { x: 0 });
  const b = t("b", "B", { x: 10 });
  const el = await map([a, b]);
  const before = button(el, "b");
  el.tables = [b, a];
  await el.updateComplete;
  expect(button(el, "b")).toBe(before);
});

it("keeps its drawing while removed", async () => {
  const el = await map([t1]);
  const drawn = button(el, "t1");
  el.remove();
  await settled(el);
  expect(drawn.style.width).toBe("300px");
});

it("watches its size again when put back", async () => {
  const el = await map([t1]);
  el.remove();
  el.style.width = "300px";
  document.body.append(el);
  await settled(el);
  expect(boxOf(el, "t1").width).toBe(200);
});

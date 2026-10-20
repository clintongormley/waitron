import { afterEach, describe, expect, it } from "vitest";
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
  outline: null,
  pulse: null,
  cue: null,
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

it("A669 draws an allergy mark beside the existing pulse and removes it on refresh", async () => {
  const allergic = t("t1", "T1", {}, { allergy: true, fill: "seated", pulse: "forgotten" });
  const el = await map([allergic, t("t2", "T2", { x: 12 })], {
    copy: { allergy: "Allergy warning" },
    reducedMotion: false,
  });
  expect(within(el, "allergy", "t1")?.textContent).toBe("!");
  expect(button(el, "t1").querySelector<HTMLElement>("[data-pulse]")?.dataset["pulse"]).toBe(
    "forgotten",
  );
  expect(button(el, "t1").getAttribute("aria-label")).toBe("T1, Free, Allergy warning");
  expect(within(el, "allergy", "t2")).toBeNull();
  el.tables = [{ ...allergic, allergy: false }];
  await settled(el);
  expect(within(el, "allergy", "t1")).toBeNull();
  expect(button(el, "t1").getAttribute("aria-label")).toBe("T1, Free");
});

it("A669 paints the allergy mark with the danger tokens", async () => {
  const el = await map([t("t1", "T1", {}, { allergy: true })]);
  host.style.setProperty("--wt-color-danger", "rgb(100, 10, 20)");
  host.style.setProperty("--wt-color-on-danger", "rgb(240, 230, 220)");
  host.style.setProperty("--wt-space-5", "24px");
  const mark = within(el, "allergy", "t1")!;
  expect(getComputedStyle(mark).backgroundColor).toBe("rgb(100, 10, 20)");
  expect(getComputedStyle(mark).color).toBe("rgb(240, 230, 220)");
  expect(getComputedStyle(mark).width).toBe("24px");
  expect(getComputedStyle(mark).animationName).toBe("none");
});

it("A669 marks a merge when only the later member has an allergy", async () => {
  const el = await map([
    t("a", "A", {}, { joinId: "j" }),
    t("b", "B", { x: 8 }, { joinId: "j", allergy: true }),
    t("c", "C", { x: 20 }),
  ]);
  expect(within(el, "allergy", "a")?.textContent).toBe("!");
  expect(button(el, "a").getAttribute("aria-label")).toBe("A+B, Free, Allergy");
  expect(within(el, "allergy", "c")).toBeNull();
});

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

it("a re-read's new labels and joins are what the map names", async () => {
  const el = await map([
    t("a", "Terrace 4", { x: 10, y: 4, width: 4, height: 4 }, { joinId: "m" }),
    t("b", "Terrace 5", { x: 14, y: 4, width: 4, height: 4 }, { joinId: "m" }),
    t("c", "Terrace 6", { x: 18, y: 4, width: 4, height: 4 }),
  ]);
  expect(within(el, "name", "a")!.textContent).toBe("Terrace 4+5");
  el.tables = [
    t("a", "Terrace 9", { x: 10, y: 4, width: 4, height: 4 }, { joinId: "m" }),
    t("b", "Terrace 5", { x: 14, y: 4, width: 4, height: 4 }, { joinId: "m" }),
    t("c", "Terrace 6", { x: 18, y: 4, width: 4, height: 4 }, { joinId: "m" }),
  ];
  el.fitKey = "z2";
  await el.updateComplete;
  expect(within(el, "name", "b")!.textContent).toBe("Terrace 5+6+9");
  expect(button(el, "b").getAttribute("aria-label")).toBe("Terrace 5+6+9, Free");
  expect(el.shadowRoot!.querySelectorAll('[part="table"]')).toHaveLength(1);
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

it("no table draws a dot", async () => {
  // A caller built against the old type still sends `dot`.
  const stale = {
    ...t("f", "F", {}, { fill: "danger", pulse: "forgotten" }),
    dot: "forgotten",
  } as unknown as FloorMapTable;
  const el = await map([stale], { reducedMotion: true });
  expect(el.shadowRoot!.querySelectorAll('[part="dot"]')).toHaveLength(0);
});

const pulseOf = (el: WtFloorMap, id: string) =>
  button(el, id).querySelector<HTMLElement>('[part="shape"] [data-pulse]');

/** Holds the pulse at its first frame, where it is its whole colour. */
function atStart(pulse: HTMLElement): CSSStyleDeclaration {
  for (const animation of pulse.getAnimations()) {
    animation.pause();
    animation.currentTime = 0;
  }
  return getComputedStyle(pulse);
}

it("shows one pulse ring in its pulse's colour", async () => {
  const el = await map(
    [
      t("f", "F", {}, { pulse: "forgotten" }),
      t("o", "O", { x: 10 }, { pulse: "overdue" }),
      t("h", "H", { x: 20 }, { pulse: "fire" }),
      t("n", "N", { x: 30 }),
    ],
    { reducedMotion: false },
  );
  host.style.setProperty("--wt-color-danger", "rgb(2, 2, 2)");
  host.style.setProperty("--wt-color-warning", "rgb(4, 4, 4)");
  expect(pulseOf(el, "f")!.dataset["pulse"]).toBe("forgotten");
  expect(atStart(pulseOf(el, "f")!).color).toBe("rgb(2, 2, 2)");
  expect(atStart(pulseOf(el, "o")!).color).toBe("rgb(2, 2, 2)");
  expect(atStart(pulseOf(el, "h")!).color).toBe("rgb(4, 4, 4)");
  expect(button(el, "n").querySelector("[data-pulse]")).toBeNull();
  expect(button(el, "f").querySelectorAll("[data-pulse]")).toHaveLength(1);
});

it("lays the pulse ring around the shape, its shadow outside it", async () => {
  const el = await map([t("f", "F", {}, { pulse: "forgotten" })], { reducedMotion: false });
  const shape = within(el, "shape", "f")!;
  const edge = shape.clientLeft;
  const ring = pulseOf(el, "f")!.getBoundingClientRect();
  const box = shape.getBoundingClientRect();
  expect([ring.left, ring.top, ring.right, ring.bottom]).toEqual([
    box.left + edge,
    box.top + edge,
    box.right - edge,
    box.bottom - edge,
  ]);
  const shadow = atStart(pulseOf(el, "f")!).boxShadow;
  expect(shadow).not.toBe("none");
  expect(shadow).not.toContain("inset");
});

it("rings each member of a merge that carries a pulse", async () => {
  const el = await map(
    [
      t("four", "4", { x: 0 }, { joinId: "j1", pulse: "fire" }),
      t("ten", "10", { x: 8 }, { joinId: "j1", pulse: "fire" }),
    ],
    { reducedMotion: false },
  );
  const shapes = [...button(el, "four").querySelectorAll('[part="shape"]')];
  expect(shapes.map((s) => s.querySelector("[data-pulse]")?.getAttribute("data-pulse"))).toEqual([
    "fire",
    "fire",
  ]);
});

it("a ring paints under a touching table listed after it", async () => {
  const el = await map([t("a", "A", { x: 0 }, { pulse: "forgotten" }), t("b", "B", { x: 8 })], {
    reducedMotion: false,
  });
  const ring = pulseOf(el, "a")!;
  // The ring takes no taps, and a box-shadow is never hit: letting it be hit over the box its
  // shadow paints makes the hit test read the paint order.
  ring.style.pointerEvents = "auto";
  ring.style.inset = "calc(var(--wt-space-1) * -1.5)";
  const second = within(el, "shape", "b")!;
  const box = second.getBoundingClientRect();
  const point = [box.left + 3, box.top + box.height / 2] as const;
  expect(el.shadowRoot!.elementFromPoint(...point)).toBe(second);
  button(el, "a").style.zIndex = "1";
  expect(el.shadowRoot!.elementFromPoint(...point)).toBe(ring);
});

it("keeps the pulse ring under a later sibling that covers the map", async () => {
  const outer = await mount(
    '<div style="position: relative"><wt-floor-map style="width: 600px; height: 300px"></wt-floor-map><div style="position: absolute; inset: 0"></div></div>',
  );
  const el = outer.firstElementChild as WtFloorMap;
  const cover = outer.lastElementChild!;
  el.reducedMotion = false;
  el.tables = [t("r", "R", {}, { pulse: "forgotten" })];
  await settled(el);
  const ring = pulseOf(el, "r")!;
  ring.style.pointerEvents = "auto";
  const box = ring.getBoundingClientRect();
  expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(cover);
});

it("draws the pulse ring by the browser's motion setting when told nothing", async () => {
  const el = await map([t("r", "R", {}, { pulse: "forgotten" })]);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  expect(pulseOf(el, "r") === null).toBe(reduced);
});

it("names the tables' group from its copy", async () => {
  const el = await map([t1]);
  const group = el.shadowRoot!.querySelector('[role="group"]')!;
  expect(group.getAttribute("aria-label")).toBe("Tables");
  expect(group.contains(button(el, "t1"))).toBe(true);
  el.copy = { label: "Terrace tables" };
  await el.updateComplete;
  expect(group.getAttribute("aria-label")).toBe("Terrace tables");
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

it("draws a merge's own name when it has one", async () => {
  const el = await map([
    t("bar", "Bar", { x: 0 }, { joinId: "j", groupName: "García birthday" }),
    t("c4", "Counter 4", { x: 8 }, { joinId: "j", groupName: "García birthday", name: "Window" }),
  ]);
  expect(within(el, "name", "bar")!.textContent).toBe("García birthday");
  expect(button(el, "bar").getAttribute("aria-label")).toBe("García birthday, Free");
});

it("names a merge from its tables' own names where they have one", async () => {
  const el = await map([
    t("c4", "Counter 4", { x: 8 }, { joinId: "j", name: "Window" }),
    t("bar", "Bar", { x: 0 }, { joinId: "j" }),
  ]);
  expect(within(el, "name", "bar")!.textContent).toBe("Bar+Window");
});

it("draws a single table's own name", async () => {
  const el = await map([t("c4", "Counter 4", {}, { name: "Window" })]);
  expect(within(el, "name", "c4")!.textContent).toBe("Window");
  expect(button(el, "c4").getAttribute("aria-label")).toBe("Window, Free");
});

it("keeps a named merge's button on its first member by saved label", async () => {
  const el = await map([
    t("ten", "10", { x: 8 }, { joinId: "j", name: "A window" }),
    t("four", "4", { x: 0 }, { joinId: "j", name: "Z corner" }),
  ]);
  const buttons = el.shadowRoot!.querySelectorAll<HTMLElement>('[part="table"]');
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.dataset["tableId"]).toBe("four");
  expect(within(el, "name", "four")!.textContent).toBe("A window+Z corner");
});

const shownNames = (el: WtFloorMap) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>('[part="name"]')].map((n) => n.textContent);

it("names a linked party with no names by all its tables in number order", async () => {
  const el = await map([
    t("m10", "Bar 10", { x: 0 }, { linkId: "p", joinId: "j" }),
    t("m4", "Bar 4", { x: 8 }, { linkId: "p", joinId: "j" }),
    t("b5", "Bar 5", { x: 16 }, { linkId: "p" }),
  ]);
  expect(shownNames(el)).toEqual(["Bar 4+5+10"]);
});

it("names a linked party with names by its groups' names in the groups' order", async () => {
  const el = await map([
    t("m10", "Bar 10", { x: 0 }, { linkId: "p", joinId: "j", groupName: "García birthday" }),
    t("m4", "Bar 4", { x: 8 }, { linkId: "p", joinId: "j", groupName: "García birthday" }),
    t("b5", "Bar 5", { x: 16 }, { linkId: "p" }),
  ]);
  expect(shownNames(el)).toEqual(["García birthday+Bar 5"]);
  expect(button(el, "b5").getAttribute("aria-label")).toBe("García birthday+Bar 5, Free");
});

it("names a linked party by a lone table's own name in the groups' order", async () => {
  const el = await map([
    t("b2", "Bar 2", { x: 0 }, { linkId: "p", name: "Window" }),
    t("b1", "Bar 1", { x: 8 }, { linkId: "p" }),
  ]);
  expect(shownNames(el)).toEqual(["Bar 1+Window"]);
});

it("names a linked party by its groups' names when only one table in a merge has a name", async () => {
  const el = await map([
    t("m4", "Bar 4", { x: 0 }, { linkId: "p", joinId: "j", name: "Window" }),
    t("m5", "Bar 5", { x: 8 }, { linkId: "p", joinId: "j" }),
    t("b2", "Bar 2", { x: 16 }, { linkId: "p" }),
  ]);
  expect(shownNames(el)).toEqual(["Bar 2+5+Window"]);
});

describe("the whole table shows its state", () => {
  /** A 2 × 2 table alone is cropped to 6 × 6 squares, so a map `3 × px` high draws it `px` wide. */
  async function sized(
    tablePx: number,
    over: Partial<FloorMapTable>,
    props: Partial<Pick<WtFloorMap, "reducedMotion">> = {},
  ): Promise<WtFloorMap> {
    const el = (await mount(
      `<wt-floor-map style="width: 600px; height: ${tablePx * 3}px"></wt-floor-map>`,
    )) as WtFloorMap;
    el.tables = [t("t", "T7", { width: 2, height: 2 }, over)];
    Object.assign(el, props);
    await settled(el);
    expect(boxOf(el, "t").width).toBeCloseTo(tablePx, 5);
    return el;
  }

  const inside = (inner: Element, outer: Element) => {
    const a = inner.getBoundingClientRect();
    const b = outer.getBoundingClientRect();
    return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  };

  const timerCue = { icon: "floor-timer", text: "Waiting" } as const;

  it("paints each new fill from its tokens", async () => {
    const tokens = {
      calm: ["--wt-color-table-calm", "--wt-color-on-table-calm"],
      ready: ["--wt-color-success", "--wt-color-on-success"],
      danger: ["--wt-color-danger", "--wt-color-on-danger"],
      warning: ["--wt-color-warning", "--wt-color-on-warning"],
      plain: ["--wt-color-surface", "--wt-color-text"],
    } as const;
    const fills = Object.keys(tokens) as (keyof typeof tokens)[];
    const el = await map(fills.map((fill, i) => t(fill, fill, { x: i * 10 }, { fill })));
    fills.forEach((fill, i) => {
      host.style.setProperty(tokens[fill][0], `rgb(${i + 1}, 10, 20)`);
      host.style.setProperty(tokens[fill][1], `rgb(${i + 1}, 30, 40)`);
    });
    fills.forEach((fill, i) => {
      expect(getComputedStyle(within(el, "shape", fill)!).backgroundColor, fill).toBe(
        `rgb(${i + 1}, 10, 20)`,
      );
      expect(getComputedStyle(button(el, fill)).color, fill).toBe(`rgb(${i + 1}, 30, 40)`);
    });
  });

  it("draws Overdue's outline thick and Waiting's thin, each over a surface line", async () => {
    const el = await map(
      [
        t("o", "O", {}, { fill: "bill", outline: "overdue" }),
        t("w", "W", { x: 10 }, { fill: "ready", outline: "waiting" }),
        t("n", "N", { x: 20 }, { fill: "seated" }),
      ],
      { reducedMotion: false },
    );
    host.style.setProperty("--wt-space-1", "8px");
    host.style.setProperty("--wt-color-surface", "rgb(9, 9, 9)");
    const ringIn = (id: string) =>
      within(el, "shape", id)!.querySelector<HTMLElement>("[data-ring]");
    const overdue = ringIn("o")!;
    expect(overdue.dataset["ring"]).toBe("overdue");
    expect(overdue.classList.contains("on-fill")).toBe(true);
    expect([...overdue.classList].filter((c) => c.startsWith("wt-pulse"))).toEqual([]);
    const thick = getComputedStyle(overdue).boxShadow;
    expect(thick).toContain(" 0px 0px 0px 8px inset");
    expect(thick.split(/, (?=rgb)/)[1]).toBe("rgb(9, 9, 9) 0px 0px 0px 9px inset");
    const waiting = ringIn("w")!;
    expect(waiting.dataset["ring"]).toBe("waiting");
    expect(waiting.classList.contains("on-fill")).toBe(true);
    const thin = getComputedStyle(waiting).boxShadow;
    expect(thin).toContain(" 0px 0px 0px 4px inset");
    expect(thin.split(/, (?=rgb)/)[1]).toBe("rgb(9, 9, 9) 0px 0px 0px 5px inset");
    expect(ringIn("n")).toBeNull();
  });

  it("dashes a table needing clearing", async () => {
    const el = await map([
      t("c", "C", {}, { fill: "plain", outline: "clearing" }),
      t("n", "N", { x: 10 }),
    ]);
    host.style.setProperty("--wt-color-warning", "rgb(7, 6, 5)");
    host.style.setProperty("--wt-space-1", "6px");
    const style = getComputedStyle(within(el, "shape", "c")!);
    expect(style.borderTopStyle).toBe("dashed");
    expect(style.borderLeftStyle).toBe("dashed");
    expect(style.borderTopColor).toBe("rgb(7, 6, 5)");
    expect(style.borderTopWidth).toBe("6px");
    expect(within(el, "shape", "c")!.querySelector("[data-ring]")).toBeNull();
    expect(getComputedStyle(within(el, "shape", "n")!).borderTopStyle).toBe("solid");
  });

  it("pulses outside the shape at the pulse's speed, and not under reduced motion", async () => {
    const el = await map(
      [
        t("a", "A", { x: 0 }, { joinId: "j", pulse: "forgotten" }),
        t("b", "B", { x: 8 }, { joinId: "j", pulse: "forgotten" }),
      ],
      { reducedMotion: false },
    );
    const shapes = () => [...button(el, "a").querySelectorAll('[part="shape"]')];
    for (const shape of shapes()) {
      const pulse = shape.querySelector<HTMLElement>('[data-pulse="forgotten"]')!;
      expect(pulse.classList.contains("wt-pulse-fast")).toBe(true);
    }
    el.reducedMotion = true;
    await el.updateComplete;
    expect(shapes()).toHaveLength(2);
    expect(button(el, "a").querySelector("[data-pulse]")).toBeNull();
  });

  it("draws the cue under the name on a table big enough for two lines", async () => {
    const el = await sized(36, { cue: timerCue, description: "Seated, Waiting" });
    const caption = within(el, "caption", "t")!;
    expect([...caption.children].map((c) => c.getAttribute("part"))).toEqual(["name", "cue"]);
    expect(within(el, "name", "t")!.textContent).toBe("T7");
    const cue = within(el, "cue", "t")!;
    const icon = cue.querySelector("wt-icon")!;
    expect(icon.getAttribute("name")).toBe("floor-timer");
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("svg path")?.getAttribute("d")).toMatch(/\S/);
    expect(cue.textContent!.trim()).toBe("Waiting");
    const shape = within(el, "shape", "t")!;
    expect(inside(within(el, "name", "t")!, shape)).toBe(true);
    expect(inside(cue, shape)).toBe(true);

    const smaller = await sized(35, { cue: timerCue });
    expect(within(smaller, "cue", "t")).toBeNull();
    expect(within(smaller, "caption", "t")).toBeNull();
    expect(within(smaller, "name", "t")!.textContent).toBe("T7");

    const tiny = await sized(27, { cue: timerCue, description: "Seated, Waiting" });
    expect(within(tiny, "cue", "t")).toBeNull();
    expect(within(tiny, "name", "t")).toBeNull();
    expect(button(tiny, "t").getAttribute("aria-label")).toBe("T7, Seated, Waiting");
  });

  it("lays the cue out as the design asks", async () => {
    const el = await sized(60, { cue: timerCue });
    host.style.setProperty("--wt-space-1", "3px");
    host.style.setProperty("--wt-font-size-sm", "11px");
    const caption = getComputedStyle(within(el, "caption", "t")!);
    expect([caption.display, caption.flexDirection, caption.position, caption.overflow]).toEqual([
      "flex",
      "column",
      "relative",
      "hidden",
    ]);
    expect(caption.maxWidth).toBe("100%");
    expect(parseFloat(caption.lineHeight)).toBeCloseTo(parseFloat(caption.fontSize) * 1.2, 1);
    const cue = getComputedStyle(within(el, "cue", "t")!);
    expect([cue.display, cue.alignItems, cue.justifyContent, cue.columnGap]).toEqual([
      "flex",
      "center",
      "center",
      "3px",
    ]);
    expect([cue.fontSize, cue.whiteSpace, cue.overflow]).toEqual(["11px", "nowrap", "hidden"]);
    const icon = getComputedStyle(within(el, "cue", "t")!.querySelector("wt-icon")!);
    expect([icon.flexShrink, icon.flexGrow]).toEqual(["0", "0"]);
    host.style.setProperty("--wt-color-text", "rgb(1, 1, 1)");
    host.style.setProperty("--wt-color-on-table-free", "rgb(2, 3, 4)");
    expect(icon.color).toBe("rgb(2, 3, 4)");
    expect(within(el, "caption", "t")!.hasAttribute("data-fill")).toBe(false);
  });

  it("cuts a long cue with an ellipsis", async () => {
    const el = await sized(36, { cue: { icon: "floor-step", text: "x".repeat(40) } });
    const cue = within(el, "cue", "t")!;
    expect(getComputedStyle(cue).overflow).toBe("hidden");
    expect(getComputedStyle(cue).textOverflow).toBe("ellipsis");
    const text = cue.querySelector<HTMLElement>(".cue-text")!;
    expect(text.textContent).toBe("x".repeat(40));
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
    expect(getComputedStyle(text).textOverflow).toBe("ellipsis");
    expect(inside(cue, within(el, "shape", "t")!)).toBe(true);
  });

  it("keeps the name and the cue clear of an outline drawn inside the shape", async () => {
    // Thickness inside the shape's edge at --wt-space-1 4px: overdue 4 + 1, waiting 2 + 1, dashes 4.
    const thickness = { overdue: 5, waiting: 3, clearing: 4 } as const;
    const clear = (inner: Element, shape: Element, by: number) => {
      const a = inner.getBoundingClientRect();
      const b = shape.getBoundingClientRect();
      return a.left >= b.left + by && a.right <= b.right - by;
    };
    for (const outline of ["overdue", "waiting", "clearing"] as const) {
      const long = { icon: "floor-timer", text: "x".repeat(40) } as const;
      const el = await sized(60, { fill: "ready", outline, cue: long });
      host.style.setProperty("--wt-space-1", "4px");
      const shape = within(el, "shape", "t")!;
      expect(clear(within(el, "caption", "t")!, shape, thickness[outline]), outline).toBe(true);
      const named = await sized(30, { fill: "ready", outline, label: "x".repeat(20), cue: long });
      host.style.setProperty("--wt-space-1", "4px");
      const name = within(named, "name", "t")!;
      expect(clear(name, within(named, "shape", "t")!, thickness[outline]), outline).toBe(true);
    }
  });

  it("a cue with no text draws its icon alone", async () => {
    const el = await sized(36, { cue: { icon: "floor-check", text: "" } });
    const cue = within(el, "cue", "t")!;
    expect(cue.querySelector("wt-icon")!.getAttribute("name")).toBe("floor-check");
    expect(cue.textContent!.trim()).toBe("");
    expect(cue.querySelector(".cue-text")).toBeNull();
    const words = await sized(36, { cue: { icon: null, text: "21:00" } });
    expect(within(words, "cue", "t")!.querySelector("wt-icon")).toBeNull();
    expect(within(words, "cue", "t")!.textContent!.trim()).toBe("21:00");
  });

  it("rings a table needing clearing outside its dashes", async () => {
    const el = await map(
      [t("c", "C", {}, { fill: "danger", outline: "clearing", pulse: "forgotten" })],
      { reducedMotion: false },
    );
    host.style.setProperty("--wt-space-1", "6px");
    const shape = within(el, "shape", "c")!;
    expect(shape.clientLeft).toBe(6);
    const ring = pulseOf(el, "c")!.getBoundingClientRect();
    const box = shape.getBoundingClientRect();
    expect([ring.left, ring.top, ring.right, ring.bottom]).toEqual([
      box.left,
      box.top,
      box.right,
      box.bottom,
    ]);
  });

  it("draws the name alone when there is no cue", async () => {
    const el = await sized(60, { cue: null });
    expect(within(el, "caption", "t")).toBeNull();
    expect(within(el, "name", "t")!.textContent).toBe("T7");
  });

  it("draws a linked party's cue once, under its one name", async () => {
    const el = await map([
      t("b1", "Bar 1", { x: 0 }, { linkId: "p", cue: timerCue }),
      t("b2", "Bar 2", { x: 12 }, { linkId: "p", cue: timerCue }),
    ]);
    expect(within(el, "cue", "b1")).not.toBeNull();
    expect(within(el, "cue", "b2")).toBeNull();
    expect(within(el, "name", "b2")).toBeNull();
  });

  it("says a drawn cue's words straight after the name", async () => {
    const bill = {
      cue: { icon: "floor-bill", text: "Bill" },
      description: "Seated, Bill requested",
    } as const;
    const label = (el: WtFloorMap) => button(el, "t").getAttribute("aria-label");
    expect(label(await sized(36, bill))).toBe("T7, Bill, Seated, Bill requested");
    expect(label(await sized(35, bill))).toBe("T7, Seated, Bill requested");
    expect(
      label(
        await sized(36, {
          cue: { icon: "floor-check", text: "" },
          description: "Seated, Nothing needed",
        }),
      ),
    ).toBe("T7, Seated, Nothing needed");
    const allergic = await sized(36, { ...bill, allergy: true });
    expect(label(allergic)).toBe("T7, Bill, Seated, Bill requested, Allergy");
  });

  it("paints a merge's caption in its fill when it shows a cue", async () => {
    const el = await map([
      t("ten", "10", { x: 8, y: 0 }, { joinId: "j1", fill: "seated", cue: timerCue }),
      t("four", "4", { x: 0, y: 0 }, { joinId: "j1", fill: "seated", cue: timerCue }),
    ]);
    host.style.setProperty("--wt-color-table-seated", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-space-1", "5px");
    const caption = getComputedStyle(within(el, "caption", "four")!);
    expect(caption.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(caption.paddingLeft).toBe("5px");
    expect(caption.paddingRight).toBe("5px");
    host.style.setProperty("--wt-radius-sm", "4px");
    expect(caption.borderTopLeftRadius).toBe("4px");
    const name = getComputedStyle(within(el, "name", "four")!);
    expect([name.paddingLeft, name.backgroundColor]).toEqual(["0px", "rgba(0, 0, 0, 0)"]);
  });

  it("the cue paints over its own shape", async () => {
    const el = await sized(60, { fill: "calm", cue: timerCue });
    const cue = within(el, "cue", "t")!;
    cue.style.pointerEvents = "auto";
    const box = cue.getBoundingClientRect();
    const hit = el.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(hit !== null && cue.contains(hit)).toBe(true);
  });
});

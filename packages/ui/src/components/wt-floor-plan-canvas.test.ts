import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { PlanCanvasTable, TableSelect, WtFloorPlanCanvas } from "./wt-floor-plan-canvas.js";
import "./wt-floor-plan-canvas.js";

afterEach(cleanup);

const place = (over: Partial<PlanPlacement> = {}): PlanPlacement => ({
  x: 0,
  y: 0,
  width: 8,
  height: 8,
  shape: "rect",
  rotation: 0,
  ...over,
});

const table = (key: string, label: string, over: Partial<PlanPlacement> = {}, fixed = false) =>
  ({ key, label, fixed, placement: place(over) }) satisfies PlanCanvasTable;

async function canvas(
  tables: PlanCanvasTable[],
  props: Partial<Pick<WtFloorPlanCanvas, "selected" | "copy">> = {},
  mounter: (html: string) => Promise<HTMLElement> = mount,
): Promise<WtFloorPlanCanvas> {
  const el = (await mounter(
    '<wt-floor-plan-canvas style="width: 600px; height: 360px"></wt-floor-plan-canvas>',
  )) as WtFloorPlanCanvas;
  el.tables = tables;
  Object.assign(el, props);
  await el.updateComplete;
  return el;
}

const part = (el: WtFloorPlanCanvas, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part~="${name}"]`)!;

const button = (el: WtFloorPlanCanvas, key: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)!;

/** Waits for the ResizeObserver's first reading to reach the grid. */
async function settled(el: WtFloorPlanCanvas): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await el.updateComplete;
}

function selects(target: EventTarget): CustomEvent<TableSelect>[] {
  const seen: CustomEvent<TableSelect>[] = [];
  target.addEventListener("wt-table-select", (e) => seen.push(e as CustomEvent<TableSelect>));
  return seen;
}

it("draws each table at its grid place and size", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3, width: 8, height: 4 })]);
  const grid = part(el, "grid").getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.left - grid.left).toBe(24);
  expect(box.top - grid.top).toBe(36);
  expect(box.width).toBe(96);
  expect(box.height).toBe(48);
});

it("turns a table about its centre", async () => {
  const el = await canvas([table("t1", "T1", { width: 8, height: 4, rotation: 90 })]);
  const style = getComputedStyle(button(el, "t1"));
  const m = new DOMMatrix(style.transform);
  expect(m.a).toBeCloseTo(0);
  expect(m.b).toBeCloseTo(1);
  expect(m.c).toBeCloseTo(-1);
  expect(m.d).toBeCloseTo(0);
  expect(style.transformOrigin).toBe("48px 24px");
});

it("draws a round table as a circle when its sides match", async () => {
  const el = await canvas([table("r", "R", { shape: "round" }), table("s", "S", { x: 10 })]);
  host.style.setProperty("--wt-radius-sm", "5px");
  expect(getComputedStyle(button(el, "r")).borderTopLeftRadius).toBe("50%");
  expect(getComputedStyle(button(el, "s")).borderTopLeftRadius).toBe("5px");
});

it("paints the fixed mark from a token", async () => {
  const el = await canvas([table("t2", "T2", {}, true)]);
  host.style.setProperty("--wt-color-text-muted", "rgb(13, 14, 15)");
  const marker = button(el, "t2").querySelector<HTMLElement>('[part="fixed-marker"]')!;
  expect(getComputedStyle(marker).backgroundColor).toBe("rgb(13, 14, 15)");
});

it("keeps the fixed mark inside a round table", async () => {
  const el = await canvas([
    table("round", "R", { width: 6, height: 6, shape: "round" }, true),
    table("small", "S", { x: 10, width: 2, height: 2, shape: "round" }, true),
  ]);
  for (const key of ["round", "small"]) {
    const marker = button(el, key).querySelector<HTMLElement>('[part="fixed-marker"]')!;
    const box = marker.getBoundingClientRect();
    const hit = el.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(hit, key).toBe(marker);
  }
});

it("marks a fixed table and says so in its name", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 10 }, true)]);
  expect(button(el, "t2").querySelector('[part="fixed-marker"]')).not.toBeNull();
  expect(button(el, "t2").getAttribute("aria-label")).toBe("T2, Fixed");
  expect(button(el, "t1").querySelector('[part="fixed-marker"]')).toBeNull();
  expect(button(el, "t1").getAttribute("aria-label")).toBe("T1");
});

it("says fixed in the words its copy gives", async () => {
  const el = await canvas([table("t2", "T2", {}, true)], { copy: { fixed: "Fija" } });
  expect(button(el, "t2").getAttribute("aria-label")).toBe("T2, Fija");
});

it("hides a name drawn under 28 px and keeps it as the accessible name", async () => {
  const el = await canvas([
    table("small", "Bar 1", { width: 2, height: 2 }),
    table("big", "Bar 1", { x: 10, width: 3, height: 3 }),
  ]);
  expect(button(el, "small").textContent!.trim()).toBe("");
  expect(button(el, "small").getAttribute("aria-label")).toBe("Bar 1");
  expect(button(el, "big").textContent!.trim()).toBe("Bar 1");
});

it("fills the visible area with grid when there are no tables", async () => {
  const el = await canvas([]);
  await settled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  expect(grid.width).toBe(600);
  expect(grid.height).toBe(360);
  expect(getComputedStyle(part(el, "grid")).backgroundSize).toBe("12px 12px, 12px 12px");
});

it("fills a box that is not a whole number of squares without overflowing it", async () => {
  const el = await canvas([]);
  el.style.width = "605px";
  el.style.height = "301px";
  await settled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  expect(grid.width).toBe(605);
  expect(grid.height).toBe(301);
});

/**
 * Stands in for classic scrollbars, which take room inside the viewport's box: this headless
 * Chromium draws none that do, even under a `::-webkit-scrollbar` width.
 */
function classicScrollbars(el: WtFloorPlanCanvas): void {
  const style = document.createElement("style");
  style.textContent =
    "wt-floor-plan-canvas::part(viewport) { border-right: 15px solid transparent; border-bottom: 15px solid transparent }";
  el.parentNode!.appendChild(style);
}

it("shows no scrollbars on an empty plan, even where scrollbars take room", async () => {
  const el = await canvas([]);
  classicScrollbars(el);
  el.style.width = "605px";
  el.style.height = "300px";
  await settled(el);
  await settled(el);
  const viewport = part(el, "viewport");
  expect(viewport.clientWidth).toBe(590);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
});

it("keeps a steady height in a box that takes its height from the plan", async () => {
  const el = (await mount(
    '<wt-floor-plan-canvas style="width: 600px"></wt-floor-plan-canvas>',
  )) as WtFloorPlanCanvas;
  classicScrollbars(el);
  el.tables = [table("t1", "T1", { x: 100 })];
  const heights: number[] = [];
  for (let frame = 0; frame < 6; frame++) {
    await settled(el);
    heights.push(part(el, "grid").getBoundingClientRect().height);
  }
  expect(heights).toEqual(Array(6).fill(192));
});

it("draws 8 squares past the furthest table", async () => {
  const el = await canvas([table("t1", "T1", { x: 100, width: 8 })]);
  expect(part(el, "grid").getBoundingClientRect().width).toBe(1392);
  await settled(el);
  expect(part(el, "grid").getBoundingClientRect().width).toBe(1392);
  expect(part(el, "viewport").scrollWidth).toBe(1392);
});

it("a click on a table asks to select it and stops the click", async () => {
  const el = await canvas([table("t1", "T1")], {}, mountInShadowRoot);
  const seen = selects(document);
  let clicks = 0;
  const outside = (el.getRootNode() as ShadowRoot).host.parentElement!;
  outside.addEventListener("click", () => clicks++);
  await userEvent.click(button(el, "t1"));
  expect(seen).toHaveLength(1);
  expect(seen[0]!.detail).toEqual({ key: "t1" });
  expect(seen[0]!.bubbles).toBe(true);
  expect(seen[0]!.composed).toBe(true);
  expect(clicks).toBe(0);
});

it("a click on empty grid asks to clear the selection", async () => {
  const el = await canvas([table("t1", "T1")], { selected: "t1" });
  await settled(el);
  const seen = selects(el);
  let clicks = 0;
  host.addEventListener("click", () => clicks++);
  await userEvent.click(part(el, "grid"), { position: { x: 400, y: 300 } });
  expect(seen).toHaveLength(1);
  expect(seen[0]!.detail).toEqual({ key: null });
  expect(clicks).toBe(0);
});

it("Enter on a focused table selects it", async () => {
  const el = await canvas([table("t1", "T1")]);
  const seen = selects(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Enter}");
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1" }]);
});

it("draws the selected table as pressed", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 10 })], {
    selected: "t1",
  });
  expect(button(el, "t1").getAttribute("aria-pressed")).toBe("true");
  expect(button(el, "t2").getAttribute("aria-pressed")).toBe("false");
});

it("leaves the selection to its parent", async () => {
  const el = await canvas([table("t1", "T1")]);
  await userEvent.click(button(el, "t1"));
  await el.updateComplete;
  expect(el.selected).toBeNull();
  expect(button(el, "t1").getAttribute("aria-pressed")).toBe("false");
});

it("paints from tokens", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 10 })], {
    selected: "t1",
  });
  host.style.setProperty("--wt-color-surface-lifted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-primary", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  expect(getComputedStyle(part(el, "grid")).backgroundColor).toBe("rgb(10, 11, 12)");
  expect(getComputedStyle(button(el, "t2")).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(button(el, "t2")).borderTopColor).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(button(el, "t1")).borderTopColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(part(el, "grid")).backgroundImage).toContain("rgb(7, 8, 9)");
});

it("names the group from its copy", async () => {
  const el = await canvas([table("t1", "T1")], { copy: { label: "Plano" } });
  const group = el.shadowRoot!.querySelector('[role="group"]')!;
  expect(group.getAttribute("aria-label")).toBe("Plano");
  expect(group.contains(button(el, "t1"))).toBe(true);
});

it("names the group in English by default", async () => {
  const el = await canvas([]);
  expect(el.shadowRoot!.querySelector('[role="group"]')!.getAttribute("aria-label")).toBe(
    "Floor plan",
  );
});

it("keeps following its size after it is moved", async () => {
  const el = await canvas([]);
  await settled(el);
  const elsewhere = document.createElement("div");
  host.appendChild(elsewhere);
  elsewhere.appendChild(el);
  el.style.width = "300px";
  await settled(el);
  expect(part(el, "grid").getBoundingClientRect().width).toBe(300);
});

it("stops following its size once it is removed", async () => {
  const el = await canvas([]);
  await settled(el);
  el.remove();
  await settled(el);
  expect(part(el, "grid").style.width).toBe("600px");
});

it("keeps focus and the pressed state off another table when the list is reordered", async () => {
  const t1 = table("t1", "T1");
  const t2 = table("t2", "T2", { x: 10 });
  const el = await canvas([t1, t2], { selected: "t1" });
  const first = button(el, "t1");
  first.focus();
  el.tables = [t2, t1];
  await el.updateComplete;
  expect(button(el, "t1")).toBe(first);
  expect(el.shadowRoot!.activeElement).not.toBe(button(el, "t2"));
  expect(first.getAttribute("aria-pressed")).toBe("true");
});

it("does not watch its size when removed before its first draw", async () => {
  const observe = vi.spyOn(ResizeObserver.prototype, "observe");
  try {
    const el = document.createElement("wt-floor-plan-canvas");
    document.body.appendChild(el);
    el.remove();
    await el.updateComplete;
    await Promise.resolve();
    expect(observe).not.toHaveBeenCalled();
  } finally {
    observe.mockRestore();
  }
});

it("passes focus to its first table", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 10 })]);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(button(el, "t1"));
});

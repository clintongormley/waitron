import { afterEach, expect, it } from "vitest";
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

it("rounds the visible area up to whole squares", async () => {
  const el = await canvas([]);
  el.style.width = "605px";
  el.style.height = "300px";
  await settled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  expect(grid.width).toBe(612);
  expect(grid.height).toBe(300);
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
  const grid = part(el, "grid");
  grid.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
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

it("passes focus to its first table", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 10 })]);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(button(el, "t1"));
});

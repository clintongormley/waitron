import { afterEach, expect, it } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { PreviewTable, WtFloorPlanPreview } from "./wt-floor-plan-preview.js";
import "./wt-floor-plan-preview.js";

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

const table = (key: string, over: Partial<PlanPlacement> = {}, fixed = false): PreviewTable => ({
  key,
  label: key.toUpperCase(),
  fixed,
  placement: place(over),
});

/** Two tables whose bounds run from square (4, 6) to (26, 16); the crop adds 2 squares round them. */
const pair = [
  table("a", { x: 4, y: 6, width: 8, height: 4 }),
  table("b", { x: 20, y: 10, width: 6, height: 6, shape: "round" }, true),
];

async function preview(
  tables: PreviewTable[],
  style = "width: 520px; --wt-floor-plan-preview-max-height: 1000px",
  props: Partial<Pick<WtFloorPlanPreview, "label">> = {},
): Promise<WtFloorPlanPreview> {
  const el = (await mount(
    `<wt-floor-plan-preview style="display: block; ${style}"></wt-floor-plan-preview>`,
  )) as WtFloorPlanPreview;
  el.tables = tables;
  Object.assign(el, props);
  await el.updateComplete;
  return el;
}

const plan = (el: WtFloorPlanPreview) =>
  el.shadowRoot!.querySelector<HTMLElement>('[part~="plan"]');

const drawn = (el: WtFloorPlanPreview, key: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part~="table"][data-key="${key}"]`)!;

it("places each table from the crop's corner, the 2-square margin included, scaled to the width", async () => {
  // The crop is 26 squares wide, so 520 px draws a square at 20 px.
  const el = await preview(pair);
  const box = plan(el)!.getBoundingClientRect();
  const a = drawn(el, "a").getBoundingClientRect();
  const b = drawn(el, "b").getBoundingClientRect();
  expect([a.left - box.left, a.top - box.top, a.width, a.height]).toEqual([40, 40, 160, 80]);
  expect([b.left - box.left, b.top - box.top, b.width, b.height]).toEqual([360, 120, 120, 120]);
});

it("keeps the crop's shape: 26 by 14 squares at 520 px wide is 280 px tall", async () => {
  const el = await preview(pair);
  const box = plan(el)!.getBoundingClientRect();
  expect(box.width).toBe(520);
  expect(box.height).toBe(280);
});

it("caps a tall plan at the max height and narrows it to keep its shape", async () => {
  // One 4 by 40 table crops to 8 by 44 squares.
  const el = await preview(
    [table("t", { width: 4, height: 40 })],
    "width: 520px; --wt-floor-plan-preview-max-height: 220px",
  );
  const box = plan(el)!.getBoundingClientRect();
  expect(box.height).toBeCloseTo(220, 1);
  expect(box.width).toBeCloseTo(40, 1);
});

it("caps at four tap targets' height by default, read from the token", async () => {
  const el = await preview([table("t", { width: 4, height: 40 })], "width: 520px");
  host.style.setProperty("--wt-tap-min", "50px");
  const box = plan(el)!.getBoundingClientRect();
  expect(box.height).toBeCloseTo(200, 1);
});

it("turns a table about its centre", async () => {
  const el = await preview([table("t", { width: 8, height: 4, rotation: 90 })]);
  const style = getComputedStyle(drawn(el, "t"));
  const m = new DOMMatrix(style.transform);
  expect(m.a).toBeCloseTo(0);
  expect(m.b).toBeCloseTo(1);
  const { width, height } = drawn(el, "t").getBoundingClientRect();
  // Turned a quarter, the 8 by 4 box stands 4 wide and 8 tall on screen.
  expect(height / width).toBeCloseTo(2);
  const [originX, originY] = style.transformOrigin.split(" ").map(parseFloat);
  expect(originX).toBeCloseTo(parseFloat(style.width) / 2, 1);
  expect(originY).toBeCloseTo(parseFloat(style.height) / 2, 1);
});

it("draws a round table as a circle and a rect one with the small radius", async () => {
  const el = await preview(pair);
  host.style.setProperty("--wt-radius-sm", "5px");
  expect(getComputedStyle(drawn(el, "b")).borderTopLeftRadius).toBe("50%");
  expect(getComputedStyle(drawn(el, "a")).borderTopLeftRadius).toBe("5px");
});

it("marks only the fixed table", async () => {
  const el = await preview(pair);
  expect(drawn(el, "a").querySelector('[part="fixed-marker"]')).toBeNull();
  expect(drawn(el, "b").querySelector('[part="fixed-marker"]')).not.toBeNull();
});

it("draws no table names", async () => {
  const el = await preview(pair);
  expect(plan(el)!.textContent!.trim()).toBe("");
});

it("is one image named by its label, with nothing to focus", async () => {
  const el = await preview(pair, undefined, { label: "Floor plan: Terrace" });
  expect(plan(el)!.getAttribute("role")).toBe("img");
  expect(plan(el)!.getAttribute("aria-label")).toBe("Floor plan: Terrace");
  expect(el.shadowRoot!.querySelectorAll("button, [tabindex], a, input")).toHaveLength(0);
});

it("is named 'Floor plan' by default", async () => {
  const el = await preview(pair);
  expect(plan(el)!.getAttribute("aria-label")).toBe("Floor plan");
});

it("draws nothing for no tables", async () => {
  const el = await preview([]);
  expect(plan(el)).toBeNull();
  expect(el.getBoundingClientRect().height).toBe(0);
});

it("paints from tokens", async () => {
  const el = await preview(pair);
  host.style.setProperty("--wt-color-surface-lifted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-text-muted", "rgb(13, 14, 15)");
  expect(getComputedStyle(plan(el)!).backgroundColor).toBe("rgb(10, 11, 12)");
  expect(getComputedStyle(plan(el)!).boxShadow).toContain("rgb(7, 8, 9)");
  expect(getComputedStyle(drawn(el, "a")).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(drawn(el, "a")).borderTopColor).toBe("rgb(7, 8, 9)");
  const marker = drawn(el, "b").querySelector<HTMLElement>('[part="fixed-marker"]')!;
  expect(getComputedStyle(marker).backgroundColor).toBe("rgb(13, 14, 15)");
});

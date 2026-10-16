import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import {
  type PlanCorner,
  type PlanPlacement,
  cornerSides,
  outward,
  resizeCursor,
  resizeFrom,
  resizeFromCorner,
} from "../floor-plan-geometry.js";
import type {
  PlanCanvasTable,
  TableMove,
  TableResize,
  TableRotate,
  TableSelect,
  WtFloorPlanCanvas,
} from "./wt-floor-plan-canvas.js";
import "./wt-floor-plan-canvas.js";

afterEach(cleanup);
afterEach(() => window.scrollTo(0, 0));

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
  props: Partial<Pick<WtFloorPlanCanvas, "selected" | "copy" | "bottomInset">> = {},
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
  expect(box.left - grid.left).toBe(96);
  expect(box.top - grid.top).toBe(108);
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

const refusedTable = (
  key: string,
  label: string,
  refused: string,
  over: Partial<PlanPlacement> = {},
) => ({ ...table(key, label, over), refused }) satisfies PlanCanvasTable;

const reasonOf = (el: WtFloorPlanCanvas, key: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part="refused-reason"][data-key="${key}"]`);

it("outlines a refused table in the error colour from a token, and no other table", async () => {
  const el = await canvas([
    refusedTable("t1", "T1", "Booked 12 Oct, 21:00"),
    table("t2", "T2", { x: 10 }),
  ]);
  host.style.setProperty("--wt-color-danger", "rgb(7, 8, 9)");
  const refused = getComputedStyle(button(el, "t1"));
  expect(refused.outlineColor).toBe("rgb(7, 8, 9)");
  expect(refused.outlineStyle).toBe("solid");
  expect(refused.outlineWidth).toBe("2px");
  expect(getComputedStyle(reasonOf(el, "t1")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(button(el, "t2")).outlineStyle).toBe("none");
});

it("writes a refused table's reason below it, outside a round table's clip", async () => {
  const el = await canvas([
    refusedTable("r", "R", "Booked 12 Oct, 21:00", {
      x: 4,
      y: 2,
      width: 4,
      height: 4,
      shape: "round",
    }),
    table("s", "S", { x: 12 }),
  ]);
  await settled(el);
  const reason = reasonOf(el, "r")!;
  expect(reason.textContent!.trim()).toBe("Booked 12 Oct, 21:00");
  expect(reason.closest("button")).toBeNull();
  const label = reason.getBoundingClientRect();
  const box = button(el, "r").getBoundingClientRect();
  expect(label.width).toBeGreaterThan(box.width);
  expect(label.top).toBeGreaterThanOrEqual(box.bottom);
  expect(reasonOf(el, "s")).toBeNull();
});

it("writes a selected refused table's reason below the table and its bottom dot", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { y: 10 })], {
    selected: "t1",
  });
  host.style.setProperty("--wt-space-5", "30px");
  await settled(el);
  const bottom = button(el, "t1").getBoundingClientRect().bottom;
  expect(reasonOf(el, "t1")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(bottom + 15);
});

it("writes an unselected refused table's reason one --wt-space-1 below it, with no room for a dot", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { y: 10 })]);
  host.style.setProperty("--wt-space-5", "30px");
  host.style.setProperty("--wt-space-1", "4px");
  await settled(el);
  const bottom = button(el, "t1").getBoundingClientRect().bottom;
  expect(reasonOf(el, "t1")!.getBoundingClientRect().top).toBeCloseTo(bottom + 4, 0);
});

it("keeps a refused table's reason inside the grid at its left and right edges", async () => {
  const el = await canvas([
    refusedTable("left", "L", "Booked 12 Oct, 21:00", { x: 0, width: 4, height: 4 }),
    refusedTable("mid", "M", "Booked 12 Oct, 21:00", { x: 20, width: 4, height: 4 }),
  ]);
  await settled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  const left = reasonOf(el, "left")!.getBoundingClientRect();
  expect(left.left).toBeGreaterThanOrEqual(grid.left);
  expect(left.width).toBeGreaterThan(48);
  const mid = reasonOf(el, "mid")!.getBoundingClientRect();
  const midBox = button(el, "mid").getBoundingClientRect();
  expect(mid.left + mid.width / 2).toBeCloseTo(midBox.left + midBox.width / 2, 0);
  const long = "This table has an upcoming booking. Move the booking first";
  el.tables = [refusedTable("right", "R", long, { x: 40, width: 2, height: 2 })];
  await settled(el);
  const wide = part(el, "grid").getBoundingClientRect();
  const right = reasonOf(el, "right")!.getBoundingClientRect();
  const rightBox = button(el, "right").getBoundingClientRect();
  expect(rightBox.left + rightBox.width / 2 + right.width / 2).toBeGreaterThan(wide.right);
  expect(right.right).toBeLessThanOrEqual(wide.right);
  expect(right.left).toBeGreaterThanOrEqual(wide.left);
});

it("keeps room in the grid for the reason of a refused table at the bottom", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { y: 22 })]);
  await settled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  const label = reasonOf(el, "t1")!.getBoundingClientRect();
  expect(label.top).toBeGreaterThanOrEqual(button(el, "t1").getBoundingClientRect().bottom);
  expect(label.bottom).toBeLessThanOrEqual(grid.bottom);
});

it("gives a refused table its reason as its accessible description", async () => {
  const el = await canvas([
    refusedTable("t1", "T1", "Booked 12 Oct, 21:00"),
    table("t2", "T2", { x: 10 }),
  ]);
  await expect.element(button(el, "t1")).toHaveAccessibleDescription("Booked 12 Oct, 21:00");
  await expect.element(button(el, "t1")).toHaveAccessibleName("T1");
  expect(button(el, "t2").hasAttribute("aria-describedby")).toBe(false);
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
 * Chromium draws none that do, even under a `::-webkit-scrollbar` width. Unlike a real scrollbar,
 * which appears only on overflow, this 15 px border is always there.
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
  expect(heights).toEqual(Array(6).fill(264));
});

it("draws 8 squares past the furthest table", async () => {
  const el = await canvas([table("t1", "T1", { x: 100, width: 8 })]);
  expect(part(el, "grid").getBoundingClientRect().width).toBe(1464);
  await settled(el);
  expect(part(el, "grid").getBoundingClientRect().width).toBe(1464);
  expect(part(el, "viewport").scrollWidth).toBe(1464);
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

function marginOf(el: WtFloorPlanCanvas, key: string) {
  const grid = part(el, "grid");
  const style = getComputedStyle(grid);
  const g = grid.getBoundingClientRect();
  const b = button(el, key).getBoundingClientRect();
  return {
    style,
    padding: { left: parseFloat(style.paddingLeft), top: parseFloat(style.paddingTop) },
    drawn: { left: b.left - g.left, top: b.top - g.top },
  };
}

it("draws no grid in the margin, so the lines start at the plan's x 0 and y 0", async () => {
  const el = await canvas([table("t1", "T1")]);
  await settled(el);
  const m = marginOf(el, "t1");
  expect(m.padding).toEqual({ left: 72, top: 72 });
  expect(m.drawn.left).toBeCloseTo(72);
  expect(m.drawn.top).toBeCloseTo(72);
  expect(m.style.backgroundClip).toBe("content-box, content-box");
  expect(m.style.backgroundOrigin).toBe("content-box, content-box");
});

it("draws no grid in the margin past a table that arrived poking out", async () => {
  const el = await canvas([
    table("t1", "T1", { rotation: 45 }),
    table("t2", "T2", { x: 0, y: 20 }),
  ]);
  await settled(el);
  const m = marginOf(el, "t2");
  expect(m.padding.left).toBeGreaterThan(72);
  expect(m.padding.left).toBeCloseTo(m.drawn.left);
  const top = getComputedStyle(part(el, "grid")).paddingTop;
  const turned = button(el, "t1").getBoundingClientRect();
  const grid = part(el, "grid").getBoundingClientRect();
  // The 8 × 8's unturned top-left is at the plan's (0, 0); its centre is 4 squares in.
  expect(parseFloat(top)).toBeCloseTo(turned.top + turned.height / 2 - grid.top - 4 * 12);
});

it("paints the blank margin with the surface colour", async () => {
  const el = await canvas([table("t1", "T1")]);
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  expect(getComputedStyle(part(el, "viewport")).backgroundColor).toBe("rgb(10, 11, 12)");
});

it("a click in the blank margin still asks to clear the selection", async () => {
  const el = await canvas([table("t1", "T1")], { selected: "t1" });
  await settled(el);
  const seen = selects(el);
  await userEvent.click(part(el, "grid"), { position: { x: 6, y: 6 } });
  expect(seen.map((e) => e.detail)).toEqual([{ key: null }]);
});

it("paints the side dots, the size badge and the turn arrow from tokens", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  host.style.setProperty("--wt-color-primary", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-text", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-color-bg", "rgb(16, 17, 18)");
  const top = getComputedStyle(drawn(el, "top"));
  expect(top.borderTopColor).toBe("rgb(4, 5, 6)");
  expect(top.backgroundColor).toBe("rgb(10, 11, 12)");
  expect(getComputedStyle(drawnCorner(el, "top-left")).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(handles(el)[0]!).color).toBe("rgb(13, 14, 15)");
  const at = dragDot(el, "right", 24, 0);
  await el.updateComplete;
  expect(getComputedStyle(drawnCorner(el, "top-right")).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(drawn(el, "right")).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(drawn(el, "top")).backgroundColor).toBe("rgb(10, 11, 12)");
  const badge = getComputedStyle(part(el, "size-badge"));
  expect(badge.backgroundColor).toBe("rgb(13, 14, 15)");
  expect(badge.color).toBe("rgb(16, 17, 18)");
  pointer(window, "pointercancel", 1, at.x, at.y);
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

function moves(target: EventTarget): TableMove[] {
  const seen: TableMove[] = [];
  target.addEventListener("wt-table-move", (e) => seen.push((e as CustomEvent<TableMove>).detail));
  return seen;
}

function rotates(target: EventTarget): TableRotate[] {
  const seen: TableRotate[] = [];
  target.addEventListener("wt-table-rotate", (e) =>
    seen.push((e as CustomEvent<TableRotate>).detail),
  );
  return seen;
}

function pointer(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId,
      clientX,
      clientY,
    }),
  );
}

/** Presses on `key`'s table and moves the same pointer by (dx, dy) px, without releasing it. */
function dragBy(el: WtFloorPlanCanvas, key: string, dx: number, dy: number, pointerId = 1) {
  const box = button(el, key).getBoundingClientRect();
  const x = box.left + 5;
  const y = box.top + 5;
  pointer(button(el, key), "pointerdown", pointerId, x, y);
  pointer(window, "pointermove", pointerId, x + dx, y + dy);
  return { x: x + dx, y: y + dy };
}

async function release(el: WtFloorPlanCanvas, at: { x: number; y: number }, pointerId = 1) {
  pointer(window, "pointerup", pointerId, at.x, at.y);
  await el.updateComplete;
}

function offset(el: WtFloorPlanCanvas, key: string): { left: number; top: number } {
  const grid = part(el, "grid").getBoundingClientRect();
  const box = button(el, key).getBoundingClientRect();
  return { left: box.left - grid.left, top: box.top - grid.top };
}

it("a drag snaps to whole squares and moves on release", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  await release(el, dragBy(el, "t1", 30, 13));
  expect(seen).toEqual([{ key: "t1", x: 5, y: 4 }]);
});

it("draws the table where the drag has it before release", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  dragBy(el, "t1", 30, 13);
  await el.updateComplete;
  expect(offset(el, "t1")).toEqual({ left: 132, top: 120 });
  expect(seen).toEqual([]);
});

it("a drag past the top or left edge stops at 0", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  await release(el, dragBy(el, "t1", -100, -100));
  expect(seen).toEqual([{ key: "t1", x: 0, y: 0 }]);
});

it("a drag straight down moves the table down", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  await release(el, dragBy(el, "t1", 0, 24));
  expect(seen).toEqual([{ key: "t1", x: 2, y: 5 }]);
});

it("takes the pointer's press so the page does not act on it", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 });
  button(el, "t1").dispatchEvent(down);
  pointer(window, "pointercancel", 1, 0, 0);
  expect(down.defaultPrevented).toBe(true);
});

it("a drag ends at release", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const at = dragBy(el, "t1", 24, 0);
  await release(el, at);
  pointer(window, "pointermove", 1, at.x + 120, at.y);
  await el.updateComplete;
  expect(offset(el, "t1")).toEqual({ left: 96, top: 108 });
  pointer(window, "pointerup", 1, at.x + 120, at.y);
  expect(seen).toEqual([{ key: "t1", x: 4, y: 3 }]);
});

it("another pointer's cancel leaves the drag going", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const at = dragBy(el, "t1", 24, 0);
  pointer(window, "pointercancel", 2, at.x, at.y);
  await release(el, at);
  expect(seen).toEqual([{ key: "t1", x: 4, y: 3 }]);
});

it("a drag ends when the canvas is removed", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const at = dragBy(el, "t1", 24, 0);
  const parent = el.parentNode!;
  el.remove();
  parent.appendChild(el);
  await el.updateComplete;
  expect(offset(el, "t1")).toEqual({ left: 96, top: 108 });
  await release(el, at);
  expect(seen).toEqual([]);
});

it("a drag that ends where it began sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  await release(el, dragBy(el, "t1", 5, 5));
  expect(seen).toEqual([]);
});

it("the grid grows while a table is dragged right and down", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  await settled(el);
  dragBy(el, "t1", 1440, 1440);
  await el.updateComplete;
  const grid = part(el, "grid").getBoundingClientRect();
  expect(grid.width).toBe((6 + 122 + 8 + 8) * 12);
  expect(grid.height).toBe((6 + 123 + 8 + 8) * 12);
});

it("a pointer cancel puts the table back and sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const at = dragBy(el, "t1", 30, 13);
  pointer(window, "pointercancel", 1, at.x, at.y);
  await el.updateComplete;
  expect(offset(el, "t1")).toEqual({ left: 96, top: 108 });
  pointer(window, "pointerup", 1, at.x, at.y);
  expect(seen).toEqual([]);
});

it("a second pointer cannot take over a drag", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 }), table("t2", "T2", { x: 20 })]);
  const seen = moves(el);
  const first = dragBy(el, "t1", 24, 0, 1);
  const second = dragBy(el, "t2", 60, 60, 2);
  await el.updateComplete;
  expect(offset(el, "t2")).toEqual({ left: 312, top: 72 });
  expect(offset(el, "t1")).toEqual({ left: 120, top: 108 });
  await release(el, second, 2);
  expect(seen).toEqual([]);
  await release(el, first, 1);
  expect(seen).toEqual([{ key: "t1", x: 4, y: 3 }]);
});

it("the arrow keys move a focused table one square", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  let outside = 0;
  host.addEventListener("keydown", () => outside++);
  const prevented: boolean[] = [];
  button(el, "t1").addEventListener("keydown", (e) => prevented.push(e.defaultPrevented));
  button(el, "t1").focus();
  await userEvent.keyboard("{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}");
  expect(seen).toEqual([
    { key: "t1", x: 3, y: 3 },
    { key: "t1", x: 1, y: 3 },
    { key: "t1", x: 2, y: 4 },
    { key: "t1", x: 2, y: 2 },
  ]);
  expect(prevented).toEqual([true, true, true, true]);
  expect(outside).toBe(0);
});

it("an arrow key at an edge sends nothing", async () => {
  const el = await canvas([
    table("low", "L", { x: 0, y: 0 }),
    table("high", "H", { x: 999, y: 999 }),
  ]);
  const seen = moves(el);
  button(el, "low").focus();
  await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
  button(el, "high").focus();
  await userEvent.keyboard("{ArrowRight}{ArrowDown}");
  expect(seen).toEqual([]);
});

it("other keys do nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const prevented: boolean[] = [];
  host.addEventListener("keydown", (e) => prevented.push(e.defaultPrevented));
  button(el, "t1").focus();
  await userEvent.keyboard("a");
  expect(seen).toEqual([]);
  expect(prevented).toEqual([false]);
});

const handles = (el: WtFloorPlanCanvas) =>
  el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[part~="rotate-handle"]');

it("shows the rotation handle on the selected table only, beside its button", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 10 }), table("t2", "T2", { x: 20 })], {
    selected: "t1",
  });
  const found = handles(el);
  expect(found).toHaveLength(1);
  const handle = found[0]!;
  expect(handle.tagName).toBe("BUTTON");
  expect(handle.getAttribute("aria-label")).toBe("Rotate T1");
  expect(button(el, "t1").contains(handle)).toBe(false);
  el.selected = null;
  await el.updateComplete;
  expect(handles(el)).toHaveLength(0);
  el.selected = "t1";
  el.copy = { rotate: "Girar {name}" };
  await el.updateComplete;
  expect(handles(el)[0]!.getAttribute("aria-label")).toBe("Girar T1");
});

const centreOf = (node: Element) => {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * Where the handle's centre belongs on screen: `away` px above the middle of `key`'s own top side,
 * turned with the table round its centre.
 */
function topCentre(el: WtFloorPlanCanvas, key: string, p: PlanPlacement, away: number) {
  const c = centreOf(button(el, key));
  const a = (p.rotation * Math.PI) / 180;
  const y = -(p.height * 12) / 2 - away;
  return { x: c.x - y * Math.sin(a), y: c.y + y * Math.cos(a) };
}

it("draws the handle at least a tap target square, above the middle of the table's top side", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
  });
  host.style.setProperty("--wt-tap-min", "50px");
  host.style.setProperty("--wt-space-1", "6px");
  const handle = handles(el)[0]!.getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(handle.width).toBeGreaterThanOrEqual(50);
  expect(handle.height).toBeGreaterThanOrEqual(50);
  // --wt-space-5 / 2 + --wt-space-1: 12 + 6.
  expect(Math.abs(handle.left + handle.width / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(
    1,
  );
  expect(Math.abs(handle.bottom - (box.top - 18))).toBeLessThanOrEqual(1);
  const icon = handles(el)[0]!.querySelector("wt-icon")!;
  await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(icon.shadowRoot!.querySelector("path")).not.toBeNull();
});

it.each([0, 30, 90, 180])(
  "draws the handle above the middle of the table's own top side turned %i°",
  async (rotation) => {
    const p = place({ x: 10, y: 10, width: 8, height: 4, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    host.style.setProperty("--wt-tap-min", "50px");
    host.style.setProperty("--wt-space-1", "6px");
    // --wt-space-5 / 2 + --wt-space-1 + --wt-tap-min / 2: 12 + 6 + 25.
    const want = topCentre(el, "t1", p, 43);
    const h = centreOf(handles(el)[0]!);
    expect(Math.abs(h.x - want.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(h.y - want.y)).toBeLessThanOrEqual(1);
    expect(handles(el)[0]!.offsetWidth).toBeGreaterThanOrEqual(50);
    expect(handles(el)[0]!.offsetHeight).toBeGreaterThanOrEqual(50);
  },
);

/** The angle the pointer must be at, clockwise from straight up round `centre`, to turn by `turn`
 *  from a press at `from`, `r` px out. */
function roundFrom(
  centre: { x: number; y: number },
  from: { x: number; y: number },
  turn: number,
  r = 80,
) {
  const a = Math.atan2(from.x - centre.x, centre.y - from.y) + (turn * Math.PI) / 180;
  return { x: centre.x + r * Math.sin(a), y: centre.y - r * Math.cos(a) };
}

it("dragging the handle turns the table in 15° steps", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = rotates(el);
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const turnBy = async (turn: number) => {
    const handle = handles(el)[0]!;
    const h = centreOf(handle);
    const to = roundFrom({ x: cx, y: cy }, h, turn);
    pointer(handle, "pointerdown", 1, h.x, h.y);
    pointer(window, "pointermove", 1, to.x, to.y);
    await release(el, to);
  };
  await turnBy(90);
  await turnBy(180);
  await turnBy(50);
  await turnBy(270);
  await turnBy(0);
  expect(seen).toEqual([
    { key: "t1", rotation: 90, x: 10, y: 10 },
    { key: "t1", rotation: 180, x: 10, y: 10 },
    { key: "t1", rotation: 45, x: 10, y: 10 },
    { key: "t1", rotation: 270, x: 10, y: 10 },
  ]);
});

it("the handle turns from the table's own angle, not from straight up", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, rotation: 90 })], {
    selected: "t1",
  });
  const seen = rotates(el);
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const h = handles(el)[0]!.getBoundingClientRect();
  const hx = h.left + h.width / 2;
  const hy = h.top + h.height / 2;
  pointer(handles(el)[0]!, "pointerdown", 1, hx, hy);
  pointer(window, "pointermove", 1, hx + 2, hy + 2);
  await release(el, { x: hx + 2, y: hy + 2 });
  expect(seen).toEqual([]);
  const to = roundFrom({ x: cx, y: cy }, { x: hx, y: hy }, 90);
  pointer(handles(el)[0]!, "pointerdown", 1, hx, hy);
  pointer(window, "pointermove", 1, to.x, to.y);
  await release(el, to);
  expect(seen).toEqual([{ key: "t1", rotation: 180, x: 10, y: 10 }]);
});

it("the handle turns by how far the pointer goes round, wherever it was pressed", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = rotates(el);
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  pointer(handles(el)[0]!, "pointerdown", 1, cx + 80, cy);
  pointer(window, "pointermove", 1, cx, cy + 80);
  await release(el, { x: cx, y: cy + 80 });
  expect(seen).toEqual([{ key: "t1", rotation: 90, x: 10, y: 10 }]);
});

it("a real drag of the handle turns the table and keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  await settled(el);
  const seen = rotates(el);
  const selections = selects(el);
  const grid = part(el, "grid").getBoundingClientRect();
  const h = centreOf(handles(el)[0]!);
  const to = roundFrom({ x: 240, y: 240 }, { x: h.x - grid.left, y: h.y - grid.top }, 90);
  await userEvent.dragAndDrop(handles(el)[0]!, part(el, "grid"), { targetPosition: to });
  expect(seen).toEqual([{ key: "t1", rotation: 90, x: 10, y: 10 }]);
  expect(selections).toEqual([]);
});

it("a real drag of a table released over empty grid keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })], { selected: "t1" });
  await settled(el);
  const seen = moves(el);
  const selections = selects(el);
  // The pointer moves about 15 px left and the table one square (12 px), so the release lands on
  // the grid just left of the table.
  await userEvent.dragAndDrop(button(el, "t1"), part(el, "grid"), {
    sourcePosition: { x: 1, y: 40 },
    targetPosition: { x: 82, y: 148 },
  });
  expect(seen).toEqual([{ key: "t1", x: 1, y: 3 }]);
  expect(selections).toEqual([]);
});

it("a real drag of the handle that turns nothing keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  await settled(el);
  const seen = rotates(el);
  const selections = selects(el);
  // Further out along the line the handle was pressed on, past the handle itself.
  const grid = part(el, "grid").getBoundingClientRect();
  const h = centreOf(handles(el)[0]!);
  const to = roundFrom({ x: 240, y: 240 }, { x: h.x - grid.left, y: h.y - grid.top }, 0, 150);
  await userEvent.dragAndDrop(handles(el)[0]!, part(el, "grid"), { targetPosition: to });
  expect(seen).toEqual([]);
  expect(selections).toEqual([]);
});

it("a real drag of a table that moves nothing keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3, width: 2, height: 2 })], {
    selected: "t1",
  });
  await settled(el);
  const seen = moves(el);
  const selections = selects(el);
  // About 5 px right, under half a square, ending past the table's right edge (120 px).
  await userEvent.dragAndDrop(button(el, "t1"), part(el, "grid"), {
    sourcePosition: { x: 20, y: 12 },
    targetPosition: { x: 122, y: 120 },
  });
  expect(seen).toEqual([]);
  expect(selections).toEqual([]);
});

it("the handle stays above the middle of the top side while the table is dragged round", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  host.style.setProperty("--wt-tap-min", "50px");
  host.style.setProperty("--wt-space-1", "6px");
  const c = centreOf(button(el, "t1"));
  const h = centreOf(handles(el)[0]!);
  const to = roundFrom(c, h, 90);
  pointer(handles(el)[0]!, "pointerdown", 1, h.x, h.y);
  pointer(window, "pointermove", 1, to.x, to.y);
  await el.updateComplete;
  const want = topCentre(el, "t1", { ...p, rotation: 90 }, 43);
  const now = centreOf(handles(el)[0]!);
  expect(Math.abs(now.x - want.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(now.y - want.y)).toBeLessThanOrEqual(2);
  pointer(window, "pointercancel", 1, to.x, to.y);
});

it("does not read styles again while the handle is dragged", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const read = vi.spyOn(window, "getComputedStyle");
  try {
    const h = handles(el)[0]!.getBoundingClientRect();
    pointer(handles(el)[0]!, "pointerdown", 1, h.left + h.width / 2, h.top);
    for (const dx of [40, 80, 120]) {
      pointer(window, "pointermove", 1, h.left + dx, h.top + dx);
      await el.updateComplete;
    }
    await release(el, { x: h.left + 120, y: h.top + 120 });
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});

it("a click on empty grid after a drag still clears the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })], { selected: "t1" });
  await settled(el);
  const selections = selects(el);
  await release(el, dragBy(el, "t1", 24, 0));
  await userEvent.click(part(el, "grid"), { position: { x: 400, y: 300 } });
  expect(selections.map((e) => e.detail)).toEqual([{ key: null }]);
});

it("a mouse press focuses the table, so the arrow keys move that one", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 }), table("t2", "T2", { x: 20 })]);
  const seen = moves(el);
  button(el, "t1").focus();
  await userEvent.click(button(el, "t2"));
  await userEvent.keyboard("{ArrowRight}");
  expect(seen).toEqual([{ key: "t2", x: 21, y: 0 }]);
});

it("only the primary button drags", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const box = button(el, "t1").getBoundingClientRect();
  button(el, "t1").dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      button: 2,
      clientX: box.left + 5,
      clientY: box.top + 5,
    }),
  );
  pointer(window, "pointermove", 1, box.left + 65, box.top + 5);
  await release(el, { x: box.left + 65, y: box.top + 5 });
  expect(seen).toEqual([]);
});

it("a fixed table moves like any other", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 }, true)]);
  const seen = moves(el);
  await release(el, dragBy(el, "t1", 24, 0));
  button(el, "t1").focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(seen).toEqual([
    { key: "t1", x: 4, y: 3 },
    { key: "t1", x: 2, y: 4 },
  ]);
});

it("a tap on the handle does not turn the table", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, rotation: 90 })], {
    selected: "t1",
  });
  const seen = rotates(el);
  const selections = selects(el);
  await userEvent.click(handles(el)[0]!);
  expect(seen).toEqual([]);
  expect(selections).toEqual([]);
});

it("Enter on the turn arrow neither turns the table nor clears the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = rotates(el);
  const selections = selects(el);
  handles(el)[0]!.focus();
  await userEvent.keyboard("{Enter}");
  expect(seen).toEqual([]);
  expect(selections).toEqual([]);
});

it("the arrow keys on the handle turn by 15° and wrap", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = rotates(el);
  const moved = moves(el);
  let outside = 0;
  host.addEventListener("keydown", () => outside++);
  const prevented: boolean[] = [];
  handles(el)[0]!.addEventListener("keydown", (e) => prevented.push(e.defaultPrevented));
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
  expect(prevented).toEqual([true, true]);
  expect(outside).toBe(0);
  el.tables = [table("t1", "T1", { x: 10, y: 10, rotation: 345 })];
  await el.updateComplete;
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(seen).toEqual([
    { key: "t1", rotation: 15, x: 10, y: 10 },
    { key: "t1", rotation: 345, x: 10, y: 10 },
    { key: "t1", rotation: 0, x: 10, y: 10 },
  ]);
  expect(moved).toEqual([]);
});

it("other keys on the handle do nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = rotates(el);
  const prevented: boolean[] = [];
  host.addEventListener("keydown", (e) => prevented.push(e.defaultPrevented));
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowUp}a");
  expect(seen).toEqual([]);
  expect(prevented).toEqual([false, false]);
});

const dots = (el: WtFloorPlanCanvas) =>
  el.shadowRoot!.querySelectorAll<HTMLElement>('[part~="resize-handle"]');

const dot = (el: WtFloorPlanCanvas, side: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part~="resize-handle"][data-side="${side}"]`)!;

/** The drawn dot; `dot` is its hit area, under the table. */
const drawn = (el: WtFloorPlanCanvas, side: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part~="resize-dot"][data-side="${side}"]`)!;

const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

/** Each corner's direction from the table's centre, along its own right and down. */
const CORNER_SIGNS = {
  "top-left": [-1, -1],
  "top-right": [1, -1],
  "bottom-right": [1, 1],
  "bottom-left": [-1, 1],
} as const;

const cornerAreas = (el: WtFloorPlanCanvas) =>
  el.shadowRoot!.querySelectorAll<HTMLElement>('[part~="resize-corner-handle"]');

const cornerArea = (el: WtFloorPlanCanvas, corner: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(
    `[part~="resize-corner-handle"][data-corner="${corner}"]`,
  )!;

const drawnCorner = (el: WtFloorPlanCanvas, corner: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[part~="resize-corner"][data-corner="${corner}"]`)!;

const sidesWithDots = (el: WtFloorPlanCanvas) => [...dots(el)].map((d) => d.dataset.side);

const drawnSides = (el: WtFloorPlanCanvas) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>('[part~="resize-dot"]')].map(
    (d) => d.dataset.side,
  );

const badgeOf = (el: WtFloorPlanCanvas) =>
  el.shadowRoot!.querySelector<HTMLElement>('[part~="size-badge"]');

function resizes(target: EventTarget): CustomEvent<TableResize>[] {
  const seen: CustomEvent<TableResize>[] = [];
  target.addEventListener("wt-table-resize", (e) => seen.push(e as CustomEvent<TableResize>));
  return seen;
}

/** Presses `corner`'s hit area at its centre and moves the same pointer by (dx, dy) px, without
 *  releasing it. */
function dragCorner(el: WtFloorPlanCanvas, corner: string, dx: number, dy: number, pointerId = 1) {
  const { x, y } = centreOf(cornerArea(el, corner));
  pointer(cornerArea(el, corner), "pointerdown", pointerId, x, y);
  pointer(window, "pointermove", pointerId, x + dx, y + dy);
  return { x: x + dx, y: y + dy };
}

/** Screen px that move each of `corner`'s two sides `squares` squares outwards, turned `rotation`. */
function cornerBy(corner: PlanCorner, rotation: number, squares: number) {
  const { vertical, horizontal } = cornerSides(corner);
  const a = outward(horizontal, rotation);
  const b = outward(vertical, rotation);
  return { x: squares * 12 * (a.x + b.x), y: squares * 12 * (a.y + b.y) };
}

/** Presses `side`'s dot at its centre and moves the same pointer by (dx, dy) px, without releasing it. */
function dragDot(el: WtFloorPlanCanvas, side: string, dx: number, dy: number, pointerId = 1) {
  const { x, y } = centreOf(dot(el, side));
  pointer(dot(el, side), "pointerdown", pointerId, x, y);
  pointer(window, "pointermove", pointerId, x + dx, y + dy);
  return { x: x + dx, y: y + dy };
}

/** `(u, v)` px from `key`'s centre along its own right and down, turned with it. */
function turnedPoint(el: WtFloorPlanCanvas, key: string, rotation: number, u: number, v: number) {
  const c = centreOf(button(el, key));
  const a = (rotation * Math.PI) / 180;
  return { x: c.x + u * Math.cos(a) - v * Math.sin(a), y: c.y + u * Math.sin(a) + v * Math.cos(a) };
}

const resized = (p: PlanPlacement) => ({ x: p.x, y: p.y, width: p.width, height: p.height });

it("draws four side dots in the turn arrow's frame on the selected table only, out of the tab order and hidden from assistive technology", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  const found = [...dots(el)];
  expect(found.map((d) => d.dataset.side)).toEqual(["top", "right", "bottom", "left"]);
  for (const d of found) {
    expect(d.parentElement!.getAttribute("aria-hidden")).toBe("true");
    expect(d.hasAttribute("tabindex")).toBe(false);
    expect(drawn(el, d.dataset.side!).parentElement).toBe(handles(el)[0]!.parentElement);
    expect(getComputedStyle(drawn(el, d.dataset.side!)).pointerEvents).toBe("none");
  }
  el.selected = null;
  await el.updateComplete;
  expect(dots(el)).toHaveLength(0);
  el.selected = "t2";
  await el.updateComplete;
  expect(dots(el)).toHaveLength(4);
  const t2 = button(el, "t2").getBoundingClientRect();
  expect(centreOf(dot(el, "top"))).toEqual({ x: t2.left + t2.width / 2, y: t2.top });
});

it.each([0, 30])("centres each side dot on its side's midpoint turned %i°", async (rotation) => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4, rotation })], {
    selected: "t1",
  });
  const want = {
    top: turnedPoint(el, "t1", rotation, 0, -24),
    right: turnedPoint(el, "t1", rotation, 48, 0),
    bottom: turnedPoint(el, "t1", rotation, 0, 24),
    left: turnedPoint(el, "t1", rotation, -48, 0),
  };
  for (const [side, at] of Object.entries(want)) {
    for (const node of [dot(el, side), drawn(el, side)]) {
      const c = centreOf(node);
      expect(Math.abs(c.x - at.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - at.y)).toBeLessThanOrEqual(1);
    }
  }
});

it("draws each side dot a hit area of --wt-space-5 round a dot --wt-space-3 across", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  host.style.setProperty("--wt-space-5", "30px");
  host.style.setProperty("--wt-space-3", "10px");
  const area = dot(el, "left").getBoundingClientRect();
  expect(area.width).toBe(30);
  expect(area.height).toBe(30);
  const left = drawn(el, "left").getBoundingClientRect();
  expect(left.width).toBe(10);
  expect(left.height).toBe(10);
  const cornerHit = cornerArea(el, "top-left").getBoundingClientRect();
  expect(cornerHit.width).toBe(30);
  expect(cornerHit.height).toBe(30);
  const square = drawnCorner(el, "top-left").getBoundingClientRect();
  expect(square.width).toBe(10);
  expect(square.height).toBe(10);
});

it("draws four corners in the side dots' frames on the selected table only, out of the tab order and hidden from assistive technology", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  const found = [...cornerAreas(el)];
  expect(found.map((c) => c.dataset.corner)).toEqual([...CORNERS]);
  const squares = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[part~="resize-corner"]')];
  expect(squares.map((c) => c.dataset.corner)).toEqual([...CORNERS]);
  for (const c of found) {
    expect(c.parentElement).toBe(dot(el, "top").parentElement);
    expect(c.parentElement!.getAttribute("aria-hidden")).toBe("true");
    expect(c.hasAttribute("tabindex")).toBe(false);
    const square = drawnCorner(el, c.dataset.corner!);
    expect(square.parentElement).toBe(drawn(el, "top").parentElement);
    expect(square.hasAttribute("tabindex")).toBe(false);
    expect(getComputedStyle(square).pointerEvents).toBe("none");
  }
  expect(dots(el)).toHaveLength(4);
  el.selected = null;
  await el.updateComplete;
  expect(cornerAreas(el)).toHaveLength(0);
  expect(el.shadowRoot!.querySelectorAll('[part~="resize-corner"]')).toHaveLength(0);
});

it.each([0, 30])("centres each corner on the table's own corner turned %i°", async (rotation) => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4, rotation })], {
    selected: "t1",
  });
  for (const corner of CORNERS) {
    const [u, v] = CORNER_SIGNS[corner];
    const at = turnedPoint(el, "t1", rotation, u * 48, v * 24);
    for (const node of [cornerArea(el, corner), drawnCorner(el, corner)]) {
      const c = centreOf(node);
      expect(Math.abs(c.x - at.x), corner).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - at.y), corner).toBeLessThanOrEqual(1);
    }
  }
});

it.each([
  [2, 2, []],
  [2, 6, ["right", "left"]],
  [6, 2, ["top", "bottom"]],
  [4, 4, ["top", "right", "bottom", "left"]],
  [3, 8, ["right", "left"]],
] as const)(
  "a selected %i × %i draws four corners and a side dot only on a side at least 4 squares long",
  async (width, height, sides) => {
    const el = await canvas([table("t1", "T1", { x: 10, y: 10, width, height })], {
      selected: "t1",
    });
    expect(cornerAreas(el)).toHaveLength(4);
    expect(sidesWithDots(el)).toEqual(sides);
    expect(drawnSides(el)).toEqual(sides);
  },
);

it("keeps the left and right dots of a side drag that shrinks the height below 4 until the parent applies it", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 6, height: 6 })], {
    selected: "t1",
  });
  const sized = resizes(el);
  const at = dragDot(el, "bottom", 0, -3 * 12);
  await el.updateComplete;
  expect(button(el, "t1").getBoundingClientRect().height).toBe(3 * 12);
  expect(sidesWithDots(el)).toEqual(["top", "right", "bottom", "left"]);
  expect(drawnSides(el)).toEqual(["top", "right", "bottom", "left"]);
  await release(el, at);
  expect(sized.map((e) => e.detail)).toEqual([{ key: "t1", x: 10, y: 10, width: 6, height: 3 }]);
  el.tables = [table("t1", "T1", { x: 10, y: 10, width: 6, height: 3 })];
  await el.updateComplete;
  expect(sidesWithDots(el)).toEqual(["top", "bottom"]);
  expect(drawnSides(el)).toEqual(["top", "bottom"]);
});

it("dragging the right dot sends one resize at release, from resizeFrom", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  const at = dragDot(el, "right", 24, 5);
  await el.updateComplete;
  expect(button(el, "t1").getBoundingClientRect().width).toBe(120);
  expect(seen).toEqual([]);
  await release(el, at);
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", x: 10, y: 10, width: 10, height: 4 }]);
  expect(seen[0]!.detail).toEqual({ key: "t1", ...resized(resizeFrom(p, "right", 2)) });
  expect(seen[0]!.bubbles).toBe(true);
  expect(seen[0]!.composed).toBe(true);
  expect(moved).toEqual([]);
});

it("a turned table's dot resizes along the table's own side, not the screen's", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4, rotation: 90 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const seen = resizes(el);
  await release(el, dragDot(el, "right", 24, 0));
  expect(seen).toEqual([]);
  await release(el, dragDot(el, "right", 0, 24));
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", ...resized(resizeFrom(p, "right", 2)) }]);
  await release(el, dragDot(el, "top", 30, 0));
  expect(seen.at(-1)!.detail).toEqual({ key: "t1", ...resized(resizeFrom(p, "top", 3)) });
});

it("the top dot of a turned table near the plan's edge grows it and steps it in, never poking out", async () => {
  const p = place({ x: 2, y: 2, width: 6, height: 6, rotation: 30 });
  const el = await canvas(
    [
      { key: "t1", label: "T1", fixed: false, placement: p },
      table("left", "Left", { y: 12 }),
      table("top", "Top", { x: 12 }),
    ],
    { selected: "t1" },
  );
  await settled(el);
  const edge = {
    left: button(el, "left").getBoundingClientRect().left,
    top: button(el, "top").getBoundingClientRect().top,
  };
  const grid = part(el, "grid").getBoundingClientRect();
  const seen = resizes(el);
  const out = outward("top", 30);
  const at = dragDot(el, "top", 12 * out.x, 12 * out.y);
  await el.updateComplete;
  const during = button(el, "t1").getBoundingClientRect();
  expect(during.left).toBeGreaterThanOrEqual(edge.left);
  expect(during.top).toBeGreaterThanOrEqual(edge.top);
  const now = part(el, "grid").getBoundingClientRect();
  expect({ width: now.width, height: now.height }).toEqual({
    width: grid.width,
    height: grid.height,
  });
  expect([viewportOf(el).scrollLeft, viewportOf(el).scrollTop]).toEqual([0, 0]);
  await release(el, at);
  expect(resizeFrom(p, "top", 1)).toMatchObject({ x: 2, y: 2, width: 6, height: 7 });
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", ...resized(resizeFrom(p, "top", 1)) }]);
});

it("dragging the bottom-right corner sends one resize at release, from resizeFromCorner", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  const at = dragCorner(el, "bottom-right", 24, 12);
  await el.updateComplete;
  const box = button(el, "t1").getBoundingClientRect();
  expect([box.width, box.height]).toEqual([120, 60]);
  expect(seen).toEqual([]);
  await release(el, at);
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", x: 10, y: 10, width: 10, height: 5 }]);
  expect(seen[0]!.detail).toEqual({
    key: "t1",
    ...resized(resizeFromCorner(p, "bottom-right", 2, 1)),
  });
  expect(moved).toEqual([]);
});

it("a turned table's corner resizes along the table's own sides, not the screen's", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4, rotation: 90 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const seen = resizes(el);
  await release(el, dragCorner(el, "bottom-right", -12, 24));
  await release(el, dragCorner(el, "bottom-right", 24, 0));
  expect(seen.map((e) => e.detail)).toEqual([
    { key: "t1", ...resized(resizeFromCorner(p, "bottom-right", 2, 1)) },
    { key: "t1", ...resized(resizeFromCorner(p, "bottom-right", 0, -2)) },
  ]);
});

it("a click on a corner sends no selection change", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const selections = selects(el);
  for (const corner of CORNERS) {
    const { x, y } = centreOf(cornerArea(el, corner));
    cornerArea(el, corner).dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }),
    );
  }
  expect(selections).toEqual([]);
});

it("shows the size badge under the table while a corner is dragged, and marks no side dot", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
  });
  const at = dragCorner(el, "bottom-right", 24, 12);
  await el.updateComplete;
  const badge = badgeOf(el)!;
  expect(badge.textContent!.trim()).toBe("10 × 5");
  const box = button(el, "t1").getBoundingClientRect();
  expect(Math.abs(centreOf(badge).x - (box.left + box.width / 2))).toBeLessThanOrEqual(1);
  expect(badge.getBoundingClientRect().top).toBeGreaterThan(box.bottom);
  expect([...el.shadowRoot!.querySelectorAll("[part~=resize-dot][data-dragging]")]).toHaveLength(0);
  await release(el, at);
  expect(badgeOf(el)).toBeNull();
});

it.each(["pointerup", "pointercancel"])(
  "shows the dragged corner's arrow over the canvas and on the page until the %s",
  async (end) => {
    setPageCursor("help");
    const el = await canvas([turnedTable()], { selected: "t1" });
    const want = resizeCursor("top-left", 90);
    expect(want).toBe("nesw-resize");
    const at = dragCorner(el, "top-left", -24, 0);
    await el.updateComplete;
    expect(cursorOf(part(el, "viewport"))).toBe(want);
    expect(cursorOf(button(el, "t1"))).toBe(want);
    expect(document.body.style.cursor).toBe(want);
    pointer(window, end, 1, at.x, at.y);
    await el.updateComplete;
    expect(part(el, "viewport").style.cursor).toBe("");
    expect(cursorOf(button(el, "t1"))).toBe("pointer");
    expect(document.body.style.cursor).toBe("help");
  },
);

it("puts the page's cursor back when the canvas is removed mid corner drag", async () => {
  setPageCursor("help");
  const el = await canvas([turnedTable()], { selected: "t1" });
  dragCorner(el, "top-left", -24, 0);
  expect(document.body.style.cursor).toBe("nesw-resize");
  el.remove();
  expect(document.body.style.cursor).toBe("help");
});

it("a corner drag that ends where it began sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = resizes(el);
  const at = dragCorner(el, "bottom-right", 5, 5);
  await el.updateComplete;
  expect(badgeOf(el)!.textContent!.trim()).toBe("8 × 8");
  await release(el, at);
  expect(seen).toEqual([]);
  expect(badgeOf(el)).toBeNull();
});

it("a pointer cancel puts a corner drag's size back and sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  const at = dragCorner(el, "top-left", -24, -12);
  await el.updateComplete;
  const during = button(el, "t1").getBoundingClientRect();
  expect([during.width, during.height]).toEqual([120, 60]);
  pointer(window, "pointercancel", 1, at.x, at.y);
  await el.updateComplete;
  const after = button(el, "t1").getBoundingClientRect();
  expect([after.width, after.height]).toEqual([96, 48]);
  expect(offset(el, "t1")).toEqual({ left: 192, top: 192 });
  expect(badgeOf(el)).toBeNull();
  pointer(window, "pointerup", 1, at.x, at.y);
  expect(seen).toEqual([]);
});

it("a second pointer cannot take over a corner drag, nor a corner a table drag", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  const first = dragCorner(el, "bottom-right", 24, 24, 1);
  const second = dragBy(el, "t2", 60, 60, 2);
  await release(el, second, 2);
  expect(moved).toEqual([]);
  await release(el, first, 1);
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", x: 10, y: 10, width: 10, height: 10 }]);
  const table1 = dragBy(el, "t2", 24, 0, 1);
  const cornerDrag = dragCorner(el, "bottom-right", 24, 24, 2);
  await release(el, cornerDrag, 2);
  expect(seen).toHaveLength(1);
  await release(el, table1, 1);
  expect(moved).toEqual([{ key: "t2", x: 32, y: 0 }]);
});

it("the top-left corner of a turned table near the plan's edge sends only what resizeFromCorner answers, never poking out", async () => {
  const p = place({ x: 2, y: 2, width: 6, height: 6, rotation: 30 });
  const el = await canvas(
    [
      { key: "t1", label: "T1", fixed: false, placement: p },
      table("left", "Left", { y: 12 }),
      table("top", "Top", { x: 12 }),
    ],
    { selected: "t1" },
  );
  await settled(el);
  const edge = {
    left: button(el, "left").getBoundingClientRect().left,
    top: button(el, "top").getBoundingClientRect().top,
  };
  const seen = resizes(el);
  const want = resizeFromCorner(p, "top-left", 2, 2);
  expect(resized(want)).not.toEqual(resized(p));
  const by = cornerBy("top-left", 30, 2);
  const { x, y } = centreOf(cornerArea(el, "top-left"));
  pointer(cornerArea(el, "top-left"), "pointerdown", 1, x, y);
  for (let step = 1; step <= 4; step++) {
    pointer(window, "pointermove", 1, x + (by.x * step) / 4, y + (by.y * step) / 4);
    await el.updateComplete;
    const during = button(el, "t1").getBoundingClientRect();
    expect(during.left, `step ${step}`).toBeGreaterThanOrEqual(edge.left - 1e-6);
    expect(during.top, `step ${step}`).toBeGreaterThanOrEqual(edge.top - 1e-6);
  }
  await release(el, { x: x + by.x, y: y + by.y });
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", ...resized(want) }]);
});

it("keeps the side dots of a 2 × 6's corner drag that shrinks its height below 4 until the parent applies it", async () => {
  const p = place({ x: 10, y: 10, width: 2, height: 6 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const sized = resizes(el);
  expect(sidesWithDots(el)).toEqual(["right", "left"]);
  const at = dragCorner(el, "top-left", 0, 3 * 12);
  await el.updateComplete;
  expect(button(el, "t1").getBoundingClientRect().height).toBe(3 * 12);
  expect(sidesWithDots(el)).toEqual(["right", "left"]);
  expect(drawnSides(el)).toEqual(["right", "left"]);
  await release(el, at);
  expect(sized.map((e) => e.detail)).toEqual([
    { key: "t1", ...resized(resizeFromCorner(p, "top-left", 0, -3)) },
  ]);
  el.tables = [{ key: "t1", label: "T1", fixed: false, placement: { ...p, y: 13, height: 3 } }];
  await el.updateComplete;
  expect(sidesWithDots(el)).toEqual([]);
  expect(drawnSides(el)).toEqual([]);
});

it("shows the size badge under the table, past its bottom dot, while a dot is dragged", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
  });
  expect(badgeOf(el)).toBeNull();
  const at = dragDot(el, "right", 24, 0);
  await el.updateComplete;
  const badge = badgeOf(el)!;
  expect(badge.textContent!.trim()).toBe("10 × 4");
  expect(badge.getAttribute("aria-hidden")).toBe("true");
  const box = button(el, "t1").getBoundingClientRect();
  expect(Math.abs(centreOf(badge).x - (box.left + box.width / 2))).toBeLessThanOrEqual(1);
  expect(badge.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    dot(el, "bottom").getBoundingClientRect().bottom,
  );
  expect(drawn(el, "right").hasAttribute("data-dragging")).toBe(true);
  expect([...el.shadowRoot!.querySelectorAll("[part~=resize-dot][data-dragging]")]).toHaveLength(1);
  await release(el, at);
  expect(badgeOf(el)).toBeNull();
  expect([...el.shadowRoot!.querySelectorAll("[part~=resize-dot][data-dragging]")]).toHaveLength(0);
});

const cursorOf = (node: Element) => getComputedStyle(node).cursor;

const SIDES = ["top", "right", "bottom", "left"] as const;

it.each([
  [0, ["ns-resize", "ew-resize", "ns-resize", "ew-resize"]],
  [90, ["ew-resize", "ns-resize", "ew-resize", "ns-resize"]],
  [45, ["nesw-resize", "nwse-resize", "nesw-resize", "nwse-resize"]],
])(
  "shows each dot of a table turned %i° the arrow of the way it drags on screen",
  async (rotation, want) => {
    const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4, rotation })], {
      selected: "t1",
    });
    expect(SIDES.map((side) => cursorOf(drawn(el, side)))).toEqual(want);
    expect(SIDES.map((side) => cursorOf(dot(el, side)))).toEqual(want);
  },
);

it.each([0, 30, 90])(
  "shows each corner of a table turned %i° the arrow resizeCursor gives it",
  async (rotation) => {
    const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4, rotation })], {
      selected: "t1",
    });
    const want = CORNERS.map((corner) => resizeCursor(corner, rotation));
    expect(new Set(want).size).toBe(2);
    expect(CORNERS.map((corner) => cursorOf(drawnCorner(el, corner)))).toEqual(want);
    expect(CORNERS.map((corner) => cursorOf(cornerArea(el, corner)))).toEqual(want);
  },
);

it("turns the dots' arrows with the table while its turn arrow is dragged", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const handle = handles(el)[0]!;
  const h = centreOf(handle);
  const to = roundFrom(centreOf(button(el, "t1")), h, 90);
  pointer(handle, "pointerdown", 1, h.x, h.y);
  pointer(window, "pointermove", 1, to.x, to.y);
  await el.updateComplete;
  expect(cursorOf(drawn(el, "top"))).toBe("ew-resize");
  expect(cursorOf(dot(el, "top"))).toBe("ew-resize");
  pointer(window, "pointercancel", 1, to.x, to.y);
  await el.updateComplete;
  expect(cursorOf(drawn(el, "top"))).toBe("ns-resize");
});

it.each(["pointerup", "pointercancel"])(
  "shows the dragged dot's arrow over the whole canvas until the %s",
  async (end) => {
    const el = await canvas(
      [table("t1", "T1", { x: 10, y: 10, width: 8, height: 4, rotation: 90 }), table("t2", "T2")],
      { selected: "t1" },
    );
    expect(cursorOf(button(el, "t1"))).toBe("pointer");
    const at = dragDot(el, "top", 24, 0);
    await el.updateComplete;
    expect(cursorOf(button(el, "t1"))).toBe("ew-resize");
    expect(cursorOf(button(el, "t2"))).toBe("ew-resize");
    expect(cursorOf(dot(el, "left"))).toBe("ew-resize");
    expect(cursorOf(drawn(el, "left"))).toBe("ew-resize");
    expect(cursorOf(cornerArea(el, "top-left"))).toBe("ew-resize");
    expect(cursorOf(drawnCorner(el, "top-left"))).toBe("ew-resize");
    expect(cursorOf(handles(el)[0]!)).toBe("ew-resize");
    expect(cursorOf(part(el, "grid"))).toBe("ew-resize");
    pointer(window, end, 1, at.x, at.y);
    await el.updateComplete;
    expect(cursorOf(button(el, "t1"))).toBe("pointer");
    expect(cursorOf(button(el, "t2"))).toBe("pointer");
    expect(cursorOf(dot(el, "left"))).toBe("ns-resize");
    expect(cursorOf(cornerArea(el, "top-left"))).toBe(resizeCursor("top-left", 90));
    expect(cursorOf(drawnCorner(el, "top-left"))).toBe(resizeCursor("top-left", 90));
    expect(cursorOf(handles(el)[0]!)).toBe("grab");
    expect(cursorOf(part(el, "grid"))).toBe("auto");
  },
);

function setPageCursor(cursor: string): void {
  document.body.style.cursor = cursor;
  onTestFinished(() => {
    document.body.style.cursor = "";
  });
}

const turnedTable = () => table("t1", "T1", { x: 10, y: 10, width: 8, height: 4, rotation: 90 });

it.each(["pointerup", "pointercancel"])(
  "holds the dragged dot's arrow on the page body, off the plan too, until the %s",
  async (end) => {
    setPageCursor("help");
    const el = await canvas([turnedTable()], { selected: "t1" });
    const elsewhere = document.createElement("div");
    elsewhere.style.height = "20px";
    document.body.appendChild(elsewhere);
    onTestFinished(() => elsewhere.remove());
    dragDot(el, "top", 24, 0);
    const box = el.getBoundingClientRect();
    const off = { x: box.right + 40, y: box.bottom + 40 };
    pointer(window, "pointermove", 1, off.x, off.y);
    await el.updateComplete;
    expect(document.body.style.cursor).toBe("ew-resize");
    expect(cursorOf(elsewhere)).toBe("ew-resize");
    pointer(window, end, 1, off.x, off.y);
    await el.updateComplete;
    expect(document.body.style.cursor).toBe("help");
    expect(cursorOf(elsewhere)).toBe("help");
  },
);

it("puts the page's cursor back when the canvas is removed mid size-dot drag", async () => {
  setPageCursor("help");
  const el = await canvas([turnedTable()], { selected: "t1" });
  dragDot(el, "top", 24, 0);
  expect(document.body.style.cursor).toBe("ew-resize");
  el.remove();
  expect(document.body.style.cursor).toBe("help");
});

it("leaves the page's cursor alone for a move drag, a turn drag, and a removal with no drag", async () => {
  setPageCursor("crosshair");
  const el = await canvas([turnedTable()], { selected: "t1" });
  const at = dragBy(el, "t1", 24, 0);
  expect(document.body.style.cursor).toBe("crosshair");
  pointer(window, "pointerup", 1, at.x, at.y);
  expect(document.body.style.cursor).toBe("crosshair");
  const handle = handles(el)[0]!;
  const h = centreOf(handle);
  pointer(handle, "pointerdown", 1, h.x, h.y);
  pointer(window, "pointermove", 1, h.x + 30, h.y + 30);
  expect(document.body.style.cursor).toBe("crosshair");
  pointer(window, "pointercancel", 1, h.x + 30, h.y + 30);
  expect(document.body.style.cursor).toBe("crosshair");
  el.remove();
  expect(document.body.style.cursor).toBe("crosshair");
});

it("draws a refused table's reason below the size badge while a dot is dragged", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { x: 10, y: 10 })], {
    selected: "t1",
  });
  await settled(el);
  const before = reasonOf(el, "t1")!.getBoundingClientRect().top;
  const at = dragDot(el, "bottom", 0, 24);
  await el.updateComplete;
  const badge = badgeOf(el)!.getBoundingClientRect();
  expect(badge.top).toBeGreaterThanOrEqual(dot(el, "bottom").getBoundingClientRect().bottom);
  expect(reasonOf(el, "t1")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(badge.bottom);
  pointer(window, "pointercancel", 1, at.x, at.y);
  await el.updateComplete;
  expect(reasonOf(el, "t1")!.getBoundingClientRect().top).toBe(before);
});

/** Keydowns of the arrow keys alone, so a held Shift's own keydown is not counted. */
function arrowKeydowns(target: EventTarget): boolean[] {
  const prevented: boolean[] = [];
  target.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key.startsWith("Arrow")) prevented.push(e.defaultPrevented);
  });
  return prevented;
}

const statusOf = (el: WtFloorPlanCanvas) =>
  el.shadowRoot!.querySelector<HTMLElement>('[role="status"]')!;

const KEYS_EN = "Arrow keys move it. Shift and arrow keys resize it.";

it("Shift and the arrow keys move the focused selected table's right and bottom sides one square", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  const outside = arrowKeydowns(host);
  const prevented = arrowKeydowns(button(el, "t1"));
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}{/Shift}");
  expect(seen.map((e) => e.detail)).toEqual([
    { key: "t1", x: 10, y: 10, width: 9, height: 4 },
    { key: "t1", x: 10, y: 10, width: 7, height: 4 },
    { key: "t1", x: 10, y: 10, width: 8, height: 5 },
    { key: "t1", x: 10, y: 10, width: 8, height: 3 },
  ]);
  expect(seen.every((e) => e.bubbles && e.composed)).toBe(true);
  expect(prevented).toEqual([true, true, true, true]);
  expect(outside).toEqual([]);
  expect(moved).toEqual([]);
});

it("Shift and an arrow key send nothing at a size of 1 or 99", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 1, height: 1 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowUp}{/Shift}");
  el.tables = [table("t1", "T1", { x: 10, y: 10, width: 99, height: 99 })];
  await el.updateComplete;
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");
  expect(seen).toEqual([]);
  expect(moved).toEqual([]);
});

it("Shift+ArrowRight sends, announces and badges nothing when its side cannot grow on the grid", async () => {
  // Turned 180°, the right side faces left, and the table already touches the grid's left edge.
  const el = await canvas(
    [table("t1", "T1", { x: 0, y: 10, width: 8, height: 4, rotation: 180 })],
    {
      selected: "t1",
    },
  );
  const seen = resizes(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(statusOf(el).textContent!.trim()).toBe("");
  expect(badgeOf(el)).toBeNull();
});

it("Shift+ArrowLeft shrinks a table turned 90° at the grid's top edge", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 0, width: 8, height: 4, rotation: 90 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", x: 11, y: 0, width: 7, height: 4 }]);
});

/** The midpoint of `p`'s own left side, in squares. */
function leftMidpoint(p: PlanPlacement): { x: number; y: number } {
  const radians = (p.rotation * Math.PI) / 180;
  return {
    x: p.x + p.width / 2 - (p.width / 2) * Math.cos(radians),
    y: p.y + p.height / 2 - (p.width / 2) * Math.sin(radians),
  };
}

it.each([30, 90])(
  "Shift+ArrowRight on a table turned %i° keeps its left side where it is on screen",
  async (rotation) => {
    const p = place({ x: 10, y: 10, width: 8, height: 4, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    const seen = resizes(el);
    button(el, "t1").focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(seen.map((e) => e.detail)).toEqual([
      { key: "t1", ...resized(resizeFrom(p, "right", 1)) },
    ]);
    const sent = { ...p, ...seen[0]!.detail };
    expect(sent.width).toBe(9);
    const [before, after] = [leftMidpoint(p), leftMidpoint(sent)];
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
  },
);

it("Shift+ArrowRight then Shift+ArrowLeft on a table turned 90° puts it back where it was", async () => {
  const p = place({ x: 10, y: 10, width: 8, height: 4, rotation: 90 });
  const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
    selected: "t1",
  });
  const seen = resizes(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  el.tables = [{ key: "t1", label: "T1", fixed: false, placement: { ...p, ...seen[0]!.detail } }];
  await el.updateComplete;
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  expect(seen.map((e) => e.detail)).toEqual([
    { key: "t1", x: 9, y: 11, width: 9, height: 4 },
    { key: "t1", x: 10, y: 10, width: 8, height: 4 },
  ]);
});

it("Shift and the arrow keys on an unselected table neither resize nor move it", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  button(el, "t2").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}{/Shift}");
  expect(seen).toEqual([]);
  expect(moved).toEqual([]);
});

it("the plain arrow keys on the selected table only move it", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = resizes(el);
  const moved = moves(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{ArrowRight}{ArrowDown}");
  expect(moved).toEqual([
    { key: "t1", x: 11, y: 10 },
    { key: "t1", x: 10, y: 11 },
  ]);
  expect(seen).toEqual([]);
});

it("Shift and the arrow keys on the turn arrow resize nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = resizes(el);
  const moved = moves(el);
  handles(el)[0]!.focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}{/Shift}");
  expect(seen).toEqual([]);
  expect(moved).toEqual([]);
});

it("describes only the selected table by its keys, in English unless the copy says otherwise", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  await expect.element(button(el, "t1")).toHaveAccessibleDescription(KEYS_EN);
  expect(button(el, "t2").hasAttribute("aria-describedby")).toBe(false);
  el.copy = { keys: "Las flechas la mueven. Mayús y las flechas cambian su tamaño." };
  await el.updateComplete;
  await expect
    .element(button(el, "t1"))
    .toHaveAccessibleDescription("Las flechas la mueven. Mayús y las flechas cambian su tamaño.");
});

it("describes a selected refused table by its reason and its keys", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { x: 10, y: 10 })], {
    selected: "t1",
  });
  const ids = button(el, "t1").getAttribute("aria-describedby")!.split(" ");
  expect(ids).toHaveLength(2);
  expect(ids.map((id) => el.shadowRoot!.getElementById(id)!.textContent!.trim())).toEqual([
    "Booked at 21:00",
    KEYS_EN,
  ]);
  await expect.element(button(el, "t1")).toHaveAccessibleDescription(`Booked at 21:00 ${KEYS_EN}`);
});

it("announces the new size after a keyboard resize, and shows the badge until the table loses focus", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
  });
  // A controlled parent's answer to each resize.
  el.addEventListener("wt-table-resize", (e) => {
    const { key, ...box } = (e as CustomEvent<TableResize>).detail;
    el.tables = [table(key, "T1", box)];
  });
  expect(statusOf(el).textContent!.trim()).toBe("");
  expect(badgeOf(el)).toBeNull();
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await el.updateComplete;
  expect(statusOf(el).textContent!.trim()).toBe("9 by 4");
  expect(badgeOf(el)!.textContent!.trim()).toBe("9 × 4");
  await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
  await el.updateComplete;
  expect(statusOf(el).textContent!.trim()).toBe("9 by 5");
  expect(badgeOf(el)!.textContent!.trim()).toBe("9 × 5");
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;
  expect(badgeOf(el)!.textContent!.trim()).toBe("9 × 5");
  button(el, "t1").blur();
  await el.updateComplete;
  expect(badgeOf(el)).toBeNull();
});

it("hides a keyboard resize's badge once its table is no longer selected", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await el.updateComplete;
  expect(badgeOf(el)).not.toBeNull();
  el.selected = null;
  await el.updateComplete;
  expect(badgeOf(el)).toBeNull();
});

it("announces a keyboard resize in the copy's words", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
    copy: { size: "{width} por {height}" },
  });
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  await el.updateComplete;
  expect(statusOf(el).textContent!.trim()).toBe("7 por 4");
});

it("draws a refused table's reason below the badge a keyboard resize shows", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { x: 10, y: 10 })], {
    selected: "t1",
  });
  await settled(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await el.updateComplete;
  const badge = badgeOf(el)!.getBoundingClientRect();
  expect(reasonOf(el, "t1")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(badge.bottom);
});

it("moves only the badged table's reason below the badge, not another refused table's", async () => {
  const el = await canvas(
    [
      refusedTable("t1", "T1", "Booked at 21:00", { x: 10, y: 10 }),
      refusedTable("t2", "T2", "Booked at 22:00", { x: 30, y: 10 }),
    ],
    { selected: "t1" },
  );
  host.style.setProperty("--wt-space-1", "4px");
  await settled(el);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await el.updateComplete;
  expect(badgeOf(el)).not.toBeNull();
  const bottom = button(el, "t2").getBoundingClientRect().bottom;
  expect(reasonOf(el, "t2")!.getBoundingClientRect().top).toBeCloseTo(bottom + 4, 0);
});

it("writes a selected refused table's reason below every side dot at every turn", async () => {
  const el = await canvas([], { selected: "t1" });
  for (const [width, height] of [
    [8, 4],
    [8, 1],
    [1, 8],
  ] as const) {
    for (let rotation = 0; rotation < 360; rotation += 15) {
      el.tables = [refusedTable("t1", "T1", "Booked", { x: 10, y: 10, width, height, rotation })];
      await el.updateComplete;
      const top = reasonOf(el, "t1")!.getBoundingClientRect().top;
      for (const d of dots(el)) {
        expect(top, `${width}×${height} at ${rotation}°, ${d.dataset.side}`).toBeGreaterThanOrEqual(
          d.getBoundingClientRect().bottom,
        );
      }
      // The circle, not the box: a turned square's upright box reaches past the circle.
      for (const c of cornerAreas(el)) {
        expect(
          top,
          `${width}×${height} at ${rotation}°, ${c.dataset.corner}`,
        ).toBeGreaterThanOrEqual(centreOf(c).y + c.offsetWidth / 2);
      }
    }
  }
});

/** Presses whatever is drawn topmost at (x, y), as a real pointer would, and drags it `by` px. */
async function pressAndDrag(
  el: WtFloorPlanCanvas,
  at: { x: number; y: number },
  by: { x: number; y: number },
) {
  const target = el.shadowRoot!.elementFromPoint(at.x, at.y)!;
  pointer(target, "pointerdown", 1, at.x, at.y);
  pointer(window, "pointermove", 1, at.x + by.x, at.y + by.y);
  await release(el, { x: at.x + by.x, y: at.y + by.y });
}

/** For a selected 2 × 2 table turned `rotation`: each side's midpoint, `out` px outwards, and
 *  24 px further outwards on screen. */
function sidePresses(el: WtFloorPlanCanvas, rotation: number, out: number) {
  const a = (rotation * Math.PI) / 180;
  return (
    [
      ["top", 0, -1],
      ["right", 1, 0],
      ["bottom", 0, 1],
      ["left", -1, 0],
    ] as const
  ).map(([side, u, v]) => ({
    side,
    at: turnedPoint(el, "t1", rotation, u * (12 + out), v * (12 + out)),
    by: {
      x: 24 * (u * Math.cos(a) - v * Math.sin(a)),
      y: 24 * (u * Math.sin(a) + v * Math.cos(a)),
    },
  }));
}

it.each([0, 30])(
  "a selected 2 × 2 table turned %i° is dragged by a press at its centre or just inside a side's midpoint",
  async (rotation) => {
    const p = place({ x: 10, y: 10, width: 2, height: 2, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    await settled(el);
    const sized = resizes(el);
    const moved = moves(el);
    await pressAndDrag(el, centreOf(button(el, "t1")), { x: 24, y: 24 });
    expect(moved).toHaveLength(1);
    for (const [i, { side, at, by }] of sidePresses(el, rotation, -3).entries()) {
      await pressAndDrag(el, at, by);
      expect(moved, side).toHaveLength(i + 2);
    }
    expect(sized).toEqual([]);
  },
);

it.each([0, 30])(
  "a press just outside a corner of a selected 2 × 2 table turned %i° resizes from that corner",
  async (rotation) => {
    const p = place({ x: 10, y: 10, width: 2, height: 2, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    await settled(el);
    const sized = resizes(el);
    const moved = moves(el);
    for (const corner of CORNERS) {
      await pressAndDrag(el, cornerPoint(el, p, corner, 3), cornerBy(corner, rotation, 2));
    }
    expect(sized.map((e) => e.detail)).toEqual(
      CORNERS.map((corner) => ({ key: "t1", ...resized(resizeFromCorner(p, corner, 2, 2)) })),
    );
    expect(moved).toEqual([]);
  },
);

/** `out` px from the table's `corner` along the corner's own diagonal, outwards, turned with it. */
function cornerPoint(el: WtFloorPlanCanvas, p: PlanPlacement, corner: string, out: number) {
  const [u, v] = CORNER_SIGNS[corner as (typeof CORNERS)[number]];
  const d = out / Math.SQRT2;
  return turnedPoint(el, "t1", p.rotation, u * (p.width * 6 + d), v * (p.height * 6 + d));
}

/** `out` px from the middle of the table's `side`, outwards, turned with it. */
function sidePoint(el: WtFloorPlanCanvas, p: PlanPlacement, side: string, out: number) {
  const [u, v] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side]!;
  return turnedPoint(el, "t1", p.rotation, u * (p.width * 6 + out), v * (p.height * 6 + out));
}

const topmost = (el: WtFloorPlanCanvas, at: { x: number; y: number }) =>
  el.shadowRoot!.elementFromPoint(at.x, at.y);

it.each([0, 30])(
  "a press just outside a corner of a selected table turned %i° lands on that corner, and just inside on the table",
  async (rotation) => {
    const p = place({ x: 10, y: 10, width: 8, height: 4, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    await settled(el);
    for (const corner of CORNERS) {
      expect(topmost(el, cornerPoint(el, p, corner, 3)), corner).toBe(cornerArea(el, corner));
      expect(topmost(el, cornerPoint(el, p, corner, -3))?.closest("button"), corner).toBe(
        button(el, "t1"),
      );
    }
  },
);

it.each([
  [1, 1, 0],
  [1, 1, 30],
  [2, 2, 0],
  [2, 2, 30],
  [2, 6, 0],
  [2, 6, 30],
] as const)(
  "every handle of a selected %i × %i table turned %i° can be pressed 10 px out from it",
  async (width, height, rotation) => {
    const p = place({ x: 10, y: 10, width, height, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    await settled(el);
    for (const corner of CORNERS) {
      expect(topmost(el, cornerPoint(el, p, corner, 10)), corner).toBe(cornerArea(el, corner));
    }
    for (const side of sidesWithDots(el)) {
      expect(topmost(el, sidePoint(el, p, side!, 10)), side).toBe(dot(el, side!));
    }
  },
);

it.each([
  [8, 8, 0],
  [8, 8, 30],
  [2, 2, 0],
  [2, 2, 30],
  [1, 1, 0],
  [1, 1, 30],
] as const)(
  "the turn arrow of a selected %i × %i table turned %i° covers no hit area",
  async (width, height, rotation) => {
    const p = place({ x: 10, y: 10, width, height, rotation });
    const el = await canvas([{ key: "t1", label: "T1", fixed: false, placement: p }], {
      selected: "t1",
    });
    await settled(el);
    const arrow = handles(el)[0]!;
    const half = arrow.offsetWidth / 2 - 1;
    const c = centreOf(arrow);
    const a = (rotation * Math.PI) / 180;
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const u = -half + (i * 2 * half) / 8;
        const v = -half + (j * 2 * half) / 8;
        samples.push({
          x: c.x + u * Math.cos(a) - v * Math.sin(a),
          y: c.y + u * Math.sin(a) + v * Math.cos(a),
        });
      }
    }
    for (const at of samples) {
      expect(topmost(el, at)?.closest('[part~="rotate-handle"]')).toBe(arrow);
    }
    // The arrow is drawn on top of its own table's hit areas, so only with it out of the way does
    // a sample show what it would otherwise cover.
    arrow.style.pointerEvents = "none";
    for (const at of samples) {
      expect(
        topmost(el, at)?.closest('[part~="resize-handle"], [part~="resize-corner-handle"]'),
      ).toBeNull();
    }
  },
);

it("a dot drag that ends where it began sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = resizes(el);
  const at = dragDot(el, "right", 5, 5);
  await el.updateComplete;
  expect(badgeOf(el)!.textContent!.trim()).toBe("8 × 8");
  expect(drawn(el, "right").hasAttribute("data-dragging")).toBe(true);
  await release(el, at);
  expect(seen).toEqual([]);
  expect(badgeOf(el)).toBeNull();
  expect(drawn(el, "right").hasAttribute("data-dragging")).toBe(false);
});

it("a pointer cancel puts the size back and sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10, width: 8, height: 4 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  const at = dragDot(el, "left", -24, 0);
  await el.updateComplete;
  expect(button(el, "t1").getBoundingClientRect().width).toBe(120);
  pointer(window, "pointercancel", 1, at.x, at.y);
  await el.updateComplete;
  expect(button(el, "t1").getBoundingClientRect().width).toBe(96);
  expect(offset(el, "t1")).toEqual({ left: 192, top: 192 });
  expect(badgeOf(el)).toBeNull();
  pointer(window, "pointerup", 1, at.x, at.y);
  expect(seen).toEqual([]);
});

it("a second pointer cannot take over a dot drag, nor a dot a table drag", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  const seen = resizes(el);
  const moved = moves(el);
  const first = dragDot(el, "right", 24, 0, 1);
  const second = dragBy(el, "t2", 60, 60, 2);
  await release(el, second, 2);
  expect(moved).toEqual([]);
  await release(el, first, 1);
  expect(seen.map((e) => e.detail)).toEqual([{ key: "t1", x: 10, y: 10, width: 10, height: 8 }]);
  const table1 = dragBy(el, "t2", 24, 0, 1);
  const dotDrag = dragDot(el, "bottom", 0, 24, 2);
  await release(el, dotDrag, 2);
  expect(seen).toHaveLength(1);
  await release(el, table1, 1);
  expect(moved).toEqual([{ key: "t2", x: 32, y: 0 }]);
});

it("a second finger's tap on a side dot during a table drag keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 }), table("t2", "T2", { x: 30 })], {
    selected: "t1",
  });
  const selections = selects(el);
  const table1 = dragBy(el, "t2", 24, 0, 1);
  const { x, y } = centreOf(dot(el, "bottom"));
  pointer(dot(el, "bottom"), "pointerdown", 2, x, y);
  pointer(window, "pointerup", 2, x, y);
  dot(el, "bottom").dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }),
  );
  await release(el, table1, 1);
  expect(selections).toEqual([]);
});

it("each event bubbles out of a shadow root", async () => {
  const el = await canvas(
    [table("t1", "T1", { x: 10, y: 10 })],
    { selected: "t1" },
    mountInShadowRoot,
  );
  const moved: CustomEvent[] = [];
  const turned: CustomEvent[] = [];
  document.addEventListener("wt-table-move", (e) => moved.push(e as CustomEvent), { once: true });
  document.addEventListener("wt-table-rotate", (e) => turned.push(e as CustomEvent), {
    once: true,
  });
  const sized: CustomEvent[] = [];
  document.addEventListener("wt-table-resize", (e) => sized.push(e as CustomEvent), {
    once: true,
  });
  button(el, "t1").focus();
  await userEvent.keyboard("{ArrowRight}");
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  await release(el, dragDot(el, "bottom", 0, 12));
  expect(moved.map((e) => e.detail)).toEqual([{ key: "t1", x: 11, y: 10 }]);
  expect(turned.map((e) => e.detail)).toEqual([{ key: "t1", rotation: 15, x: 10, y: 10 }]);
  expect(sized.map((e) => e.detail)).toEqual([{ key: "t1", x: 10, y: 10, width: 8, height: 9 }]);
  for (const e of [...moved, ...turned, ...sized]) {
    expect(e.bubbles).toBe(true);
    expect(e.composed).toBe(true);
  }
});

const viewportOf = (el: WtFloorPlanCanvas) => part(el, "viewport");

it("reveal scrolls a table into view with the inset free below it", async () => {
  const el = await canvas([table("t1", "T1", { x: 70, y: 60, width: 6, height: 4 })], {
    bottomInset: 60,
  });
  await settled(el);
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(viewportOf(el).scrollTop).toBeGreaterThan(0);
  expect(box.bottom).toBeCloseTo(view.bottom - 60, 0);
  expect(box.right).toBeLessThanOrEqual(view.right);
  expect(box.left).toBeGreaterThanOrEqual(view.left);
});

it("reveal leaves a table already in view where it is", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 2 })], { bottomInset: 100 });
  await settled(el);
  el.reveal("t1");
  expect(viewportOf(el).scrollTop).toBe(0);
  expect(viewportOf(el).scrollLeft).toBe(0);
});

it("reveal brings a refused table's reason below it into view", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked 12 Oct, 21:00", { x: 2, y: 40 })]);
  await settled(el);
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  const reason = reasonOf(el, "t1")!.getBoundingClientRect();
  expect(reason.top).toBeGreaterThanOrEqual(button(el, "t1").getBoundingClientRect().bottom);
  expect(reason.bottom).toBeCloseTo(view.bottom, 0);
});

it("reveal brings the turn arrow into view", async () => {
  const el = await canvas(
    [table("t1", "T1", { x: 2, y: 40, width: 4, height: 4 }), table("t2", "T2", { y: 80 })],
    { selected: "t1" },
  );
  await settled(el);
  viewportOf(el).scrollTop = 40 * 12;
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  const handle = part(el, "rotate-handle").getBoundingClientRect();
  expect(handle.top).toBeGreaterThanOrEqual(view.top);
  expect(handle.bottom).toBeLessThanOrEqual(view.bottom);
  expect(handle.left).toBeGreaterThanOrEqual(view.left);
  expect(handle.right).toBeLessThanOrEqual(view.right);
});

it("reveal brings a reason wider than its table into view sideways", async () => {
  const el = await canvas([
    refusedTable("t1", "T1", "Booked 12 Oct, 21:00", { x: 10, y: 2, width: 2, height: 2 }),
    table("t2", "T2", { x: 80, y: 2 }),
  ]);
  el.style.width = "300px";
  await settled(el);
  viewportOf(el).scrollLeft = viewportOf(el).scrollWidth;
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  const reason = reasonOf(el, "t1")!.getBoundingClientRect();
  expect(reason.left).toBeLessThan(button(el, "t1").getBoundingClientRect().left);
  expect(reason.left).toBeCloseTo(view.left, 0);
});

it("reveal of a table it does not draw does nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 60 })]);
  await settled(el);
  el.reveal("t2");
  expect(viewportOf(el).scrollTop).toBe(0);
});

it("bottomInset draws the grid that much taller", async () => {
  const el = await canvas([table("t1", "T1", { y: 60 })]);
  await settled(el);
  const before = part(el, "grid").getBoundingClientRect().height;
  el.bottomInset = 200;
  await el.updateComplete;
  expect(part(el, "grid").getBoundingClientRect().height).toBe(before + 200);
});

it("reveal lifts the lowest table above the inset, through the room the inset adds", async () => {
  const el = await canvas([table("t1", "T1", { y: 20, height: 4 })], { bottomInset: 300 });
  await settled(el);
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  expect(button(el, "t1").getBoundingClientRect().bottom).toBeCloseTo(view.bottom - 300, 0);
});

it("reveal scrolls only the canvas, never the page round it", async () => {
  document.body.style.paddingBottom = "3000px";
  onTestFinished(() => {
    document.body.style.paddingBottom = "";
    window.scrollTo(0, 0);
  });
  const el = await canvas([table("t1", "T1", { x: 70, y: 60 })], { bottomInset: 200 });
  await settled(el);
  el.reveal("t1");
  expect(viewportOf(el).scrollTop).toBeGreaterThan(0);
  expect([window.scrollX, window.scrollY]).toEqual([0, 0]);
});

it("reveal keeps a table taller than the space left showing at its top", async () => {
  const el = await canvas([table("t1", "T1", { y: 40, height: 20 })], { bottomInset: 300 });
  await settled(el);
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  expect(button(el, "t1").getBoundingClientRect().top).toBeCloseTo(view.top, 0);
});

it("reveal brings a table below the top of a scrolled page down onto the screen", async () => {
  document.body.style.paddingBottom = "3000px";
  onTestFinished(() => {
    document.body.style.paddingBottom = "";
    window.scrollTo(0, 0);
  });
  const el = await canvas([table("t1", "T1", { y: 20 }), table("t2", "T2", { y: 60 })]);
  await settled(el);
  viewportOf(el).scrollTop = 272;
  window.scrollTo(0, el.getBoundingClientRect().top + 100);
  el.reveal("t1");
  expect(button(el, "t1").getBoundingClientRect().top).toBeCloseTo(0, 0);
});

it("reveal lifts a table past the bottom of the window up onto the screen", async () => {
  document.body.style.paddingTop = `${window.innerHeight - 200}px`;
  onTestFinished(() => {
    document.body.style.paddingTop = "";
  });
  const el = await canvas([table("t1", "T1", { y: 20 }), table("t2", "T2", { y: 60 })]);
  await settled(el);
  el.reveal("t1");
  expect(button(el, "t1").getBoundingClientRect().bottom).toBeCloseTo(window.innerHeight, 0);
});

it("draws room for a turned table at the grid's origin, so reveal brings all of it into view", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 })], { selected: "t1" });
  await settled(el);
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  const grid = part(el, "grid").getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(grid.left);
  expect(box.top).toBeGreaterThanOrEqual(grid.top);
  expect(box.left).toBeGreaterThanOrEqual(view.left);
  expect(box.top).toBeGreaterThanOrEqual(view.top);
  // At the shipped tokens: --wt-space-5 / 2 + --wt-space-1 + --wt-tap-min / 2, 12 + 4 + 22.
  const want = topCentre(el, "t1", place({ rotation: 45 }), 38);
  const h = centreOf(handles(el)[0]!);
  expect(Math.abs(h.x - want.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(h.y - want.y)).toBeLessThanOrEqual(2);
});

it("a turned table dragged to the origin stops where its drawn outline meets the plan's edge", async () => {
  const el = await canvas([
    table("t1", "T1", { x: 5, y: 10, rotation: 45 }),
    table("edge", "Edge", { y: 20 }),
  ]);
  await settled(el);
  const before = button(el, "t1").getBoundingClientRect();
  const edge = button(el, "edge").getBoundingClientRect().left;
  const grid = part(el, "grid").getBoundingClientRect();
  const seen = moves(el);
  const at = dragBy(el, "t1", -60, 0);
  await el.updateComplete;
  const during = button(el, "t1").getBoundingClientRect();
  expect(during.left).toBeCloseTo(before.left - 36, 1);
  expect(during.top).toBeCloseTo(before.top, 1);
  expect(during.left).toBeGreaterThanOrEqual(edge);
  expect(during.left - edge).toBeLessThan(12);
  const now = part(el, "grid").getBoundingClientRect();
  expect({ width: now.width, height: now.height }).toEqual({
    width: grid.width,
    height: grid.height,
  });
  expect([viewportOf(el).scrollLeft, viewportOf(el).scrollTop]).toEqual([0, 0]);
  await release(el, at);
  expect(seen).toEqual([{ key: "t1", x: 2, y: 10 }]);
});

it.each([
  ["8 × 8 turned 30°", { width: 8, height: 8, rotation: 30 }, 2],
  ["8 × 4 turned 90°", { width: 8, height: 4, rotation: 90 }, 0],
])(
  "the left arrow on a %s stops at its lowest x, where its drawn outline is inside the plan",
  async (_, size, lowest) => {
    const el = await canvas([
      table("low", "Low", { ...size, x: lowest, y: 5 }),
      table("next", "Next", { ...size, x: lowest + 1, y: 30 }),
    ]);
    const seen = moves(el);
    button(el, "low").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(seen).toEqual([]);
    button(el, "next").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(seen).toEqual([{ key: "next", x: lowest, y: 30 }]);
  },
);

it("a table that arrived poking out is not stepped in by a wobbling click, and a nudge moves it only as asked", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 })]);
  await settled(el);
  const seen = moves(el);
  const grid = part(el, "grid").getBoundingClientRect();
  const scroll = [viewportOf(el).scrollLeft, viewportOf(el).scrollTop];
  const box = button(el, "t1").getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  pointer(button(el, "t1"), "pointerdown", 1, x, y);
  pointer(window, "pointermove", 1, x + 1, y + 1);
  await el.updateComplete;
  const now = part(el, "grid").getBoundingClientRect();
  expect({ width: now.width, height: now.height }).toEqual({
    width: grid.width,
    height: grid.height,
  });
  expect([viewportOf(el).scrollLeft, viewportOf(el).scrollTop]).toEqual(scroll);
  await release(el, { x: x + 1, y: y + 1 });
  expect(seen).toEqual([]);
  button(el, "t1").focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(seen).toEqual([{ key: "t1", x: 1, y: 0 }]);
});

it("the handle of a turned table at the origin turns it round its own centre", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 })], { selected: "t1" });
  await settled(el);
  const seen = rotates(el);
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  pointer(handles(el)[0]!, "pointerdown", 1, cx + 80, cy);
  pointer(window, "pointermove", 1, cx, cy + 80);
  await release(el, { x: cx, y: cy + 80 });
  expect(seen).toEqual([{ key: "t1", rotation: 135, x: 0, y: 0 }]);
});

it("centres a turned table's refused reason under it at the origin", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked", { rotation: 45 })]);
  await settled(el);
  const box = button(el, "t1").getBoundingClientRect();
  const reason = reasonOf(el, "t1")!.getBoundingClientRect();
  expect(reason.left + reason.width / 2).toBeCloseTo(box.left + box.width / 2, 0);
  expect(reason.top).toBeGreaterThan(box.bottom);
});

it("a pointer move inside the same square, or the same turn step, draws nothing new", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const updated = vi.spyOn(el as unknown as { updated(): void }, "updated");
  const box = button(el, "t1").getBoundingClientRect();
  const x = box.left + 5;
  const y = box.top + 5;
  pointer(button(el, "t1"), "pointerdown", 1, x, y);
  pointer(window, "pointermove", 1, x + 3, y + 2);
  await el.updateComplete;
  pointer(window, "pointermove", 1, x + 5, y - 4);
  await el.updateComplete;
  expect(updated).not.toHaveBeenCalled();
  pointer(window, "pointermove", 1, x + 30, y);
  await el.updateComplete;
  expect(updated).toHaveBeenCalledTimes(1);
  pointer(window, "pointercancel", 1, 0, 0);
  await el.updateComplete;

  updated.mockClear();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  pointer(handles(el)[0]!, "pointerdown", 1, cx, cy - 80);
  pointer(window, "pointermove", 1, cx + 5, cy - 80);
  await el.updateComplete;
  expect(updated).not.toHaveBeenCalled();
  pointer(window, "pointermove", 1, cx + 80, cy);
  await el.updateComplete;
  expect(updated).toHaveBeenCalledTimes(1);
  pointer(window, "pointercancel", 1, 0, 0);
});

it("a plan that fits shows no scrollbars with a turned table at the corner, and all of that table", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 })], { selected: "t1" });
  await settled(el);
  const viewport = viewportOf(el);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
  el.reveal("t1");
  const grid = part(el, "grid").getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(grid.left);
  expect(box.top).toBeGreaterThanOrEqual(grid.top);
  expect(box.right).toBeLessThanOrEqual(grid.right);
  expect(box.bottom).toBeLessThanOrEqual(grid.bottom);
});

it("keeps a steady height with a turned table in a box that takes its height from the plan", async () => {
  const el = (await mount(
    '<wt-floor-plan-canvas style="width: 600px"></wt-floor-plan-canvas>',
  )) as WtFloorPlanCanvas;
  classicScrollbars(el);
  el.tables = [table("t1", "T1", { x: 100, rotation: 45 })];
  const heights: number[] = [];
  for (let frame = 0; frame < 6; frame++) {
    await settled(el);
    heights.push(part(el, "grid").getBoundingClientRect().height);
  }
  expect(heights).toEqual(Array(6).fill(312));
});

it("drops the room for a turned corner table once it is turned back, moved or replaced", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 })]);
  await settled(el);
  el.tables = [table("t1", "T1")];
  await settled(el);
  expect(offset(el, "t1")).toEqual({ left: 72, top: 72 });

  el.tables = [table("t1", "T1", { rotation: 45 })];
  await settled(el);
  el.tables = [table("t1", "T1", { x: 10, y: 10, rotation: 45 })];
  await settled(el);
  expect(offset(el, "t1").left).toBeCloseTo(120 + 72 + 48 - 48 * Math.SQRT2, 1);

  el.tables = [table("t1", "T1", { rotation: 45 })];
  await settled(el);
  el.tables = [table("t2", "T2", { x: 8, y: 8 })];
  await settled(el);
  expect(offset(el, "t2")).toEqual({ left: 168, top: 168 });
  expect(viewportOf(el).scrollWidth).toBe(viewportOf(el).clientWidth);
  expect(viewportOf(el).scrollHeight).toBe(viewportOf(el).clientHeight);
});

/**
 * Applies each move and turn, as the floor plan editor does: in its own next update, so the canvas
 * draws once with the drag ended and the old tables first.
 */
function applyChanges(el: WtFloorPlanCanvas): void {
  const change = (key: string, over: Partial<PlanPlacement>) => {
    queueMicrotask(() => {
      el.tables = el.tables.map((t) =>
        t.key === key ? { ...t, placement: { ...t.placement, ...over } } : t,
      );
    });
  };
  el.addEventListener("wt-table-move", (e) => {
    const { key, x, y } = (e as CustomEvent<TableMove>).detail;
    change(key, { x, y });
  });
  el.addEventListener("wt-table-rotate", (e) => {
    const { key, rotation, x, y } = (e as CustomEvent<TableRotate>).detail;
    change(key, { rotation, x, y });
  });
}

/** Where each table is on screen, from the viewport's corner. */
function onScreen(el: WtFloorPlanCanvas): Record<string, { left: number; top: number }> {
  const view = viewportOf(el).getBoundingClientRect();
  const seen: Record<string, { left: number; top: number }> = {};
  for (const t of el.tables) {
    const box = button(el, t.key).getBoundingClientRect();
    seen[t.key] = { left: box.left - view.left, top: box.top - view.top };
  }
  return seen;
}

/** Drags `key` by (dx, dy) px, then releases it, and returns where the tables were on screen
 *  just before the release and once the canvas has settled after it. */
async function dropAndCompare(el: WtFloorPlanCanvas, key: string, dx: number, dy: number) {
  const at = dragBy(el, key, dx, dy);
  await settled(el);
  const during = onScreen(el);
  await release(el, at);
  await settled(el);
  await settled(el);
  return { during, after: onScreen(el) };
}

it.each([
  ["a plan that fits", [] as PlanCanvasTable[]],
  ["a plan wider and taller than the box", [table("far", "Far", { x: 100, y: 60 })]],
])(
  "in %s, a turned corner table dragged away is let go where it is drawn, and nothing else moves",
  async (_, more) => {
    const el = await canvas([
      table("t1", "T1", { rotation: 45 }),
      table("t2", "T2", { x: 20 }),
      ...more,
    ]);
    applyChanges(el);
    await settled(el);
    const seen = moves(el);
    const { during, after } = await dropAndCompare(el, "t1", 60, 60);
    expect(seen).toEqual([{ key: "t1", x: 5, y: 5 }]);
    expect(after).toEqual(during);
  },
);

it("a turned table dropped at the corner is let go where it is drawn, inside the plan, adding no scroll room", async () => {
  const el = await canvas([
    table("t1", "T1", { x: 10, y: 10, rotation: 45 }),
    table("t2", "T2", { x: 26 }),
  ]);
  applyChanges(el);
  await settled(el);
  const { during, after } = await dropAndCompare(el, "t1", -120, -120);
  expect(el.tables[0]!.placement).toMatchObject({ x: 2, y: 2 });
  expect(after).toEqual(during);
  // It stops with its drawn outline inside the plan, so no room is added and none is kept.
  expect(viewportOf(el).scrollLeft).toBe(0);
  expect(viewportOf(el).scrollTop).toBe(0);
  button(el, "t2").focus();
  await userEvent.keyboard("{ArrowDown}");
  await settled(el);
  const viewport = viewportOf(el);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().left);
  expect(box.top).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().top);
});

it("an unturned table is let go where it is drawn", async () => {
  const el = await canvas([table("t1", "T1", { x: 5, y: 5 }), table("t2", "T2", { x: 30 })]);
  applyChanges(el);
  await settled(el);
  const { during, after } = await dropAndCompare(el, "t1", 60, 24);
  expect(el.tables[0]!.placement).toMatchObject({ x: 10, y: 7 });
  expect(after).toEqual(during);
});

it("a corner table turned straight by its handle is let go where it is drawn", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 }), table("t2", "T2", { x: 20 })], {
    selected: "t1",
  });
  applyChanges(el);
  await settled(el);
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const at = { x: cx + 80, y: cy - 80 };
  pointer(handles(el)[0]!, "pointerdown", 1, cx + 80, cy);
  pointer(window, "pointermove", 1, at.x, at.y);
  await settled(el);
  const during = onScreen(el);
  await release(el, at);
  await settled(el);
  await settled(el);
  expect(el.tables[0]!.placement.rotation).toBe(0);
  expect(onScreen(el)).toEqual(during);
});

it("follows a box made smaller after a drop", async () => {
  const el = await canvas([table("t1", "T1", { x: 5, y: 3 })]);
  applyChanges(el);
  await settled(el);
  await dropAndCompare(el, "t1", 60, 0);
  el.style.width = "400px";
  el.style.height = "300px";
  await settled(el);
  await settled(el);
  const viewport = viewportOf(el);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
});

it.each([
  ["narrower", "400px", "360px"],
  ["shorter", "600px", "336px"],
])("follows a box made only %s after a drag that grew the grid", async (_, width, height) => {
  const el = await canvas([table("t1", "T1", { x: 5, y: 5 })]);
  await settled(el);
  const start = dragBy(el, "t1", 1200, 1200);
  await settled(el);
  const back = { x: start.x - 1200, y: start.y - 1200 };
  pointer(window, "pointermove", 1, back.x, back.y);
  await settled(el);
  await release(el, back);
  await settled(el);
  el.style.width = width;
  el.style.height = height;
  await settled(el);
  await settled(el);
  const viewport = viewportOf(el);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
});

it("a parent's other layout after a drag that grew the grid gives the grown grid back", async () => {
  const el = await canvas([table("t1", "T1", { x: 5, y: 5 })]);
  await settled(el);
  const start = dragBy(el, "t1", 1200, 1200);
  await settled(el);
  const back = { x: start.x - 1200, y: start.y - 1200 };
  pointer(window, "pointermove", 1, back.x, back.y);
  await settled(el);
  await release(el, back);
  await settled(el);
  el.tables = [table("t1", "T1", { x: 6, y: 5 })];
  await settled(el);
  await settled(el);
  const viewport = viewportOf(el);
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
});

it("a turned table dragged to the top keeps a steady height in a box that takes its height from the plan", async () => {
  const errors: string[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.message);
  window.addEventListener("error", onError);
  onTestFinished(() => window.removeEventListener("error", onError));
  const el = (await mount(
    '<wt-floor-plan-canvas style="width: 600px"></wt-floor-plan-canvas>',
  )) as WtFloorPlanCanvas;
  el.tables = [table("t1", "T1", { x: 20, y: 10, rotation: 45 })];
  applyChanges(el);
  await settled(el);
  await settled(el);
  const start = part(el, "grid").getBoundingClientRect().height;
  const box = button(el, "t1").getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  pointer(button(el, "t1"), "pointerdown", 1, x, y);
  const heights: number[] = [];
  const below: number[] = [];
  for (let frame = 1; frame <= 10; frame++) {
    pointer(window, "pointermove", 1, x, y - frame * 12);
    await settled(el);
    heights.push(part(el, "grid").getBoundingClientRect().height);
    const now = button(el, "t1").getBoundingClientRect();
    // "+ 0" turns a rounded -0 into 0.
    below.push(Math.round(now.top + now.height / 2 - (y - frame * 12)) + 0);
  }
  await release(el, { x, y: y - 120 });
  for (let frame = 0; frame < 4; frame++) {
    await settled(el);
    heights.push(part(el, "grid").getBoundingClientRect().height);
  }
  expect(el.tables[0]!.placement).toMatchObject({ x: 20, y: 2 });
  // It stops with its drawn top inside the plan, so no room is added above it.
  expect(heights.at(-1)).toBe(start);
  expect(Math.max(...heights)).toBe(start);
  // It stops at y 2 after eight frames while the pointer goes on up.
  expect(below).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 12, 24]);
  expect(errors).toEqual([]);
});

it("the first tables drawn after an empty plan show a turned corner table unscrolled", async () => {
  const el = await canvas([]);
  await settled(el);
  el.tables = [table("t1", "T1", { rotation: 45 }), table("far", "Far", { x: 100, y: 60 })];
  await settled(el);
  const viewport = viewportOf(el);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
  const view = viewport.getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(view.left);
  expect(box.top).toBeGreaterThanOrEqual(view.top);
});

it.each([
  ["a nudge", 45, "table", "{ArrowRight}"],
  ["a turn back", 30, "handle", "{ArrowLeft}"],
] as const)(
  "in a plan that fits, %s of a turned corner table by its keys moves no other table",
  async (_, rotation, target, key) => {
    const el = await canvas([table("t1", "T1", { rotation }), table("t2", "T2", { x: 20 })], {
      selected: "t1",
    });
    applyChanges(el);
    await settled(el);
    const before = onScreen(el);
    const layout = JSON.stringify(el.tables);
    (target === "table" ? button(el, "t1") : handles(el)[0]!).focus();
    await userEvent.keyboard(key);
    await settled(el);
    await settled(el);
    expect(JSON.stringify(el.tables)).not.toBe(layout);
    const now = onScreen(el);
    expect(Math.abs(now.t2!.left - before.t2!.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(now.t2!.top - before.t2!.top)).toBeLessThanOrEqual(0.5);
  },
);

it.each([
  ["an undo after a corner drop", true],
  ["a refused corner drop", false],
])("%s leaves no extra room once the earlier layout comes back", async (_, applied) => {
  const earlier = [table("t1", "T1", { x: 10, y: 10, rotation: 45 }), table("t2", "T2", { x: 26 })];
  const el = await canvas(earlier);
  if (applied) applyChanges(el);
  await settled(el);
  const grid = part(el, "grid").getBoundingClientRect();
  const scroll = { width: viewportOf(el).scrollWidth, height: viewportOf(el).scrollHeight };
  await dropAndCompare(el, "t1", -120, -120);
  expect(el.tables[0]!.placement).toMatchObject(applied ? { x: 2, y: 2 } : { x: 10, y: 10 });
  el.tables = earlier.map((t) => ({ ...t, placement: { ...t.placement } }));
  await settled(el);
  await settled(el);
  const now = part(el, "grid").getBoundingClientRect();
  expect({ width: now.width, height: now.height }).toEqual({
    width: grid.width,
    height: grid.height,
  });
  expect({ width: viewportOf(el).scrollWidth, height: viewportOf(el).scrollHeight }).toEqual(
    scroll,
  );
});

it("a parent setting the same tables again after a drag that moved nothing moves nothing on screen", async () => {
  const tables = [table("t1", "T1", { x: 5, y: 5 }), table("t2", "T2", { x: 30 })];
  const el = await canvas(tables);
  await settled(el);
  const start = dragBy(el, "t1", 1200, 0);
  await settled(el);
  viewportOf(el).scrollLeft = 600;
  pointer(window, "pointermove", 1, start.x - 1200, start.y);
  await settled(el);
  await release(el, { x: start.x - 1200, y: start.y });
  await settled(el);
  const before = onScreen(el);
  el.tables = tables.map((t) => ({ ...t, placement: { ...t.placement } }));
  await settled(el);
  await settled(el);
  expect(onScreen(el)).toEqual(before);
});

it("in a scrolled plan, a turn back of a big corner table by its key gives back only the room scrolled away", async () => {
  const el = await canvas(
    [table("t1", "T1", { width: 60, height: 60, rotation: 45 }), table("t2", "T2", { x: 70 })],
    {
      selected: "t1",
    },
  );
  applyChanges(el);
  await settled(el);
  viewportOf(el).scrollLeft = 12;
  viewportOf(el).scrollTop = 12;
  await settled(el);
  const screen = onScreen(el);
  const grid = offset(el, "t2");
  handles(el)[0]!.focus({ preventScroll: true });
  await userEvent.keyboard("{ArrowLeft}");
  await settled(el);
  await settled(el);
  expect(el.tables[0]!.placement.rotation).toBe(30);
  expect(onScreen(el).t2).toEqual(screen.t2);
  expect(offset(el, "t2")).toEqual({ left: grid.left - 12, top: grid.top - 12 });
});

const frame = () => new Promise(requestAnimationFrame);

/** Where the plan's (0, 0) is on screen, from unturned table `key` placed at (x, y). */
function planCorner(el: WtFloorPlanCanvas, key: string, x: number, y: number) {
  const box = button(el, key).getBoundingClientRect();
  return { x: box.left - x * 12, y: box.top - y * 12 };
}

const overflows = (el: WtFloorPlanCanvas) => {
  const v = viewportOf(el);
  return v.scrollWidth > v.clientWidth || v.scrollHeight > v.clientHeight;
};

const at = (node: Element) => {
  const box = node.getBoundingClientRect();
  return { left: box.left, top: box.top };
};

/** Presses `key`'s turn arrow and moves the pointer round the table's centre to each of `turns`,
 *  without releasing it; `each` runs a frame after every move. */
async function turnArrow(
  el: WtFloorPlanCanvas,
  key: string,
  turns: number[],
  each: () => void = () => {},
) {
  const c = centreOf(button(el, key));
  const h = centreOf(handles(el)[0]!);
  pointer(handles(el)[0]!, "pointerdown", 1, h.x, h.y);
  let to = h;
  for (const turn of turns) {
    to = roundFrom(c, h, turn);
    pointer(window, "pointermove", 1, to.x, to.y);
    await frame();
    await el.updateComplete;
    each();
  }
  return to;
}

it("a turn that makes a corner table poke out steps it in by what poked out, as it turns, and nothing else moves", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 9 })], { selected: "t1" });
  applyChanges(el);
  await settled(el);
  const corner = planCorner(el, "t1", 0, 0);
  const t2 = at(button(el, "t2"));
  const seen = rotates(el);
  const overflowed: boolean[] = [];
  const t2Moved: boolean[] = [];
  const look = () => {
    overflowed.push(overflows(el));
    const now = at(button(el, "t2"));
    t2Moved.push(now.left !== t2.left || now.top !== t2.top);
  };
  const to = await turnArrow(el, "t1", [15], look);
  for (let f = 0; f < 2; f++) {
    await frame();
    look();
  }
  const c = centreOf(button(el, "t1"));
  expect(c.x).toBeCloseTo(corner.x + 5 * 12, 1);
  expect(c.y).toBeCloseTo(corner.y + 5 * 12, 1);
  expect(button(el, "t1").style.transform).toBe("rotate(15deg)");
  expect(seen).toEqual([]);
  await release(el, to);
  for (let f = 0; f < 10; f++) {
    await frame();
    look();
  }
  expect(seen).toEqual([{ key: "t1", rotation: 15, x: 1, y: 1 }]);
  expect(overflowed).toEqual(Array(13).fill(false));
  expect(t2Moved).toEqual(Array(13).fill(false));
});

it("a turn on and back within one press steps a corner table in and puts it back, and sends nothing", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 9 })], { selected: "t1" });
  await settled(el);
  const corner = planCorner(el, "t1", 0, 0);
  const seen = rotates(el);
  const centres: { x: number; y: number }[] = [];
  const to = await turnArrow(el, "t1", [15, 30, 0], () => {
    const c = centreOf(button(el, "t1"));
    centres.push({ x: Math.round(c.x - corner.x), y: Math.round(c.y - corner.y) });
  });
  expect(centres).toEqual([
    { x: 60, y: 60 },
    { x: 72, y: 72 },
    { x: 48, y: 48 },
  ]);
  await release(el, to);
  expect(seen).toEqual([]);
});

it("the right arrow on the turn arrow of a table near the corner steps it in, and nothing else moves", async () => {
  const el = await canvas(
    [table("t1", "T1", { x: 1, y: 1, rotation: 15 }), table("t2", "T2", { x: 9 })],
    { selected: "t1" },
  );
  applyChanges(el);
  await settled(el);
  const t2 = at(button(el, "t2"));
  const seen = rotates(el);
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  await settled(el);
  await settled(el);
  expect(seen).toEqual([{ key: "t1", rotation: 30, x: 2, y: 2 }]);
  expect(el.tables[0]!.placement).toMatchObject({ rotation: 30, x: 2, y: 2 });
  expect(at(button(el, "t2"))).toEqual(t2);
  expect(overflows(el)).toBe(false);
});

it("a key turn that steps in a big table that arrived poking out moves no other table", async () => {
  const el = await canvas(
    [table("t1", "T1", { width: 60, height: 60, rotation: 15 }), table("t2", "T2", { x: 70 })],
    { selected: "t1" },
  );
  applyChanges(el);
  await settled(el);
  const t2 = at(button(el, "t2"));
  handles(el)[0]!.focus({ preventScroll: true });
  await userEvent.keyboard("{ArrowRight}");
  await settled(el);
  await settled(el);
  expect(el.tables[0]!.placement).toMatchObject({ rotation: 30, x: 5, y: 5 });
  expect(at(button(el, "t2"))).toEqual(t2);
});

it("a long table at the corner turned to 90° by one drag is drawn and sent where it no longer pokes out", async () => {
  const el = await canvas([table("t1", "T1", { width: 20, height: 4 })], { selected: "t1" });
  await settled(el);
  const corner = planCorner(el, "t1", 0, 0);
  const seen = rotates(el);
  const to = await turnArrow(el, "t1", [90]);
  const c = centreOf(button(el, "t1"));
  expect(c.x).toBeCloseTo(corner.x + 10 * 12, 1);
  expect(c.y).toBeCloseTo(corner.y + 10 * 12, 1);
  await release(el, to);
  expect(seen).toEqual([{ key: "t1", rotation: 90, x: 0, y: 8 }]);
});

it("a turn of a table that arrived poking out, to less far out, does not step it", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 30 })], { selected: "t1" });
  const seen = rotates(el);
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(seen).toEqual([{ key: "t1", rotation: 15, x: 0, y: 0 }]);
});

it("a turn steps a corner table in over another table", async () => {
  const el = await canvas([table("t1", "T1"), table("t2", "T2", { x: 8 })], { selected: "t1" });
  applyChanges(el);
  const seen = rotates(el);
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  await settled(el);
  expect(seen).toEqual([{ key: "t1", rotation: 15, x: 1, y: 1 }]);
  const t1 = button(el, "t1").getBoundingClientRect();
  expect(t1.right).toBeGreaterThan(button(el, "t2").getBoundingClientRect().left);
});

it("one full turn by key walks a corner table away from the edge", async () => {
  const el = await canvas([table("t1", "T1")], { selected: "t1" });
  applyChanges(el);
  for (let press = 0; press < 24; press++) {
    handles(el)[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await settled(el);
  }
  expect(el.tables[0]!.placement).toMatchObject({ rotation: 0, x: 2, y: 2 });
});

it("Shift+ArrowRight on a turned table near the corner steps it in, and moves no other table", async () => {
  const el = await canvas(
    [table("t1", "T1", { x: 1, y: 1, rotation: 15 }), table("t2", "T2", { x: 20 })],
    { selected: "t1" },
  );
  const sized: TableResize[] = [];
  el.addEventListener("wt-table-resize", (e) => {
    const { key, ...box } = (e as CustomEvent<TableResize>).detail;
    sized.push({ key, ...box });
    queueMicrotask(() => {
      el.tables = el.tables.map((t) =>
        t.key === key ? { ...t, placement: { ...t.placement, ...box } } : t,
      );
    });
  });
  await settled(el);
  const t2 = at(button(el, "t2"));
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await settled(el);
  await settled(el);
  expect(sized).toEqual([{ key: "t1", x: 1, y: 2, width: 9, height: 8 }]);
  expect(at(button(el, "t2"))).toEqual(t2);
  expect(overflows(el)).toBe(false);
});

it("names the rotate handle with a table name holding replacement patterns", async () => {
  const el = await canvas([table("t1", "A$&B$'C")], { selected: "t1" });
  expect(handles(el)[0]!.getAttribute("aria-label")).toBe("Rotate A$&B$'C");
});

it("names the rotate handle in English when no copy is given", async () => {
  const el = await canvas([table("t1", "T1")], { selected: "t1" });
  expect(handles(el)[0]!.getAttribute("aria-label")).toBe("Rotate T1");
});

it("hands its removal on to Lit once", async () => {
  const { LitElement } = await import("lit");
  const el = await canvas([table("t1", "T1")]);
  const disconnected = vi.spyOn(LitElement.prototype, "disconnectedCallback");
  try {
    el.remove();
    expect(disconnected.mock.contexts.filter((c) => c === el)).toHaveLength(1);
  } finally {
    disconnected.mockRestore();
  }
});

it("a press focuses a table partly out of view without scrolling the canvas", async () => {
  const el = await canvas([
    table("t1", "T1", { x: 2, y: 40, height: 8 }),
    table("t2", "T2", { y: 80 }),
  ]);
  await settled(el);
  const viewport = viewportOf(el);
  // The table's top 48 px are above the viewport and its bottom 48 px show.
  const scrolled = offset(el, "t1").top + 48;
  viewport.scrollTop = scrolled;
  viewport.scrollLeft = 0;
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.top).toBeCloseTo(viewport.getBoundingClientRect().top - 48, 0);
  pointer(button(el, "t1"), "pointerdown", 1, box.left + 5, box.bottom - 5);
  pointer(window, "pointercancel", 1, 0, 0);
  expect(el.shadowRoot!.activeElement).toBe(button(el, "t1"));
  expect(viewport.scrollTop).toBe(scrolled);
  expect(viewport.scrollLeft).toBe(0);
});

function expectInside(inner: DOMRect, outer: DOMRect): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left);
  expect(inner.top).toBeGreaterThanOrEqual(outer.top);
  expect(inner.right).toBeLessThanOrEqual(outer.right);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom);
}

it("draws the turn arrow of a selected table at the grid's corner inside the grid, and reveal shows it", async () => {
  const el = await canvas([table("t1", "T1", { width: 1, height: 1 })], { selected: "t1" });
  await settled(el);
  expectInside(handles(el)[0]!.getBoundingClientRect(), part(el, "grid").getBoundingClientRect());
  expect(cornerAreas(el)).toHaveLength(4);
  for (const c of cornerAreas(el)) {
    expectInside(c.getBoundingClientRect(), part(el, "grid").getBoundingClientRect());
  }
  el.reveal("t1");
  expectInside(handles(el)[0]!.getBoundingClientRect(), viewportOf(el).getBoundingClientRect());
});

it("keeps the turn arrow inside the grid while its table is dragged into the top rows", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 20 })], { selected: "t1" });
  await settled(el);
  const at = dragBy(el, "t1", 0, -20 * 12);
  await settled(el);
  viewportOf(el).scrollTop = 0;
  const handle = handles(el)[0]!.getBoundingClientRect();
  expectInside(handle, part(el, "grid").getBoundingClientRect());
  expectInside(handle, viewportOf(el).getBoundingClientRect());
  for (const d of dots(el)) {
    expectInside(d.getBoundingClientRect(), part(el, "grid").getBoundingClientRect());
  }
  pointer(window, "pointercancel", 1, at.x, at.y);
});

it("in a plan that fits, selecting and deselecting a table moves nothing and adds no scrollbar", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  el.addEventListener("wt-table-select", (e) => {
    el.selected = (e as CustomEvent<TableSelect>).detail.key;
  });
  await settled(el);
  const before = onScreen(el);
  const size = part(el, "grid").getBoundingClientRect();
  const check = () => {
    const now = onScreen(el);
    expect(Math.abs(now.t1!.left - before.t1!.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(now.t1!.top - before.t1!.top)).toBeLessThanOrEqual(0.5);
    const grid = part(el, "grid").getBoundingClientRect();
    expect(grid.width).toBe(size.width);
    expect(grid.height).toBe(size.height);
    const viewport = viewportOf(el);
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    expect(viewport.scrollHeight).toBe(viewport.clientHeight);
  };
  button(el, "t1").click();
  await settled(el);
  expect(el.selected).toBe("t1");
  check();
  part(el, "grid").click();
  await settled(el);
  expect(el.selected).toBe(null);
  check();
});

it("keeps room round the grid's corner for the turn arrow, from the tokens", async () => {
  const el = await canvas([table("t1", "T1")]);
  expect(offset(el, "t1")).toEqual({ left: 72, top: 72 });
  el.style.setProperty("--wt-tap-min", "68px");
  el.tables = [table("t1", "T1")];
  await el.updateComplete;
  expect(offset(el, "t1")).toEqual({ left: 96, top: 96 });
});

it.each(Array.from({ length: 24 }, (_, i) => i * 15))(
  "keeps the whole turn arrow of a corner table turned %i° inside the grid",
  async (rotation) => {
    const el = await canvas([table("t1", "T1", { rotation, width: 8, height: 4 })], {
      selected: "t1",
    });
    await settled(el);
    expectInside(handles(el)[0]!.getBoundingClientRect(), part(el, "grid").getBoundingClientRect());
    for (const d of dots(el)) {
      expectInside(d.getBoundingClientRect(), part(el, "grid").getBoundingClientRect());
    }
    expect(cornerAreas(el)).toHaveLength(4);
    for (const c of cornerAreas(el)) {
      expectInside(c.getBoundingClientRect(), part(el, "grid").getBoundingClientRect());
    }
  },
);

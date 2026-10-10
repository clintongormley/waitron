import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type {
  PlanCanvasTable,
  TableMove,
  TableRotate,
  TableSelect,
  WtFloorPlanCanvas,
} from "./wt-floor-plan-canvas.js";
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

it("writes a selected refused table's reason below its handle when the handle is below", async () => {
  const el = await canvas([refusedTable("t1", "T1", "Booked at 21:00", { y: 1 })], {
    selected: "t1",
  });
  await settled(el);
  const handle = part(el, "rotate-handle").getBoundingClientRect();
  expect(handle.top).toBeGreaterThanOrEqual(button(el, "t1").getBoundingClientRect().bottom);
  expect(reasonOf(el, "t1")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(handle.bottom);
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
  expect(offset(el, "t1")).toEqual({ left: 60, top: 48 });
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
  expect(offset(el, "t1")).toEqual({ left: 24, top: 36 });
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
  expect(offset(el, "t1")).toEqual({ left: 24, top: 36 });
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
  expect(grid.width).toBe((122 + 8 + 8) * 12);
  expect(grid.height).toBe((123 + 8 + 8) * 12);
});

it("a pointer cancel puts the table back and sends nothing", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 })]);
  const seen = moves(el);
  const at = dragBy(el, "t1", 30, 13);
  pointer(window, "pointercancel", 1, at.x, at.y);
  await el.updateComplete;
  expect(offset(el, "t1")).toEqual({ left: 24, top: 36 });
  pointer(window, "pointerup", 1, at.x, at.y);
  expect(seen).toEqual([]);
});

it("a second pointer cannot take over a drag", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 3 }), table("t2", "T2", { x: 20 })]);
  const seen = moves(el);
  const first = dragBy(el, "t1", 24, 0, 1);
  const second = dragBy(el, "t2", 60, 60, 2);
  await el.updateComplete;
  expect(offset(el, "t2")).toEqual({ left: 240, top: 0 });
  expect(offset(el, "t1")).toEqual({ left: 48, top: 36 });
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

it("draws the handle at least a tap target square, above the table", async () => {
  const el = await canvas([table("t1", "T1", { x: 2, y: 10 })], { selected: "t1" });
  host.style.setProperty("--wt-tap-min", "50px");
  host.style.setProperty("--wt-space-1", "6px");
  const handle = handles(el)[0]!.getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(handle.width).toBeGreaterThanOrEqual(50);
  expect(handle.height).toBeGreaterThanOrEqual(50);
  expect(box.top - handle.bottom).toBe(6);
  expect(handle.left + handle.width / 2).toBeCloseTo(box.left + box.width / 2);
  const icon = handles(el)[0]!.querySelector("wt-icon")!;
  await (icon as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(icon.shadowRoot!.querySelector("path")).not.toBeNull();
});

it("dragging the handle turns the table in 15° steps", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  const seen = rotates(el);
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const r = 80;
  const turnTo = async (x: number, y: number) => {
    const handle = handles(el)[0]!;
    const h = handle.getBoundingClientRect();
    pointer(handle, "pointerdown", 1, h.left + h.width / 2, h.top + h.height / 2);
    pointer(window, "pointermove", 1, x, y);
    await release(el, { x, y });
  };
  await turnTo(cx + r, cy);
  await turnTo(cx, cy + r);
  const a = (50 * Math.PI) / 180;
  await turnTo(cx + r * Math.sin(a), cy - r * Math.cos(a));
  await turnTo(cx - r, cy);
  await turnTo(cx, cy - r);
  expect(seen).toEqual([
    { key: "t1", rotation: 90 },
    { key: "t1", rotation: 180 },
    { key: "t1", rotation: 45 },
    { key: "t1", rotation: 270 },
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
  pointer(handles(el)[0]!, "pointerdown", 1, hx, hy);
  pointer(window, "pointermove", 1, cx + 80, cy);
  await release(el, { x: cx + 80, y: cy });
  expect(seen).toEqual([{ key: "t1", rotation: 180 }]);
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
  expect(seen).toEqual([{ key: "t1", rotation: 90 }]);
});

it("needs room for the handle's size and its gap to draw it above", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 4 })]);
  host.style.setProperty("--wt-space-1", "10px");
  el.selected = "t1";
  await el.updateComplete;
  const h = handles(el)[0]!.getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(h.top - box.bottom).toBe(10);
});

it("a real drag of the handle turns the table and keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  await settled(el);
  const seen = rotates(el);
  const selections = selects(el);
  await userEvent.dragAndDrop(handles(el)[0]!, part(el, "grid"), {
    targetPosition: { x: 168 + 80, y: 168 },
  });
  expect(seen).toEqual([{ key: "t1", rotation: 90 }]);
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
    targetPosition: { x: 10, y: 76 },
  });
  expect(seen).toEqual([{ key: "t1", x: 1, y: 3 }]);
  expect(selections).toEqual([]);
});

it("a real drag of the handle that turns nothing keeps the selection", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 10 })], { selected: "t1" });
  await settled(el);
  const seen = rotates(el);
  const selections = selects(el);
  await userEvent.dragAndDrop(handles(el)[0]!, part(el, "grid"), {
    targetPosition: { x: 168, y: 20 },
  });
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
  // About 5 px right, under half a square, ending past the table's right edge (48 px).
  await userEvent.dragAndDrop(button(el, "t1"), part(el, "grid"), {
    sourcePosition: { x: 20, y: 12 },
    targetPosition: { x: 50, y: 48 },
  });
  expect(seen).toEqual([]);
  expect(selections).toEqual([]);
});

it("keeps the handle on the side it started on while the table turns", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 0, width: 2, height: 10 })], {
    selected: "t1",
  });
  const box = button(el, "t1").getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const h = handles(el)[0]!.getBoundingClientRect();
  pointer(handles(el)[0]!, "pointerdown", 1, h.left + h.width / 2, h.top + h.height / 2);
  pointer(window, "pointermove", 1, cx + 80, cy);
  await el.updateComplete;
  const turned = button(el, "t1").getBoundingClientRect();
  expect(handles(el)[0]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(turned.bottom);
  pointer(window, "pointercancel", 1, cx + 80, cy);
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

it("draws the handle below a table with no room above it", async () => {
  for (const y of [0, 2]) {
    const el = await canvas([table("t1", "T1", { x: 10, y })], { selected: "t1" });
    const handle = handles(el)[0]!;
    const h = handle.getBoundingClientRect();
    const box = button(el, "t1").getBoundingClientRect();
    expect(h.top - box.bottom, `y ${y}`).toBe(4);
    const hit = el.shadowRoot!.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2);
    expect(hit !== null && handle.contains(hit), `y ${y}`).toBe(true);
    cleanup();
  }
});

it("keeps the handle above a table once there is room", async () => {
  const el = await canvas([table("t1", "T1", { x: 10, y: 4 })], { selected: "t1" });
  const h = handles(el)[0]!.getBoundingClientRect();
  const box = button(el, "t1").getBoundingClientRect();
  expect(box.top - h.bottom).toBe(4);
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
    { key: "t1", rotation: 15 },
    { key: "t1", rotation: 345 },
    { key: "t1", rotation: 0 },
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
  button(el, "t1").focus();
  await userEvent.keyboard("{ArrowRight}");
  handles(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(moved.map((e) => e.detail)).toEqual([{ key: "t1", x: 11, y: 10 }]);
  expect(turned.map((e) => e.detail)).toEqual([{ key: "t1", rotation: 15 }]);
  for (const e of [...moved, ...turned]) {
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

it("reveal brings the handle above a table into view", async () => {
  const el = await canvas(
    [table("t1", "T1", { x: 2, y: 40, width: 4, height: 4 }), table("t2", "T2", { y: 80 })],
    { selected: "t1" },
  );
  await settled(el);
  viewportOf(el).scrollTop = 40 * 12;
  el.reveal("t1");
  const view = viewportOf(el).getBoundingClientRect();
  const handle = part(el, "rotate-handle").getBoundingClientRect();
  expect(handle.bottom).toBeLessThan(button(el, "t1").getBoundingClientRect().top);
  expect(handle.top).toBeCloseTo(view.top, 0);
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
  viewportOf(el).scrollTop = 200;
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
  const handle = handles(el)[0]!.getBoundingClientRect();
  expect(handle.left + handle.width / 2).toBeCloseTo(box.left + box.width / 2, 1);
});

it("a turned table dragged to the origin stays under the pointer and inside the grid", async () => {
  const el = await canvas([table("t1", "T1", { x: 5, y: 10, rotation: 45 })]);
  await settled(el);
  const before = button(el, "t1").getBoundingClientRect();
  const seen = moves(el);
  const at = dragBy(el, "t1", -60, 0);
  await el.updateComplete;
  const during = button(el, "t1").getBoundingClientRect();
  expect(during.left).toBeCloseTo(before.left - 60, 1);
  expect(during.top).toBeCloseTo(before.top, 1);
  expect(during.left).toBeGreaterThanOrEqual(part(el, "grid").getBoundingClientRect().left);
  await release(el, at);
  expect(seen).toEqual([{ key: "t1", x: 0, y: 10 }]);
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
  expect(seen).toEqual([{ key: "t1", rotation: 135 }]);
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
  expect(heights).toEqual(Array(6).fill(240));
});

it("drops the room for a turned corner table once it is turned back, moved or replaced", async () => {
  const el = await canvas([table("t1", "T1", { rotation: 45 })]);
  await settled(el);
  el.tables = [table("t1", "T1")];
  await settled(el);
  expect(offset(el, "t1")).toEqual({ left: 0, top: 0 });

  el.tables = [table("t1", "T1", { rotation: 45 })];
  await settled(el);
  el.tables = [table("t1", "T1", { x: 10, y: 10, rotation: 45 })];
  await settled(el);
  expect(offset(el, "t1").left).toBeCloseTo(120 + 48 - 48 * Math.SQRT2, 1);

  el.tables = [table("t1", "T1", { rotation: 45 })];
  await settled(el);
  el.tables = [table("t2", "T2", { x: 10, y: 10 })];
  await settled(el);
  expect(offset(el, "t2")).toEqual({ left: 120, top: 120 });
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
    const { key, rotation } = (e as CustomEvent<TableRotate>).detail;
    change(key, { rotation });
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

it("a turned table dropped at the corner is let go where it is drawn; its scroll room goes at the next change", async () => {
  const el = await canvas([
    table("t1", "T1", { x: 10, y: 10, rotation: 45 }),
    table("t2", "T2", { x: 30 }),
  ]);
  applyChanges(el);
  await settled(el);
  const { during, after } = await dropAndCompare(el, "t1", -120, -120);
  expect(el.tables[0]!.placement).toMatchObject({ x: 0, y: 0 });
  expect(after).toEqual(during);
  // The kept room cannot go without moving what was under the pointer, so it waits.
  expect(viewportOf(el).scrollLeft).toBe(24);
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
  const el = await canvas([table("t1", "T1", { x: 5, y: 5 })]);
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
  expect(el.tables[0]!.placement).toMatchObject({ x: 20, y: 0 });
  // Only the two squares of room the turned table's corner needs above it are added.
  expect(heights.at(-1)).toBe(start + 24);
  expect(Math.max(...heights)).toBe(start + 24);
  // With no height of its own the box cannot scroll that room away, so the table drops below the
  // pointer by the square each corner square of room takes.
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

it("names the rotate handle with a table name holding replacement patterns", async () => {
  const el = await canvas([table("t1", "A$&B$'C")], { selected: "t1" });
  expect(handles(el)[0]!.getAttribute("aria-label")).toBe("Rotate A$&B$'C");
});

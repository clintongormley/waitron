import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, mountInShadowRoot } from "../test-helpers.js";
import { applyTokens } from "../tokens/index.js";
import type { PlanPlacement } from "../floor-plan-geometry.js";
import type { FloorMapDetails, FloorMapTable, FloorMapTap, WtFloorMap } from "./wt-floor-map.js";
import "./wt-floor-map.js";

const t = (
  id: string,
  label: string,
  placement: Partial<PlanPlacement> = {},
  over: Partial<FloorMapTable> = {},
): FloorMapTable => ({
  id,
  label,
  placement: { x: 0, y: 0, width: 8, height: 4, shape: "rect", rotation: 0, ...placement },
  fill: "free",
  dot: null,
  joinId: null,
  description: "Free",
  ...over,
});

// Fitted in 600 × 300 at left 150, top 75, 300 × 150 (Task 3.2b's first case).
const t1 = t("t1", "T1", { x: 10, y: 5 });

let taps: FloorMapTap[];
let details: FloorMapDetails[];
const onTap = (e: Event) => taps.push((e as CustomEvent<FloorMapTap>).detail);
const onDetails = (e: Event) => details.push((e as CustomEvent<FloorMapDetails>).detail);

beforeEach(() => {
  taps = [];
  details = [];
  document.addEventListener("wt-table-tap", onTap);
  document.addEventListener("wt-table-details", onDetails);
});

afterEach(() => {
  document.removeEventListener("wt-table-tap", onTap);
  document.removeEventListener("wt-table-details", onDetails);
  vi.useRealTimers();
  cleanup();
});

async function map(tables: FloorMapTable[]): Promise<WtFloorMap> {
  const el = (await mountInShadowRoot(
    '<wt-floor-map style="width: 600px; height: 300px"></wt-floor-map>',
  )) as WtFloorMap;
  el.tables = tables;
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await el.updateComplete;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return el;
}

const button = (el: WtFloorMap, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`[part="table"][data-table-id="${id}"]`)!;

interface Press {
  pointerId?: number;
  pointerType?: string;
  button?: number;
  ctrlKey?: boolean;
}

/** Client coordinates of a point given relative to the map. */
function at(el: WtFloorMap, x: number, y: number): { clientX: number; clientY: number } {
  const box = el.getBoundingClientRect();
  return { clientX: box.left + x, clientY: box.top + y };
}

function pointer(target: EventTarget, type: string, client: object, press: Press): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: press.pointerId ?? 1,
      pointerType: press.pointerType ?? "touch",
      button: press.button ?? 0,
      ctrlKey: press.ctrlKey ?? false,
      ...client,
    }),
  );
}

/** Presses at (x, y) relative to the map, on whatever the map draws there. */
function down(el: WtFloorMap, x: number, y: number, press: Press = {}): void {
  const client = at(el, x, y);
  const target = el.shadowRoot!.elementFromPoint(client.clientX, client.clientY) ?? el;
  pointer(target, "pointerdown", client, press);
}

function up(el: WtFloorMap, x: number, y: number, press: Press = {}): void {
  pointer(window, "pointerup", at(el, x, y), press);
}

function tapAt(el: WtFloorMap, x: number, y: number, press: Press = {}): void {
  down(el, x, y, press);
  up(el, x, y, press);
}

function contextMenuOn(target: EventTarget): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, composed: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function shiftF10On(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "F10",
    shiftKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

const shapeOf = (el: WtFloorMap, id: string) =>
  button(el, id).querySelector<HTMLElement>('[part="shape"]')!;

it("a touch tap on a table asks to open it, at once", async () => {
  const el = await map([t1]);
  let heard: CustomEvent<FloorMapTap> | undefined;
  document.addEventListener("wt-table-tap", (e) => (heard = e as CustomEvent<FloorMapTap>), {
    once: true,
  });
  tapAt(el, 300, 150);
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect(heard!.bubbles).toBe(true);
  expect(heard!.composed).toBe(true);
  expect(details).toEqual([]);
});

it("a pen tap on a table asks to open it, at once", async () => {
  const el = await map([t1]);
  tapAt(el, 300, 150, { pointerType: "pen" });
  expect(taps).toEqual([{ tableId: "t1" }]);
});

it("a mouse click on a table waits for a second click", async () => {
  const el = await map([t1]);
  tapAt(el, 300, 150, { pointerType: "mouse" });
  expect(taps).toEqual([]);
  vi.advanceTimersByTime(299);
  expect(taps).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect(details).toEqual([]);
});

it("a mouse double-click on a table asks for its details instead", async () => {
  const el = await map([t1]);
  tapAt(el, 300, 150, { pointerType: "mouse" });
  vi.advanceTimersByTime(100);
  tapAt(el, 300, 150, { pointerType: "mouse" });
  expect(details).toEqual([{ tableId: "t1" }]);
  vi.advanceTimersByTime(300);
  expect(taps).toEqual([]);
});

it("a touch double tap on the table just tapped sends nothing more", async () => {
  const el = await map([t1]);
  tapAt(el, 300, 150);
  vi.advanceTimersByTime(100);
  tapAt(el, 300, 150);
  vi.advanceTimersByTime(300);
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect(details).toEqual([]);
});

/** Two touching tables, and a point 10 px either side of where they meet. */
async function neighbours(): Promise<{ el: WtFloorMap; a: [number, number]; b: [number, number] }> {
  const el = await map([t("a", "A", { x: 0 }), t("b", "B", { x: 8 })]);
  const outer = el.getBoundingClientRect();
  const box = button(el, "b").getBoundingClientRect();
  const x = box.left - outer.left;
  const y = box.top - outer.top + box.height / 2;
  return { el, a: [x - 10, y], b: [x + 10, y] };
}

it("a touch double tap that lands on a different table opens each", async () => {
  const { el, a, b } = await neighbours();
  tapAt(el, ...a);
  vi.advanceTimersByTime(100);
  tapAt(el, ...b);
  expect(taps).toEqual([{ tableId: "a" }, { tableId: "b" }]);
  expect(details).toEqual([]);
});

it("a mouse double-click across two tables opens each", async () => {
  const { el, a, b } = await neighbours();
  tapAt(el, ...a, { pointerType: "mouse" });
  vi.advanceTimersByTime(100);
  tapAt(el, ...b, { pointerType: "mouse" });
  expect(taps).toEqual([{ tableId: "a" }]);
  vi.advanceTimersByTime(300);
  expect(taps).toEqual([{ tableId: "a" }, { tableId: "b" }]);
  expect(details).toEqual([]);
});

it("a real mouse click opens a table once", async () => {
  const el = await map([t1]);
  await userEvent.click(shapeOf(el, "t1"));
  vi.advanceTimersByTime(300);
  expect(taps).toEqual([{ tableId: "t1" }]);
});

it("a hold on a table marks it, and its release asks for details", async () => {
  const el = await map([t1]);
  down(el, 300, 150);
  vi.advanceTimersByTime(499);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
  vi.advanceTimersByTime(1);
  expect(button(el, "t1").getAttribute("data-held")).toBe("");
  expect(details).toEqual([]);
  up(el, 300, 150);
  expect(details).toEqual([{ tableId: "t1" }]);
  expect(taps).toEqual([]);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
});

it("outlines a held table in the primary colour", async () => {
  const el = await map([t1]);
  applyTokens(el);
  el.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  down(el, 300, 150);
  vi.advanceTimersByTime(500);
  const shape = getComputedStyle(shapeOf(el, "t1"));
  expect(shape.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(shape.boxShadow).toBe("rgb(1, 2, 3) 0px 0px 0px 1px inset");
});

it("rings a held table outside its edge, so a table filled in the primary colour shows it too", async () => {
  const el = await map([t("t1", "T1", { x: 10, y: 5 }, { fill: "seated" })]);
  applyTokens(el);
  el.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  down(el, 300, 150);
  vi.advanceTimersByTime(500);
  const shape = getComputedStyle(shapeOf(el, "t1"));
  expect(shape.outlineStyle).toBe("solid");
  expect(shape.outlineWidth).toBe("2px");
  expect(shape.outlineColor).toBe("rgb(1, 2, 3)");
  expect(shape.outlineOffset).toBe("2px");
});

it("a table not held has no ring", async () => {
  const el = await map([t1]);
  expect(getComputedStyle(shapeOf(el, "t1")).outlineStyle).toBe("none");
});

it("a right-click asks for details once and stops the browser's menu", async () => {
  const el = await map([t1]);
  let reachedPage = false;
  const onPage = () => (reachedPage = true);
  document.addEventListener("contextmenu", onPage);
  down(el, 300, 150, { pointerType: "mouse", button: 2 });
  const event = contextMenuOn(shapeOf(el, "t1"));
  up(el, 300, 150, { pointerType: "mouse", button: 2 });
  document.removeEventListener("contextmenu", onPage);
  expect(event.defaultPrevented).toBe(true);
  expect(details).toEqual([{ tableId: "t1" }]);
  expect(reachedPage).toBe(false);
  vi.advanceTimersByTime(300);
  expect(taps).toEqual([]);
});

it("a right-click on empty space is still kept from the browser's menu", async () => {
  const el = await map([t1]);
  const event = contextMenuOn(el.shadowRoot!.querySelector('[role="group"]')!);
  expect(event.defaultPrevented).toBe(true);
  expect(details).toEqual([]);
});

it("Shift+F10 asks for details exactly once, whether or not the platform sends a contextmenu", async () => {
  const el = await map([t1]);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  expect(details).toEqual([{ tableId: "t1" }]);
  const key = shiftF10On(button(el, "t1"));
  expect(key.defaultPrevented).toBe(true);
  expect(contextMenuOn(button(el, "t1")).defaultPrevented).toBe(true);
  expect(details).toEqual([{ tableId: "t1" }, { tableId: "t1" }]);
  // Only the one contextmenu after it is ignored.
  contextMenuOn(button(el, "t1"));
  expect(details).toHaveLength(3);
});

it("Shift+F10 off a table asks for nothing", async () => {
  const el = await map([t1]);
  const key = shiftF10On(el.shadowRoot!.querySelector('[role="group"]')!);
  expect(key.defaultPrevented).toBe(false);
  expect(details).toEqual([]);
});

it("a contextmenu on a table with nothing before it asks for details", async () => {
  const el = await map([t1]);
  contextMenuOn(button(el, "t1"));
  expect(details).toEqual([{ tableId: "t1" }]);
});

it("F10 without Shift asks for nothing", async () => {
  const el = await map([t1]);
  const key = new KeyboardEvent("keydown", {
    key: "F10",
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  button(el, "t1").dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  expect(details).toEqual([]);
});

it("a right-click after a Shift+F10 that sent no contextmenu still works", async () => {
  const el = await map([t1]);
  shiftF10On(button(el, "t1"));
  expect(details).toHaveLength(1);
  down(el, 300, 150, { pointerType: "mouse", button: 2 });
  contextMenuOn(shapeOf(el, "t1"));
  expect(details).toEqual([{ tableId: "t1" }, { tableId: "t1" }]);
});

it("the ContextMenu key after a Shift+F10 that sent no contextmenu still works", async () => {
  const el = await map([t1]);
  shiftF10On(button(el, "t1"));
  button(el, "t1").dispatchEvent(
    new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, composed: true }),
  );
  contextMenuOn(button(el, "t1"));
  expect(details).toEqual([{ tableId: "t1" }, { tableId: "t1" }]);
});

it("the ContextMenu key asks for details once", async () => {
  const el = await map([t1]);
  button(el, "t1").focus();
  await userEvent.keyboard("{ContextMenu}");
  expect(details).toEqual([{ tableId: "t1" }]);
});

it("a press on a table still reaches the page", async () => {
  const el = await map([t1]);
  const heard: string[] = [];
  const onPage = (e: Event) => heard.push(e.type);
  document.addEventListener("pointerdown", onPage);
  document.addEventListener("keydown", onPage);
  down(el, 300, 150);
  shiftF10On(button(el, "t1"));
  document.removeEventListener("pointerdown", onPage);
  document.removeEventListener("keydown", onPage);
  expect(details).toEqual([{ tableId: "t1" }]);
  expect(heard).toEqual(["pointerdown", "keydown"]);
});

it("a contextmenu during a touch hold sends nothing more", async () => {
  const el = await map([t1]);
  down(el, 300, 150);
  vi.advanceTimersByTime(400);
  expect(contextMenuOn(shapeOf(el, "t1")).defaultPrevented).toBe(true);
  expect(details).toEqual([]);
  vi.advanceTimersByTime(100);
  up(el, 300, 150);
  expect(details).toEqual([{ tableId: "t1" }]);
});

it("Enter on a focused table asks to open it", async () => {
  const el = await map([t1]);
  let clickReachedPage = false;
  const onPage = () => (clickReachedPage = true);
  document.addEventListener("click", onPage);
  button(el, "t1").focus();
  await userEvent.keyboard("{Enter}");
  document.removeEventListener("click", onPage);
  expect(taps).toEqual([{ tableId: "t1" }]);
  expect(clickReachedPage).toBe(false);
});

it("a click on empty space from the keyboard's way sends nothing", async () => {
  const el = await map([t1]);
  el.shadowRoot!.querySelector('[role="group"]')!.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, detail: 0 }),
  );
  expect(taps).toEqual([]);
});

it("a merge sends its first member's id", async () => {
  const el = await map([
    t("ten", "10", { x: 8, y: 0, width: 8, height: 8 }, { joinId: "j1" }),
    t("four", "4", { x: 0, y: 0, width: 8, height: 8 }, { joinId: "j1" }),
  ]);
  // The union 16 × 8 is drawn at left 100, top 50, 400 × 200, so "10" is its right half.
  tapAt(el, 400, 150);
  expect(taps).toEqual([{ tableId: "four" }]);
});

it("a tap on empty space sends nothing", async () => {
  const el = await map([t1]);
  tapAt(el, 20, 20, { pointerType: "mouse" });
  vi.advanceTimersByTime(100);
  tapAt(el, 20, 20, { pointerType: "mouse" });
  vi.advanceTimersByTime(300);
  down(el, 20, 20);
  vi.advanceTimersByTime(500);
  up(el, 20, 20);
  contextMenuOn(el.shadowRoot!.querySelector('[role="group"]')!);
  expect(taps).toEqual([]);
  expect(details).toEqual([]);
  tapAt(el, 300, 150);
  expect(taps).toEqual([{ tableId: "t1" }]);
});

it("a second finger during a hold cancels it", async () => {
  const el = await map([t1]);
  down(el, 300, 150);
  vi.advanceTimersByTime(500);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(true);
  down(el, 350, 150, { pointerId: 2 });
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
  pointer(window, "pointercancel", at(el, 350, 150), { pointerId: 2 });
  up(el, 300, 150);
  expect(details).toEqual([]);
  expect(taps).toEqual([]);
});

it("a click waiting for a second click is dropped when the map is removed", async () => {
  const el = await map([t1]);
  const heard: Event[] = [];
  el.addEventListener("wt-table-tap", (e) => heard.push(e));
  tapAt(el, 300, 150, { pointerType: "mouse" });
  el.remove();
  vi.advanceTimersByTime(300);
  expect(heard).toEqual([]);
});

it("a held table is unmarked when the map is removed", async () => {
  const el = await map([t1]);
  down(el, 300, 150);
  vi.advanceTimersByTime(500);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(true);
  el.remove();
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
});

it("a removed and re-added map hears each tap once", async () => {
  const el = await map([t1]);
  const parent = el.parentNode!;
  el.remove();
  parent.appendChild(el);
  await el.updateComplete;
  tapAt(el, 300, 150);
  expect(taps).toEqual([{ tableId: "t1" }]);
});

/** The middle of `id`'s button, relative to the map. */
function middleOf(el: WtFloorMap, id: string): [number, number] {
  const outer = el.getBoundingClientRect();
  const box = button(el, id).getBoundingClientRect();
  return [box.left - outer.left + box.width / 2, box.top - outer.top + box.height / 2];
}

it("a hold that drags and drops leaves no mark", async () => {
  const el = await map([t1]);
  down(el, 300, 150);
  vi.advanceTimersByTime(500);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(true);
  pointer(window, "pointermove", at(el, 320, 150), {});
  up(el, 320, 150);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
  expect(details).toEqual([]);
});

it("a second hold leaves only its own table marked", async () => {
  const el = await map([t("t1", "T1", { x: 0 }), t("t2", "T2", { x: 0, y: 6 })]);
  const [a, b] = [middleOf(el, "t1"), middleOf(el, "t2")];
  down(el, ...a);
  vi.advanceTimersByTime(500);
  pointer(window, "pointermove", at(el, a[0] + 20, a[1]), {});
  up(el, a[0] + 20, a[1]);
  down(el, ...b);
  vi.advanceTimersByTime(500);
  expect(button(el, "t2").hasAttribute("data-held")).toBe(true);
  expect(button(el, "t1").hasAttribute("data-held")).toBe(false);
});

it("holding Shift+F10 down asks for details once", async () => {
  const el = await map([t1]);
  shiftF10On(button(el, "t1"));
  const repeat = new KeyboardEvent("keydown", {
    key: "F10",
    shiftKey: true,
    repeat: true,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  button(el, "t1").dispatchEvent(repeat);
  expect(repeat.defaultPrevented).toBe(true);
  expect(details).toEqual([{ tableId: "t1" }]);
});

it("holding Shift+F10 down through the platform asks for details once", async () => {
  const el = await map([t1]);
  button(el, "t1").focus();
  await userEvent.keyboard("{Shift>}{F10>4}{/F10}{/Shift}");
  expect(details).toEqual([{ tableId: "t1" }]);
});

const repeatOf = (key: string, shiftKey = false) =>
  new KeyboardEvent("keydown", {
    key,
    shiftKey,
    repeat: true,
    bubbles: true,
    composed: true,
    cancelable: true,
  });

it("holding the ContextMenu key down keeps its repeats from the browser", async () => {
  const el = await map([t1]);
  const repeat = repeatOf("ContextMenu");
  button(el, "t1").dispatchEvent(repeat);
  expect(repeat.defaultPrevented).toBe(true);
  expect(details).toEqual([]);
});

it("a repeated key off a table is left to the browser", async () => {
  const el = await map([t1]);
  const group = el.shadowRoot!.querySelector('[role="group"]')!;
  const f10 = repeatOf("F10", true);
  const menu = repeatOf("ContextMenu");
  group.dispatchEvent(f10);
  group.dispatchEvent(menu);
  expect([f10.defaultPrevented, menu.defaultPrevented]).toEqual([false, false]);
});

it("a repeat of another key after Shift+F10 lets the next contextmenu through", async () => {
  const el = await map([t1]);
  shiftF10On(button(el, "t1"));
  const a = repeatOf("a");
  button(el, "t1").dispatchEvent(a);
  expect(a.defaultPrevented).toBe(false);
  contextMenuOn(button(el, "t1"));
  expect(details).toEqual([{ tableId: "t1" }, { tableId: "t1" }]);
});

it("a Ctrl+click on a table asks for details, not to open it", async () => {
  const el = await map([t1]);
  const ctrl = { pointerType: "mouse", ctrlKey: true };
  down(el, 300, 150, ctrl);
  contextMenuOn(shapeOf(el, "t1"));
  up(el, 300, 150, ctrl);
  vi.advanceTimersByTime(300);
  expect(details).toEqual([{ tableId: "t1" }]);
  expect(taps).toEqual([]);
});

it("a contextmenu on a removed map is still prevented", async () => {
  const el = await map([t1]);
  el.remove();
  expect(contextMenuOn(shapeOf(el, "t1")).defaultPrevented).toBe(true);
});

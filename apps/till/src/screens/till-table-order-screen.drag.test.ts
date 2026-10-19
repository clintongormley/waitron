import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import { DraftStore } from "../state/draft-sync.js";
import type { TillBasket } from "../widgets/basket.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import { beer, flan, mount, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(async () => {
  setLocale("en");
  await page.viewport(1280, 1800);
});
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale("en");
});

async function open() {
  const draft = new DraftStore();
  draft.loadFrom("draft", [
    { product: beer, quantity: "2", place: { kind: "fire" } },
    { product: flan, quantity: "1", place: { kind: "new", slot: 1 } },
    {
      product: { ...flan, id: "pie", name: "Pie" },
      quantity: "1",
      place: { kind: "new", slot: 2 },
    },
    {
      product: { ...flan, id: "cake", name: "Cake" },
      quantity: "1",
      place: { kind: "join", groupId: "g3" },
    },
  ]);
  const { el, host } = await mount({ draftStore: draft, currentOrders: current(), groups, now });
  el.style.width = "1280px";
  await resized(el);
  for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket"))
    await basket.updateComplete;
  return { el, host, draft };
}
const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
const lead = (el: TillTableOrderScreen, index: number) => q(el, `[data-draft-select="${index}"]`);
function point(target: HTMLElement) {
  const box = target.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
function pointer(target: EventTarget, type: string, at: { x: number; y: number }, id = 71) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: id,
      pointerType: "touch",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}
async function hold(target: HTMLElement) {
  const at = point(target);
  vi.useFakeTimers();
  pointer(target, "pointerdown", at);
  await vi.advanceTimersByTimeAsync(500);
  return at;
}
async function drop(el: TillTableOrderScreen, target: HTMLElement, destination: HTMLElement) {
  await hold(target);
  const at = point(destination);
  pointer(window, "pointermove", at);
  await el.updateComplete;
  pointer(window, "pointerup", at);
  vi.useRealTimers();
  await el.updateComplete;
}
const places = (draft: DraftStore) => draft.lines.map((line) => line.place);

it("Move creates a group after its joined held group beyond existing new slots", async () => {
  const { el, draft } = await open();
  const before = [...draft.lines];
  await userEvent.click(lead(el, 3));
  await el.updateComplete;
  await userEvent.click(q(el, "[data-draft-move]"));
  await el.updateComplete;
  await userEvent.click(q(el, '[data-draft-move-to="new"]'));
  await el.updateComplete;
  expect(places(draft)).toEqual([
    { kind: "fire" },
    { kind: "new", slot: 1 },
    { kind: "new", slot: 2 },
    { kind: "new", slot: 3, afterGroupId: "g3" },
  ]);
  expect(draft.lines.every((line, index) => line === before[index])).toBe(true);
  expect(draft.lines.map((line) => [line.product.name, line.quantity])).toEqual([
    ["Beer", "2"],
    ["Flan", "1"],
    ["Pie", "1"],
    ["Cake", "1"],
  ]);
});

it("a held row shows that it is ready to drag before moving", async () => {
  const { el } = await open();
  const control = lead(el, 0);
  const at = await hold(control);
  await el.updateComplete;
  expect(control.hasAttribute("data-draft-dragging")).toBe(true);
  pointer(window, "pointercancel", at);
});

it("a new heading's keyboard menu moves its entire group with no change to quantities", async () => {
  const { el, draft } = await open();
  draft.setLinePlaces([0], { kind: "new", slot: 1 });
  await el.updateComplete;
  const more = q(el, '[data-draft-group-more="new:1"]') as WtRowActions;
  expect(more).not.toBeNull();
  await more.updateComplete;
  more.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
  await userEvent.keyboard("{Enter}");
  expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  const later = more.querySelector<HTMLElement>("[data-draft-later]")!;
  later.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
  await userEvent.keyboard("{Enter}");
  expect(places(draft)).toEqual([
    { kind: "new", slot: 2 },
    { kind: "new", slot: 2 },
    { kind: "new", slot: 1 },
    { kind: "join", groupId: "g3" },
  ]);
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "1", "1"]);
});

it.each(["api", "revision", "changed-draft", "busy", "locked", "bill", "visit"] as const)(
  "an open group menu refuses a stale %s action",
  async (change) => {
    const { el, draft } = await open();
    const more = q(el, '[data-draft-group-more="new:1"]') as WtRowActions;
    await more.updateComplete;
    await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
    const later = more.querySelector<HTMLElement>("[data-draft-later]")!;
    expect(later).not.toBeNull();
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "revision") el.currentOrders = { ...current(), revision: 8 };
    if (change === "changed-draft") draft.setLineQuantity(0, "3");
    if (change === "busy") el.busy = true;
    if (change === "locked") draft.lockEdits();
    if (change === "bill") el.orderId = "other";
    if (change === "visit") el.serviceVisit++;
    later.click();
    expect(draft.lines[1]!.place).toEqual({ kind: "new", slot: 1 });
    expect(draft.lines[2]!.place).toEqual({ kind: "new", slot: 2 });
  },
);

it("an identical service refresh leaves the group's menu usable", async () => {
  const { el, draft } = await open();
  const more = q(el, '[data-draft-group-more="new:2"]') as WtRowActions;
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  el.currentOrders = structuredClone(current());
  el.groups = structuredClone(groups);
  await el.updateComplete;
  expect(more.isConnected).toBe(true);
  await userEvent.click(more.querySelector<HTMLElement>("[data-draft-earlier]")!);
  expect(draft.lines[2]!.place).toEqual({ kind: "new", slot: 1 });
});

it("a row can be dropped back into Fire now", async () => {
  const { el, draft } = await open();
  await drop(el, lead(el, 1), q(el, '[data-draft-group="fire"] h3'));
  expect(draft.lines[1]!.place).toEqual({ kind: "fire" });
  expect(draft.lines[2]!.place).toEqual({ kind: "new", slot: 2 });
});

it("a drop on another mounted table cannot move this bill's draft", async () => {
  const { el, draft } = await open();
  const other = await open();
  other.el.style.position = "fixed";
  other.el.style.inset = "0 auto auto 0";
  other.el.style.width = "500px";
  other.el.style.zIndex = "10";
  await resized(other.el);
  const review = q(other.el, "[data-review-open]");
  if (review?.checkVisibility()) await userEvent.click(review);
  await other.el.updateComplete;
  await drop(el, lead(el, 0), q(other.el, '[data-draft-group="new:2"] h3'));
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
  expect(other.draft.lines[0]!.place).toEqual({ kind: "fire" });
});

it("a short swipe scrolls the nearest draft ancestor without selecting, opening or moving", async () => {
  const { el, host, draft } = await open();
  host.style.height = "220px";
  host.style.overflowY = "auto";
  const target = lead(el, 0);
  const at = point(target);
  pointer(target, "pointerdown", at);
  pointer(window, "pointermove", { x: at.x, y: at.y - 60 });
  pointer(window, "pointerup", { x: at.x, y: at.y - 60 });
  expect(host.scrollTop).toBeGreaterThan(0);
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
  target.click();
  await el.updateComplete;
  expect(target.getAttribute("aria-pressed")).toBe("false");
  await userEvent.click(lead(el, 1));
  expect(lead(el, 1).getAttribute("aria-pressed")).toBe("true");
});

it.each(["busy", "sending", "locked"] as const)(
  "a short swipe still scrolls when the draft is %s",
  async (blocked) => {
    const { el, host, draft } = await open();
    host.style.height = "220px";
    host.style.overflowY = "auto";
    const control = lead(el, 0);
    const at = point(control);
    if (blocked === "busy") el.busy = true;
    if (blocked === "sending") draft.sending = true;
    if (blocked === "locked") draft.lockEdits();
    pointer(control, "pointerdown", at);
    pointer(window, "pointermove", { x: at.x, y: at.y - 60 });
    pointer(window, "pointerup", { x: at.x, y: at.y - 60 });
    expect(host.scrollTop).toBeGreaterThan(0);
    expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
  },
);

// Removing the hold/drop wiring leaves the original fire/new placement instead of the literal destination.
it("a held row moved into another new group changes only that row's saved place", async () => {
  const { el, draft } = await open();
  await drop(el, lead(el, 0), q(el, '[data-draft-group="new:2"] h3'));
  expect(places(draft)).toEqual([
    { kind: "new", slot: 2 },
    { kind: "new", slot: 1 },
    { kind: "new", slot: 2 },
    { kind: "join", groupId: "g3" },
  ]);
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "1", "1"]);
});

it("dragging a selected row moves all selected rows and keeps their identities", async () => {
  const { el, draft } = await open();
  const originals = [...draft.lines];
  await userEvent.click(lead(el, 0));
  await userEvent.click(lead(el, 1));
  await drop(el, lead(el, 0), q(el, '[data-draft-group="join:g3"] h3'));
  expect(places(draft)).toEqual([
    { kind: "join", groupId: "g3" },
    { kind: "join", groupId: "g3" },
    { kind: "new", slot: 2 },
    { kind: "join", groupId: "g3" },
  ]);
  expect(draft.lines.every((line, i) => line === originals[i])).toBe(true);
});

it("dragging an unselected row leaves the selected row where it was", async () => {
  const { el, draft } = await open();
  await userEvent.click(lead(el, 1));
  await drop(el, lead(el, 0), q(el, '[data-draft-group="join:g3"] h3'));
  expect(draft.lines[0]!.place).toEqual({ kind: "join", groupId: "g3" });
  expect(draft.lines[1]!.place).toEqual({ kind: "new", slot: 1 });
});

it("a group gap inserts a nonempty group there and shifts the later slots", async () => {
  const { el, draft } = await open();
  const gap = q(el, '[data-draft-gap="new:2"]');
  expect(gap).not.toBeNull();
  await drop(el, lead(el, 0), gap);
  expect(places(draft)).toEqual([
    { kind: "new", slot: 2 },
    { kind: "new", slot: 1 },
    { kind: "new", slot: 3 },
    { kind: "join", groupId: "g3" },
  ]);
});

it("a gap after a join preserves its held anchor on the new group", async () => {
  const { el, draft } = await open();
  const gap = q(el, '[data-draft-gap="end"]');
  expect(gap).not.toBeNull();
  await drop(el, lead(el, 0), gap);
  expect(draft.lines[0]!.place).toEqual({ kind: "new", slot: 3, afterGroupId: "g3" });
});

it("holding a new heading and dropping after another reorders its entire slot", async () => {
  const { el, draft } = await open();
  const source = q(el, '[data-draft-group="new:1"] h3');
  const target = q(el, '[data-draft-group="new:2"] h3');
  await hold(source);
  const box = target.getBoundingClientRect();
  const at = { x: box.x + box.width / 2, y: box.bottom - 2 };
  pointer(window, "pointermove", at);
  pointer(window, "pointerup", at);
  vi.useRealTimers();
  await el.updateComplete;
  expect(draft.lines[1]!.place).toEqual({ kind: "new", slot: 2 });
  expect(draft.lines[2]!.place).toEqual({ kind: "new", slot: 1 });
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
});

it.each(["first", "last"] as const)(
  "a new heading dropped on the %s gap moves its whole group without empty slots",
  async (destination) => {
    const { el, draft } = await open();
    draft.setLinePlaces([0], { kind: "new", slot: destination === "first" ? 2 : 1 });
    await el.updateComplete;
    const source = destination === "first" ? "new:2" : "new:1";
    const gap = destination === "first" ? "new:1" : "end";
    await drop(el, q(el, `[data-draft-group="${source}"] h3`), q(el, `[data-draft-gap="${gap}"]`));
    expect(places(draft)).toEqual([
      { kind: "new", slot: destination === "first" ? 1 : 2 },
      { kind: "new", slot: 2 },
      { kind: "new", slot: 1 },
      { kind: "join", groupId: "g3" },
    ]);
    expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "1", "1"]);
  },
);

it("a row dropped on the first gap inserts before the first held group when Fire now is empty", async () => {
  const { el, draft } = await open();
  draft.setLinePlaces([0], { kind: "new", slot: 2 });
  await el.updateComplete;
  await drop(el, lead(el, 3), q(el, '[data-draft-gap="new:1"]'));
  expect(places(draft)).toEqual([
    { kind: "new", slot: 3 },
    { kind: "new", slot: 2 },
    { kind: "new", slot: 3 },
    { kind: "new", slot: 1 },
  ]);
  expect(draft.lines.map((line) => line.quantity)).toEqual(["2", "1", "1", "1"]);
});

it("a row dropped directly on a sent held group joins it without sending the draft", async () => {
  const { el, draft } = await open();
  const sends = vi.fn();
  el.addEventListener("submit-draft", sends);
  const panel = q(el, "till-sent-orders") as TillSentOrders;
  await panel.updateComplete;
  const toggle = panel.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!;
  if (toggle.getAttribute("aria-expanded") === "false") {
    await userEvent.click(toggle);
    await panel.updateComplete;
  }
  await drop(
    el,
    lead(el, 0),
    panel.shadowRoot!.querySelector<HTMLElement>('[data-held-group="g4"] .heading')!,
  );
  expect(places(draft)).toEqual([
    { kind: "join", groupId: "g4" },
    { kind: "new", slot: 1 },
    { kind: "new", slot: 2 },
    { kind: "join", groupId: "g3" },
  ]);
  expect(sends).not.toHaveBeenCalled();
});

it("a stationary hold opens the existing line editor and does not select or move it", async () => {
  const { el, draft } = await open();
  const target = lead(el, 0);
  const at = await hold(target);
  pointer(window, "pointerup", at);
  vi.useRealTimers();
  await el.updateComplete;
  const basket = [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find((basket) =>
    basket.lineIndexes?.includes(0),
  )!;
  await basket.updateComplete;
  const picker = basket.shadowRoot!.querySelector<HTMLElement>("till-modifier-picker")!;
  expect(picker).not.toBeNull();
  await (picker as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(picker.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Beer");
  target.click();
  await el.updateComplete;
  expect(target.getAttribute("aria-pressed")).toBe("false");
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
});

it("a short native tap still selects once and never moves or opens details", async () => {
  const { el, draft } = await open();
  await userEvent.click(lead(el, 0));
  expect(lead(el, 0).getAttribute("aria-pressed")).toBe("true");
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
  for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket"))
    expect(basket.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
});

it.each(["cancel", "second-pointer", "escape", "outside", "short-pan"] as const)(
  "%s ends a row gesture without moving it or sending an order",
  async (end) => {
    const { el, draft } = await open();
    const sends = vi.fn();
    el.addEventListener("submit-draft", sends);
    const start = await hold(lead(el, 0));
    if (end === "cancel") pointer(window, "pointercancel", start);
    if (end === "second-pointer") pointer(lead(el, 0), "pointerdown", start, 72);
    if (end === "escape")
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
      );
    const at =
      end === "outside" ? { x: -100, y: -100 } : point(q(el, '[data-draft-group="new:2"] h3'));
    if (end === "short-pan") {
      pointer(window, "pointercancel", start);
      pointer(lead(el, 0), "pointerdown", start);
    }
    pointer(window, "pointermove", at);
    pointer(window, "pointerup", at);
    pointer(window, "pointerup", at, 72);
    vi.useRealTimers();
    expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
    expect(sends).not.toHaveBeenCalled();
  },
);

it.each([
  "busy",
  "command",
  "lock",
  "sending",
  "api",
  "bill",
  "visit",
  "revision",
  "fired",
  "store",
  "line",
  "disconnected",
  "ownership",
  "bill-status",
  "unread",
  "party",
] as const)("a held drag cannot apply after %s changes, before a render", async (change) => {
  const { el, draft } = await open();
  const target = point(q(el, '[data-draft-group="new:2"] h3'));
  await hold(lead(el, 0));
  pointer(window, "pointermove", target);
  if (change === "busy") el.busy = true;
  if (change === "command") el.groupCommandBusy = true;
  if (change === "lock") draft.lockEdits();
  if (change === "ownership") draft.ownershipLocked = true;
  if (change === "bill-status") draft.billStatus = "settled";
  if (change === "unread") el.currentOrdersUnread = true;
  if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
  if (change === "sending") draft.sending = true;
  if (change === "api") el.api = {} as TillTableOrderScreen["api"];
  if (change === "bill") el.orderId = "other";
  if (change === "visit") el.serviceVisit++;
  if (change === "revision") el.currentOrders = { ...current(), revision: 8 };
  if (change === "fired")
    el.groups = groups.map((g) => (g.id === "g3" ? { ...g, state: "fired" } : g));
  if (change === "store") el.draftStore = new DraftStore();
  if (change === "line") draft.setLineQuantity(0, "3");
  if (change === "disconnected") el.remove();
  pointer(window, "pointerup", target);
  vi.useRealTimers();
  expect(draft.lines[0]!.place).toEqual({ kind: "fire" });
});

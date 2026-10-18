import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import type { CurrentOrders } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import {
  current,
  currentGroup,
  now,
  row,
} from "../screens/till-table-order-screen.current-orders.test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillSentOrders } from "./sent-orders.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

function data(): CurrentOrders {
  const orders = structuredClone(current());
  const first = orders.groups.find((group) => group.id === "g3")!;
  const last = orders.groups.find((group) => group.id === "g4")!;
  first.position = 10;
  first.displayNumber = 30;
  last.position = 30;
  last.displayNumber = 4;
  orders.groups = [
    last,
    currentGroup("other-bill", 20, "held", [
      row("other-food", "Other bill's dessert", "1.000", {
        workingOrderId: "other",
        released: false,
      }),
    ]),
    ...orders.groups.filter((group) => group.id !== "g4"),
  ];
  return orders;
}
async function mount() {
  const mounted = await mountWidget<TillSentOrders>("till-sent-orders", {
    scope: "visit",
    billId: "wo-4",
    now,
    snapshot: { scope: "visit", billId: "wo-4", current: data() },
  });
  await userEvent.click(mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-held-toggle]")!);
  await mounted.el.updateComplete;
  return mounted.el;
}
const q = (el: TillSentOrders, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
function collect(el: TillSentOrders, name = "reorder-held") {
  const events: CustomEvent[] = [];
  el.addEventListener(name, (event) => events.push(event as CustomEvent));
  return events;
}
async function menu(el: TillSentOrders, id: string) {
  const more = q(el, `[data-group-more="${id}"]`) as WtRowActions;
  expect(more).not.toBeNull();
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  return more;
}

it.each([
  ["g3", "later", ["other-bill", "g3", "g4"]],
  ["g4", "earlier", ["g3", "g4", "other-bill"]],
] as const)(
  "the native %s heading menu moves it %s through every bill's held groups",
  async (id, direction, want) => {
    const el = await mount();
    const events = collect(el);
    const more = await menu(el, id);
    const button = more.querySelector<HTMLElement>(`[data-group-${direction}]`)!;
    expect(button).not.toBeNull();
    await userEvent.click(button);
    expect(events.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [
        {
          heldGroupIds: want,
          expected: {
            scope: "visit",
            billId: "wo-4",
            revision: 7,
            ids: ["g3", "other-bill", "g4"],
          },
        },
        true,
        true,
      ],
    ]);
    expect(q(el, '[data-held-group="g3"] h4').textContent).toContain("Group 30");
    expect(q(el, '[data-held-group="g4"] h4').textContent).toContain("Group 4");
    expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  },
);

it("the first/last headings offer only the direction that can move, with no arrow strip", async () => {
  const el = await mount();
  expect(q(el, '[data-group-more="g3"] [data-group-earlier]')).toBeNull();
  expect(q(el, '[data-group-more="g4"] [data-group-later]')).toBeNull();
  expect(q(el, "[data-group-up], [data-group-down]")).toBeNull();
  const more = await menu(el, "g3");
  expect(more.querySelectorAll("wt-button")).toHaveLength(1);
});

it.each([
  "busy",
  "scope",
  "bill",
  "revision",
  "fired",
  "removed",
  "inserted",
  "reordered",
  "unread",
  "disconnected",
] as const)(
  "a retained heading action sends nothing after %s changes, even before rendering",
  async (change) => {
    const el = await mount();
    const events = collect(el);
    const more = await menu(el, "g3");
    const button = more.querySelector<HTMLElement>("[data-group-later]")!;
    expect(button).not.toBeNull();
    if (change === "busy") el.busy = true;
    else if (change === "scope") el.scope = "another-visit";
    else if (change === "bill") el.billId = "another-bill";
    else if (change === "unread") el.snapshot = null;
    else if (change === "disconnected") el.remove();
    else {
      const orders = data();
      if (change === "revision") orders.revision++;
      if (change === "fired") orders.groups.find((group) => group.id === "g3")!.state = "fired";
      if (change === "removed")
        orders.groups = orders.groups.filter((group) => group.id !== "other-bill");
      if (change === "inserted") orders.groups.push(currentGroup("new", 15, "held", []));
      if (change === "reordered")
        orders.groups.find((group) => group.id === "other-bill")!.position = 5;
      el.snapshot = { scope: "visit", billId: "wo-4", current: orders };
    }
    button.click();
    expect(events).toEqual([]);
  },
);

it("unchanged passive refresh keeps an open heading menu usable", async () => {
  const el = await mount();
  const events = collect(el);
  const more = await menu(el, "g3");
  el.snapshot = { scope: "visit", billId: "wo-4", current: data() };
  await el.updateComplete;
  expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  await userEvent.click(more.querySelector<HTMLElement>("[data-group-later]")!);
  expect(events.map((event) => event.detail.heldGroupIds)).toEqual([["other-bill", "g3", "g4"]]);
});

it("a changed service read closes the old menu before it can target a different group", async () => {
  const el = await mount();
  const events = collect(el);
  const more = await menu(el, "g3");
  const oldButton = more.querySelector<HTMLElement>("[data-group-later]")!;
  const orders = data();
  orders.revision++;
  orders.groups.find((group) => group.id === "g4")!.position = 5;
  el.snapshot = { scope: "visit", billId: "wo-4", current: orders };
  await el.updateComplete;
  expect(more.isConnected).toBe(false);
  oldButton.click();
  expect(events).toEqual([]);
  const headings = [...el.shadowRoot!.querySelectorAll("[data-held-group] h4")].map((heading) =>
    heading.textContent!.trim(),
  );
  expect(headings).toEqual(["Group 4", "Group 30"]);
  await menu(el, "g3");
  await userEvent.click(q(el, '[data-group-more="g3"] [data-group-earlier]'));
  expect(events.map((event) => event.detail.heldGroupIds)).toEqual([["g3", "g4", "other-bill"]]);
});

it("one held group has no empty More menu", async () => {
  const el = await mount();
  const orders = data();
  orders.groups = orders.groups.filter((group) => group.id === "g3");
  el.snapshot = { scope: "visit", billId: "wo-4", current: orders };
  await el.updateComplete;
  expect(q(el, "[data-group-more]")).toBeNull();
  expect(q(el, '[data-group-fire="g3"]')).not.toBeNull();
});

it("only the heading reserves touch dragging; the fold controls retain native scrolling", async () => {
  const el = await mount();
  const heading = q(el, '[data-group-drag="g3"]');
  expect(getComputedStyle(heading).touchAction).toBe("none");
  expect(getComputedStyle(heading).userSelect).toBe("none");
  expect(heading.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(getComputedStyle(q(el, "[data-held-toggle]")).touchAction).toBe("auto");
  expect(getComputedStyle(q(el, "[data-sent-toggle]")).touchAction).toBe("auto");
});

function pointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 91,
      pointerType: "touch",
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}
const center = (el: Element) => {
  const rect = el.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};
async function hold(el: TillSentOrders, id = "g3") {
  const heading = q(el, `[data-group-drag="${id}"]`);
  expect(heading).not.toBeNull();
  const start = center(heading);
  pointer(heading, "pointerdown", start.x, start.y);
  await new Promise((resolve) => setTimeout(resolve, 550));
  return start;
}

it("a 500ms hold and drag moves a held heading after its target without renumbering", async () => {
  const el = await mount();
  const events = collect(el);
  const activity = collect(el, "pointerdown");
  await hold(el);
  const target = q(el, '[data-group-drag="g4"]');
  const rect = target.getBoundingClientRect();
  const end = { x: rect.x + rect.width / 2, y: rect.bottom - 1 };
  pointer(window, "pointermove", end.x, end.y);
  await el.updateComplete;
  expect(q(el, '[data-held-group="g3"]').hasAttribute("data-dragging")).toBe(true);
  pointer(window, "pointerup", end.x, end.y);
  await el.updateComplete;
  expect(events.map((event) => event.detail.heldGroupIds)).toEqual([["other-bill", "g4", "g3"]]);
  expect(activity).toHaveLength(1);
  expect(q(el, '[data-held-group="g3"]').hasAttribute("data-dragging")).toBe(false);
  expect(q(el, '[data-held-group="g3"] h4').textContent).toContain("Group 30");
});

it("a held heading drops before another heading after an unchanged passive read", async () => {
  const el = await mount();
  const events = collect(el);
  await hold(el, "g4");
  el.snapshot = { scope: "visit", billId: "wo-4", current: data() };
  await el.updateComplete;
  const rect = q(el, '[data-group-drag="g3"]').getBoundingClientRect();
  pointer(window, "pointermove", rect.x + rect.width / 2, rect.top + 1);
  pointer(window, "pointerup", rect.x + rect.width / 2, rect.top + 1);
  expect(events.map((event) => event.detail.heldGroupIds)).toEqual([["g4", "g3", "other-bill"]]);
});

it.each(["held", "fired", "served"] as const)(
  "a sent %s row cannot drag a group or serve on release",
  async (kind) => {
    const el = await mount();
    if (kind === "served") {
      await userEvent.click(q(el, "[data-served-toggle]"));
      await el.updateComplete;
    }
    const line = q(el, `[data-${kind}-line="${kind === "held" ? "l-flan" : "l-croq"}"] .dish`);
    const reorder = collect(el);
    const serve = collect(el, "serve-lines");
    const info = collect(el, "sent-line-info");
    const start = center(line);
    pointer(line, "pointerdown", start.x, start.y);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const end = center(q(el, '[data-group-drag="g4"]'));
    pointer(window, "pointermove", end.x, end.y);
    pointer(window, "pointerup", end.x, end.y);
    line.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
    expect([reorder, serve, info]).toEqual([[], [], []]);
  },
);

it.each([
  [false, false],
  [true, false],
  [true, true],
])("a heading swipe scrolls across a shadow boundary %s while busy %s", async (shadow, busy) => {
  const el = await mount();
  el.busy = busy;
  await el.updateComplete;
  const host = el.parentElement!;
  const wrapper = document.createElement("div");
  host.append(wrapper);
  const parent = shadow ? wrapper.attachShadow({ mode: "open" }) : wrapper;
  const scroll = document.createElement("div");
  scroll.style.cssText = "height: 160px; overflow-y: auto";
  parent.append(scroll);
  scroll.append(el);
  await el.updateComplete;
  await userEvent.click(q(el, "[data-held-toggle]"));
  await el.updateComplete;
  const heading = q(el, '[data-group-drag="g3"]');
  heading.scrollIntoView({ block: "center" });
  const before = scroll.scrollTop;
  expect(before).toBeGreaterThan(0);
  const start = center(heading);
  const events = collect(el);
  pointer(heading, "pointerdown", start.x, start.y);
  pointer(window, "pointermove", start.x, start.y - 12);
  pointer(window, "pointermove", start.x, start.y - 32);
  pointer(window, "pointerup", start.x, start.y - 32);
  expect(scroll.scrollTop).toBe(before + 32);
  expect(events).toEqual([]);
  const next = center(q(el, '[data-group-fire="g3"]'));
  pointer(q(el, '[data-group-fire="g3"]'), "pointerdown", next.x, next.y);
  pointer(window, "pointermove", next.x, next.y - 12);
  pointer(window, "pointerup", next.x, next.y - 12);
  expect(scroll.scrollTop).toBe(before + 32);
});

it.each([
  "short",
  "scroll",
  "cancel",
  "second-pointer",
  "revision",
  "busy",
  "outside",
  "same-position",
] as const)("%s does not reorder held headings", async (change) => {
  const el = await mount();
  const events = collect(el);
  let start: { x: number; y: number };
  if (change === "short" || change === "scroll") {
    const heading = q(el, '[data-group-drag="g3"]');
    expect(heading).not.toBeNull();
    start = center(heading);
    pointer(heading, "pointerdown", start.x, start.y);
  } else start = await hold(el);
  const target = center(q(el, '[data-group-drag="g4"]'));
  if (change === "revision")
    el.snapshot = { scope: "visit", billId: "wo-4", current: { ...data(), revision: 8 } };
  if (change === "busy") el.busy = true;
  if (change === "second-pointer")
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        pointerId: 92,
        pointerType: "touch",
        button: 0,
        clientX: start.x,
        clientY: start.y,
      }),
    );
  const end =
    change === "outside" ? { x: -20, y: -20 } : change === "same-position" ? start : target;
  pointer(window, "pointermove", end.x, end.y);
  pointer(window, change === "cancel" ? "pointercancel" : "pointerup", end.x, end.y);
  expect(events).toEqual([]);
});

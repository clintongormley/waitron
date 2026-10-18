import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { CurrentOrderGroup, CurrentOrderRow, CurrentOrders } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./sent-orders.js";

type Panel = LitElement & {
  scope: string;
  billId: string;
  snapshot: { scope: string; billId: string; current: CurrentOrders } | null;
  busy: boolean;
  now: number;
  billLabels: ReadonlyMap<string, string>;
};
const now = Date.parse("2026-10-18T12:00:00Z");
const at = (minute: number) => `2026-10-18T11:${String(minute).padStart(2, "0")}:00Z`;
const row = (id: string, over: Partial<CurrentOrderRow> = {}): CurrentOrderRow => ({
  lineId: id,
  workingOrderId: "b1",
  billStatus: "open",
  lineNo: 1,
  courseId: null,
  name: id,
  quantity: "1.000",
  netAmount: "3.00",
  unitPrecision: 0,
  servedQuantity: "0.000",
  servedAt: null,
  released: true,
  readyAt: null,
  firedAt: at(40),
  kitchen: null,
  note: null,
  extras: [],
  ...over,
});
const group = (
  id: string,
  rows: CurrentOrderRow[],
  over: Partial<CurrentOrderGroup> = {},
): CurrentOrderGroup => ({
  id,
  position: 1,
  displayNumber: 7,
  numberPartyId: "p1",
  state: "held",
  firedAt: null,
  remindAt: null,
  sentAt: at(30),
  sentBy: "Ana",
  rows,
  ...over,
});
const current = (
  rows: CurrentOrderRow[] = [],
  groups: CurrentOrderGroup[] = [],
): CurrentOrders => ({
  revision: 4,
  hasGroups: groups.length > 0,
  nextDisplayNumber: 8,
  retainedCourses: [],
  reminder: null,
  groups,
  ungrouped: rows,
});
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(data: CurrentOrders, over: Partial<Panel> = {}) {
  return (
    await mountWidget<Panel>("till-sent-orders", {
      scope: "visit-1",
      billId: "b1",
      snapshot: { scope: "visit-1", billId: "b1", current: data },
      now,
      busy: false,
      billLabels: new Map([["b2", "Patio guests"]]),
      ...over,
    })
  ).el;
}
const root = (el: Panel) => el.shadowRoot!;
const find = (el: Panel, selector: string) => root(el).querySelector<HTMLElement>(selector)!;
async function click(el: Panel, selector: string) {
  await userEvent.click(page.elementLocator(find(el, selector)));
  await el.updateComplete;
}
const open = (el: Panel) => find(el, "[data-sent-toggle]").getAttribute("aria-expanded");
function collect(el: Panel, name: string) {
  const calls: unknown[] = [];
  el.addEventListener(name, (event) => calls.push((event as CustomEvent).detail));
  return calls;
}

it("stays absent until this bill has sent food in the current visit's snapshot", async () => {
  const el = await mount(current([row("other", { workingOrderId: "b2" })]));
  expect(root(el).querySelector("[data-sent-panel]")).toBeNull();
  el.snapshot = { scope: "old-visit", billId: "b1", current: current([row("stale")]) };
  await el.updateComplete;
  expect(root(el).querySelector("[data-sent-panel]")).toBeNull();
  el.snapshot = { scope: "visit-1", billId: "b1", current: current([row("Bravas")]) };
  await el.updateComplete;
  expect(find(el, "[data-sent-toggle]").textContent).toContain("Sent");
  expect(open(el)).toBe("false");
});

it("opens on first ready read with Served and Held folded, Fired open and ready oldest first", async () => {
  const el = await mount(
    current(
      [
        row("waiting", { firedAt: at(10) }),
        row("ready-new", { readyAt: at(55) }),
        row("served", { servedQuantity: "1.000", servedAt: at(59) }),
        row("ready-old", { readyAt: at(50) }),
      ],
      [group("g", [row("held", { released: false })])],
    ),
  );
  expect(root(el).querySelector("[data-sent-panel]")).toBeTruthy();
  expect(open(el)).toBe("true");
  expect(
    [...root(el).querySelectorAll("[data-fired-line]")].map((node) =>
      node.getAttribute("data-fired-line"),
    ),
  ).toEqual(["ready-old", "ready-new", "waiting"]);
  expect(root(el).querySelector("[data-served-line]")).toBeNull();
  expect(root(el).querySelector("[data-held-line]")).toBeNull();
  expect(find(el, "[data-served-toggle]").textContent).toContain("3.00");
  await click(el, "[data-served-toggle]");
  expect(find(el, "[data-served-line=served]").textContent).toContain("3.00");
  await click(el, "[data-held-toggle]");
  expect(find(el, "[data-held-line=held]").textContent).toContain("3.00");
});

it("pulses for a passive ready read without opening or resetting a waiter's folds", async () => {
  const el = await mount(current([row("Bravas")]));
  expect(open(el)).toBe("false");
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([row("Bravas", { readyAt: at(59) })]),
  };
  await el.updateComplete;
  expect(open(el)).toBe("false");
  expect(find(el, "[data-sent-attention]").textContent).toContain("!");
  await click(el, "[data-sent-toggle]");
  await click(el, "[data-sent-toggle]");
  el.snapshot = { ...el.snapshot, current: { ...el.snapshot.current, revision: 5 } };
  await el.updateComplete;
  expect(open(el)).toBe("false");
});

it("starts fresh for another bill or visit and ignores late data from the previous one", async () => {
  const data = current([row("Bravas", { readyAt: at(59) })]);
  const el = await mount(data);
  await click(el, "[data-sent-toggle]");
  el.scope = "visit-2";
  await el.updateComplete;
  expect(root(el).querySelector("[data-sent-panel]")).toBeNull();
  el.snapshot = { scope: "visit-2", billId: "b2", current: data };
  await el.updateComplete;
  expect(root(el).querySelector("[data-sent-panel]")).toBeNull();
  el.snapshot = { scope: "visit-2", billId: "b1", current: data };
  await el.updateComplete;
  expect(open(el)).toBe("true");
});

it("serves the active remainder on a native row tap with no quantity question or held/cancelled food", async () => {
  const el = await mount(
    current([
      row("Bravas", {
        quantity: "4.000",
        servedQuantity: "1.000",
        cancelledQuantity: "1.000",
        readyAt: at(59),
        netAmount: "12.00",
      }),
    ]),
  );
  const calls = collect(el, "serve-lines");
  await click(el, "[data-serve-line=Bravas]");
  expect(calls).toEqual([{ items: [{ lineId: "Bravas", quantity: "2" }] }]);
  expect(root(el).querySelector("[data-serve-dialog]")).toBeNull();
  expect(root(el).querySelector("input[type=checkbox]")).toBeNull();
});

it("All served sends every displayed active fired remainder in one command, including paid/no-station work", async () => {
  const el = await mount(
    current(
      [
        row("Bravas", { quantity: "3.000", servedQuantity: "1.000", readyAt: at(59) }),
        row("Water", { billStatus: "settled", quantity: "0.750", unitPrecision: 3 }),
        row("Cancelled", { cancelledQuantity: "1.000" }),
        row("Other bill", { workingOrderId: "b2" }),
      ],
      [group("g", [row("Held", { released: false })])],
    ),
  );
  const calls = collect(el, "serve-lines");
  await click(el, "[data-serve-all]");
  expect(calls).toEqual([
    {
      items: [
        { lineId: "Bravas", quantity: "2" },
        { lineId: "Water", quantity: "0.75" },
      ],
    },
  ]);
});

it("opens line information without serving and refuses detached, busy or superseded row commands", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  await click(el, "[data-sent-info=Bravas]");
  expect(serves).toEqual([]);
  expect(details).toEqual([{ lineId: "Bravas", workingOrderId: "b1", kind: "fired" }]);
  const old = find(el, "[data-serve-line=Bravas]");
  el.busy = true;
  old.click();
  expect(serves).toEqual([]);
  el.busy = false;
  el.snapshot = { scope: "old", billId: "b1", current: current([row("Bravas")]) };
  old.click();
  expect(serves).toEqual([]);
  el.remove();
  old.click();
  expect(serves).toEqual([]);
});

it("labels companions by bill without a price or line action, and fires the whole held group", async () => {
  const data = current(
    [],
    [
      group("g", [
        row("own", { released: false, billStatus: "settled", netAmount: "9.50" }),
        row("guest", { workingOrderId: "b2", released: false, netAmount: "888.88" }),
      ]),
    ],
  );
  const el = await mount(data);
  await click(el, "[data-sent-toggle]");
  await click(el, "[data-held-toggle]");
  const companion = find(el, "[data-companion=guest]");
  expect(companion.textContent).toContain("Patio guests");
  expect(companion.textContent).not.toContain("888.88");
  expect(companion.querySelector("wt-button")).toBeNull();
  const calls = collect(el, "fire-group");
  await click(el, "[data-group-fire=g]");
  expect(calls).toEqual([{ groupId: "g" }]);
});

it("uses only the supplied reminder to show due/snooze/fire while collapsed", async () => {
  const data = current([], [group("g", [row("held", { released: false })])]);
  data.reminder = { groupId: "g", dueAt: new Date(now).toISOString() };
  const el = await mount(data);
  expect(open(el)).toBe("true");
  await click(el, "[data-sent-toggle]");
  const snoozes = collect(el, "snooze-group");
  const fires = collect(el, "fire-group");
  await click(el, "[data-reminder-snooze]");
  expect(snoozes).toEqual([{ groupId: "g", minutes: 5 }]);
  await click(el, "[data-reminder-fire]");
  expect(fires).toEqual([{ groupId: "g" }]);
  data.reminder = null;
  el.snapshot = { scope: "visit-1", billId: "b1", current: { ...data } };
  await el.updateComplete;
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  expect(root(el).querySelector("[data-sent-attention]")).toBeNull();
});

it("keeps ready updates from moving a pressed row and then restores ready-first ordering", async () => {
  const el = await mount(current([row("first", { readyAt: at(59) }), row("second")]));
  const pressed = find(el, "[data-serve-line=first]");
  pressed.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1 }),
  );
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([row("first"), row("second", { readyAt: at(58) })]),
  };
  await el.updateComplete;
  expect(
    [...root(el).querySelectorAll("[data-fired-line]")].map((node) =>
      node.getAttribute("data-fired-line"),
    ),
  ).toEqual(["first", "second"]);
  expect(find(el, "[data-serve-line=first]")).toBe(pressed);
  pressed.dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1 }),
  );
  await el.updateComplete;
  expect(
    [...root(el).querySelectorAll("[data-fired-line]")].map((node) =>
      node.getAttribute("data-fired-line"),
    ),
  ).toEqual(["second", "first"]);
});

it("refuses an old row or All served control after the displayed quantities change", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const oldRow = find(el, "[data-serve-line=Bravas]");
  const oldAll = find(el, "[data-serve-all]");
  const calls = collect(el, "serve-lines");
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([row("Bravas", { quantity: "2.000", readyAt: at(59) })]),
  };
  oldRow.click();
  oldAll.click();
  expect(calls).toEqual([]);
  await el.updateComplete;
  await click(el, "[data-serve-all]");
  expect(calls).toEqual([{ items: [{ lineId: "Bravas", quantity: "2" }] }]);
});

it("names courses in course order while group numbers survive mutable firing positions", async () => {
  const data = current(
    [],
    [
      group(
        "g",
        [
          row("flan", { courseId: "dessert", released: false, quantity: "2.000" }),
          row("steak", { courseId: "main", released: false, quantity: "3.000" }),
        ],
        { position: 5, displayNumber: 7 },
      ),
    ],
  );
  data.retainedCourses = [
    { id: "dessert", name: "Desserts", displayOrder: 2, heldUntilFired: true },
    { id: "main", name: "Mains", displayOrder: 1, heldUntilFired: true },
  ];
  const el = await mount(data);
  await click(el, "[data-sent-toggle]");
  expect(find(el, "[data-held-toggle]").textContent).toContain("Mains (3) · Desserts (2)");
  await click(el, "[data-held-toggle]");
  expect(find(el, "[data-held-group=g] h4").textContent).toBe("Group 7 · Mains, Desserts");
});

it("shows exact Spanish counts, ready age and charged cancellations without a missing translation", async () => {
  setLocale("es");
  const el = await mount(
    current([row("Bravas", { readyAt: at(59) }), row("Cancelado", { cancelledQuantity: "1.000" })]),
  );
  expect(find(el, "[data-sent-toggle]").textContent).toContain("Enviado");
  expect(find(el, "[data-sent-toggle]").textContent).toContain(
    "Listos: 1 · Marchados: 0 · En espera: 0 · Servidos: 1",
  );
  expect(find(el, "[data-fired-line=Bravas]").textContent).toContain("Listo 1 min");
  expect(find(el, "[data-sent-info=Bravas]").getAttribute("aria-label")).toBe(
    "Detalles del plato · Bravas",
  );
  await click(el, "[data-served-toggle]");
  expect(find(el, "[data-served-line=Cancelado]").textContent).toContain("Cancelado, cobrado");
});

it("keeps a future snooze quiet and offers Clear snooze while collapsed", async () => {
  const data = current(
    [],
    [
      group("g", [row("held", { released: false })], {
        remindAt: new Date(now + 300_000).toISOString(),
      }),
    ],
  );
  data.reminder = { groupId: "g", dueAt: new Date(now + 300_000).toISOString() };
  const el = await mount(data);
  expect(open(el)).toBe("false");
  expect(root(el).querySelector("[data-sent-attention]")).toBeNull();
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  const calls = collect(el, "unsnooze-group");
  await click(el, "[data-reminder-unsnooze]");
  expect(calls).toEqual([{ groupId: "g" }]);
  el.now = now + 300_000;
  await el.updateComplete;
  expect(open(el)).toBe("false");
  expect(root(el).querySelector("[data-reminder-fire]")).toBeTruthy();
});

it("refreshes translated labels without resetting a waiter's folds", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  await click(el, "[data-sent-toggle]");
  setLocale("es");
  await el.updateComplete;
  expect(find(el, "[data-sent-toggle]").textContent).toContain("Enviado");
  expect(open(el)).toBe("false");
});

it("resets expansion when the same panel is connected for another table opening", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const host = el.parentElement!;
  await click(el, "[data-sent-toggle]");
  expect(open(el)).toBe("false");
  el.remove();
  host.appendChild(el);
  await el.updateComplete;
  expect(open(el)).toBe("true");
});

it("opens a held mouse press as information without serving on the following click", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  const dish = find(el, "[data-serve-line=Bravas]");
  let activity = 0;
  el.parentElement!.addEventListener("pointerdown", () => activity++);
  dish.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 550));
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    }),
  );
  dish.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
  await el.updateComplete;
  expect(details).toEqual([{ lineId: "Bravas", workingOrderId: "b1", kind: "fired" }]);
  expect(serves).toEqual([]);
  expect(activity).toBe(1);
});

it("does not serve after pointer cancellation or a scrolling movement", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  const dish = find(el, "[data-serve-line=Bravas]");
  for (const end of ["pointercancel", "pointermove"] as const) {
    dish.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(new PointerEvent(end, { pointerId: 1, clientX: 10, clientY: 50 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 50 }));
    dish.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
    await el.updateComplete;
  }
  expect(serves).toEqual([]);
  expect(details).toEqual([]);
  dish.click();
  expect(serves).toEqual([{ items: [{ lineId: "Bravas", quantity: "1" }] }]);
});

it("opens served and held details, preserving notes, extras and no-kitchen status", async () => {
  const el = await mount(
    current(
      [
        row("served", { servedQuantity: "1.000", servedAt: at(59), note: "No salt" }),
        row("water", {
          firedAt: null,
          readyAt: at(59),
          extras: [
            {
              lineId: "ice",
              name: "Ice",
              quantity: "1.000",
              netAmount: "0.25",
              unitPriceGross: "0.25",
              priceQuantity: "1.000",
            },
          ],
        }),
      ],
      [group("g", [row("held", { released: false })])],
    ),
  );
  const details = collect(el, "sent-line-info");
  await click(el, "[data-served-toggle]");
  await click(el, "[data-held-toggle]");
  expect(find(el, "[data-served-line=served]").textContent).toContain("No salt");
  expect(find(el, "[data-fired-line=water]").textContent).toContain("Ice");
  await click(el, "[data-sent-info=held]");
  await click(el, "[data-sent-info=served]");
  expect(details).toEqual([
    { lineId: "held", workingOrderId: "b1", kind: "held" },
    { lineId: "served", workingOrderId: "b1", kind: "served" },
  ]);
  const old = find(el, "[data-sent-info=served]");
  el.busy = true;
  old.click();
  el.busy = false;
  el.snapshot = null;
  old.click();
  el.remove();
  old.click();
  expect(details).toHaveLength(2);
});

it("rejects stale group/reminder commands and suppresses disabled service actions", async () => {
  const data = current([], [group("g", [row("held", { released: false })])]);
  data.reminder = { groupId: "g", dueAt: new Date(now).toISOString() };
  const el = await mount(data);
  await click(el, "[data-held-toggle]");
  const fire = find(el, "[data-group-fire=g]");
  const snooze = find(el, "[data-reminder-snooze]");
  const fires = collect(el, "fire-group"),
    snoozes = collect(el, "snooze-group");
  el.busy = true;
  fire.click();
  snooze.click();
  await el.updateComplete;
  expect((fire as HTMLElementTagNameMap["wt-button"]).variant).toBe("secondary");
  el.busy = false;
  el.snapshot = { scope: "visit-1", billId: "b1", current: { ...data, reminder: null } };
  snooze.click();
  el.snapshot = null;
  fire.click();
  el.remove();
  fire.click();
  expect(fires).toEqual([]);
  expect(snoozes).toEqual([]);
});

it("does not revive stale information controls for food that changed its service section", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const details = collect(el, "sent-line-info");
  const old = find(el, "[data-sent-info=Bravas]");
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([
      row("Bravas", {
        servedAt: at(59),
        servedQuantity: "1.000",
      }),
    ]),
  };
  old.click();
  expect(details).toEqual([]);
});

it("does not turn a held-row hold followed by movement into serving, information or a drag", async () => {
  const el = await mount(
    current([row("ready", { readyAt: at(59) })], [group("g", [row("held", { released: false })])]),
  );
  await click(el, "[data-held-toggle]");
  const details = collect(el, "sent-line-info"),
    serves = collect(el, "serve-lines");
  const dish = find(el, "[data-held-line=held] .dish");
  dish.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 550));
  window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: 50 }));
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 50 }));
  expect(details).toEqual([]);
  expect(serves).toEqual([]);
});

it("reads the live clock when none is injected and releases a pointer order after leaving the list", async () => {
  const data = current([
    row("ready", { readyAt: new Date(Date.now() - 60_000).toISOString() }),
    row("unknown", { firedAt: null }),
  ]);
  const el = await mount(data, { now: undefined });
  expect(find(el, "[data-fired-line=ready]").textContent).toContain("Ready 1 min");
  expect(find(el, "[data-fired-line=unknown]").textContent).toContain("Fired");
  const list = find(el, "[data-serve-line=ready]").parentElement!.parentElement!;
  list.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  list.dispatchEvent(new PointerEvent("pointerleave"));
  await el.updateComplete;
  expect(find(el, "[data-serve-line=ready]")).toBeTruthy();
});

it("labels an unknown companion as another bill without exposing its internal id", async () => {
  const el = await mount(
    current(
      [],
      [
        group("g", [
          row("own", { released: false }),
          row("other", { released: false, workingOrderId: "internal-bill-id" }),
        ]),
      ],
    ),
  );
  await click(el, "[data-sent-toggle]");
  await click(el, "[data-held-toggle]");
  expect(find(el, "[data-companion=other]").textContent).toContain("Another bill");
  expect(find(el, "[data-companion=other]").textContent).not.toContain("internal-bill-id");
});

it("defers a newly due banner until the pressed row is released", async () => {
  const data = current(
    [row("Bravas", { readyAt: at(59) })],
    [group("g", [row("held", { released: false })])],
  );
  const el = await mount(data);
  const dish = find(el, "[data-serve-line=Bravas]");
  const before = dish.getBoundingClientRect().toJSON();
  dish.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1 }),
  );
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: { ...data, reminder: { groupId: "g", dueAt: new Date(now).toISOString() } },
  };
  await el.updateComplete;
  expect(dish.getBoundingClientRect().toJSON()).toEqual(before);
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  dish.dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1 }),
  );
  await el.updateComplete;
  expect(root(el).querySelector("[data-reminder-fire]")).toBeTruthy();
});

it("names the due group's courses and its due clock time in the collapsed reminder", async () => {
  const data = current([], [group("g", [row("held", { released: false, courseId: "main" })])]);
  data.retainedCourses = [{ id: "main", name: "Mains", displayOrder: 1, heldUntilFired: true }];
  data.reminder = { groupId: "g", dueAt: "2026-10-18T12:00:00" };
  const el = await mount(data, { now: Date.parse("2026-10-18T12:00:00") });
  await click(el, "[data-sent-toggle]");
  expect(find(el, "[data-group-reminder=due]").textContent).toContain("Group 7 · Mains");
  expect(find(el, "[data-group-reminder=due]").textContent).toContain("12:00");
});

it("marks a reminder due at its own deadline without waiting for another server read or age tick", async () => {
  const data = current([], [group("g", [row("held", { released: false })])]);
  data.reminder = { groupId: "g", dueAt: new Date(Date.now() + 400).toISOString() };
  const el = await mount(data, { now: undefined });
  expect(open(el)).toBe("false");
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  await vi.waitFor(() => expect(root(el).querySelector("[data-reminder-fire]")).toBeTruthy(), {
    timeout: 1500,
  });
  expect(open(el)).toBe("false");
});

it("runs no age interval for an unread or folded Sent panel", async () => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  });
  try {
    vi.setSystemTime(now);
    const el = await mount(current([row("ready", { readyAt: at(59) })]), {
      snapshot: null,
      now: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
    el.snapshot = {
      scope: "visit-1",
      billId: "b1",
      current: current([row("ready", { readyAt: at(59) })]),
    };
    await el.updateComplete;
    expect(find(el, "[data-fired-line=ready]").textContent).toContain("Ready 1 min");
    await vi.advanceTimersByTimeAsync(60000);
    await el.updateComplete;
    expect(find(el, "[data-fired-line=ready]").textContent).toContain("Ready 2 min");
    find(el, "[data-sent-toggle]").click();
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(0);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  groups,
  now,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
const root = (el: TillTableOrderScreen) => el.shadowRoot!;
const find = (el: TillTableOrderScreen, selector: string) =>
  root(el).querySelector<HTMLElement>(selector)!;
function panel(el: TillTableOrderScreen): TillSentOrders {
  const child = root(el).querySelector<TillSentOrders>("till-sent-orders");
  expect(child, "Sent is connected to the table screen").not.toBeNull();
  return child!;
}
const inside = (el: TillTableOrderScreen, selector: string) =>
  panel(el).shadowRoot!.querySelector<HTMLElement>(selector)!;
function collect(el: TillTableOrderScreen, type: string) {
  const events: CustomEvent[] = [];
  el.addEventListener(type, (event) => events.push(event as CustomEvent));
  return events;
}
async function sent(over: Partial<TillTableOrderScreen> & { fireControl?: string } = {}) {
  const mounted = await mount({ currentOrders: current(), groups, now, ...over });
  mounted.el.style.width = "1280px";
  await resized(mounted.el);
  await panel(mounted.el).updateComplete;
  return mounted;
}
async function click(el: TillTableOrderScreen, selector: string) {
  await userEvent.click(inside(el, selector));
  await el.updateComplete;
  await panel(el).updateComplete;
}

it("places this bill's Sent panel before its New order on the table screen", async () => {
  const { el } = await sent();
  const pane = find(el, "[data-draft-pane]");
  expect(pane.contains(panel(el))).toBe(true);
  expect(
    panel(el).compareDocumentPosition(find(el, "[data-round-controls]")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(inside(el, "[data-sent-toggle]").textContent).toContain("held");
  expect(panel(el).billId).toBe("wo-4");
  await click(el, "[data-held-toggle]");
  expect(inside(el, '[data-held-line="l-flan"]').textContent).toContain("Cream ×2.000");
  expect(panel(el).shadowRoot!.querySelector('[data-fired-line="l-pulpo"]')).toBeNull();
});

it("serves a fired row's entire active remainder through the table's real event boundary once", async () => {
  const { el } = await sent({
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [
        row("fish", "Fish", "4.000", {
          servedQuantity: "1.000",
          cancelledQuantity: "1.000",
          readyAt: "2026-09-28T20:14:00Z",
        }),
      ],
    }),
  });
  const events = collect(el, "serve-lines");
  await click(el, '[data-serve-line="fish"]');
  expect(events.map((e) => [e.detail, e.bubbles, e.composed])).toEqual([
    [{ items: [{ lineId: "fish", quantity: "2" }] }, true, true],
  ]);
  expect(find(el, "[data-serve-dialog]").hasAttribute("open")).toBe(false);
});

it("All served collects this bill's fired rows across groups and no held or other-bill row", async () => {
  const { el } = await sent();
  const events = collect(el, "serve-lines");
  await click(el, "[data-serve-all]");
  expect(events.map((e) => e.detail)).toEqual([
    {
      items: [
        { lineId: "l-beer", quantity: "1" },
        { lineId: "l-bravas", quantity: "1" },
        { lineId: "l-coffee", quantity: "1" },
        { lineId: "l-croq", quantity: "2" },
        { lineId: "l-fish", quantity: "1" },
        { lineId: "l-steak", quantity: "1" },
      ],
    },
  ]);
});

it.each(["busy", "groupCommandBusy"] as const)(
  "prevents native Sent actions while %s",
  async (key) => {
    const { el } = await sent({ [key]: true });
    const events = collect(el, "serve-lines");
    expect(inside(el, "[data-serve-all]").hasAttribute("disabled")).toBe(true);
    inside(el, "[data-serve-all]").click();
    expect(events).toEqual([]);
  },
);

it.each(["waiter", "kitchen", "expo"] as const)(
  "keeps shared paid-group Fire confirmed under legacy %s control",
  async (fireControl) => {
    const { el } = await sent({ fireControl });
    const events = collect(el, "fire-group");
    await click(el, "[data-held-toggle]");
    await click(el, '[data-group-fire="g3"]');
    expect(events).toEqual([]);
    expect(find(el, "[data-fire-dialog]").hasAttribute("open")).toBe(true);
    await userEvent.click(find(el, "[data-fire-confirm]"));
    await el.updateComplete;
    expect(events.map((e) => e.detail)).toEqual([{ groupId: "g3" }]);
  },
);

it("keeps a due group's Fire behind the same confirmation", async () => {
  const { el } = await sent();
  const events = collect(el, "fire-group");
  await click(el, "[data-reminder-fire]");
  expect(events).toEqual([]);
  expect(find(el, "[data-fire-summary]").textContent).toContain("summary of g3");
  await userEvent.click(find(el, "[data-fire-dismiss]"));
  expect(events).toEqual([]);
});

it.each([
  ["en", "held", "It goes to the kitchen now: 0.375 × Fish 1.5, 2 × small, 2 × Bread"],
  ["es", "held", "Pasa a cocina ahora: 0,375 × Fish 1.5, 2 × small, 2 × Bread"],
  ["en", "reminder", "It goes to the kitchen now: 0.375 × Fish 1.5, 2 × small, 2 × Bread"],
  ["es", "reminder", "Pasa a cocina ahora: 0,375 × Fish 1.5, 2 × small, 2 × Bread"],
] as const)("shows %s quantities before the native %s Fire", async (locale, entry, expected) => {
  setLocale(locale);
  const held = {
    ...groups[2]!,
    lineIds: ["own-fish", "other-fish", "bread"],
    summary: "0.375 × Fish 1.5, 2 × small, 2 × Bread",
  };
  const { el } = await sent({
    groups: [held],
    currentOrders: current({
      groups: [
        currentGroup("g3", 3, "held", [
          row("own-fish", "Fish 1.5, 2 × small", "0.375", {
            unitPrecision: 3,
            cancelledQuantity: "0.125",
            released: false,
          }),
          row("other-fish", "Fish 1.5, 2 × small", "0.125", {
            workingOrderId: "other-bill",
            unitPrecision: 3,
            released: false,
          }),
          row("bread", "Bread", "2.000", { released: false }),
          row("cancelled", "Omitted fish", "1.000", {
            cancelledQuantity: "1.000",
            released: false,
          }),
        ]),
        currentGroup("g4", 4, "held", [
          row("elsewhere", "Fish 1.5, 2 × small", "4.000", { released: false }),
        ]),
      ],
      ungrouped: [],
    }),
  });
  const events = collect(el, "fire-group");
  if (entry === "held") {
    await click(el, "[data-held-toggle]");
    await click(el, '[data-group-fire="g3"]');
  } else await click(el, "[data-reminder-fire]");
  expect(events).toEqual([]);
  expect(find(el, "[data-fire-summary]").textContent!.replace(/\s+/g, " ").trim()).toBe(expected);
  await userEvent.click(find(el, "[data-fire-confirm]"));
  await el.updateComplete;
  expect(events.map((event) => event.detail)).toEqual([{ groupId: "g3" }]);
});

it("retains every dish in Fire's server summary when the structured read lacks a group line", async () => {
  const { el } = await sent({
    groups: [
      {
        ...groups[2]!,
        lineIds: ["l-flan", "missing-other-bill-line"],
        summary: "2 × Flan, 0.125 × Fish",
      },
    ],
  });
  await click(el, "[data-held-toggle]");
  await click(el, '[data-group-fire="g3"]');
  expect(find(el, "[data-fire-summary]").textContent!.replace(/\s+/g, " ").trim()).toBe(
    "It goes to the kitchen now: 2 × Flan, 0.125 × Fish",
  );
});

it("retains Fire's server quantity when the structured read has the same line with an older quantity", async () => {
  const { el } = await sent({
    groups: [{ ...groups[2]!, lineIds: ["l-flan"], summary: "3 × Flan" }],
  });
  await click(el, "[data-held-toggle]");
  await click(el, '[data-group-fire="g3"]');
  expect(find(el, "[data-fire-summary]").textContent!.replace(/\s+/g, " ").trim()).toBe(
    "It goes to the kitchen now: 3 × Flan",
  );
});

it("forwards due Snooze and Clear snooze once without needing the Sent box opened", async () => {
  const { el } = await sent();
  const snooze = collect(el, "snooze-group");
  await click(el, "[data-sent-toggle]");
  await click(el, "[data-reminder-snooze]");
  expect(snooze.map((e) => e.detail)).toEqual([{ groupId: "g3", minutes: 5 }]);
  el.currentOrders = current({
    groups: current().groups.map((g) =>
      g.id === "g3" ? { ...g, remindAt: "2026-09-28T20:20:00Z" } : g,
    ),
    reminder: { groupId: "g3", dueAt: "2026-09-28T20:20:00Z" },
  });
  await el.updateComplete;
  await panel(el).updateComplete;
  const clear = collect(el, "unsnooze-group");
  await click(el, "[data-reminder-unsnooze]");
  expect(clear.map((e) => e.detail)).toEqual([{ groupId: "g3" }]);
  expect(inside(el, "[data-sent-toggle]").getAttribute("aria-expanded")).toBe("false");
});

it("keeps a passive ready update folded but starts a new bill with attention open", async () => {
  const data = current({ groups: [], reminder: null, ungrouped: [row("one", "One", "1.000")] });
  const { el } = await sent({ currentOrders: data });
  expect(inside(el, "[data-sent-toggle]").getAttribute("aria-expanded")).toBe("false");
  el.currentOrders = {
    ...data,
    ungrouped: [{ ...data.ungrouped[0]!, readyAt: "2026-09-28T20:14:00Z" }],
  };
  await el.updateComplete;
  await panel(el).updateComplete;
  expect(inside(el, "[data-sent-toggle]").getAttribute("aria-expanded")).toBe("false");
  expect(inside(el, "[data-sent-attention]").textContent).toContain("!");
  el.orderId = "other";
  el.currentOrders = {
    ...data,
    ungrouped: [
      row("other-line", "Other", "1.000", {
        workingOrderId: "other",
        readyAt: "2026-09-28T20:14:00Z",
      }),
    ],
  };
  await el.updateComplete;
  await panel(el).updateComplete;
  expect(inside(el, "[data-sent-toggle]").getAttribute("aria-expanded")).toBe("true");
});

it("keeps service available without an editable outbox", async () => {
  const { el } = await sent({ draftStore: null });
  const events = collect(el, "serve-lines");
  expect(panel(el).checkVisibility()).toBe(true);
  await click(el, "[data-serve-all]");
  expect(events).toHaveLength(1);
});

it("puts a failed current-orders read beside Sent without offering old service rows", async () => {
  const { el } = await sent();
  el.currentOrders = null;
  el.currentOrdersUnread = true;
  await el.updateComplete;
  await panel(el).updateComplete;
  expect(find(el, "[data-sent-unread]").textContent).toContain("could not");
  expect(panel(el).shadowRoot!.querySelector("[data-serve-line]")).toBeNull();
});

it.each([
  "group-fired",
  "group-gone",
  "api",
  "visit",
  "party",
  "busy",
  "command",
  "detached",
] as const)(
  "does not fire a retained confirmation after %s changes its authority",
  async (change) => {
    const { el } = await sent();
    const events = collect(el, "fire-group");
    await click(el, "[data-held-toggle]");
    await click(el, '[data-group-fire="g3"]');
    const confirm = find(el, "[data-fire-confirm]");
    if (change === "group-fired")
      el.groups = groups.map((g) => (g.id === "g3" ? { ...g, state: "fired" } : g));
    if (change === "group-gone") el.groups = groups.filter((g) => g.id !== "g3");
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "visit") el.serviceVisit++;
    if (change === "party") el.party = { id: "another-party" } as TillTableOrderScreen["party"];
    if (change === "busy") el.busy = true;
    if (change === "command") el.groupCommandBusy = true;
    if (change === "detached") el.remove();
    await el.updateComplete;
    confirm.click();
    expect(events).toEqual([]);
  },
);

it("starts the same bill's new visit from its attention state, not its last manual fold", async () => {
  const { el } = await sent();
  await click(el, "[data-sent-toggle]");
  el.serviceVisit++;
  await el.updateComplete;
  await panel(el).updateComplete;
  expect(inside(el, "[data-sent-toggle]").getAttribute("aria-expanded")).toBe("true");
});

it("opens sent information as read-only recorded dish, extra and note prices", async () => {
  const { el } = await sent();
  const events = collect(el, "serve-lines");
  await click(el, "[data-held-toggle]");
  await click(el, '[data-sent-info="l-flan"]');
  const dialog = find(el, "[data-sent-line-dialog]");
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.textContent).toContain("Flan ×2");
  expect(dialog.querySelector("[data-sent-line-amount]")!.textContent).toContain("4.00");
  expect(dialog.querySelector('[data-sent-extra="l-cream"]')!.textContent).toContain("2.00");
  expect(
    dialog.querySelector("input,textarea,wt-input,wt-combobox,[data-sent-line-serve]"),
  ).toBeNull();
  expect(find(el, "[data-sent-line-close]").textContent!.trim()).toBe("Close");
  await userEvent.click(find(el, "[data-sent-line-close]"));
  await el.updateComplete;
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(events).toEqual([]);
});

it("a fired line's information opens the existing partial-serving choice with its active remainder", async () => {
  const { el } = await sent({
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [
        row("dish", "Fish", "5.000", {
          servedQuantity: "1.000",
          cancelledQuantity: "1.000",
          readyAt: "2026-09-28T20:14:00Z",
          note: "no salt",
        }),
      ],
    }),
  });
  const events = collect(el, "serve-lines");
  await click(el, '[data-sent-info="dish"]');
  expect(find(el, "[data-sent-line-dialog]").textContent).toContain("no salt");
  await userEvent.click(find(el, "[data-sent-line-serve]"));
  await el.updateComplete;
  expect(find(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
  expect(find(el, "[data-serve-dialog]").hasAttribute("open")).toBe(true);
  expect(find(el, "[data-serve-count]").textContent!.trim()).toBe("3");
  await userEvent.click(find(el, "[data-serve-dec]"));
  await el.updateComplete;
  await userEvent.click(find(el, "[data-serve-confirm]"));
  await el.updateComplete;
  expect(events.map((e) => e.detail)).toEqual([{ items: [{ lineId: "dish", quantity: "2" }] }]);
});

it("offers Not served for the served slice and reuses its partial quantity choice", async () => {
  const { el } = await sent();
  const events = collect(el, "unserve-lines");
  await click(el, "[data-served-toggle]");
  await click(el, '[data-sent-info="l-croq"]');
  expect(find(el, "[data-sent-line-serve]")).toBeNull();
  find(el, "[data-sent-line-unserve]").click();
  await el.updateComplete;
  expect(find(el, "[data-serve-count]").textContent!.trim()).toBe("2");
  await userEvent.click(find(el, "[data-serve-dec]"));
  await el.updateComplete;
  await userEvent.click(find(el, "[data-serve-confirm]"));
  await el.updateComplete;
  expect(events.map((e) => e.detail)).toEqual([{ items: [{ lineId: "l-croq", quantity: "1" }] }]);
});

it("keeps a charged cancellation read-only with no service action", async () => {
  const { el } = await sent({
    currentOrders: current({
      groups: [],
      reminder: null,
      ungrouped: [row("cancelled", "Soup", "1.000", { cancelledQuantity: "1.000" })],
    }),
  });
  await click(el, "[data-sent-toggle]");
  await click(el, "[data-served-toggle]");
  await click(el, '[data-sent-info="cancelled"]');
  expect(find(el, "[data-sent-line-dialog]").textContent).toContain("Cancelled, charged");
  expect(root(el).querySelector("[data-sent-line-serve],[data-sent-line-unserve]")).toBeNull();
});

it.each(["busy", "groupCommandBusy", "serviceVisit", "api", "row-gone", "bill"] as const)(
  "a retained information action cannot serve after %s changes",
  async (change) => {
    const { el } = await sent();
    const events = collect(el, "serve-lines");
    await click(el, '[data-sent-info="l-beer"]');
    const serve = find(el, "[data-sent-line-serve]");
    if (change === "busy") el.busy = true;
    if (change === "groupCommandBusy") el.groupCommandBusy = true;
    if (change === "serviceVisit") el.serviceVisit++;
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "row-gone")
      el.currentOrders = current({ groups: [], ungrouped: [], reminder: null });
    if (change === "bill") el.orderId = "other";
    await el.updateComplete;
    serve.click();
    expect(events).toEqual([]);
  },
);

it.each(["busy", "command", "api", "visit", "party", "unread", "served-elsewhere"] as const)(
  "the partial-serving confirmation refuses after %s",
  async (change) => {
    const { el } = await sent();
    const events = collect(el, "serve-lines");
    await click(el, '[data-sent-info="l-croq"]');
    await userEvent.click(find(el, "[data-sent-line-serve]"));
    await el.updateComplete;
    const confirm = find(el, "[data-serve-confirm]");
    if (change === "busy") el.busy = true;
    if (change === "command") el.groupCommandBusy = true;
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "visit") el.serviceVisit++;
    if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
    if (change === "unread") {
      el.currentOrders = null;
      el.currentOrdersUnread = true;
    }
    if (change === "served-elsewhere")
      el.currentOrders = current({
        groups: current().groups.map((g) => ({
          ...g,
          rows: g.rows.map((r) =>
            r.lineId === "l-croq"
              ? { ...r, servedQuantity: "4.000", servedAt: "2026-09-28T20:15:00Z" }
              : r,
          ),
        })),
      });
    await el.updateComplete;
    confirm.click();
    expect(events).toEqual([]);
  },
);

it("does not reopen a departed information window when the old bill returns", async () => {
  const { el } = await sent();
  await click(el, '[data-sent-info="l-beer"]');
  el.orderId = "other";
  await el.updateComplete;
  el.orderId = "wo-4";
  await el.updateComplete;
  expect(find(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
});

it.each(["unread", "older"] as const)(
  "keeps confirmed Fire available with an %s Current orders read and a known held group",
  async (read) => {
    const { el } = await sent();
    const events = collect(el, "fire-group");
    await click(el, "[data-held-toggle]");
    await click(el, '[data-group-fire="g3"]');
    el.currentOrders =
      read === "unread" ? null : current({ groups: [], ungrouped: [], reminder: null });
    el.currentOrdersUnread = read === "unread";
    await el.updateComplete;
    await userEvent.click(find(el, "[data-fire-confirm]"));
    await el.updateComplete;
    expect(events.map((event) => event.detail)).toEqual([{ groupId: "g3" }]);
  },
);

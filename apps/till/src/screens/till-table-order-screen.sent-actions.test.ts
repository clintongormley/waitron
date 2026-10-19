import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import type { PartyBill, TabLine } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

function bill(status: PartyBill["status"]): PartyBill {
  return {
    workingOrderId: "wo-4",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status,
    total: "10.00",
    outstanding: status === "open" ? "10.00" : "0.00",
    hasPayments: status !== "open",
    receiptAvailable: status === "settled",
  };
}
const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
function capture(el: TillTableOrderScreen, type: string) {
  const events: CustomEvent[] = [];
  el.addEventListener(type, (event) => events.push(event as CustomEvent));
  return events;
}
async function openLine(kind: "held" | "served", over: Partial<TillTableOrderScreen> = {}) {
  const { el } = await mount({ currentOrders: current(), groups, now, ...over });
  el.style.width = "1280px";
  await resized(el);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-toggle]`)!);
  await panel.updateComplete;
  await userEvent.click(
    panel.shadowRoot!.querySelector<HTMLElement>(
      `[data-sent-info="${kind === "held" ? "l-flan" : "l-croq"}"]`,
    )!,
  );
  await el.updateComplete;
  return el;
}
async function openMore(el: TillTableOrderScreen) {
  const more = q(el, "[data-sent-line-dialog] wt-row-actions") as WtRowActions;
  expect(more).not.toBeNull();
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
  expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  return more;
}

it.each(["waiter", "kitchen", "expo"] as const)(
  "fires one paid held dish through its native More menu under %s control",
  async (fireControl) => {
    const orders = structuredClone(current());
    orders.groups[2]!.rows[0] = { ...orders.groups[2]!.rows[0]!, billStatus: "settled" };
    const el = await openLine("held", {
      currentOrders: orders,
      bills: [bill("settled")],
      fireControl,
      editSentLines: false,
    });
    const events = capture(el, "fire-held-line");
    await openMore(el);
    await userEvent.click(q(el, "[data-sent-line-fire]"));
    await el.updateComplete;
    expect(events.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ lineId: "l-flan" }, true, true],
    ]);
    expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
  },
);

it.each([
  "busy",
  "groupCommandBusy",
  "api",
  "party",
  "bill",
  "serviceVisit",
  "unread",
  "fired",
  "group-fired",
  "gone",
] as const)("a retained single-dish Fire sends nothing after %s changes", async (change) => {
  const el = await openLine("held");
  const events = capture(el, "fire-held-line");
  await openMore(el);
  const fire = q(el, "[data-sent-line-fire]");
  expect(fire).not.toBeNull();
  if (change === "busy" || change === "groupCommandBusy") el[change] = true;
  if (change === "api") el.api = {} as TillTableOrderScreen["api"];
  if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
  if (change === "bill") el.orderId = "other";
  if (change === "serviceVisit") el.serviceVisit++;
  if (change === "unread") el.currentOrdersUnread = true;
  if (change === "group-fired")
    el.groups = groups.map((group) => (group.id === "g3" ? { ...group, state: "fired" } : group));
  if (change === "fired" || change === "gone") {
    const orders = structuredClone(current());
    orders.groups = orders.groups.map((group) =>
      group.id !== "g3"
        ? group
        : change === "gone"
          ? { ...group, rows: [] }
          : {
              ...group,
              state: "fired",
              rows: group.rows.map((row) => ({ ...row, released: true })),
            },
    );
    el.currentOrders = orders;
  }
  // A retained handler must read current authority even before Lit paints the update.
  fire.click();
  await el.updateComplete;
  expect(events).toEqual([]);
});

it("Not served is usable through the native More menu with the exact partial quantity", async () => {
  const el = await openLine("served", { bills: [bill("open")] });
  const events = capture(el, "unserve-lines");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-unserve]"));
  await el.updateComplete;
  expect(q(el, "[data-serve-count]").textContent!.trim()).toBe("2");
  await userEvent.click(q(el, "[data-serve-dec]"));
  await el.updateComplete;
  await userEvent.click(q(el, "[data-serve-confirm]"));
  expect(events.map((event) => event.detail)).toEqual([
    { items: [{ lineId: "l-croq", quantity: "1" }] },
  ]);
});

it.each(["placed", "settled"] as const)(
  "a newer %s bill hides Not served while the service read still says open",
  async (status) => {
    const el = await openLine("served", { bills: [bill("open")] });
    const events = capture(el, "unserve-lines");
    await openMore(el);
    const unMake = q(el, "[data-sent-line-unserve]");
    el.bills = [bill(status)];
    unMake.click();
    await el.updateComplete;
    expect(q(el, "[data-sent-line-unserve]")).toBeNull();
    expect(q(el, "[data-serve-dialog]").hasAttribute("open")).toBe(false);
    expect(events).toEqual([]);
  },
);

it("Not served cannot confirm a quantity after its bill is paid", async () => {
  const el = await openLine("served", { bills: [bill("open")] });
  const events = capture(el, "unserve-lines");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-unserve]"));
  await el.updateComplete;
  const confirm = q(el, "[data-serve-confirm]");
  el.bills = [bill("settled")];
  confirm.click();
  await el.updateComplete;
  expect(events).toEqual([]);
});

function heldLine(over: Partial<TabLine> = {}): TabLine {
  return {
    id: "l-flan",
    name: "Flan",
    lineNo: 1,
    groupId: "g3",
    productId: null,
    quantity: "2.000",
    unitPrecision: 0,
    unitPriceGross: "2.00",
    servedAt: null,
    courseId: null,
    sentAt: null,
    firedAt: null,
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    stationId: "cold",
    movable: true,
    ...over,
  };
}

it("Recall from More names the original line and closes information before continuing", async () => {
  const el = await openLine("held", { lines: [heldLine()], bills: [bill("open")] });
  const events = capture(el, "recall-lines");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-recall]"));
  await el.updateComplete;
  expect(events.map((event) => event.detail)).toEqual([{ lineNos: [1] }]);
  expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
});

it.each([
  "setting",
  "parent-started",
  "extra-started",
  "served",
  "paid",
  "owner",
  "missing-line",
] as const)(
  "More excludes Recall when %s prevents it, while shared Fire stays available",
  async (refusal) => {
    const orders = structuredClone(current());
    const store = new DraftStore();
    const lines = [heldLine()];
    if (refusal === "parent-started") lines[0]!.state = "preparing";
    if (refusal === "extra-started")
      lines.push(heldLine({ id: "l-cream", lineNo: 2, parentLineNo: 1, state: "ready" }));
    if (refusal === "served") orders.groups[2]!.rows[0]!.servedQuantity = "1.000";
    if (refusal === "owner") store.ownershipLocked = true;
    const el = await openLine("held", {
      lines: refusal === "missing-line" ? [] : lines,
      bills: [bill(refusal === "paid" ? "settled" : "open")],
      editSentLines: refusal !== "setting",
      currentOrders: orders,
      draftStore: store,
    });
    await openMore(el);
    expect(q(el, "[data-sent-line-recall]")).toBeNull();
    expect(q(el, "[data-sent-line-fire]")!.checkVisibility()).toBe(true);
  },
);

it.each(["owner", "setting", "paid", "started", "gone", "api", "visit"] as const)(
  "a retained Recall refuses a newer %s state before a repaint",
  async (change) => {
    const store = new DraftStore();
    const el = await openLine("held", {
      lines: [heldLine()],
      bills: [bill("open")],
      draftStore: store,
    });
    const events = capture(el, "recall-lines");
    await openMore(el);
    const recall = q(el, "[data-sent-line-recall]");
    expect(recall).not.toBeNull();
    if (change === "owner") store.ownershipLocked = true;
    if (change === "setting") el.editSentLines = false;
    if (change === "paid") el.bills = [bill("settled")];
    if (change === "started") el.lines = [heldLine({ state: "preparing" })];
    if (change === "gone") el.lines = [];
    if (change === "api") el.api = {} as TillTableOrderScreen["api"];
    if (change === "visit") el.serviceVisit++;
    recall.click();
    await el.updateComplete;
    expect(events).toEqual([]);
  },
);

it("station move from More carries the sent row's original bill, dish and station", async () => {
  const orders = structuredClone(current());
  orders.groups[2]!.rows[0]!.kitchen!.stationId = "cold";
  orders.groups[2]!.rows[0]!.kitchen!.movable = true;
  const el = await openLine("held", {
    lines: [heldLine()],
    bills: [bill("open")],
    currentOrders: orders,
  });
  const events = capture(el, "move-station");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-station]"));
  await el.updateComplete;
  expect(events.map((event) => event.detail)).toEqual([
    { workingOrderId: "wo-4", lineId: "l-flan", name: "Flan", stationId: "cold" },
  ]);
  expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
});

it.each(["owner", "paid", "unmovable", "started", "row-unmovable"] as const)(
  "a retained station move refuses newer %s facts",
  async (change) => {
    const orders = structuredClone(current());
    orders.groups[2]!.rows[0]!.kitchen!.movable = true;
    const store = new DraftStore();
    const el = await openLine("held", {
      lines: [heldLine()],
      bills: [bill("open")],
      currentOrders: orders,
      draftStore: store,
    });
    const events = capture(el, "move-station");
    await openMore(el);
    const move = q(el, "[data-sent-line-station]");
    expect(move).not.toBeNull();
    if (change === "owner") store.ownershipLocked = true;
    if (change === "paid") el.bills = [bill("settled")];
    if (change === "unmovable") el.lines = [heldLine({ movable: false })];
    if (change === "started") el.lines = [heldLine({ state: "ready" })];
    if (change === "row-unmovable") {
      const newer = structuredClone(current());
      el.currentOrders = newer;
    }
    move.click();
    await el.updateComplete;
    expect(events).toEqual([]);
  },
);

it.each(["open", "placed", "settled"] as const)(
  "Void from a %s Sent dish opens fresh cancellation consent instead of an adjustment",
  async (status) => {
    const orders = structuredClone(current());
    orders.groups[2]!.rows[0]!.billStatus = status;
    const store = new DraftStore();
    store.billStatus = status;
    const el = await openLine("held", {
      currentOrders: orders,
      bills: [bill(status)],
      draftStore: store,
    });
    const cancellations = capture(el, "cancel-item");
    const adjustments = capture(el, "adjust");
    await openMore(el);
    const cancel = q(el, "[data-sent-line-void]");
    expect(cancel).not.toBeNull();
    expect(cancel.textContent).toBe("Void…");
    await userEvent.click(cancel);
    await el.updateComplete;
    expect(cancellations.map((event) => [event.detail, event.bubbles, event.composed])).toEqual([
      [{ lineId: "l-flan" }, true, true],
    ]);
    expect(adjustments).toEqual([]);
    expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
  },
);

it("Void on an actually served dish still opens consent for its original parent", async () => {
  const el = await openLine("served", { bills: [bill("open")] });
  const cancellations = capture(el, "cancel-item");
  await openMore(el);
  const cancel = q(el, "[data-sent-line-void]");
  expect(cancel).not.toBeNull();
  await userEvent.click(cancel);
  expect(cancellations.map((event) => event.detail)).toEqual([{ lineId: "l-croq" }]);
});

it.each(["owner", "loading", "sending", "abandoned", "row-abandoned", "cancelled"] as const)(
  "Void is absent for %s, without hiding the recorded information",
  async (blocked) => {
    const store = new DraftStore();
    if (blocked === "owner") store.ownershipLocked = true;
    if (blocked === "sending") store.sending = true;
    if (blocked === "loading") store.lockEdits();
    const orders = structuredClone(current());
    if (blocked === "row-abandoned") orders.groups[2]!.rows[0]!.billStatus = "abandoned";
    if (blocked === "cancelled") {
      orders.groups[0]!.rows[0]!.cancelledQuantity = "4.000";
      orders.groups[0]!.rows[0]!.servedQuantity = "0.000";
    }
    const el = await openLine(blocked === "cancelled" ? "served" : "held", {
      currentOrders: orders,
      bills: [bill(blocked === "abandoned" ? "abandoned" : "open")],
      draftStore: store,
    });
    const more = q(el, "[data-sent-line-dialog] wt-row-actions");
    if (more !== null) await openMore(el);
    expect(q(el, "[data-sent-line-void]")).toBeNull();
    expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(true);
    expect(q(el, "[data-sent-line-amount]").textContent).toContain("€");
  },
);

it.each([
  "owner",
  "loading",
  "sending",
  "busy",
  "groupCommandBusy",
  "abandoned",
  "row-abandoned",
  "cancelled",
  "gone",
  "api",
  "party",
  "bill",
  "serviceVisit",
  "unread",
  "closed",
] as const)("a retained Void cannot begin consent after %s changes", async (change) => {
  const store = new DraftStore();
  const el = await openLine("held", { draftStore: store, bills: [bill("open")] });
  const cancellations = capture(el, "cancel-item");
  await openMore(el);
  const cancel = q(el, "[data-sent-line-void]");
  expect(cancel).not.toBeNull();
  if (change === "owner") store.ownershipLocked = true;
  if (change === "sending") store.sending = true;
  if (change === "loading") store.lockEdits();
  if (change === "busy" || change === "groupCommandBusy") el[change] = true;
  if (change === "abandoned") el.bills = [bill("abandoned")];
  if (change === "api") el.api = {} as TillTableOrderScreen["api"];
  if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
  if (change === "bill") el.orderId = "other";
  if (change === "serviceVisit") el.serviceVisit++;
  if (change === "unread") el.currentOrdersUnread = true;
  if (change === "closed") {
    await userEvent.click(q(el, "[data-sent-line-close]"));
    await el.updateComplete;
  }
  if (change === "row-abandoned" || change === "cancelled" || change === "gone") {
    const orders = structuredClone(current());
    if (change === "row-abandoned") orders.groups[2]!.rows[0]!.billStatus = "abandoned";
    if (change === "cancelled") orders.groups[2]!.rows[0]!.cancelledQuantity = "2.000";
    if (change === "gone") orders.groups[2]!.rows = [];
    el.currentOrders = orders;
  }
  cancel.click();
  await el.updateComplete;
  expect(cancellations).toEqual([]);
});

it.each(["owner", "loading"] as const)("paid Void still refuses the %s lock", async (lock) => {
  const store = new DraftStore();
  store.billStatus = "settled";
  const orders = structuredClone(current());
  orders.groups[2]!.rows[0]!.billStatus = "settled";
  const el = await openLine("held", {
    draftStore: store,
    currentOrders: orders,
    bills: [bill("settled")],
  });
  const events = capture(el, "cancel-item");
  await openMore(el);
  const cancel = q(el, "[data-sent-line-void]");
  expect(cancel).not.toBeNull();
  if (lock === "owner") store.ownershipLocked = true;
  else store.lockEdits();
  cancel.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-sent-line-void]")).toBeNull();
});

it("Void also respects a plain order store's reload lock", async () => {
  const store = new WorkingOrderStore();
  const el = await openLine("held", { draftStore: store });
  const events = capture(el, "cancel-item");
  await openMore(el);
  const cancel = q(el, "[data-sent-line-void]");
  expect(cancel).not.toBeNull();
  store.lockEdits();
  cancel.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-sent-line-void]")).toBeNull();
});

it("a previous Void cannot consume a reopened dish window", async () => {
  const el = await openLine("held");
  const events = capture(el, "cancel-item");
  await openMore(el);
  const previous = q(el, "[data-sent-line-void]");
  await userEvent.click(q(el, "[data-sent-line-close]"));
  await el.updateComplete;
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="l-flan"]')!);
  await el.updateComplete;
  previous.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(true);
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-void]"));
  expect(events.map((event) => event.detail)).toEqual([{ lineId: "l-flan" }]);
});

it("Sent Comp opens one combined adjustment for the parent and its priced extras", async () => {
  const el = await openLine("held", {
    lines: [
      heldLine(),
      heldLine({ id: "cream", lineNo: 2, parentLineNo: 1, name: "Cream", unitPriceGross: "1.00" }),
      heldLine({ id: "free-extra", lineNo: 3, parentLineNo: 1, unitPriceGross: "0.00" }),
    ],
    bills: [bill("open")],
  });
  const events = capture(el, "adjust");
  await openMore(el);
  const comp = q(el, "[data-sent-line-comp]");
  expect(comp).not.toBeNull();
  await userEvent.click(comp);
  await el.updateComplete;
  expect(
    events.map((e) => [
      e.detail.kind,
      e.detail.combined,
      e.detail.target.lineId,
      e.detail.target.total,
      e.detail.target.extras.map(
        (x: { lineId: string; total: string; unitTotal: string | null }) => [
          x.lineId,
          x.total,
          x.unitTotal,
        ],
      ),
      e.bubbles,
      e.composed,
    ]),
  ).toEqual([["comp", true, "l-flan", "6.00", [["cream", "2.00", null]], true, true]]);
  expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
});
it.each(["paid", "owner", "missing-line"] as const)(
  "Sent Comp is absent when %s prevents a financial edit",
  async (refusal) => {
    const store = new DraftStore();
    const orders = structuredClone(current());
    if (refusal === "paid") orders.groups[2]!.rows[0]!.billStatus = "settled";
    if (refusal === "owner") store.ownershipLocked = true;
    const el = await openLine("held", {
      draftStore: store,
      currentOrders: orders,
      lines: refusal === "missing-line" ? [] : [heldLine()],
      bills: [bill(refusal === "paid" ? "settled" : "open")],
    });
    await openMore(el);
    expect(q(el, "[data-sent-line-comp]")).toBeNull();
  },
);
it.each([
  "bill",
  "row",
  "owner",
  "busy",
  "api",
  "party",
  "serviceVisit",
  "window",
  "gone",
] as const)("a retained Comp cannot open after %s changes", async (change) => {
  const store = new DraftStore();
  const el = await openLine("held", {
    draftStore: store,
    lines: [heldLine()],
    bills: [bill("open")],
  });
  const events = capture(el, "adjust");
  await openMore(el);
  const comp = q(el, "[data-sent-line-comp]");
  expect(comp).not.toBeNull();
  if (change === "bill") el.bills = [bill("settled")];
  if (change === "row") {
    const orders = structuredClone(current());
    orders.groups[2]!.rows[0]!.billStatus = "settled";
    el.currentOrders = orders;
  }
  if (change === "owner") store.ownershipLocked = true;
  if (change === "busy") el.busy = true;
  if (change === "api") el.api = {} as TillTableOrderScreen["api"];
  if (change === "party") el.party = { id: "other" } as TillTableOrderScreen["party"];
  if (change === "serviceVisit") el.serviceVisit++;
  if (change === "window") await userEvent.click(q(el, "[data-sent-line-close]"));
  if (change === "gone") el.lines = [];
  comp.click();
  await el.updateComplete;
  expect(events).toEqual([]);
});

it("a retained Comp prices the latest dish and new extras before Lit paints the new snapshot", async () => {
  const el = await openLine("held", { lines: [heldLine()], bills: [bill("open")] });
  const events = capture(el, "adjust");
  await openMore(el);
  const comp = q(el, "[data-sent-line-comp]");
  expect(comp).not.toBeNull();
  el.lines = [
    heldLine({ unitPriceGross: "3.00" }),
    heldLine({
      id: "new-extra",
      name: "Cream",
      lineNo: 2,
      parentLineNo: 1,
      unitPriceGross: "1.00",
    }),
  ];
  comp.click();
  await el.updateComplete;
  expect(
    events.map((e) => [
      e.detail.target.total,
      e.detail.target.extras.map((extra: { lineId: string; total: string }) => [
        extra.lineId,
        extra.total,
      ]),
    ]),
  ).toEqual([["8.00", [["new-extra", "2.00"]]]]);
});

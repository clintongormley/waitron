import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtRowActions } from "@waitron/ui";
import type { CurrentOrderRow, PartyBill, TabLine } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { mount, resized } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  fired,
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

type Kind = "held" | "fired" | "served";

const bill: PartyBill = {
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "21.00",
  outstanding: "21.00",
  hasPayments: false,
  receiptAvailable: false,
};
const servedAt = "2026-09-28T20:05:00.000Z";

function steakRow(id: string, lineNo: number, kind: Kind): CurrentOrderRow {
  const held = kind === "held";
  return row(id, "Steak", "1.000", {
    lineNo,
    netAmount: "10.50",
    released: !held,
    firedAt: held ? null : fired,
    kitchen: { stationId: "grill", movable: true, state: "queued", firedAt: held ? null : fired },
    ...(kind === "served" ? { servedQuantity: "1.000", servedAt } : {}),
    extras: [
      {
        lineId: `${id}-lime`,
        name: "Lime",
        quantity: "2.000",
        netAmount: "1.00",
        unitPriceGross: "0.50",
        priceQuantity: "1.000",
      },
    ],
  });
}

function steakLines(id: string, lineNo: number, kind: Kind): TabLine[] {
  const held = kind === "held";
  const dish: TabLine = {
    changesAfterSending: "held-or-waiting",
    id,
    name: "Steak",
    lineNo,
    groupId: held ? "g3" : "g1",
    productId: "steak",
    quantity: "1.000",
    priceQuantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "9.50",
    servedAt: kind === "served" ? servedAt : null,
    courseId: null,
    sentAt: held ? null : fired,
    firedAt: held ? null : fired,
    state: "queued",
    note: null,
    listId: null,
    menuItemId: "offer-steak",
    parentProductId: null,
    stationId: "grill",
    movable: true,
  };
  const lime: TabLine = {
    ...dish,
    id: `${id}-lime`,
    name: "Lime",
    lineNo: lineNo + 10,
    parentLineNo: lineNo,
    productId: "lime",
    menuItemId: null,
    quantity: "2.000",
    unitPriceGross: "0.50",
  };
  return [dish, lime];
}

/** Two identical one-unit steaks, each with two limes, shown as one "Steak ×2" row. */
async function openGrouped(kind: Kind, over: Partial<TillTableOrderScreen> = {}) {
  const rows = [steakRow("s-2", 2, kind), steakRow("s-1", 1, kind)];
  const orders = current({
    reminder: null,
    groups: [
      currentGroup(kind === "held" ? "g3" : "g1", 3, kind === "held" ? "held" : "fired", rows),
    ],
    ungrouped: [],
  });
  const { el } = await mount({
    currentOrders: orders,
    groups,
    now,
    bills: [bill],
    lines: [...steakLines("s-1", 1, kind), ...steakLines("s-2", 2, kind)],
    ...over,
  });
  el.style.width = "1280px";
  await resized(el);
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  for (const name of ["sent", kind]) {
    const toggle = panel.shadowRoot!.querySelector<HTMLElement>(`[data-${name}-toggle]`);
    if (toggle?.getAttribute("aria-expanded") === "false") {
      await userEvent.click(toggle);
      await panel.updateComplete;
    }
  }
  const shown = panel.shadowRoot!.querySelector<HTMLElement>(`[data-${kind}-line="s-1"] .what`)!;
  expect(shown.textContent!.replace(/\s+/g, " ").trim()).toMatch(/^Steak ×2 Lime ×/);
  await userEvent.click(panel.shadowRoot!.querySelector<HTMLElement>('[data-sent-info="s-1"]')!);
  await el.updateComplete;
  return el;
}

const q = (el: TillTableOrderScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
const text = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
function capture(el: TillTableOrderScreen, type: string) {
  const events: unknown[] = [];
  el.addEventListener(type, (event) => events.push((event as CustomEvent).detail));
  return events;
}
async function openMore(el: TillTableOrderScreen) {
  const more = q(el, "[data-sent-line-dialog] wt-row-actions") as WtRowActions;
  await more.updateComplete;
  await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
}

it("A803 portion grouping: the sheet of a grouped row shows the group's count and amounts", async () => {
  const el = await openGrouped("held");
  const sheet = q(el, "[data-sent-line-dialog]");
  expect(text(sheet.querySelector(".move-dish")!)).toBe("Steak ×2");
  expect(text(sheet.querySelector("[data-sent-line-amount]")!)).toBe("€19.00");
  const cells = (row: Element) => [...row.children].map(text);
  expect(cells(sheet.querySelector('[data-sent-extra="s-1-lime"]')!)).toEqual(["Lime ×2", "€2.00"]);
  expect(cells([...sheet.querySelectorAll(".total-row")].at(-1)!)).toEqual(["Total", "€21.00"]);
});

it("A803 portion grouping: Recall on a grouped row recalls every member, by line number", async () => {
  const el = await openGrouped("held");
  const events = capture(el, "recall-lines");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-recall]"));
  expect(events).toEqual([{ lineNos: [1, 2] }]);
});

it("A803 portion grouping: Move station on a grouped row moves every member", async () => {
  const el = await openGrouped("held");
  const events = capture(el, "move-station");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-station]"));
  expect(events).toEqual([
    {
      workingOrderId: "wo-4",
      lineId: "s-1",
      lineIds: ["s-1", "s-2"],
      name: "Steak",
      stationId: "grill",
    },
  ]);
});

it("A803 portion grouping: Fire now, Void and Comp on a grouped row act on its first member", async () => {
  for (const [selector, type] of [
    ["[data-sent-line-fire]", "fire-held-line"],
    ["[data-sent-line-void]", "cancel-item"],
    ["[data-sent-line-comp]", "adjust"],
  ] as const) {
    const el = await openGrouped("held");
    const events = capture(el, type);
    await openMore(el);
    await userEvent.click(q(el, selector));
    expect(events).toHaveLength(1);
    const detail = events[0] as { lineId?: string; target?: { lineId: string; quantity: string } };
    expect(detail.lineId ?? detail.target).toEqual(
      type === "adjust" ? expect.objectContaining({ lineId: "s-1", quantity: "1" }) : "s-1",
    );
    cleanupWidgets();
  }
});

it("A803 portion grouping: Serve on a grouped row serves every member", async () => {
  const el = await openGrouped("fired");
  const events = capture(el, "serve-lines");
  await userEvent.click(q(el, "[data-sent-line-serve]"));
  expect(events).toEqual([
    {
      items: [
        { lineId: "s-1", quantity: "1" },
        { lineId: "s-2", quantity: "1" },
      ],
    },
  ]);
  expect(q(el, "[data-serve-dialog]").hasAttribute("open")).toBe(false);
});

it("A803 portion grouping: Undo served on a grouped row takes back every member", async () => {
  const el = await openGrouped("served");
  const events = capture(el, "unserve-lines");
  await openMore(el);
  await userEvent.click(q(el, "[data-sent-line-unserve]"));
  expect(events).toEqual([
    {
      items: [
        { lineId: "s-1", quantity: "1" },
        { lineId: "s-2", quantity: "1" },
      ],
    },
  ]);
});

it("A803 portion grouping: a grouped sheet sends nothing once its members stop matching", async () => {
  const el = await openGrouped("held");
  const events = capture(el, "recall-lines");
  await openMore(el);
  const recall = q(el, "[data-sent-line-recall]");
  const orders = structuredClone(el.currentOrders!);
  orders.groups[0]!.rows.find((each) => each.lineId === "s-2")!.note = "Rare";
  el.lines = el.lines.map((line) => (line.id === "s-2" ? { ...line, note: "Rare" } : line));
  el.currentOrders = orders;
  recall.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
});

it("A803 portion grouping: a grouped sheet sends nothing once one of its members is gone", async () => {
  const el = await openGrouped("held");
  const events = capture(el, "recall-lines");
  await openMore(el);
  const recall = q(el, "[data-sent-line-recall]");
  const orders = structuredClone(el.currentOrders!);
  orders.groups[0]!.rows = orders.groups[0]!.rows.filter((each) => each.lineId !== "s-2");
  el.lines = el.lines.filter((line) => line.id !== "s-2" && line.id !== "s-2-lime");
  el.currentOrders = orders;
  recall.click();
  await el.updateComplete;
  expect(events).toEqual([]);
  expect(q(el, "[data-sent-line-dialog]").hasAttribute("open")).toBe(false);
});

it("A803 portion grouping: the sheet of a grouped row says how much of the group is paid", async () => {
  const el = await openGrouped("held", {
    orderId: "wo-4",
    billBalance: {
      workingOrderId: "wo-4",
      status: "open",
      total: "21.00",
      received: "10.50",
      reserved: "0.00",
      outstanding: "10.50",
      tips: "0.00",
      payments: [],
      paidLines: [{ lineId: "s-1", lineNo: 1, paidQuantity: "1.000" }],
    },
  });
  expect(text(q(el, "[data-sent-line-dialog] [data-line-paid]"))).toBe(
    t("bill_pay.paid_part").replace("{paid}", "1").replace("{quantity}", "2"),
  );
});

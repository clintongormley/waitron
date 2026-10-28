import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, t } from "../i18n/t.js";
import type { TabLine } from "../api/client.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, mount, resized } from "./till-table-order-screen.test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import {
  current,
  currentGroup,
  orderGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";

import {
  storedDish,
  storedExtra,
  storedServed,
} from "./till-table-order-screen.sent-fallback.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it.each([false, true])(
  "retains stored bill rows read-only when current orders are unavailable (unread=%s)",
  async (unread) => {
    const { el } = await mount({
      lines: [storedDish, storedExtra, storedServed],
      currentOrders: null,
      currentOrdersUnread: unread,
      groups: [
        {
          ...orderGroup("held", 1, "held"),
          lineIds: [storedDish.id],
          summary: "Another bill's secret summary",
        },
      ],
    });
    el.style.width = "1280px";
    await resized(el);
    const fallback = el.shadowRoot!.querySelector<HTMLElement>("[data-sent-fallback]");
    expect(fallback, "stored bill details remain visible in Sent").not.toBeNull();
    expect(fallback!.checkVisibility()).toBe(true);
    expect(fallback!.querySelector("h2")!.textContent).toBe(t("table.sent_title"));
    expect(
      [...fallback!.querySelectorAll<HTMLElement>("[data-sent-fallback-line]")].map(
        (node) => node.dataset.sentFallbackLine,
      ),
    ).toEqual(["stored-dish", "stored-served"]);
    const dish = fallback!.querySelector('[data-sent-fallback-line="stored-dish"]')!;
    expect(dish.textContent!.replace(/\s+/g, " ")).toContain("Recorded dish ×2");
    expect(dish.textContent).toContain("No salt $& $'");
    expect(
      dish.querySelector('wt-icon[name="allergen-gluten"]')?.getAttribute("label") ?? "",
    ).toMatch(/rye|centeno/i);
    expect(dish.querySelector('wt-icon[name="diet-kosher"]')).not.toBeNull();
    expect(dish.querySelector("[data-sent-fallback-price]")!.textContent!.replace(/\s/g, "")).toBe(
      "Was€10.00€6.50",
    );
    const extra = dish.querySelector('[data-sent-fallback-extra="stored-extra"]')!;
    expect(extra.textContent!.replace(/\s+/g, " ")).toContain("Recorded extra ×2");
    expect(extra.querySelector("[data-sent-fallback-price]")!.textContent!.replace(/\s/g, "")).toBe(
      "€1.50",
    );
    expect(extra.querySelector('wt-icon[name="allergen-milk"]')).not.toBeNull();
    expect(
      [...fallback!.querySelectorAll<HTMLElement>("[data-sent-fallback-extra]")].map(
        (node) => node.dataset.sentFallbackExtra,
      ),
    ).toEqual(["stored-extra"]);
    expect(
      fallback!
        .querySelector('[data-sent-fallback-line="stored-served"]')!
        .textContent!.replace(/\s+/g, " "),
    ).toContain("Recorded served dish ×1");
    expect(fallback!.textContent).not.toContain("Another bill's secret summary");
    expect(fallback!.querySelector("wt-button, button, wt-row-actions, input")).toBeNull();
    const warning = el.shadowRoot!.querySelector("[data-sent-unread]");
    expect(warning?.textContent ?? null).toBe(unread ? t("table.current_orders_unread") : null);
  },
);

it("replaces the incomplete read-only list with the authoritative Sent snapshot", async () => {
  const { el } = await mount({
    lines: [storedDish],
    currentOrders: null,
    currentOrdersUnread: true,
  });
  expect(el.shadowRoot!.querySelector("[data-sent-fallback]")).not.toBeNull();
  el.currentOrders = current({
    groups: [currentGroup("fired", 1, "fired", [row("fresh", "Latest dish", "1.000")])],
    ungrouped: [],
    reminder: null,
  });
  el.currentOrdersUnread = false;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-sent-fallback]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-sent-unread]")).toBeNull();
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  expect(panel.snapshot!.current.groups[0]!.rows[0]!.name).toBe("Latest dish");
});

it("does not draw a read-only Sent list for an empty bill or an orphaned extra", async () => {
  const { el } = await mount({ currentOrders: null });
  expect(el.shadowRoot!.querySelector("[data-sent-fallback]")).toBeNull();
  el.lines = [storedExtra];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-sent-fallback]")).toBeNull();
});

it("keeps a recalled family solely in New order when the service read is unavailable", async () => {
  const draft = new DraftStore();
  draft.appendLines([
    {
      product: beer,
      quantity: "2.000",
      draftLineId: "recalled",
      noMerge: true,
      source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
    },
  ]);
  const { el } = await mount({
    lines: [storedDish, storedExtra, storedServed],
    draftStore: draft,
    currentOrders: null,
  });
  const fallback = el.shadowRoot!.querySelector("[data-sent-fallback]");
  expect(fallback).not.toBeNull();
  expect(fallback!.querySelector('[data-sent-fallback-line="stored-dish"]')).toBeNull();
  expect(fallback!.querySelector('[data-sent-fallback-extra="stored-extra"]')).toBeNull();
  expect(fallback!.querySelector('[data-sent-fallback-line="stored-served"]')).not.toBeNull();
  draft.clear();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-sent-fallback-line="stored-dish"]')).not.toBeNull();
});

it("omits a colleague's saved recalled family while leaving unrelated bill rows visible", async () => {
  const { el } = await mount({
    lines: [storedDish, storedExtra, storedServed],
    currentOrders: null,
    otherDrafts: [
      {
        id: "other",
        revision: 2,
        ownerName: "Ana",
        takenFromYou: false,
        lines: [
          {
            product: beer,
            quantity: "2.000",
            draftLineId: "recalled",
            noMerge: true,
            source: { line: storedDish, extras: [storedExtra], netAmount: "8.00" },
          },
        ],
      },
    ],
  });
  expect(el.shadowRoot!.querySelector('[data-sent-fallback-line="stored-dish"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-sent-fallback-extra="stored-extra"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-sent-fallback-line="stored-served"]')).not.toBeNull();
  el.otherDrafts = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-sent-fallback-line="stored-dish"]')).not.toBeNull();
});

it.each([false, true])(
  "keeps full and partial payment facts in read-only Sent when the service read is unavailable (unread=%s)",
  async (unread) => {
    const balance = {
      workingOrderId: "wo-4",
      status: "open" as const,
      total: "14.00",
      received: "10.00",
      reserved: "0.00",
      outstanding: "4.00",
      tips: "0.00",
      payments: [],
      paidLines: [
        { lineId: storedDish.id, lineNo: 1, paidQuantity: "2.000" },
        { lineId: storedExtra.id, lineNo: 2, paidQuantity: "2.000" },
        { lineId: storedServed.id, lineNo: 3, paidQuantity: "1.000" },
      ],
    };
    const { el } = await mount({
      lines: [storedDish, storedExtra, { ...storedServed, quantity: "3.000" }],
      currentOrders: null,
      currentOrdersUnread: unread,
      billBalance: balance,
    });
    const marks = () =>
      [...el.shadowRoot!.querySelectorAll("[data-sent-fallback] [data-line-paid]")].map((mark) =>
        mark.textContent!.trim(),
      );
    expect(marks()).toEqual([
      t("bill_pay.paid"),
      t("bill_pay.paid"),
      t("bill_pay.paid_part").replace("{paid}", "1").replace("{quantity}", "3"),
    ]);
    expect(
      el
        .shadowRoot!.querySelector('[data-sent-fallback-extra="stored-extra"] [data-line-paid]')!
        .textContent!.trim(),
    ).toBe(t("bill_pay.paid"));
    expect(
      el.shadowRoot!.querySelector("[data-sent-fallback] button, [data-sent-fallback] wt-button"),
    ).toBeNull();

    el.billBalance = { ...balance, workingOrderId: "wo-other" };
    await el.updateComplete;
    expect(marks()).toEqual([]);
    el.orderId = "wo-other";
    await el.updateComplete;
    expect(marks()).toHaveLength(3);
    el.billBalance = { ...balance, workingOrderId: "wo-other", paidLines: [] };
    await el.updateComplete;
    expect(marks()).toEqual([]);
    el.billBalance = {
      ...balance,
      workingOrderId: "wo-other",
      paidLines: [{ lineId: storedDish.id, lineNo: 1, paidQuantity: "0.000" }],
    };
    await el.updateComplete;
    expect(marks()).toEqual([]);
    el.billBalance = null;
    await el.updateComplete;
    expect(marks()).toEqual([]);
  },
);

const portion = (id: string, lineNo: number, over: Partial<TabLine> = {}): TabLine => ({
  ...storedServed,
  id,
  lineNo,
  name: "Burger",
  productId: "burger",
  quantity: "1.000",
  priceQuantity: "1.000",
  unitPriceGross: "9.50",
  servedAt: null,
  sentAt: "2026-09-28T19:50:00.000Z",
  firedAt: "2026-09-28T19:50:00.000Z",
  state: "queued",
  nutrition: undefined,
  portion: true,
  ...over,
});
const portionCheese = (id: string, parentLineNo: number): TabLine =>
  portion(id, parentLineNo + 10, {
    name: "Cheese",
    productId: "cheese",
    parentLineNo,
    unitPriceGross: "1.00",
    listId: "toppings",
    state: null,
    portion: false,
  });
const fallbackRows = (el: HTMLElement) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-sent-fallback-line]")].map((node) => [
    node.dataset.sentFallbackLine,
    node.textContent!.replace(/\s+/g, " ").trim(),
  ]);

it("A803 portion grouping: two identical sent portions show one ×2 row, each extra at its count per portion and its price for both", async () => {
  const { el } = await mount({
    lines: [
      portion("burger-1", 1),
      portionCheese("cheese-1", 1),
      portion("burger-2", 2),
      portionCheese("cheese-2", 2),
    ],
    currentOrders: null,
  });
  expect(fallbackRows(el)).toEqual([["burger-1", "Burger ×2 €19.00 Cheese ×1 €2.00"]]);
});

it("A803 portion grouping: two portions of two limes each show Lime ×2, priced for all four", async () => {
  const lime = (id: string, parentLineNo: number) => ({
    ...portionCheese(id, parentLineNo),
    name: "Lime",
    productId: "lime",
    quantity: "2.000",
    unitPriceGross: "0.50",
  });
  const { el } = await mount({
    lines: [portion("burger-1", 1), lime("lime-1", 1), portion("burger-2", 2), lime("lime-2", 2)],
    currentOrders: null,
  });
  expect(fallbackRows(el)).toEqual([["burger-1", "Burger ×2 €19.00 Lime ×2 €2.00"]]);
});

it("A803 portion grouping: a served portion and an unserved one show two rows", async () => {
  const { el } = await mount({
    lines: [
      portion("burger-1", 1),
      portion("burger-2", 2, { servedAt: "2026-09-28T20:00:00.000Z" }),
      portion("burger-3", 3),
    ],
    currentOrders: null,
  });
  expect(fallbackRows(el)).toEqual([
    ["burger-1", "Burger ×2 €19.00"],
    ["burger-2", "Burger ×1 €9.50"],
  ]);
});

it("A803 portion grouping: the Sent panel shows identical portions as one row", async () => {
  const lines = [portion("burger-1", 1), portion("burger-2", 2)];
  const { el } = await mount({
    lines,
    currentOrders: current({
      groups: [
        currentGroup("g1", 1, "fired", [
          row("burger-1", "Burger", "1.000", { lineNo: 1, netAmount: "9.50" }),
          row("burger-2", "Burger", "1.000", { lineNo: 2, netAmount: "9.50" }),
        ]),
      ],
      ungrouped: [],
      reminder: null,
    }),
  });
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  expect(panel.lines).toBe(el.lines);
  if (
    panel.shadowRoot!.querySelector("[data-sent-toggle]")!.getAttribute("aria-expanded") !== "true"
  ) {
    panel.shadowRoot!.querySelector<HTMLButtonElement>("[data-sent-toggle]")!.click();
    await panel.updateComplete;
  }
  expect(
    [...panel.shadowRoot!.querySelectorAll<HTMLElement>("[data-fired-line]")].map((node) => [
      node.dataset.firedLine,
      node.querySelector(".what")!.textContent!.replace(/\s+/g, " ").trim(),
    ]),
  ).toEqual([["burger-1", "Burger ×2"]]);
});

import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale, t } from "../i18n/t.js";
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

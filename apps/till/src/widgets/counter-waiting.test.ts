import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillCounterWaiting } from "./counter-waiting.js";
import type { CounterWaitingOrder } from "../api/client.js";

const paid: CounterWaitingOrder = {
  id: "wo-paid",
  orderNumber: 11,
  label: "Ana",
  status: "settled",
  openedAt: "2026-10-01T10:00:00.000Z",
  settledAt: "2026-10-01T10:01:00.000Z",
  collectedAt: null,
  total: "18.00",
  canHandOver: true,
};

const sent: CounterWaitingOrder = {
  id: "wo-sent",
  orderNumber: 12,
  label: null,
  status: "placed",
  openedAt: "2026-10-01T10:02:00.000Z",
  settledAt: null,
  collectedAt: null,
  total: "7.50",
  canHandOver: true,
};

const handedOver: CounterWaitingOrder = {
  ...sent,
  id: "wo-handed",
  orderNumber: 13,
  collectedAt: "2026-10-01T10:05:00.000Z",
  canHandOver: false,
};

afterEach(cleanupWidgets);

const rowOf = (el: TillCounterWaiting, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-waiting-order="${id}"]`)!;
const buttons = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>("wt-button")].map((b) => b.textContent!.trim());

describe("till-counter-waiting", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-counter-waiting")).toBe(TillCounterWaiting);
  });

  it("renders nothing at all when no order is waiting", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", { orders: [] });
    expect(el.shadowRoot!.textContent!.trim()).toBe("");
    expect(el.shadowRoot!.querySelector("h2")).toBeNull();
  });

  it("titles the list and shows each order's number, label and total", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid, sent],
      canPay: true,
    });
    expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe(t("waiting.title"));
    const row = rowOf(el, "wo-paid");
    expect(row.textContent).toContain("#11");
    expect(row.textContent).toContain("Ana");
    expect(row.textContent).toContain(formatMoney("18.00", currentLocale()));
  });

  it("a paid order not yet handed over says so and offers Hand over only", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid],
      canPay: true,
    });
    const row = rowOf(el, "wo-paid");
    expect(row.querySelector("[data-waiting-state]")!.textContent).toBe(
      t("waiting.paid_not_handed_over"),
    );
    expect(buttons(row)).toEqual([t("waiting.hand_over")]);
  });

  it("a sent, unpaid order says so and offers Pay first, then Hand over", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [sent],
      canPay: true,
    });
    const row = rowOf(el, "wo-sent");
    expect(row.querySelector("[data-waiting-state]")!.textContent).toBe(t("waiting.sent_not_paid"));
    expect(buttons(row)).toEqual([t("action.pay"), t("waiting.hand_over")]);
    expect(row.querySelector("wt-button[data-waiting-pay]")!.getAttribute("variant")).toBe(
      "primary",
    );
    expect(row.querySelector("wt-button[data-waiting-hand-over]")!.getAttribute("variant")).toBe(
      "secondary",
    );
  });

  it("a sent order that cannot be handed over yet offers Pay alone", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [{ ...sent, canHandOver: false }],
      canPay: true,
    });
    expect(buttons(rowOf(el, "wo-sent"))).toEqual([t("action.pay")]);
  });

  it("an order handed over and not paid says so and offers Pay only", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [handedOver],
      canPay: true,
    });
    const row = rowOf(el, "wo-handed");
    expect(row.querySelector("[data-waiting-state]")!.textContent).toBe(
      t("waiting.handed_over_not_paid"),
    );
    expect(buttons(row)).toEqual([t("action.pay")]);
  });

  it("offers no Pay on a till that cannot take a sent order's payment", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [sent, handedOver],
      canPay: false,
    });
    expect(buttons(rowOf(el, "wo-sent"))).toEqual([t("waiting.hand_over")]);
    expect(buttons(rowOf(el, "wo-handed"))).toEqual([]);
  });

  it("names each button with the order it acts on", async () => {
    const { el } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [paid, sent],
      canPay: true,
    });
    expect(rowOf(el, "wo-paid").querySelector("wt-button[data-waiting-hand-over]")!.ariaLabel).toBe(
      `${t("waiting.hand_over")} #11 Ana`,
    );
    expect(rowOf(el, "wo-sent").querySelector("wt-button[data-waiting-pay]")!.ariaLabel).toBe(
      `${t("action.pay")} #12`,
    );
  });

  it("Hand over and Pay ask the app, naming the order, past the widget's shadow root", async () => {
    const { el, host } = await mountWidget<TillCounterWaiting>("till-counter-waiting", {
      orders: [sent],
      canPay: true,
    });
    const seen: [string, unknown][] = [];
    for (const type of ["hand-over-order", "pay-waiting-order"])
      host.addEventListener(type, (event) => seen.push([type, (event as CustomEvent).detail]));
    const row = rowOf(el, "wo-sent");
    row.querySelector<HTMLElement>("wt-button[data-waiting-hand-over]")!.click();
    row.querySelector<HTMLElement>("wt-button[data-waiting-pay]")!.click();
    expect(seen).toEqual([
      ["hand-over-order", { id: "wo-sent" }],
      ["pay-waiting-order", { id: "wo-sent" }],
    ]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./counter-waiting.js";
import type { TillCounterWaiting } from "./counter-waiting.js";
import type { CounterWaitingOrder } from "../api/client.js";

const sent: CounterWaitingOrder = {
  id: "wo-sent",
  orderNumber: 12,
  label: "Ana",
  status: "placed",
  openedAt: "2026-10-01T10:02:00.000Z",
  settledAt: null,
  collectedAt: null,
  total: "7.50",
  canHandOver: true,
  serviceMode: "ticket_then_pay",
  movableDishes: [],
};

const orders: CounterWaitingOrder[] = [
  sent,
  {
    ...sent,
    id: "wo-handed",
    orderNumber: 13,
    label: null,
    collectedAt: "2026-10-01T10:05:00.000Z",
    canHandOver: false,
  },
  {
    ...sent,
    id: "wo-paid",
    orderNumber: 11,
    status: "settled",
    settledAt: "2026-10-01T10:01:00.000Z",
    serviceMode: null,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-counter-waiting a11y (%s theme)", (theme) => {
  it("all three waiting states, with Pay and Hand over, have no violations", async () => {
    const { el, host } = await mountWidget<TillCounterWaiting>(
      "till-counter-waiting",
      { orders },
      theme,
    );
    expect(el.shadowRoot!.querySelectorAll("[data-waiting-state]")).toHaveLength(3);
    await expectNoA11yViolations(host);
  });

  it("an invoiced, unpaid order with Cancel and credit has no violations", async () => {
    const { el, host } = await mountWidget<TillCounterWaiting>(
      "till-counter-waiting",
      { orders: [{ ...sent, serviceMode: "ticket_then_pay", invoiceNumber: "A/12" }] },
      theme,
    );
    expect(el.shadowRoot!.querySelector("[data-waiting-cancel-credit]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

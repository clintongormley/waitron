import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./held-orders.js";
import type { TillHeldOrders } from "./held-orders.js";
import type { HeldOrderSummary } from "../api/client.js";

const orders: HeldOrderSummary[] = [
  {
    id: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    itemCount: 2,
    total: "3.00",
    openedAt: "2026-08-05T10:00:00.000Z",
  },
  {
    id: "wo-2",
    orderNumber: 6,
    label: null,
    itemCount: 1,
    total: "1.50",
    openedAt: "2026-08-05T10:05:00.000Z",
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-held-orders a11y (%s theme)", (theme) => {
  it("an empty held-orders list has no violations", async () => {
    const { host } = await mountWidget<TillHeldOrders>("till-held-orders", { orders: [] }, theme);
    await expectNoA11yViolations(host);
  });

  it("a populated held-orders list (with Retrieve/Discard controls) has no violations", async () => {
    const { host } = await mountWidget<TillHeldOrders>("till-held-orders", { orders }, theme);
    await expectNoA11yViolations(host);
  });
});

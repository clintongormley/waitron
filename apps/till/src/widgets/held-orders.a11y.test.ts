import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./held-orders.js";
import type { TillHeldOrders } from "./held-orders.js";
import type { HeldOrderSummary, TableState } from "../api/client.js";

const orders: HeldOrderSummary[] = [
  {
    id: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    itemCount: 2,
    total: "3.00",
    outstanding: "3.00",
    hasPayments: false,
    partyId: null,
    openedAt: "2026-08-05T10:00:00.000Z",
  },
  {
    id: "wo-2",
    orderNumber: 6,
    label: null,
    itemCount: 1,
    total: "1.50",
    outstanding: "1.50",
    hasPayments: false,
    partyId: null,
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

  const tableRow = (id: string, label: string, over: Partial<TableState> = {}): TableState => ({
    id,
    label,
    zoneId: "z1",
    capacity: 4,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    party: null,
    ...over,
  });
  const tables: TableState[] = [
    tableRow("t7", "Mesa 7", {
      state: "open-tab",
      condition: "held",
      party: {
        id: "v7",
        revision: 9,
        guestCount: 2,
        state: "open",
        name: "Luis",
        displayName: "Luis",
        mainBillId: "wo-7",
        outstanding: "12.00",
        billCount: 1,
        tableIds: ["t7"],
        unsentDrafts: [],
        reminder: null,
      },
    }),
    tableRow("t6", "Mesa 6", { condition: "needs_clearing" }),
    tableRow("t9", "Mesa 9"),
  ];

  it("a partly paid order and Move to table have no violations", async () => {
    const partlyPaid = { ...orders[0]!, outstanding: "1.00", hasPayments: true };
    const { host } = await mountWidget<TillHeldOrders>(
      "till-held-orders",
      { orders: [partlyPaid, orders[1]!], tables },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the table picker, with a free, a seated and a disabled table, has no violations", async () => {
    const { el, host } = await mountWidget<TillHeldOrders>(
      "till-held-orders",
      { orders, tables },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.move")!.click();
    await el.updateComplete;
    if (el.shadowRoot!.querySelector('[data-target-reason="t6"]') === null)
      throw new Error("the scan must include the table needing clearing");
    await expectNoA11yViolations(host);
  });

  it("the bill choice for an order moving to a seated table has no violations", async () => {
    const { el, host } = await mountWidget<TillHeldOrders>(
      "till-held-orders",
      { orders, tables },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.move")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-target="t7"]')!.click();
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-bill-choice-dialog",
    );
    if (dialog === null) throw new Error("the scan must include the bill choice");
    await dialog.updateComplete;
    await expectNoA11yViolations(host);
  });
});

import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./bill-pay-dialog.js";
import type { PayLine, PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type { AllocationPreview, BillBalance, BillPaymentView } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const balance: BillBalance = {
  workingOrderId: "wo-4",
  status: "open",
  total: "120.00",
  received: "50.00",
  reserved: "20.00",
  outstanding: "50.00",
  tips: "0.00",
  payments: [],
  paidLines: [{ lineId: "l-3", lineNo: 3, paidQuantity: "1.000" }],
};

const lines: PayLine[] = [
  { lineNo: 1, name: "Paella", quantity: "1", total: "35.00", unitTotal: null },
  { lineNo: 2, name: "Caña", quantity: "3", total: "9.00", unitTotal: "3.00" },
  { lineNo: 3, name: "Tiramisú", quantity: "1", total: "6.00", unitTotal: null },
];

const pressed = async (el: TillBillPayDialog, selector: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
};

async function typed(el: TillBillPayDialog, name: string, value: string): Promise<void> {
  const input = el
    .shadowRoot!.querySelector(`wt-input[name="${name}"]`)!
    .shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

/** Continue, answered with `preview` as the app answers it. */
async function previewed(el: TillBillPayDialog, preview: AllocationPreview): Promise<void> {
  let asked: PayRequest | undefined;
  el.addEventListener("bill-pay-preview", (event) => {
    asked = (event as CustomEvent<PayRequest>).detail;
  });
  await pressed(el, "[data-pay-continue]");
  el.asked = asked!;
  el.preview = preview;
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("till-bill-pay-dialog a11y (%s theme)", (theme) => {
  const mount = (over: Partial<TillBillPayDialog> = {}) =>
    mountWidget<TillBillPayDialog>(
      "till-bill-pay-dialog",
      { balance, lines, way: "items", ...over },
      theme,
    );

  it("has no violations choosing items, with the units of a line", async () => {
    const { el, host } = await mount();
    await pressed(el, 'input[name="line"][value="2"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations with every field marked after an empty submission", async () => {
    const { el, host } = await mount();
    await pressed(el, "[data-pay-continue]");
    await expectNoA11yViolations(host);
  });

  it("has no violations contributing by card, with a refusal beside the action", async () => {
    const { el, host } = await mount({
      way: "contribution",
      refusal: { code: "bill.nothing_outstanding" },
    });
    await pressed(el, 'input[name="method"][value="card"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations splitting equally, while the balance is read", async () => {
    const { host } = await mount({ way: "share", balance: null });
    await expectNoA11yViolations(host);
  });

  it("has no violations when every item is paid and a payment was just taken", async () => {
    const { host } = await mount({
      lines: [lines[2]!],
      taken: { change: "10.00" },
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations confirming cash, leaving part of the change as a tip that is too much", async () => {
    const { el, host } = await mount();
    await pressed(el, 'input[name="line"][value="1"]');
    await typed(el, "tendered", "50");
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "35.00",
      tip: "0.00",
      change: "15.00",
      charged: null,
    });
    await pressed(el, 'input[name="leaveTip"][value="part"]');
    await typed(el, "tipAmount", "20");
    await pressed(el, "[data-pay-confirm]");
    await expectNoA11yViolations(host);
  });

  it("has no violations confirming a card whose amounts changed", async () => {
    const { el, host } = await mount({ way: "contribution" });
    await typed(el, "amount", "40");
    await pressed(el, 'input[name="method"][value="card"]');
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "10.00",
      change: null,
      charged: "50.00",
    });
    el.refusal = { code: "bill.allocation_changed" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations offering the steak's two choices", async () => {
    const { el, host } = await mount({
      lines: [
        ...lines,
        { lineNo: 4, name: "Chuletón", quantity: "1", total: "25.00", unitTotal: null },
      ],
      balance: { ...balance, received: "105.00", reserved: "0.00", outstanding: "15.00" },
    });
    await pressed(el, 'input[name="line"][value="4"]');
    await typed(el, "tendered", "30");
    await previewed(el, {
      kind: "choose",
      options: [
        { choice: "full_with_tip", applied: "15.00", tip: "10.00" },
        { choice: "use_pool", applied: "15.00", tip: "0.00" },
      ],
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations when a venue without tips refuses a card contribution larger than is left", async () => {
    const { el, host } = await mount({ way: "contribution", tipsEnabled: false });
    await typed(el, "amount", "50");
    await pressed(el, 'input[name="method"][value="card"]');
    el.refusal = { code: "bill.tip_not_allowed", chargeable: "30.00" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations choosing a card reader", async () => {
    const { el, host } = await mount({
      way: "contribution",
      cardReader: "stripe_terminal",
      readers: [
        { id: "r-1", name: "Barra", provider: "stripe_terminal" },
        { id: "r-2", name: "Terraza", provider: "stripe_terminal" },
      ],
      defaultReaderId: "r-1",
    });
    await pressed(el, 'input[name="method"][value="card"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations choosing the practice simulator's result", async () => {
    const { el, host } = await mount({ way: "contribution", cardReader: "simulator" });
    await pressed(el, 'input[name="method"][value="card"]');
    await expectNoA11yViolations(host);
  });

  it("has no violations while the card reader is asked, then when it declines", async () => {
    const { el, host } = await mount({ way: "contribution", cardReader: "stripe_terminal" });
    await typed(el, "amount", "40");
    await pressed(el, 'input[name="method"][value="card"]');
    await previewed(el, {
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "0.00",
      change: null,
      charged: "40.00",
    });
    el.busy = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.busy = false;
    el.refusal = { code: "declined" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations when a card is still in progress at the reader", async () => {
    const { host } = await mount({
      taken: { change: null, pending: "40.00" },
      balance: { ...balance, reserved: "40.00" },
    });
    await expectNoA11yViolations(host);
  });
  it("has no violations listing the bill's payments, one refunded, one at the reader, one declined, after a refund", async () => {
    const payment = (over: Partial<BillPaymentView>): BillPaymentView => ({
      id: "pay-1",
      submissionId: "sub-1",
      kind: "contribution",
      shareOf: null,
      method: "cash",
      entry: null,
      applied: "50.00",
      tip: "0.00",
      tendered: "50.00",
      change: "0.00",
      state: "received",
      createdAt: "2026-09-30T20:00:00.000Z",
      receivedAt: "2026-09-30T20:00:00.000Z",
      lines: [],
      refunds: [],
      ...over,
    });
    const { host } = await mount({
      refunded: { state: "pending", amount: "10.00", method: "card", terminal: false },
      balance: {
        ...balance,
        payments: [
          payment({
            refunds: [
              {
                id: "r-1",
                paymentId: "pay-1",
                submissionId: "rs-1",
                appliedAmount: "10.00",
                tipAmount: "0.00",
                reason: "Cobrado de más",
                state: "completed",
                createdAt: "2026-09-30T20:10:00.000Z",
                completedAt: "2026-09-30T20:10:00.000Z",
              },
            ],
          }),
          payment({ id: "pay-2", method: "card", tip: "5.00", tendered: null, change: null }),
          payment({ id: "pay-3", method: "card", state: "pending", tendered: null, change: null }),
          payment({ id: "pay-4", method: "card", state: "declined", tendered: null, change: null }),
        ],
      },
    });
    await expectNoA11yViolations(host);
  });
});

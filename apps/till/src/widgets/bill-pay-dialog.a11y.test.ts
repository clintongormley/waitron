import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./bill-pay-dialog.js";
import type { PayLine, PayRequest, TillBillPayDialog } from "./bill-pay-dialog.js";
import type { AllocationPreview, BillBalance } from "../api/client.js";

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
});

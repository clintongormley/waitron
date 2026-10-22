import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./bill-refund-dialog.js";
import type { TillBillRefundDialog } from "./bill-refund-dialog.js";
import type { AdjustmentReason, BillPaymentView } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const card: BillPaymentView = {
  id: "pay-1",
  submissionId: "sub-1",
  kind: "contribution",
  shareOf: null,
  method: "card",
  entry: "manual",
  applied: "40.00",
  tip: "5.00",
  tendered: null,
  change: null,
  state: "received",
  createdAt: "2026-09-30T20:00:00.000Z",
  receivedAt: "2026-09-30T20:00:00.000Z",
  lines: [],
  refunds: [],
};

const reasons = [
  { id: "twice", name: "Charged twice", noteRequired: false },
  { id: "other", name: "Other", noteRequired: true },
].map(
  (reason) =>
    ({
      ...reason,
      kind: "void",
      actions: ["cancel"],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: [],
      approverRoles: [],
    }) as AdjustmentReason,
);

const pressed = async (el: TillBillRefundDialog, selector: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
};

describe.each(["light", "dark"] as const)("till-bill-refund-dialog a11y (%s theme)", (theme) => {
  const mount = (over: Partial<TillBillRefundDialog> = {}) =>
    mountWidget<TillBillRefundDialog>(
      "till-bill-refund-dialog",
      { payment: card, reasons, ...over },
      theme,
    );

  it("has no violations giving back the whole payment", async () => {
    const { host } = await mount();
    await expectNoA11yViolations(host);
  });

  it("has no violations giving back part, with every field marked", async () => {
    const { el, host } = await mount();
    await pressed(el, 'input[name="howMuch"][value="part"]');
    await pressed(el, "[data-refund-continue]");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the reason drop-down and Other's note marked", async () => {
    const { el, host } = await mount();
    el.shadowRoot!.querySelector("wt-combobox[name=reason]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "other" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await pressed(el, "[data-refund-continue]");
    await expectNoA11yViolations(host);
  });

  it("has no violations when the reasons could not be read", async () => {
    const { host } = await mount({ reasons: null });
    await expectNoA11yViolations(host);
  });

  it("has no violations opening on a suggested part of a card taken at a reader", async () => {
    const { host } = await mount({ payment: { ...card, entry: "reader" }, suggested: "20.00" });
    await expectNoA11yViolations(host);
  });

  it("has no violations giving back an item payment whole, with a refusal above the action", async () => {
    const { host } = await mount({
      payment: { ...card, kind: "items", method: "cash", tip: "0.00" },
      refusal: { code: "bill.refund_in_progress" },
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations asking to give a card back on its terminal, while it is sent", async () => {
    const { host } = await mount({ terminal: true, busy: true });
    await expectNoA11yViolations(host);
  });
});

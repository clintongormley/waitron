import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./tender-refund-dialog.js";
import type { TillTenderRefundDialog } from "./tender-refund-dialog.js";
import type { RefundableTender, TenderRefundView } from "../api/tender-refund-types.js";

const card: RefundableTender = {
  tenderId: "card-1",
  method: "card",
  last4: "0042",
  appliedRemaining: "40.00",
  tipRemaining: "5.00",
  manual: false,
  pendingRefundId: null,
};
const result: TenderRefundView = {
  id: "r1",
  saleId: "s1",
  tenderId: "card-1",
  state: "pending",
  appliedAmount: "12.50",
  tipAmount: "0.00",
  createdAt: "2026-10-16T10:00:00Z",
  completedAt: null,
};
beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("settled-tender refund accessibility (%s)", (theme) => {
  const mount = (over: Partial<TillTenderRefundDialog> = {}) =>
    mountWidget<TillTenderRefundDialog>(
      "till-tender-refund-dialog",
      { tenders: [card], invoiceNumber: "F/0012", ...over },
      theme,
    );
  it("has no violations with mixed original payments", async () => {
    const { host } = await mount({
      tenders: [card, { ...card, tenderId: "cash-1", method: "cash", last4: null }],
    });
    await expectNoA11yViolations(host);
  });
  it("has no violations with required cash fields and handover marked", async () => {
    const { el, host } = await mount({ tenders: [{ ...card, method: "cash", last4: null }] });
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
  it("has no violations with manual-terminal confirmation while busy", async () => {
    const { host } = await mount({ tenders: [{ ...card, manual: true }], busy: true });
    await expectNoA11yViolations(host);
  });
  it("has no violations with an unknown request frozen and recoverable", async () => {
    const { host } = await mount({
      attempt: {
        saleId: "s1",
        request: {
          submissionId: "sub1",
          tenderId: "card-1",
          appliedAmount: "12.50",
          tipAmount: "0.00",
          reason: "Saved return",
        },
        refundId: null,
      },
      refusal: { code: "network" },
    });
    await expectNoA11yViolations(host);
  });
  for (const state of ["pending", "completed", "failed"] as const) {
    it(`has no violations for the ${state} outcome`, async () => {
      const { host } = await mount({ result: { ...result, state } });
      await expectNoA11yViolations(host);
    });
  }
  it("has no violations showing a refund already pending on the server", async () => {
    const { host } = await mount({
      tenders: [{ ...card, pendingRefundId: "r1", appliedRemaining: "0.00", tipRemaining: "0.00" }],
    });
    await expectNoA11yViolations(host);
  });
  it("has no violations with no refundable cash or card payment", async () => {
    const { host } = await mount({ tenders: [] });
    await expectNoA11yViolations(host);
  });
});

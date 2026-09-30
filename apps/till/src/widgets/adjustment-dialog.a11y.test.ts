import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./adjustment-dialog.js";
import type { AdjustmentChoice, AdjustTarget, TillAdjustmentDialog } from "./adjustment-dialog.js";
import type { AdjustmentPreview, AdjustmentReason } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

const reasons: AdjustmentReason[] = [
  {
    id: "queja",
    name: "Queja",
    actions: ["comp", "discount_percent", "discount_amount"],
    noteRequired: false,
    maxPercentBp: 5000,
    maxAmount: "30.00",
    applyRole: "supervisor",
    approverRole: "manager",
  },
  {
    id: "error",
    name: "Error",
    actions: ["cancel"],
    noteRequired: true,
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "staff",
  },
];

const steaks: AdjustTarget = {
  lineId: "line-2",
  name: "Chuletón",
  quantity: "2",
  total: "50.00",
  unitTotal: "25.00",
};

/** Continue, answered as the app answers it: the choice previewed, and the preview. */
async function previewed(el: TillAdjustmentDialog, preview: AdjustmentPreview): Promise<void> {
  let asked: AdjustmentChoice | undefined;
  el.addEventListener("adjust-preview", (event) => {
    asked = (event as CustomEvent<AdjustmentChoice>).detail;
  });
  await pressed(el, "[data-adjust-continue]");
  el.choice = asked!;
  el.preview = preview;
  await el.updateComplete;
}

const pressed = async (el: TillAdjustmentDialog, selector: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await el.updateComplete;
};

describe.each(["light", "dark"] as const)("till-adjustment-dialog a11y (%s theme)", (theme) => {
  const mount = (over: Partial<TillAdjustmentDialog>) =>
    mountWidget<TillAdjustmentDialog>(
      "till-adjustment-dialog",
      { kind: "comp", target: steaks, reasons, ...over },
      theme,
    );

  it("has no violations when a give-away opens", async () => {
    const { host } = await mount({});
    await expectNoA11yViolations(host);
  });

  it("has no violations with every field of a discount marked after an empty submission", async () => {
    const { el, host } = await mount({ kind: "discount" });
    await pressed(el, "[data-adjust-continue]");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a cancel's required note marked", async () => {
    const { el, host } = await mount({ kind: "cancel", target: { ...steaks, started: true } });
    await pressed(el, 'input[name="reason"]');
    await pressed(el, "[data-adjust-continue]");
    await expectNoA11yViolations(host);
  });

  it("has no violations when no reason allows the action", async () => {
    const { host } = await mount({ kind: "cancel", reasons: [reasons[0]!] });
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal beside the action", async () => {
    const { host } = await mount({ refusal: "bill.line_paid" });
    await expectNoA11yViolations(host);
  });

  it("has no violations asking for approval of one of two units before confirming", async () => {
    const { el, host } = await mount({});
    await pressed(el, 'input[name="quantity"][value="1"]');
    await pressed(el, 'input[name="reason"]');
    await previewed(el, {
      reduction: "50.00",
      nominalValue: "50.00",
      needsApproval: "manager",
      overBillDiscountLimit: false,
      lines: [],
    });
    await expectNoA11yViolations(host);
  });

  it("has no violations saying the bill's discount limit is why a manager must approve", async () => {
    const { el, host } = await mount({ kind: "discount" });
    await pressed(el, 'input[name="reason"]');
    const input = el
      .shadowRoot!.querySelector('wt-input[name="percent"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "30";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    await previewed(el, {
      reduction: "15.00",
      nominalValue: "50.00",
      needsApproval: "manager",
      overBillDiscountLimit: true,
      lines: [],
    });
    expect(el.shadowRoot!.querySelector("[data-over-bill-limit]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations showing the nearest amount and a refusal before confirming", async () => {
    const { el, host } = await mount({ kind: "discount" });
    await pressed(el, 'input[name="discountKind"][value="amount"]');
    await pressed(el, 'input[name="reason"]');
    const input = el
      .shadowRoot!.querySelector('wt-input[name="amount"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = "3,27";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    await previewed(el, {
      reduction: "3.28",
      nominalValue: "50.00",
      needsApproval: null,
      overBillDiscountLimit: false,
      lines: [],
    });
    el.refusal = "order.payment_in_flight";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

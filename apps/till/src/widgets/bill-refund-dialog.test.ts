import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./bill-refund-dialog.js";
import type { TillBillRefundDialog } from "./bill-refund-dialog.js";
import type { BillPaymentView } from "../api/client.js";
import type { RefundAsk } from "../state/bill-payment.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function paymentOf(over: Partial<BillPaymentView> = {}): BillPaymentView {
  return {
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
  };
}

const cardWithTip = paymentOf({
  method: "card",
  applied: "40.00",
  tip: "5.00",
  tendered: null,
  change: null,
});

async function mount(over: Partial<TillBillRefundDialog> = {}) {
  const { el } = await mountWidget<TillBillRefundDialog>("till-bill-refund-dialog", {
    payment: paymentOf(),
    ...over,
  });
  return el;
}

const root = (el: TillBillRefundDialog) => el.shadowRoot!;
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const field = (el: TillBillRefundDialog, name: string) =>
  root(el).querySelector<
    HTMLElement & { error: string; required: boolean; updateComplete: Promise<unknown> }
  >(`wt-input[name="${name}"]`);
const actions = (el: TillBillRefundDialog) =>
  root(el).querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
const button = (el: TillBillRefundDialog, selector: string) =>
  root(el).querySelector<HTMLElement & { disabled: boolean }>(selector)!;

async function type(el: TillBillRefundDialog, name: string, value: string): Promise<void> {
  const input = field(el, name)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

async function click(el: TillBillRefundDialog, selector: string): Promise<void> {
  button(el, selector).click();
  await el.updateComplete;
}

async function pick(el: TillBillRefundDialog, value: string): Promise<void> {
  root(el).querySelector<HTMLInputElement>(`input[name="howMuch"][value="${value}"]`)!.click();
  await el.updateComplete;
}

function capture<T>(el: TillBillRefundDialog, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

describe("till-bill-refund-dialog: how much and why", () => {
  it("gives back the whole payment, its tip with it, with the reason typed", async () => {
    const el = await mount({ payment: cardWithTip });
    const asked = capture<RefundAsk>(el, "bill-refund-continue");

    expect(text(root(el).querySelector('input[value="whole"]')!.closest("label"))).toBe(
      t("bill_refund.whole_tip")
        .replace("{amount}", money("45.00"))
        .replace("{tip}", money("5.00")),
    );
    await type(el, "reason", "  Charged twice ");
    expect(text(button(el, "[data-refund-continue]"))).toBe(
      t("bill_refund.continue").replace("{amount}", money("45.00")),
    );
    await click(el, "[data-refund-continue]");

    expect(asked).toEqual([{ appliedAmount: "40.00", tipAmount: "5.00", reason: "Charged twice" }]);
  });

  it("gives back part of a payment, never its tip", async () => {
    const el = await mount({ payment: cardWithTip });
    const asked = capture<RefundAsk>(el, "bill-refund-continue");

    await pick(el, "part");
    await type(el, "amount", "12,5");
    await type(el, "reason", "Charged too much");
    await click(el, "[data-refund-continue]");

    expect(asked).toEqual([
      { appliedAmount: "12.50", tipAmount: "0.00", reason: "Charged too much" },
    ]);
  });

  it("counts only what is left after earlier refunds", async () => {
    const el = await mount({
      payment: paymentOf({
        refunds: [
          {
            id: "r-1",
            paymentId: "pay-1",
            submissionId: "s-1",
            appliedAmount: "20.00",
            tipAmount: "0.00",
            reason: "Mal cobrado",
            state: "completed",
            createdAt: "2026-09-30T20:10:00.000Z",
            completedAt: "2026-09-30T20:10:00.000Z",
          },
        ],
      }),
    });

    expect(text(root(el).querySelector('input[value="whole"]')!.closest("label"))).toBe(
      t("bill_refund.whole").replace("{amount}", money("30.00")),
    );
  });

  it("gives an item payment back only whole, asking for no amount", async () => {
    const el = await mount({ payment: paymentOf({ kind: "items", applied: "35.00" }) });
    const asked = capture<RefundAsk>(el, "bill-refund-continue");

    expect(root(el).querySelector('input[name="howMuch"]')).toBeNull();
    expect(field(el, "amount")).toBeNull();
    expect(text(root(el).querySelector("[data-refund-whole-only]"))).toBe(
      t("bill_refund.whole_only").replace("{amount}", money("35.00")),
    );
    await type(el, "reason", "Wrong dish");
    await click(el, "[data-refund-continue]");

    expect(asked).toEqual([{ appliedAmount: "35.00", tipAmount: "0.00", reason: "Wrong dish" }]);
  });

  it("marks the reason required, says it under the field and above the action, and sends nothing", async () => {
    const el = await mount();
    const asked = capture<RefundAsk>(el, "bill-refund-continue");

    expect(field(el, "reason")!.required).toBe(true);
    await click(el, "[data-refund-continue]");

    expect(asked).toEqual([]);
    expect(field(el, "reason")!.error).toBe(t("bill_refund.reason_invalid"));
    expect(actions(el).error).toBe(t("form.fix_fields"));
    expect(button(el, "[data-refund-continue]").disabled).toBe(true);
    await type(el, "reason", "x".repeat(501));
    expect(field(el, "reason")!.error).toBe(t("bill_refund.reason_long"));
    await type(el, "reason", "Charged twice");
    expect(field(el, "reason")!.error).toBe("");
    expect(button(el, "[data-refund-continue]").disabled).toBe(false);
  });

  it("refuses a part above what the payment took, or of nothing", async () => {
    const el = await mount();
    await pick(el, "part");
    await type(el, "reason", "Charged too much");
    const limit = t("bill_refund.amount_invalid").replace("{amount}", money("50.00"));

    for (const typed of ["", "0", "50.01", "abc"]) {
      await type(el, "amount", typed);
      await click(el, "[data-refund-continue]");
      expect(field(el, "amount")!.error).toBe(limit);
    }
    await type(el, "amount", "50");
    expect(field(el, "amount")!.error).toBe("");
  });

  it("continues on Enter in the amount or the reason", async () => {
    const el = await mount();
    const asked = capture<RefundAsk>(el, "bill-refund-continue");
    const enter = (name: string) =>
      field(el, name)!
        .shadowRoot!.querySelector("input")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
        );
    await pick(el, "part");
    await type(el, "amount", "5");
    await type(el, "reason", "Charged too much");

    enter("amount");
    await el.updateComplete;
    enter("reason");
    await el.updateComplete;

    expect(asked).toHaveLength(2);
    expect(asked[0]).toEqual({
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Charged too much",
    });
  });

  it("closes when its dialog is dismissed", async () => {
    const el = await mount();
    const closed = capture<unknown>(el, "bill-refund-close");
    root(el).querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));
    expect(closed).toHaveLength(1);
  });

  it("closes on Cancel, and not while a request is out", async () => {
    const el = await mount();
    const closed = capture<unknown>(el, "bill-refund-close");
    await click(el, "[data-refund-close]");
    expect(closed).toHaveLength(1);

    el.busy = true;
    await el.updateComplete;
    expect(button(el, "[data-refund-close]").disabled).toBe(true);
    expect(button(el, "[data-refund-continue]").disabled).toBe(true);
  });
});

describe("till-bill-refund-dialog: the server's refusals", () => {
  it("shows a refusal above the action in its own words", async () => {
    const el = await mount();
    el.refusal = { code: "bill.refund_in_progress" };
    await el.updateComplete;

    expect(actions(el).error).toBe(codeMessage("bill.refund_in_progress"));
  });

  it("puts a refusal of the amount under the amount, and of the reason under the reason", async () => {
    const el = await mount();
    await pick(el, "part");
    el.refusal = { code: "bill.refund_exceeds_payment" };
    await el.updateComplete;
    expect(field(el, "amount")!.error).toBe(codeMessage("bill.refund_exceeds_payment"));
    expect(actions(el).error).toBe(t("form.fix_fields"));

    el.refusal = { code: "management.request_invalid", field: "reason" };
    await el.updateComplete;
    expect(field(el, "reason")!.error).toBe(codeMessage("management.request_invalid"));
    await type(el, "reason", "Charged twice");
    expect(field(el, "reason")!.error).toBe("");
  });

  it("puts a refused amount above the action when the whole payment is given back, and a refusal naming another field there too", async () => {
    const el = await mount();
    el.refusal = { code: "bill.refund_exceeds_payment" };
    await el.updateComplete;
    expect(actions(el).error).toBe(codeMessage("bill.refund_exceeds_payment"));

    el.refusal = { code: "management.request_invalid", field: "tipAmount" };
    await el.updateComplete;
    expect(actions(el).error).toBe(codeMessage("management.request_invalid"));

    await pick(el, "part");
    el.refusal = { code: "management.request_invalid", field: "appliedAmount" };
    await el.updateComplete;
    expect(field(el, "amount")!.error).toBe(codeMessage("management.request_invalid"));

    el.refusal = { code: "management.request_invalid", field: "submissionId" };
    await el.updateComplete;
    expect(field(el, "amount")!.error).toBe("");
    expect(actions(el).error).toBe(codeMessage("management.request_invalid"));
  });

  it("says a refund that got no answer may have been made, and who can approve could not be read", async () => {
    const el = await mount();
    el.refusal = { code: "network" };
    await el.updateComplete;
    expect(actions(el).error).toBe(t("bill_refund.unconfirmed"));

    el.refusal = { code: "approvers" };
    await el.updateComplete;
    expect(actions(el).error).toBe(t("bill_refund.approvers_failed"));
  });
});

describe("till-bill-refund-dialog: a card keyed on a separate terminal", () => {
  it("says before it continues that a keyed card is given back on its terminal next, and any other payment approved next", async () => {
    const keyed = await mount({ payment: { ...cardWithTip, entry: "manual" } });
    expect(text(root(keyed).querySelector("[data-refund-next]"))).toBe(
      t("bill_refund.terminal_next"),
    );
    const read = await mount({ payment: { ...cardWithTip, entry: "reader" } });
    expect(text(root(read).querySelector("[data-refund-next]"))).toBe(
      t("bill_refund.approval_next"),
    );
  });

  it("says to give it back on the terminal first, then confirms it with the same amounts", async () => {
    const el = await mount({ payment: cardWithTip });
    const asked = capture<RefundAsk>(el, "bill-refund-continue");
    await pick(el, "part");
    await type(el, "amount", "10");
    await type(el, "reason", "Charged too much");
    await click(el, "[data-refund-continue]");

    el.terminal = true;
    await el.updateComplete;

    expect(text(root(el).querySelector("[data-refund-terminal]"))).toBe(
      t("bill_refund.terminal").replace("{amount}", money("10.00")),
    );
    expect(root(el).querySelector("[data-refund-terminal]")!.getAttribute("role")).toBeNull();
    expect(field(el, "reason")).toBeNull();
    expect(root(el).querySelector("[data-refund-continue]")).toBeNull();
    await click(el, "[data-refund-terminal-done]");

    expect(asked).toEqual([
      { appliedAmount: "10.00", tipAmount: "0.00", reason: "Charged too much" },
      {
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Charged too much",
        manualConfirmed: true,
      },
    ]);
    expect(text(button(el, "[data-refund-terminal-done]"))).toBe(t("bill_refund.terminal_done"));
  });
});

for (const locale of ["en", "es"]) {
  it(`decimal input amount follows ${locale}`, async () => {
    setLocale(locale);
    const el = await mount();
    await pick(el, "part");
    const control = field(el, "amount")!;
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    for (const separator of [".", ","]) {
      await type(el, "amount", `2${separator}80`);
      await control.updateComplete;
      expect(native.value).toBe(locale === "es" ? "2,80" : "2.80");
    }
  });
}

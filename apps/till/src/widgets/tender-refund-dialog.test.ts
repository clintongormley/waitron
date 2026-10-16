import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent, page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { RefundableTender } from "../api/tender-refund-types.js";
import type { TenderRefundAsk } from "../state/tender-refund.js";
import "./tender-refund-dialog.js";
import type { TillTenderRefundDialog } from "./tender-refund-dialog.js";

const card: RefundableTender = {
  tenderId: "card-1",
  method: "card",
  last4: "0042",
  appliedRemaining: "40.00",
  tipRemaining: "5.00",
  manual: false,
  pendingRefundId: null,
};
const cash: RefundableTender = { ...card, tenderId: "cash-1", method: "cash", last4: null };
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(over: Partial<TillTenderRefundDialog> = {}) {
  const { el } = await mountWidget<TillTenderRefundDialog>("till-tender-refund-dialog", {
    tenders: [card],
    invoiceNumber: "F/0012",
    ...over,
  });
  await el.updateComplete;
  return el;
}
const root = (el: TillTenderRefundDialog) => el.shadowRoot!;
const field = (el: TillTenderRefundDialog, name: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name=${name}]`)!;
async function fill(el: TillTenderRefundDialog, name: string, value: string) {
  const control = field(el, name);
  await control.updateComplete;
  await userEvent.fill(page.elementLocator(control.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function click(el: TillTenderRefundDialog, selector = "[data-submit]") {
  await userEvent.click(page.elementLocator(root(el).querySelector<HTMLElement>(selector)!));
  await el.updateComplete;
}
const button = (el: TillTenderRefundDialog, selector = "[data-submit]") =>
  root(el).querySelector<HTMLElementTagNameMap["wt-button"]>(selector)!;
function collect<T>(el: TillTenderRefundDialog, type: string): T[] {
  const calls: T[] = [];
  el.addEventListener(type, (event) => calls.push((event as CustomEvent<T>).detail));
  return calls;
}

it("refunds the original card's remaining applied amount and tip, explicitly leaving the invoice unchanged", async () => {
  const el = await mount();
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  expect(root(el).textContent).toContain("F/0012");
  expect(root(el).textContent).toContain("0042");
  expect(root(el).querySelector("[data-invoice-unchanged]")!.textContent).toContain(
    t("tender_refund.invoice_unchanged"),
  );
  await fill(el, "reason", " Courtesy return ");
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "card-1",
      appliedAmount: "40.00",
      tipAmount: "5.00",
      reason: "Courtesy return",
      cashConfirmed: false,
      manualConfirmed: false,
    },
  ]);
});

it("requires a choice between original tenders and resets amounts and handover on another choice", async () => {
  const el = await mount({ tenders: [cash, card] });
  expect(button(el).disabled).toBe(true);
  expect(button(el).variant).toBe("secondary");
  await click(el, "input[name=tender][value=cash-1]");
  expect(field(el, "appliedAmount").value).toBe("40.00");
  await click(el, "wt-switch[name=cashConfirmed]");
  await fill(el, "appliedAmount", "12.50");
  await click(el, "input[name=tender][value=card-1]");
  expect(field(el, "appliedAmount").value).toBe("40.00");
  expect(root(el).querySelector("wt-switch[name=cashConfirmed]")).toBeNull();
  await click(el, "input[name=tender][value=cash-1]");
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("wt-switch[name=cashConfirmed]")!
      .checked,
  ).toBe(false);
});

it("validates amount, tip, reason and cash handover beside each control and above the buttons", async () => {
  const el = await mount({ tenders: [cash] });
  const asks = collect(el, "tender-refund-submit");
  await fill(el, "appliedAmount", "40.01");
  await fill(el, "tipAmount", "5.01");
  await click(el);
  expect(asks).toEqual([]);
  expect(field(el, "appliedAmount").error).not.toBe("");
  expect(field(el, "tipAmount").error).not.toBe("");
  expect(field(el, "reason").error).toBe(t("bill_refund.reason_invalid"));
  expect(root(el).querySelector("[data-confirm-error]")).not.toBeNull();
  expect(root(el).querySelector("[data-confirm-error]")!.textContent).toContain(
    t("tender_refund.confirm_required"),
  );
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(button(el).disabled).toBe(true);
  await fill(el, "appliedAmount", "12,50");
  await fill(el, "tipAmount", "0");
  await fill(el, "reason", "Return");
  expect(button(el).disabled).toBe(true);
  await click(el, "wt-switch[name=cashConfirmed]");
  expect(button(el).disabled).toBe(false);
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "cash-1",
      appliedAmount: "12.50",
      tipAmount: "0.00",
      reason: "Return",
      cashConfirmed: true,
      manualConfirmed: false,
    },
  ]);
});

it.each(["-1", "0.001", "abc", "", "1,000.00"])(
  "refuses malformed applied money %s without dispatch",
  async (value) => {
    const el = await mount();
    const asks = collect(el, "tender-refund-submit");
    await fill(el, "reason", "Return");
    await fill(el, "appliedAmount", value);
    await click(el);
    expect(asks).toEqual([]);
    expect(field(el, "appliedAmount").error).not.toBe("");
  },
);

it("returns tip only with all remaining applied money and refuses a zero total", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  await fill(el, "reason", "Return");
  await fill(el, "appliedAmount", "10");
  await fill(el, "tipAmount", "1");
  await click(el);
  expect(field(el, "tipAmount").error).toBe(t("tender_refund.tip_requires_all"));
  expect(asks).toEqual([]);
  await fill(el, "tipAmount", "0");
  await fill(el, "appliedAmount", "0");
  expect(button(el).disabled).toBe(true);
  expect(field(el, "appliedAmount").error).not.toBe("");
  await fill(el, "appliedAmount", "40");
  await fill(el, "tipAmount", "2.50");
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "card-1",
      appliedAmount: "40.00",
      tipAmount: "2.50",
      reason: "Return",
      cashConfirmed: false,
      manualConfirmed: false,
    },
  ]);
});

it("requires explicit manual-terminal confirmation before requesting its mandatory PIN approval", async () => {
  const el = await mount({ tenders: [{ ...card, manual: true }] });
  const asks = collect(el, "tender-refund-submit");
  await fill(el, "reason", "Return");
  await click(el);
  expect(asks).toEqual([]);
  expect(root(el).querySelector("[data-manual-instruction]")!.textContent).toContain(
    t("tender_refund.manual_instruction"),
  );
  await click(el, "wt-switch[name=manualConfirmed]");
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "card-1",
      appliedAmount: "40.00",
      tipAmount: "5.00",
      reason: "Return",
      cashConfirmed: false,
      manualConfirmed: true,
    },
  ]);
});

it("offers an existing pending refund for status without offering another refund of that tender", async () => {
  const el = await mount({
    tenders: [
      { ...card, pendingRefundId: "pending-1", appliedRemaining: "0.00", tipRemaining: "0.00" },
    ],
  });
  const seen = collect(el, "tender-refund-inspect");
  const asks = collect(el, "tender-refund-submit");
  expect(root(el).querySelector("input[name=tender]")).toBeNull();
  expect(button(el).disabled).toBe(true);
  await click(el, "[data-inspect]");
  expect(seen).toEqual([{ refundId: "pending-1" }]);
  expect(asks).toEqual([]);
});

it.each(["voucher", "transfer", "other"] as const)(
  "does not offer unsupported %s money",
  async (method) => {
    const el = await mount({ tenders: [{ ...card, method }] });
    expect(root(el).querySelector("input[name=tender]")).toBeNull();
    expect(button(el).disabled).toBe(true);
    expect(root(el).textContent).toContain(t("tender_refund.unavailable"));
  },
);

it("restores an unanswered request, freezes its fingerprint and offers same-attempt recovery", async () => {
  const el = await mount({
    attempt: {
      saleId: "sale-1",
      request: {
        tenderId: "card-1",
        appliedAmount: "12.50",
        tipAmount: "0.00",
        reason: "Saved return",
        submissionId: "sub-1",
      },
      refundId: null,
    },
  });
  const asks = collect(el, "tender-refund-submit");
  const retry = collect(el, "tender-refund-retry");
  const status = collect(el, "tender-refund-status");
  expect(field(el, "appliedAmount").value).toBe("12.50");
  expect(field(el, "reason").value).toBe("Saved return");
  for (const name of ["appliedAmount", "tipAmount", "reason"])
    expect(field(el, name).disabled).toBe(true);
  expect(root(el).querySelector("[data-submit]")).toBeNull();
  await click(el, "[data-status]");
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  await el.updateComplete;
  await click(el, "[data-retry]");
  expect(status).toEqual([{}]);
  expect(retry).toEqual([{}]);
  expect(asks).toEqual([]);
});

it("shows distinct pending/completed/failed outcomes and never offers payout again in a terminal view", async () => {
  const el = await mount({
    result: {
      id: "r1",
      saleId: "s1",
      tenderId: "card-1",
      state: "pending",
      appliedAmount: "12.50",
      tipAmount: "0.00",
      createdAt: "2026-10-16T10:00:00Z",
      completedAt: null,
    },
  });
  expect(root(el).querySelector("[data-outcome]")!.textContent).toContain(
    t("tender_refund.pending"),
  );
  for (const state of ["completed", "failed"] as const) {
    el.result = { ...el.result!, state };
    await el.updateComplete;
    expect(root(el).querySelector("[data-outcome]")!.textContent).toContain(
      t(`tender_refund.${state}`),
    );
    expect(root(el).querySelector("[data-retry]")).toBeNull();
    expect(root(el).querySelector("[data-submit]")).toBeNull();
  }
});

it("keeps request refusals actionable, maps named fields and validates Enter through the same handler", async () => {
  const el = await mount({ refusal: { code: "tender.refund_exceeds_payment" } });
  const asks = collect(el, "tender-refund-submit");
  expect(field(el, "appliedAmount").error).toBe(codeMessage("tender.refund_exceeds_payment"));
  await fill(el, "reason", "Return");
  expect(button(el).disabled).toBe(false);
  field(el, "reason")
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(asks).toHaveLength(1);
  el.refusal = { code: "server.internal" };
  await el.updateComplete;
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(codeMessage("server.internal"));
  expect(button(el).disabled).toBe(false);
});

it("busy and disconnected controls cannot edit, submit, inspect or retry", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  await fill(el, "reason", "Return");
  const submit = button(el);
  el.busy = true;
  await el.updateComplete;
  expect(submit.disabled).toBe(true);
  expect(root(el).querySelector("wt-dialog")!.dismissible).toBe(false);
  submit.click();
  field(el, "reason").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Wrong" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(field(el, "reason").value).toBe("Return");
  expect(asks).toEqual([]);
  el.busy = false;
  await el.updateComplete;
  el.remove();
  submit.click();
  expect(asks).toEqual([]);
});

it("dispatches one submission for rapid clicks before its parent paints busy", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  await fill(el, "reason", "Return");
  button(el).click();
  button(el).click();
  expect(asks).toHaveLength(1);
});

it("dispatches one recovery action before its parent paints busy and releases it after the answer", async () => {
  const el = await mount({
    attempt: {
      saleId: "sale-1",
      request: {
        tenderId: "card-1",
        appliedAmount: "12.50",
        tipAmount: "0.00",
        reason: "Saved",
        submissionId: "sub-1",
      },
      refundId: "r1",
    },
  });
  const checks = collect(el, "tender-refund-status");
  const retries = collect(el, "tender-refund-retry");
  button(el, "[data-status]").click();
  button(el, "[data-status]").click();
  button(el, "[data-retry]").click();
  expect(checks).toHaveLength(1);
  expect(retries).toEqual([]);
  el.busy = true;
  await el.updateComplete;
  el.busy = false;
  await el.updateComplete;
  await click(el, "[data-retry]");
  expect(retries).toHaveLength(1);
});

it("marks cash handover as required, describes its error to the native switch and shows the total", async () => {
  const el = await mount({ tenders: [cash] });
  await click(el);
  const sw = root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=cashConfirmed]",
  )!;
  expect(sw.label).toContain("*");
  expect(sw.description).toBe(t("tender_refund.confirm_required"));
  expect(root(el).querySelector("[data-total]")!.textContent).toContain("45.00");
});

it("clears a server handover refusal when that confirmation changes", async () => {
  const el = await mount({
    tenders: [cash],
    refusal: { code: "management.request_invalid", field: "cashConfirmed" },
  });
  expect(root(el).querySelector("[data-confirm-error]")).not.toBeNull();
  await click(el, "wt-switch[name=cashConfirmed]");
  expect(root(el).querySelector("[data-confirm-error]")).toBeNull();
  expect(root(el).querySelector("wt-form-actions")!.error).toBe("");
});

it("keeps Cancel on one line beside recovery actions at phone width", async () => {
  await page.viewport(390, 900);
  try {
    for (const locale of ["en", "es-ES"]) {
      setLocale(locale);
      const el = await mount({
        result: {
          id: "r1",
          saleId: "s1",
          tenderId: "card-1",
          state: "pending",
          appliedAmount: "12.50",
          tipAmount: "0.00",
          createdAt: "2026-10-16T10:00:00Z",
          completedAt: null,
        },
      });
      const cancel = button(el, "[data-close]");
      await cancel.updateComplete;
      const native = cancel.shadowRoot!.querySelector("button")!;
      expect(native.getBoundingClientRect().height).toBeLessThanOrEqual(
        parseFloat(getComputedStyle(native).minHeight) + 1,
      );
      cleanupWidgets();
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

it("departed recovery controls cannot retry after a terminal outcome replaces the view", async () => {
  const el = await mount({
    result: {
      id: "r1",
      saleId: "s1",
      tenderId: "card-1",
      state: "pending",
      appliedAmount: "12.50",
      tipAmount: "0.00",
      createdAt: "2026-10-16T10:00:00Z",
      completedAt: null,
    },
  });
  const status = button(el, "[data-status]");
  const retry = button(el, "[data-retry]");
  const calls = collect(el, "tender-refund-retry");
  const checks = collect(el, "tender-refund-status");
  el.result = { ...el.result!, state: "completed" };
  await el.updateComplete;
  retry.click();
  status.click();
  expect(calls).toEqual([]);
  expect(checks).toEqual([]);
});

it("departed pending-tender controls cannot open an attempt removed by a newer read", async () => {
  const el = await mount({ tenders: [{ ...card, pendingRefundId: "r1" }] });
  const inspect = button(el, "[data-inspect]");
  const calls = collect(el, "tender-refund-inspect");
  el.tenders = [card];
  await el.updateComplete;
  inspect.click();
  expect(calls).toEqual([]);
});

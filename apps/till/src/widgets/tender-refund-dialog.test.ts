import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent, page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { RefundableTender } from "../api/tender-refund-types.js";
import type { AdjustmentReason } from "../api/client.js";
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
const voidReason = (id: string, name: string, over: Partial<AdjustmentReason> = {}) =>
  ({
    id,
    name,
    kind: "void",
    actions: ["cancel"],
    noteRequired: false,
    maxPercentBp: null,
    maxAmount: null,
    applyRoles: [],
    approverRoles: [],
    ...over,
  }) as AdjustmentReason;
const reasons = [
  voidReason("return", "Return"),
  voidReason("courtesy", "Courtesy return"),
  voidReason("other", "Other", { noteRequired: true }),
  voidReason("comp", "Birthday", { kind: "comp", actions: ["comp"] }),
];
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(over: Partial<TillTenderRefundDialog> = {}) {
  const { el } = await mountWidget<TillTenderRefundDialog>("till-tender-refund-dialog", {
    tenders: [card],
    invoiceNumber: "F/0012",
    reasons,
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
const combo = (el: TillTenderRefundDialog) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=reason]")!;
async function choose(el: TillTenderRefundDialog, id: string) {
  combo(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: id }, bubbles: true, composed: true }),
  );
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
  await choose(el, "courtesy");
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "card-1",
      appliedAmount: "40.00",
      tipAmount: "5.00",
      reason: "Courtesy return",
      manualConfirmed: false,
    },
  ]);
});

it("requires a choice between original tenders and resets amounts and the hand-keyed switch on another choice", async () => {
  const manual = { ...card, tenderId: "manual-1", last4: "0077", manual: true };
  const el = await mount({ tenders: [manual, card] });
  expect(button(el).disabled).toBe(true);
  expect(button(el).variant).toBe("secondary");
  await click(el, "input[name=tender][value=manual-1]");
  expect(field(el, "appliedAmount").value).toBe("40.00");
  await click(el, "wt-switch[name=manualConfirmed]");
  await fill(el, "appliedAmount", "12.50");
  await click(el, "input[name=tender][value=card-1]");
  expect(field(el, "appliedAmount").value).toBe("40.00");
  expect(root(el).querySelector("wt-switch[name=manualConfirmed]")).toBeNull();
  await click(el, "input[name=tender][value=manual-1]");
  expect(
    root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("wt-switch[name=manualConfirmed]")!
      .checked,
  ).toBe(false);
});

it("draws no switch for a cash payment and submits without one", async () => {
  const el = await mount({ tenders: [cash] });
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  expect(root(el).querySelector("wt-switch")).toBeNull();
  await choose(el, "return");
  expect(button(el).disabled).toBe(false);
  await click(el);
  expect(root(el).querySelector("[data-confirm-error]")).toBeNull();
  expect(asks).toEqual([
    {
      tenderId: "cash-1",
      appliedAmount: "40.00",
      tipAmount: "5.00",
      reason: "Return",
      manualConfirmed: false,
    },
  ]);
});

it("quiets a cash refund's action on an empty reason and sends once the reason is filled", async () => {
  const el = await mount({ tenders: [cash] });
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  await click(el);
  expect(asks).toEqual([]);
  expect(combo(el).error).toBe(t("adjust.reason_required"));
  expect(button(el).disabled).toBe(true);
  await choose(el, "return");
  expect(combo(el).error).toBe("");
  expect(button(el).disabled).toBe(false);
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "cash-1",
      appliedAmount: "40.00",
      tipAmount: "5.00",
      reason: "Return",
      manualConfirmed: false,
    },
  ]);
});

it("validates amount, tip, reason and hand-keyed confirmation beside each control and above the buttons", async () => {
  const el = await mount({ tenders: [{ ...card, manual: true }] });
  const asks = collect(el, "tender-refund-submit");
  await fill(el, "appliedAmount", "40.01");
  await fill(el, "tipAmount", "5.01");
  await click(el);
  expect(asks).toEqual([]);
  expect(field(el, "appliedAmount").error).not.toBe("");
  expect(field(el, "tipAmount").error).not.toBe("");
  expect(combo(el).error).toBe(t("adjust.reason_required"));
  expect(root(el).querySelector("[data-confirm-error]")).not.toBeNull();
  expect(root(el).querySelector("[data-confirm-error]")!.textContent).toContain(
    t("tender_refund.confirm_required"),
  );
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(button(el).disabled).toBe(true);
  await fill(el, "appliedAmount", "12,50");
  await fill(el, "tipAmount", "0");
  await choose(el, "return");
  expect(button(el).disabled).toBe(true);
  await click(el, "wt-switch[name=manualConfirmed]");
  expect(button(el).disabled).toBe(false);
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "card-1",
      appliedAmount: "12.50",
      tipAmount: "0.00",
      reason: "Return",
      manualConfirmed: true,
    },
  ]);
});

it.each(["-1", "0.001", "abc", "", "1,000.00"])(
  "refuses malformed applied money %s without dispatch",
  async (value) => {
    const el = await mount();
    const asks = collect(el, "tender-refund-submit");
    await choose(el, "return");
    await fill(el, "appliedAmount", value);
    await click(el);
    expect(asks).toEqual([]);
    expect(field(el, "appliedAmount").error).not.toBe("");
  },
);

it("returns tip only with all remaining applied money and refuses a zero total", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  await choose(el, "return");
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
      manualConfirmed: false,
    },
  ]);
});

it("requires explicit manual-terminal confirmation before requesting its mandatory PIN approval", async () => {
  const el = await mount({ tenders: [{ ...card, manual: true }] });
  const asks = collect(el, "tender-refund-submit");
  await choose(el, "return");
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
  expect(root(el).querySelector("[data-saved-reason]")!.textContent).toContain("Saved return");
  expect(combo(el)).toBeNull();
  for (const name of ["appliedAmount", "tipAmount"]) expect(field(el, name).disabled).toBe(true);
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

it("marks the amount when the refund exceeds the cancelled dishes", async () => {
  const el = await mount({ refusal: { code: "tender.refund_exceeds_cancelled" } });
  expect(field(el, "appliedAmount").error).toBe(codeMessage("tender.refund_exceeds_cancelled"));
});

it("keeps request refusals actionable, maps named fields and validates Enter through the same handler", async () => {
  const el = await mount({ refusal: { code: "tender.refund_exceeds_payment" } });
  const asks = collect(el, "tender-refund-submit");
  expect(field(el, "appliedAmount").error).toBe(codeMessage("tender.refund_exceeds_payment"));
  await choose(el, "return");
  expect(button(el).disabled).toBe(false);
  field(el, "appliedAmount")
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
  await choose(el, "return");
  const submit = button(el);
  el.busy = true;
  await el.updateComplete;
  expect(submit.disabled).toBe(true);
  expect(root(el).querySelector("wt-dialog")!.dismissible).toBe(false);
  submit.click();
  combo(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "other" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(combo(el).value).toBe("return");
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
  await choose(el, "return");
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

it("marks hand-keyed confirmation as required, describes its error to the native switch and shows the total", async () => {
  const el = await mount({ tenders: [{ ...card, manual: true }] });
  await click(el);
  const sw = root(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=manualConfirmed]",
  )!;
  expect(sw.label).toContain("*");
  expect(sw.description).toBe(t("tender_refund.confirm_required"));
  expect(root(el).querySelector("[data-total]")!.textContent).toContain("45.00");
});

it("clears a server hand-keyed confirmation refusal when that confirmation changes", async () => {
  const el = await mount({
    tenders: [{ ...card, manual: true }],
    refusal: { code: "management.request_invalid", field: "manualConfirmed" },
  });
  expect(root(el).querySelector("[data-confirm-error]")).not.toBeNull();
  await click(el, "wt-switch[name=manualConfirmed]");
  expect(root(el).querySelector("[data-confirm-error]")).toBeNull();
  expect(root(el).querySelector("wt-form-actions")!.error).toBe("");
});

it("explains a reason longer than 500 characters and permits a corrected reason", async () => {
  const el = await mount();
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  await choose(el, "other");
  await fill(el, "note", "r".repeat(501));
  await click(el);
  expect(field(el, "note").error).toBe(t("bill_refund.reason_long"));
  expect(button(el).disabled).toBe(true);
  expect(asks).toEqual([]);
  await fill(el, "note", "Customer request");
  await click(el);
  expect(asks).toHaveLength(1);
  expect(asks[0]!.reason).toBe("Customer request");
});

it("marks a chosen reason whose name is over 500 characters and sends one of 500", async () => {
  const long = "r".repeat(501);
  const el = await mount({
    reasons: [voidReason("long", long), voidReason("edge", "e".repeat(500))],
  });
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  await choose(el, "long");
  await click(el);
  expect(combo(el).error).toBe(t("bill_refund.reason_long"));
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(button(el).disabled).toBe(true);
  expect(asks).toEqual([]);
  await choose(el, "edge");
  await click(el);
  expect(asks.map((ask) => ask.reason)).toEqual(["e".repeat(500)]);
});

it("stops an attempted form when its tender becomes unavailable", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  await click(el);
  expect(combo(el).error).toBe(t("adjust.reason_required"));
  el.tenders = [];
  await el.updateComplete;
  expect(button(el).disabled).toBe(true);
  expect(root(el).textContent).toContain(t("tender_refund.unavailable"));
  expect(asks).toEqual([]);
});

it.each(["appliedAmount", "tipAmount"])(
  "puts a server validation refusal beside %s until that field changes",
  async (name) => {
    const el = await mount({ refusal: { code: "management.request_invalid", field: name } });
    expect(field(el, name).error).toBe(codeMessage("management.request_invalid"));
    await fill(el, name, "1.00");
    expect(field(el, name).error).toBe("");
  },
);

it("puts a server reason refusal beside the reason until another is chosen", async () => {
  const el = await mount({ refusal: { code: "management.request_invalid", field: "reason" } });
  expect(combo(el).error).toBe(codeMessage("management.request_invalid"));
  await choose(el, "return");
  expect(combo(el).error).toBe("");
});

it("puts a server reason refusal beside Other's note until the note changes", async () => {
  const el = await mount();
  await choose(el, "other");
  el.refusal = { code: "management.request_invalid", field: "reason" };
  await el.updateComplete;
  expect(field(el, "note").error).toBe(codeMessage("management.request_invalid"));
  expect(combo(el).error).toBe("");
  await fill(el, "note", "Spilled");
  expect(field(el, "note").error).toBe("");
});

it("offers the Void reasons in a drop-down that starts empty from a receipt", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  expect(combo(el).required).toBe(true);
  expect(combo(el).value).toBe("");
  expect(combo(el).options).toEqual([
    { value: "return", label: "Return" },
    { value: "courtesy", label: "Courtesy return" },
    { value: "other", label: "Other" },
  ]);
  expect(root(el).querySelector("wt-input[name=reason]")).toBeNull();
  expect(root(el).querySelector("[data-dishes]")).toBeNull();
  await click(el);
  expect(asks).toEqual([]);
  expect(combo(el).error).toBe(t("adjust.reason_required"));
  expect(root(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(button(el).disabled).toBe(true);
});

it("starts on the cancel's reason with the dishes on a line under it", async () => {
  const el = await mount({ startReasonId: "courtesy", dishes: "1 × Flan" });
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  expect(combo(el).value).toBe("courtesy");
  const dishes = root(el).querySelector("[data-dishes]")!;
  expect(dishes.textContent!.trim()).toBe("1 × Flan");
  expect(combo(el).compareDocumentPosition(dishes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await click(el);
  expect(asks.map((ask) => ask.reason)).toEqual(["Courtesy return"]);
});

it("takes the cancel's reason when the reasons arrive after the dialog opens", async () => {
  const el = await mount({ reasons: null, reasonsLoading: true, startReasonId: "courtesy" });
  expect(combo(el).value).toBe("");
  el.reasons = reasons;
  el.reasonsLoading = false;
  await el.updateComplete;
  expect(combo(el).value).toBe("courtesy");
});

it("keeps the waiter's chosen reason when a refreshed list brings the cancel's reason", async () => {
  const el = await mount({
    reasons: reasons.filter((reason) => reason.id !== "courtesy"),
    startReasonId: "courtesy",
  });
  expect(combo(el).value).toBe("");
  await choose(el, "return");
  el.reasons = reasons;
  await el.updateComplete;
  expect(combo(el).value).toBe("return");
});

it("clears a chosen reason that a refreshed list no longer has and blocks the refund", async () => {
  const el = await mount();
  const asks = collect(el, "tender-refund-submit");
  await choose(el, "courtesy");
  el.reasons = reasons.filter((reason) => reason.id !== "courtesy");
  await el.updateComplete;
  expect(combo(el).value).toBe("");
  await click(el);
  expect(asks).toEqual([]);
  expect(combo(el).error).toBe(t("adjust.reason_required"));
  expect(button(el).disabled).toBe(true);
});

it("asks Other's note and sends the typed words as the reason", async () => {
  const el = await mount();
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  expect(root(el).querySelector("wt-input[name=note]")).toBeNull();
  await choose(el, "other");
  const note = field(el, "note");
  expect(note.required).toBe(true);
  expect(note.label).toBe(t("adjust.note"));
  expect(note.placeholder).toBe(codeMessage("working_order.reason_required"));
  await click(el);
  expect(asks).toEqual([]);
  expect(field(el, "note").error).toBe(t("adjust.note_required"));
  expect(button(el).disabled).toBe(true);
  await fill(el, "note", "  Wrong table  ");
  await click(el);
  expect(asks.map((ask) => ask.reason)).toEqual(["Wrong table"]);
});

it("sends a chosen reason's name", async () => {
  const el = await mount();
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  await choose(el, "other");
  await fill(el, "note", "Typed");
  await choose(el, "return");
  expect(root(el).querySelector("wt-input[name=note]")).toBeNull();
  await click(el);
  expect(asks.map((ask) => ask.reason)).toEqual(["Return"]);
});

it("fills in the dishes' total, tip 0.00, on the one payment", async () => {
  const el = await mount({
    tenders: [{ ...card, appliedRemaining: "62.00" }],
    target: "5.50",
    startReasonId: "return",
  });
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  expect(field(el, "appliedAmount").value).toBe("5.50");
  expect(field(el, "tipAmount").value).toBe("0.00");
  expect(root(el).querySelector("[data-left]")).toBeNull();
  await click(el);
  expect(asks).toEqual([
    {
      tenderId: "card-1",
      appliedAmount: "5.50",
      tipAmount: "0.00",
      reason: "Return",
      manualConfirmed: false,
    },
  ]);
});

it("fills in what one payment can return and says what is left", async () => {
  const el = await mount({
    tenders: [{ ...cash, appliedRemaining: "5.50", tipRemaining: "1.00" }],
    target: "7.50",
  });
  expect(field(el, "appliedAmount").value).toBe("5.50");
  expect(field(el, "tipAmount").value).toBe("0.00");
  expect(root(el).querySelector("[data-left]")!.textContent!.trim()).toBe(
    "€2.00 left to refund from another payment",
  );
  expect(root(el).querySelector("[data-refund-at-till]")).toBeNull();
  el.refundAtTill = true;
  await el.updateComplete;
  expect(root(el).querySelector("[data-refund-at-till]")!.textContent).toContain(
    t("cancel_item.refund_at_till"),
  );
  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(root(el).querySelector("[data-left]")!.textContent!.trim()).toBe(
    t("tender_refund.left").replace("{amount}", () => "2,00 €"),
  );
});

it("says what is left from the amount being refunded, not from the payment's balance", async () => {
  const el = await mount({
    tenders: [{ ...cash, appliedRemaining: "6.00", tipRemaining: "0.00" }],
    target: "10.00",
    startReasonId: "return",
  });
  const asks = collect<TenderRefundAsk>(el, "tender-refund-submit");
  expect(root(el).querySelector("[data-left]")!.textContent!.trim()).toBe(
    "€4.00 left to refund from another payment",
  );
  await fill(el, "appliedAmount", "2");
  expect(root(el).querySelector("[data-left]")!.textContent!.trim()).toBe(
    "€8.00 left to refund from another payment",
  );
  await click(el);
  expect(asks.map((ask) => ask.appliedAmount)).toEqual(["2.00"]);
});

it("says what is left once the amount is lowered on a payment that could return it all", async () => {
  const el = await mount({ tenders: [{ ...cash, appliedRemaining: "62.00" }], target: "5.50" });
  expect(root(el).querySelector("[data-left]")).toBeNull();
  await fill(el, "appliedAmount", "3");
  expect(root(el).querySelector("[data-left]")!.textContent!.trim()).toBe(
    "€2.50 left to refund from another payment",
  );
});

it.each(["", "abc", "0", "6.01"])(
  "says nothing about what is left while the amount %s is refused",
  async (value) => {
    const el = await mount({
      tenders: [{ ...cash, appliedRemaining: "6.00", tipRemaining: "0.00" }],
      target: "10.00",
    });
    await fill(el, "appliedAmount", value);
    expect(root(el).querySelector("[data-left]")).toBeNull();
  },
);

it("says nothing is left when one payment returns exactly the dishes' total", async () => {
  const el = await mount({ tenders: [{ ...cash, appliedRemaining: "5.50" }], target: "5.50" });
  expect(root(el).querySelector("[data-left]")).toBeNull();
});

it("fills in the dishes' total on the payment the waiter picks", async () => {
  const el = await mount({ tenders: [card, cash], target: "5.50" });
  expect(root(el).querySelector("wt-input[name=appliedAmount]")).toBeNull();
  await click(el, "input[name=tender][value=cash-1]");
  expect(field(el, "appliedAmount").value).toBe("5.50");
  expect(field(el, "tipAmount").value).toBe("0.00");
});

it("shows a saved attempt's reason as its stored text", async () => {
  const el = await mount({
    startReasonId: "return",
    attempt: {
      saleId: "sale-1",
      request: {
        tenderId: "card-1",
        appliedAmount: "5.50",
        tipAmount: "0.00",
        reason: "A reason since renamed",
        submissionId: "sub-1",
      },
      refundId: null,
    },
  });
  expect(combo(el)).toBeNull();
  expect(root(el).querySelector("wt-input[name=note]")).toBeNull();
  expect(root(el).querySelector("[data-saved-reason]")!.textContent!.trim()).toBe(
    t("adjust.reason_shown").replace("{reason}", () => "A reason since renamed"),
  );
});

it("offers Retry when the reasons could not be read and asks the app to read them again", async () => {
  const el = await mount({ reasons: null });
  const asks = collect(el, "tender-refund-reasons");
  const retry = button(el, "[data-reasons-retry]");
  expect(retry.textContent).toContain(t("find_page.retry"));
  await click(el, "[data-reasons-retry]");
  expect(asks).toEqual([{}]);
  el.reasonsLoading = true;
  await el.updateComplete;
  expect(button(el, "[data-reasons-retry]").disabled).toBe(true);
  expect(combo(el).disabled).toBe(true);
});

it("says so when the venue has no Void reasons", async () => {
  const el = await mount({ reasons: [reasons[3]!] });
  expect(combo(el).options).toEqual([]);
  expect(root(el).textContent).toContain(t("adjust.no_reasons"));
  expect(root(el).querySelector("[data-reasons-retry]")).toBeNull();
});

it("explains a durable-storage refusal without dispatching another refund", async () => {
  const el = await mount({ refusal: { code: "storage" } });
  const asks = collect(el, "tender-refund-submit");
  expect(root(el).querySelector("wt-form-actions")!.error).toContain(t("tender_refund.storage"));
  expect(asks).toEqual([]);
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

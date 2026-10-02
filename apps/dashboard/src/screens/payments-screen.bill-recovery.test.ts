import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const PAYMENT = {
  billPaymentId: "bp-1",
  workingOrderId: "wo-1",
  orderNumber: 12,
  label: "Terrace 3",
  tillId: "till-1",
  tillName: "Bar till",
  method: "card",
  applied: "12.50",
  tip: "1.00",
  startedAt: "2026-09-26T10:05:00.000Z",
  provider: "stripe-terminal",
  providerState: "failed",
};
const REFUND = {
  refundId: "br-1",
  billPaymentId: "bp-2",
  workingOrderId: "wo-2",
  orderNumber: 13,
  label: null,
  tillId: "till-1",
  tillName: "Bar till",
  appliedAmount: "4.00",
  tipAmount: "0.50",
  reason: "Guest left",
  requestedAt: "2026-09-26T10:07:00.000Z",
  sentAt: "2026-09-26T10:08:00.000Z",
  sendCount: 1,
  provider: "sumup",
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    liveData: new LiveData(),
    listPaymentProviders: vi.fn().mockResolvedValue([]),
    listReaders: vi.fn().mockResolvedValue([]),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([PAYMENT]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([REFUND]),
    resolveStuckBillPayment: vi.fn().mockResolvedValue({ outcome: "not_charged" }),
    resolveStuckBillRefund: vi.fn().mockResolvedValue({ outcome: "completed" }),
    attestStuckBillPayment: vi.fn().mockResolvedValue({ outcome: "received" }),
    attestStuckBillRefund: vi.fn().mockResolvedValue({ outcome: "failed" }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: PaymentsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api = stubApi()): Promise<PaymentsScreen> {
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api,
    request: vi.fn() as unknown as PaymentsScreen["request"],
    panels: [],
  });
  await flush(el);
  return el;
}

function q(el: PaymentsScreen, selector: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(selector);
}

function change(el: PaymentsScreen, selector: string, value: string): void {
  q(el, selector)!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}

async function bottomOf(el: PaymentsScreen): Promise<string> {
  const actions = q(
    el,
    "[data-test=bill-attest-dialog] wt-form-actions",
  ) as HTMLElementTagNameMap["wt-form-actions"];
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const errorOf = (el: PaymentsScreen, testId: string): string =>
  (q(el, `[data-test=${testId}]`) as HTMLElement & { error: string }).error;

const attestDisabled = (el: PaymentsScreen): boolean =>
  q(el, "[data-test=confirm-bill-attest]")!.hasAttribute("disabled");

function chooseOutcome(el: PaymentsScreen, value: string): void {
  void chooseOption(q(el, "[data-test=bill-attest-outcome]")!, value);
}

describe("bill payment recovery on the Payments screen", () => {
  it("lists pending payments and refunds separately with their order, till and amounts", async () => {
    const el = await mount();
    expect(q(el, "[data-test=bill-payment-bp-1]")!.textContent).toContain("Order 12 · Terrace 3");
    expect(q(el, "[data-test=bill-payment-bp-1]")!.textContent).toContain("€13.50");
    expect(q(el, "[data-test=bill-refund-br-1]")!.textContent).toContain("Order 13");
    expect(q(el, "[data-test=bill-refund-br-1]")!.textContent).toContain("€4.50");
    expect(q(el, "[data-test=bill-refund-br-1]")!.textContent).toContain("Bar till");
    expect(q(el, "[data-test=bill-payment-bp-1]")!.textContent).toContain("Marked failed");
    expect(q(el, "[data-test=bill-refund-br-1]")!.textContent).toContain("Guest left");
    expect(q(el, "[data-test=bill-refund-br-1]")!.textContent).toContain("1");
  });

  it("hides the recovery section when both lists are empty, then shows a new pending payment on a live change", async () => {
    const listStuckBillPayments = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([PAYMENT]);
    const api = stubApi({
      listStuckBillPayments,
      listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    });
    const el = await mount(api);
    expect(q(el, "[data-test=bill-recovery]")).toBeNull();
    api.liveData.invalidate([{ type: "bill_payments" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=bill-payment-bp-1]")).not.toBeNull());
    expect(listStuckBillPayments).toHaveBeenCalledTimes(2);
  });

  it("shows a shared load failure once and lets a deliberate refresh use the active client", async () => {
    const api = stubApi({
      listStuckBillPayments: vi.fn().mockRejectedValue({ code: "connection.failed" }),
      listStuckBillRefunds: vi.fn().mockRejectedValue({ code: "connection.failed" }),
      background: {
        listStuckBillPayments: vi.fn().mockResolvedValue([]),
        listStuckBillRefunds: vi.fn().mockResolvedValue([]),
      } as unknown as DashboardApi,
    });
    const el = await mount(api);
    const text = q(el, "[data-test=bill-load-error]")!.textContent!;
    expect(text.match(/This browser could not connect/g)).toHaveLength(1);
    q(el, "[data-test=refresh-bill-recovery]")!.click();
    await flush(el);
    expect(api.listStuckBillPayments).toHaveBeenCalledTimes(2);
    expect(api.background.listStuckBillPayments).not.toHaveBeenCalled();
  });

  it("reads the recovery headings and actions in Spanish", async () => {
    setLocale("es");
    const el = await mount();
    expect(q(el, "[data-test=bill-recovery]")!.textContent).toContain("Pagos de cuentas");
    expect(q(el, "[data-test=bill-recovery]")!.textContent).toContain("Devoluciones");
    expect(q(el, "[data-test=bill-payment-bp-1]")!.textContent).toContain("Pedido 12");
  });

  it("asks the provider about one payment and refreshes without losing the successful result", async () => {
    const api = stubApi({
      listStuckBillPayments: vi
        .fn()
        .mockResolvedValueOnce([PAYMENT])
        .mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await mount(api);
    q(el, "[data-test=check-bill-payment-bp-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-check]")!.click();
    await flush(el);
    expect(api.resolveStuckBillPayment).toHaveBeenCalledWith("bp-1");
    expect(q(el, "[data-test=bill-action-result]")!.getAttribute("role")).toBe("status");
    expect(q(el, "[data-test=bill-load-error]")).not.toBeNull();
  });

  it("explains when a reader is still processing instead of suggesting another check", async () => {
    const api = stubApi({
      resolveStuckBillPayment: vi.fn().mockRejectedValue({
        code: "bill.payment_outcome_unconfirmed",
        params: { reason: "attempting" },
      }),
    });
    const el = await mount(api);
    q(el, "[data-test=check-bill-payment-bp-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-check]")!.click();
    await flush(el);
    expect(q(el, "[data-test=bill-action-result]")!.textContent).toContain("still processing");
    expect(q(el, "[data-test=bill-action-result]")!.textContent).not.toContain(
      "Ask the card provider about it again",
    );
  });

  it("checks a refund with its own route and reports the completed outcome", async () => {
    const api = stubApi({
      listStuckBillRefunds: vi.fn().mockResolvedValueOnce([REFUND]).mockResolvedValue([]),
    });
    const el = await mount(api);
    q(el, "[data-test=check-bill-refund-br-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-check]")!.click();
    await flush(el);
    expect(api.resolveStuckBillRefund).toHaveBeenCalledWith("br-1");
    expect(q(el, "[data-test=bill-action-result]")!.textContent).toContain("Refund completed");
    expect(q(el, "[data-test=bill-refund-br-1]")).toBeNull();
  });

  it("records a provider-confirmed payment outcome and clears the form", async () => {
    const api = stubApi({
      listStuckBillPayments: vi.fn().mockResolvedValueOnce([PAYMENT]).mockResolvedValue([]),
      attestStuckBillPayment: vi.fn().mockResolvedValue({ outcome: "not_charged" }),
    });
    const el = await mount(api);
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "failed");
    change(el, "[data-test=bill-attest-note]", "Provider confirmed no charge");
    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(api.attestStuckBillPayment).toHaveBeenCalledWith("bp-1", {
      outcome: "failed",
      note: "Provider confirmed no charge",
      pin: "1234",
    });
    expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull();
    expect(q(el, "[data-test=bill-action-result]")!.textContent).toContain("Payment not charged");
  });

  it.each([
    ["payment", "attest-bill-payment-bp-1"],
    ["refund", "attest-bill-refund-br-1"],
  ])(
    "does not invite the browser to fill the manager PIN with a saved password (%s)",
    async (_kind, opener) => {
      const el = await mount(stubApi());
      q(el, `[data-test=${opener}]`)!.click();
      await flush(el);
      const native = q(el, "[data-test=bill-attest-pin]")!.shadowRoot!.querySelector("input")!;
      expect(native.type).toBe("password");
      expect(native.autocomplete).toBe("off");
    },
  );

  it("requires a confirmed outcome, note and PIN before attesting a refund", async () => {
    const api = stubApi();
    const el = await mount(api);
    q(el, "[data-test=attest-bill-refund-br-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(api.attestStuckBillRefund).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(attestDisabled(el)).toBe(true);
    expect(q(el, "[data-test=bill-attest-dialog] wt-form-error-summary")).toBeNull();
    expect(errorOf(el, "bill-attest-outcome")).toContain("outcome");
    expect(
      q(el, "[data-test=bill-attest-dialog] wt-input[name=note]")!.hasAttribute("required"),
    ).toBe(true);
    expect(
      q(el, "[data-test=bill-attest-dialog] wt-input[name=pin]")!.hasAttribute("required"),
    ).toBe(true);
    expect(
      (q(el, "[data-test=bill-attest-note]") as HTMLElement & { error: string }).error,
    ).toBeTruthy();
    expect(
      (q(el, "[data-test=bill-attest-pin]") as HTMLElement & { error: string }).error,
    ).toBeTruthy();

    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "completed");
    change(el, "[data-test=bill-attest-note]", "  Provider confirmed a refund  ");
    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(api.attestStuckBillRefund).toHaveBeenCalledWith("br-1", {
      outcome: "completed",
      note: "Provider confirmed a refund",
      pin: "1234",
    });
  });

  it("keeps the attestation form and PIN refusal visible for correction", async () => {
    const api = stubApi({
      attestStuckBillPayment: vi.fn().mockRejectedValue({ code: "pin.invalid" }),
    });
    const el = await mount(api);
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "received");
    change(el, "[data-test=bill-attest-note]", "Provider says no charge");
    change(el, "[data-test=bill-attest-pin]", "0000");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(api.attestStuckBillPayment).toHaveBeenCalledWith("bp-1", {
      outcome: "received",
      note: "Provider says no charge",
      pin: "0000",
    });
    expect(q(el, "[data-test=bill-attest-dialog]")).not.toBeNull();
    expect(
      (q(el, "[data-test=bill-attest-pin]") as HTMLElement & { error: string }).error,
    ).toBeTruthy();
  });

  it("clears the outcome, note and PIN when a different row's form opens", async () => {
    const el = await mount();
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "received");
    change(el, "[data-test=bill-attest-note]", "First order note");
    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    q(el, "[data-test=bill-attest-dialog]")!.dispatchEvent(new CustomEvent("wt-close"));
    await flush(el);
    q(el, "[data-test=attest-bill-refund-br-1]")!.click();
    await flush(el);
    expect(
      (q(el, "[data-test=bill-attest-outcome]") as HTMLElement & { value: string }).value,
    ).toBe("");
    expect((q(el, "[data-test=bill-attest-note]") as HTMLElement & { value: string }).value).toBe(
      "",
    );
    expect((q(el, "[data-test=bill-attest-pin]") as HTMLElement & { value: string }).value).toBe(
      "",
    );
  });

  it("closes a stale attestation and refreshes the row after the server says it is no longer pending", async () => {
    const api = stubApi({
      listStuckBillPayments: vi.fn().mockResolvedValueOnce([PAYMENT]).mockResolvedValue([]),
      attestStuckBillPayment: vi.fn().mockRejectedValue({ code: "bill.payment_not_stuck" }),
    });
    const el = await mount(api);
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    await chooseOption(q(el, "[data-test=bill-attest-outcome]")!, "received");
    change(el, "[data-test=bill-attest-note]", "Provider confirms received");
    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(q(el, "[data-test=bill-attest-dialog]")).toBeNull();
    expect(q(el, "[data-test=bill-payment-bp-1]")).toBeNull();
    expect(q(el, "[data-test=bill-action-result]")!.getAttribute("role")).toBe("alert");
  });

  it("says nothing about errors before the first submission, and Record works", async () => {
    const el = await mount();
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    change(el, "[data-test=bill-attest-note]", " ");
    await flush(el);
    expect(errorOf(el, "bill-attest-note")).toBe("");
    expect(errorOf(el, "bill-attest-outcome")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(attestDisabled(el)).toBe(false);
  });

  it("on an invalid submission focuses the first invalid field, marks it and disables Record", async () => {
    const el = await mount();
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    const outcome = q(el, "[data-test=bill-attest-outcome]")!;
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(outcome));
    const control = outcome.shadowRoot!.querySelector(".trigger")!;
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(
      outcome
        .shadowRoot!.getElementById(control.getAttribute("aria-describedby")!)!
        .textContent!.trim(),
    ).toBe(t("payments.bill.outcome_required"));
    expect(attestDisabled(el)).toBe(true);

    chooseOutcome(el, "received");
    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    const note = q(el, "[data-test=bill-attest-note]")!;
    await vi.waitFor(() =>
      expect(note.shadowRoot!.activeElement).toBe(note.shadowRoot!.querySelector("input")),
    );
  });

  it("re-checks every change after a failed submission, and Record works again once all are fixed", async () => {
    const el = await mount();
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);

    change(el, "[data-test=bill-attest-note]", "Provider confirmed");
    await flush(el);
    expect(errorOf(el, "bill-attest-note")).toBe("");
    expect(errorOf(el, "bill-attest-pin")).toBe(t("payments.bill.pin_required"));
    expect(attestDisabled(el)).toBe(true);

    change(el, "[data-test=bill-attest-note]", "  ");
    await flush(el);
    expect(errorOf(el, "bill-attest-note")).toBe(t("payments.bill.note_required"));

    change(el, "[data-test=bill-attest-note]", "Provider confirmed");
    change(el, "[data-test=bill-attest-pin]", "1234");
    chooseOutcome(el, "received");
    await flush(el);
    expect(errorOf(el, "bill-attest-outcome")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(attestDisabled(el)).toBe(false);
  });

  it("keeps a refused PIN, with Record working, until the PIN changes, focusing it when the refusal arrives", async () => {
    const el = await mount(
      stubApi({ attestStuckBillPayment: vi.fn().mockRejectedValue({ code: "pin.invalid" }) }),
    );
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    chooseOutcome(el, "received");
    change(el, "[data-test=bill-attest-note]", "Provider says no charge");
    change(el, "[data-test=bill-attest-pin]", "0000");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    const pin = q(el, "[data-test=bill-attest-pin]")!;
    await vi.waitFor(() =>
      expect(pin.shadowRoot!.activeElement).toBe(pin.shadowRoot!.querySelector("input")),
    );
    expect(errorOf(el, "bill-attest-pin")).toBe(codeMessage("pin.invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(attestDisabled(el)).toBe(false);

    change(el, "[data-test=bill-attest-note]", "Provider says no charge today");
    await flush(el);
    expect(errorOf(el, "bill-attest-pin")).toBe(codeMessage("pin.invalid"));
    expect(attestDisabled(el)).toBe(false);

    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    expect(errorOf(el, "bill-attest-pin")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(attestDisabled(el)).toBe(false);
  });

  it("shows a refusal that names no field in the dialog's bottom message and leaves Record working", async () => {
    const attest = vi.fn().mockRejectedValue({ code: "bill.attestation_contradicted" });
    const el = await mount(stubApi({ attestStuckBillPayment: attest }));
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    chooseOutcome(el, "received");
    change(el, "[data-test=bill-attest-note]", "Provider says received");
    change(el, "[data-test=bill-attest-pin]", "1234");
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("bill.attestation_contradicted"));
    expect(q(el, "[data-test=bill-attest-dialog] [role=alert]")).toBeNull();
    expect(attestDisabled(el)).toBe(false);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    expect(attest).toHaveBeenCalledTimes(2);
  });

  it("starts again when the form is reopened: no messages and Record working", async () => {
    const el = await mount();
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-bill-attest]")!.click();
    await flush(el);
    q(el, "[data-test=bill-attest-dialog]")!.dispatchEvent(new CustomEvent("wt-close"));
    await flush(el);
    q(el, "[data-test=attest-bill-payment-bp-1]")!.click();
    await flush(el);
    expect(errorOf(el, "bill-attest-note")).toBe("");
    expect(errorOf(el, "bill-attest-outcome")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(attestDisabled(el)).toBe(false);
  });
});

describe("bill recovery's outcome field", () => {
  type Combobox = HTMLElement & {
    options: { value: string; label: string }[];
    value: string;
    label: string;
    name: string;
    placeholder: string;
    search: string;
    required: boolean;
    disabled: boolean;
    error: string;
  };

  it.each([
    [
      "payment",
      "attest-bill-payment-bp-1",
      "received",
      "payments.bill.received_option",
      "payments.bill.failed_payment_option",
    ],
    [
      "refund",
      "attest-bill-refund-br-1",
      "completed",
      "payments.bill.completed_option",
      "payments.bill.failed_refund_option",
    ],
  ] as const)(
    "picks a %s's confirmed outcome from a required dropdown, prompting a choice",
    async (_kind, opener, confirmed, confirmedKey, failedKey) => {
      const el = await mount();
      q(el, `[data-test=${opener}]`)!.click();
      await flush(el);
      const outcome = q(el, "wt-combobox[data-test=bill-attest-outcome]") as Combobox;
      expect(outcome.name).toBe("outcome");
      expect(outcome.label).toBe(t("payments.bill.outcome"));
      expect(outcome.required).toBe(true);
      expect(outcome.search).toBe("auto");
      expect(outcome.placeholder).toBe(t("payments.bill.choose_outcome"));
      expect(outcome.options).toEqual([
        { value: confirmed, label: t(confirmedKey) },
        { value: "failed", label: t(failedKey) },
      ]);
      expect(outcome.value).toBe("");

      q(el, "[data-test=confirm-bill-attest]")!.click();
      await flush(el);
      expect(outcome.error).toBe(t("payments.bill.outcome_required"));
      await chooseOption(outcome, "failed");
      await flush(el);
      expect(outcome.error).toBe("");
      expect(outcome.value).toBe("failed");
    },
  );
});

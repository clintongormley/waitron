import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { LiveData, registerCatalogue } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import type { DashboardApi, HeldPaymentRow } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { formatAlertTime } from "../widgets/alert-format.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));

registerCatalogue({
  en: { "test.held.stripe": "Stripe" },
  es: { "test.held.stripe": "Stripe" },
});

const PANELS: CardProviderPanel[] = [
  {
    providerId: "stripe-terminal",
    displayNameKey: "test.held.stripe",
    strings: { en: {}, es: {} },
    renderConnectForm: () => html``,
    renderAddReader: () => html``,
  },
];

const HELD: HeldPaymentRow[] = [
  {
    holdId: "h-1",
    paymentRef: "pi_57",
    provider: "stripe-terminal",
    orderNumber: 57,
    settledAt: "2026-07-01T19:40:00.000Z",
    amount: "10.00",
    providerAmount: "12.50",
  },
  {
    holdId: "h-2",
    paymentRef: "pi_63",
    provider: "stripe-terminal",
    orderNumber: 63,
    settledAt: "2026-07-02T11:05:00.000Z",
    amount: "10.00",
    providerAmount: "7.00",
  },
];

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    liveData: new LiveData(),
    listPaymentProviders: vi.fn().mockResolvedValue([]),
    listReaders: vi.fn().mockResolvedValue([]),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckTenderRefunds: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    listHeldPayments: vi.fn().mockResolvedValue(HELD),
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
    panels: PANELS,
  });
  await flush(el);
  return el;
}

function q(el: PaymentsScreen, selector: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(selector);
}

const lines = (el: PaymentsScreen, holdId: string): string[] =>
  [...el.shadowRoot!.querySelectorAll(`[data-test=held-payment-${holdId}] p`)].map((p) =>
    p.textContent!.replace(/\s+/g, " ").trim(),
  );

describe("held card payments on the Payments screen", () => {
  it("lists each held payment's order and time, both amounts and a Record outcome button", async () => {
    const el = await mount();
    const section = q(el, "[data-test=held-payments]")!;
    expect(section.querySelector("h3")!.textContent!.trim()).toBe(
      "Held: paid out at a different amount",
    );
    expect(lines(el, "h-1")).toEqual([
      `Order 57 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
      "Charged €10.00 · Stripe paid out €12.50",
    ]);
    expect(lines(el, "h-2")).toEqual([
      `Order 63 · ${formatAlertTime("2026-07-02T11:05:00.000Z")}`,
      "Charged €10.00 · Stripe paid out €7.00",
    ]);
    const time = q(el, "[data-test=held-payment-h-1] .stuck-order time")!;
    expect(time.getAttribute("datetime")).toBe("2026-07-01T19:40:00.000Z");
    expect(time.textContent!.trim()).toBe(formatAlertTime("2026-07-01T19:40:00.000Z"));
    const ids = [...section.querySelectorAll("li")].map((li) => li.dataset.test);
    expect(ids).toEqual(["held-payment-h-1", "held-payment-h-2"]);
    const button = q(el, "[data-test=record-held-h-1]")!;
    expect(button.textContent!.trim()).toBe("Record outcome");
    expect(button.getAttribute("variant")).toBe("secondary");
    expect(button.getAttribute("aria-label")).toBe(
      `Record outcome: Order 57 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
    );
  });

  it("shows only the order for a held payment with no payout time", async () => {
    const el = await mount(
      stubApi({ listHeldPayments: vi.fn().mockResolvedValue([{ ...HELD[0]!, settledAt: null }]) }),
    );
    expect(lines(el, "h-1")).toEqual(["Order 57", "Charged €10.00 · Stripe paid out €12.50"]);
    expect(q(el, "[data-test=held-payment-h-1] time")).toBeNull();
    expect(q(el, "[data-test=record-held-h-1]")!.getAttribute("aria-label")).toBe(
      "Record outcome: Order 57",
    );
  });

  it("names the order's label after its number", async () => {
    const el = await mount(
      stubApi({
        listHeldPayments: vi.fn().mockResolvedValue([{ ...HELD[0]!, label: "Terrace 4" }]),
      }),
    );
    expect(lines(el, "h-1")).toEqual([
      `Order 57 · Terrace 4 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
      "Charged €10.00 · Stripe paid out €12.50",
    ]);
    expect(q(el, "[data-test=record-held-h-1]")!.getAttribute("aria-label")).toBe(
      `Record outcome: Order 57 · Terrace 4 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
    );
  });

  it("reads the held list in Spanish", async () => {
    setLocale("es");
    const el = await mount();
    expect(q(el, "[data-test=held-payments] h3")!.textContent!.trim()).toBe(
      "Retenidos: liquidados por otro importe",
    );
    expect(lines(el, "h-1")).toEqual([
      `Pedido 57 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
      "Cobrado 10,00 € · Stripe liquidó 12,50 €",
    ]);
    expect(q(el, "[data-test=record-held-h-1]")!.textContent!.trim()).toBe("Registrar resultado");
  });

  it("shows the recovery section when held payments are the only thing listed", async () => {
    const el = await mount();
    expect(q(el, "[data-test=bill-recovery]")).not.toBeNull();
    expect(q(el, "[data-test=bill-recovery]")!.classList.contains("pending")).toBe(true);
    expect(q(el, "[data-test=bill-load-error]")).toBeNull();
  });

  it("hides the recovery section when every list, held included, is empty", async () => {
    const el = await mount(stubApi({ listHeldPayments: vi.fn().mockResolvedValue([]) }));
    expect(q(el, "[data-test=bill-recovery]")).toBeNull();
    expect(q(el, "[data-test=held-payments]")).toBeNull();
  });

  it("leaves out the held heading while no payment is held but another list has rows", async () => {
    const el = await mount(
      stubApi({
        listHeldPayments: vi.fn().mockResolvedValue([]),
        listStuckBillRefunds: vi.fn().mockResolvedValue([
          {
            refundId: "br-1",
            billPaymentId: "bp-2",
            workingOrderId: "wo-2",
            orderNumber: 13,
            label: null,
            source: "device",
            deviceId: "device-1",
            deviceName: "Bar till",
            appliedAmount: "4.00",
            tipAmount: "0.50",
            reason: "Guest left",
            requestedAt: "2026-09-26T10:07:00.000Z",
            sentAt: null,
            sendCount: 0,
            provider: "sumup",
          },
        ]),
      }),
    );
    expect(q(el, "[data-test=bill-recovery]")).not.toBeNull();
    expect(q(el, "[data-test=held-payments]")).toBeNull();
  });

  it("drops a held payment whose outcome is recorded when the live query refreshes", async () => {
    const listHeldPayments = vi
      .fn()
      .mockResolvedValueOnce(HELD)
      .mockResolvedValueOnce([HELD[1]])
      .mockResolvedValue([]);
    const api = stubApi({ listHeldPayments });
    const el = await mount(api);
    expect(q(el, "[data-test=held-payment-h-1]")).not.toBeNull();
    api.liveData!.invalidate([{ type: "payment_hold_outcomes" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=held-payment-h-1]")).toBeNull());
    expect(q(el, "[data-test=held-payment-h-2]")).not.toBeNull();
    api.liveData!.invalidate([{ type: "payment_hold_outcomes" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=bill-recovery]")).toBeNull());
    expect(listHeldPayments).toHaveBeenCalledTimes(3);
  });

  it("says when the held list could not be read, and a deliberate refresh reads it again", async () => {
    const listHeldPayments = vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue(HELD);
    const el = await mount(stubApi({ listHeldPayments }));
    expect(q(el, "[data-test=bill-load-error]")!.textContent).toContain(
      "This browser could not connect",
    );
    q(el, "[data-test=refresh-bill-recovery]")!.click();
    await flush(el);
    expect(q(el, "[data-test=bill-load-error]")).toBeNull();
    expect(q(el, "[data-test=held-payment-h-1]")).not.toBeNull();
  });

  it.each(["success", "failure"] as const)(
    "keeps a live update delivered while an older Refresh is still waiting (%s)",
    async (outcome) => {
      let release!: () => void;
      const listHeldPayments = vi
        .fn()
        .mockResolvedValueOnce([HELD[0]])
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          if (outcome === "failure") throw { code: "connection.failed" };
          return [HELD[0]];
        })
        .mockResolvedValue([]);
      const api = stubApi({ listHeldPayments });
      const el = await mount(api);
      q(el, "[data-test=refresh-bill-recovery]")!.click();
      await vi.waitFor(() => expect(typeof release).toBe("function"));
      api.liveData!.invalidate([{ type: "payment_hold_outcomes" }]);
      await vi.waitFor(() => expect(q(el, "[data-test=held-payment-h-1]")).toBeNull());
      release();
      await flush(el);
      expect(listHeldPayments).toHaveBeenCalledTimes(3);
      expect(q(el, "[data-test=held-payment-h-1]")).toBeNull();
      expect(q(el, "[data-test=bill-load-error]")).toBeNull();
    },
  );
});

type Field = HTMLElement & { error: string; required: boolean; value: string; label: string };

describe("the Record what was done dialog", () => {
  const field = (el: PaymentsScreen, name: string) =>
    q(el, `[data-test=held-outcome-${name}]`) as Field;
  const dialog = (el: PaymentsScreen) => q(el, "[data-test=held-outcome-dialog]");
  const record = (el: PaymentsScreen) =>
    q(el, "[data-test=confirm-held-outcome]") as HTMLElement & {
      variant: string;
      disabled: boolean;
    };
  function change(el: PaymentsScreen, name: string, value: string) {
    field(el, name).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  }
  async function open(el: PaymentsScreen, holdId = "h-1") {
    q(el, `[data-test=record-held-${holdId}]`)!.click();
    await flush(el);
  }
  async function bottom(el: PaymentsScreen): Promise<string> {
    const actions = dialog(el)!.querySelector("wt-form-actions")!;
    return (await formMessageOf(actions as never))?.textContent?.trim() ?? "";
  }
  async function submit(el: PaymentsScreen) {
    record(el).click();
    await flush(el);
  }

  it("marks the dialog's payout time as a time, on the order's line", async () => {
    const el = await mount();
    await open(el);
    const line = dialog(el)!.querySelector<HTMLElement>(".stuck-order")!;
    expect(line.textContent!.replace(/\s+/g, " ").trim()).toBe(
      `Order 57 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
    );
    const time = line.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-07-01T19:40:00.000Z");
    expect(time.textContent!.trim()).toBe(formatAlertTime("2026-07-01T19:40:00.000Z"));
  });

  it("names the order's label in the dialog and in the result", async () => {
    const labelled = { ...HELD[0]!, label: "Terrace 4" };
    const listHeldPayments = vi.fn().mockResolvedValueOnce([labelled]).mockResolvedValue([]);
    const recordHeldOutcome = vi.fn().mockResolvedValue({ outcome: "kept" });
    const el = await mount(stubApi({ listHeldPayments, recordHeldOutcome }));
    await open(el);
    const line = dialog(el)!.querySelector<HTMLElement>(".stuck-order")!;
    expect(line.textContent!.replace(/\s+/g, " ").trim()).toBe(
      `Order 57 · Terrace 4 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
    );
    await chooseOption(field(el, "outcome"), "kept");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(q(el, "[data-test=bill-action-result]")!.textContent).toBe(
      "Order 57 · Terrace 4: Outcome recorded. That payment is no longer checked.",
    );
  });

  it("shows the order, both amounts and the fields the picture draws, with Record quiet", async () => {
    const el = await mount();
    await open(el);
    const box = dialog(el)! as HTMLElement & { heading: string };
    expect(box.heading).toBe("Record what was done");
    const text = box.textContent!.replace(/\s+/g, " ");
    expect(text).toContain(`Order 57 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`);
    expect(text).toContain("Charged here €10.00");
    expect(text).toContain("Stripe paid out €12.50");
    expect(field(el, "outcome").label).toBe("Outcome");
    expect(field(el, "outcome").required).toBe(true);
    expect(
      (field(el, "outcome") as unknown as { options: { value: string; label: string }[] }).options,
    ).toEqual([
      { value: "refunded_at_provider", label: "Refunded in the card provider's dashboard" },
      { value: "kept", label: "Kept: the money was owed" },
    ]);
    expect(field(el, "note").label).toBe("Note");
    expect(field(el, "note").required).toBe(false);
    expect(field(el, "pin").label).toBe("Manager PIN");
    expect(field(el, "pin").required).toBe(true);
    for (const name of ["outcome", "note", "pin"])
      expect(field(el, name).getAttribute("name")).toBe(name);
    expect(record(el).textContent!.trim()).toBe("Record");
    expect(record(el).variant).toBe("secondary");
    expect(record(el).disabled).toBe(true);
  });

  it("reads the dialog in Spanish", async () => {
    setLocale("es");
    const el = await mount();
    await open(el);
    const box = dialog(el)! as HTMLElement & { heading: string };
    expect(box.heading).toBe("Registrar qué se hizo");
    const text = box.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Cobrado aquí 10,00 €");
    expect(text).toContain("Stripe liquidó 12,50 €");
    expect(field(el, "outcome").label).toBe("Resultado");
    expect(
      (field(el, "outcome") as unknown as { options: { label: string }[] }).options.map(
        (option) => option.label,
      ),
    ).toEqual(["Devuelto en el panel del proveedor de tarjetas", "Conservado: el dinero se debía"]);
    expect(field(el, "note").label).toBe("Nota");
    expect(record(el).textContent!.trim()).toBe("Registrar");
  });

  it("marks a missing outcome and says so at the bottom, sending nothing", async () => {
    const recordHeldOutcome = vi.fn();
    const el = await mount(stubApi({ recordHeldOutcome }));
    await open(el);
    change(el, "pin", "1234");
    await flush(el);
    expect(record(el).variant).toBe("primary");
    expect(record(el).disabled).toBe(false);
    await submit(el);
    expect(recordHeldOutcome).not.toHaveBeenCalled();
    expect(field(el, "outcome").error).toBe("Choose what was done.");
    expect(field(el, "pin").error).toBe("");
    expect(field(el, "note").error).toBe("");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
    expect(record(el).disabled).toBe(true);
  });

  it("marks a missing PIN beside the PIN", async () => {
    const recordHeldOutcome = vi.fn();
    const el = await mount(stubApi({ recordHeldOutcome }));
    await open(el);
    await chooseOption(field(el, "outcome"), "kept");
    await flush(el);
    await submit(el);
    expect(recordHeldOutcome).not.toHaveBeenCalled();
    expect(field(el, "pin").error).toBe(t("payments.bill.pin_required"));
  });

  it.each(["pin.invalid", "pin.throttled"])(
    "shows %s beside the PIN until the PIN changes",
    async (code) => {
      const recordHeldOutcome = vi.fn().mockRejectedValue({ code });
      const el = await mount(stubApi({ recordHeldOutcome }));
      await open(el);
      await chooseOption(field(el, "outcome"), "kept");
      change(el, "pin", "9999");
      await flush(el);
      await submit(el);
      expect(field(el, "pin").error).toBe(codeMessage(code));
      expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
      expect(dialog(el)).not.toBeNull();
      expect(record(el).disabled, "a refusal alone leaves Record enabled").toBe(false);
      change(el, "note", "Checked Stripe");
      await flush(el);
      expect(field(el, "pin").error).toBe(codeMessage(code));
      change(el, "pin", "1234");
      await flush(el);
      expect(field(el, "pin").error).toBe("");
      expect(await bottom(el)).toBe("");
    },
  );

  it("puts a refusal that names the note under the note", async () => {
    const recordHeldOutcome = vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "note" } });
    const el = await mount(stubApi({ recordHeldOutcome }));
    await open(el);
    await chooseOption(field(el, "outcome"), "kept");
    change(el, "note", "x");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    expect(field(el, "note").error).toBe(codeMessage("management.request_invalid"));
    expect(field(el, "pin").error).toBe("");
    expect(await bottom(el)).toBe("Correct the highlighted fields to continue.");
  });

  it("shows any other refusal at the bottom and keeps the dialog open", async () => {
    const recordHeldOutcome = vi.fn().mockRejectedValue({ code: "authorization.not_permitted" });
    const el = await mount(stubApi({ recordHeldOutcome }));
    await open(el);
    await chooseOption(field(el, "outcome"), "kept");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    expect(dialog(el)).not.toBeNull();
    expect(await bottom(el)).toBe(codeMessage("authorization.not_permitted"));
    expect(field(el, "pin").error).toBe("");
  });

  it.each([
    [
      "payment.hold_already_recorded",
      "Someone has already recorded what was done with that payment.",
    ],
    ["payment.hold_not_found", "That payment is no longer held."],
  ])("closes the dialog on %s and says so above the list", async (code, sentence) => {
    const listHeldPayments = vi.fn().mockResolvedValueOnce(HELD).mockResolvedValue([HELD[1]]);
    const recordHeldOutcome = vi.fn().mockRejectedValue({ code });
    const el = await mount(stubApi({ listHeldPayments, recordHeldOutcome }));
    await open(el);
    await chooseOption(field(el, "outcome"), "refunded_at_provider");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    const result = q(el, "[data-test=bill-action-result]")!;
    expect(result.textContent).toBe(`Order 57: ${sentence}`);
    expect(result.getAttribute("role")).toBe("alert");
    await vi.waitFor(() => expect(q(el, "[data-test=held-payment-h-1]")).toBeNull());
    expect(listHeldPayments).toHaveBeenCalledTimes(2);
  });

  it("sends the outcome and PIN without a note when the note is blank, then closes and refreshes", async () => {
    const listHeldPayments = vi.fn().mockResolvedValueOnce(HELD).mockResolvedValue([HELD[1]]);
    const recordHeldOutcome = vi.fn().mockResolvedValue({ outcome: "kept" });
    const el = await mount(stubApi({ listHeldPayments, recordHeldOutcome }));
    await open(el);
    await chooseOption(field(el, "outcome"), "kept");
    change(el, "note", "   ");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(recordHeldOutcome).toHaveBeenCalledExactlyOnceWith("h-1", {
      outcome: "kept",
      pin: "1234",
    });
    const result = q(el, "[data-test=bill-action-result]")!;
    expect(result.textContent).toBe(
      "Order 57: Outcome recorded. That payment is no longer checked.",
    );
    expect(result.getAttribute("role")).toBe("status");
    await vi.waitFor(() => expect(q(el, "[data-test=held-payment-h-1]")).toBeNull());
    expect(listHeldPayments).toHaveBeenCalledTimes(2);
  });

  it("sends the trimmed note when there is one", async () => {
    const recordHeldOutcome = vi.fn().mockResolvedValue({ outcome: "refunded_at_provider" });
    const el = await mount(stubApi({ recordHeldOutcome }));
    await open(el, "h-2");
    await chooseOption(field(el, "outcome"), "refunded_at_provider");
    change(el, "note", "  Refunded €12.50 in Stripe, 3 Jul  ");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    expect(recordHeldOutcome).toHaveBeenCalledExactlyOnceWith("h-2", {
      outcome: "refunded_at_provider",
      note: "Refunded €12.50 in Stripe, 3 Jul",
      pin: "1234",
    });
  });

  it("opens empty again after a record, the PIN cleared", async () => {
    const recordHeldOutcome = vi.fn().mockResolvedValue({ outcome: "kept" });
    const el = await mount(stubApi({ recordHeldOutcome }));
    await open(el);
    await chooseOption(field(el, "outcome"), "kept");
    change(el, "pin", "1234");
    await flush(el);
    await submit(el);
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    await open(el, "h-2");
    expect(field(el, "outcome").value).toBe("");
    expect(field(el, "pin").value).toBe("");
    expect(field(el, "note").value).toBe("");
  });
});

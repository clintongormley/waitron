import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { LiveData, registerCatalogue } from "@waitron/dashboard-kit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import type { DashboardApi, HeldPaymentRow } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
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
    const ids = [...section.querySelectorAll("li")].map((li) => li.dataset.test);
    expect(ids).toEqual(["held-payment-h-1", "held-payment-h-2"]);
    const button = q(el, "[data-test=record-held-h-1]")!;
    expect(button.textContent!.trim()).toBe("Record outcome");
    expect(button.getAttribute("variant")).toBe("secondary");
    expect(button.getAttribute("aria-label")).toBe(
      `Record outcome: Order 57 · ${formatAlertTime("2026-07-01T19:40:00.000Z")}`,
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

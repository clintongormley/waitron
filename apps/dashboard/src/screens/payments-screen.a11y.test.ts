import { afterEach, describe, it, vi } from "vitest";
import { html } from "lit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import { registerCatalogue } from "@waitron/dashboard-kit";
import type {
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  StuckPaymentRow,
} from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

afterEach(cleanupWidgets);

registerCatalogue({
  en: { "test.acme.name": "Acme Pay", "test.zeta.name": "Zeta Pay" },
  es: { "test.acme.name": "Acme Pay", "test.zeta.name": "Zeta Pay" },
});

const fakePanel = (providerId: string, nameKey: string): CardProviderPanel => ({
  providerId,
  displayNameKey: nameKey,
  strings: { en: {}, es: {} },
  renderConnectForm: (ctx) =>
    html`<button data-test="fake-connect-${providerId}" @click=${() => ctx.onConnected()}>
      connect
    </button>`,
  renderAddReader: (ctx) =>
    html`<button data-test="fake-add-reader-${providerId}" @click=${() => ctx.onAdded()}>
      add
    </button>`,
});

const PANELS: CardProviderPanel[] = [
  fakePanel("acme", "test.acme.name"),
  fakePanel("zeta", "test.zeta.name"),
];

const PROVIDERS: PaymentProviderRow[] = [
  { providerId: "acme", state: "connected", canUnpair: true },
  { providerId: "zeta", state: "not_connected", canUnpair: false },
];

const READERS: ReaderRow[] = [
  {
    id: "r-1",
    provider: "acme",
    name: "Front counter",
    active: true,
    canEnable: true,
    deviceCount: 2,
  },
  { id: "r-2", provider: "acme", name: "Terrace", active: false, canEnable: true, deviceCount: 0 },
];

const STUCK: StuckPaymentRow[] = [
  {
    paymentId: "pay-1",
    workingOrderId: "wo-1",
    orderNumber: 12,
    label: "Terrace 3",
    tillId: "till-1",
    tillName: "Bar till",
    provider: "acme",
    amount: "12.50",
    startedAt: "2026-09-26T10:05:00.000Z",
  },
  {
    paymentId: "pay-2",
    workingOrderId: "wo-2",
    orderNumber: 13,
    label: null,
    tillId: "till-1",
    tillName: "Bar till",
    provider: "acme",
    amount: "8.00",
    startedAt: "2026-09-26T10:07:00.000Z",
  },
];

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listStuckPayments: vi.fn().mockResolvedValue([]),
    resolveStuckPayment: vi.fn().mockResolvedValue({ outcome: "released" }),
    listPaymentProviders: vi.fn().mockResolvedValue(PROVIDERS),
    listReaders: vi.fn().mockResolvedValue(READERS),
    readerStatus: vi.fn().mockResolvedValue({ online: true }),
    disconnectPaymentProvider: vi.fn().mockResolvedValue(undefined),
    disableReader: vi.fn().mockResolvedValue(undefined),
    availableReaders: vi.fn().mockResolvedValue([
      { providerRef: "v-1", name: "Counter", status: "available", model: "solo", serial: "123" },
      { providerRef: "v-2", name: "Terrace", status: "disabled" },
      { providerRef: "v-3", name: "Bar", status: "added" },
    ]),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: PaymentsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("payments-screen a11y (%s theme)", (theme) => {
  it("renders the providers and readers accessibly", async () => {
    const { el, host } = await mountWidget<PaymentsScreen>(
      "dashboard-payments-screen",
      {
        api: stubApi(),
        request: vi.fn() as unknown as PaymentsScreen["request"],
        panels: PANELS,
        mode: "demo",
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it.each(["discovery", "edit", "details", "unpair"])(
    "renders the %s dialog accessibly",
    async (mode) => {
      const { el, host } = await mountWidget<PaymentsScreen>(
        "dashboard-payments-screen",
        {
          api: stubApi(),
          request: vi.fn() as unknown as PaymentsScreen["request"],
          panels: PANELS,
        },
        theme,
      );
      await flush(el);
      const root =
        mode === "discovery"
          ? el.shadowRoot!
          : el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
      root
        .querySelector<HTMLElement>(
          mode === "discovery" ? "[data-test=add-reader-acme]" : `[data-test=${mode}-r-1]`,
        )!
        .click();
      await flush(el);
      await expectNoA11yViolations(host);
    },
  );

  it("renders an open connect form accessibly", async () => {
    const { el, host } = await mountWidget<PaymentsScreen>(
      "dashboard-payments-screen",
      {
        api: stubApi(),
        request: vi.fn() as unknown as PaymentsScreen["request"],
        panels: PANELS,
        mode: "live",
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect-zeta]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  describe("the stuck card payments section", () => {
    async function mountStuck(overrides: Partial<Record<keyof DashboardApi, unknown>>) {
      const mounted = await mountWidget<PaymentsScreen>(
        "dashboard-payments-screen",
        {
          api: stubApi(overrides),
          request: vi.fn() as unknown as PaymentsScreen["request"],
          panels: PANELS,
          mode: "live",
        },
        theme,
      );
      await flush(mounted.el);
      return mounted;
    }

    async function check(el: PaymentsScreen): Promise<void> {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=resolve-pay-1]")!.click();
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-resolve]")!.click();
      await flush(el);
    }

    it("renders the list of stuck payments accessibly", async () => {
      const { host } = await mountStuck({ listStuckPayments: vi.fn().mockResolvedValue(STUCK) });
      await expectNoA11yViolations(host);
    });

    it("renders the confirmation accessibly", async () => {
      const { el, host } = await mountStuck({
        listStuckPayments: vi.fn().mockResolvedValue(STUCK),
      });
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=resolve-pay-1]")!.click();
      await flush(el);
      await expectNoA11yViolations(host);
    });

    it("renders a check in progress accessibly", async () => {
      const { el, host } = await mountStuck({
        listStuckPayments: vi.fn().mockResolvedValue(STUCK),
        resolveStuckPayment: vi.fn().mockReturnValue(new Promise(() => {})),
      });
      await check(el);
      await expectNoA11yViolations(host);
    });

    it("renders a result after the last payment is cleared accessibly", async () => {
      const { el, host } = await mountStuck({
        listStuckPayments: vi.fn().mockResolvedValueOnce(STUCK.slice(0, 1)).mockResolvedValue([]),
      });
      await check(el);
      await expectNoA11yViolations(host);
    });

    it("renders a refusal beside the remaining list accessibly", async () => {
      const { el, host } = await mountStuck({
        listStuckPayments: vi.fn().mockResolvedValue(STUCK),
        resolveStuckPayment: vi.fn().mockRejectedValue({
          code: "payment.outcome_unknown",
          params: { paymentId: "pay-1", reason: "unreachable" },
        }),
      });
      await check(el);
      await expectNoA11yViolations(host);
    });

    it("renders a failed load accessibly", async () => {
      const { host } = await mountStuck({
        listStuckPayments: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      await expectNoA11yViolations(host);
    });
  });
});

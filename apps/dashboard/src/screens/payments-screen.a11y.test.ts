import { afterEach, describe, it, vi } from "vitest";
import { html } from "lit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import { registerCatalogue } from "@waitron/dashboard-kit";
import type { DashboardApi, PaymentProviderRow, ReaderRow } from "../api/client.js";
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
  { providerId: "acme", state: "connected" },
  { providerId: "zeta", state: "not_connected" },
];

const READERS: ReaderRow[] = [
  { id: "r-1", provider: "acme", name: "Front counter", active: true, deviceCount: 2 },
  { id: "r-2", provider: "acme", name: "Terrace", active: false, deviceCount: 0 },
];

function stubApi(): DashboardApi {
  return {
    listPaymentProviders: vi.fn().mockResolvedValue(PROVIDERS),
    listReaders: vi.fn().mockResolvedValue(READERS),
    readerStatus: vi.fn().mockResolvedValue({ online: true }),
    disconnectPaymentProvider: vi.fn().mockResolvedValue(undefined),
    retireReader: vi.fn().mockResolvedValue(undefined),
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
});

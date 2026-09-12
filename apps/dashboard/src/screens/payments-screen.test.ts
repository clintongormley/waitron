import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import { registerCatalogue } from "@waitron/dashboard-kit";
import { setLocale } from "../i18n/t.js";
import type {
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  ReaderStatusView,
} from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

// A pair of fake provider panels so the screen's tests never depend on the real SumUp/Stripe elements.
// Each registers a display name (the screen resolves `displayNameKey` through the shared catalogue) and
// a connect form / add-reader dialog with a single button that fires the context callback.
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
    html`<div data-test="fake-add-reader-${providerId}">
      <button data-test="fake-added-${providerId}" @click=${() => ctx.onAdded()}>added</button>
      <button data-test="fake-close-${providerId}" @click=${() => ctx.onClose()}>close</button>
    </div>`,
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
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPaymentProviders: vi.fn().mockResolvedValue(PROVIDERS),
    listReaders: vi.fn().mockResolvedValue(READERS),
    readerStatus: vi.fn().mockResolvedValue({ online: true } as ReaderStatusView),
    disconnectPaymentProvider: vi.fn().mockResolvedValue(undefined),
    retireReader: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: PaymentsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(
  api: DashboardApi = stubApi(),
  props: Partial<PaymentsScreen> = {},
): Promise<{ el: PaymentsScreen; host: HTMLElement; api: DashboardApi }> {
  const mounted = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api,
    request: vi.fn() as unknown as PaymentsScreen["request"],
    panels: PANELS,
    ...props,
  });
  await flush(mounted.el);
  return { ...mounted, api };
}

const q = (el: PaymentsScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);

// The readers data-table renders its cells (retire button, status span) inside its OWN shadow root, so
// a cell selector reaches through the `<wt-data-table>` element the screen hosts.
const qCell = (el: PaymentsScreen, selector: string) =>
  el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelector<HTMLElement>(selector);

describe("payments-screen", () => {
  it("lists providers with their state badges", async () => {
    const { el, api } = await mount();

    expect(api.listPaymentProviders).toHaveBeenCalled();
    expect(q(el, "[data-test=provider-acme]")?.textContent).toContain("Acme Pay");
    expect(q(el, "[data-test=provider-state-acme]")?.textContent).toContain("Connected");
    expect(q(el, "[data-test=provider-state-zeta]")?.textContent).toContain("Not connected");
  });

  it("shows a not-connected provider's connect form from the registry, matched by providerId", async () => {
    const { el } = await mount();

    expect(q(el, "[data-test=fake-connect-zeta]")).toBeNull();
    q(el, "[data-test=connect-zeta]")!.click();
    await flush(el);

    expect(q(el, "[data-test=fake-connect-zeta]")).not.toBeNull();
  });

  it("reloads the provider list when a connect form reports success", async () => {
    const { el, api } = await mount();
    (api.listPaymentProviders as ReturnType<typeof vi.fn>).mockClear();

    q(el, "[data-test=connect-zeta]")!.click();
    await flush(el);
    q(el, "[data-test=fake-connect-zeta]")!.click();
    await flush(el);

    expect(api.listPaymentProviders).toHaveBeenCalled();
  });

  it("disconnects a connected provider behind a two-tap confirm", async () => {
    const { el, api } = await mount();

    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();

    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    expect(api.disconnectPaymentProvider).toHaveBeenCalledWith("acme");
  });

  it("renders the readers in a data table with name/provider/status/default-count/actions", async () => {
    const { el, api } = await mount();

    expect(api.listReaders).toHaveBeenCalled();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    expect(table.shadowRoot!.querySelector("[aria-label]")).not.toBeNull();
    const body = table.shadowRoot!.querySelector("tbody")!;
    expect(body.textContent).toContain("Front counter");
    expect(body.textContent).toContain("Acme Pay");
    expect(body.textContent).toContain("2");
    expect(api.readerStatus).toHaveBeenCalledWith("r-1");
    expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toContain("Online");
    expect(qCell(el, "[data-test=retire-r-1]")).not.toBeNull();
  });

  it("retires a reader behind a two-tap confirm and reloads", async () => {
    const { el, api } = await mount();
    (api.listReaders as ReturnType<typeof vi.fn>).mockClear();

    qCell(el, "[data-test=retire-r-1]")!.click();
    await flush(el);
    expect(api.retireReader).not.toHaveBeenCalled();

    qCell(el, "[data-test=retire-r-1]")!.click();
    await flush(el);
    expect(api.retireReader).toHaveBeenCalledWith("r-1");
    expect(api.listReaders).toHaveBeenCalled();
  });

  it("opens a connected provider's add-reader dialog and reloads readers on add", async () => {
    const { el, api } = await mount();
    (api.listReaders as ReturnType<typeof vi.fn>).mockClear();

    q(el, "[data-test=add-reader-acme]")!.click();
    await flush(el);
    expect(q(el, "[data-test=fake-add-reader-acme]")).not.toBeNull();

    q(el, "[data-test=fake-added-acme]")!.click();
    await flush(el);
    expect(api.listReaders).toHaveBeenCalled();
  });

  it("shows the simulator banner in demo mode", async () => {
    const { el } = await mount(stubApi(), { mode: "demo" });

    expect(q(el, "[data-test=simulator-banner]")).not.toBeNull();
    expect(q(el, "[data-test=provider-state-acme]")?.textContent).toContain("Simulator");
  });

  it("hides the simulator banner in live mode", async () => {
    const { el } = await mount(stubApi(), { mode: "live" });

    expect(q(el, "[data-test=simulator-banner]")).toBeNull();
  });

  it("shows a localized alert, never a raw code, when the load fails", async () => {
    const api = stubApi({
      listPaymentProviders: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mount(api);

    expect(q(el, "[role=alert]")).not.toBeNull();
    expect(q(el, "[role=alert]")?.textContent).not.toContain("server.internal");
  });

  it("surfaces a payment.provider_in_use rejection as its localized copy", async () => {
    const api = stubApi({
      disconnectPaymentProvider: vi.fn().mockRejectedValue({ code: "payment.provider_in_use" }),
    });
    const { el } = await mount(api);

    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);

    expect(q(el, "[role=alert]")?.textContent).toContain("Retire");
    expect(q(el, "[role=alert]")?.textContent).not.toContain("payment.provider_in_use");
  });
});

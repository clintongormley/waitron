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
  { providerId: "acme", state: "connected", canUnpair: true },
  { providerId: "zeta", state: "not_connected", canUnpair: false },
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
    disableReader: vi.fn().mockResolvedValue(undefined),
    enableReader: vi.fn().mockResolvedValue(undefined),
    unpairReader: vi.fn().mockResolvedValue(undefined),
    renameReader: vi.fn().mockResolvedValue(undefined),
    availableReaders: vi.fn().mockResolvedValue([]),
    adoptReader: vi.fn().mockResolvedValue({ id: "r-2", status: "paired" }),
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

// The readers data-table renders its cells (row menu, status span) inside its OWN shadow root, so
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
    expect(qCell(el, "[data-test=disable-r-1]")).not.toBeNull();
  });

  it("disables a reader locally from its row menu and reloads", async () => {
    const { el, api } = await mount();
    vi.mocked(api.listReaders).mockClear();
    qCell(el, "[data-test=disable-r-1]")!.click();
    await flush(el);
    expect(api.disableReader).toHaveBeenCalledWith("r-1");
    expect(api.unpairReader).not.toHaveBeenCalled();
    expect(api.listReaders).toHaveBeenCalled();
  });

  it("opens a connected provider's add-reader dialog and reloads readers on add", async () => {
    const { el, api } = await mount();
    (api.listReaders as ReturnType<typeof vi.fn>).mockClear();

    q(el, "[data-test=add-reader-acme]")!.click();
    await flush(el);
    q(el, "[data-test=pair-new-reader]")!.click();
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

    expect(q(el, "[role=alert]")?.textContent).toContain("Disable");
    expect(q(el, "[role=alert]")?.textContent).not.toContain("payment.provider_in_use");
  });
});

const VENDOR_READERS = [
  {
    providerRef: "v-1",
    name: "My Reader",
    model: "solo",
    serial: "123",
    status: "available" as const,
  },
  { providerRef: "v-2", name: "Terrace", status: "disabled" as const },
  { providerRef: "v-3", name: "Counter", status: "added" as const },
];
function changeName(el: PaymentsScreen, selector: string, value: string): void {
  q(el, selector)!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
async function openAdd(el: PaymentsScreen) {
  q(el, "[data-test=add-reader-acme]")!.click();
  await flush(el);
}

describe("reader discovery and status", () => {
  it("offers editable names, Add again and already added rows", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    expect(api.availableReaders).toHaveBeenCalledWith("acme");
    expect(q(el, "[data-test=reader-discovery]")!.textContent).toContain("123");
    expect(q(el, "[data-test=adopt-v-2]")!.textContent).toContain("Add again");
    expect(q(el, "[data-test=adopt-v-3]")).toBeNull();
    expect(q(el, "[data-test=reader-discovery]")!.textContent).toContain("Already added");
    const input = q(el, "[data-test=name-v-1]")!;
    expect(input.getAttribute("name")).toBe("reader-name");
    expect(input.shadowRoot!.querySelector("input")!.value).toBe("My Reader");
    expect(input.shadowRoot!.querySelector("input")!.required).toBe(true);
    changeName(el, "[data-test=name-v-1]", "Garden");
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    expect(api.adoptReader).toHaveBeenCalledWith({
      providerId: "acme",
      providerRef: "v-1",
      name: "Garden",
    });
    expect(q(el, "[data-test=reader-discovery]")).toBeNull();
  });

  it("shows an empty-name field error and summary before adoption", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "   ");
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    expect(api.adoptReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=name-v-1]")!.shadowRoot!.textContent).toContain("Enter a reader name");
    expect(q(el, "wt-form-error-summary")!.shadowRoot!.textContent).toContain(
      "There is a problem with this form",
    );
  });

  it("keeps pairing reachable when listing fails", async () => {
    const { el } = await mount(
      stubApi({ availableReaders: vi.fn().mockRejectedValue(new Error("outage")) }),
    );
    await openAdd(el);
    expect(q(el, "[data-test=reader-discovery]")!.textContent).toContain("Could not check");
    q(el, "[data-test=pair-new-reader]")!.click();
    await flush(el);
    expect(q(el, "[data-test=reader-discovery]")).toBeNull();
    expect(q(el, "[data-test=fake-add-reader-acme]")).not.toBeNull();
    q(el, "[data-test=fake-close-acme]")!.click();
    await flush(el);
    expect(q(el, "[data-test=reader-discovery]")).not.toBeNull();
  });

  it("explains an empty list and closes discovery on cancel", async () => {
    const { el } = await mount();
    await openAdd(el);
    expect(q(el, "[data-test=reader-discovery]")!.textContent).toContain("No readers");
    q(el, "[data-test=cancel-discovery]")!.click();
    await flush(el);
    expect(q(el, "[data-test=reader-discovery]")).toBeNull();
  });

  it("closes adoption after a successful write even when refreshing fails", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    vi.mocked(api.listReaders).mockRejectedValue({ code: "server.internal" });
    q(el, "[data-test=adopt-v-2]")!.click();
    await flush(el);
    expect(api.adoptReader).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=reader-discovery]")).toBeNull();
    expect(q(el, "[role=alert]")).not.toBeNull();
  });

  it("retains adoption drafts on a failed save", async () => {
    const { el } = await mount(
      stubApi({
        availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS),
        adoptReader: vi.fn().mockRejectedValue({ code: "reader.not_listed" }),
      }),
    );
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "Garden");
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    expect(q(el, "[data-test=reader-discovery]")).not.toBeNull();
    expect(q(el, "[data-test=name-v-1]")!.shadowRoot!.querySelector("input")!.value).toBe("Garden");
    expect(q(el, "[data-test=reader-discovery]")!.textContent).not.toContain("reader.not_listed");
  });

  it("renders unreachable as Unknown and shows zero battery", async () => {
    const { el } = await mount(
      stubApi({
        readerStatus: vi
          .fn()
          .mockResolvedValue({ online: false, unreachable: true, batteryPercent: 0 }),
      }),
    );
    expect(qCell(el, "[data-test=reader-status-r-1]")!.textContent).toBe("Unknown");
    expect(qCell(el, "[data-test=reader-battery-r-1]")!.textContent).toBe("0%");
  });

  it("leaves unreported battery blank and refreshes only active reader statuses", async () => {
    const { el, api } = await mount(
      stubApi({
        listReaders: vi
          .fn()
          .mockResolvedValue([...READERS, { ...READERS[0], id: "disabled", active: false }]),
      }),
    );
    expect(qCell(el, "[data-test=reader-battery-r-1]")!.textContent).toBe("");
    vi.mocked(api.readerStatus).mockClear();
    q(el, "[data-test=refresh-readers]")!.click();
    await flush(el);
    expect(api.readerStatus).toHaveBeenCalledExactlyOnceWith("r-1");
  });

  it("filters active, disabled and all readers and enables a disabled row", async () => {
    const { el, api } = await mount(
      stubApi({
        listReaders: vi
          .fn()
          .mockResolvedValue([...READERS, { ...READERS[0], id: "disabled", active: false }]),
      }),
    );
    expect(qCell(el, "[data-test=reader-status-disabled]")).toBeNull();
    const filter = q(el, "select[name=reader-status-filter]") as HTMLSelectElement;
    filter.value = "disabled";
    filter.dispatchEvent(new Event("change"));
    await flush(el);
    expect(qCell(el, "[data-test=reader-status-r-1]")).toBeNull();
    expect(qCell(el, "[data-test=reader-status-disabled]")!.textContent).toBe("Disabled");
    qCell(el, "[data-test=enable-disabled]")!.click();
    await flush(el);
    expect(api.enableReader).toHaveBeenCalledWith("disabled");
    filter.value = "all";
    filter.dispatchEvent(new Event("change"));
    await flush(el);
    expect(qCell(el, "[data-test=reader-status-r-1]")).not.toBeNull();
    expect(qCell(el, "[data-test=reader-status-disabled]")).not.toBeNull();
  });

  it("shows reported details and restores focus to the row menu", async () => {
    const { el, api } = await mount(
      stubApi({
        readerStatus: vi.fn().mockResolvedValue({
          online: true,
          model: "solo",
          serial: "123",
          connection: "Wi-Fi",
          activity: "IDLE",
          firmwareVersion: "3.3",
          lastSeenAt: "2026-09-12T11:03:48.930Z",
        }),
      }),
    );
    const menu = qCell(el, "wt-row-actions")!;
    menu.shadowRoot!.querySelector("button")!.click();
    await flush(el);
    qCell(el, "[data-test=details-r-1]")!.click();
    await flush(el);
    const dialog = q(el, "[data-test=reader-editor]")!;
    for (const value of ["solo", "123", "Wi-Fi", "IDLE", "3.3", "2026"])
      expect(dialog.textContent).toContain(value);
    expect(api.readerStatus).toHaveBeenCalledTimes(1);
    q(el, "[data-test=close-reader-editor]")!.click();
    await flush(el);
    expect(menu.shadowRoot!.activeElement).toBe(menu.shadowRoot!.querySelector("button"));
  });

  it("validates and saves a renamed reader, closing before refresh", async () => {
    const { el, api } = await mount();
    qCell(el, "[data-test=edit-r-1]")!.click();
    await flush(el);
    changeName(el, "[data-test=edit-reader-name]", "");
    q(el, "[data-test=save-reader]")!.click();
    await flush(el);
    expect(api.renameReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=edit-reader-name]")!.shadowRoot!.textContent).toContain(
      "Enter a reader name",
    );
    changeName(el, "[data-test=edit-reader-name]", "Garden");
    vi.mocked(api.listReaders).mockRejectedValue({ code: "server.internal" });
    q(el, "[data-test=save-reader]")!.click();
    await flush(el);
    expect(api.renameReader).toHaveBeenCalledWith("r-1", "Garden");
    expect(q(el, "[data-test=reader-editor]")).toBeNull();
  });

  it("confirms unpair separately and hides it for providers without support", async () => {
    const { el, api } = await mount();
    qCell(el, "[data-test=unpair-r-1]")!.click();
    await flush(el);
    expect(api.unpairReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=reader-editor]")!.textContent).toContain("pairing code");
    q(el, "[data-test=confirm-unpair]")!.click();
    await flush(el);
    expect(api.unpairReader).toHaveBeenCalledWith("r-1");
    const other = await mount(
      stubApi({
        listPaymentProviders: vi.fn().mockResolvedValue([{ ...PROVIDERS[0], canUnpair: false }]),
      }),
    );
    expect(qCell(other.el, "[data-test=unpair-r-1]")).toBeNull();
  });
});

describe("reader dialog request lifetime", () => {
  it("does not reopen discovery or replace newer drafts when an old list arrives late", async () => {
    let resolve!: (readers: typeof VENDOR_READERS) => void;
    const old = new Promise<typeof VENDOR_READERS>((done) => {
      resolve = done;
    });
    const { el } = await mount(
      stubApi({
        availableReaders: vi.fn().mockReturnValueOnce(old).mockResolvedValue(VENDOR_READERS),
      }),
    );
    await openAdd(el);
    q(el, "[data-test=cancel-discovery]")!.click();
    await flush(el);
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "Garden");
    resolve([{ ...VENDOR_READERS[0]!, name: "Old name" }]);
    await flush(el);
    expect(q(el, "[data-test=name-v-1]")!.shadowRoot!.querySelector("input")!.value).toBe("Garden");
  });

  it("prevents duplicate adoption while the first save is pending", async () => {
    let resolve!: () => void;
    const waiting = new Promise<void>((done) => {
      resolve = done;
    });
    const { el, api } = await mount(
      stubApi({
        availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS),
        adoptReader: vi.fn().mockImplementation(async () => {
          await waiting;
          return { id: "r-2", status: "paired" };
        }),
      }),
    );
    await openAdd(el);
    const add = q(el, "[data-test=adopt-v-1]")!;
    add.click();
    add.click();
    await flush(el);
    expect(api.adoptReader).toHaveBeenCalledTimes(1);
    resolve();
    await flush(el);
    expect(q(el, "[data-test=reader-discovery]")).toBeNull();
  });

  it("keeps an unpair failure in the confirmation dialog and permits retry", async () => {
    const { el, api } = await mount(
      stubApi({
        unpairReader: vi
          .fn()
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(undefined),
      }),
    );
    qCell(el, "[data-test=unpair-r-1]")!.click();
    await flush(el);
    q(el, "[data-test=confirm-unpair]")!.click();
    await flush(el);
    expect(q(el, "[data-test=reader-editor] [role=alert]")).not.toBeNull();
    q(el, "[data-test=confirm-unpair]")!.click();
    await flush(el);
    expect(api.unpairReader).toHaveBeenCalledTimes(2);
    expect(q(el, "[data-test=reader-editor]")).toBeNull();
  });

  it("isolates a status request failure to its row", async () => {
    const { el } = await mount(
      stubApi({
        listReaders: vi.fn().mockResolvedValue([...READERS, { ...READERS[0], id: "r-2" }]),
        readerStatus: vi
          .fn()
          .mockRejectedValueOnce(new Error("offline API"))
          .mockResolvedValue({ online: false }),
      }),
    );
    expect(qCell(el, "[data-test=reader-status-r-1]")!.textContent).toBe("Unknown");
    expect(qCell(el, "[data-test=reader-status-r-2]")!.textContent).toBe("Offline");
    expect(q(el, "[role=alert]")).toBeNull();
  });
});

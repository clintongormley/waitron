import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { html } from "lit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import {
  createRequest,
  LiveData,
  registerCatalogue,
  tableNoMatches,
  type FetchLike,
} from "@waitron/dashboard-kit";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  DashboardApi,
  PaymentProviderRow,
  ReaderRow,
  ReaderStatusView,
  StuckPaymentResolution,
  StuckPaymentRow,
} from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import {
  chooseOption,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

beforeEach(() => setLocale("en"));
beforeEach(() => {
  localStorage.removeItem("waitron.payments.readers.table:columns");
  sessionStorage.removeItem("waitron.payments.readers.table");
});
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
  {
    id: "r-1",
    provider: "acme",
    name: "Front counter",
    active: true,
    canEnable: true,
    deviceCount: 2,
  },
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
    listStuckPayments: vi.fn().mockResolvedValue([]),
    resolveStuckPayment: vi.fn().mockResolvedValue({ outcome: "not_charged", orderUnlocked: true }),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
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

function liveApi(overrides: Partial<DashboardApi> = {}): DashboardApi & { liveData: LiveData } {
  return Object.assign(stubApi(overrides), { liveData: new LiveData() });
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

  it("offers the reader columns but the name and the actions in a translated column chooser, and remembers a hidden one", async () => {
    // In Spanish, because the table's own default label is the English "Columns".
    setLocale("es-ES");
    const { el } = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const root = table.shadowRoot!;
    expect(root.querySelector(".columns-trigger")?.getAttribute("aria-label")).toBe(
      t("table.customise_columns"),
    );
    expect(root.querySelector(".columns-trigger")?.getAttribute("aria-label")).toBe(
      "Personalizar columnas",
    );
    expect(
      [...root.querySelectorAll<HTMLInputElement>("input[data-column]")].map((box) => [
        box.dataset.column,
        box.checked,
      ]),
    ).toEqual([
      ["name", true],
      ["provider", true],
      ["status", true],
      ["battery", true],
      ["deviceCount", true],
      ["actions", true],
    ]);
    const headerLabels = () =>
      [...root.querySelectorAll("thead th")].map((th) =>
        th.textContent!.replace(/[▲▼]/g, "").trim(),
      );
    const before = headerLabels();
    expect(before).toContain(t("payments.reader_col_provider"));
    const box = root.querySelector<HTMLInputElement>('input[data-column="provider"]')!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await table.updateComplete;
    expect(headerLabels()).toEqual(
      before.filter((text) => text !== t("payments.reader_col_provider")),
    );
    expect(JSON.parse(localStorage.getItem("waitron.payments.readers.table:columns")!)).toEqual({
      provider: false,
    });
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

  it("keeps discovery closed when successful pairing also emits close", async () => {
    const panel = {
      ...PANELS[0]!,
      renderAddReader: (ctx: Parameters<CardProviderPanel["renderAddReader"]>[0]) =>
        html`<button
          data-test="pair-success-and-close"
          @click=${() => {
            ctx.onAdded();
            ctx.onClose();
          }}
        >
          Done
        </button>`,
    };
    const { el, api } = await mount(stubApi(), { panels: [panel] });
    q(el, "[data-test=add-reader-acme]")!.click();
    await flush(el);
    q(el, "[data-test=pair-new-reader]")!.click();
    await flush(el);
    q(el, "[data-test=pair-success-and-close]")!.click();
    await flush(el);
    expect(q(el, "[data-test=reader-discovery]")).toBeNull();
    expect(api.availableReaders).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"])("ignores a superseded status read's late %s", async (outcome) => {
    let resolveOld!: (value: ReaderStatusView) => void;
    let rejectOld!: () => void;
    const oldStatus = new Promise<ReaderStatusView>((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = () => reject(new Error("old read"));
    });
    let reads = 0;
    const { el } = await mount(
      stubApi({
        listReaders: vi
          .fn()
          .mockResolvedValueOnce([...READERS, { ...READERS[0], id: "other" }])
          .mockResolvedValue(READERS),
        readerStatus: vi.fn((id: string) =>
          id === "r-1" && reads++ === 0
            ? oldStatus
            : Promise.resolve({ online: true, batteryPercent: 90 }),
        ),
      }),
    );
    qCell(el, "[data-test=disable-other]")!.click();
    await flush(el);
    expect(qCell(el, "[data-test=reader-battery-r-1]")!.textContent).toBe("90%");
    if (outcome === "success") resolveOld({ online: false, batteryPercent: 10 });
    else rejectOld();
    await flush(el);
    expect(qCell(el, "[data-test=reader-battery-r-1]")!.textContent).toBe("90%");
    expect(qCell(el, "[data-test=reader-status-r-1]")!.textContent).toBe("Online");
  });

  it("does not offer Enable for an unpaired reader", async () => {
    const { el } = await mount(
      stubApi({
        listReaders: vi
          .fn()
          .mockResolvedValue([{ ...READERS[0], active: false, canEnable: false }]),
      }),
    );
    const filter = q(el, "wt-combobox[name=reader-status-filter]")!;
    await chooseOption(filter, "disabled");
    await flush(el);
    expect(qCell(el, "[data-test=reader-status-r-1]")!.textContent).toBe("Disabled");
    expect(qCell(el, "[data-test=enable-r-1]")).toBeNull();
  });

  it("says the dashboard's one no-matches sentence when the status filter hides every reader, and its own sentence when there are none", async () => {
    const sentence = async (el: PaymentsScreen) => {
      const table = q(el, "wt-data-table") as HTMLElement & { updateComplete: Promise<unknown> };
      await table.updateComplete;
      return table.shadowRoot!.querySelector(".empty .message")!.textContent;
    };
    const { el } = await mount();
    await chooseOption(q(el, "wt-combobox[name=reader-status-filter]")!, "disabled");
    await flush(el);
    expect(qCell(el, "tbody")).toBeNull();
    expect(await sentence(el)).toBe(tableNoMatches());

    const none = await mount(stubApi({ listReaders: vi.fn().mockResolvedValue([]) }));
    expect(await sentence(none.el)).toBe(t("payments.readers_empty"));
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

  it("says a read that ran out of time is taking too long, not that the connection failed", async () => {
    // A fetch that never answers on its own, and rejects as a real fetch does when it is aborted.
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const request = createRequest({ fetchImpl });
    const api = stubApi({
      listPaymentProviders: vi.fn(() =>
        request<PaymentProviderRow[]>("/management-api/payments/providers", "GET"),
      ),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const mounting = mount(api);
      await vi.advanceTimersByTimeAsync(30_000);
      const { el } = await mounting;
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;

      expect(q(el, "[role=alert]")?.textContent).toBe(
        "Waitron is taking too long to answer. Try again in a moment.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("still says the connection failed when a read cannot reach the server", async () => {
    const request = createRequest({
      fetchImpl: vi.fn<FetchLike>().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const { el } = await mount(
      stubApi({
        listPaymentProviders: vi.fn(() =>
          request<PaymentProviderRow[]>("/management-api/payments/providers", "GET"),
        ),
      }),
    );

    expect(q(el, "[role=alert]")?.textContent).toBe(
      "This browser could not connect to Waitron. Check your connection and try again.",
    );
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

  it("keeps a failed disconnect when a provider connect already in flight completes after it", async () => {
    const api = stubApi({
      disconnectPaymentProvider: vi.fn().mockRejectedValue({ code: "payment.provider_in_use" }),
    });
    const { el } = await mount(api);
    q(el, "[data-test=connect-zeta]")!.click();
    await flush(el);

    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    q(el, "[data-test=disconnect-acme]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("payment.provider_in_use")),
    );

    const reads = vi.mocked(api.listPaymentProviders).mock.calls.length;
    q(el, "[data-test=fake-connect-zeta]")!.click();
    await vi.waitFor(() => expect(api.listPaymentProviders).toHaveBeenCalledTimes(reads + 1));
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("payment.provider_in_use"));
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
async function bottomOf(el: PaymentsScreen, dialog: string): Promise<string> {
  const actions = q(
    el,
    `[data-test=${dialog}] wt-form-actions`,
  ) as HTMLElementTagNameMap["wt-form-actions"];
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}
const errorOf = (el: PaymentsScreen, testId: string): string =>
  (q(el, `[data-test=${testId}]`) as HTMLElement & { error: string }).error;
const isDisabled = (el: PaymentsScreen, testId: string): boolean =>
  q(el, `[data-test=${testId}]`)!.hasAttribute("disabled");
const inputFocused = (el: PaymentsScreen, testId: string): boolean => {
  const field = q(el, `[data-test=${testId}]`)!;
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
};
async function openRename(el: PaymentsScreen) {
  qCell(el, "[data-test=edit-r-1]")!.click();
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

  it("shows an empty-name field error and the bottom message before adoption", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "   ");
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    expect(api.adoptReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=name-v-1]")!.shadowRoot!.textContent).toContain("Enter a reader name");
    expect(await bottomOf(el, "reader-discovery")).toBe(t("form.fix_fields"));
    expect(isDisabled(el, "adopt-v-1")).toBe(true);
    expect(q(el, "wt-form-error-summary")).toBeNull();
  });

  it("says nothing about a reader name before its first Add, and Add works", async () => {
    const { el } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", " ");
    await flush(el);
    expect(errorOf(el, "name-v-1")).toBe("");
    expect(await bottomOf(el, "reader-discovery")).toBe("");
    expect(isDisabled(el, "adopt-v-1")).toBe(false);
  });

  it("focuses an empty reader name on Add and re-checks it on every change", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "");
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, "name-v-1")).toBe(true));
    expect(isDisabled(el, "adopt-v-1")).toBe(true);
    expect(isDisabled(el, "adopt-v-2")).toBe(false);

    changeName(el, "[data-test=name-v-1]", "Garden");
    await flush(el);
    expect(errorOf(el, "name-v-1")).toBe("");
    expect(await bottomOf(el, "reader-discovery")).toBe("");
    expect(isDisabled(el, "adopt-v-1")).toBe(false);

    changeName(el, "[data-test=name-v-1]", " ");
    await flush(el);
    expect(errorOf(el, "name-v-1")).toBe(t("payments.name_required"));
    expect(isDisabled(el, "adopt-v-1")).toBe(true);
    expect(api.adoptReader).not.toHaveBeenCalled();
  });

  it("shows a refused adoption in the dialog's bottom message and leaves Add working", async () => {
    const { el, api } = await mount(
      stubApi({
        availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS),
        adoptReader: vi.fn().mockRejectedValue({ code: "reader.not_listed" }),
      }),
    );
    await openAdd(el);
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    expect(await bottomOf(el, "reader-discovery")).toBe(codeMessage("reader.not_listed"));
    expect(q(el, "[data-test=reader-discovery] [role=alert]")).toBeNull();
    expect(errorOf(el, "name-v-1")).toBe("");
    expect(isDisabled(el, "adopt-v-1")).toBe(false);
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    expect(api.adoptReader).toHaveBeenCalledTimes(2);
  });

  it("starts the discovery form again when it is reopened", async () => {
    const { el } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "");
    q(el, "[data-test=adopt-v-1]")!.click();
    await flush(el);
    q(el, "[data-test=cancel-discovery]")!.click();
    await flush(el);
    await openAdd(el);
    changeName(el, "[data-test=name-v-1]", "");
    await flush(el);
    expect(errorOf(el, "name-v-1")).toBe("");
    expect(await bottomOf(el, "reader-discovery")).toBe("");
    expect(isDisabled(el, "adopt-v-1")).toBe(false);
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

  it("filters readers by status from a labelled dropdown showing Active first", async () => {
    const { el } = await mount(
      stubApi({
        listReaders: vi
          .fn()
          .mockResolvedValue([...READERS, { ...READERS[0], id: "disabled", active: false }]),
      }),
    );
    const filter = q(el, "wt-combobox[name=reader-status-filter]") as HTMLElement & {
      options: { value: string; label: string }[];
      value: string;
      label: string;
      search: string;
    };
    expect(filter.label).toBe(t("payments.reader_col_status"));
    expect(filter.search).toBe("auto");
    expect(filter.options).toEqual([
      { value: "active", label: t("payments.filter_active") },
      { value: "disabled", label: t("payments.filter_disabled") },
      { value: "all", label: t("payments.filter_all") },
    ]);
    expect(filter.value).toBe("active");
    await chooseOption(filter, "disabled");
    await flush(el);
    expect(qCell(el, "[data-test=reader-status-r-1]")).toBeNull();
    expect(qCell(el, "[data-test=reader-status-disabled]")).not.toBeNull();
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
    const filter = q(el, "wt-combobox[name=reader-status-filter]")!;
    await chooseOption(filter, "disabled");
    await flush(el);
    expect(qCell(el, "[data-test=reader-status-r-1]")).toBeNull();
    expect(qCell(el, "[data-test=reader-status-disabled]")!.textContent).toBe("Disabled");
    qCell(el, "[data-test=enable-disabled]")!.click();
    await flush(el);
    expect(api.enableReader).toHaveBeenCalledWith("disabled");
    await chooseOption(filter, "all");
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

  it("says nothing about a renamed reader's name before the first Save, and Save works", async () => {
    const { el } = await mount();
    await openRename(el);
    changeName(el, "[data-test=edit-reader-name]", "");
    await flush(el);
    expect(errorOf(el, "edit-reader-name")).toBe("");
    expect(await bottomOf(el, "reader-editor")).toBe("");
    expect(isDisabled(el, "save-reader")).toBe(false);
  });

  it("on an invalid rename shows both messages, focuses the name, disables Save and re-checks every change", async () => {
    const { el } = await mount();
    await openRename(el);
    changeName(el, "[data-test=edit-reader-name]", "");
    q(el, "[data-test=save-reader]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(inputFocused(el, "edit-reader-name")).toBe(true));
    expect(errorOf(el, "edit-reader-name")).toBe(t("payments.name_required"));
    expect(await bottomOf(el, "reader-editor")).toBe(t("form.fix_fields"));
    expect(isDisabled(el, "save-reader")).toBe(true);

    changeName(el, "[data-test=edit-reader-name]", "Garden");
    await flush(el);
    expect(errorOf(el, "edit-reader-name")).toBe("");
    expect(await bottomOf(el, "reader-editor")).toBe("");
    expect(isDisabled(el, "save-reader")).toBe(false);

    changeName(el, "[data-test=edit-reader-name]", " ");
    await flush(el);
    expect(errorOf(el, "edit-reader-name")).toBe(t("payments.name_required"));
    expect(isDisabled(el, "save-reader")).toBe(true);
  });

  it("shows a refused rename above Save and leaves Save working", async () => {
    const { el, api } = await mount(
      stubApi({ renameReader: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );
    await openRename(el);
    changeName(el, "[data-test=edit-reader-name]", "Garden");
    q(el, "[data-test=save-reader]")!.click();
    await flush(el);
    expect(await bottomOf(el, "reader-editor")).toBe(codeMessage("server.internal"));
    expect(q(el, "[data-test=reader-editor] [role=alert]")).toBeNull();
    expect(isDisabled(el, "save-reader")).toBe(false);
    q(el, "[data-test=save-reader]")!.click();
    await flush(el);
    expect(api.renameReader).toHaveBeenCalledTimes(2);
  });

  it("starts the rename form again when it is reopened", async () => {
    const { el } = await mount();
    await openRename(el);
    changeName(el, "[data-test=edit-reader-name]", "");
    q(el, "[data-test=save-reader]")!.click();
    await flush(el);
    q(el, "[data-test=close-reader-editor]")!.click();
    await flush(el);
    await openRename(el);
    changeName(el, "[data-test=edit-reader-name]", "");
    await flush(el);
    expect(errorOf(el, "edit-reader-name")).toBe("");
    expect(await bottomOf(el, "reader-editor")).toBe("");
    expect(isDisabled(el, "save-reader")).toBe(false);
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

  it("shows an unpair failure only in the confirmation's bottom message, with no alert of its own, and permits retry", async () => {
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
    expect(await bottomOf(el, "reader-editor")).toBe(codeMessage("server.internal"));
    expect(q(el, "[data-test=reader-editor] [role=alert]")).toBeNull();
    expect(isDisabled(el, "confirm-unpair")).toBe(false);
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

describe("payments-screen remaining edges", () => {
  function pressEnter(field: HTMLElement): void {
    field.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  }

  const bodyRowNames = (el: PaymentsScreen): string[] =>
    Array.from(
      el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelectorAll("tbody tr"),
    ).map((row) => row.querySelector("td")!.textContent!.trim());

  it("says so when no payment provider is available", async () => {
    const { el } = await mount(stubApi({ listPaymentProviders: vi.fn().mockResolvedValue([]) }));

    expect(el.shadowRoot!.textContent).toContain("No payment providers are available.");
    expect(q(el, ".providers")).toBeNull();
  });

  it("closes the connect form when Connect is pressed a second time", async () => {
    const { el } = await mount();
    q(el, "[data-test=connect-zeta]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=connect-form-zeta]")).not.toBeNull();

    q(el, "[data-test=connect-zeta]")!.click();
    await el.updateComplete;

    expect(q(el, "[data-test=connect-form-zeta]")).toBeNull();
  });

  it("shows a reader that is still pairing as Pairing", async () => {
    const { el } = await mount(
      stubApi({
        readerStatus: vi.fn().mockResolvedValue({ online: false, pairingStatus: "processing" }),
      }),
    );

    expect(qCell(el, "[data-test=reader-status-r-1]")!.textContent).toBe("Pairing…");
  });

  it("sorts the readers by name, by provider display name and by default count", async () => {
    const panels = [fakePanel("zz", "test.acme.name"), fakePanel("aa", "test.zeta.name")];
    const readers: ReaderRow[] = [
      {
        id: "r-c",
        provider: "zz",
        name: "Counter",
        active: true,
        canEnable: true,
        deviceCount: 10,
      },
      { id: "r-b", provider: "aa", name: "Bar", active: true, canEnable: true, deviceCount: 9 },
    ];
    const { el } = await mount(
      stubApi({
        listPaymentProviders: vi.fn().mockResolvedValue([]),
        listReaders: vi.fn().mockResolvedValue(readers),
      }),
      { panels },
    );
    const table = el.shadowRoot!.querySelector("wt-data-table")!;
    const sortBy = async (key: string) => {
      table.shadowRoot!.querySelector<HTMLButtonElement>(`button[data-sort=${key}]`)!.click();
      await (table as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    };

    await sortBy("name");
    expect(bodyRowNames(el)).toEqual(["Bar", "Counter"]);
    // "zz" displays as Acme Pay and "aa" as Zeta Pay, so the display name and the raw token disagree.
    await sortBy("provider");
    expect(bodyRowNames(el)).toEqual(["Counter", "Bar"]);
    await sortBy("deviceCount");
    expect(bodyRowNames(el)).toEqual(["Bar", "Counter"]);
  });

  it("disables a reader once when its Disable is pressed twice before the first answer", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { el, api } = await mount(
      stubApi({ disableReader: vi.fn().mockReturnValueOnce(pending) }),
    );
    const disable = qCell(el, "[data-test=disable-r-1]")!;

    disable.click();
    disable.click();
    release();
    await flush(el);

    expect(api.disableReader).toHaveBeenCalledTimes(1);
  });

  it("renames once when Save is pressed twice before the first answer", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { el, api } = await mount(
      stubApi({ renameReader: vi.fn().mockReturnValueOnce(pending) }),
    );
    qCell(el, "[data-test=edit-r-1]")!.click();
    await el.updateComplete;
    changeName(el, "[data-test=edit-reader-name]", "Garden");
    await el.updateComplete;
    const save = q(el, "[data-test=save-reader]")!;

    save.click();
    save.click();
    release();

    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.renameReader).toHaveBeenCalledTimes(1);
  });

  it("saves a rename when Enter is pressed in the name field", async () => {
    const { el, api } = await mount();
    qCell(el, "[data-test=edit-r-1]")!.click();
    await el.updateComplete;
    changeName(el, "[data-test=edit-reader-name]", "Garden");
    await el.updateComplete;
    const field = q(el, "[data-test=edit-reader-name]")!;
    await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    pressEnter(field);

    await vi.waitFor(() => expect(api.renameReader).toHaveBeenCalledWith("r-1", "Garden"));
  });

  it("adopts a listed reader when Enter is pressed in its name field", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    const field = q(el, "[data-test=name-v-1]")!;
    await (field as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    pressEnter(field);

    await vi.waitFor(() =>
      expect(api.adoptReader).toHaveBeenCalledWith({
        providerId: "acme",
        providerRef: "v-1",
        name: "My Reader",
      }),
    );
  });

  it("adds a disabled reader again under its existing provider reference", async () => {
    const { el, api } = await mount(
      stubApi({ availableReaders: vi.fn().mockResolvedValue(VENDOR_READERS) }),
    );
    await openAdd(el);
    expect(q(el, "[data-test=adopt-v-2]")!.textContent!.trim()).toBe("Add again");

    q(el, "[data-test=adopt-v-2]")!.click();

    await vi.waitFor(() =>
      expect(api.adoptReader).toHaveBeenCalledWith({
        providerId: "acme",
        providerRef: "v-2",
        name: "Terrace",
      }),
    );
    await vi.waitFor(() => expect(q(el, "[data-test=reader-discovery]")).toBeNull());
  });

  it("closes discovery when its dialog is dismissed", async () => {
    const { el } = await mount();
    await openAdd(el);
    const dialog = q(el, "[data-test=reader-discovery]")!;

    dialog.shadowRoot!.querySelector("dialog")!.close();

    await vi.waitFor(() => expect(q(el, "[data-test=reader-discovery]")).toBeNull());
  });

  it("closes the reader editor when its dialog is dismissed", async () => {
    const { el, api } = await mount();
    qCell(el, "[data-test=edit-r-1]")!.click();
    await el.updateComplete;
    const dialog = q(el, "[data-test=reader-editor]")!;

    dialog.shadowRoot!.querySelector("dialog")!.close();

    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.renameReader).not.toHaveBeenCalled();
  });

  it("shows the no-details copy when the reader's status could not be read", async () => {
    const { el } = await mount(
      stubApi({ readerStatus: vi.fn().mockRejectedValue(new Error("offline API")) }),
    );
    qCell(el, "[data-test=details-r-1]")!.click();
    await el.updateComplete;

    const dialog = q(el, "[data-test=reader-editor]")!;
    expect(dialog.querySelector(".reader-details")).toBeNull();
    expect(dialog.textContent).toContain(t("payments.details_empty"));
    expect(dialog.textContent).toContain("Unknown");
  });

  it("ignores a superseded discovery list's late failure", async () => {
    let failOld!: () => void;
    const old = new Promise<never>((_, reject) => {
      failOld = () => reject(new Error("old outage"));
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
    expect(q(el, "[data-test=name-v-1]")).not.toBeNull();

    failOld();
    await flush(el);

    expect(q(el, "[data-test=name-v-1]")).not.toBeNull();
    expect(q(el, "[data-test=reader-discovery]")!.textContent).not.toContain("Could not check");
  });

  it("refreshes no statuses when Refresh is pressed before the readers have loaded", async () => {
    let release!: (readers: ReaderRow[]) => void;
    const readers = new Promise<ReaderRow[]>((resolve) => {
      release = resolve;
    });
    const api = stubApi({ listReaders: vi.fn().mockReturnValue(readers) });
    const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
      api,
      request: vi.fn() as unknown as PaymentsScreen["request"],
      panels: PANELS,
    });

    q(el, "[data-test=refresh-readers]")!.click();
    await el.updateComplete;
    expect(api.readerStatus).not.toHaveBeenCalled();

    release(READERS);
    await vi.waitFor(() =>
      expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online"),
    );
    expect(api.readerStatus).toHaveBeenCalledTimes(1);
  });
});

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

describe("card payments stuck after a restart", () => {
  const section = (el: PaymentsScreen) => q(el, "[data-test=stuck-payments]");
  const result = (el: PaymentsScreen) => q(el, "[data-test=stuck-result]");

  async function confirmResolve(el: PaymentsScreen, paymentId = "pay-1"): Promise<void> {
    q(el, `[data-test=resolve-${paymentId}]`)!.click();
    await flush(el);
    q(el, "[data-test=confirm-resolve]")!.click();
    await flush(el);
  }

  it("is hidden when no card payment is stuck", async () => {
    const { el, api } = await mount();

    expect(api.listStuckPayments).toHaveBeenCalled();
    expect(section(el)).toBeNull();
  });

  it("lists each stuck payment's order, till, provider, amount and start time", async () => {
    const { el } = await mount(stubApi({ listStuckPayments: vi.fn().mockResolvedValue(STUCK) }));

    expect(section(el)!.querySelector("h2")!.textContent).toBe(
      "Card payments stuck after a restart",
    );
    const row = q(el, "[data-test=stuck-pay-1]")!.textContent!;
    expect(row).toContain("Order 12 · Terrace 3");
    expect(row).toContain("Bar till");
    expect(row).toContain("Acme Pay");
    expect(row).toContain("€12.50");
    expect(row).toContain("9/26/26, 10:05 AM");
    expect(q(el, "[data-test=stuck-pay-2]")!.textContent).toContain("Order 13");
    expect(q(el, "[data-test=stuck-pay-2]")!.textContent).not.toContain("·");
    expect(q(el, "[data-test=resolve-pay-1]")!.textContent).toContain(
      "Check with the card provider",
    );
  });

  it("reads in Spanish", async () => {
    setLocale("es");
    const { el } = await mount(stubApi({ listStuckPayments: vi.fn().mockResolvedValue(STUCK) }));

    expect(section(el)!.querySelector("h2")!.textContent).toBe(
      "Cobros con tarjeta sin resolver tras un reinicio",
    );
    expect(q(el, "[data-test=stuck-pay-1]")!.textContent).toContain("Pedido 12 · Terrace 3");
    // Intl puts a no-break space before the euro sign.
    expect(q(el, "[data-test=stuck-pay-1]")!.textContent).toMatch(/12,50\u00a0€/);
  });

  it("asks for confirmation, explaining both outcomes, before asking the provider", async () => {
    const { el, api } = await mount(
      stubApi({ listStuckPayments: vi.fn().mockResolvedValue(STUCK) }),
    );

    q(el, "[data-test=resolve-pay-1]")!.click();
    await flush(el);
    expect(api.resolveStuckPayment).not.toHaveBeenCalled();
    const dialog = q(el, "[data-test=resolve-dialog]")!;
    expect(dialog.textContent).toContain("If it went through, the sale is recorded");
    expect(dialog.textContent).toContain(
      "If it did not, Waitron cancels it at Acme Pay where it can still be cancelled, and unlocks the order so it can be paid again, unless another card payment on the order is still unresolved.",
    );

    q(el, "[data-test=cancel-resolve]")!.click();
    await flush(el);
    expect(q(el, "[data-test=resolve-dialog]")).toBeNull();
    expect(api.resolveStuckPayment).not.toHaveBeenCalled();
  });

  it("closes the confirmation when its dialog is dismissed", async () => {
    const { el, api } = await mount(
      stubApi({ listStuckPayments: vi.fn().mockResolvedValue(STUCK) }),
    );
    q(el, "[data-test=resolve-pay-1]")!.click();
    await flush(el);

    q(el, "[data-test=resolve-dialog]")!.dispatchEvent(new CustomEvent("wt-close"));
    await flush(el);

    expect(q(el, "[data-test=resolve-dialog]")).toBeNull();
    expect(api.resolveStuckPayment).not.toHaveBeenCalled();
  });

  it.each([
    [
      { outcome: "filed", invoiceNumber: "F-1" },
      "Payment went through — the sale has been recorded.",
    ],
    [
      { outcome: "not_charged", orderUnlocked: true },
      "Payment did not go through — nothing was charged, and the order is unlocked.",
    ],
    [
      { outcome: "not_charged", orderUnlocked: false },
      "Payment did not go through — nothing was charged. The order stays locked while another card payment on it is still in progress or unresolved.",
    ],
  ])("reports %o and refreshes the list", async (answer, text) => {
    const listStuckPayments = vi
      .fn()
      .mockResolvedValueOnce(STUCK)
      .mockResolvedValue(STUCK.slice(1));
    const { el, api } = await mount(
      stubApi({ listStuckPayments, resolveStuckPayment: vi.fn().mockResolvedValue(answer) }),
    );

    await confirmResolve(el);

    expect(api.resolveStuckPayment).toHaveBeenCalledWith("pay-1");
    expect(result(el)!.getAttribute("role")).toBe("status");
    expect(result(el)!.textContent!.trim()).toBe(`Order 12 · Terrace 3: ${text}`);
    expect(listStuckPayments).toHaveBeenCalledTimes(2);
    expect(q(el, "[data-test=stuck-pay-1]")).toBeNull();
    expect(q(el, "[data-test=stuck-pay-2]")).not.toBeNull();
  });

  it("keeps the result showing after the last stuck payment is cleared", async () => {
    const { el } = await mount(
      stubApi({
        listStuckPayments: vi.fn().mockResolvedValueOnce(STUCK.slice(0, 1)).mockResolvedValue([]),
      }),
    );

    await confirmResolve(el);

    expect(section(el)).not.toBeNull();
    expect(q(el, "[data-test=stuck-pay-1]")).toBeNull();
    expect(result(el)!.textContent).toContain("Payment did not go through");
  });

  it.each([
    [
      { code: "payment.outcome_unknown", params: { paymentId: "pay-1", reason: "unreachable" } },
      "Could not reach the card provider; the order stays locked. Try again in a minute.",
    ],
    [
      { code: "payment.outcome_unknown", params: { paymentId: "pay-1", reason: "ambiguous" } },
      "The card provider's answer is unclear; the order stays locked. Check the payment in the provider's dashboard.",
    ],
    [
      { code: "payment.outcome_unknown", params: { paymentId: "pay-1" } },
      "The card provider could not say what happened to this payment; the order stays locked. Try again in a minute.",
    ],
    [
      { code: "payment.not_stuck", params: { paymentId: "pay-1" } },
      "This payment is no longer stuck — the list has been refreshed.",
    ],
    [
      { code: "payment.resolve_unsupported", params: { providerId: "acme" } },
      "Waitron cannot ask this card provider about a stuck payment, so the order stays locked. Check the payment in the provider's dashboard.",
    ],
    [
      { code: "reader.provider_disconnected", params: { providerId: "acme" } },
      "This card provider is no longer connected. Connect it again, then check the payment.",
    ],
    [
      { code: "server.internal", status: 500 },
      "Something went wrong while checking this payment. If it is still listed, try again in a minute.",
    ],
  ])("shows the curated text for a %o refusal and refreshes the list", async (refusal, text) => {
    const listStuckPayments = vi.fn().mockResolvedValue(STUCK);
    const { el } = await mount(
      stubApi({
        listStuckPayments,
        resolveStuckPayment: vi.fn().mockRejectedValue(refusal),
      }),
    );

    await confirmResolve(el);

    expect(result(el)!.getAttribute("role")).toBe("alert");
    expect(result(el)!.textContent!.trim()).toBe(`Order 12 · Terrace 3: ${text}`);
    expect(listStuckPayments).toHaveBeenCalledTimes(2);
  });

  it("reads a refusal the section has no wording of its own for by its code", async () => {
    const { el } = await mount(
      stubApi({
        listStuckPayments: vi.fn().mockResolvedValue(STUCK),
        resolveStuckPayment: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
      }),
    );

    await confirmResolve(el);

    expect(result(el)!.textContent).not.toContain("authorization.not_permitted");
    expect(result(el)!.textContent!.trim()).toMatch(/^Order 12 · Terrace 3: \S/);
  });

  it("treats an answer it does not recognise as the generic failure", async () => {
    const { el } = await mount(
      stubApi({
        listStuckPayments: vi.fn().mockResolvedValue(STUCK),
        resolveStuckPayment: vi.fn().mockResolvedValue({ outcome: "declined" }),
      }),
    );

    await confirmResolve(el);

    expect(result(el)!.getAttribute("role")).toBe("alert");
    expect(result(el)!.textContent).toContain("Something went wrong while checking this payment");
  });

  it("keeps a successful resolve's result when the refresh after it fails", async () => {
    const { el } = await mount(
      stubApi({
        listStuckPayments: vi
          .fn()
          .mockResolvedValueOnce(STUCK)
          .mockRejectedValue({ code: "connection.failed" }),
      }),
    );

    await confirmResolve(el);

    expect(result(el)!.getAttribute("role")).toBe("status");
    expect(result(el)!.textContent).toContain("Payment did not go through");
    expect(q(el, "[data-test=stuck-load-error]")!.textContent!.trim()).toBe(
      codeMessage("connection.failed"),
    );
  });

  it("shows a failed load of the stuck list as a load failure", async () => {
    const { el } = await mount(
      stubApi({ listStuckPayments: vi.fn().mockRejectedValue({ code: "server.internal" }) }),
    );

    expect(section(el)).not.toBeNull();
    expect(q(el, "[data-test=stuck-load-error]")!.getAttribute("role")).toBe("alert");
    expect(q(el, "[data-test=stuck-load-error]")!.textContent).not.toContain("server.internal");
  });

  it("asks the provider once, and disables every check, while a check is running", async () => {
    let release!: (value: StuckPaymentResolution) => void;
    const pending = new Promise<StuckPaymentResolution>((resolve) => {
      release = resolve;
    });
    const { el, api } = await mount(
      stubApi({
        listStuckPayments: vi.fn().mockResolvedValue(STUCK),
        resolveStuckPayment: vi.fn().mockReturnValueOnce(pending),
      }),
    );

    q(el, "[data-test=resolve-pay-1]")!.click();
    await flush(el);
    const confirm = q(el, "[data-test=confirm-resolve]")!;
    confirm.click();
    confirm.click();
    await flush(el);
    expect(q(el, "[data-test=resolve-pay-1]")!.hasAttribute("loading")).toBe(true);
    expect(q(el, "[data-test=resolve-pay-2]")!.hasAttribute("disabled")).toBe(true);
    q(el, "[data-test=resolve-pay-2]")!.click();
    await flush(el);
    expect(q(el, "[data-test=resolve-dialog]")).toBeNull();

    release({ outcome: "not_charged", orderUnlocked: true });
    await flush(el);
    expect(api.resolveStuckPayment).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=resolve-pay-2]")!.hasAttribute("disabled")).toBe(false);
  });

  it("names each check button after its order", async () => {
    const { el } = await mount(stubApi({ listStuckPayments: vi.fn().mockResolvedValue(STUCK) }));

    expect(q(el, "[data-test=resolve-pay-1]")!.getAttribute("aria-label")).toBe(
      "Check with the card provider: Order 12 · Terrace 3",
    );
  });
});

describe("the readers table at phone width", () => {
  // A long unbroken reader name widens the name column past a phone's screen.
  const phoneReaders: ReaderRow[] = [
    ...READERS,
    {
      id: "r-2",
      provider: "acme",
      name: "Terminal-de-la-barra-de-la-terraza-junto-a-la-puerta",
      active: true,
      canEnable: true,
      deviceCount: 0,
    },
  ];
  it.each(["en-GB", "es-ES"])(
    "keeps every reader row's menu on screen and uncovered at 390 px while the other columns scroll sideways (%s)",
    async (locale) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const { el } = await mount(
          stubApi({ listReaders: vi.fn().mockResolvedValue(phoneReaders) }),
        );
        expectRowMenusOnScreen(el.shadowRoot!.querySelector("wt-data-table")!, phoneReaders.length);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
});

describe("the providers and readers once the server answers again", () => {
  const down = { code: "connection.failed" };

  it("fills in a screen opened while its reads failed, and takes the failure's message away", async () => {
    const api = liveApi({
      listPaymentProviders: vi.fn().mockRejectedValueOnce(down).mockResolvedValue(PROVIDERS),
      listReaders: vi.fn().mockRejectedValueOnce(down).mockResolvedValue(READERS),
    });
    const { el } = await mount(api);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));

    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online"),
    );
    expect(q(el, "[data-test=provider-state-acme]")?.textContent).toContain("Connected");
    expect(q(el, "[role=alert]")).toBeNull();
  });

  it("keeps an action's connection failure when the readers' failed read recovers", async () => {
    const api = liveApi({
      listReaders: vi.fn().mockRejectedValueOnce(down).mockResolvedValue(READERS),
      disconnectPaymentProvider: vi.fn().mockRejectedValue(down),
    });
    const { el } = await mount(api);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    expect(api.disconnectPaymentProvider).toHaveBeenCalledWith("acme");

    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online"),
    );
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
  });

  it("does not ask the readers for their status again when the list refreshes in the background", async () => {
    const api = liveApi();
    const { el } = await mount(api);
    expect(api.readerStatus).toHaveBeenCalledTimes(1);

    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(api.readerStatus).toHaveBeenCalledTimes(1);
    expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online");
  });

  it("asks a reader the background refresh newly lists for its status", async () => {
    const api = liveApi({
      listReaders: vi
        .fn()
        .mockResolvedValueOnce(READERS)
        .mockResolvedValue([...READERS, { ...READERS[0], id: "r-2", name: "Terrace" }]),
      readerStatus: vi.fn((id: string) =>
        Promise.resolve({ online: id === "r-1" } as ReaderStatusView),
      ),
    });
    const { el } = await mount(api);

    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(qCell(el, "[data-test=reader-status-r-2]")?.textContent).toBe("Offline"),
    );
    expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online");
  });

  it("keeps an armed Disconnect armed through a background refresh", async () => {
    const api = liveApi();
    const { el } = await mount(api);
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    expect(q(el, "[data-test=disconnect-acme]")!.textContent).toBe(
      t("payments.disconnect_confirm"),
    );

    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listPaymentProviders).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(q(el, "[data-test=disconnect-acme]")!.textContent).toBe(
      t("payments.disconnect_confirm"),
    );
    expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
  });

  it("disarms Disconnect once a background refresh finds the provider no longer connected", async () => {
    const disconnected: PaymentProviderRow[] = [
      { providerId: "acme", state: "not_connected", canUnpair: true },
      PROVIDERS[1]!,
    ];
    const api = liveApi({
      listPaymentProviders: vi
        .fn()
        .mockResolvedValueOnce(PROVIDERS)
        .mockResolvedValueOnce(disconnected)
        .mockResolvedValue(PROVIDERS),
    });
    const { el } = await mount(api);
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);

    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[data-test=connect-acme]")).not.toBeNull());
    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[data-test=disconnect-acme]")).not.toBeNull());
    expect(q(el, "[data-test=disconnect-acme]")!.textContent).toBe(t("payments.disconnect"));
  });

  it("keeps an action's connection failure through a later failed and recovered list read", async () => {
    const api = liveApi({
      listReaders: vi
        .fn()
        .mockResolvedValueOnce(READERS)
        .mockRejectedValueOnce(down)
        .mockResolvedValue(READERS),
      disconnectPaymentProvider: vi.fn().mockRejectedValue(down),
    });
    const { el } = await mount(api);
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    q(el, "[data-test=disconnect-acme]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));

    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await flush(el);
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(3));
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));
  });

  it("asks for reader status through the background client when a background refresh changes the active readers", async () => {
    const background = stubApi({
      listReaders: vi.fn().mockResolvedValue([...READERS, { ...READERS[0], id: "r-2" }]),
    });
    const api = liveApi({ background } as Partial<DashboardApi>);
    const { el } = await mount(api);
    expect(api.readerStatus).toHaveBeenCalledTimes(1);

    api.liveData.refresh();
    await vi.waitFor(() => expect(background.readerStatus).toHaveBeenCalledWith("r-2"));
    await flush(el);
    expect(api.readerStatus).toHaveBeenCalledTimes(1);
  });

  it("asks for reader status through the background client when the readers' failed opening read recovers in the background", async () => {
    const background = stubApi();
    const api = liveApi({
      background,
      listReaders: vi.fn().mockRejectedValueOnce(down).mockResolvedValue(READERS),
    } as Partial<DashboardApi>);
    const { el } = await mount(api);
    expect(q(el, "[role=alert]")?.textContent).toBe(codeMessage("connection.failed"));

    api.liveData.refresh();
    await vi.waitFor(() =>
      expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online"),
    );
    expect(background.readerStatus).toHaveBeenCalledWith("r-1");
    expect(api.readerStatus).not.toHaveBeenCalled();
  });

  it("does not ask the readers for their status again when a background refresh lists them in another order", async () => {
    const second: ReaderRow = { ...READERS[0]!, id: "r-2", name: "Terrace" };
    const api = liveApi({
      listReaders: vi
        .fn()
        .mockResolvedValueOnce([...READERS, second])
        .mockResolvedValue([second, ...READERS]),
    });
    const { el } = await mount(api);
    expect(api.readerStatus).toHaveBeenCalledTimes(2);

    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(api.readerStatus).toHaveBeenCalledTimes(2);
  });
});

describe("the readers' status reads", () => {
  const readers = (count: number): ReaderRow[] =>
    Array.from({ length: count }, (_, i) => ({ ...READERS[0]!, id: `r-${i + 1}` }));

  // The slots are shared, so screens go first: a queued read then gives up. Answering first would let
  // it start a request nobody answers, holding both slots into the next case.
  const unanswered: (() => void)[] = [];
  afterEach(() => {
    cleanupWidgets();
    for (const answer of unanswered.splice(0)) answer();
  });

  function heldStatuses(): {
    readerStatus: Mock<(id: string) => Promise<ReaderStatusView>>;
    answer: (id: string) => void;
  } {
    const waiting: { id: string; resolve: () => void }[] = [];
    const readerStatus = vi.fn(
      (id: string) =>
        new Promise<ReaderStatusView>((resolve) => {
          const entry = { id, resolve: () => resolve({ online: true } as ReaderStatusView) };
          waiting.push(entry);
          unanswered.push(entry.resolve);
        }),
    );
    return {
      readerStatus,
      answer: (id) => {
        for (const entry of waiting.filter((e) => e.id === id)) {
          waiting.splice(waiting.indexOf(entry), 1);
          entry.resolve();
        }
      },
    };
  }

  it("asks at most two readers at a time, so a silent card provider cannot hold every connection to the box", async () => {
    const held = heldStatuses();
    const { el } = await mount(
      stubApi({
        listReaders: vi.fn().mockResolvedValue(readers(6)),
        readerStatus: held.readerStatus,
      }),
    );
    await flush(el);
    expect(held.readerStatus.mock.calls.map(([id]) => id)).toEqual(["r-1", "r-2"]);

    held.answer("r-1");
    await vi.waitFor(() => expect(held.readerStatus).toHaveBeenCalledTimes(3));
    await flush(el);
    expect(held.readerStatus).toHaveBeenCalledTimes(3);
    expect(qCell(el, "[data-test=reader-status-r-1]")?.textContent).toBe("Online");
  });

  it("asks every active reader in the end", async () => {
    const held = heldStatuses();
    const { el } = await mount(
      stubApi({
        listReaders: vi.fn().mockResolvedValue(readers(6)),
        readerStatus: held.readerStatus,
      }),
    );
    for (let i = 1; i <= 6; i++) {
      await vi.waitFor(() => expect(held.readerStatus).toHaveBeenCalledWith(`r-${i}`));
      held.answer(`r-${i}`);
    }
    await vi.waitFor(() =>
      expect(qCell(el, "[data-test=reader-status-r-6]")?.textContent).toBe("Online"),
    );
    expect(held.readerStatus).toHaveBeenCalledTimes(6);
  });

  it("starts no third read when a refresh asks again while two are still waiting", async () => {
    const held = heldStatuses();
    const api = liveApi({
      listReaders: vi.fn().mockResolvedValueOnce(readers(4)).mockResolvedValue(readers(5)),
      readerStatus: held.readerStatus,
    });
    const { el } = await mount(api);
    expect(held.readerStatus).toHaveBeenCalledTimes(2);

    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(held.readerStatus).toHaveBeenCalledTimes(2);

    held.answer("r-1");
    held.answer("r-2");
    await vi.waitFor(() => expect(held.readerStatus).toHaveBeenCalledTimes(4));
    await flush(el);
    expect(held.readerStatus.mock.calls.map(([id]) => id)).toEqual(["r-1", "r-2", "r-1", "r-2"]);
  });

  it("starts no third read when the screen is closed and opened again while two are still waiting", async () => {
    const held = heldStatuses();
    const api = stubApi({
      listReaders: vi.fn().mockResolvedValue(readers(4)),
      readerStatus: held.readerStatus,
    });
    const first = await mount(api);
    expect(held.readerStatus).toHaveBeenCalledTimes(2);

    first.host.remove();
    const { el } = await mount(api);
    await flush(el);
    expect(held.readerStatus).toHaveBeenCalledTimes(2);

    held.answer("r-1");
    held.answer("r-2");
    await vi.waitFor(() => expect(held.readerStatus).toHaveBeenCalledTimes(4));
    await flush(el);
    expect(held.readerStatus.mock.calls.map(([id]) => id)).toEqual(["r-1", "r-2", "r-1", "r-2"]);
  });

  it("starts no read for a screen closed while an action on it was still being answered", async () => {
    const held = heldStatuses();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { el, host } = await mount(
      stubApi({
        listReaders: vi.fn().mockResolvedValue(readers(1)),
        readerStatus: held.readerStatus,
        disableReader: vi.fn().mockReturnValueOnce(pending),
      }),
    );
    expect(held.readerStatus).toHaveBeenCalledTimes(1);
    qCell(el, "[data-test=disable-r-1]")!.click();

    host.remove();
    release();
    await flush(el);
    expect(held.readerStatus).toHaveBeenCalledTimes(1);
  });

  it("asks its readers again when a closed screen is put back on the page", async () => {
    const held = heldStatuses();
    const { el, host } = await mount(
      stubApi({
        listReaders: vi.fn().mockResolvedValue(readers(1)),
        readerStatus: held.readerStatus,
      }),
    );
    held.answer("r-1");
    await flush(el);

    host.remove();
    document.body.appendChild(host);
    await vi.waitFor(() => expect(held.readerStatus).toHaveBeenCalledTimes(2));
  });
});

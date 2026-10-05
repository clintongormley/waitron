import { page } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type {
  DashboardApi,
  LocationSummary,
  Printer,
  Station,
  StationPrinter,
  Watcher,
} from "../api/client.js";
import { PrintingRulesScreen } from "./printing-rules-screen.js";
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
const printers: Printer[] = [
  {
    id: "p1",
    name: "Cocina",
    transport: "network_tcp",
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    pollId: null,
    watcherId: null,
    paperWidth: "80mm",
    resolution: "180dpi",
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: true,
  },
  {
    id: "p2",
    name: "Nube",
    transport: "cloud_poll",
    host: null,
    port: null,
    localKey: null,
    pollId: "poll-1",
    watcherId: null,
    paperWidth: "80mm",
    resolution: "180dpi",
    hasCashDrawer: false,
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active: false,
  },
];

const stations: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
  {
    id: "s2",
    name: "Barra",
    displayOrder: 1,
    isDefault: false,
    active: true,
    showsRestOfOrder: false,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];
const watchers: Watcher[] = [
  {
    id: "w1",
    name: "Pass",
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    displayOrder: 0,
    active: true,
    printerIds: [],
  },
  {
    id: "w2",
    name: "Terrace",
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: false,
    displayOrder: 1,
    active: true,
    printerIds: [],
  },
];

const locations: LocationSummary[] = [{ id: "loc-1", name: "Barra" }];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPrinters: vi.fn().mockResolvedValue(printers),
    updatePrinter: vi.fn().mockResolvedValue(undefined),
    listStations: vi.fn().mockResolvedValue(stations),
    listWatchers: vi.fn().mockResolvedValue(watchers),
    setPrinterWatcher: vi.fn().mockResolvedValue(undefined),
    listPrinterStations: vi.fn().mockResolvedValue([] as StationPrinter[]),
    attachPrinterToStation: vi.fn().mockResolvedValue(undefined),
    detachPrinterFromStation: vi.fn().mockResolvedValue(undefined),
    getLocations: vi.fn().mockResolvedValue(locations),
    setDrawerOpenPolicy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: PrintingRulesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: PrintingRulesScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const text = (el: PrintingRulesScreen, sel: string) => q(el, sel)?.textContent?.trim();

describe("printing rules", () => {
  it("has no station assignment controls for an empty venue either", async () => {
    const a = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: a,
    });
    await flush(el);
    expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
    expect(q(el, '[data-test^="no-stations-"]')).toBeNull();
    expect(a.listStations).not.toHaveBeenCalled();
    expect(q(el, '[data-test="printer-watcher-p1"]')).not.toBeNull();
    expect(q(el, '[data-test="drawer-policy-loc-1-gated"]')).not.toBeNull();
  });

  it("shows no per-till section", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    for (const selector of [
      "[data-test^=till-row-]",
      "[data-test^=till-receipt-printer-]",
      "[data-test^=till-opens-drawer-]",
      "[data-test=no-tills]",
    ]) {
      expect(q(el, selector)).toBeNull();
    }
    expect(q(el, "[data-test=printer-watcher-p1]")).not.toBeNull();
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull();
  });

  it("keeps drawer policy here while receipt advice lives with departments and zones", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    expect(q(el, "[data-test^=print-mode-]")).toBeNull();
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull();
  });

  it("renders a drawer-policy toggle per location and calls setDrawerOpenPolicy with the chosen policy", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    (api.getLocations as ReturnType<typeof vi.fn>).mockClear();

    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull();
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")).not.toBeNull();
    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);

    expect(api.setDrawerOpenPolicy).toHaveBeenCalledWith("loc-1", "open");
    expect(api.getLocations).toHaveBeenCalledTimes(1);
  });

  it("reflects the picked drawer policy in the segmented control (primary variant), surviving the reload", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=drawer-policy-loc-1-gated]")!.click();
    await flush(el);
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe(
      "secondary",
    );
  });

  it("leaves the drawer-policy toggle on the PRIOR policy (not the failed value) and shows the banner when setDrawerOpenPolicy is rejected", async () => {
    const api = stubApi({
      setDrawerOpenPolicy: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=drawer-policy-loc-1-gated]")!.click();
    await flush(el);
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);

    // The failed pick is not applied.
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")!.getAttribute("variant")).toBe(
      "secondary",
    );
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("management.request_invalid", "es-ES"));
    expect(banner).not.toContain("management.request_invalid");
  });

  it("shows the no-locations placeholder when the venue has none", async () => {
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    expect(text(el, "[data-test=no-locations-drawer]")).toBe(t("printers.no_locations", "es-ES"));
  });

  it("does not invent the location's current drawer setting", async () => {
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe(
      "secondary",
    );
    expect(q(el, "[data-test=drawer-policy-unknown-loc-1]")).toBeTruthy();
  });
  it("offers watchers and saves a selected watcher", async () => {
    const api = stubApi({
      listPrinters: vi.fn().mockResolvedValue([{ ...printers[0], watcherId: "w1" }]),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    const select = q(el, "wt-combobox[name=watcherId]") as HTMLElement & {
      value: string;
      options: { value: string; label: string }[];
    };
    expect(q(el, "[name=ticketScope]")).toBeNull();
    expect(select.options.map((option) => [option.value, option.label])).toEqual([
      ["", t("printers.watcher_no")],
      ["w1", "Pass"],
      ["w2", "Terrace"],
    ]);
    expect(select.value).toBe("w1");
    select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "w2" } }));
    await flush(el);
    expect(api.setPrinterWatcher).toHaveBeenCalledWith("p1", "w2");
    expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
  });
  it("keeps the watcher picker inside a phone-width printer card", async () => {
    const { host, el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: stubApi(),
    });
    host.style.width = "320px";
    await flush(el);
    const select = q(el, "wt-combobox[name=watcherId]")!;
    expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(
      el.getBoundingClientRect().right,
    );
  });
  it("shows a watcher attachment refusal inside its printer card and restores the stored selection", async () => {
    const attached = true;
    const api = stubApi({
      setPrinterWatcher: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1" && attached ? [{ stationId: "s1", printerId: "p1" }] : [],
      ),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    const select = q(el, "wt-combobox[name=watcherId]") as HTMLElement & { value: string };
    select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "w1" } }));
    await flush(el);
    expect(select.value).toBe("");
    expect(select.closest("wt-card")!.textContent).toContain(t("printers.watcher_conflict"));
    expect(api.detachPrinterFromStation).not.toHaveBeenCalled();
  });
  it("reports loading failures", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toContain(codeMessage("server.internal", "es-ES"));
  });
  it("clears a failed load's message and shows the printers once the server answers again", async () => {
    const api = Object.assign(
      stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await vi.waitFor(() =>
      expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES")),
    );
    vi.mocked(api.listPrinters).mockResolvedValue(printers);
    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
    await vi.waitFor(() => expect(q(el, "[data-test=printer-watcher-p1]")).toBeTruthy());
    expect(api.listPrinterStations).toHaveBeenCalledWith("p1");
  });
  it("shows the empty printer state", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    expect(text(el, "[data-test=no-printers]")).toBe(t("printers.no_printers", "es-ES"));
  });
});
describe.each(["light", "dark"] as const)("printing rules accessibility (%s)", (theme) => {
  it.each(["empty", "error"])("renders the %s state accessibly", async (state) => {
    const api = stubApi({
      listPrinters:
        state === "error"
          ? vi.fn().mockRejectedValue({ code: "server.internal" })
          : vi.fn().mockResolvedValue([]),
      listStations: vi.fn().mockResolvedValue([]),
      getLocations: vi.fn().mockResolvedValue([]),
    });
    const { el, host } = await mountWidget<PrintingRulesScreen>(
      "dashboard-printing-rules-screen",
      { api },
      theme,
    );
    await flush(el);
    expect(q(el, state === "error" ? "[role=alert]" : "[data-test=no-printers]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
  it("labels controls and groups accessibly", async () => {
    const { el, host } = await mountWidget<PrintingRulesScreen>(
      "dashboard-printing-rules-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

it("uses a named shared watcher picker with station choices only in Tickets", async () => {
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: stubApi(),
  });
  await flush(el);
  expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
  expect(q(el, "wt-combobox[name=watcherId]")?.getAttribute("name")).toBe("watcherId");
});

it("refreshes displayed printers when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-printing-rules-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["printers"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listPrinters).mockResolvedValue([]);
  liveData.invalidate([{ type: "printers", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listPrinters).toHaveBeenCalledTimes(2);
});

it("ignores a second change while a save is still in flight", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = stubApi({ setDrawerOpenPolicy: vi.fn().mockReturnValueOnce(pending) });
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=drawer-policy-loc-1-open]")).not.toBeNull());

  q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
  q(el, "[data-test=drawer-policy-loc-1-gated]")!.click();

  expect(api.setDrawerOpenPolicy).toHaveBeenCalledTimes(1);
  expect(api.setDrawerOpenPolicy).toHaveBeenCalledWith("loc-1", "open");
  release();
  await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      (q(el, "[data-test=drawer-policy-loc-1-gated]") as HTMLElement & { disabled: boolean })
        .disabled,
    ).toBe(false),
  );
  expect(api.setDrawerOpenPolicy).toHaveBeenCalledTimes(1);
});

it("keeps a save's connection failure when the reads that failed beside it recover", async () => {
  const liveData = new LiveData();
  const api = Object.assign(
    stubApi({ setDrawerOpenPolicy: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
    { liveData },
  );
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api,
  });
  await vi.waitFor(() => expect(q(el, "[data-test=printer-watcher-p1]")).not.toBeNull());

  vi.mocked(api.listPrinters).mockRejectedValue({ code: "connection.failed" });
  liveData.refresh();
  await vi.waitFor(() =>
    expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES")),
  );
  q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
  await vi.waitFor(() => expect(api.setDrawerOpenPolicy).toHaveBeenCalledTimes(1));
  await flush(el);
  const readsBefore = vi.mocked(api.listPrinters).mock.calls.length;
  liveData.refresh();
  await vi.waitFor(() =>
    expect(vi.mocked(api.listPrinters).mock.calls.length).toBeGreaterThan(readsBefore),
  );
  await flush(el);

  vi.mocked(api.listPrinters).mockResolvedValue([...printers, { ...printers[0]!, id: "p3" }]);
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, "[data-test=printer-watcher-p3]")).not.toBeNull());
  await flush(el);
  expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES"));
});

it("hands station assignment to Prep stations Tickets while retaining watcher and drawer controls", async () => {
  const a = stubApi();
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: a,
  });
  await flush(el);
  expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
  expect(q(el, '[data-test^="no-stations-"]')).toBeNull();
  expect(
    el.shadowRoot!.querySelector('[aria-label="' + t("printers.stations_title") + '"]'),
  ).toBeNull();
  expect(q(el, '[data-test="printer-watcher-p1"]')).not.toBeNull();
  expect(q(el, '[data-test="drawer-policy-loc-1-gated"]')).not.toBeNull();
  expect(a.listStations).not.toHaveBeenCalled();
  expect(a.attachPrinterToStation).not.toHaveBeenCalled();
  expect(a.detachPrinterFromStation).not.toHaveBeenCalled();
});

it("clears only a resolved printer conflict when Tickets removes the last station mapping", async () => {
  const liveData = new LiveData();
  const attached = new Set(["s1", "s2"]);
  const a = Object.assign(
    stubApi({
      setPrinterWatcher: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1" ? [...attached].map((stationId) => ({ stationId, printerId })) : [],
      ),
    }),
    { liveData },
  );
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: a,
  });
  await flush(el);
  const select = q(el, '[data-test="printer-watcher-p1"]')!;
  const card = select.closest("wt-card")!;
  select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "w1" } }));
  await flush(el);
  expect(card.textContent).toContain(t("printers.watcher_conflict"));
  attached.delete("s1");
  liveData.invalidate([{ type: "station_printers", id: "changed-in-tickets" }]);
  await vi.waitFor(() => expect(a.listPrinterStations).toHaveBeenCalledTimes(4));
  expect(card.textContent).toContain(t("printers.watcher_conflict"));
  attached.delete("s2");
  liveData.invalidate([{ type: "station_printers", id: "changed-in-tickets" }]);
  await vi.waitFor(() => expect(card.textContent).not.toContain(t("printers.watcher_conflict")));
  expect(a.setPrinterWatcher).toHaveBeenCalledExactlyOnceWith("p1", "w1");
  expect(a.detachPrinterFromStation).not.toHaveBeenCalled();
});

it.each([
  [
    "en",
    "No: prints station tickets",
    "Remove this printer from its stations in Prep stations → Tickets before using it for watcher copies.",
  ],
  [
    "es",
    "No: imprime comandas de estación",
    "Quita esta impresora de sus estaciones en Estaciones de preparación → Comandas antes de usarla para copias de un punto de seguimiento.",
  ],
] as const)(
  "directs a station-printer conflict to its new editor (%s)",
  async (locale, option, refusal) => {
    setLocale(locale);
    try {
      const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
        api: stubApi({
          setPrinterWatcher: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
        }),
      });
      await flush(el);
      const select = q(el, '[data-test="printer-watcher-p1"]') as HTMLElement & {
        options: { value: string; label: string }[];
      };
      expect(select.options.find((row) => row.value === "")!.label).toBe(option);
      select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "w1" } }));
      await vi.waitFor(() => expect(select.closest("wt-card")!.textContent).toContain(refusal));
    } finally {
      setLocale("es");
    }
  },
);

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "Printing rules handover and refusal remain accessible (%s %s %ipx)",
  async (locale, theme, width) => {
    const prior = { width: window.innerWidth, height: window.innerHeight };
    setLocale(locale);
    try {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<PrintingRulesScreen>(
        "dashboard-printing-rules-screen",
        {
          api: stubApi({
            setPrinterWatcher: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
          }),
        },
        theme,
      );
      await flush(el);
      expect(window.innerWidth).toBe(width);
      expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
      const select = q(el, '[data-test="printer-watcher-p1"]')!;
      expect(q(el, '[data-test="drawer-policy-loc-1-gated"]')).not.toBeNull();
      await expectNoA11yViolations(host);
      select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "w1" } }));
      await vi.waitFor(() =>
        expect(select.closest("wt-card")!.textContent).toContain(t("printers.watcher_conflict")),
      );
      expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      expect(select.closest("wt-card")!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
    } finally {
      setLocale("es");
      await page.viewport(prior.width, prior.height);
    }
  },
);

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
    expect(q(el, '[data-test="printer-watcher-p1"]')).toBeNull();
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
    expect(q(el, "[data-test=printer-watcher-p1]")).toBeNull();
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
  it("reports loading failures", async () => {
    const api = stubApi({ getLocations: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toContain(codeMessage("server.internal", "es-ES"));
  });
  it("clears a failed load's message and shows locations once the server answers again", async () => {
    const api = Object.assign(
      stubApi({ getLocations: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await vi.waitFor(() =>
      expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES")),
    );
    vi.mocked(api.getLocations).mockResolvedValue(locations);
    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
    await vi.waitFor(() => expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).toBeTruthy());
    expect(api.getLocations).toHaveBeenCalledTimes(2);
  });
  it("keeps the kitchen assignment links when no printers exist", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    expect(q(el, '[data-test="tickets-link"]')).not.toBeNull();
    expect(q(el, '[data-test="watchers-link"]')).not.toBeNull();
  });
});
describe.each(["light", "dark"] as const)("printing rules accessibility (%s)", (theme) => {
  it.each(["empty", "error"])("renders the %s state accessibly", async (state) => {
    const api = stubApi({
      getLocations:
        state === "error"
          ? vi.fn().mockRejectedValue({ code: "server.internal" })
          : vi.fn().mockResolvedValue([]),
    });
    const { el, host } = await mountWidget<PrintingRulesScreen>(
      "dashboard-printing-rules-screen",
      { api },
      theme,
    );
    await flush(el);
    expect(
      q(el, state === "error" ? "[role=alert]" : "[data-test=no-locations-drawer]"),
    ).not.toBeNull();
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

it("links to watcher assignments with both kitchen editors removed", async () => {
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: stubApi(),
  });
  await flush(el);
  expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
  expect(q(el, "wt-combobox[name=watcherId]")).toBeNull();
  expect(q(el, '[data-test="watchers-link"]')?.getAttribute("href")).toBe(
    "/manage/prep-stations/view/watchers",
  );
});

it("refreshes displayed locations when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", { api });
  await vi.waitFor(() => expect(text(el, "[data-test=drawer-location-name-loc-1]")).toBe("Barra"));
  vi.mocked(api.getLocations).mockResolvedValue([{ id: "loc-1", name: "Dining room" }]);
  liveData.invalidate([{ type: "locations", id: "loc-1" }]);
  await vi.waitFor(() =>
    expect(text(el, "[data-test=drawer-location-name-loc-1]")).toBe("Dining room"),
  );
  expect(api.getLocations).toHaveBeenCalledTimes(2);
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
  await vi.waitFor(() => expect(api.getLocations).toHaveBeenCalledTimes(2));
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
  await vi.waitFor(() => expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull());

  vi.mocked(api.getLocations).mockRejectedValue({ code: "connection.failed" });
  liveData.refresh();
  await vi.waitFor(() =>
    expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES")),
  );
  q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
  await vi.waitFor(() => expect(api.setDrawerOpenPolicy).toHaveBeenCalledTimes(1));
  await flush(el);
  const readsBefore = vi.mocked(api.getLocations).mock.calls.length;
  liveData.refresh();
  await vi.waitFor(() =>
    expect(vi.mocked(api.getLocations).mock.calls.length).toBeGreaterThan(readsBefore),
  );
  await flush(el);

  vi.mocked(api.getLocations).mockResolvedValue([...locations, { id: "loc-3", name: "Terrace" }]);
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, "[data-test=drawer-policy-loc-3-gated]")).not.toBeNull());
  await flush(el);
  expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES"));
});

it("hands station assignment to Prep stations Tickets while retaining drawer controls", async () => {
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
  expect(q(el, '[data-test="printer-watcher-p1"]')).toBeNull();
  expect(q(el, '[data-test="drawer-policy-loc-1-gated"]')).not.toBeNull();
  expect(a.listStations).not.toHaveBeenCalled();
  expect(a.attachPrinterToStation).not.toHaveBeenCalled();
  expect(a.detachPrinterFromStation).not.toHaveBeenCalled();
});

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
  "Printing rules assignment links and drawer controls remain accessible (%s %s %ipx)",
  async (locale, theme, width) => {
    const prior = { width: window.innerWidth, height: window.innerHeight };
    setLocale(locale);
    try {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<PrintingRulesScreen>(
        "dashboard-printing-rules-screen",
        { api: stubApi() },
        theme,
      );
      await flush(el);
      expect(window.innerWidth).toBe(width);
      expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
      const tickets = q(el, '[data-test="tickets-link"]')!;
      const watchers = q(el, '[data-test="watchers-link"]')!;
      expect(tickets.getAttribute("href")).toBe("/manage/prep-stations/view/tickets");
      expect(watchers.getAttribute("href")).toBe("/manage/prep-stations/view/watchers");
      expect(q(el, '[data-test="drawer-policy-loc-1-gated"]')).not.toBeNull();
      await expectNoA11yViolations(host);
      expect(tickets.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      expect(watchers.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `look/watcher-handover-${locale}-${theme}-${width}.png` });
    } finally {
      setLocale("es");
      await page.viewport(prior.width, prior.height);
    }
  },
);

it("hands both printer assignments to Tickets and Watchers without reading their configuration", async () => {
  const a = stubApi();
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: a,
  });
  await flush(el);
  expect(q(el, '[data-test^="printer-watcher-"]')).toBeNull();
  expect(q(el, '[data-test^="station-toggle-"]')).toBeNull();
  expect(q(el, '[data-test="tickets-link"]')?.getAttribute("href")).toBe(
    "/manage/prep-stations/view/tickets",
  );
  expect(q(el, '[data-test="watchers-link"]')?.getAttribute("href")).toBe(
    "/manage/prep-stations/view/watchers",
  );
  expect(q(el, '[data-test="drawer-policy-loc-1-gated"]')).not.toBeNull();
  expect(a.listPrinters).not.toHaveBeenCalled();
  expect(a.listPrinterStations).not.toHaveBeenCalled();
  expect(a.listWatchers).not.toHaveBeenCalled();
});

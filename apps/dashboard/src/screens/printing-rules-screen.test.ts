import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
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
  Till,
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

const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1", opensDrawer: true },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null, opensDrawer: true },
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
    listTills: vi.fn().mockResolvedValue(tills),
    getLocations: vi.fn().mockResolvedValue(locations),
    setTillReceiptPrinter: vi.fn().mockResolvedValue(undefined),
    setTillOpensDrawer: vi.fn().mockResolvedValue(undefined),
    setReceiptPrintMode: vi.fn().mockResolvedValue(undefined),
    setDrawerOpenPolicy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: PrintingRulesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: PrintingRulesScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
type Dropdown = HTMLElement & {
  options: { value: string; label: string }[];
  value: string;
  name: string;
  disabled: boolean;
};
const text = (el: PrintingRulesScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** Exercise the native switch change event after the browser toggles its checked property. */
function toggleSwitch(el: PrintingRulesScreen, sel: string, checked: boolean): void {
  const input = q(el, sel)!.shadowRoot!.querySelector("input")!;
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function pickSelect(el: PrintingRulesScreen, sel: string, value: string): void {
  void chooseOption(q(el, sel)!, value);
}

const switchChecked = (el: PrintingRulesScreen, sel: string): boolean =>
  q(el, sel)!.shadowRoot!.querySelector("input")!.checked;

describe("printing rules", () => {
  it("renders a station toggle per station, checked when this printer is attached", async () => {
    const api = stubApi({
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1" ? [{ stationId: "s1", printerId: "p1" }] : [],
      ),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    // p1 is attached to s1 only; p2 to nothing. Each station is a labelled toggle on each printer.
    expect(q(el, "[data-test=station-toggle-p1-s1]")).toBeTruthy();
    expect(q(el, "[data-test=station-toggle-p1-s2]")).toBeTruthy();
    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(true);
    expect(switchChecked(el, "[data-test=station-toggle-p1-s2]")).toBe(false);
    expect(switchChecked(el, "[data-test=station-toggle-p2-s1]")).toBe(false);
    expect(switchChecked(el, "[data-test=station-toggle-p2-s2]")).toBe(false);
    expect(q(el, "[data-test=station-toggle-p1-s1]")!.getAttribute("aria-label")).toBe("Cocina");
    expect(api.listPrinterStations).toHaveBeenCalledWith("p1");
    expect(api.listPrinterStations).toHaveBeenCalledWith("p2");
  });

  it("attaches a station when its toggle is switched on, and reflects the change after reload", async () => {
    const attached = new Set<string>();
    const api = stubApi({
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1"
          ? [...attached].map((stationId) => ({ stationId, printerId: "p1" }))
          : [],
      ),
      attachPrinterToStation: vi.fn(async (stationId: string) => {
        attached.add(stationId);
      }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    expect(switchChecked(el, "[data-test=station-toggle-p1-s2]")).toBe(false);
    toggleSwitch(el, "[data-test=station-toggle-p1-s2]", true);
    await flush(el);

    expect(api.attachPrinterToStation).toHaveBeenCalledWith("s2", "p1");
    expect(api.detachPrinterFromStation).not.toHaveBeenCalled();
    expect(api.listPrinters).toHaveBeenCalledTimes(2);
    expect(switchChecked(el, "[data-test=station-toggle-p1-s2]")).toBe(true);
  });

  it("detaches a station when its toggle is switched off, and reflects the change after reload", async () => {
    const attached = new Set<string>(["s1"]);
    const api = stubApi({
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1"
          ? [...attached].map((stationId) => ({ stationId, printerId: "p1" }))
          : [],
      ),
      detachPrinterFromStation: vi.fn(async (stationId: string) => {
        attached.delete(stationId);
      }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(true);
    toggleSwitch(el, "[data-test=station-toggle-p1-s1]", false);
    await flush(el);

    expect(api.detachPrinterFromStation).toHaveBeenCalledWith("s1", "p1");
    expect(api.attachPrinterToStation).not.toHaveBeenCalled();
    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(false);
  });

  it("shows an error banner when a station toggle is rejected", async () => {
    const api = stubApi({
      attachPrinterToStation: vi.fn().mockRejectedValue({ code: "station.not_found" }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    toggleSwitch(el, "[data-test=station-toggle-p1-s1]", true);
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("station.not_found", "es-ES"));
    expect(banner).not.toContain("station.not_found");
    expect(switchChecked(el, "[data-test=station-toggle-p1-s1]")).toBe(false);
  });

  it("shows the no-stations placeholder when the venue has no stations", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    expect(text(el, "[data-test=no-stations-p1]")).toBe(t("printers.no_stations", "es-ES"));
    expect(q(el, "[data-test=station-toggle-p1-s1]")).toBeNull();
  });

  // ── Receipt printer picker + print-mode toggle ─────────────────────────────────────────────────────

  it("renders a receipt-printer picker per till, offering the ACTIVE printers + a 'no printer' option", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    const select = q(el, "[data-test=till-receipt-printer-t1]") as Dropdown;
    expect(select).not.toBeNull();
    const values = [...select.options].map((o) => o.value);
    // The clear option ("") first, then only the ACTIVE printer p1 — the inactive p2 is not offered.
    expect(values).toEqual(["", "p1"]);
    expect(select.options[0]!.label).toContain(t("printers.receipt_no_printer", "es-ES"));
  });

  it("reflects each till's PERSISTED receipt printer in its dropdown (set → the id, unset → the clear option)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    expect((q(el, "[data-test=till-receipt-printer-t1]") as Dropdown).value).toBe("p1");
    expect((q(el, "[data-test=till-receipt-printer-t2]") as Dropdown).value).toBe("");
  });

  it("picks a till's receipt printer from a labelled dropdown showing the stored one, prompting no printer while it has none", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    type Combobox = HTMLElement & {
      options: { value: string; label: string }[];
      value: string;
      label: string;
      placeholder: string;
      name: string;
    };
    const t1 = q(el, "wt-combobox[data-test=till-receipt-printer-t1]") as Combobox;
    const t2 = q(el, "wt-combobox[data-test=till-receipt-printer-t2]") as Combobox;
    expect(t1.name).toBe("receiptPrinterId");
    expect(t1.label).toBe(t("printers.receipt_printer"));
    expect(t1.placeholder).toBe(t("printers.receipt_no_printer"));
    expect(t1.options).toEqual([
      { value: "", label: t("printers.receipt_no_printer") },
      { value: "p1", label: "Cocina" },
    ]);
    expect(t1.value).toBe("p1");
    expect(t2.value).toBe("");
    await chooseOption(t2, "p1");
    await flush(el);
    expect(api.setTillReceiptPrinter).toHaveBeenCalledWith("t2", "p1");
  });

  it("shows the till's stored receipt printer again after a refused change", async () => {
    const api = stubApi({
      setTillReceiptPrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    const t1 = q(el, "wt-combobox[data-test=till-receipt-printer-t1]") as HTMLElement & {
      value: string;
    };
    await chooseOption(t1, "");
    await flush(el);
    expect(q(el, "[role=alert]")).not.toBeNull();
    expect(t1.value).toBe("p1");
  });

  it("picking a printer calls setTillReceiptPrinter with the till + chosen printer id, then reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    (api.listTills as ReturnType<typeof vi.fn>).mockClear();

    pickSelect(el, "[data-test=till-receipt-printer-t2]", "p1");
    await flush(el);
    expect(api.setTillReceiptPrinter).toHaveBeenCalledWith("t2", "p1");
    expect(api.listTills).toHaveBeenCalledTimes(1);
  });

  it("clearing the picker ('no printer') calls setTillReceiptPrinter with null", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    pickSelect(el, "[data-test=till-receipt-printer-t1]", "");
    await flush(el);
    expect(api.setTillReceiptPrinter).toHaveBeenCalledWith("t1", null);
  });

  it("shows an error banner when setting a till's printer is rejected (printer.not_found)", async () => {
    const api = stubApi({
      setTillReceiptPrinter: vi.fn().mockRejectedValue({ code: "printer.not_found" }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    pickSelect(el, "[data-test=till-receipt-printer-t2]", "p1");
    await flush(el);
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("printer.not_found", "es-ES"));
    expect(banner).not.toContain("printer.not_found");
  });

  it("renders a print-mode toggle per location and calls setReceiptPrintMode with the chosen mode", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    (api.listTills as ReturnType<typeof vi.fn>).mockClear();

    expect(q(el, "[data-test=print-mode-loc-1-auto]")).not.toBeNull();
    expect(q(el, "[data-test=print-mode-loc-1-never]")).not.toBeNull();
    q(el, "[data-test=print-mode-loc-1-on_request]")!.click();
    await flush(el);

    expect(api.setReceiptPrintMode).toHaveBeenCalledWith("loc-1", "on_request");
    expect(api.listTills).toHaveBeenCalledTimes(1);
  });

  it("reflects the picked print mode in the segmented control (primary variant), surviving the reload", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=print-mode-loc-1-auto]")!.click();
    await flush(el);
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=print-mode-loc-1-never]")!.click();
    await flush(el);
    expect(q(el, "[data-test=print-mode-loc-1-never]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("secondary");
  });

  it("leaves the print-mode toggle on the PRIOR mode (not the failed value) and shows the banner when setReceiptPrintMode is rejected", async () => {
    const api = stubApi({
      setReceiptPrintMode: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    q(el, "[data-test=print-mode-loc-1-auto]")!.click();
    await flush(el);
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");

    q(el, "[data-test=print-mode-loc-1-never]")!.click();
    await flush(el);

    // The failed pick is not applied.
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=print-mode-loc-1-never]")!.getAttribute("variant")).toBe("secondary");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("management.request_invalid", "es-ES"));
    expect(banner).not.toContain("management.request_invalid");
  });

  it("renders a drawer-policy toggle per location and calls setDrawerOpenPolicy with the chosen policy", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    (api.listTills as ReturnType<typeof vi.fn>).mockClear();

    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull();
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")).not.toBeNull();
    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);

    expect(api.setDrawerOpenPolicy).toHaveBeenCalledWith("loc-1", "open");
    expect(api.listTills).toHaveBeenCalledTimes(1);
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

  it("shows the no-tills / no-locations placeholders when the venue has neither", async () => {
    const api = stubApi({
      listTills: vi.fn().mockResolvedValue([]),
      getLocations: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    expect(text(el, "[data-test=no-tills]")).toBe(t("printers.no_tills", "es-ES"));
    expect(text(el, "[data-test=no-locations]")).toBe(t("printers.no_locations", "es-ES"));
  });

  it("does not invent the location's current print or drawer settings", async () => {
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("secondary");
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe(
      "secondary",
    );
    expect(q(el, "[data-test=print-mode-unknown-loc-1]")).toBeTruthy();
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
    const select = q(el, "select[name=watcherId]") as HTMLSelectElement;
    expect(q(el, "[name=ticketScope]")).toBeNull();
    expect([...select.options].map((option) => [option.value, option.textContent?.trim()])).toEqual(
      [
        ["", t("printers.watcher_no")],
        ["w1", "Pass"],
        ["w2", "Terrace"],
      ],
    );
    expect(select.value).toBe("w1");
    select.value = "w2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(el);
    expect(api.setPrinterWatcher).toHaveBeenCalledWith("p1", "w2");
    expect(q(el, "[data-test=station-toggle-p1-s1]")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.textContent).toContain(t("printers.watcher_station_disabled"));
  });
  it("keeps the watcher picker inside a phone-width printer card", async () => {
    const { host, el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: stubApi(),
    });
    host.style.width = "320px";
    await flush(el);
    const select = q(el, "select[name=watcherId]")!;
    expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(
      el.getBoundingClientRect().right,
    );
  });
  it("shows a watcher attachment refusal inside its printer card and restores the stored selection", async () => {
    let attached = true;
    const api = stubApi({
      setPrinterWatcher: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1" && attached ? [{ stationId: "s1", printerId: "p1" }] : [],
      ),
      detachPrinterFromStation: vi.fn(async () => {
        attached = false;
      }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    const select = q(el, "select[name=watcherId]") as HTMLSelectElement;
    select.value = "w1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(el);
    expect(select.value).toBe("");
    expect(select.closest("wt-card")!.textContent).toContain(t("printers.watcher_conflict"));
    toggleSwitch(el, "[data-test=station-toggle-p1-s1]", false);
    await flush(el);
    expect(select.closest("wt-card")!.textContent).not.toContain(t("printers.watcher_conflict"));
  });
  it("keeps the watcher refusal until every conflicting station is detached", async () => {
    const attached = new Set(["s1", "s2"]);
    const api = stubApi({
      setPrinterWatcher: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
      listPrinterStations: vi.fn(async (printerId: string): Promise<StationPrinter[]> =>
        printerId === "p1" ? [...attached].map((stationId) => ({ stationId, printerId })) : [],
      ),
      detachPrinterFromStation: vi.fn(async (stationId: string) => {
        attached.delete(stationId);
      }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    const card = q(el, "[data-test=printer-watcher-p1]")!.closest("wt-card")!;
    const select = q(el, "[data-test=printer-watcher-p1]") as HTMLSelectElement;
    select.value = "w1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(el);
    expect(card.textContent).toContain(t("printers.watcher_conflict"));

    toggleSwitch(el, "[data-test=station-toggle-p1-s1]", false);
    await flush(el);
    expect(card.textContent).toContain(t("printers.watcher_conflict"));
    toggleSwitch(el, "[data-test=station-toggle-p1-s2]", false);
    await flush(el);
    expect(card.textContent).not.toContain(t("printers.watcher_conflict"));
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
    await vi.waitFor(() => expect(q(el, "[data-test=station-toggle-p1-s1]")).toBeTruthy());
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
      listTills: vi.fn().mockResolvedValue([]),
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
    expect((q(el, "[data-test=till-receipt-printer-t1]") as Dropdown).name).toBe(
      "receiptPrinterId",
    );
    await expectNoA11yViolations(host);
  });

  it.each([true, false])(
    "renders a till's drawer switch accessibly, switched %s",
    async (opensDrawer) => {
      const { el, host } = await mountWidget<PrintingRulesScreen>(
        "dashboard-printing-rules-screen",
        {
          api: stubApi({
            listPrinters: vi.fn().mockResolvedValue([{ ...printers[0]!, hasCashDrawer: true }]),
            listTills: vi.fn().mockResolvedValue([{ ...tills[0]!, opensDrawer }]),
          }),
        },
        theme,
      );
      await flush(el);
      expect(q(el, "[data-test=till-opens-drawer-t1]")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );
});

it("uses a named watcher select and named shared switches for station routing", async () => {
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: stubApi(),
  });
  await flush(el);
  for (const [selector, name] of [["station-toggle-p1-s1", "stationIds"]]) {
    const control = q(el, `[data-test="${selector}"]`)!;
    expect(control.tagName).toBe("WT-SWITCH");
    expect(control.shadowRoot!.querySelector("input")!.name).toBe(name);
  }
  expect((q(el, "select[name=watcherId]") as HTMLSelectElement).name).toBe("watcherId");
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
  const api = stubApi({ setTillReceiptPrinter: vi.fn().mockReturnValueOnce(pending) });
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", { api });
  await vi.waitFor(() => expect(q(el, "[data-test=till-receipt-printer-t2]")).not.toBeNull());

  pickSelect(el, "[data-test=till-receipt-printer-t2]", "p1");
  pickSelect(el, "[data-test=till-receipt-printer-t1]", "");

  expect(api.setTillReceiptPrinter).toHaveBeenCalledTimes(1);
  expect(api.setTillReceiptPrinter).toHaveBeenCalledWith("t2", "p1");
  release();
  await vi.waitFor(() => expect(api.listPrinters).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect((q(el, "[data-test=till-receipt-printer-t1]") as Dropdown).disabled).toBe(false),
  );
  expect(api.setTillReceiptPrinter).toHaveBeenCalledTimes(1);
});

describe("a till's switch for opening its receipt printer's cash drawer", () => {
  /** p1 with a drawer attached; t1 prints there with its switch as given, t2 prints nowhere. */
  function drawerApi(opensDrawer: boolean, overrides: Partial<DashboardApi> = {}): DashboardApi {
    return stubApi({
      listPrinters: vi
        .fn()
        .mockResolvedValue([{ ...printers[0]!, hasCashDrawer: true }, printers[1]!]),
      listTills: vi.fn().mockResolvedValue([{ ...tills[0]!, opensDrawer }, tills[1]!]),
      ...overrides,
    });
  }
  const opensDrawer = "[data-test=till-opens-drawer-t1]";

  it("shows a named switch, reflecting the stored setting, only for a till whose receipt printer has a drawer", async () => {
    for (const stored of [true, false]) {
      const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
        api: drawerApi(stored),
      });
      await flush(el);

      const control = q(el, opensDrawer)!;
      expect(control.tagName).toBe("WT-SWITCH");
      expect(control.getAttribute("label")).toBe(t("printers.opens_drawer"));
      expect(control.shadowRoot!.querySelector("input")!.name).toBe("opensDrawer");
      expect(switchChecked(el, opensDrawer)).toBe(stored);
      expect(q(el, "[data-test=till-opens-drawer-t2]")).toBeNull();
      cleanupWidgets();
    }
  });

  it("shows no switch when the till's receipt printer has no drawer", async () => {
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: stubApi(),
    });
    await flush(el);

    expect(q(el, "[data-test=till-row-t1]")).not.toBeNull();
    expect(q(el, opensDrawer)).toBeNull();
  });

  it("shows no switch when the till's receipt printer is switched off", async () => {
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api: stubApi({
        listPrinters: vi
          .fn()
          .mockResolvedValue([{ ...printers[0]!, hasCashDrawer: true, active: false }]),
      }),
    });
    await flush(el);

    expect(q(el, opensDrawer)).toBeNull();
  });

  it("switching it off saves false for that till, then reloads", async () => {
    const api = drawerApi(true);
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    toggleSwitch(el, opensDrawer, false);
    await flush(el);

    expect(api.setTillOpensDrawer).toHaveBeenCalledWith("t1", false);
    expect(api.listTills).toHaveBeenCalledTimes(2);
  });

  it("switching it on saves true", async () => {
    const api = drawerApi(false);
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    toggleSwitch(el, opensDrawer, true);
    await flush(el);

    expect(api.setTillOpensDrawer).toHaveBeenCalledWith("t1", true);
  });

  it("is disabled while the change is saving", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = drawerApi(true, { setTillOpensDrawer: vi.fn().mockReturnValueOnce(pending) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    toggleSwitch(el, opensDrawer, false);
    await el.updateComplete;
    expect((q(el, opensDrawer) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    release();
    await vi.waitFor(() =>
      expect((q(el, opensDrawer) as HTMLElement & { disabled: boolean }).disabled).toBe(false),
    );
  });

  it("goes back to the stored setting and shows the refusal when the change is refused", async () => {
    const api = drawerApi(true, {
      setTillOpensDrawer: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "tillId" },
      }),
    });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    toggleSwitch(el, opensDrawer, false);
    await flush(el);

    expect(q(el, "[role=alert]")?.textContent).toContain(
      codeMessage("management.request_invalid", "es-ES"),
    );
    expect(switchChecked(el, opensDrawer)).toBe(true);
  });
});

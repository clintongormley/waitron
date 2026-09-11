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
    ticketScope: "station",
    pendingJobs: 0,
    lastPrintAt: null,
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
    ticketScope: "station",
    pendingJobs: 0,
    lastPrintAt: null,
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
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

// Counter receipt/drawer (§5): two tills (one with a printer set, one without) + one location, for the
// per-till receipt-printer picker + the per-location print-mode toggle.
const tills: Till[] = [
  { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1" },
  { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null },
];
const locations: LocationSummary[] = [{ id: "loc-1", name: "Barra" }];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPrinters: vi.fn().mockResolvedValue(printers),
    updatePrinter: vi.fn().mockResolvedValue(undefined),
    listStations: vi.fn().mockResolvedValue(stations),
    listPrinterStations: vi.fn().mockResolvedValue([] as StationPrinter[]),
    attachPrinterToStation: vi.fn().mockResolvedValue(undefined),
    detachPrinterFromStation: vi.fn().mockResolvedValue(undefined),
    listTills: vi.fn().mockResolvedValue(tills),
    getLocations: vi.fn().mockResolvedValue(locations),
    setTillReceiptPrinter: vi.fn().mockResolvedValue(undefined),
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
const text = (el: PrintingRulesScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** Exercise the native switch change event after the browser toggles its checked property. */
function toggleSwitch(el: PrintingRulesScreen, sel: string, checked: boolean): void {
  const input = q(el, sel)!.shadowRoot!.querySelector("input")!;
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Pick a value in a native <select> and fire its `change`. */
function pickSelect(el: PrintingRulesScreen, sel: string, value: string): void {
  const select = q(el, sel) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

/** Read the native switch state after the screen settles. */
const switchChecked = (el: PrintingRulesScreen, sel: string): boolean =>
  (q(el, sel) as unknown as { checked: boolean }).checked;

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
    // The toggle labels are the station names.
    expect(q(el, "[data-test=station-toggle-p1-s1]")!.getAttribute("aria-label")).toBe("Cocina");
    // Each printer read its own mapping on load.
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

    // stationId then printerId, mirroring the server route /stations/:sid/printers/:pid.
    expect(api.attachPrinterToStation).toHaveBeenCalledWith("s2", "p1");
    expect(api.detachPrinterFromStation).not.toHaveBeenCalled();
    // #mutate reloaded, and the refreshed mapping now shows s2 attached to p1.
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

  // ── Receipt printer picker + print-mode toggle (counter receipt/drawer §5) ───────────────────────

  it("renders a receipt-printer picker per till, offering the ACTIVE printers + a 'no printer' option", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);

    const select = q(el, "[data-test=till-receipt-printer-t1]") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const values = [...select.options].map((o) => o.value);
    // The clear option ("") first, then only the ACTIVE printer p1 — the inactive p2 is not offered.
    expect(values).toEqual(["", "p1"]);
    expect(select.options[0]!.textContent).toContain(t("printers.receipt_no_printer", "es-ES"));
  });

  it("reflects each till's PERSISTED receipt printer in its select (set → the id, unset → the clear option)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    // t1 has p1 set; t2 has none — the selects are reconciled to those values in updated().
    expect((q(el, "[data-test=till-receipt-printer-t1]") as HTMLSelectElement).value).toBe("p1");
    expect((q(el, "[data-test=till-receipt-printer-t2]") as HTMLSelectElement).value).toBe("");
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
    expect(api.listTills).toHaveBeenCalledTimes(1); // optimistic reload after the mutation
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

    // The three-mode segmented control is present; pick "on_request".
    expect(q(el, "[data-test=print-mode-loc-1-auto]")).not.toBeNull();
    expect(q(el, "[data-test=print-mode-loc-1-never]")).not.toBeNull();
    q(el, "[data-test=print-mode-loc-1-on_request]")!.click();
    await flush(el);

    expect(api.setReceiptPrintMode).toHaveBeenCalledWith("loc-1", "on_request");
    expect(api.listTills).toHaveBeenCalledTimes(1); // reload after the mutation
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
    // The successful choice survives reload.
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

    // The write failed, so the local pick is NOT applied: the control still shows the prior mode
    // (auto), never the "never" that failed to save.
    expect(q(el, "[data-test=print-mode-loc-1-auto]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=print-mode-loc-1-never]")!.getAttribute("variant")).toBe("secondary");
    // ...and the failure is surfaced in the localised error banner (raw code never shown).
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

    // The two-policy segmented control is present; pick "open".
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")).not.toBeNull();
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")).not.toBeNull();
    q(el, "[data-test=drawer-policy-loc-1-open]")!.click();
    await flush(el);

    expect(api.setDrawerOpenPolicy).toHaveBeenCalledWith("loc-1", "open");
    expect(api.listTills).toHaveBeenCalledTimes(1); // reload after the mutation
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
    // The successful choice survives reload.
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

    // The write failed, so the local pick is NOT applied: the control still shows the prior policy
    // (gated), never the "open" that failed to save.
    expect(q(el, "[data-test=drawer-policy-loc-1-gated]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=drawer-policy-loc-1-open]")!.getAttribute("variant")).toBe(
      "secondary",
    );
    // ...and the failure is surfaced in the localised error banner (raw code never shown).
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
  it("saves ticket grouping independently of the printer's connection settings", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    toggleSwitch(el, "[data-test=printer-ticket-scope-p1]", true);
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p1", { ticketScope: "order" });
    toggleSwitch(el, "[data-test=printer-ticket-scope-p1]", false);
    await flush(el);
    expect(api.updatePrinter).toHaveBeenLastCalledWith("p1", { ticketScope: "station" });
  });
  it("reports loading failures", async () => {
    const api = stubApi({ listPrinters: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
      api,
    });
    await flush(el);
    expect(q(el, "[role=alert]")?.textContent).toContain(codeMessage("server.internal", "es-ES"));
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
    expect((q(el, "[data-test=till-receipt-printer-t1]") as HTMLSelectElement).name).toBe(
      "receiptPrinterId",
    );
    await expectNoA11yViolations(host);
  });
});

it("uses named shared switches for ticket scope and station routing", async () => {
  const { el } = await mountWidget<PrintingRulesScreen>("dashboard-printing-rules-screen", {
    api: stubApi(),
  });
  await flush(el);
  for (const [selector, name] of [
    ["printer-ticket-scope-p1", "ticketScope"],
    ["station-toggle-p1-s1", "stationIds"],
  ]) {
    const control = q(el, `[data-test="${selector}"]`)!;
    expect(control.tagName).toBe("WT-SWITCH");
    expect(control.shadowRoot!.querySelector("input")!.name).toBe(name);
  }
});

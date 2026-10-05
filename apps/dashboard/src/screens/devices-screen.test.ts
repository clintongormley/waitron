import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { registerCatalogue, type CardProviderPanel } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  JoinRequestRow,
  Printer,
  ReaderRow,
  Station,
  Watcher,
} from "../api/client.js";
import { DevicesScreen } from "./devices-screen.js";

// Fake provider panels, so the reader-label tests never depend on the real SumUp/Stripe panels; only
// `displayNameKey` is read by this screen.
registerCatalogue({
  en: { "test.acme.name": "Acme Pay", "test.zeta.name": "Zeta Pay" },
  es: { "test.acme.name": "Acme Pay", "test.zeta.name": "Zeta Pay" },
});

const fakePanel = (providerId: string, nameKey: string): CardProviderPanel => ({
  providerId,
  displayNameKey: nameKey,
  strings: { en: {}, es: {} },
  renderConnectForm: () => html`<div></div>`,
  renderAddReader: () => html`<div></div>`,
});

const PANELS: CardProviderPanel[] = [
  fakePanel("acme", "test.acme.name"),
  fakePanel("zeta", "test.zeta.name"),
];

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

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
];

const devices: DeviceRow[] = [
  {
    id: "d1",
    madeHereStationIds: [],
    kind: "kds_station",
    stationId: "s1",
    watcherId: null,
    label: "Pantalla Cocina",
    active: true,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
    deviceProfileId: "dp1",
    receiptPrinterId: "pr1",
    paymentSlipPrinterId: null,
  },
  {
    id: "d2",
    madeHereStationIds: [],
    kind: "kds_station",
    stationId: null,
    watcherId: null,
    label: "Pase revocado",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
    deviceProfileId: null,
    receiptPrinterId: null,
    paymentSlipPrinterId: null,
  },
];

const deviceProfiles: DeviceProfile[] = [
  {
    id: "dp1",
    name: "Counter till",
    canvasId: "p1",
    capabilities: [],
    formFactor: "till",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
  },
  {
    id: "dp2",
    name: "Waiter handheld",
    canvasId: "p2",
    capabilities: [],
    formFactor: "phone-portrait",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
  },
  {
    id: "dp3",
    name: "Pass screen",
    canvasId: null,
    capabilities: [],
    formFactor: "kds",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: [],
    paymentSlipPrinterIds: [],
  },
];

const pending: JoinRequestRow[] = [
  {
    id: "r1",
    kind: "device",
    label: "Barra 1",
    createdAt: "2026-09-08T10:02:00.000Z",
    pairingBy: null,
  },
  {
    id: "r2",
    kind: "device",
    label: "Pantalla pase",
    createdAt: "2026-09-08T10:03:00.000Z",
    pairingBy: null,
  },
];

/** The three numbers the server offers for a request, one of them real — and which one that is. The
 * dashboard is never told, so the test knowing it is the only way to check the list does not carry
 * it. */
const CHOICES = ["12", "47", "83"];
const REAL_NUMBER = "47";

const SHUT = { open: false, openUntil: null, deviceAddress: "https://waitron.local" };
const TAKEN_UNTIL = "2026-09-08T10:05:00.000Z";

const printers: Printer[] = [
  {
    id: "pr1",
    name: "Cocina",
    transport: "network_tcp",
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    host: "10.0.0.9",
    port: 9100,
    localKey: null,
    pollId: null,
    watcherId: null,
    paperWidth: "80mm",
    resolution: "180dpi",
    hasCashDrawer: false,
    active: true,
  },
];

const readers: ReaderRow[] = [
  {
    id: "r1",
    provider: "acme",
    name: "Front counter",
    active: true,
    canEnable: true,
    deviceCount: 1,
  },
  { id: "r2", provider: "zeta", name: "Bar", active: true, canEnable: true, deviceCount: 0 },
  // Retired: must be excluded from the picker's options.
  {
    id: "r3",
    provider: "acme",
    name: "Old terminal",
    active: false,
    canEnable: true,
    deviceCount: 0,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listWatchers: vi.fn().mockResolvedValue(watchers),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listPrinters: vi.fn().mockResolvedValue(printers),
    pairingMode: vi.fn().mockResolvedValue(SHUT),
    takePairingHold: vi.fn().mockResolvedValue({ holdId: "h1", openUntil: TAKEN_UNTIL }),
    renewPairingHold: vi.fn().mockResolvedValue({ openUntil: TAKEN_UNTIL }),
    releasePairingHold: vi.fn().mockResolvedValue(undefined),
    checkDeviceJoinNumber: vi.fn().mockResolvedValue(undefined),
    joinRequests: vi.fn().mockResolvedValue(pending),
    joinChallenge: vi.fn().mockResolvedValue({ choices: CHOICES }),
    denyJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptDeviceJoinRequest: vi
      .fn()
      .mockResolvedValue({ deviceId: "d9", name: "Barra 2", formFactor: "kds" }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    reassignDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listReaders: vi.fn().mockResolvedValue(readers),
    // No device carries a default reader unless a test says otherwise.
    getDeviceReader: vi.fn().mockResolvedValue({ readerId: null }),
    setDeviceReader: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: DevicesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const q = (el: DevicesScreen, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
type Dropdown = HTMLElement & {
  options: { value: string; label: string }[];
  value: string;
  updateComplete: Promise<unknown>;
};
const text = (el: DevicesScreen, sel: string) => q(el, sel)?.textContent?.trim();

function pickSelect(el: DevicesScreen, testId: string, value: string): void {
  void chooseOption(q(el, `[data-test=${testId}]`)!, value);
}

describe("devices-screen", () => {
  it("shows stored made-here choices on a till and no group on a kitchen screen", async () => {
    const till: DeviceRow = {
      ...devices[0]!,
      id: "till",
      kind: "till",
      madeHereStationIds: ["s2"],
    };
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([till, devices[0]]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    const group = q(el, '[data-test="made-here-till"]')!;
    expect(group.textContent).toContain(t("devices.made_here", "es-ES"));
    expect((group.querySelector('input[value="s2"]') as HTMLInputElement).checked).toBe(true);
    expect(q(el, '[data-test="made-here-d1"]')).toBeNull();
  });

  it("saves the shown checked stations and restores the native checkbox after refusal", async () => {
    const till: DeviceRow = { ...devices[0]!, id: "till", kind: "till", madeHereStationIds: [] };
    const setDeviceMadeHere = vi.fn().mockRejectedValue({ code: "station.not_found" });
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([till]), setDeviceMadeHere });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    const group = q(el, '[data-test="made-here-till"]')!;
    const box = group.querySelector('input[value="s2"]') as HTMLInputElement;
    box.click();
    await flush(el);
    expect(setDeviceMadeHere).toHaveBeenCalledWith("till", ["s2"]);
    expect(box.checked).toBe(false);
    expect(group.lastElementChild?.getAttribute("role")).toBe("alert");
    expect(group.lastElementChild?.textContent).toContain(
      codeMessage("station.not_found", "es-ES"),
    );
  });

  it("keeps two rapid choices visible and saves them in change order", async () => {
    const till: DeviceRow = { ...devices[0]!, id: "till", kind: "till", madeHereStationIds: [] };
    const grill: Station = { ...stations[0]!, id: "grill", name: "Grill" };
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const setDeviceMadeHere = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const api = stubApi({
      listDevices: vi.fn().mockResolvedValue([till]),
      listStations: vi.fn().mockResolvedValue([...stations, grill]),
      setDeviceMadeHere,
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    const group = q(el, '[data-test="made-here-till"]')!;
    const bar = group.querySelector('input[value="s2"]') as HTMLInputElement;
    const grillBox = group.querySelector('input[value="grill"]') as HTMLInputElement;
    bar.click();
    await flush(el);
    expect(bar.checked).toBe(true);
    grillBox.click();
    await flush(el);
    expect(bar.checked).toBe(true);
    expect(grillBox.checked).toBe(true);
    expect(setDeviceMadeHere).toHaveBeenCalledTimes(1);
    expect(setDeviceMadeHere).toHaveBeenNthCalledWith(1, "till", ["s2"]);
    finishFirst();
    await vi.waitFor(() => expect(setDeviceMadeHere).toHaveBeenCalledTimes(2));
    expect(setDeviceMadeHere).toHaveBeenNthCalledWith(2, "till", ["s2", "grill"]);
    await flush(el);
    expect(bar.checked).toBe(true);
    expect(grillBox.checked).toBe(true);
    expect(q(el, '[data-test="made-here-till"] [role="alert"]')).toBeNull();
  });

  it("rolls a pending second choice back to the stored list if the first save is refused", async () => {
    const till: DeviceRow = { ...devices[0]!, id: "till", kind: "till", madeHereStationIds: [] };
    let refuseFirst!: (error: unknown) => void;
    const first = new Promise<void>((_, reject) => {
      refuseFirst = reject;
    });
    const setDeviceMadeHere = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined);
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([till]), setDeviceMadeHere });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    const group = q(el, '[data-test="made-here-till"]')!;
    const bar = group.querySelector('input[value="s2"]') as HTMLInputElement;
    const kitchen = group.querySelector('input[value="s1"]') as HTMLInputElement;
    bar.click();
    kitchen.click();
    await flush(el);
    refuseFirst({ code: "station.not_found" });
    await vi.waitFor(() => expect(group.querySelector('[role="alert"]')).toBeTruthy());
    expect(setDeviceMadeHere).toHaveBeenCalledTimes(1);
    expect(bar.checked).toBe(false);
    expect(kitchen.checked).toBe(false);
  });

  it("lets another device save while one device's request is pending", async () => {
    const first: DeviceRow = { ...devices[0]!, id: "first", kind: "till", madeHereStationIds: [] };
    const second: DeviceRow = {
      ...devices[0]!,
      id: "second",
      kind: "till",
      madeHereStationIds: [],
    };
    let finishFirst!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const setDeviceMadeHere = vi
      .fn()
      .mockImplementation((id: string) => (id === "first" ? pending : Promise.resolve()));
    const api = stubApi({
      listDevices: vi.fn().mockResolvedValue([first, second]),
      setDeviceMadeHere,
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    (q(el, '[data-test="made-here-first"] input[value="s2"]') as HTMLInputElement).click();
    (q(el, '[data-test="made-here-second"] input[value="s1"]') as HTMLInputElement).click();
    await flush(el);
    expect(setDeviceMadeHere).toHaveBeenCalledWith("first", ["s2"]);
    expect(setDeviceMadeHere).toHaveBeenCalledWith("second", ["s1"]);
    expect(
      (q(el, '[data-test="made-here-second"] input[value="s1"]') as HTMLInputElement).checked,
    ).toBe(true);
    finishFirst();
    await flush(el);
  });

  it("omits a disabled stored station when saving a newly checked station", async () => {
    const till: DeviceRow = {
      ...devices[0]!,
      id: "till",
      kind: "till",
      madeHereStationIds: ["s2", "switched-off"],
    };
    const grill: Station = { ...stations[0]!, id: "grill", name: "Grill" };
    const setDeviceMadeHere = vi.fn().mockResolvedValue(undefined);
    const api = stubApi({
      listDevices: vi.fn().mockResolvedValue([till]),
      listStations: vi.fn().mockResolvedValue([...stations, grill]),
      setDeviceMadeHere,
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    (q(el, '[data-test="made-here-till"] input[value="grill"]') as HTMLInputElement).click();
    await flush(el);
    expect(setDeviceMadeHere).toHaveBeenCalledWith("till", ["s2", "grill"]);
  });

  it("loads every feed the screen needs on connect and renders a row per device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    // Profiles and printers name what each row shows; stations are also the accept dialog's
    // binding picker, so they are one load, not two.
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
    expect(api.pairingMode).toHaveBeenCalledTimes(1);
    expect(api.joinRequests).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=device-row-d1]")).toBeTruthy();
    expect(q(el, "[data-test=device-row-d2]")).toBeTruthy();
  });

  it("shows label, profile name, resolved station name, active status and formatted last-seen", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-label-d1]")).toBe("Pantalla Cocina");
    // The deviceProfileId resolves to the profile's display name, not the raw id.
    expect(text(el, "[data-test=device-profile-d1]")).toBe("Counter till");
    // The stationId resolves to the loaded station's display name, not the raw id.
    expect(text(el, "[data-test=device-station-d1]")).toBe("Cocina");
    expect(text(el, "[data-test=device-status-d1]")).toBe(t("devices.status_active", "es-ES"));
    // Last-seen is the timestamp formatted to the minute, not the raw ISO string.
    expect(text(el, "[data-test=device-last-seen-d1]")).toBe("2026-08-25 14:30");
  });

  it("names a watcher-bound kitchen screen distinctly from a station screen", async () => {
    const pass = { ...devices[0]!, id: "pass", stationId: null, watcherId: "w1" };
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([pass]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    expect(text(el, "[data-test=device-station-pass]")).toBe("Punto de seguimiento: Pass");
  });

  it("identifies a kitchen screen whose watcher has been removed", async () => {
    const removed = { ...devices[0]!, id: "removed", stationId: null, watcherId: "w1" };
    const api = stubApi({
      listDevices: vi.fn().mockResolvedValue([removed]),
      listWatchers: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    expect(text(el, "[data-test=device-station-removed]")).toBe("Punto de seguimiento eliminado");
  });

  it("resolves a null profile/station to the neutral placeholder and a null last-seen to Never", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-profile-d2]")).toBe(
      t("devices.device_profile_none", "es-ES"),
    );
    expect(text(el, "[data-test=device-station-d2]")).toBe(t("devices.no_station", "es-ES"));
    expect(text(el, "[data-test=device-last-seen-d2]")).toBe(t("devices.last_seen_never", "es-ES"));
    expect(text(el, "[data-test=device-status-d2]")).toBe(t("devices.status_revoked", "es-ES"));
  });

  it("falls back to the neutral placeholder for a device bound to a station not in the active list", async () => {
    // A device bound to a since-retired station: listStations (active only) does not carry it, so the
    // name cannot be resolved — the row shows the same neutral placeholder as an unbound device.
    const orphan: DeviceRow = { ...devices[0], id: "d3", stationId: "gone" };
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([orphan]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-station-d3]")).toBe(t("devices.no_station", "es-ES"));
  });

  it("shows the empty placeholder when there are no devices", async () => {
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=no-devices]")).toBe(t("devices.no_devices", "es-ES"));
  });

  // #load's guard: a rejected initial load must become the error banner, never an unhandled rejection.
  it("shows an error banner when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ listDevices: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("clears a failed load's message and lists the devices once the server answers again", async () => {
    const api = Object.assign(
      stubApi({ listDevices: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await vi.waitFor(() =>
      expect(text(el, "[role=alert]")).toBe(codeMessage("connection.failed", "es-ES")),
    );
    vi.mocked(api.listDevices).mockResolvedValue(devices);
    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
    await flush(el);
    expect(q(el, `[data-test=device-row-${devices[0]!.id}]`)).not.toBeNull();
  });

  it("falls back to server.internal when the rejected load carries no code", async () => {
    const api = stubApi({ listStations: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  // The generate-code panel and its verb are gone: a device is created by ACCEPTING a request.
  it("shows none of the retired generate-code controls", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=generate]")).toBeNull();
    expect(q(el, "[data-test=code-panel]")).toBeNull();
    expect(q(el, "[data-test=copy-code]")).toBeNull();
  });

  // ── Revoke + reassign ──────────────────────────────────────────────────────────────────────────

  it("does not show the revoke / reassign / hardware controls for an already-revoked device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(q(el, "[data-test=revoke-d1]")).toBeTruthy(); // active
    expect(q(el, "[data-test=reassign-d1]")).toBeTruthy();
    expect(q(el, "[data-test=hardware-d1]")).toBeTruthy();
    expect(q(el, "[data-test=revoke-d2]")).toBeNull(); // revoked
    expect(q(el, "[data-test=reassign-d2]")).toBeNull();
    expect(q(el, "[data-test=hardware-d2]")).toBeNull();
  });

  it("revokes only on the confirming second click, then reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-d1]")!.click();
    await el.updateComplete;
    expect(api.revokeDevice).not.toHaveBeenCalled();
    expect(text(el, "[data-test=revoke-d1]")).toBe(t("devices.revoke_confirm", "es-ES"));

    q(el, "[data-test=revoke-d1]")!.click();
    await flush(el);
    expect(api.revokeDevice).toHaveBeenCalledWith("d1");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it("shows an error and keeps the list when a revoke is rejected", async () => {
    const api = stubApi({ revokeDevice: vi.fn().mockRejectedValue({ code: "device.not_found" }) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    q(el, "[data-test=revoke-d1]")!.click();
    await el.updateComplete;
    q(el, "[data-test=revoke-d1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("device.not_found", "es-ES"));
  });

  it("renders a per-row reassign dropdown preselected to the device's current device profile", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const select = q(el, "[data-test=reassign-d1]") as Dropdown;
    expect(select).toBeTruthy();
    const options = select.options;
    expect(options.map((o) => o.value)).toEqual(["", "dp1", "dp2", "dp3"]);
    expect(options[0]!.label.trim()).toBe(t("devices.device_profile_none", "es-ES"));
    expect(options[1]!.label.trim()).toBe("Counter till");
    expect(select.value).toBe("dp1");
  });

  it("reassigns a device to the picked device profile, then reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "reassign-d1", "dp2");
    await flush(el);

    expect(api.reassignDeviceProfile).toHaveBeenCalledWith("d1", "dp2");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it("clears a device's device profile when Default is picked", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "reassign-d1", "");
    await flush(el);

    expect(api.reassignDeviceProfile).toHaveBeenCalledWith("d1", null);
  });

  it("shows an error and snaps the reassign dropdown back when a reassign is rejected", async () => {
    const api = stubApi({
      reassignDeviceProfile: vi.fn().mockRejectedValue({ code: "device.binding_invalid" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    pickSelect(el, "reassign-d1", "dp2");
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.binding_invalid");
    const select = q(el, "[data-test=reassign-d1]") as Dropdown;
    expect(select.value).toBe("dp1");
  });

  // ── Per-device printers ────────────────────────────────────────────────────────────────────────

  it("shows each active device's current receipt and payment slip printers", async () => {
    const api = stubApi({
      listDevices: vi
        .fn()
        .mockResolvedValue([
          devices[0],
          { ...devices[0], id: "d3", receiptPrinterId: "pr2", paymentSlipPrinterId: "pr1" },
          devices[1],
        ]),
      listPrinters: vi
        .fn()
        .mockResolvedValue([
          ...printers,
          { ...printers[0], id: "pr2", name: "Terraza", active: false },
        ]),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(text(el, "[data-test=device-receipt-printer-d1]")).toBe("Cocina");
    expect(text(el, "[data-test=device-slip-printer-d1]")).toBe(t("devices.no_printer"));
    // A device may stay on a printer that has since been switched off.
    expect(text(el, "[data-test=device-receipt-printer-d3]")).toBe(
      `Terraza (${t("printers.status_inactive")})`,
    );
    expect(text(el, "[data-test=device-slip-printer-d3]")).toBe("Cocina");
    expect(q(el, "[data-test=device-receipt-printer-d2]")).toBeNull();
  });

  it("labels each printer it shows", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    const label = (test: string) =>
      q(el, `[data-test=${test}]`)!.closest("div")!.querySelector("dt")!.textContent!.trim();
    expect(label("device-receipt-printer-d1")).toBe(t("devices.receipt_printer_now"));
    expect(label("device-slip-printer-d1")).toBe(t("devices.slip_printer_now"));
  });

  it("offers no printer picker and no hardware save: a device picks its printers itself", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(q(el, "[data-test=hardware-d1]")).toBeTruthy();
    expect(el.shadowRoot!.querySelector("[data-test^=hw-printer-]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test^=hw-save-]")).toBeNull();
  });

  // ── Per-device default reader ──────────────────────────────────────────────────────────────────

  it("loads the reader list ONCE for the whole screen, and each active device's current default", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    expect(api.listReaders).toHaveBeenCalledTimes(1);
    // d1 is active, d2 is revoked (its hardware editor — and so its reader control — never renders).
    expect(api.getDeviceReader).toHaveBeenCalledTimes(1);
    expect(api.getDeviceReader).toHaveBeenCalledWith("d1");
  });

  it("lists only ACTIVE readers, by name and a friendly provider label, with a leading none option", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    const select = q(el, "[data-test=hw-reader-d1]") as Dropdown;
    expect(select).toBeTruthy();
    const options = select.options;
    expect(options.map((o) => o.value)).toEqual(["", "r1", "r2"]); // r3 is retired — excluded
    expect(options[0]!.label.trim()).toBe(t("devices.default_reader_none", "es-ES"));
    expect(options[1]!.label.trim()).toBe("Front counter (Acme Pay)");
    expect(options[2]!.label.trim()).toBe("Bar (Zeta Pay)");
  });

  it("preselects the empty option when a device has no default reader", async () => {
    const api = stubApi(); // getDeviceReader defaults to { readerId: null }
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    expect((q(el, "[data-test=hw-reader-d1]") as Dropdown).value).toBe("");
  });

  it("preselects the device's current default reader from the GET", async () => {
    const api = stubApi({
      getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r2" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    expect((q(el, "[data-test=hw-reader-d1]") as Dropdown).value).toBe("r2");
  });

  it("sets a device's default reader as soon as one is picked (no separate Save)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    pickSelect(el, "hw-reader-d1", "r1");
    await flush(el);

    expect(api.setDeviceReader).toHaveBeenCalledWith("d1", "r1");
    expect((q(el, "[data-test=hw-reader-d1]") as Dropdown).value).toBe("r1");
  });

  it("clears a device's default reader when the none option is picked", async () => {
    const api = stubApi({
      getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r1" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);
    expect((q(el, "[data-test=hw-reader-d1]") as Dropdown).value).toBe("r1");

    pickSelect(el, "hw-reader-d1", "");
    await flush(el);

    expect(api.setDeviceReader).toHaveBeenCalledWith("d1", null);
    expect((q(el, "[data-test=hw-reader-d1]") as Dropdown).value).toBe("");
  });

  it("shows an error and snaps the reader dropdown back when setting the default is rejected", async () => {
    const api = stubApi({
      getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r1" }),
      setDeviceReader: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    pickSelect(el, "hw-reader-d1", "r2");
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("reader.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("reader.not_found", "es-ES"));
    // The rejected pick never took: the control shows the device's actual stored default again.
    expect((q(el, "[data-test=hw-reader-d1]") as Dropdown).value).toBe("r1");
  });

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-devices-screen")).toBe(DevicesScreen);
  });
});

describe("devices-screen fields", () => {
  type Combobox = HTMLElement & {
    options: { value: string; label: string }[];
    value: string;
    label: string;
    placeholder: string;
    name: string;
    hideLabel: boolean;
  };
  const box = (el: DevicesScreen, testId: string) =>
    q(el, `wt-combobox[data-test=${testId}]`) as Combobox;

  it("picks a device's card reader from a labelled dropdown showing the stored one", async () => {
    const api = stubApi({ getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r2" }) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);

    const reader = box(el, "hw-reader-d1");
    expect(reader.name).toBe("defaultReaderId");
    expect(reader.label).toBe(t("devices.default_reader"));
    expect(reader.placeholder).toBe(t("devices.default_reader_none"));
    expect(reader.options.map((o) => o.value)).toEqual(["", "r1", "r2"]);
    expect(reader.value).toBe("r2");
    await chooseOption(reader, "r1");
    await flush(el);
    expect(api.setDeviceReader).toHaveBeenCalledWith("d1", "r1");
  });

  it("names the move-to-profile dropdown by a hidden label carrying the device's name", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const reassign = box(el, "reassign-d1");
    expect(reassign.name).toBe("deviceProfileId");
    expect(reassign.label).toBe(`${t("devices.reassign")} Pantalla Cocina`);
    expect(reassign.hideLabel).toBe(true);
    expect(reassign.placeholder).toBe(t("devices.device_profile_none"));
    expect(reassign.value).toBe("dp1");
    await chooseOption(reassign, "dp2");
    await flush(el);
    expect(api.reassignDeviceProfile).toHaveBeenCalledWith("d1", "dp2");
  });
});

it("refreshes displayed devices when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-devices-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["devices"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listDevices).mockResolvedValue([]);
  liveData.invalidate([{ type: "devices", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listDevices).toHaveBeenCalledTimes(2);
});

describe("devices-screen remaining edges", () => {
  it("names a device whose profile is not in the loaded set with the no-profile placeholder", async () => {
    const orphan: DeviceRow = { ...devices[0]!, id: "d9", deviceProfileId: "dp-gone" };
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([orphan]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await vi.waitFor(() => expect(q(el, "[data-test=device-profile-d9]")).not.toBeNull());

    expect(text(el, "[data-test=device-profile-d9]")).toBe(t("devices.device_profile_none"));
  });

  it("snaps the reassign picker to no profile when a refresh clears the device's profile", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    const select = () => q(el, "[data-test=reassign-d1]") as Dropdown;
    await vi.waitFor(() => expect(select()?.value).toBe("dp1"));

    vi.mocked(api.listDevices).mockResolvedValue([{ ...devices[0]!, deviceProfileId: null }]);
    liveData.invalidate([{ type: "devices", id: "d1" }]);

    await vi.waitFor(() =>
      expect(text(el, "[data-test=device-profile-d1]")).toBe(t("devices.device_profile_none")),
    );
    await select().updateComplete;
    expect(select().shadowRoot!.querySelector(".trigger .value")!.textContent!.trim()).toBe(
      t("devices.device_profile_none"),
    );
    expect(select().value).toBe("");
  });
});

describe("add a device", () => {
  type Field = HTMLElement & { value: string; error: string; invalid: boolean };
  type Button = HTMLElement & { disabled: boolean };

  /** Waiting rows are table cells, which live in the table's own shadow root. */
  function deep(root: ShadowRoot | Element, sel: string): HTMLElement | null {
    const found = root.querySelector<HTMLElement>(sel);
    if (found) return found;
    for (const node of root.querySelectorAll<HTMLElement>("*")) {
      if (node.shadowRoot) {
        const nested = deep(node.shadowRoot, sel);
        if (nested) return nested;
      }
    }
    return null;
  }
  const d = (el: DevicesScreen, sel: string) => deep(el.shadowRoot!, sel);
  const fakeQr = () => vi.fn().mockResolvedValue("data:image/png;base64,FAKE");

  function typeField(el: DevicesScreen, sel: string, value: string): void {
    q(el, sel)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  }

  async function bottomOf(el: DevicesScreen, actions: string): Promise<string> {
    const row = q(el, actions) as HTMLElementTagNameMap["wt-form-actions"];
    return (await formMessageOf(row))?.textContent?.trim() ?? "";
  }

  async function openAdd(api: DashboardApi, qrFor = fakeQr()): Promise<DevicesScreen> {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api, qrFor });
    await flush(el);
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=device-qr]")?.getAttribute("src")).toBeTruthy(),
    );
    await vi.waitFor(() => expect(api.takePairingHold).toHaveBeenCalled());
    await flush(el);
    return el;
  }

  async function openPair(el: DevicesScreen, id = "r1"): Promise<void> {
    d(el, `[data-test=pair-${id}]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).not.toBeNull());
    await flush(el);
  }

  async function toSettings(el: DevicesScreen): Promise<void> {
    await openPair(el);
    await vi.waitFor(() => expect(q(el, `[data-choice="${REAL_NUMBER}"]`)).not.toBeNull());
    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-name]")).not.toBeNull());
    await flush(el);
  }

  it("offers Add a device in the heading and on the empty list", async () => {
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const buttons = el.shadowRoot!.querySelectorAll("[data-test=open-add-device]");
    expect(buttons).toHaveLength(2);
    expect([...buttons].map((b) => b.textContent?.trim())).toEqual([
      t("devices.add"),
      t("devices.add"),
    ]);
    // The page no longer holds the window itself: nothing is taken until the dialog opens.
    expect(q(el, "[data-test=pairing-mode]")).toBeNull();
    expect(q(el, "[data-test=join-panel]")).toBeNull();
    expect(api.takePairingHold).not.toHaveBeenCalled();
  });

  it("Add a device takes a hold and shows the QR code and address", async () => {
    const api = stubApi();
    const qrFor = fakeQr();
    const el = await openAdd(api, qrFor);

    expect(api.takePairingHold).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
    expect(text(el, "[data-test=device-address]")).toBe("https://waitron.local");
    expect(qrFor).toHaveBeenCalledExactlyOnceWith("https://waitron.local");
    expect(q(el, "[data-test=device-qr]")!.getAttribute("src")).toBe("data:image/png;base64,FAKE");
    expect(q(el, "[data-test=device-qr]")!.getAttribute("alt")).toBe(t("devices.qr_alt"));
  });

  it("draws the address as a real QR code image", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=device-qr]")?.getAttribute("src")).toMatch(/^data:image\/png/),
    );
  });

  it("shows when the window lapses: the later of the hold's own lapse and the window's", async () => {
    const earlier = { ...SHUT, open: true, openUntil: "2026-09-08T10:04:00.000Z" };
    const later = { ...SHUT, open: true, openUntil: "2026-09-08T10:07:00.000Z" };
    const liveData = new LiveData();
    const api = Object.assign(stubApi({ pairingMode: vi.fn().mockResolvedValue(earlier) }), {
      liveData,
    });
    const el = await openAdd(api);
    expect(text(el, "[data-test=pairing-until]")).toBe(
      t("devices.open_until").replace("{time}", "2026-09-08 10:05"),
    );

    vi.mocked(api.pairingMode).mockResolvedValue(later);
    liveData.refresh();
    await vi.waitFor(() =>
      expect(text(el, "[data-test=pairing-until]")).toBe(
        t("devices.open_until").replace("{time}", "2026-09-08 10:07"),
      ),
    );
  });

  it("closing the dialog releases the hold", async () => {
    const api = stubApi();
    const el = await openAdd(api);

    q(el, "[data-test=add-device-close]")!.click();

    await vi.waitFor(() => expect(api.releasePairingHold).toHaveBeenCalledExactlyOnceWith("h1"));
    await vi.waitFor(() => expect(q(el, "[data-test=add-device-modal]")).toBeNull());
  });

  it("leaving the screen releases the hold", async () => {
    const api = stubApi();
    const el = await openAdd(api);

    el.remove();

    expect(api.releasePairingHold).toHaveBeenCalledExactlyOnceWith("h1");
  });

  it("lists waiting devices with Pair and no Deny", async () => {
    const api = stubApi();
    const el = await openAdd(api);

    expect(api.joinRequests).toHaveBeenCalledWith("device");
    expect(d(el, "[data-test=waiting-row-r1]")?.textContent?.trim()).toBe("Barra 1");
    expect(d(el, "[data-test=waiting-row-r2]")?.textContent?.trim()).toBe("Pantalla pase");
    expect(d(el, "[data-test=pair-r1]")?.textContent?.trim()).toBe(t("devices.pair"));
    expect(d(el, "[data-test=pair-r1]")?.getAttribute("aria-label")).toBe(
      `${t("devices.pair")} Barra 1`,
    );
    expect(d(el, "[data-test=pair-r2]")).not.toBeNull();
    expect(d(el, "[data-test^=join-deny]")).toBeNull();
    expect(q(el, "[data-test=waiting-empty]")).toBeNull();
  });

  // The list must never show the answer beside the question.
  it("never shows a request's number in the waiting list", async () => {
    const api = stubApi();
    const el = await openAdd(api);

    const table = q(el, "[data-test=waiting-table]")!;
    expect(table.shadowRoot!.textContent).toContain("Barra 1");
    expect(table.shadowRoot!.textContent).not.toContain(REAL_NUMBER);
    expect(d(el, "[data-choice]")).toBeNull();
    expect(api.joinChallenge).not.toHaveBeenCalled();
  });

  it("says it is waiting, with a spinner, while no device has asked", async () => {
    const api = stubApi({ joinRequests: vi.fn().mockResolvedValue([]) });
    const el = await openAdd(api);

    expect(text(el, "[data-test=waiting-empty]")).toBe(t("devices.waiting"));
    expect(q(el, "[data-test=waiting-empty] wt-spinner")).not.toBeNull();
    expect(q(el, "[data-test=waiting-table]")).toBeNull();
  });

  it("does not say it is waiting once the dialog no longer accepts devices", async () => {
    const api = stubApi({
      joinRequests: vi.fn().mockResolvedValue([]),
      takePairingHold: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await openAdd(api);
    await vi.waitFor(() => expect(q(el, "[data-test=hold-lapsed]")).not.toBeNull());

    expect(q(el, "[data-test=waiting-empty]")).toBeNull();
  });

  it("shows a row another manager is pairing without Pair", async () => {
    const api = stubApi({
      joinRequests: vi
        .fn()
        .mockResolvedValue([{ ...pending[0]!, pairingBy: { name: "Ana", mine: false } }]),
    });
    const el = await openAdd(api);

    expect(d(el, "[data-test=being-paired-r1]")?.textContent?.trim()).toBe(
      t("devices.being_paired_by").replace("{name}", "Ana"),
    );
    expect(d(el, "[data-test=pair-r1]")).toBeNull();
  });

  it("a row this login is already pairing opens straight at its settings", async () => {
    const api = stubApi({
      joinRequests: vi
        .fn()
        .mockResolvedValue([{ ...pending[0]!, pairingBy: { name: "Me", mine: true } }]),
    });
    const el = await openAdd(api);

    await openPair(el);

    expect(api.joinChallenge).not.toHaveBeenCalled();
    expect((q(el, "[data-test=pair-name]") as Field).value).toBe("Barra 1");
  });

  it("asks for the number on the device, offering the three as large named buttons", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    expect(q(el, "[data-test=pair-modal]")!.getAttribute("heading")).toBe(
      t("devices.pair_title").replace("{name}", "Barra 1"),
    );
    await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());
    expect(api.joinChallenge).toHaveBeenCalledExactlyOnceWith("r1");
    expect(text(el, "[data-test=pair-modal] #pair-prompt")).toBe(t("devices.join_match_prompt"));
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-choice]")];
    expect(buttons.map((b) => b.getAttribute("data-choice"))).toEqual(CHOICES);
    expect(buttons.map((b) => b.getAttribute("size"))).toEqual(["lg", "lg", "lg"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(
      CHOICES.map((n) => t("devices.join_choice_label").replace("{number}", n)),
    );
    expect(q(el, "[data-test=pair-name]")).toBeNull();
  });

  it("a right number moves to settings with the name filled in", async () => {
    const api = stubApi();
    const el = await openAdd(api);

    await toSettings(el);

    expect(api.checkDeviceJoinNumber).toHaveBeenCalledExactlyOnceWith("r1", {
      choice: REAL_NUMBER,
      holdId: "h1",
    });
    expect((q(el, "[data-test=pair-name]") as Field).value).toBe("Barra 1");
    expect(q(el, "[data-choice]")).toBeNull();
  });

  it("checks one number at a time: every number is disabled while a check is unanswered", async () => {
    let answer!: () => void;
    const api = stubApi({
      checkDeviceJoinNumber: vi.fn().mockReturnValue(new Promise<void>((r) => (answer = r))),
    });
    const el = await openAdd(api);
    await openPair(el);
    await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await flush(el);
    const buttons = [...el.shadowRoot!.querySelectorAll<Button>("[data-choice]")];
    expect(buttons.map((b) => b.disabled)).toEqual([true, true, true]);
    q(el, '[data-choice="12"]')!.click();
    answer();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-name]")).not.toBeNull());
    expect(api.checkDeviceJoinNumber).toHaveBeenCalledTimes(1);
  });

  it("a wrong number closes Pair and says so in the Add dialog", async () => {
    const api = stubApi({
      checkDeviceJoinNumber: vi.fn().mockRejectedValue({ code: "device.join_mismatch" }),
    });
    const el = await openAdd(api);
    await openPair(el);
    await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());

    q(el, '[data-choice="12"]')!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe(
      codeMessage("device.join_mismatch"),
    );
    // The server deleted the request before answering, so there is nothing to discard.
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(d(el, "[data-test=waiting-row-r1]")).toBeNull();
  });

  it("keeps Pair open on a number refusal it can still recover from", async () => {
    const api = stubApi({
      checkDeviceJoinNumber: vi.fn().mockRejectedValue({ code: "join_request.claimed" }),
    });
    const el = await openAdd(api);
    await openPair(el);
    await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());

    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();

    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(
        codeMessage("join_request.claimed"),
      ),
    );
    expect(q(el, "[data-test=pair-modal]")).not.toBeNull();
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
  });

  it("shows a refused number fetch in the Pair dialog", async () => {
    const api = stubApi({
      joinChallenge: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const el = await openAdd(api);
    await openPair(el);

    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(
        codeMessage("join_request.not_found"),
      ),
    );
  });

  it("Pair sends the typed name, profile and binding, then says Added", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);

    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(q(el, "[data-test=pair-binding]")!, "station:s1");
    typeField(el, "[data-test=pair-name]", "Barra 2");
    await el.updateComplete;
    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      name: "Barra 2",
      profileId: "dp3",
      stationId: "s1",
    });
    expect(text(el, "[data-test=added-device]")).toBe(
      t("devices.added").replace("{name}", "Barra 2"),
    );
    expect(q(el, "[data-test=added-device]")!.getAttribute("role")).toBe("status");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
  });

  it("sends a watcher binding without a station, and no binding for a till", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    const binding = q(el, "[data-test=pair-binding]") as HTMLElement & {
      name: string;
      label: string;
      required: boolean;
      options: unknown[];
    };
    expect(binding.name).toBe("binding");
    expect(binding.label).toBe(t("devices.shows"));
    expect(binding.required).toBe(true);
    expect(binding.options).toEqual([
      { value: "station:s1", label: "Cocina", group: t("devices.stations_group") },
      { value: "station:s2", label: "Barra", group: t("devices.stations_group") },
      { value: "watcher:w1", label: "Pass", group: t("devices.watchers_group") },
    ]);
    await chooseOption(binding, "watcher:w1");
    await el.updateComplete;
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "dp3",
      watcherId: "w1",
    });

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    await openPair(el, "r2");
    await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());
    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-profile]")).not.toBeNull());
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;
    expect(q(el, "[data-test=pair-binding]")).toBeNull();
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(2));
    expect(api.acceptDeviceJoinRequest).toHaveBeenLastCalledWith("r2", {
      name: "Pantalla pase",
      profileId: "dp1",
    });
  });

  it("names the settings fields and marks each required", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);

    const name = q(el, "[data-test=pair-name]") as Field & { name: string; required: boolean };
    const profile = q(el, "[data-test=pair-profile]") as Field & {
      name: string;
      required: boolean;
      label: string;
      options: unknown[];
    };
    expect([name.name, name.required]).toEqual(["name", true]);
    expect(name.getAttribute("label")).toBe(t("devices.name"));
    expect([profile.name, profile.required, profile.label]).toEqual([
      "profileId",
      true,
      t("devices.device_profile"),
    ]);
    expect(profile.options).toEqual([
      { value: "dp1", label: "Counter till" },
      { value: "dp2", label: "Waiter handheld" },
      { value: "dp3", label: "Pass screen" },
    ]);
  });

  it("a taken name is shown under Name and Pair stays open", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockRejectedValue({ code: "device.name_taken" }),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(() =>
      expect((q(el, "[data-test=pair-name]") as Field).error).toBe(
        codeMessage("device.name_taken"),
      ),
    );
    expect(q(el, "[data-test=pair-modal]")).not.toBeNull();
    expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(t("form.fix_fields"));
    // A refusal never disables the action by itself.
    expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(false);
    typeField(el, "[data-test=pair-name]", "Barra 9");
    await el.updateComplete;
    expect((q(el, "[data-test=pair-name]") as Field).error).toBe("");
  });

  it("Pair is disabled while the name is blank", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    typeField(el, "[data-test=pair-name]", "   ");
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();
    await flush(el);

    expect(api.acceptDeviceJoinRequest).not.toHaveBeenCalled();
    expect((q(el, "[data-test=pair-name]") as Field).error).toBe(t("form.name_required"));
    expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(true);
    expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(t("form.fix_fields"));
    typeField(el, "[data-test=pair-name]", "Barra 3");
    await el.updateComplete;
    expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(false);
  });

  it("asks for a profile, and for what a kitchen screen shows, before pairing", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);

    q(el, "[data-test=pair-submit]")!.click();
    await flush(el);
    expect((q(el, "[data-test=pair-profile]") as Field).error).toBe(t("devices.join_pick_profile"));
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    expect((q(el, "[data-test=pair-profile]") as Field).error).toBe("");
    expect((q(el, "[data-test=pair-binding]") as Field).error).toBe(
      codeMessage("device.station_required"),
    );
    expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(true);
    expect(api.acceptDeviceJoinRequest).not.toHaveBeenCalled();
  });

  it("a refusal naming the station goes under Shows", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockRejectedValue({ code: "station.not_found" }),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(q(el, "[data-test=pair-binding]")!, "station:s1");
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(() =>
      expect((q(el, "[data-test=pair-binding]") as Field).error).toBe(
        codeMessage("station.not_found"),
      ),
    );
    expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(t("form.fix_fields"));
  });

  it("puts a request-invalid refusal under the field its params name", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", params: { field: "profileId" } }),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(() =>
      expect((q(el, "[data-test=pair-profile]") as Field).error).toBe(
        codeMessage("management.request_invalid"),
      ),
    );
    expect((q(el, "[data-test=pair-name]") as Field).error).toBe("");
  });

  it("shows a refusal naming no field at the bottom of Pair", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockRejectedValue({ code: "join_request.unclaimed" }),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(
        codeMessage("join_request.unclaimed"),
      ),
    );
    expect((q(el, "[data-test=pair-name]") as Field).error).toBe("");
    expect(q(el, "[data-test=pair-modal]")).not.toBeNull();
  });

  it("Cancel discards the request at the number step", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1");
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
    expect(api.releasePairingHold).not.toHaveBeenCalled();
  });

  it("Cancel discards the request at the settings step, and a failed discard is ignored", async () => {
    const api = stubApi({
      denyJoinRequest: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const el = await openAdd(api);
    await toSettings(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1");
    await flush(el);
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
  });

  it("Escape on Pair discards the request and leaves the Add dialog open", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=pair-modal]")!.shadowRoot!.querySelector("dialog")!.close();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1");
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
  });

  it("closing Add while Pair is open discards the request and releases the hold", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    el.remove();

    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1");
    expect(api.releasePairingHold).toHaveBeenCalledExactlyOnceWith("h1");
  });

  // The renewal goes through `background`, which this stub does not have: the controller falls back
  // to the API itself, so `renewPairingHold` below is the one it calls. Only the interval timers are
  // faked, so animation frames stay real.
  it("a lapsed hold shows the notice, and Start again takes a new hold", async () => {
    const api = stubApi({
      renewPairingHold: vi.fn().mockRejectedValue({ code: "device.pairing_hold_lapsed" }),
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const el = await openAdd(api);

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(q(el, "[data-test=hold-lapsed]")).not.toBeNull());
      await flush(el);
      expect(api.renewPairingHold).toHaveBeenCalledWith("h1");
      expect((d(el, "[data-test=pair-r1]") as Button).disabled).toBe(true);
      expect((d(el, "[data-test=pair-r2]") as Button).disabled).toBe(true);

      q(el, "[data-test=hold-restart]")!.click();
      await vi.waitFor(() => expect(api.takePairingHold).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(q(el, "[data-test=hold-lapsed]")).toBeNull());
      await flush(el);
      expect((d(el, "[data-test=pair-r1]") as Button).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a tap after the hold lapsed says so and sends nothing", async () => {
    const api = stubApi({
      renewPairingHold: vi.fn().mockRejectedValue({ code: "device.pairing_hold_lapsed" }),
    });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const el = await openAdd(api);
      await openPair(el);
      await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(q(el, "[data-test=hold-lapsed]")).not.toBeNull());
      q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
      await flush(el);

      expect(api.checkDeviceJoinNumber).not.toHaveBeenCalled();
      expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(
        codeMessage("device.pairing_hold_lapsed"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refused take offers Start again", async () => {
    const api = stubApi({
      takePairingHold: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue({ holdId: "h2", openUntil: TAKEN_UNTIL }),
    });
    const el = await openAdd(api);

    await vi.waitFor(() => expect(q(el, "[data-test=hold-restart]")).not.toBeNull());
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe(
      codeMessage("connection.failed"),
    );
    expect((d(el, "[data-test=pair-r1]") as Button).disabled).toBe(true);

    q(el, "[data-test=hold-restart]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=hold-restart]")).toBeNull());
    await flush(el);
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
    expect((d(el, "[data-test=pair-r1]") as Button).disabled).toBe(false);
  });

  it("keeps a refused take's message through a failed re-read and the reads' recovery", async () => {
    const api = Object.assign(
      stubApi({ takePairingHold: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      { liveData: new LiveData() },
    );
    const el = await openAdd(api);
    await vi.waitFor(() => expect(q(el, "[data-test=hold-restart]")).not.toBeNull());

    vi.mocked(api.listDevices).mockRejectedValue({ code: "server.internal" });
    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[data-test=page-error]")).not.toBeNull());
    vi.mocked(api.listDevices).mockResolvedValue(devices);
    api.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[data-test=page-error]")).toBeNull());
    await flush(el);

    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe(
      codeMessage("connection.failed"),
    );
  });
});

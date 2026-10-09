import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { html } from "lit";
import { registerCatalogue, type CardProviderPanel } from "@waitron/dashboard-kit";
import {
  chooseOption,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type {
  DashboardApi,
  DeviceProfile,
  DeviceRow,
  JoinRequestRow,
  Printer,
  ProfileReaderList,
  ReaderRow,
  Station,
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

const devices: DeviceRow[] = [
  {
    id: "d1",
    madeHereStationIds: [],
    approvedProfileIds: ["dp1"],
    kind: "kds_station",
    kitchenScreens: [
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        stations: [{ id: "s1", name: "Cocina", available: true, switchedOff: false }],
        zones: null,
      },
    ],
    label: "Pantalla Cocina",
    active: true,
    lastSeenAt: "2026-08-25T14:30:00.000Z",
    enrolledAt: "2026-08-20T09:00:00.000Z",
    deviceProfileId: "dp1",
    profileRetired: false,
    receiptPrinterId: "pr1",
    paymentSlipPrinterId: null,
    cashDrawerPrinterId: null,
    equipment: [],
    batteryLevel: null,
    batteryCharging: null,
    batteryReportedAt: null,
  },
  {
    id: "d2",
    madeHereStationIds: [],
    approvedProfileIds: [],
    kind: "kds_station",
    kitchenScreens: [],
    label: "Pase revocado",
    active: false,
    lastSeenAt: null,
    enrolledAt: "2026-08-19T09:00:00.000Z",
    deviceProfileId: null,
    profileRetired: false,
    receiptPrinterId: null,
    paymentSlipPrinterId: null,
    cashDrawerPrinterId: null,
    equipment: [],
    batteryLevel: null,
    batteryCharging: null,
    batteryReportedAt: null,
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
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    startingScreen: null,
    departmentId: "dep-1",
    allowedZoneIds: null,
    startingZoneId: "zone-1",
    admittedRoles: ["staff", "supervisor", "manager", "admin"],
    personExceptions: [],
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
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    startingScreen: null,
    departmentId: "dep-1",
    allowedZoneIds: null,
    startingZoneId: "zone-1",
    admittedRoles: ["staff", "supervisor", "manager", "admin"],
    personExceptions: [],
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
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    startingScreen: null,
    departmentId: null,
    allowedZoneIds: null,
    startingZoneId: null,
    admittedRoles: ["staff", "supervisor", "manager", "admin"],
    personExceptions: [],
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
    portable: false,
    holder: null,
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
    deviceNames: ["Front till"],
  },
  {
    id: "r2",
    provider: "zeta",
    name: "Bar",
    active: true,
    canEnable: true,
    deviceCount: 0,
    deviceNames: [],
  },
  // Retired: must be excluded from the picker's options.
  {
    id: "r3",
    provider: "acme",
    name: "Old terminal",
    active: false,
    canEnable: true,
    deviceCount: 0,
    deviceNames: [],
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listDevices: vi.fn().mockResolvedValue(devices),
    listStations: vi.fn().mockResolvedValue(stations),
    listZones: vi.fn().mockResolvedValue([]),
    listDeviceProfiles: vi.fn().mockResolvedValue(deviceProfiles),
    listProfileKitchenScreens: vi.fn().mockResolvedValue(
      ["dp3", "pk"].map((profileId) => ({
        profileId,
        screens: {
          station: { stationIds: ["s1", "s2", "s-off"], zoneIds: null },
          pass: { stationIds: null, zoneIds: null },
        },
      })),
    ),
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
    updateDevice: vi.fn().mockResolvedValue(undefined),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    getProfileReaders: vi
      .fn()
      .mockResolvedValue({ readerIds: ["r1", "r2", "r3"], defaultReaderId: null }),
    // No device has chosen a reader (Use default) unless a test says otherwise.
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
const text = (el: DevicesScreen, sel: string) => q(el, sel)?.textContent?.trim();

/** Table cells live in the table's own shadow root, so a row's hooks are found through it. */
function dq(root: ShadowRoot | Element, sel: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(sel);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.shadowRoot) {
      const nested = dq(node.shadowRoot, sel);
      if (nested) return nested;
    }
  }
  return null;
}
const deepText = (el: DevicesScreen, sel: string) => dq(el.shadowRoot!, sel)?.textContent?.trim();
/** A sentence holding a relative time, with the time standing as `{time}`, and the moment it shows. */
function timeSentence(sentence: Element | null): { text: string; at: string | null } {
  const copy = sentence!.cloneNode(true) as Element;
  const time = copy.querySelector("wt-relative-time");
  time?.replaceWith("{time}");
  return {
    text: copy.textContent!.replace(/\s+/g, " ").trim(),
    at: sentence!.querySelector("wt-relative-time")?.getAttribute("datetime") ?? null,
  };
}
const devicesTable = (el: DevicesScreen) =>
  q(el, "[data-test=devices-table]") as HTMLElementTagNameMap["wt-data-table"];

describe("devices-screen", () => {
  it("offers one Add a device action when empty and keeps the heading action with rows", async () => {
    for (const rows of [[], devices]) {
      const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
        api: stubApi({ listDevices: vi.fn().mockResolvedValue(rows) }),
      });
      await flush(el);
      expect(el.shadowRoot!.querySelectorAll("[data-test=open-add-device]")).toHaveLength(1);
      expect(q(el, ".heading [data-test=open-add-device]")).not.toBeNull();
      cleanupWidgets();
    }
  });

  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`searches device names and filters profile and status in ${locale}`, async () => {
      const before = currentLocale();
      setLocale(locale);
      sessionStorage.removeItem("devices");
      try {
        const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
          api: stubApi({
            listDevices: vi.fn().mockResolvedValue([
              ...devices,
              { ...devices[0]!, id: "d3", label: "Handheld", deviceProfileId: "dp2" },
              {
                ...devices[0]!,
                id: "d4",
                label: "Retired profile",
                deviceProfileId: "dp-retired",
                profileRetired: true,
              },
            ]),
          }),
        });
        await flush(el);
        const table = devicesTable(el);
        const search = dq(table.shadowRoot!, 'input[name="search"]') as HTMLInputElement | null;
        expect(search).not.toBeNull();
        search!.value = "Handheld";
        search!.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await table.updateComplete;
        expect(deepText(el, "[data-test=device-label-d3]")).toBe("Handheld");
        expect(dq(table.shadowRoot!, "[data-test=device-row-d1]")).toBeNull();
        search!.value = "";
        search!.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await table.updateComplete;
        await page.getByRole("button", { name: t("table.filters"), exact: true }).click();
        const profile = dq(table.shadowRoot!, 'wt-combobox[name="profile-filter"]');
        expect(profile).not.toBeNull();
        await chooseOption(profile!, "dp1");
        expect(deepText(el, "[data-test=device-label-d1]")).toBe("Pantalla Cocina");
        expect(dq(table.shadowRoot!, "[data-test=device-row-d3]")).toBeNull();
        await chooseOption(profile!, "retired");
        expect(deepText(el, "[data-test=device-label-d4]")).toBe("Retired profile");
        expect(dq(table.shadowRoot!, "[data-test=device-row-d1]")).toBeNull();
        await chooseOption(profile!, "none");
        expect(deepText(el, "[data-test=device-label-d2]")).toBe("Pase revocado");
        expect(dq(table.shadowRoot!, "[data-test=device-row-d4]")).toBeNull();
        await chooseOption(profile!, "");
        const status = dq(table.shadowRoot!, 'wt-combobox[name="status-filter"]');
        expect(status).not.toBeNull();
        await chooseOption(status!, "disabled");
        expect(deepText(el, "[data-test=device-label-d2]")).toBe("Pase revocado");
        expect(dq(table.shadowRoot!, "[data-test=device-row-d1]")).toBeNull();
        await chooseOption(status!, "");
        await chooseOption(profile!, "dp2");
        await chooseOption(status!, "disabled");
        expect(dq(table.shadowRoot!, "[data-test=device-row-d3]")).toBeNull();
        expect(dq(table.shadowRoot!, "[data-test=device-row-d2]")).toBeNull();
      } finally {
        sessionStorage.removeItem("devices");
        setLocale(before);
      }
    });
  }

  it("loads every feed the screen needs on connect and renders a row per device", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(api.listDevices).toHaveBeenCalledTimes(1);
    expect(api.listStations).toHaveBeenCalledTimes(1);
    // Profiles and printers name what each row shows; stations are also the accept dialog's
    // kitchen screen lists, so they are one load, not two.
    expect(api.listDeviceProfiles).toHaveBeenCalledTimes(1);
    expect(api.listPrinters).toHaveBeenCalledTimes(1);
    expect(api.pairingMode).toHaveBeenCalledTimes(1);
    expect(api.joinRequests).toHaveBeenCalledTimes(1);
    expect(dq(el.shadowRoot!, "[data-test=device-row-d1]")).toBeTruthy();
    expect(dq(el.shadowRoot!, "[data-test=device-row-d2]")).toBeTruthy();
  });

  it("shows label, profile name, resolved station name, active status and formatted last-seen", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(deepText(el, "[data-test=device-label-d1]")).toBe("Pantalla Cocina");
    // The deviceProfileId resolves to the profile's display name, not the raw id.
    expect(deepText(el, "[data-test=device-profile-d1]")).toBe("Counter till");
    // What a device shows reads out its kitchen screens by name, not by id.
    expect(deepText(el, "[data-test=device-screen-d1-station]")).toBe(
      `${t("device_profiles.kitchen_screen.station", "es-ES")}: Cocina`,
    );
    expect(deepText(el, "[data-test=device-status-d1]")).toBe(t("devices.status_active", "es-ES"));
    // Last-seen is the timestamp formatted to the minute, not the raw ISO string.
    expect(deepText(el, "[data-test=device-last-seen-d1]")).toBe("2026-08-25 14:30");
  });

  it("leaves a null profile empty, says a kitchen screen with no kitchen screen has none, and a null last-seen Never", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    expect(deepText(el, "[data-test=device-profile-d2]")).toBe("");
    expect(deepText(el, "[data-test=device-screens-d2]")).toBe(
      t("devices.no_kitchen_screen", "es-ES"),
    );
    expect(deepText(el, "[data-test=device-last-seen-d2]")).toBe(
      t("devices.last_seen_never", "es-ES"),
    );
    expect(deepText(el, "[data-test=device-status-d2]")).toBe("Deshabilitado");
  });

  it("leaves the profile empty for a device whose profile is not in the loaded set, and follows a refresh", async () => {
    const orphan: DeviceRow = { ...devices[0]!, id: "d9", deviceProfileId: "dp-gone" };
    const liveData = new LiveData();
    const api = Object.assign(stubApi({ listDevices: vi.fn().mockResolvedValue([orphan]) }), {
      liveData,
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await vi.waitFor(() =>
      expect(dq(el.shadowRoot!, "[data-test=device-profile-d9]")).not.toBeNull(),
    );
    expect(deepText(el, "[data-test=device-profile-d9]")).toBe("");

    vi.mocked(api.listDevices).mockResolvedValue([{ ...orphan, deviceProfileId: "dp2" }]);
    liveData.invalidate([{ type: "devices", id: "d9" }]);
    await vi.waitFor(() =>
      expect(deepText(el, "[data-test=device-profile-d9]")).toBe("Waiter handheld"),
    );
  });

  it("says there are no devices yet in the devices table itself", async () => {
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const table = devicesTable(el);
    await table.updateComplete;
    expect(table.rows).toEqual([]);
    expect(table.emptyMessage).toBe(t("devices.no_devices", "es-ES"));
    expect(table.shadowRoot!.querySelector(".empty .message")!.textContent!.trim()).toBe(
      t("devices.no_devices", "es-ES"),
    );
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
    expect(dq(el.shadowRoot!, `[data-test=device-row-${devices[0]!.id}]`)).not.toBeNull();
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

  it("registers as a custom element", () => {
    expect(customElements.get("dashboard-devices-screen")).toBe(DevicesScreen);
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

describe("the device table", () => {
  type Menu = HTMLElement & { label: string; updateComplete: Promise<unknown> };
  const till: DeviceRow = {
    ...devices[0]!,
    id: "t1",
    kind: "till",
    kitchenScreens: [],
    label: "Caja 1",
    deviceProfileId: "dp1",
  };

  it("is a remembered table of name, profile, what it shows, battery, status and last seen, with its menu pinned last", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi({ listDevices: vi.fn().mockResolvedValue([...devices, till]) }),
    });
    await flush(el);
    const table = devicesTable(el);
    expect(table.getAttribute("viewKey")).toBe("devices");
    expect(table.getAttribute("aria-label")).toBe(t("devices.title"));
    expect(table.getAttribute("customiseColumnsLabel")).toBe(t("table.customise_columns"));
    expect(table.columns.map((c) => [c.key, c.label])).toEqual([
      ["name", t("devices.name")],
      ["profile", t("devices.device_profile")],
      ["shows", t("devices.shows")],
      ["receipt", t("devices.receipt_printer_now")],
      ["slip", t("devices.slip_printer_now")],
      ["drawer", t("devices.cash_drawer_now")],
      ["reader", t("devices.default_reader")],
      ["battery", t("devices.column_battery")],
      ["status", t("devices.column_status")],
      ["lastSeen", t("devices.column_last_seen")],
      ["actions", t("devices.actions")],
    ]);
    expect(table.columns.at(-1)!.pinned).toBe("end");
    expect(table.rows.map((row) => (row as DeviceRow).id)).toEqual(["d1", "d2", "t1"]);
    // What a device shows is a kitchen screen's; a till's cell is empty.
    expect(deepText(el, "[data-test=device-screens-t1]")).toBe("");
    expect(deepText(el, "[data-test=device-label-t1]")).toBe("Caja 1");
  });

  describe("the Battery column", () => {
    const NOW = new Date("2026-10-05T12:00:00.000Z");
    const minutesAgo = (minutes: number) =>
      new Date(NOW.getTime() - minutes * 60_000).toISOString();
    const reported = (
      id: string,
      batteryLevel: number | null,
      batteryCharging: boolean | null,
      minutes: number | null,
    ): DeviceRow => ({
      ...devices[0]!,
      id,
      label: id,
      batteryLevel,
      batteryCharging,
      batteryReportedAt: minutes === null ? null : minutesAgo(minutes),
    });

    async function mountBattery(rows: DeviceRow[]): Promise<DevicesScreen> {
      const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
        api: stubApi({ listDevices: vi.fn().mockResolvedValue(rows) }),
        now: () => NOW,
      });
      await flush(el);
      await devicesTable(el).updateComplete;
      return el;
    }

    const cell = (el: DevicesScreen, id: string) =>
      dq(el.shadowRoot!, `[data-test=device-battery-${id}]`)!;

    it("shows a charging device's level with a charging mark whose accessible text says so", async () => {
      const el = await mountBattery([reported("c", 82, true, 1)]);
      expect(deepText(el, "[data-test=device-battery-level-c]")).toBe("82%");
      const mark = dq(el.shadowRoot!, "[data-test=device-battery-mark-c]")!;
      expect(mark.getAttribute("aria-hidden")).toBe("true");
      const spoken = dq(el.shadowRoot!, "[data-test=device-battery-charging-c]")!;
      expect(spoken.textContent!.trim()).toBe(t("devices.battery_charging", "es-ES"));
      // Read by a screen reader, drawn nowhere: the part's rule reaches the cell.
      expect(spoken.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      expect(cell(el, "c").textContent!.replace(/\s+/g, " ").trim()).toBe(
        `82% ${mark.textContent!.trim()} ${t("devices.battery_charging", "es-ES")}`,
      );
    });

    it("shows the level alone when the device is not charging", async () => {
      const el = await mountBattery([reported("n", 82, false, 1)]);
      expect(cell(el, "n").textContent!.trim()).toBe("82%");
      expect(dq(el.shadowRoot!, "[data-test=device-battery-mark-n]")).toBeNull();
    });

    it("says Not reported for a device that has never reported", async () => {
      const el = await mountBattery([reported("x", null, null, null)]);
      expect(cell(el, "x").textContent!.trim()).toBe(t("devices.battery_not_reported", "es-ES"));
    });

    it("greys a report more than ten minutes old and says when it was taken", async () => {
      const el = await mountBattery([reported("old", 82, false, 11)]);
      const shown = cell(el, "old");
      expect(shown.getAttribute("part")).toBe("battery-stale");
      expect(timeSentence(shown)).toEqual({
        text: `82% ${t("devices.battery_updated", "es-ES")}`,
        at: minutesAgo(11),
      });
      const probe = document.createElement("span");
      probe.style.color = "var(--wt-color-text-muted)";
      el.parentElement!.appendChild(probe);
      expect(getComputedStyle(shown).color).toBe(getComputedStyle(probe).color);
      probe.remove();
    });

    it("says how long ago a greyed report was taken in the session's language, with the exact time on hand", async () => {
      const before = currentLocale();
      try {
        for (const [locale, sentence, ago, exact] of [
          ["en-GB", "82% updated 11 minutes ago", "11 minutes ago", "5 October 2026 at 11:49"],
          [
            "es-ES",
            "82% actualizado hace 11 minutos",
            "hace 11 minutos",
            "5 de octubre de 2026 a las 11:49",
          ],
        ] as const) {
          setLocale(locale);
          const el = await mountBattery([reported("old", 82, false, 11)]);
          const time = cell(el, "old").querySelector("wt-relative-time")!;
          await time.updateComplete;
          const words = time.shadowRoot!.querySelector("time")!.textContent!.trim();
          expect(words).toBe(ago);
          expect(timeSentence(cell(el, "old")).text.replace("{time}", words)).toBe(sentence);
          const button = time.shadowRoot!.querySelector("button")!;
          const tip = time.shadowRoot!.getElementById(button.getAttribute("aria-describedby")!)!;
          expect(tip.textContent!.trim()).toBe(exact);
          button.click();
          expect(tip.matches(":popover-open")).toBe(true);
          cleanupWidgets();
        }
      } finally {
        setLocale(before);
      }
    });

    it("leaves a nine-minute-old report as it is", async () => {
      const el = await mountBattery([reported("fresh", 82, false, 9)]);
      const shown = cell(el, "fresh");
      expect(shown.getAttribute("part")).toBeNull();
      expect(shown.textContent!.trim()).toBe("82%");
    });

    it("leaves a report exactly ten minutes old as it is", async () => {
      const el = await mountBattery([reported("edge", 82, false, 10)]);
      const shown = cell(el, "edge");
      expect(shown.getAttribute("part")).toBeNull();
      expect(shown.textContent!.trim()).toBe("82%");
    });

    describe("as time passes, with the list unchanged", () => {
      afterEach(() => vi.useRealTimers());

      async function mountWithClock(rows: DeviceRow[], clock: { at: Date }) {
        // Only the timers: the table's animation frames keep running.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const api = stubApi({ listDevices: vi.fn().mockResolvedValue(rows) });
        const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
          api,
          now: () => clock.at,
        });
        await vi.advanceTimersByTimeAsync(0);
        await el.updateComplete;
        await devicesTable(el).updateComplete;
        return { el, api };
      }

      it("greys a report once it passes ten minutes, without reading the list again", async () => {
        const clock = { at: NOW };
        const { el, api } = await mountWithClock([reported("ageing", 82, false, 9)], clock);
        expect(cell(el, "ageing").getAttribute("part")).toBeNull();

        clock.at = new Date(NOW.getTime() + 61_000);
        await vi.advanceTimersByTimeAsync(61_000);
        await el.updateComplete;
        await devicesTable(el).updateComplete;

        const shown = cell(el, "ageing");
        expect(shown.getAttribute("part")).toBe("battery-stale");
        expect(timeSentence(shown)).toEqual({
          text: `82% ${t("devices.battery_updated", "es-ES")}`,
          at: minutesAgo(9),
        });
        expect(api.listDevices).toHaveBeenCalledTimes(1);
      });

      it("does not keep redrawing when a report's stale moment is beyond the longest timer", async () => {
        // A browser clock far behind the server's puts the report weeks in the future.
        const clock = { at: new Date(NOW.getTime() - 30 * 24 * 60 * 60_000) };
        const { el } = await mountWithClock([reported("ahead", 82, false, 1)], clock);
        const redraws = vi.spyOn(el, "requestUpdate");
        await vi.advanceTimersByTimeAsync(100);
        expect(redraws).not.toHaveBeenCalled();
      });

      it("leaves no timer behind once the screen is gone", async () => {
        const clock = { at: NOW };
        const { el } = await mountWithClock([reported("ageing", 82, false, 9)], clock);
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        el.remove();
        expect(vi.getTimerCount()).toBe(0);
      });
    });

    it("is a column a person may hide, sorted by the level", async () => {
      const row = reported("s", 82, false, 1);
      const el = await mountBattery([row]);
      const column = devicesTable(el).columns.find((c) => c.key === "battery")!;
      expect(column.choosable).toBe("shown");
      expect(column.sortValue!(row)).toBe(82);
      expect(column.sortValue!(reported("x", null, null, null))).toBeNull();
    });
  });

  it("opens Edit when an active device's row is clicked", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    const row = devicesTable(el).shadowRoot!.querySelector('tr[data-row-key="d1"]')!;
    const activator = row.querySelector<HTMLButtonElement>(".row-activate")!;
    expect(activator.getAttribute("aria-label")).toBe(
      t("devices.edit_title").replace("{name}", "Pantalla Cocina"),
    );
    activator.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull());
    expect(q(el, "[data-test=edit-device-modal]")!.getAttribute("heading")).toBe(
      t("devices.edit_title").replace("{name}", "Pantalla Cocina"),
    );
  });

  it("a disabled device's row opens nothing, and it has no Edit or Disable", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    const table = devicesTable(el);
    const row = table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="d2"]')!;
    expect(row.querySelector(".row-activate")).toBeNull();
    expect(row.classList.contains("clickable")).toBe(false);
    expect(row.querySelector("dashboard-row-actions")).toBeNull();
    await userEvent.click(row.querySelector("td")!);
    await flush(el);
    expect(q(el, "[data-test=edit-device-modal]")).toBeNull();
    expect(dq(el.shadowRoot!, "[data-test=edit-device-d2]")).toBeNull();
    expect(dq(el.shadowRoot!, "[data-test=remove-d2]")).toBeNull();
  });

  it("an active device's menu, named for it, offers Edit and Disable", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    const row = devicesTable(el).shadowRoot!.querySelector('tr[data-row-key="d1"]')!;
    const menu = row.querySelector<Menu>("dashboard-row-actions")!;
    expect(menu.label).toBe(`${t("devices.actions")}: Pantalla Cocina`);
    const items = [...menu.querySelectorAll("wt-button")];
    expect(items.map((b) => b.getAttribute("data-test"))).toEqual(["edit-device-d1", "remove-d1"]);
    expect(items.map((b) => b.textContent?.trim())).toEqual([t("action.edit"), "Deshabilitar"]);
    // Disable's first press only arms it, so the menu stays open for the second.
    expect(items[1]!.hasAttribute("data-keep-open")).toBe(true);
    (items[0] as HTMLElement).click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull());
  });

  it("words Disable, its confirmation and the disabled status in English and Spanish", async () => {
    const before = currentLocale();
    try {
      for (const [locale, disable, confirm, disabled] of [
        ["en", "Disable", "Disable this device?", "Disabled"],
        ["es-ES", "Deshabilitar", "¿Deshabilitar este dispositivo?", "Deshabilitado"],
      ] as const) {
        setLocale(locale);
        const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
          api: stubApi(),
        });
        await flush(el);
        expect(deepText(el, "[data-test=device-status-d2]")).toBe(disabled);
        expect(deepText(el, "[data-test=remove-d1]")).toBe(disable);
        dq(el.shadowRoot!, "[data-test=remove-d1]")!.click();
        await flush(el);
        expect(deepText(el, "[data-test=remove-d1]")).toBe(confirm);
        cleanupWidgets();
      }
    } finally {
      setLocale(before);
    }
  });

  it("says Profile deleted, muted, for a device whose profile the server reports retired, in English and Spanish", async () => {
    const retired: DeviceRow = {
      ...devices[1]!,
      id: "d8",
      deviceProfileId: "dp-retired",
      profileRetired: true,
    };
    const before = currentLocale();
    try {
      for (const [locale, deleted] of [
        ["en", "Profile deleted"],
        ["es-ES", "Perfil eliminado"],
      ] as const) {
        setLocale(locale);
        const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
          api: stubApi({ listDevices: vi.fn().mockResolvedValue([devices[0]!, retired]) }),
        });
        await flush(el);
        expect(deepText(el, "[data-test=device-profile-d8]")).toBe(deleted);
        const shown = dq(el.shadowRoot!, "[data-test=device-profile-d8] [part=profile-retired]")!;
        const probe = document.createElement("span");
        probe.style.color = "var(--wt-color-text-muted)";
        el.parentElement!.appendChild(probe);
        expect(getComputedStyle(shown).color).toBe(getComputedStyle(probe).color);
        probe.remove();
        expect(deepText(el, "[data-test=device-profile-d1]")).toBe("Counter till");
        expect(
          dq(el.shadowRoot!, "[data-test=device-profile-d1] [part=profile-retired]"),
        ).toBeNull();
        cleanupWidgets();
      }
    } finally {
      setLocale(before);
    }
  });

  it("sorts a device whose profile is retired by the words its Profile cell shows", async () => {
    const retired: DeviceRow = {
      ...devices[1]!,
      id: "d8",
      deviceProfileId: "dp-retired",
      profileRetired: true,
    };
    const before = currentLocale();
    try {
      for (const locale of ["en", "es-ES"] as const) {
        setLocale(locale);
        const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
          api: stubApi({ listDevices: vi.fn().mockResolvedValue([retired, devices[0]!]) }),
        });
        await flush(el);
        const table = devicesTable(el);
        const profile = table.columns.find((c) => c.key === "profile")!;
        expect(profile.sortValue!(retired)).toBe(deepText(el, "[data-test=device-profile-d8]"));
        table.sortKey = "profile";
        await table.updateComplete;
        const order = [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
          row.getAttribute("data-row-key"),
        );
        expect(order).toEqual(["d1", "d8"]);
        cleanupWidgets();
      }
    } finally {
      setLocale(before);
    }
  });

  it("disables only on the confirming second press, then reloads the list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    dq(el.shadowRoot!, "[data-test=remove-d1]")!.click();
    await flush(el);
    expect(api.revokeDevice).not.toHaveBeenCalled();
    expect(deepText(el, "[data-test=remove-d1]")).toBe("¿Deshabilitar este dispositivo?");
    expect(dq(el.shadowRoot!, "[data-test=remove-d1]")!.getAttribute("data-armed")).toBe("true");

    dq(el.shadowRoot!, "[data-test=remove-d1]")!.click();
    await flush(el);
    expect(api.revokeDevice).toHaveBeenCalledWith("d1");
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it("shows an error and keeps the list when a disable is rejected", async () => {
    const api = stubApi({ revokeDevice: vi.fn().mockRejectedValue({ code: "device.not_found" }) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    dq(el.shadowRoot!, "[data-test=remove-d1]")!.click();
    await flush(el);
    dq(el.shadowRoot!, "[data-test=remove-d1]")!.click();
    await flush(el);

    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("device.not_found");
    const banner = q(el, "[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("device.not_found", "es-ES"));
    expect(dq(el.shadowRoot!, "[data-test=device-row-d1]")).not.toBeNull();
  });

  it("reads no device's card reader while listing", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    liveData.invalidate([{ type: "devices", id: "d1" }]);
    await vi.waitFor(() => expect(api.listDevices).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(api.getDeviceReader).not.toHaveBeenCalled();
    expect(api.listReaders).not.toHaveBeenCalled();
  });

  it("keeps every active row's menu on screen and uncovered at 390 px", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    try {
      await page.viewport(390, 844);
      const long = {
        ...till,
        label: "Caja-de-la-terraza-junto-a-la-puerta-del-jardin-trasero",
      };
      const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
        api: stubApi({ listDevices: vi.fn().mockResolvedValue([devices[0], long, devices[1]]) }),
      });
      await flush(el);
      const table = devicesTable(el);
      await table.updateComplete;
      expectRowMenusOnScreen(table, 2, "dashboard-row-actions");
    } finally {
      await page.viewport(width, height);
    }
  });

  it("shows each device's resolved receipt, slip, drawer and reader, marked when on Use default", async () => {
    const equipped: DeviceRow = {
      ...devices[0]!,
      kind: "till",
      equipment: [
        {
          role: "receipt",
          selection: "default",
          chosenId: null,
          resolved: { id: "pr1", name: "Cocina", available: true },
        },
        {
          role: "payment_slip",
          selection: "item",
          chosenId: "pr2",
          resolved: { id: "pr2", name: "Terraza", available: true },
        },
        {
          role: "cash_drawer",
          selection: "default",
          chosenId: null,
          resolved: null,
        },
        {
          role: "card_terminal",
          selection: "default",
          chosenId: null,
          resolved: { id: "r1", name: "Front counter", available: true },
        },
      ],
    };
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([equipped]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    const mark = t("devices.default_mark");
    expect(deepText(el, "[data-test=device-receipt-d1]")).toBe(`Cocina (${mark})`);
    expect(deepText(el, "[data-test=device-slip-d1]")).toBe("Terraza");
    expect(deepText(el, "[data-test=device-drawer-d1]")).toBe(`${t("equipment.none")} (${mark})`);
    expect(deepText(el, "[data-test=device-reader-d1]")).toBe(`Front counter (${mark})`);
  });

  it("draws no card reader column for a session that cannot manage readers", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
      canManageReaders: false,
    });
    await flush(el);
    expect(devicesTable(el).columns.map((c) => c.key)).not.toContain("reader");
    expect(dq(el.shadowRoot!, "[data-test=device-receipt-d1]")).not.toBeNull();
    expect(dq(el.shadowRoot!, "[data-test=device-reader-d1]")).toBeNull();
  });

  it("shows the equipment columns to someone whose remembered columns predate them, after Shows", async () => {
    // Saved by the table before these columns existed: Battery hidden, Status moved first.
    localStorage.setItem("devices:columns", JSON.stringify({ battery: false }));
    localStorage.setItem(
      "devices:column-order",
      JSON.stringify(["status", "profile", "shows", "battery", "lastSeen"]),
    );
    try {
      const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
        api: stubApi(),
      });
      await flush(el);
      const table = devicesTable(el);
      await table.updateComplete;
      const headers = [...table.shadowRoot!.querySelectorAll("thead th")].map((th) =>
        th.textContent!.replace(/[▲▼]/g, "").trim(),
      );
      expect(headers).toEqual([
        t("devices.name"),
        t("devices.column_status"),
        t("devices.device_profile"),
        t("devices.shows"),
        t("devices.receipt_printer_now"),
        t("devices.slip_printer_now"),
        t("devices.cash_drawer_now"),
        t("devices.default_reader"),
        t("devices.column_last_seen"),
        t("devices.actions"),
      ]);
    } finally {
      localStorage.removeItem("devices:columns");
      localStorage.removeItem("devices:column-order");
    }
  });
});

describe("the Edit dialog", () => {
  type Field = HTMLElement & {
    value: string;
    error: string;
    invalid: boolean;
    name: string;
    label: string;
    required: boolean;
    placeholder: string;
    disabled: boolean;
    options: { value: string; label: string }[];
  };
  type Button = HTMLElement & { disabled: boolean };

  const editPrinters: Printer[] = [
    printers[0]!,
    { ...printers[0]!, id: "pr2", name: "Terraza" },
    { ...printers[0]!, id: "pr3", name: "Barra", active: false },
  ];
  const editProfiles: DeviceProfile[] = [
    {
      ...deviceProfiles[0]!,
      id: "pa",
      name: "Counter till",
      receiptPrinterIds: ["pr3", "pr1", "pr2"],
      paymentSlipPrinterIds: ["pr2"],
    },
    {
      ...deviceProfiles[1]!,
      id: "pb",
      name: "Waiter handheld",
      receiptPrinterIds: ["pr3", "pr2"],
      paymentSlipPrinterIds: [],
    },
    { ...deviceProfiles[2]!, id: "pk", name: "Pass screen" },
  ];
  const till: DeviceRow = {
    ...devices[0]!,
    id: "t1",
    kind: "till",
    kitchenScreens: [],
    label: "Caja 1",
    deviceProfileId: "pa",
    // Switched off since the device chose it; it may keep it.
    receiptPrinterId: "pr3",
    paymentSlipPrinterId: "pr2",
    madeHereStationIds: ["s2"],
  };
  const kitchen: DeviceRow = {
    ...devices[0]!,
    id: "k1",
    kind: "kds_station",
    label: "Pantalla Cocina",
    deviceProfileId: "pk",
    receiptPrinterId: null,
    paymentSlipPrinterId: null,
    madeHereStationIds: ["s2"],
  };

  function editApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
    return stubApi({
      listDevices: vi.fn().mockResolvedValue([till, kitchen]),
      listDeviceProfiles: vi.fn().mockResolvedValue(editProfiles),
      listPrinters: vi.fn().mockResolvedValue(editPrinters),
      getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r2" }),
      updateDevice: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    });
  }

  const field = (el: DevicesScreen, id: string) => q(el, `[data-test=${id}]`) as Field;
  /** Use default on a profile with no default for the role. */
  const useDefaultNone = () => t("devices.use_default").replace("{name}", t("equipment.none"));

  async function openEdit(api: DashboardApi, id = "t1"): Promise<DevicesScreen> {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);
    dq(el.shadowRoot!, `[data-test=edit-device-${id}]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull());
    await flush(el);
    await flush(el);
    return el;
  }

  function wtChange(el: DevicesScreen, sel: string, value: string): void {
    q(el, sel)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  }

  async function bottom(el: DevicesScreen): Promise<string> {
    const row = q(el, "[data-test=edit-actions]") as HTMLElementTagNameMap["wt-form-actions"];
    return (await formMessageOf(row))?.textContent?.trim() ?? "";
  }

  async function save(el: DevicesScreen): Promise<void> {
    q(el, "[data-test=edit-save]")!.click();
    await flush(el);
  }

  /** Save on a dialog as it opened: drawn quiet, and nothing to press. */
  async function expectSaveQuiet(el: DevicesScreen): Promise<void> {
    const button = q(el, "[data-test=edit-save]") as HTMLElementTagNameMap["wt-button"];
    await button.updateComplete;
    expect([button.variant, button.disabled]).toEqual(["secondary", true]);
  }

  /** One edit, so Save has a change to send. */
  async function rename(el: DevicesScreen, name: string): Promise<void> {
    wtChange(el, "[data-test=edit-name]", name);
    await flush(el);
  }

  // At 1280px wide the standard size is not capped by the window: 42rem (672px).
  it("is the standard width on desktop", async () => {
    await page.viewport(1280, 900);
    const el = await openEdit(editApi());
    const dialog = q(el, "[data-test=edit-device-modal]")!.shadowRoot!.querySelector("dialog")!;
    expect(dialog.getBoundingClientRect().width).toBeCloseTo(672, 0);
  });

  it("pre-fills every field of a till from the device", async () => {
    const api = editApi();
    const el = await openEdit(api);

    const name = field(el, "edit-name");
    expect([name.name, name.required, name.getAttribute("label"), name.value]).toEqual([
      "name",
      true,
      t("devices.name"),
      "Caja 1",
    ]);
    const profile = field(el, "edit-profile");
    expect([profile.name, profile.required, profile.label, profile.value]).toEqual([
      "profileId",
      true,
      t("devices.device_profile"),
      "pa",
    ]);
    // Required: there is no "no profile" choice.
    expect(profile.options).toEqual([
      { value: "pa", label: "Counter till" },
      { value: "pb", label: "Waiter handheld" },
      { value: "pk", label: "Pass screen" },
    ]);
    expect(q(el, "[data-test=edit-screen]")).toBeNull();

    const receipt = field(el, "edit-receipt-printer");
    expect([receipt.name, receipt.label, receipt.value]).toEqual([
      "receiptPrinterId",
      t("devices.receipt_printer_now"),
      "pr3",
    ]);
    // The device keeps the switched-off printer it holds; it cannot newly choose one.
    expect(receipt.options).toEqual([
      { value: "", label: useDefaultNone() },
      { value: "pr3", label: "Barra (Deshabilitada)" },
      { value: "pr1", label: "Cocina" },
      { value: "pr2", label: "Terraza" },
    ]);
    const slip = field(el, "edit-slip-printer");
    expect([slip.name, slip.label, slip.value]).toEqual([
      "paymentSlipPrinterId",
      t("devices.slip_printer_now"),
      "pr2",
    ]);
    expect(slip.options).toEqual([
      { value: "", label: useDefaultNone() },
      { value: "pr2", label: "Terraza" },
    ]);

    const madeHere = q(el, "[data-test=edit-made-here]")!;
    expect(madeHere.querySelector("legend")!.textContent!.trim()).toBe(t("devices.made_here"));
    const boxes = [...madeHere.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => [b.name, b.value, b.checked])).toEqual([
      ["madeHereStationIds", "s1", false],
      ["madeHereStationIds", "s2", true],
    ]);

    expect(api.getDeviceReader).toHaveBeenCalledExactlyOnceWith("t1");
    expect(api.listReaders).toHaveBeenCalledTimes(1);
    const reader = field(el, "edit-reader");
    expect([reader.name, reader.label, reader.value]).toEqual([
      "defaultReaderId",
      t("devices.default_reader"),
      "r2",
    ]);
    // Only active readers, by name and a friendly provider label, after a leading none option.
    expect(reader.options).toEqual([
      { value: "", label: useDefaultNone() },
      { value: "r1", label: "Front counter (Acme Pay)" },
      { value: "r2", label: "Bar (Zeta Pay)" },
    ]);
  });

  it("pre-fills a kitchen display's Screen and its stations, required, and draws no Made here", async () => {
    const api = editApi();
    const el = await openEdit(api, "k1");
    const screen = field(el, "edit-screen");
    expect([screen.name, screen.required, screen.label, screen.value]).toEqual([
      "kitchenScreen",
      true,
      t("devices.kitchen_screen"),
      "station",
    ]);
    expect(screen.options).toEqual([
      { value: "station", label: t("device_profiles.kitchen_screen.station") },
      { value: "pass", label: t("device_profiles.kitchen_screen.pass") },
    ]);
    const switches = [
      ...q(el, "[data-test=edit-screen-stations]")!.querySelectorAll<
        HTMLElement & { checked: boolean }
      >("wt-switch"),
    ].map((s) => [s.dataset.test, s.checked]);
    expect(switches).toEqual([
      ["edit-screen-every-station", false],
      ["edit-screen-station-s1", true],
      ["edit-screen-station-s2", false],
    ]);
    expect(q(el, "[data-test=edit-made-here]")).toBeNull();
  });

  it("shows None as the chosen printer of a device that has none", async () => {
    const el = await openEdit(editApi(), "k1");
    const shown = (id: string) =>
      q(el, `[data-test=${id}]`)!.shadowRoot!.querySelector("button.trigger .value")!;
    for (const id of ["edit-receipt-printer", "edit-slip-printer"]) {
      expect(field(el, id).value).toBe("");
      expect(shown(id).textContent!.trim()).toBe(useDefaultNone());
      expect(shown(id).classList.contains("placeholder")).toBe(false);
    }
  });

  it("shows None as the chosen card reader of a device that has none", async () => {
    const api = editApi({ getDeviceReader: vi.fn().mockResolvedValue({ readerId: null }) });
    const el = await openEdit(api);
    const shown = q(el, "[data-test=edit-reader]")!.shadowRoot!.querySelector(
      "button.trigger .value",
    )!;
    expect(field(el, "edit-reader").value).toBe("");
    expect(shown.textContent!.trim()).toBe(useDefaultNone());
    expect(shown.classList.contains("placeholder")).toBe(false);
  });

  it("changing the profile puts both printers on Use default", async () => {
    const el = await openEdit(editApi());
    await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
    await flush(el);

    const receipt = field(el, "edit-receipt-printer");
    expect(receipt.value).toBe("");
    // On a new profile a switched-off printer cannot be chosen.
    expect(receipt.options.map((o) => o.value)).toEqual(["", "pr2"]);
    const slip = field(el, "edit-slip-printer");
    expect(slip.value).toBe("");
    expect(slip.options.map((o) => o.value)).toEqual([""]);
  });

  describe("a printer the device holds that its profile no longer lists", () => {
    const moved: Printer = { ...printers[0]!, id: "pr4", name: "Salón" };
    // pa lists pr4 nowhere, and pr3 (switched off) only as a receipt printer, which it does not hold.
    const holding: DeviceRow = { ...till, receiptPrinterId: "pr4", paymentSlipPrinterId: "pr3" };
    const holdingApi = () =>
      editApi({
        listDevices: vi.fn().mockResolvedValue([holding]),
        listPrinters: vi.fn().mockResolvedValue([...editPrinters, moved]),
      });

    it("is offered and chosen, marked as not on the profile, in English and Spanish", async () => {
      const before = currentLocale();
      try {
        for (const [locale, receiptLabel, slipLabel] of [
          ["en", "Salón (not on this profile)", "Barra (Disabled) (not on this profile)"],
          [
            "es-ES",
            "Salón (no está en este perfil)",
            "Barra (Deshabilitada) (no está en este perfil)",
          ],
        ] as const) {
          setLocale(locale);
          const el = await openEdit(holdingApi());
          const receipt = field(el, "edit-receipt-printer");
          expect(receipt.value).toBe("pr4");
          expect(receipt.options).toEqual([
            { value: "", label: useDefaultNone() },
            { value: "pr1", label: "Cocina" },
            { value: "pr2", label: "Terraza" },
            { value: "pr4", label: receiptLabel },
          ]);
          const slip = field(el, "edit-slip-printer");
          expect(slip.value).toBe("pr3");
          expect(slip.options).toEqual([
            { value: "", label: useDefaultNone() },
            { value: "pr2", label: "Terraza" },
            { value: "pr3", label: slipLabel },
          ]);
          for (const [id, label] of [
            ["edit-receipt-printer", receiptLabel],
            ["edit-slip-printer", slipLabel],
          ] as const) {
            const shown = q(el, `[data-test=${id}]`)!.shadowRoot!.querySelector(
              "button.trigger .value",
            )!;
            expect(shown.textContent!.trim()).toBe(label);
          }
          cleanupWidgets();
        }
      } finally {
        setLocale(before);
      }
    });

    it("Save keeps both, unchanged", async () => {
      const api = holdingApi();
      const el = await openEdit(api);
      await expectSaveQuiet(el);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
        name: "Caja 2",
        receiptPrinterId: "pr4",
        paymentSlipPrinterId: "pr3",
      });
    });

    it("can be swapped for one the profile lists, and taken back while the profile is unchanged", async () => {
      const api = holdingApi();
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-receipt-printer]")!, "pr1");
      await flush(el);
      expect(field(el, "edit-receipt-printer").options.map((o) => o.value)).toContain("pr4");
      await chooseOption(q(el, "[data-test=edit-receipt-printer]")!, "pr4");
      await flush(el);
      expect(field(el, "edit-receipt-printer").value).toBe("pr4");
    });

    it("is no longer offered once the profile changes", async () => {
      const el = await openEdit(holdingApi());
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
      await flush(el);
      const receipt = field(el, "edit-receipt-printer");
      expect(receipt.value).toBe("");
      expect(receipt.options.map((o) => o.value)).toEqual(["", "pr2"]);
      const slip = field(el, "edit-slip-printer");
      expect(slip.value).toBe("");
      expect(slip.options.map((o) => o.value)).toEqual([""]);
    });

    it("is not offered while the printer list does not hold it, and Save still keeps it", async () => {
      const api = editApi({
        listDevices: vi.fn().mockResolvedValue([holding]),
        listPrinters: vi.fn().mockResolvedValue(editPrinters),
      });
      const el = await openEdit(api);
      const receipt = field(el, "edit-receipt-printer");
      expect(receipt.value).toBe("pr4");
      expect(receipt.options.map((o) => o.value)).toEqual(["", "pr1", "pr2"]);
      await expectSaveQuiet(el);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1].receiptPrinterId).toBe("pr4");
    });
  });

  it("Save sends exactly the edit, then closes and refreshes the list", async () => {
    const api = editApi();
    const el = await openEdit(api);
    wtChange(el, "[data-test=edit-name]", "  Caja 2 ");
    await chooseOption(q(el, "[data-test=edit-receipt-printer]")!, "pr1");
    await chooseOption(q(el, "[data-test=edit-slip-printer]")!, "");
    q(el, '[data-test=edit-made-here] input[value="s1"]')!.click();
    await flush(el);
    await save(el);

    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledExactlyOnceWith("t1", {
      name: "Caja 2",
      profileId: "pa",
      receiptPrinterId: "pr1",
      paymentSlipPrinterId: null,
      madeHereStationIds: ["s1", "s2"],
    });
    // The reader did not change, so its own route is not called.
    expect(api.setDeviceReader).not.toHaveBeenCalled();
    expect(api.listDevices).toHaveBeenCalledTimes(2);
  });

  it("sends a kitchen display's chosen screen, and no made-here stations, which it does not show", async () => {
    const api = editApi();
    const el = await openEdit(api, "k1");
    await chooseOption(q(el, "[data-test=edit-screen]")!, "pass");
    await flush(el);
    await save(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(api.updateDevice).toHaveBeenCalledWith("k1", {
      name: "Pantalla Cocina",
      profileId: "pk",
      kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: null }],
      receiptPrinterId: null,
      paymentSlipPrinterId: null,
    });
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty("madeHereStationIds");
  });

  it("saves a kitchen screen whose stored made-here station was switched off after this screen read its stations", async () => {
    // The server refuses a switched-off made-here station; this screen's list still has it on.
    const api = editApi({
      updateDevice: vi
        .fn()
        .mockImplementation((_id: string, body: Record<string, unknown>) =>
          Array.isArray(body.madeHereStationIds) && body.madeHereStationIds.includes("s2")
            ? Promise.reject({ code: "station.not_found" })
            : Promise.resolve(undefined),
        ),
    });
    const el = await openEdit(api, "k1");
    wtChange(el, "[data-test=edit-name]", "Pantalla 2");
    await flush(el);
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledTimes(1);
  });

  it("omits a switched-off or unlisted stored station from Made here and from what Save sends", async () => {
    const stored: DeviceRow = { ...till, madeHereStationIds: ["s2", "switched-off", "gone"] };
    const grill: Station = { ...stations[0]!, id: "grill", name: "Grill" };
    const off: Station = { ...stations[0]!, id: "switched-off", name: "Old", active: false };
    const api = editApi({
      listDevices: vi.fn().mockResolvedValue([stored]),
      listStations: vi.fn().mockResolvedValue([...stations, off, grill]),
    });
    const el = await openEdit(api);
    const boxes = [
      ...q(el, "[data-test=edit-made-here]")!.querySelectorAll<HTMLInputElement>("input"),
    ];
    expect(boxes.map((b) => b.value)).toEqual(["s1", "s2", "grill"]);
    q(el, '[data-test=edit-made-here] input[value="grill"]')!.click();
    await flush(el);
    await save(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1].madeHereStationIds).toEqual([
      "s2",
      "grill",
    ]);
  });

  it.each([
    { pick: "r1", sent: "r1" },
    { pick: "", sent: null },
  ])("saves a changed reader ($pick) second, through its own route", async ({ pick, sent }) => {
    const api = editApi();
    const el = await openEdit(api);
    await chooseOption(q(el, "[data-test=edit-reader]")!, pick);
    await flush(el);
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.setDeviceReader).toHaveBeenCalledExactlyOnceWith("t1", sent);
    expect(vi.mocked(api.updateDevice).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.setDeviceReader).mock.invocationCallOrder[0]!,
    );
  });

  it("a failed reader save keeps the dialog open with its error under the reader, the device's changes saved", async () => {
    const api = editApi({
      setDeviceReader: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    const el = await openEdit(api);
    wtChange(el, "[data-test=edit-name]", "Caja 2");
    await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
    await flush(el);
    await save(el);

    await vi.waitFor(() =>
      expect(field(el, "edit-reader").error).toBe(codeMessage("reader.not_found")),
    );
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    expect(api.updateDevice).toHaveBeenCalledTimes(1);
    expect(field(el, "edit-name").error).toBe("");
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    expect((q(el, "[data-test=edit-save]") as Button).disabled).toBe(false);
    // The device's changes were written, so the list is read again.
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    await chooseOption(q(el, "[data-test=edit-reader]")!, "r2");
    await flush(el);
    expect(field(el, "edit-reader").error).toBe("");
  });

  it("not told up front, a reader read the server refuses for want of payments.manage drops the reader field, and nothing else is refused", async () => {
    const notPermitted = { code: "authorization.not_permitted" };
    const api = editApi({
      getDeviceReader: vi.fn().mockRejectedValue(notPermitted),
      listReaders: vi.fn().mockRejectedValue(notPermitted),
    });
    const el = await openEdit(api);
    expect(q(el, "[data-test=edit-reader]")).toBeNull();
    expect(await bottom(el)).toBe("");
    expect(q(el, "[data-test=page-error]")).toBeNull();
    await rename(el, "Caja 2");
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.setDeviceReader).not.toHaveBeenCalled();
  });

  it("told the session cannot manage card readers, never draws the reader field nor asks about readers", async () => {
    const api = editApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
      canManageReaders: false,
    });
    await flush(el);
    dq(el.shadowRoot!, "[data-test=edit-device-t1]")!.click();
    await el.updateComplete;
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    expect(q(el, "[data-test=edit-reader]")).toBeNull();
    await flush(el);
    await flush(el);
    expect(q(el, "[data-test=edit-reader]")).toBeNull();
    expect(api.getDeviceReader).not.toHaveBeenCalled();
    expect(api.listReaders).not.toHaveBeenCalled();
    await rename(el, "Caja 2");
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledTimes(1);
    expect(api.setDeviceReader).not.toHaveBeenCalled();
  });

  it("told the session can manage card readers, draws the reader field disabled while it loads, then ready", async () => {
    let answer!: (value: { readerId: string | null }) => void;
    const api = editApi({
      getDeviceReader: vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
      canManageReaders: true,
    });
    await flush(el);
    dq(el.shadowRoot!, "[data-test=edit-device-t1]")!.click();
    await flush(el);
    expect(field(el, "edit-reader").disabled).toBe(true);
    expect(api.getDeviceReader).toHaveBeenCalledExactlyOnceWith("t1");
    answer({ readerId: "r2" });
    await flush(el);
    expect(field(el, "edit-reader").disabled).toBe(false);
    expect(field(el, "edit-reader").value).toBe("r2");
  });

  it("losing payments.manage while Edit is open removes the reader field and Save leaves the reader alone", async () => {
    const api = editApi();
    const el = await openEdit(api);
    await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
    await flush(el);
    el.canManageReaders = false;
    await flush(el);
    expect(q(el, "[data-test=edit-reader]")).toBeNull();
    // The reader change went with the field, so Save waits for another edit.
    await expectSaveQuiet(el);
    await rename(el, "Caja 2");
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledTimes(1);
    expect(api.setDeviceReader).not.toHaveBeenCalled();
  });

  it("a reader read still pending when payments.manage is lost does not bring the field back", async () => {
    let answer!: (value: { readerId: string | null }) => void;
    const api = editApi({
      getDeviceReader: vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))),
    });
    const el = await openEdit(api);
    expect(field(el, "edit-reader").disabled).toBe(true);
    el.canManageReaders = false;
    await flush(el);
    answer({ readerId: "r2" });
    await flush(el);
    expect(q(el, "[data-test=edit-reader]")).toBeNull();
  });

  it("regaining payments.manage while Edit is open does not draw the reader until Edit is opened again", async () => {
    let answer!: (value: { readerId: string | null }) => void;
    const api = editApi({
      getDeviceReader: vi
        .fn()
        .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
        .mockResolvedValue({ readerId: "r1" }),
    });
    const el = await openEdit(api);
    el.canManageReaders = false;
    await flush(el);
    el.canManageReaders = true;
    await flush(el);
    answer({ readerId: "r2" });
    await flush(el);
    expect(q(el, "[data-test=edit-reader]")).toBeNull();
    expect(api.getDeviceReader).toHaveBeenCalledTimes(1);

    q(el, "[data-test=edit-cancel]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    dq(el.shadowRoot!, "[data-test=edit-device-t1]")!.click();
    await vi.waitFor(() => expect(field(el, "edit-reader")?.disabled).toBe(false));
    expect(api.getDeviceReader).toHaveBeenCalledTimes(2);
    expect(field(el, "edit-reader").value).toBe("r1");
  });

  it("losing payments.manage clears a reader read's failure from the bottom of Edit", async () => {
    const api = editApi({
      getDeviceReader: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await openEdit(api);
    expect(await bottom(el)).toBe(codeMessage("connection.failed"));
    el.canManageReaders = false;
    await flush(el);
    expect(await bottom(el)).toBe("");
  });

  it("losing payments.manage clears a refused reader save, and Save then closes Edit", async () => {
    const api = editApi({
      setDeviceReader: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
    });
    const el = await openEdit(api);
    await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
    await flush(el);
    await save(el);
    await vi.waitFor(() =>
      expect(field(el, "edit-reader").error).toBe(codeMessage("reader.not_found")),
    );
    el.canManageReaders = false;
    await flush(el);
    expect(await bottom(el)).toBe("");
    await rename(el, "Caja 2");
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledTimes(2);
    expect(api.setDeviceReader).toHaveBeenCalledTimes(1);
  });

  it("preselects no reader when the device has none", async () => {
    const el = await openEdit(
      editApi({ getDeviceReader: vi.fn().mockResolvedValue({ readerId: null }) }),
    );
    expect(field(el, "edit-reader").value).toBe("");
    expect(field(el, "edit-reader").disabled).toBe(false);
  });

  it("a reader that cannot be read is left alone: the field is disabled and the reason is at the bottom", async () => {
    const api = editApi({
      getDeviceReader: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await openEdit(api);
    expect(field(el, "edit-reader").disabled).toBe(true);
    expect(field(el, "edit-reader").error).toBe("");
    expect(await bottom(el)).toBe(codeMessage("connection.failed"));
    await rename(el, "Caja 2");
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    expect(api.updateDevice).toHaveBeenCalledTimes(1);
    expect(api.setDeviceReader).not.toHaveBeenCalled();
  });

  it("a blank name holds Save until it is filled", async () => {
    const api = editApi();
    const el = await openEdit(api);
    wtChange(el, "[data-test=edit-name]", "   ");
    await flush(el);
    await save(el);

    expect(api.updateDevice).not.toHaveBeenCalled();
    expect(field(el, "edit-name").error).toBe(t("form.name_required"));
    expect((q(el, "[data-test=edit-save]") as Button).disabled).toBe(true);
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    wtChange(el, "[data-test=edit-name]", "Caja 3");
    await flush(el);
    expect((q(el, "[data-test=edit-save]") as Button).disabled).toBe(false);
    expect(await bottom(el)).toBe("");
  });

  it("a kitchen profile asks for what it shows before saving", async () => {
    const api = editApi();
    const el = await openEdit(api);
    await chooseOption(q(el, "[data-test=edit-profile]")!, "pk");
    await flush(el);
    expect(q(el, "[data-test=edit-made-here]")).toBeNull();
    await save(el);
    expect(api.updateDevice).not.toHaveBeenCalled();
    expect(field(el, "edit-screen").error).toBe(codeMessage("kitchen_screen.required"));
  });

  it("a name clash shows under Name, and editing the name clears it", async () => {
    const api = editApi({
      updateDevice: vi.fn().mockRejectedValue({ code: "device.name_taken" }),
    });
    const el = await openEdit(api);
    await rename(el, "Barra 1");
    await save(el);

    await vi.waitFor(() =>
      expect(field(el, "edit-name").error).toBe(codeMessage("device.name_taken")),
    );
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    // A refusal never disables the action by itself.
    expect((q(el, "[data-test=edit-save]") as Button).disabled).toBe(false);
    expect(api.setDeviceReader).not.toHaveBeenCalled();
    wtChange(el, "[data-test=edit-name]", "Caja 9");
    await flush(el);
    expect(field(el, "edit-name").error).toBe("");
  });

  it.each([
    { param: "receiptPrinterId", under: "edit-receipt-printer", other: "edit-slip-printer" },
    { param: "paymentSlipPrinterId", under: "edit-slip-printer", other: "edit-receipt-printer" },
  ])(
    "a printer refusal naming $param shows under that printer",
    async ({ param, under, other }) => {
      const api = editApi({
        updateDevice: vi
          .fn()
          .mockRejectedValue({ code: "device.binding_invalid", params: { field: param } }),
      });
      const el = await openEdit(api);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() =>
        expect(field(el, under).error).toBe(codeMessage("device.binding_invalid")),
      );
      expect(field(el, other).error).toBe("");
      expect(await bottom(el)).toBe(t("form.fix_fields"));
    },
  );

  it.each([
    { code: "device_profile.not_found", params: {}, under: "edit-profile" },
    { code: "kitchen_screen.required", params: {}, under: "edit-screen" },
    {
      code: "management.request_invalid",
      params: { field: "profileId" },
      under: "edit-profile",
    },
  ])("a $code refusal shows under the field it is about", async ({ code, params, under }) => {
    const api = editApi({ updateDevice: vi.fn().mockRejectedValue({ code, params }) });
    const el = await openEdit(api, "k1");
    await rename(el, "Pantalla 2");
    await save(el);
    await vi.waitFor(() => expect(field(el, under).error).toBe(codeMessage(code)));
    expect(field(el, "edit-name").error).toBe("");
    expect(await bottom(el)).toBe(t("form.fix_fields"));
  });

  it.each([
    {
      name: "an unknown device",
      device: "t1",
      error: { code: "device.not_found", params: { deviceId: "t1" } },
    },
    {
      name: "a made-here station",
      device: "k1",
      error: { code: "station.not_found", params: { stationId: "s2" } },
    },
    { name: "a failed connection", device: "t1", error: { code: "connection.failed" } },
  ])("a refusal about $name goes at the bottom", async ({ device, error }) => {
    const api = editApi({ updateDevice: vi.fn().mockRejectedValue(error) });
    const el = await openEdit(api, device);
    await rename(el, "Renamed");
    await save(el);
    await vi.waitFor(async () => expect(await bottom(el)).toBe(codeMessage(error.code)));
    expect(field(el, "edit-name").error).toBe("");
    expect(field(el, "edit-profile").error).toBe("");
    expect((q(el, "[data-test=edit-screen]") as Field | null)?.error ?? "").toBe("");
    expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
  });

  describe("the profiles staff may switch to", () => {
    const tills: DeviceProfile[] = [
      ...editProfiles,
      { ...editProfiles[0]!, id: "pc", name: "Bar till" },
      { ...editProfiles[0]!, id: "pd", name: "Deli till" },
      { ...editProfiles[2]!, id: "pl", name: "Grill screen" },
    ];
    const approvedTill: DeviceRow = { ...till, approvedProfileIds: ["pa", "pc"] };

    function approvalApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
      return editApi({
        listDevices: vi.fn().mockResolvedValue([approvedTill, kitchen]),
        listDeviceProfiles: vi.fn().mockResolvedValue(tills),
        ...overrides,
      });
    }

    const boxes = (el: DevicesScreen) => [
      ...(q(el, "[data-test=edit-approved-profiles]")?.querySelectorAll<HTMLInputElement>(
        "input",
      ) ?? []),
    ];

    it("offers the other profiles of the device's form factor, ticking those approved", async () => {
      const el = await openEdit(approvalApi());
      expect(boxes(el).map((box) => [box.value, box.checked, box.name])).toEqual([
        ["pc", true, "approvedProfileIds"],
        ["pd", false, "approvedProfileIds"],
      ]);
    });

    it("a kitchen screen is offered only kitchen screen profiles", async () => {
      const el = await openEdit(approvalApi(), "k1");
      expect(boxes(el).map((box) => box.value)).toEqual(["pl"]);
    });

    it("Save leaves the approvals out while they and the profile are unchanged", async () => {
      const api = approvalApi();
      const el = await openEdit(api);
      await expectSaveQuiet(el);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty(
        "approvedProfileIds",
      );
    });

    it("Save sends the ticked profiles once they change", async () => {
      const api = approvalApi();
      const el = await openEdit(api);
      q(el, '[data-test=edit-approved-profiles] input[value="pd"]')!.click();
      q(el, '[data-test=edit-approved-profiles] input[value="pc"]')!.click();
      await flush(el);
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1].approvedProfileIds).toEqual(["pd"]);
    });

    it("choosing another profile keeps the replaced one ticked and stops offering the new one", async () => {
      const api = approvalApi();
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pd");
      await flush(el);
      expect(boxes(el).map((box) => [box.value, box.checked])).toEqual([
        ["pa", true],
        ["pc", true],
      ]);
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      // The server keeps the replaced profile approved without being told.
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({ profileId: "pd" });
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty(
        "approvedProfileIds",
      );
    });

    it("unticking the replaced profile sends the approvals without it", async () => {
      const api = approvalApi();
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pd");
      await flush(el);
      q(el, '[data-test=edit-approved-profiles] input[value="pa"]')!.click();
      await flush(el);
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
        profileId: "pd",
        approvedProfileIds: ["pc"],
      });
    });

    it("an incompatible profile refusal shows under the approvals, and a change clears it", async () => {
      const api = approvalApi({
        updateDevice: vi.fn().mockRejectedValue({
          code: "device_profile.incompatible",
          params: { field: "approvedProfileIds" },
        }),
      });
      const el = await openEdit(api);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() =>
        expect(text(el, "[data-test=edit-approved-error]")).toBe(
          codeMessage("device_profile.incompatible"),
        ),
      );
      expect(await bottom(el)).toBe(t("form.fix_fields"));
      q(el, '[data-test=edit-approved-profiles] input[value="pd"]')!.click();
      await flush(el);
      expect(q(el, "[data-test=edit-approved-error]")).toBeNull();
    });

    it("an approved profile that no longer exists shows under the approvals, not the profile", async () => {
      const api = approvalApi({
        updateDevice: vi.fn().mockRejectedValue({
          code: "device_profile.not_found",
          params: { field: "approvedProfileIds" },
        }),
      });
      const el = await openEdit(api);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() =>
        expect(text(el, "[data-test=edit-approved-error]")).toBe(
          codeMessage("device_profile.not_found"),
        ),
      );
      expect(q(el, "[data-test=edit-profile]")!.getAttribute("aria-invalid")).not.toBe("true");
      expect((q(el, "[data-test=edit-profile]") as unknown as { error: string }).error).toBe("");
      expect(await bottom(el)).toBe(t("form.fix_fields"));
    });

    it("a payment in progress is said at the bottom", async () => {
      const api = approvalApi({
        updateDevice: vi.fn().mockRejectedValue({ code: "device.payment_in_progress" }),
      });
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pd");
      await flush(el);
      await save(el);
      await vi.waitFor(async () =>
        expect(await bottom(el)).toBe(codeMessage("device.payment_in_progress")),
      );
      expect(codeMessage("device.payment_in_progress")).not.toBe(codeMessage("totally.unknown"));
      expect(codeMessage("device_profile.incompatible")).not.toBe(codeMessage("totally.unknown"));
    });
  });

  it("a saved edit whose refresh fails closes the dialog and says the list could not be read", async () => {
    const api = editApi();
    const el = await openEdit(api);
    vi.mocked(api.listDevices).mockRejectedValue({ code: "connection.failed" });
    await rename(el, "Caja 2");
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    await vi.waitFor(() =>
      expect(text(el, "[data-test=page-error]")).toBe(codeMessage("connection.failed")),
    );
    expect(api.updateDevice).toHaveBeenCalledTimes(1);
  });

  describe("while a request is unanswered", () => {
    function deferred<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (error: unknown) => void;
    } {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    async function cancelEdit(el: DevicesScreen): Promise<void> {
      q(el, "[data-test=edit-cancel]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    }

    async function reopen(el: DevicesScreen, id: string): Promise<void> {
      dq(el.shadowRoot!, `[data-test=edit-device-${id}]`)!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull());
      await flush(el);
      await flush(el);
    }

    /** Leaving the screen is the one way out of a dialog whose save is unanswered. */
    async function leaveAndComeBack(el: DevicesScreen): Promise<void> {
      const host = el.parentElement!;
      el.remove();
      host.appendChild(el);
      await flush(el);
      await flush(el);
    }

    it.each([
      {
        name: "answers",
        settle: (d: ReturnType<typeof deferred>) => d.resolve({ readerId: "r1" }),
      },
      {
        name: "is refused",
        settle: (d: ReturnType<typeof deferred>) =>
          d.reject({ code: "authorization.not_permitted" }),
      },
    ])(
      "a cancelled dialog's reader read that $name late leaves the next device's dialog alone",
      async ({ settle }) => {
        const first = deferred<{ readerId: string | null }>();
        const api = editApi({
          getDeviceReader: vi
            .fn()
            .mockImplementation((id: string) =>
              id === "t1" ? first.promise : Promise.resolve({ readerId: "r2" }),
            ),
        });
        const el = await openEdit(api, "t1");
        await cancelEdit(el);
        await reopen(el, "k1");
        expect(field(el, "edit-reader").value).toBe("r2");

        settle(first as ReturnType<typeof deferred>);
        await flush(el);
        await flush(el);
        expect(q(el, "[data-test=edit-device-modal]")!.getAttribute("heading")).toBe(
          t("devices.edit_title").replace("{name}", "Pantalla Cocina"),
        );
        expect(field(el, "edit-reader").value).toBe("r2");
        // Unchanged, so Save does not write the reader.
        await expectSaveQuiet(el);
        await rename(el, "Pantalla 2");
        await save(el);
        await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
        expect(api.setDeviceReader).not.toHaveBeenCalled();
      },
    );

    it.each([
      { name: "is saved", settle: (d: ReturnType<typeof deferred>) => d.resolve(undefined) },
      {
        name: "is refused",
        settle: (d: ReturnType<typeof deferred>) => d.reject({ code: "device.name_taken" }),
      },
    ])(
      "an edit left unanswered when the screen was left, then $name, changes nothing in the next dialog",
      async ({ settle }) => {
        const pending = deferred<undefined>();
        const api = editApi({
          updateDevice: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined),
        });
        const el = await openEdit(api, "t1");
        await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
        await save(el);
        await leaveAndComeBack(el);
        await reopen(el, "k1");

        settle(pending as ReturnType<typeof deferred>);
        await flush(el);
        await closeReportsDelivered();
        await flush(el);
        expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
        expect(await bottom(el)).toBe("");
        expect(field(el, "edit-name").error).toBe("");
        expect(api.setDeviceReader).not.toHaveBeenCalled();
      },
    );

    it.each([
      { name: "is saved", settle: (d: ReturnType<typeof deferred>) => d.resolve(undefined) },
      {
        name: "is refused",
        settle: (d: ReturnType<typeof deferred>) => d.reject({ code: "reader.not_found" }),
      },
    ])(
      "a reader save left unanswered when the screen was left, then $name, changes nothing in the next dialog",
      async ({ settle }) => {
        const pending = deferred<undefined>();
        const api = editApi({ setDeviceReader: vi.fn().mockReturnValueOnce(pending.promise) });
        const el = await openEdit(api, "t1");
        await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
        await save(el);
        await vi.waitFor(() => expect(api.setDeviceReader).toHaveBeenCalledTimes(1));
        await leaveAndComeBack(el);
        await reopen(el, "k1");

        settle(pending as ReturnType<typeof deferred>);
        await flush(el);
        await closeReportsDelivered();
        await flush(el);
        expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
        expect(field(el, "edit-reader").error).toBe("");
        expect(await bottom(el)).toBe("");
      },
    );

    it("sends one request however often Save is pressed while it is unanswered", async () => {
      const pending = deferred<undefined>();
      const api = editApi({ updateDevice: vi.fn().mockReturnValue(pending.promise) });
      const el = await openEdit(api);
      await rename(el, "Caja 2");
      await save(el);
      await save(el);
      q(el, "[data-test=edit-name]")!.focus();
      await userEvent.keyboard("{Enter}");
      await flush(el);
      expect(api.updateDevice).toHaveBeenCalledTimes(1);
      pending.resolve(undefined);
      await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    });

    /** Whether each control of the dialog that takes a value is disabled, read from its native control. */
    function editControlsDisabled(el: DevicesScreen): Record<string, boolean> {
      const native = (id: string): boolean | undefined =>
        q(el, `[data-test=${id}]`)?.shadowRoot!.querySelector<HTMLInputElement | HTMLButtonElement>(
          "input.field-control, button.trigger",
        )!.disabled;
      const shown: Record<string, boolean | undefined> = {
        name: native("edit-name"),
        profile: native("edit-profile"),
        screen: native("edit-screen"),
        receipt: native("edit-receipt-printer"),
        slip: native("edit-slip-printer"),
        reader: native("edit-reader"),
      };
      for (const toggle of el.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
        "[data-test=edit-screen-stations] wt-switch",
      ))
        shown[toggle.dataset.test!] = toggle.disabled;
      for (const box of q(el, "[data-test=edit-made-here]")?.querySelectorAll<HTMLInputElement>(
        "input",
      ) ?? [])
        shown[`madeHere:${box.value}`] = box.disabled;
      return Object.fromEntries(
        Object.entries(shown).filter((entry): entry is [string, boolean] => entry[1] !== undefined),
      );
    }

    const all = (controls: Record<string, boolean>, disabled: boolean) =>
      Object.fromEntries(Object.keys(controls).map((key) => [key, disabled]));

    it.each([
      {
        device: "t1",
        shown: ["name", "profile", "receipt", "slip", "reader", "madeHere:s1", "madeHere:s2"],
      },
      { device: "k1", shown: ["name", "profile", "screen", "receipt", "slip", "reader"] },
    ])(
      "takes no new value in any field of $device while its save is unanswered",
      async ({ device, shown }) => {
        const pending = deferred<undefined>();
        const api = editApi({ updateDevice: vi.fn().mockReturnValue(pending.promise) });
        const el = await openEdit(api, device);
        const before = editControlsDisabled(el);
        expect(Object.keys(before)).toEqual(expect.arrayContaining(shown));
        expect(before).toEqual(all(before, false));

        await rename(el, "Renamed");
        await save(el);
        expect(api.updateDevice).toHaveBeenCalledTimes(1);
        expect(editControlsDisabled(el)).toEqual(all(before, true));

        pending.resolve(undefined);
        await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
      },
    );

    it("takes no other reader, nor any other value, while the reader's save is unanswered", async () => {
      const pending = deferred<undefined>();
      const api = editApi({ setDeviceReader: vi.fn().mockReturnValue(pending.promise) });
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
      await save(el);
      await vi.waitFor(() => expect(api.setDeviceReader).toHaveBeenCalledTimes(1));
      await flush(el);
      const during = editControlsDisabled(el);
      expect(during.reader).toBe(true);
      expect(during).toEqual(all(during, true));

      pending.resolve(undefined);
      await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
      expect(api.setDeviceReader).toHaveBeenCalledExactlyOnceWith("t1", "r1");
    });

    it("a reader save refused after payments.manage was lost closes Edit as a saved edit", async () => {
      const pending = deferred<undefined>();
      const api = editApi({ setDeviceReader: vi.fn().mockReturnValue(pending.promise) });
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
      await save(el);
      await vi.waitFor(() => expect(api.setDeviceReader).toHaveBeenCalledTimes(1));
      el.canManageReaders = false;
      await flush(el);

      pending.reject({ code: "authorization.not_permitted" });
      await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
      expect(api.updateDevice).toHaveBeenCalledTimes(1);
      expect(q(el, "[data-test=page-error]")).toBeNull();
    });

    it.each([
      {
        name: "the device's save is refused",
        overrides: () => ({
          updateDevice: vi.fn().mockRejectedValue({ code: "device.name_taken" }),
        }),
      },
      {
        name: "the reader's save fails",
        overrides: () => ({
          setDeviceReader: vi.fn().mockRejectedValue({ code: "reader.not_found" }),
        }),
      },
    ])("every field takes a value again once $name", async ({ overrides }) => {
      const api = editApi(overrides());
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
      await save(el);
      await vi.waitFor(async () => expect(await bottom(el)).toBe(t("form.fix_fields")));
      expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
      const after = editControlsDisabled(el);
      expect(Object.keys(after)).toHaveLength(7);
      expect(after).toEqual(all(after, false));
    });

    it("neither Escape nor Cancel closes the dialog while a save is unanswered", async () => {
      const pending = deferred<undefined>();
      const api = editApi({ updateDevice: vi.fn().mockReturnValue(pending.promise) });
      const el = await openEdit(api);
      await rename(el, "Caja 2");
      await save(el);

      expect((q(el, "[data-test=edit-cancel]") as Button).disabled).toBe(true);
      const dialog = q(el, "[data-test=edit-device-modal]")!.shadowRoot!.querySelector("dialog")!;
      dialog.focus();
      await userEvent.keyboard("{Escape}");
      await flush(el);
      expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
      expect(dialog.open).toBe(true);

      pending.resolve(undefined);
      await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    });
  });

  it("after a saved edit whose reader save failed, the dialog holds what was saved", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      editApi({
        setDeviceReader: vi
          .fn()
          .mockRejectedValueOnce({ code: "reader.not_found" })
          .mockResolvedValue(undefined),
      }),
      { liveData },
    );
    const el = await openEdit(api);
    wtChange(el, "[data-test=edit-name]", "Caja 2");
    await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
    await chooseOption(q(el, "[data-test=edit-receipt-printer]")!, "pr2");
    await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
    await flush(el);
    await save(el);
    await vi.waitFor(() =>
      expect(field(el, "edit-reader").error).toBe(codeMessage("reader.not_found")),
    );
    expect(q(el, "[data-test=edit-device-modal]")!.getAttribute("heading")).toBe(
      t("devices.edit_title").replace("{name}", "Caja 2"),
    );

    // The printer it now holds is switched off: as the saved profile's held printer it stays offered.
    vi.mocked(api.listPrinters).mockResolvedValue([
      editPrinters[0]!,
      { ...editPrinters[1]!, active: false },
      editPrinters[2]!,
    ]);
    liveData.refresh();
    await vi.waitFor(() =>
      expect(field(el, "edit-receipt-printer").options).toContainEqual({
        value: "pr2",
        label: "Terraza (Deshabilitada)",
      }),
    );
    await save(el);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    const sent = vi.mocked(api.updateDevice).mock.calls.map(([, input]) => input);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[1]).toMatchObject({ name: "Caja 2", profileId: "pb", receiptPrinterId: "pr2" });
  });

  it("closing Edit opened from a row's menu puts focus back on that menu", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: editApi(),
      panels: PANELS,
    });
    await flush(el);
    const table = devicesTable(el);
    const menu = table.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('tr[data-row-key="t1"] dashboard-row-actions')!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
    await menu.updateComplete;
    await userEvent.click(menu.querySelector<HTMLElement>("[data-test=edit-device-t1]")!);
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull());
    await flush(el);
    q(el, "[data-test=edit-cancel]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(table.shadowRoot!.activeElement).toBe(menu);
  });

  describe("equipment: Use default, held and busy items, the drawer", () => {
    const portableTerraza: Printer = {
      ...editPrinters[1]!,
      portable: true,
      holder: { deviceId: "d7", deviceName: "Móvil 2", personName: "Ana" },
    };
    const withDefaults: DeviceProfile = {
      ...editProfiles[0]!,
      receiptPrinterDefaultId: "pr1",
      paymentSlipPrinterDefaultId: "pr2",
      cashDrawerPrinterIds: ["pr1"],
    };
    const onDefault: DeviceRow = { ...till, receiptPrinterId: null, paymentSlipPrinterId: null };
    const useDefault = (name: string) => t("devices.use_default").replace("{name}", name);

    function equipmentApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
      return editApi({
        listDevices: vi.fn().mockResolvedValue([onDefault, kitchen]),
        listDeviceProfiles: vi.fn().mockResolvedValue([withDefaults, ...editProfiles.slice(1)]),
        listPrinters: vi
          .fn()
          .mockResolvedValue([editPrinters[0], portableTerraza, editPrinters[2]]),
        ...overrides,
      });
    }

    it("a device on Use default shows the profile default it resolves to, and None", async () => {
      const el = await openEdit(equipmentApi());
      const receipt = field(el, "edit-receipt-printer");
      expect(receipt.value).toBe("");
      expect(receipt.options[0]).toEqual({ value: "", label: useDefault("Cocina") });
      // The slip default is carried by another device, so Use default prints no slip here.
      expect(field(el, "edit-slip-printer").options[0]).toEqual({
        value: "",
        label: useDefault(t("equipment.none")),
      });
      const drawer = field(el, "edit-cash-drawer");
      expect([drawer.name, drawer.label, drawer.value]).toEqual([
        "cashDrawerPrinterId",
        t("devices.cash_drawer_now"),
        "",
      ]);
      expect(drawer.options).toEqual([
        { value: "", label: useDefault(t("equipment.none")) },
        { value: "pr1", label: "Cocina" },
      ]);
    });

    it("changing the profile puts each choice on Use default", async () => {
      const chosen: DeviceRow = { ...till, cashDrawerPrinterId: "pr1" };
      const api = equipmentApi({
        listDevices: vi.fn().mockResolvedValue([chosen]),
        getDeviceReader: vi.fn().mockResolvedValue({ readerId: "r2" }),
      });
      const el = await openEdit(api);
      expect(field(el, "edit-receipt-printer").value).toBe("pr3");
      expect(field(el, "edit-cash-drawer").value).toBe("pr1");
      expect(field(el, "edit-reader").value).toBe("r2");
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
      await flush(el);
      for (const id of [
        "edit-receipt-printer",
        "edit-slip-printer",
        "edit-cash-drawer",
        "edit-reader",
      ])
        expect(field(el, id).value).toBe("");
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
        profileId: "pb",
        receiptPrinterId: null,
        paymentSlipPrinterId: null,
        cashDrawerPrinterId: null,
      });
      await vi.waitFor(() => expect(api.setDeviceReader).toHaveBeenCalledWith("t1", null));
    });

    it("a held printer is labelled with its holder, and a refusal shows under its field naming the holder device", async () => {
      const api = equipmentApi({
        updateDevice: vi.fn().mockRejectedValue({
          code: "device.equipment_held",
          params: {
            field: "receiptPrinterId",
            holderDeviceId: "d7",
            holderDeviceName: "Móvil 2",
            holderPersonName: "Ana",
          },
        }),
      });
      const el = await openEdit(api);
      const receipt = field(el, "edit-receipt-printer");
      expect(receipt.options.find((option) => option.value === "pr2")).toEqual({
        value: "pr2",
        label: `Terraza (${t("equipment.carried_by").replace("{device}", "Móvil 2")})`,
      });
      await chooseOption(q(el, "[data-test=edit-receipt-printer]")!, "pr2");
      await flush(el);
      await save(el);
      await vi.waitFor(() =>
        expect(field(el, "edit-receipt-printer").error).toBe(
          t("devices.err_equipment_held").replace("{device}", "Móvil 2"),
        ),
      );
      expect(field(el, "edit-slip-printer").error).toBe("");
      expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    });

    it("a printer the device itself carries is not labelled as carried", async () => {
      const mine: Printer = {
        ...portableTerraza,
        holder: { deviceId: "t1", deviceName: "Caja 1", personName: null },
      };
      const el = await openEdit(
        equipmentApi({
          listPrinters: vi.fn().mockResolvedValue([editPrinters[0], mine, editPrinters[2]]),
        }),
      );
      expect(field(el, "edit-slip-printer").options).toEqual([
        { value: "", label: useDefault("Terraza") },
        { value: "pr2", label: "Terraza" },
      ]);
    });

    it("offers the profile's card readers, a busy one labelled busy and a held one with its holder", async () => {
      const el = await openEdit(
        equipmentApi({
          getProfileReaders: vi
            .fn()
            .mockResolvedValue({ readerIds: ["r2", "r1"], defaultReaderId: "r2" }),
          listReaderHolders: vi.fn().mockResolvedValue([
            { readerId: "r1", holder: null, paymentInProgressDeviceIds: ["d9"] },
            {
              readerId: "r2",
              holder: { deviceId: "d7", deviceName: "Móvil 2", personName: null },
              paymentInProgressDeviceIds: [],
            },
          ]),
        }),
      );
      expect(field(el, "edit-reader").options).toEqual([
        { value: "", label: useDefault(t("equipment.none")) },
        {
          value: "r2",
          label: `Bar (Zeta Pay) (${t("equipment.carried_by").replace("{device}", "Móvil 2")})`,
        },
        { value: "r1", label: `Front counter (Acme Pay) (${t("equipment.busy")})` },
      ]);
    });

    it("a reader refusal shows under the reader in its own words", async () => {
      const api = equipmentApi({
        setDeviceReader: vi.fn().mockRejectedValue({
          code: "reader.payment_in_progress",
          params: { readerId: "r1" },
        }),
      });
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
      await flush(el);
      await save(el);
      await vi.waitFor(() =>
        expect(field(el, "edit-reader").error).toBe(t("devices.err_reader_busy")),
      );
    });

    it("saves cashDrawerPrinterId", async () => {
      const api = equipmentApi();
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-cash-drawer]")!, "pr1");
      await flush(el);
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
        cashDrawerPrinterId: "pr1",
      });
    });

    it("sends no drawer choice a save leaves alone", async () => {
      const api = equipmentApi();
      const el = await openEdit(api);
      await expectSaveQuiet(el);
      await rename(el, "Caja 2");
      await save(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty(
        "cashDrawerPrinterId",
      );
    });

    it("a reader the device's profile does not allow is refused under the reader as not allowed", async () => {
      const api = equipmentApi({
        setDeviceReader: vi.fn().mockRejectedValue({
          code: "device.binding_invalid",
          params: { field: "cardReaderId" },
        }),
      });
      const el = await openEdit(api);
      await chooseOption(q(el, "[data-test=edit-reader]")!, "r1");
      await flush(el);
      await save(el);
      await vi.waitFor(() =>
        expect(field(el, "edit-reader").error).toBe(t("devices.err_reader_not_allowed")),
      );
      expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull();
    });

    it("a till with no profile offers only Use default, then the readers of the profile chosen for it", async () => {
      const unprofiled: DeviceRow = { ...onDefault, deviceProfileId: null };
      const api = equipmentApi({
        listDevices: vi.fn().mockResolvedValue([unprofiled]),
        getDeviceReader: vi.fn().mockResolvedValue({ readerId: null }),
        getProfileReaders: vi.fn().mockResolvedValue({ readerIds: ["r2"], defaultReaderId: "r2" }),
      });
      const el = await openEdit(api);
      for (const id of [
        "edit-receipt-printer",
        "edit-slip-printer",
        "edit-cash-drawer",
        "edit-reader",
      ])
        expect(field(el, id).options).toEqual([
          { value: "", label: useDefault(t("equipment.none")) },
        ]);
      expect(api.getProfileReaders).not.toHaveBeenCalled();

      await chooseOption(q(el, "[data-test=edit-profile]")!, "pa");
      await vi.waitFor(() =>
        expect(field(el, "edit-reader").options).toEqual([
          { value: "", label: useDefault("Bar (Zeta Pay)") },
          { value: "r2", label: "Bar (Zeta Pay)" },
        ]),
      );
      expect(api.getProfileReaders).toHaveBeenCalledExactlyOnceWith("pa");
    });

    function deferred<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (error: unknown) => void;
    } {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("a profile changed and changed back while the reader loads leaves the reader on Use default, reading that profile's readers once", async () => {
      const stored = deferred<{ readerId: string | null }>();
      const api = equipmentApi({
        getDeviceReader: vi.fn().mockReturnValue(stored.promise),
        getProfileReaders: vi
          .fn()
          .mockResolvedValue({ readerIds: ["r1", "r2"], defaultReaderId: null }),
      });
      const el = await openEdit(api);
      expect(field(el, "edit-reader").disabled).toBe(true);
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
      await flush(el);
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pa");
      await flush(el);

      stored.resolve({ readerId: "r2" });
      await vi.waitFor(() => expect(field(el, "edit-reader").disabled).toBe(false));
      expect(field(el, "edit-reader").value).toBe("");
      expect(field(el, "edit-reader").options.map((option) => option.value)).toEqual([
        "",
        "r1",
        "r2",
      ]);
      expect(api.getProfileReaders).toHaveBeenCalledExactlyOnceWith("pa");
    });

    it("a chosen profile's readers that cannot be read are said at the bottom of Edit", async () => {
      const api = equipmentApi({
        getProfileReaders: vi
          .fn()
          .mockImplementation((id: string) =>
            id === "pb"
              ? Promise.reject({ code: "connection.failed" })
              : Promise.resolve({ readerIds: ["r1"], defaultReaderId: null }),
          ),
      });
      const el = await openEdit(api);
      expect(await bottom(el)).toBe("");
      await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
      await vi.waitFor(async () => expect(await bottom(el)).toBe(codeMessage("connection.failed")));
      expect(field(el, "edit-reader").options).toEqual([
        { value: "", label: useDefault(t("equipment.none")) },
      ]);
    });

    describe("a chosen profile's readers answering after Edit was saved and opened again", () => {
      const paReaders: ProfileReaderList = { readerIds: ["r2"], defaultReaderId: null };

      async function saveWhilePbLoads(late: Promise<ProfileReaderList>, fresh: ProfileReaderList) {
        const api = equipmentApi({
          getProfileReaders: vi
            .fn()
            .mockResolvedValueOnce(paReaders)
            .mockReturnValueOnce(late)
            .mockResolvedValueOnce(paReaders)
            .mockResolvedValueOnce(fresh),
        });
        const el = await openEdit(api);
        await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
        await flush(el);
        await save(el);
        await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).toBeNull());
        dq(el.shadowRoot!, "[data-test=edit-device-t1]")!.click();
        await vi.waitFor(() => expect(field(el, "edit-reader")?.disabled).toBe(false));
        return { api, el };
      }

      it("are not used: choosing that profile again reads its readers afresh", async () => {
        const late = deferred<ProfileReaderList>();
        const { api, el } = await saveWhilePbLoads(late.promise, {
          readerIds: ["r1"],
          defaultReaderId: null,
        });
        late.resolve({ readerIds: ["r2"], defaultReaderId: "r2" });
        await flush(el);
        await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
        await vi.waitFor(() =>
          expect(field(el, "edit-reader").options.map((option) => option.value)).toEqual([
            "",
            "r1",
          ]),
        );
        expect(vi.mocked(api.getProfileReaders).mock.calls.map(([id]) => id)).toEqual([
          "pa",
          "pb",
          "pa",
          "pb",
        ]);
      });

      it("say nothing at the bottom when they fail", async () => {
        const late = deferred<ProfileReaderList>();
        const { el } = await saveWhilePbLoads(late.promise, paReaders);
        late.reject({ code: "connection.failed" });
        await flush(el);
        await flush(el);
        expect(await bottom(el)).toBe("");
      });
    });
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

  // At 1280px wide the standard size is not capped by the window: 42rem (672px).
  it("sizes the Add a device and Pair dialogs to the standard width on desktop", async () => {
    await page.viewport(1280, 900);
    const el = await openAdd(stubApi());
    const width = (id: string) =>
      q(el, `[data-test=${id}]`)!.shadowRoot!.querySelector("dialog")!.getBoundingClientRect()
        .width;
    expect(width("add-device-modal")).toBeCloseTo(672, 0);
    await openPair(el);
    expect(width("pair-modal")).toBeCloseTo(672, 0);
  });

  it("offers Add a device only in the heading beside an empty table", async () => {
    const api = stubApi({ listDevices: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);

    const buttons = el.shadowRoot!.querySelectorAll("[data-test=open-add-device]");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent?.trim()).toBe(t("devices.add"));
    const table = devicesTable(el);
    await table.updateComplete;
    expect(table.querySelector(":scope > [slot=empty-action]")).toBeNull();
    const add = q(el, ".heading [data-test=open-add-device]")!;
    // The page no longer holds the window itself: nothing is taken until the dialog opens.
    expect(q(el, "[data-test=pairing-mode]")).toBeNull();
    expect(q(el, "[data-test=join-panel]")).toBeNull();
    expect(api.takePairingHold).not.toHaveBeenCalled();

    add.click();
    await vi.waitFor(() => expect(q(el, "[data-test=add-device-modal]")).not.toBeNull());
    await vi.waitFor(() => expect(api.takePairingHold).toHaveBeenCalledTimes(1));
  });

  it("draws no Add a device in the table once there is a device", async () => {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(devicesTable(el).querySelector("[slot=empty-action]")).toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[data-test=open-add-device]")).toHaveLength(1);
  });

  it("returns focus to the heading's Add a device after the first device is paired from the empty table", async () => {
    let rows: DeviceRow[] = [];
    const api = stubApi({
      listDevices: vi.fn(() => Promise.resolve(rows)),
      acceptDeviceJoinRequest: vi.fn(() => {
        rows = [{ ...devices[0]!, id: "d9", label: "Barra 2" }];
        return Promise.resolve({ deviceId: "d9", name: "Barra 2", formFactor: "till" as const });
      }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      qrFor: fakeQr(),
    });
    await flush(el);
    const add = q(el, ".heading [data-test=open-add-device]")!;
    add.focus();
    add.click();
    await vi.waitFor(() => expect(api.takePairingHold).toHaveBeenCalled());
    await flush(el);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    await vi.waitFor(() => expect(deepText(el, "[data-test=device-label-d9]")).toBe("Barra 2"));
    const decoy = document.createElement("button");
    el.shadowRoot!.prepend(decoy);

    q(el, "[data-test=joined-close]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).toBeNull());
    await flush(el);
    expect(el.shadowRoot!.activeElement).toBe(q(el, ".heading [data-test=open-add-device]"));
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
    expect(timeSentence(q(el, "[data-test=pairing-until]"))).toEqual({
      text: t("devices.window_closes"),
      at: "2026-09-08T10:05:00.000Z",
    });

    vi.mocked(api.pairingMode).mockResolvedValue(later);
    liveData.refresh();
    await vi.waitFor(() =>
      expect(timeSentence(q(el, "[data-test=pairing-until]"))).toEqual({
        text: t("devices.window_closes"),
        at: "2026-09-08T10:07:00.000Z",
      }),
    );
  });

  it("says in the session's language how soon the window closes, with the exact time on hand", async () => {
    const before = currentLocale();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-09-08T10:00:30.000Z"));
    try {
      for (const [locale, sentence, exact] of [
        ["en-GB", "Accepting devices: closes in 4 minutes", "8 September 2026 at 10:05"],
        [
          "es-ES",
          "Se aceptan dispositivos: se cierra dentro de 4 minutos",
          "8 de septiembre de 2026 a las 10:05",
        ],
      ] as const) {
        setLocale(locale);
        const el = await openAdd(stubApi());
        const until = q(el, "[data-test=pairing-until]")!;
        const time = until.querySelector("wt-relative-time")!;
        await time.updateComplete;
        expect(time.future).toBe(true);
        const words = time.shadowRoot!.querySelector("time")!.textContent!.trim();
        expect(timeSentence(until).text.replace("{time}", words)).toBe(sentence);
        const button = time.shadowRoot!.querySelector("button")!;
        const tip = time.shadowRoot!.getElementById(button.getAttribute("aria-describedby")!)!;
        expect(tip.textContent!.trim()).toBe(exact);
        button.click();
        expect(tip.matches(":popover-open")).toBe(true);
        cleanupWidgets();
      }
    } finally {
      vi.useRealTimers();
      setLocale(before);
    }
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
      createdAt: "2026-09-08T10:02:00.000Z",
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

  for (const [locale, first, more, added, question, another, close] of [
    [
      "en-GB",
      "Waiting for devices…",
      "Waiting for more devices…",
      "Barra 2 has been added.",
      "Do you want to add another device?",
      "Add another device",
      "Close",
    ],
    [
      "es-ES",
      "Esperando dispositivos…",
      "Esperando más dispositivos…",
      "Barra 2 se ha añadido.",
      "¿Quieres añadir otro dispositivo?",
      "Añadir otro dispositivo",
      "Cerrar",
    ],
  ] as const) {
    it(`pauses at a compact confirmation and resumes only on Add another device in ${locale}`, async () => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const api = stubApi({ joinRequests: vi.fn().mockResolvedValue([]) });
        const el = await openAdd(api);
        expect(text(el, "[data-test=waiting-empty]")).toBe(first);
        vi.mocked(api.joinRequests).mockResolvedValue([pending[0]!]);
        const parent = el.parentElement!;
        el.remove();
        parent.appendChild(el);
        await flush(el);
        q(el, "[data-test=open-add-device]")!.click();
        await vi.waitFor(() => expect(d(el, "[data-test=pair-r1]")).not.toBeNull());
        await toSettings(el);
        await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
        const releases = vi.mocked(api.releasePairingHold).mock.calls.length;
        q(el, "[data-test=pair-submit]")!.click();
        await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
        await expect.element(page.getByRole("dialog", { name: added, exact: true })).toBeVisible();
        expect(q(el, "[data-test=joined-modal]")?.getAttribute("heading")).toBe(added);
        expect(q(el, "[data-test=joined-modal]")?.getAttribute("description")).toBe(question);
        expect(text(el, "[data-test=joined-close]")).toBe(close);
        expect(text(el, "[data-test=add-another-device]")).toBe(another);
        expect(q(el, "[data-test=add-another-device]")!.getAttribute("variant")).toBe("primary");
        expect(q(el, "[data-test=add-device-modal]")).toBeNull();
        expect(q(el, "[data-test=waiting-empty]")).toBeNull();
        expect(api.releasePairingHold).toHaveBeenCalledTimes(releases + 1);
        const holds = vi.mocked(api.takePairingHold).mock.calls.length;
        vi.mocked(api.joinRequests).mockResolvedValue([]);
        q(el, "[data-test=add-another-device]")!.click();
        await vi.waitFor(() => expect(q(el, "[data-test=add-device-modal]")).not.toBeNull());
        await vi.waitFor(() => expect(api.takePairingHold).toHaveBeenCalledTimes(holds + 1));
        expect(q(el, "[data-test=joined-modal]")).toBeNull();
        expect(text(el, "[data-test=waiting-empty]")).toBe(more);
      } finally {
        setLocale(before);
      }
    });
  }

  for (const dismissal of ["close", "escape"] as const) {
    it(`ends adding on confirmation ${dismissal} and starts a fresh first wait next time`, async () => {
      const api = stubApi({
        joinRequests: vi.fn().mockResolvedValue([pending[0]!]),
        listDevices: vi.fn().mockResolvedValue([{ ...devices[0]!, id: "d9", label: "Barra 2" }]),
      });
      const el = await openAdd(api);
      await toSettings(el);
      await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
      q(el, "[data-test=pair-submit]")!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
      if (dismissal === "close") q(el, "[data-test=joined-close]")!.click();
      else {
        q(el, "[data-test=joined-modal]")!.shadowRoot!.querySelector("dialog")!.focus();
        await userEvent.keyboard("{Escape}");
      }
      await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).toBeNull());
      expect(q(el, "[data-test=add-device-modal]")).toBeNull();
      await vi.waitFor(() => expect(deepText(el, "[data-test=device-label-d9]")).toBe("Barra 2"));
      vi.mocked(api.joinRequests).mockResolvedValue([]);
      // The already consumed ask may still appear in a passive snapshot until it refreshes.
      const parent = el.parentElement!;
      el.remove();
      parent.appendChild(el);
      await flush(el);
      q(el, "[data-test=open-add-device]")!.click();
      await vi.waitFor(() =>
        expect(text(el, "[data-test=waiting-empty]")).toBe(t("devices.waiting")),
      );
    });
  }

  it("reopens waiting with a fresh QR read even when the first QR is still pending", async () => {
    let resolve!: (qr: string) => void;
    const qrFor = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((yes) => {
            resolve = yes;
          }),
      )
      .mockResolvedValue("data:image/png;base64,fresh");
    const api = stubApi();
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api, qrFor });
    await flush(el);
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() => expect(qrFor).toHaveBeenCalledOnce());
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
    q(el, "[data-test=add-another-device]")!.click();
    try {
      await vi.waitFor(() =>
        expect(q(el, "[data-test=device-qr]")?.getAttribute("src")).toBe(
          "data:image/png;base64,fresh",
        ),
      );
    } finally {
      resolve("data:image/png;base64,old");
    }
    await flush(el);
    expect(q(el, "[data-test=device-qr]")!.getAttribute("src")).toBe("data:image/png;base64,fresh");
    expect(qrFor).toHaveBeenCalledTimes(2);
  });

  it("ignores stale close reports from the waiting and confirmation dialogs", async () => {
    const el = await openAdd(stubApi());
    const waiting = q(el, "[data-test=add-device-modal]")!;
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
    const confirmation = q(el, "[data-test=joined-modal]")!;
    q(el, "[data-test=add-another-device]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=add-device-modal]")).not.toBeNull());
    waiting.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true, detail: {} }),
    );
    confirmation.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true, detail: {} }),
    );
    await flush(el);
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
    expect(d(el, "[data-test=pair-r2]")).not.toBeNull();
  });

  it("keeps a newer live join snapshot when the reopening read finishes later", async () => {
    const api = Object.assign(stubApi(), { liveData: new LiveData() });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
    let resolve!: (rows: JoinRequestRow[]) => void;
    vi.mocked(api.joinRequests)
      .mockImplementationOnce(
        () =>
          new Promise<JoinRequestRow[]>((yes) => {
            resolve = yes;
          }),
      )
      .mockResolvedValue([{ ...pending[1]!, label: "Latest ask" }]);
    q(el, "[data-test=add-another-device]")!.click();
    await vi.waitFor(() => expect(api.joinRequests).toHaveBeenCalledTimes(2));
    api.liveData.refresh();
    try {
      await vi.waitFor(() =>
        expect(d(el, "[data-test=waiting-row-r2]")?.textContent?.trim()).toBe("Latest ask"),
      );
    } finally {
      resolve([]);
    }
    await flush(el);
    expect(d(el, "[data-test=waiting-row-r2]")?.textContent?.trim()).toBe("Latest ask");
  });

  it("a replacement returned by the reopening read closes the old Pair without denying the replacement", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
    let resolve!: (rows: JoinRequestRow[]) => void;
    vi.mocked(api.joinRequests).mockImplementationOnce(
      () =>
        new Promise<JoinRequestRow[]>((yes) => {
          resolve = yes;
        }),
    );
    q(el, "[data-test=add-another-device]")!.click();
    await vi.waitFor(() => expect(api.joinRequests).toHaveBeenCalledTimes(2));
    try {
      await openPair(el, "r2");
    } finally {
      resolve([{ ...pending[1]!, createdAt: "2026-09-08T10:06:00.000Z" }]);
    }
    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(text(el, "[data-test=asked-again]")).toContain("Pantalla pase");
  });

  it("refreshes simultaneous asks after the last hold released them", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    vi.mocked(api.releasePairingHold).mockImplementation(async () => {
      vi.mocked(api.joinRequests).mockResolvedValue([]);
    });
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
    expect(q(el, "[data-test=waiting-table]")).toBeNull();
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1);
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    q(el, "[data-test=add-another-device]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=device-qr]")).not.toBeNull());
    await vi.waitFor(() => expect(q(el, "[data-test=waiting-empty]")).not.toBeNull());
    expect(text(el, "[data-test=waiting-empty]")).toBe(t("devices.waiting_more"));
    expect(d(el, "[data-test=pair-r2]")).toBeNull();
  });

  it("offers a simultaneous second ask that another hold kept live, only after Add another device", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    vi.mocked(api.joinRequests).mockResolvedValue([pending[1]!]);
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=joined-modal]")).not.toBeNull());
    expect(q(el, "[data-test=waiting-table]")).toBeNull();
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1);
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    q(el, "[data-test=add-another-device]")!.click();
    await vi.waitFor(() => expect(d(el, "[data-test=pair-r2]")).not.toBeNull());
    expect(d(el, "[data-test=pair-r1]")).toBeNull();
    await openPair(el, "r2");
    expect(api.joinChallenge).toHaveBeenLastCalledWith("r2");
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1);
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
  });

  it("Pair sends the typed name, profile and kitchen screen, then says Added", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);

    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(q(el, "[data-test=pair-screen]")!, "station");
    typeField(el, "[data-test=pair-name]", "Barra 2");
    await el.updateComplete;
    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      name: "Barra 2",
      profileId: "dp3",
      kitchenScreens: [{ kind: "station", stationIds: null, zoneIds: null }],
    });
    expect(q(el, "[data-test=joined-modal]")?.getAttribute("heading")).toBe(
      t("devices.added").replace("{name}", "Barra 2"),
    );
    expect(q(el, "[data-test=joined-modal]")!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(api.listDevices).toHaveBeenCalledTimes(2);
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
    expect(q(el, "[data-test=add-device-modal]")).toBeNull();
  });

  it("sends a kitchen display's pass screen, and no kitchen screens for a till", async () => {
    const api = stubApi({
      listStations: vi
        .fn()
        .mockResolvedValue([...stations, { ...stations[0]!, id: "retired", active: false }]),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    const screen = q(el, "[data-test=pair-screen]") as HTMLElement & {
      name: string;
      label: string;
      required: boolean;
      placeholder: string;
      options: unknown[];
    };
    expect(screen.name).toBe("kitchenScreen");
    expect(screen.label).toBe(t("devices.kitchen_screen"));
    expect(screen.required).toBe(true);
    expect(screen.placeholder).toBe(t("devices.kitchen_screen_pick"));
    expect(screen.options).toEqual([
      { value: "station", label: t("device_profiles.kitchen_screen.station") },
      { value: "pass", label: t("device_profiles.kitchen_screen.pass") },
    ]);
    await chooseOption(screen, "station");
    await el.updateComplete;
    (q(el, "[data-test=pair-screen-every-station]") as HTMLElement).dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: false } }),
    );
    await el.updateComplete;
    // The retired station is left out.
    expect(
      [...q(el, "[data-test=pair-screen-stations]")!.querySelectorAll("wt-switch")].map(
        (toggle) => toggle.dataset.test,
      ),
    ).toEqual(["pair-screen-every-station", "pair-screen-station-s1", "pair-screen-station-s2"]);
    await chooseOption(screen, "pass");
    await el.updateComplete;
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "dp3",
      kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: null }],
    });

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    q(el, "[data-test=add-another-device]")!.click();
    await vi.waitFor(() => expect(d(el, "[data-test=pair-r2]")).not.toBeNull());
    await openPair(el, "r2");
    await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());
    q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-profile]")).not.toBeNull());
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;
    expect(q(el, "[data-test=pair-screen]")).toBeNull();
    expect(q(el, "[data-test=pair-pass]")).toBeNull();
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(2));
    expect(api.acceptDeviceJoinRequest).toHaveBeenLastCalledWith("r2", {
      name: "Pantalla pase",
      profileId: "dp1",
      kitchenScreens: [],
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
      placeholder: string;
      options: unknown[];
    };
    expect(profile.placeholder).toBe(t("devices.join_pick_profile"));
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
    expect((q(el, "[data-test=pair-screen]") as Field).error).toBe(
      codeMessage("kitchen_screen.required"),
    );
    expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(true);
    expect(api.acceptDeviceJoinRequest).not.toHaveBeenCalled();
  });

  it.each([
    { code: "kitchen_screen.invalid", params: { field: "stationIds", reason: "not_found" } },
    { code: "station.not_allowed", params: { stationId: "s1" } },
  ])("a $code refusal naming a station goes under the screen's stations", async (error) => {
    const api = stubApi({ acceptDeviceJoinRequest: vi.fn().mockRejectedValue(error) });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(q(el, "[data-test=pair-screen]")!, "station");
    await el.updateComplete;
    (q(el, "[data-test=pair-screen-every-station]") as HTMLElement).dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: false } }),
    );
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(() =>
      expect(q(el, "[data-test=pair-screen-stations-error]")?.textContent?.trim()).toBe(
        codeMessage(error.code),
      ),
    );
    expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(t("form.fix_fields"));
  });

  it("offers a kitchen profile only the screens and stations it lists, and says when it lists none", async () => {
    const api = stubApi({
      listDeviceProfiles: vi
        .fn()
        .mockResolvedValue([
          ...deviceProfiles,
          { ...deviceProfiles[2]!, id: "dp4", name: "Empty" },
        ]),
      listProfileKitchenScreens: vi.fn().mockResolvedValue([
        {
          profileId: "dp3",
          screens: {
            station: { stationIds: ["s2"], zoneIds: null },
            pass: { stationIds: null, zoneIds: null },
          },
        },
      ]),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    const screen = () =>
      q(el, "[data-test=pair-screen]") as HTMLElement & {
        options: unknown[];
        placeholder: string;
      };
    expect(screen().options).toEqual([
      { value: "station", label: t("device_profiles.kitchen_screen.station") },
      { value: "pass", label: t("device_profiles.kitchen_screen.pass") },
    ]);
    expect(screen().placeholder).toBe(t("devices.kitchen_screen_pick"));
    await chooseOption(screen(), "station");
    await el.updateComplete;
    (q(el, "[data-test=pair-screen-every-station]") as HTMLElement).dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: false } }),
    );
    await el.updateComplete;
    expect(
      [...q(el, "[data-test=pair-screen-stations]")!.querySelectorAll("wt-switch")].map(
        (toggle) => toggle.dataset.test,
      ),
    ).toEqual(["pair-screen-every-station", "pair-screen-station-s2"]);

    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp4");
    await el.updateComplete;
    expect(screen().options).toEqual([]);
    expect(screen().placeholder).toBe(t("devices.kitchen_screen_none_offered"));
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

  it("puts a refusal naming a field Pair does not show at the bottom", async () => {
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "receiptPrinterId" },
      }),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;

    q(el, "[data-test=pair-submit]")!.click();

    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(
        codeMessage("management.request_invalid"),
      ),
    );
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

  it("lets a Pair save that is under way decide the outcome: Escape and Cancel wait for it", async () => {
    let answer!: (value: { deviceId: string; name: string; formFactor: string }) => void;
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockReturnValue(new Promise((r) => (answer = r))),
    });
    const el = await openAdd(api);
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
    await el.updateComplete;
    q(el, "[data-test=pair-submit]")!.click();
    await flush(el);

    expect((q(el, "[data-test=pair-cancel]") as Button).disabled).toBe(true);
    const dialog = q(el, "[data-test=pair-modal]")!.shadowRoot!.querySelector("dialog")!;
    dialog.focus();
    await userEvent.keyboard("{Escape}");
    await flush(el);
    expect(q(el, "[data-test=pair-modal]")).not.toBeNull();
    expect(dialog.open).toBe(true);
    // The Escape must not fall through to the Add dialog underneath either.
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
    expect(api.releasePairingHold).not.toHaveBeenCalled();
    expect(api.denyJoinRequest).not.toHaveBeenCalled();

    answer({ deviceId: "d9", name: "Barra 1", formFactor: "till" });
    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(q(el, "[data-test=joined-modal]")?.getAttribute("heading")).toBe(
      t("devices.added").replace("{name}", "Barra 1"),
    );
    expect(api.denyJoinRequest).not.toHaveBeenCalled();
  });

  /** Whether each settings field of the Pair dialog is disabled, read from its native control. */
  function pairFieldsDisabled(el: DevicesScreen): Record<string, boolean> {
    const native = (id: string): boolean =>
      q(el, `[data-test=${id}]`)!.shadowRoot!.querySelector<HTMLInputElement | HTMLButtonElement>(
        "input.field-control, button.trigger",
      )!.disabled;
    return {
      name: native("pair-name"),
      profile: native("pair-profile"),
      screen: native("pair-screen"),
    };
  }

  async function toFilledSettings(el: DevicesScreen): Promise<void> {
    await toSettings(el);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "dp3");
    await el.updateComplete;
    await chooseOption(q(el, "[data-test=pair-screen]")!, "station");
    await flush(el);
  }

  const enabled = { name: false, profile: false, screen: false };

  it("takes no new value in any settings field while Pair is unanswered", async () => {
    let answer!: (value: { deviceId: string; name: string; formFactor: string }) => void;
    const api = stubApi({
      acceptDeviceJoinRequest: vi.fn().mockReturnValue(new Promise((r) => (answer = r))),
    });
    const el = await openAdd(api);
    await toFilledSettings(el);
    expect(pairFieldsDisabled(el)).toEqual(enabled);

    q(el, "[data-test=pair-submit]")!.click();
    await flush(el);
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1);
    expect(pairFieldsDisabled(el)).toEqual({ name: true, profile: true, screen: true });

    answer({ deviceId: "d9", name: "Barra 1", formFactor: "kds" });
    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
  });

  it.each([
    {
      name: "a refusal naming a field",
      refusal: { code: "device.name_taken" },
      bottom: t("form.fix_fields"),
    },
    {
      name: "a refusal naming no field",
      refusal: { code: "join_request.not_found" },
      bottom: codeMessage("join_request.not_found"),
    },
  ])("every settings field takes a value again after $name", async ({ refusal, bottom }) => {
    const api = stubApi({ acceptDeviceJoinRequest: vi.fn().mockRejectedValue(refusal) });
    const el = await openAdd(api);
    await toFilledSettings(el);

    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=pair-actions]")).toBe(bottom),
    );
    await flush(el);
    expect(q(el, "[data-test=pair-modal]")).not.toBeNull();
    expect(pairFieldsDisabled(el)).toEqual(enabled);
  });

  it("the number check and Cancel name the ask the dialog was opened on, by its createdAt", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await toSettings(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.checkDeviceJoinNumber).toHaveBeenCalledExactlyOnceWith("r1", {
      choice: REAL_NUMBER,
      holdId: "h1",
      createdAt: "2026-09-08T10:02:00.000Z",
    });
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
  });

  it("Cancel discards the request at the number step", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
    expect(api.releasePairingHold).not.toHaveBeenCalled();
  });

  it("Cancel discards the request at the settings step, and says nothing when it is already gone", async () => {
    const api = stubApi({
      denyJoinRequest: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const el = await openAdd(api);
    await toSettings(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
    await flush(el);
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
  });

  it("a discard that fails on Cancel is said in the Add dialog, and a second Cancel clears it", async () => {
    const api = stubApi({
      denyJoinRequest: vi
        .fn()
        .mockRejectedValueOnce({ code: "connection.failed" })
        .mockResolvedValue(undefined),
    });
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe(
        codeMessage("connection.failed"),
      ),
    );

    await openPair(el);
    q(el, "[data-test=pair-cancel]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledTimes(2);
    await flush(el);
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
  });

  it("Cancel at the number step says nothing when the request is already gone", async () => {
    const api = stubApi({
      denyJoinRequest: vi.fn().mockRejectedValue({ code: "join_request.not_found" }),
    });
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=pair-cancel]")!.click();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
    await flush(el);
    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
  });

  it("a discard that fails after Add was closed says nothing in the next Add dialog", async () => {
    let rejectDeny!: (error: unknown) => void;
    const api = stubApi({
      denyJoinRequest: vi.fn().mockReturnValue(
        new Promise<void>((_resolve, reject) => {
          rejectDeny = reject;
        }),
      ),
    });
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=add-device-close]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=add-device-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=add-device-modal]")).not.toBeNull());
    rejectDeny({ code: "connection.failed" });
    await flush(el);

    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
  });

  it("keeps a failed discard's message when the Add dialog's address read fails after it", async () => {
    let rejectAddress!: (error: unknown) => void;
    const api = stubApi({
      pairingMode: vi
        .fn()
        .mockResolvedValueOnce(SHUT)
        .mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            rejectAddress = reject;
          }),
        )
        .mockResolvedValue(SHUT),
      denyJoinRequest: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
    await flush(el);
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() => expect(api.pairingMode).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(api.takePairingHold).toHaveBeenCalled());
    await flush(el);
    await openPair(el);
    q(el, "[data-test=pair-cancel]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe(
        codeMessage("connection.failed"),
      ),
    );

    rejectAddress({ code: "server.internal" });
    await flush(el);

    expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe(
      codeMessage("connection.failed"),
    );
  });

  it("Escape on Pair discards the request and leaves the Add dialog open", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    q(el, "[data-test=pair-modal]")!.shadowRoot!.querySelector("dialog")!.close();

    await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
    expect(q(el, "[data-test=add-device-modal]")).not.toBeNull();
  });

  it("closing Add while Pair is open discards the request and releases the hold", async () => {
    const api = stubApi();
    const el = await openAdd(api);
    await openPair(el);

    el.remove();

    expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("r1", {
      createdAt: "2026-09-08T10:02:00.000Z",
    });
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

  describe("a disabled device that asks again", () => {
    /** The disabled kitchen screen d2 knocking under a new label, beside an ordinary request. */
    const returning: JoinRequestRow = {
      id: "d2",
      kind: "device",
      label: "Tablet",
      createdAt: "2026-09-08T10:04:00.000Z",
      pairingBy: null,
      returning: {
        name: "Pase revocado",
        profileId: "dp3",
        kitchenScreens: [
          {
            kind: "station",
            available: true,
            everyStation: false,
            everyZone: true,
            profileEveryStation: false,
            stations: [{ id: "s1", name: "Cocina", available: true, switchedOff: false }],
            zones: null,
          },
        ],
        profileRetired: false,
      },
    };
    const waiting = (row: JoinRequestRow = returning) =>
      stubApi({ joinRequests: vi.fn().mockResolvedValue([pending[0]!, row]) });

    async function toEnableSettings(el: DevicesScreen): Promise<void> {
      await openPair(el, "d2");
      await vi.waitFor(() => expect(q(el, `[data-choice="${REAL_NUMBER}"]`)).not.toBeNull());
      q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=pair-name]")).not.toBeNull());
      await flush(el);
    }

    it("is offered as Enable under its old name, with a hint, in English and Spanish", async () => {
      const before = currentLocale();
      try {
        for (const [locale, enable, pair, hint, enabled] of [
          [
            "en",
            "Enable",
            "Pair",
            "Disabled device. Enabling it restores its settings.",
            "Enabled Pase revocado",
          ],
          [
            "es-ES",
            "Habilitar",
            "Emparejar",
            "Dispositivo deshabilitado. Al habilitarlo se restauran sus ajustes.",
            "Pase revocado habilitado",
          ],
        ] as const) {
          setLocale(locale);
          const api = waiting();
          const el = await openAdd(api);

          expect(d(el, "[data-test=waiting-row-d2]")?.textContent?.trim()).toBe("Pase revocado");
          expect(d(el, "[data-test=returning-hint-d2]")?.textContent?.trim()).toBe(hint);
          expect(d(el, "[data-test=pair-d2]")?.textContent?.trim()).toBe(enable);
          expect(d(el, "[data-test=pair-d2]")?.getAttribute("aria-label")).toBe(
            `${enable} Pase revocado`,
          );
          expect(d(el, "[data-test=waiting-row-r1]")?.textContent?.trim()).toBe("Barra 1");
          expect(d(el, "[data-test=returning-hint-r1]")).toBeNull();
          expect(d(el, "[data-test=pair-r1]")?.textContent?.trim()).toBe(pair);

          await toEnableSettings(el);
          expect(q(el, "[data-test=pair-modal]")!.getAttribute("heading")).toBe(
            `${enable} Pase revocado`,
          );
          expect(text(el, "[data-test=pair-submit]")).toBe(enable);
          vi.mocked(api.acceptDeviceJoinRequest).mockResolvedValue({
            deviceId: "d2",
            name: "Pase revocado",
            formFactor: "kds",
          });
          q(el, "[data-test=pair-submit]")!.click();
          await vi.waitFor(() =>
            expect(q(el, "[data-test=joined-modal]")?.getAttribute("heading")).toBe(enabled),
          );
          cleanupWidgets();
        }
      } finally {
        setLocale(before);
      }
    });

    it("whose profile was deleted says a profile must be chosen, in English and Spanish", async () => {
      const before = currentLocale();
      try {
        for (const [locale, hint] of [
          ["en", "Disabled device. Its profile was deleted: choose one to enable it."],
          ["es-ES", "Dispositivo deshabilitado. Su perfil se eliminó: elige uno para habilitarlo."],
        ] as const) {
          setLocale(locale);
          const el = await openAdd(
            waiting({ ...returning, returning: { ...returning.returning!, profileRetired: true } }),
          );

          expect(d(el, "[data-test=returning-hint-d2]")?.textContent?.trim()).toBe(hint);
          expect(d(el, "[data-test=returning-hint-r1]")).toBeNull();
          cleanupWidgets();
        }
      } finally {
        setLocale(before);
      }
    });

    it("checks the number, opens filled in from the device, and Enable sends it to the device's own id", async () => {
      const api = waiting();
      const el = await openAdd(api);
      await openPair(el, "d2");

      await vi.waitFor(() => expect(q(el, `[data-choice="${REAL_NUMBER}"]`)).not.toBeNull());
      expect(q(el, "[data-test=pair-name]")).toBeNull();
      q(el, `[data-choice="${REAL_NUMBER}"]`)!.click();
      await vi.waitFor(() => expect(q(el, "[data-test=pair-name]")).not.toBeNull());
      await flush(el);

      expect(api.checkDeviceJoinNumber).toHaveBeenCalledExactlyOnceWith("d2", {
        choice: REAL_NUMBER,
        holdId: "h1",
        createdAt: "2026-09-08T10:04:00.000Z",
      });
      expect((q(el, "[data-test=pair-name]") as Field).value).toBe("Pase revocado");
      expect((q(el, "[data-test=pair-profile]") as Field).value).toBe("dp3");
      expect((q(el, "[data-test=pair-screen]") as Field).value).toBe("station");
      expect(
        (q(el, "[data-test=pair-screen-station-s1]") as HTMLElement & { checked: boolean }).checked,
      ).toBe(true);
      vi.mocked(api.acceptDeviceJoinRequest).mockResolvedValue({
        deviceId: "d2",
        name: "Pase revocado",
        formFactor: "kds",
      });
      q(el, "[data-test=pair-submit]")!.click();

      await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
      expect(api.acceptDeviceJoinRequest).toHaveBeenCalledExactlyOnceWith("d2", {
        name: "Pase revocado",
        profileId: "dp3",
        kitchenScreens: [{ kind: "station", stationIds: ["s1"], zoneIds: null }],
      });
      expect(q(el, "[data-test=joined-modal]")?.getAttribute("heading")).toBe(
        t("devices.enabled").replace("{name}", "Pase revocado"),
      );
      expect(api.denyJoinRequest).not.toHaveBeenCalled();
    });

    it("fills in a kitchen display's pass screen", async () => {
      const slot = (id: string, name: string) => ({
        id,
        name,
        available: true,
        switchedOff: false,
      });
      const api = waiting({
        ...returning,
        returning: {
          name: "Pase revocado",
          profileId: "dp3",
          kitchenScreens: [
            {
              kind: "pass",
              available: true,
              everyStation: true,
              everyZone: true,
              profileEveryStation: true,
              stations: [slot("s1", "Cocina"), slot("s2", "Barra")],
              zones: null,
            },
          ],
          profileRetired: false,
        },
      });
      const el = await openAdd(api);
      await toEnableSettings(el);

      expect((q(el, "[data-test=pair-screen]") as Field).value).toBe("pass");
      q(el, "[data-test=pair-submit]")!.click();
      await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
      expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("d2", {
        name: "Pase revocado",
        profileId: "dp3",
        kitchenScreens: [{ kind: "pass", stationIds: null, zoneIds: null }],
      });
    });

    it("whose profile is gone opens with the profile empty, and Enable waits until one is chosen", async () => {
      const api = waiting({
        ...returning,
        returning: {
          name: "Caja vieja",
          profileId: "deleted",
          kitchenScreens: [],
          profileRetired: true,
        },
      });
      const el = await openAdd(api);
      await toEnableSettings(el);

      expect((q(el, "[data-test=pair-name]") as Field).value).toBe("Caja vieja");
      expect((q(el, "[data-test=pair-profile]") as Field).value).toBe("");
      q(el, "[data-test=pair-submit]")!.click();
      await flush(el);
      expect((q(el, "[data-test=pair-profile]") as Field).error).toBe(
        t("devices.join_pick_profile"),
      );
      expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(true);
      expect(api.acceptDeviceJoinRequest).not.toHaveBeenCalled();

      await chooseOption(q(el, "[data-test=pair-profile]")!, "dp1");
      await el.updateComplete;
      expect((q(el, "[data-test=pair-submit]") as Button).disabled).toBe(false);
      q(el, "[data-test=pair-submit]")!.click();
      await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
      expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("d2", {
        name: "Caja vieja",
        profileId: "dp1",
        kitchenScreens: [],
      });
    });

    it("whose profile the server reports deleted opens with the profile empty, even while this screen's list still holds it", async () => {
      const api = waiting({
        ...returning,
        returning: { ...returning.returning!, profileRetired: true },
      });
      const el = await openAdd(api);
      await toEnableSettings(el);

      const profile = q(el, "[data-test=pair-profile]") as Field & {
        options: { value: string }[];
      };
      expect(profile.options.map((o) => o.value)).toContain("dp3");
      expect(profile.value).toBe("");
    });

    it("whose only station was switched off opens with no Screen", async () => {
      const api = waiting({
        ...returning,
        returning: {
          ...returning.returning!,
          kitchenScreens: [
            {
              kind: "station",
              available: true,
              everyStation: false,
              everyZone: true,
              profileEveryStation: false,
              stations: [{ id: "s1", name: "Cocina", available: false, switchedOff: true }],
              zones: null,
            },
          ],
        },
      });
      vi.mocked(api.listStations).mockResolvedValue([
        { ...stations[0]!, active: false },
        stations[1]!,
      ]);
      const el = await openAdd(api);
      await toEnableSettings(el);

      expect((q(el, "[data-test=pair-profile]") as Field).value).toBe("dp3");
      expect((q(el, "[data-test=pair-screen]") as Field).value).toBe("");
    });

    it("whose station its profile no longer lists opens with no Screen", async () => {
      const api = waiting();
      vi.mocked(api.listProfileKitchenScreens).mockResolvedValue([
        { profileId: "dp3", screens: { station: { stationIds: ["s2"], zoneIds: null } } },
      ]);
      const el = await openAdd(api);
      await toEnableSettings(el);

      expect((q(el, "[data-test=pair-profile]") as Field).value).toBe("dp3");
      expect((q(el, "[data-test=pair-screen]") as Field).value).toBe("");
    });

    describe("while its Enable dialog is open", () => {
      const live = () => Object.assign(waiting(), { liveData: new LiveData() });
      const asks = (...rows: JoinRequestRow[]) => [pending[0]!, ...rows];

      it.each(["number", "settings"] as const)(
        "a new ask from the device closes the dialog at the %s step without discarding the new ask",
        async (step) => {
          const api = live();
          const el = await openAdd(api);
          if (step === "number") {
            await openPair(el, "d2");
            await vi.waitFor(() => expect(q(el, "[data-choice]")).not.toBeNull());
          } else await toEnableSettings(el);

          vi.mocked(api.joinRequests).mockResolvedValue(
            asks({ ...returning, createdAt: "2026-09-08T10:06:00.000Z" }),
          );
          api.liveData.refresh();

          await vi.waitFor(() => expect(q(el, "[data-test=pair-modal]")).toBeNull());
          await flush(el);
          expect(api.denyJoinRequest).not.toHaveBeenCalled();
          expect(text(el, "[data-test=asked-again]")).toBe(
            t("devices.asked_again").replace("{name}", "Pase revocado"),
          );
          expect(q(el, "[data-test=asked-again]")!.getAttribute("role")).toBe("status");
          expect(d(el, "[data-test=pair-d2]")?.textContent?.trim()).toBe(t("devices.enable"));
        },
      );

      it("an unchanged ask keeps the dialog open, and Cancel still discards it", async () => {
        const api = live();
        const el = await openAdd(api);
        await toEnableSettings(el);

        vi.mocked(api.joinRequests).mockResolvedValue(asks({ ...returning }));
        api.liveData.refresh();
        await vi.waitFor(() => expect(api.joinRequests).toHaveBeenCalledTimes(2));
        await flush(el);
        expect(q(el, "[data-test=pair-modal]")).not.toBeNull();
        expect(q(el, "[data-test=asked-again]")).toBeNull();

        // Chromium fires the native close event, which sends the discard, only with the next
        // rendered frame, so this waits for the event rather than for vi.waitFor's one second.
        const modal = q(el, "[data-test=pair-modal]")!;
        const closed = new Promise((resolve) =>
          modal.addEventListener("wt-close", resolve, { once: true }),
        );
        q(el, "[data-test=pair-cancel]")!.click();
        await closed;
        expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("d2", {
          createdAt: "2026-09-08T10:04:00.000Z",
        });
      });

      it("an ask that left the list keeps the dialog open, and Cancel says nothing", async () => {
        const api = live();
        vi.mocked(api.denyJoinRequest).mockRejectedValue({ code: "join_request.not_found" });
        const el = await openAdd(api);
        await toEnableSettings(el);

        vi.mocked(api.joinRequests).mockResolvedValue(asks());
        api.liveData.refresh();
        await vi.waitFor(() => expect(d(el, "[data-test=pair-d2]")).toBeNull());
        await flush(el);
        expect(q(el, "[data-test=pair-modal]")).not.toBeNull();

        q(el, "[data-test=pair-cancel]")!.click();
        await vi.waitFor(() =>
          expect(api.denyJoinRequest).toHaveBeenCalledExactlyOnceWith("d2", {
            createdAt: "2026-09-08T10:04:00.000Z",
          }),
        );
        await flush(el);
        expect(await bottomOf(el, "[data-test=add-device-actions]")).toBe("");
        expect(q(el, "[data-test=asked-again]")).toBeNull();
      });

      it("says the device asked again in English and Spanish", async () => {
        const before = currentLocale();
        try {
          for (const [locale, said] of [
            ["en", "Pase revocado asked again with new numbers."],
            ["es-ES", "Pase revocado ha vuelto a solicitar el alta con números nuevos."],
          ] as const) {
            setLocale(locale);
            const api = live();
            const el = await openAdd(api);
            await openPair(el, "d2");
            vi.mocked(api.joinRequests).mockResolvedValue(
              asks({ ...returning, createdAt: "2026-09-08T10:06:00.000Z" }),
            );
            api.liveData.refresh();
            await vi.waitFor(() => expect(text(el, "[data-test=asked-again]")).toBe(said));
            cleanupWidgets();
          }
        } finally {
          setLocale(before);
        }
      });
    });

    it("already claimed by this login opens straight at its filled-in settings", async () => {
      const api = waiting({ ...returning, pairingBy: { name: "Me", mine: true } });
      const el = await openAdd(api);
      await openPair(el, "d2");

      expect(api.joinChallenge).not.toHaveBeenCalled();
      expect((q(el, "[data-test=pair-name]") as Field).value).toBe("Pase revocado");
      expect((q(el, "[data-test=pair-profile]") as Field).value).toBe("dp3");
    });
  });
});

describe("a device's kitchen screens", () => {
  type Field = HTMLElement & {
    value: string;
    error: string;
    label: string;
    name: string;
    required: boolean;
    options: { value: string; label: string }[];
  };
  type Switch = HTMLElement & { checked: boolean; label: string };

  const deli: Station = { ...stations[0]!, id: "s3", name: "Deli", displayOrder: 2 };
  const ksStations = [...stations, deli];
  const zones = [
    { id: "z1", name: "Terraza", displayOrder: 0, active: true },
    { id: "z2", name: "Salón", displayOrder: 1, active: true },
  ];
  const kdsProfile: DeviceProfile = { ...deviceProfiles[2]!, id: "pk", name: "Cocina KDS" };
  const tillProfile: DeviceProfile = {
    ...deviceProfiles[0]!,
    id: "pa",
    name: "Caja",
    capabilities: ["show-station", "show-expo"],
  };
  const handheldProfile: DeviceProfile = {
    ...deviceProfiles[1]!,
    id: "pb",
    name: "Comandera",
    capabilities: ["show-expo"],
  };
  const offered = [
    {
      profileId: "pk",
      screens: {
        station: { stationIds: ["s1", "s2"], zoneIds: null },
        pass_monitor: { stationIds: null, zoneIds: ["z1", "z2"] },
      },
    },
    { profileId: "pa", screens: { pass_monitor: { stationIds: null, zoneIds: null } } },
    { profileId: "pb", screens: {} },
  ];

  const slot = (id: string, available = true) => ({
    id,
    name: [...ksStations, ...zones].find((entry) => entry.id === id)!.name,
    available,
    switchedOff: false,
  });
  const base: DeviceRow = {
    ...devices[0]!,
    madeHereStationIds: [],
    approvedProfileIds: [],
    receiptPrinterId: null,
    paymentSlipPrinterId: null,
    kitchenScreens: [],
  };
  const kds = (id: string, kitchenScreens: DeviceRow["kitchenScreens"]): DeviceRow => ({
    ...base,
    id,
    label: `Pantalla ${id}`,
    kind: "kds_station",
    deviceProfileId: "pk",
    approvedProfileIds: ["pk"],
    kitchenScreens,
  });
  const tillRow = (id: string, kitchenScreens: DeviceRow["kitchenScreens"]): DeviceRow => ({
    ...base,
    id,
    label: `Caja ${id}`,
    kind: "till",
    deviceProfileId: "pa",
    approvedProfileIds: ["pa"],
    kitchenScreens,
  });

  function ksApi(rows: DeviceRow[], overrides: Partial<DashboardApi> = {}): DashboardApi {
    return stubApi({
      listDevices: vi.fn().mockResolvedValue(rows),
      listStations: vi.fn().mockResolvedValue(ksStations),
      listZones: vi.fn().mockResolvedValue(zones),
      listDeviceProfiles: vi.fn().mockResolvedValue([kdsProfile, tillProfile, handheldProfile]),
      listProfileKitchenScreens: vi.fn().mockResolvedValue(offered),
      joinRequests: vi
        .fn()
        .mockResolvedValue([{ ...pending[0]!, pairingBy: { name: "Me", mine: true } }]),
      ...overrides,
    });
  }

  const field = (el: DevicesScreen, id: string) => q(el, `[data-test=${id}]`) as Field;
  const sw = (el: DevicesScreen, id: string) => q(el, `[data-test=${id}]`) as Switch;
  function toggle(el: DevicesScreen, id: string, checked: boolean): void {
    sw(el, id).dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
    );
  }
  const switchesIn = (el: DevicesScreen, group: string) =>
    [...q(el, `[data-test=${group}]`)!.querySelectorAll<Switch>("wt-switch")].map((s) => [
      s.dataset.test,
      s.checked,
    ]);
  const groupError = (el: DevicesScreen, group: string) =>
    q(el, `[data-test=${group}-error]`)?.textContent?.trim() ?? "";

  async function openEdit(api: DashboardApi, id: string): Promise<DevicesScreen> {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      panels: PANELS,
    });
    await flush(el);
    dq(el.shadowRoot!, `[data-test=edit-device-${id}]`)!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=edit-device-modal]")).not.toBeNull());
    await flush(el);
    await flush(el);
    return el;
  }

  async function openPair(api: DashboardApi): Promise<DevicesScreen> {
    const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", {
      api,
      qrFor: vi.fn().mockResolvedValue("data:image/png;base64,FAKE"),
    });
    await flush(el);
    q(el, "[data-test=open-add-device]")!.click();
    await vi.waitFor(() => expect(dq(el.shadowRoot!, "[data-test=pair-r1]")).not.toBeNull());
    await vi.waitFor(() =>
      expect(
        (dq(el.shadowRoot!, "[data-test=pair-r1]") as Field & { disabled: boolean }).disabled,
      ).toBe(false),
    );
    dq(el.shadowRoot!, "[data-test=pair-r1]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=pair-name]")).not.toBeNull());
    await flush(el);
    return el;
  }

  async function saveEdit(el: DevicesScreen): Promise<void> {
    q(el, "[data-test=edit-save]")!.click();
    await flush(el);
  }

  it("a kitchen display chooses its Screen from the kinds its profile offers, then stations within the profile's", async () => {
    const api = ksApi([]);
    const el = await openPair(api);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "pk");
    await flush(el);
    const screen = field(el, "pair-screen");
    expect([screen.name, screen.required, screen.label, screen.value]).toEqual([
      "kitchenScreen",
      true,
      t("devices.kitchen_screen"),
      "",
    ]);
    expect(screen.options).toEqual([
      { value: "station", label: t("device_profiles.kitchen_screen.station") },
      { value: "pass_monitor", label: t("device_profiles.kitchen_screen.pass_monitor") },
    ]);
    expect(q(el, "[data-test=pair-pass]")).toBeNull();
    await chooseOption(screen, "station");
    await flush(el);
    expect(switchesIn(el, "pair-screen-stations")).toEqual([["pair-screen-every-station", true]]);
    expect(q(el, "[data-test=pair-screen-zones]")).toBeNull();
    toggle(el, "pair-screen-every-station", false);
    await flush(el);
    expect(switchesIn(el, "pair-screen-stations")).toEqual([
      ["pair-screen-every-station", false],
      ["pair-screen-station-s1", true],
      ["pair-screen-station-s2", true],
    ]);
    toggle(el, "pair-screen-station-s2", false);
    await flush(el);
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "pk",
      kitchenScreens: [{ kind: "station", stationIds: ["s1"], zoneIds: null }],
    });
  });

  it("a kitchen display on a pass monitor chooses zones within the profile's", async () => {
    const api = ksApi([]);
    const el = await openPair(api);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "pk");
    await flush(el);
    await chooseOption(q(el, "[data-test=pair-screen]")!, "pass_monitor");
    await flush(el);
    expect(switchesIn(el, "pair-screen-zones")).toEqual([["pair-screen-every-zone", true]]);
    toggle(el, "pair-screen-every-zone", false);
    await flush(el);
    expect(switchesIn(el, "pair-screen-zones")).toEqual([
      ["pair-screen-every-zone", false],
      ["pair-screen-zone-z1", true],
      ["pair-screen-zone-z2", true],
    ]);
    toggle(el, "pair-screen-zone-z2", false);
    await flush(el);
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "pk",
      kitchenScreens: [{ kind: "pass_monitor", stationIds: null, zoneIds: ["z1"] }],
    });
  });

  it("a kitchen display with no Screen is refused under Screen, and Pair keeps its action coloured at open", async () => {
    const api = ksApi([]);
    const el = await openPair(api);
    const submit = q(el, "[data-test=pair-submit]") as HTMLElementTagNameMap["wt-button"];
    await submit.updateComplete;
    expect(submit.variant).toBe("primary");
    await chooseOption(q(el, "[data-test=pair-profile]")!, "pk");
    await flush(el);
    submit.click();
    await flush(el);
    expect(api.acceptDeviceJoinRequest).not.toHaveBeenCalled();
    expect(field(el, "pair-screen").error).toBe(codeMessage("kitchen_screen.required"));
  });

  it("a till is paired with a pass monitor its profile offers", async () => {
    const api = ksApi([]);
    const el = await openPair(api);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "pa");
    await flush(el);
    expect(q(el, "[data-test=pair-screen]")).toBeNull();
    expect(switchesIn(el, "pair-station-shows")).toEqual([["pair-station-every", true]]);
    const pass = field(el, "pair-pass");
    expect([pass.label, pass.value]).toEqual([t("devices.pass_screen_shows"), ""]);
    expect(pass.options).toEqual([
      { value: "", label: t("device_profiles.every_station") },
      { value: "pass", label: t("device_profiles.kitchen_screen.pass") },
      { value: "pass_monitor", label: t("device_profiles.kitchen_screen.pass_monitor") },
    ]);
    await chooseOption(pass, "pass_monitor");
    await flush(el);
    expect(switchesIn(el, "pair-screen-stations")).toEqual([["pair-screen-every-station", true]]);
    expect(switchesIn(el, "pair-screen-zones")).toEqual([["pair-screen-every-zone", true]]);
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "pa",
      kitchenScreens: [{ kind: "pass_monitor", stationIds: null, zoneIds: null }],
    });
  });

  it("a till's Kitchen screen choice narrows to chosen stations, and a till sends none when it chooses nothing", async () => {
    const api = ksApi([]);
    const el = await openPair(api);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "pa");
    await flush(el);
    toggle(el, "pair-station-every", false);
    await flush(el);
    expect(switchesIn(el, "pair-station-shows")).toEqual([
      ["pair-station-every", false],
      ["pair-station-station-s1", true],
      ["pair-station-station-s2", true],
      ["pair-station-station-s3", true],
    ]);
    toggle(el, "pair-station-station-s1", false);
    await flush(el);
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "pa",
      kitchenScreens: [{ kind: "station", stationIds: ["s2", "s3"], zoneIds: null }],
    });
  });

  it("a handheld whose profile offers no monitor is offered only the pass screen, and no Kitchen screen it does not show", async () => {
    const api = ksApi([]);
    const el = await openPair(api);
    await chooseOption(q(el, "[data-test=pair-profile]")!, "pb");
    await flush(el);
    expect(q(el, "[data-test=pair-station-shows]")).toBeNull();
    expect(field(el, "pair-pass").options.map((o) => o.value)).toEqual(["", "pass"]);
    q(el, "[data-test=pair-submit]")!.click();
    await vi.waitFor(() => expect(api.acceptDeviceJoinRequest).toHaveBeenCalledTimes(1));
    expect(api.acceptDeviceJoinRequest).toHaveBeenCalledWith("r1", {
      name: "Barra 1",
      profileId: "pb",
      kitchenScreens: [],
    });
  });

  it("changing the profile clears a choice the new profile does not offer", async () => {
    const row = tillRow("t1", [
      {
        kind: "pass_monitor",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: true,
        stations: [slot("s1"), slot("s2"), slot("s3")],
        zones: null,
      },
    ]);
    const api = ksApi([row]);
    const el = await openEdit(api, "t1");
    expect(field(el, "edit-pass").value).toBe("pass_monitor");
    await chooseOption(q(el, "[data-test=edit-profile]")!, "pb");
    await flush(el);
    expect(field(el, "edit-pass").value).toBe("");
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
      profileId: "pb",
      kitchenScreens: [],
    });
  });

  it("Edit lists a removal as no longer available, outside the draft: it opens quiet and its save does not send it back", async () => {
    const row = kds("k1", [
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot("s1"), slot("s3", false)],
        zones: null,
      },
    ]);
    const api = ksApi([row]);
    const el = await openEdit(api, "k1");
    expect(field(el, "edit-screen").value).toBe("station");
    expect(switchesIn(el, "edit-screen-stations")).toEqual([
      ["edit-screen-every-station", false],
      ["edit-screen-station-s1", true],
      ["edit-screen-station-s2", false],
    ]);
    expect(
      [...q(el, "[data-test=edit-gone]")!.querySelectorAll("[data-test=edit-gone-item]")].map(
        (item) => item.textContent!.trim(),
      ),
    ).toEqual([
      `${t("device_profiles.kitchen_screen.station")}: Deli (${t("devices.no_longer_available")})`,
    ]);
    const button = q(el, "[data-test=edit-save]") as HTMLElementTagNameMap["wt-button"];
    await button.updateComplete;
    expect([button.variant, button.disabled]).toEqual(["secondary", true]);
    q(el, "[data-test=edit-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Pantalla 2" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({ name: "Pantalla 2" });
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty("kitchenScreens");
  });

  it("Edit lists a screen kind the profile took as no longer available, and opens with no Pass choice", async () => {
    const row = tillRow("t1", [
      {
        kind: "pass_monitor",
        available: false,
        everyStation: false,
        everyZone: false,
        profileEveryStation: false,
        stations: [],
        zones: null,
      },
    ]);
    const el = await openEdit(ksApi([row]), "t1");
    expect(field(el, "edit-pass").value).toBe("");
    expect(
      [...q(el, "[data-test=edit-gone]")!.querySelectorAll("[data-test=edit-gone-item]")].map(
        (item) => item.textContent!.trim(),
      ),
    ).toEqual([
      `${t("device_profiles.kitchen_screen.pass_monitor")} (${t("devices.no_longer_available")})`,
    ]);
    const button = q(el, "[data-test=edit-save]") as HTMLElementTagNameMap["wt-button"];
    await button.updateComplete;
    expect(button.variant).toBe("secondary");
  });

  it("Edit reads a list the read calls every as Every, and a rename leaves the stored choice alone", async () => {
    const row = kds("k1", [
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot("s1"), slot("s2")],
        zones: null,
      },
    ]);
    const api = ksApi([row]);
    const el = await openEdit(api, "k1");
    expect(switchesIn(el, "edit-screen-stations")).toEqual([["edit-screen-every-station", true]]);
    expect(q(el, "[data-test=edit-gone]")).toBeNull();
    q(el, "[data-test=edit-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Pantalla 2" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty("kitchenScreens");
  });

  it("Edit sends a changed choice, and a changed choice turns Save on", async () => {
    const row = kds("k1", [
      {
        kind: "station",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot("s1"), slot("s2")],
        zones: null,
      },
    ]);
    const api = ksApi([row]);
    const el = await openEdit(api, "k1");
    await chooseOption(q(el, "[data-test=edit-screen]")!, "pass_monitor");
    await flush(el);
    const button = q(el, "[data-test=edit-save]") as HTMLElementTagNameMap["wt-button"];
    await button.updateComplete;
    expect(button.variant).toBe("primary");
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
      kitchenScreens: [{ kind: "pass_monitor", stationIds: null, zoneIds: null }],
    });
  });

  it("Edit keeps an explicit list holding all its profile allows as that list, and a rename sends no kitchen screens", async () => {
    const row = kds("k1", [
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot("s1"), slot("s2"), slot("s3", false)],
        zones: null,
      },
    ]);
    const api = ksApi([row]);
    const el = await openEdit(api, "k1");
    expect(switchesIn(el, "edit-screen-stations")).toEqual([
      ["edit-screen-every-station", false],
      ["edit-screen-station-s1", true],
      ["edit-screen-station-s2", true],
    ]);
    q(el, "[data-test=edit-name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Pantalla 2" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).not.toHaveProperty("kitchenScreens");
  });

  describe("a till whose profile bounds its Kitchen screen", () => {
    const bounded = [
      ...offered.filter((entry) => entry.profileId !== "pa"),
      {
        profileId: "pa",
        screens: {
          station: { stationIds: ["s1", "s2"], zoneIds: null },
          pass_monitor: { stationIds: null, zoneIds: null },
        },
      },
    ];
    const tillWith = (everyStation: boolean) =>
      tillRow("t1", [
        {
          kind: "station",
          available: true,
          everyStation,
          everyZone: true,
          profileEveryStation: false,
          stations: [slot("s1"), slot("s2")],
          zones: null,
        },
      ]);

    it.each([
      ["an explicit list holding all it allows", false, ["s1", "s2"]],
      ["every station the profile allows", true, null],
    ])(
      "keeps %s in what it sends when only the Pass choice changes",
      async (_, everyStation, stationIds) => {
        const api = ksApi([tillWith(everyStation)], {
          listProfileKitchenScreens: vi.fn().mockResolvedValue(bounded),
        });
        const el = await openEdit(api, "t1");
        expect(sw(el, "edit-station-every").checked).toBe(everyStation);
        await chooseOption(q(el, "[data-test=edit-pass]")!, "pass_monitor");
        await flush(el);
        await saveEdit(el);
        await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
        expect(vi.mocked(api.updateDevice).mock.calls[0]![1]).toMatchObject({
          kitchenScreens: [
            { kind: "station", stationIds, zoneIds: null },
            { kind: "pass_monitor", stationIds: null, zoneIds: null },
          ],
        });
      },
    );

    it("labels an explicit every as the profile's stations, and no choice as every station", async () => {
      const api = ksApi([tillWith(true), tillRow("t2", [])], {
        listProfileKitchenScreens: vi.fn().mockResolvedValue(bounded),
      });
      const chosen = await openEdit(api, "t1");
      expect(sw(chosen, "edit-station-every").label).toBe(t("devices.every_station_profile"));
      const none = await openEdit(api, "t2");
      expect(sw(none, "edit-station-every").label).toBe(t("device_profiles.every_station"));
      expect(field(none, "edit-pass").options[0]).toEqual({
        value: "",
        label: t("device_profiles.every_station"),
      });
    });
  });

  it.each([
    [{ code: "station.not_allowed", params: { stationId: "s2", screen: "pass_monitor" } }, "pass"],
    [{ code: "station.not_allowed", params: { stationId: "s2", screen: "station" } }, "station"],
    [
      {
        code: "kitchen_screen.invalid",
        params: { field: "stationIds", reason: "not_found", screen: "station" },
      },
      "station",
    ],
    [
      {
        code: "kitchen_screen.invalid",
        params: { field: "stationIds", reason: "not_found", screen: "pass_monitor" },
      },
      "pass",
    ],
  ])(
    "a till holding two station lists places %o under the %s list it names",
    async (error, under) => {
      const list = (kind: "station" | "pass_monitor") => ({
        kind,
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        stations: [slot("s1"), slot("s2")],
        zones: null,
      });
      const api = ksApi([tillRow("t1", [list("station"), list("pass_monitor")])], {
        updateDevice: vi.fn().mockRejectedValue(error),
      });
      const el = await openEdit(api, "t1");
      toggle(el, "edit-station-station-s3", true);
      await flush(el);
      await saveEdit(el);
      await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
      await flush(el);
      const message = codeMessage(error.code);
      const other = under === "pass" ? "edit-station-shows" : "edit-screen-stations";
      expect(groupError(el, under === "pass" ? "edit-screen-stations" : "edit-station-shows")).toBe(
        message,
      );
      expect(groupError(el, other)).toBe("");
    },
  );

  it.each([
    [{ code: "kitchen_screen.required", params: {} }, "screen"],
    [{ code: "kitchen_screen.not_allowed", params: { screen: "station" } }, "screen"],
    [
      { code: "kitchen_screen.invalid", params: { field: "screens", reason: "one_only" } },
      "screen",
    ],
    [
      { code: "kitchen_screen.invalid", params: { field: "stationIds", reason: "empty" } },
      "stations",
    ],
    [{ code: "station.not_allowed", params: { stationId: "s2" } }, "stations"],
    [
      { code: "kitchen_screen.invalid", params: { field: "zoneIds", reason: "not_found" } },
      "zones",
    ],
    [{ code: "kitchen_screen.zone_not_allowed", params: { zoneId: "z2" } }, "zones"],
  ])("a kitchen display's refusal %o shows under its %s", async (error, under) => {
    const row = kds("k1", [
      {
        kind: "pass_monitor",
        available: true,
        everyStation: false,
        everyZone: false,
        profileEveryStation: true,
        stations: [slot("s1"), slot("s2")],
        zones: [slot("z1")],
      },
    ]);
    const api = ksApi([row], { updateDevice: vi.fn().mockRejectedValue(error) });
    const el = await openEdit(api, "k1");
    toggle(el, "edit-screen-zone-z2", true);
    await flush(el);
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    await flush(el);
    const message = codeMessage(error.code);
    if (under === "screen") expect(field(el, "edit-screen").error).toBe(message);
    else expect(groupError(el, `edit-screen-${under}`)).toBe(message);
  });

  it.each([
    [{ code: "kitchen_screen.not_allowed", params: { screen: "pass_monitor" } }, "pass"],
    [{ code: "kitchen_screen.not_allowed", params: { screen: "station" } }, "station"],
    [{ code: "station.not_allowed", params: { stationId: "s2", screen: "station" } }, "station"],
  ])("a till's refusal %o shows under its %s choice", async (error, under) => {
    const row = tillRow("t1", [
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: true,
        stations: [slot("s1"), slot("s2")],
        zones: null,
      },
      {
        kind: "pass_monitor",
        available: true,
        everyStation: true,
        everyZone: true,
        profileEveryStation: true,
        stations: [slot("s1"), slot("s2"), slot("s3")],
        zones: null,
      },
    ]);
    const api = ksApi([row], { updateDevice: vi.fn().mockRejectedValue(error) });
    const el = await openEdit(api, "t1");
    toggle(el, "edit-station-station-s3", true);
    await flush(el);
    await saveEdit(el);
    await vi.waitFor(() => expect(api.updateDevice).toHaveBeenCalledTimes(1));
    await flush(el);
    const message = codeMessage(error.code);
    if (under === "pass") expect(field(el, "edit-pass").error).toBe(message);
    else expect(groupError(el, "edit-station-shows")).toBe(message);
  });

  it("an explicit list emptied is marked under it and holds Save", async () => {
    const row = kds("k1", [
      {
        kind: "station",
        available: true,
        everyStation: false,
        everyZone: true,
        profileEveryStation: false,
        stations: [slot("s1")],
        zones: null,
      },
    ]);
    const api = ksApi([row]);
    const el = await openEdit(api, "k1");
    toggle(el, "edit-screen-station-s1", false);
    await flush(el);
    await saveEdit(el);
    expect(api.updateDevice).not.toHaveBeenCalled();
    expect(groupError(el, "edit-screen-stations")).toBe(t("device_profiles.err_list_empty"));
  });

  for (const [locale, every, everyZone, gone] of [
    ["en", "every station", "every zone", "(Deli no longer available)"],
    ["es-ES", "todas las estaciones", "todas las zonas", "(Deli ya no está disponible)"],
  ] as const) {
    it(`the device list reads out each device's kitchen screens in ${locale}`, async () => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const liveData = new LiveData();
        const rows = [
          kds("k1", [
            {
              kind: "station",
              available: true,
              everyStation: false,
              everyZone: true,
              profileEveryStation: false,
              stations: [slot("s1"), slot("s2")],
              zones: null,
            },
          ]),
          tillRow("t1", [
            {
              kind: "pass",
              available: true,
              everyStation: true,
              everyZone: false,
              profileEveryStation: true,
              stations: [slot("s1"), slot("s2"), slot("s3")],
              zones: [slot("z1")],
            },
          ]),
          tillRow("t2", [
            {
              kind: "pass_monitor",
              available: true,
              everyStation: true,
              everyZone: true,
              profileEveryStation: true,
              stations: [slot("s1"), slot("s2"), slot("s3")],
              zones: null,
            },
          ]),
          kds("k2", [
            {
              kind: "station",
              available: true,
              everyStation: false,
              everyZone: true,
              profileEveryStation: false,
              stations: [slot("s1"), slot("s3", false)],
              zones: null,
            },
          ]),
        ];
        const api = Object.assign(
          ksApi(rows, {
            listProfileKitchenScreens: vi.fn().mockResolvedValue([
              {
                profileId: "pk",
                screens: { station: { stationIds: ["s1", "s2", "s3"], zoneIds: null } },
              },
              { profileId: "pa", screens: { pass_monitor: { stationIds: null, zoneIds: null } } },
            ]),
          }),
          { liveData },
        );
        const { el } = await mountWidget<DevicesScreen>("dashboard-devices-screen", { api });
        await flush(el);
        const kind = (k: "station" | "pass" | "pass_monitor") =>
          t(`device_profiles.kitchen_screen.${k}`);
        expect(deepText(el, "[data-test=device-screen-k1-station]")).toBe(
          `${kind("station")}: Cocina, Barra`,
        );
        expect(deepText(el, "[data-test=device-screen-t1-pass]")).toBe(
          `${kind("pass")}: ${every} · Terraza`,
        );
        expect(deepText(el, "[data-test=device-screen-t2-pass_monitor]")).toBe(
          `${kind("pass_monitor")}: ${every} · ${everyZone}`,
        );
        expect(deepText(el, "[data-test=device-screen-k2-station]")).toBe(
          `${kind("station")}: Cocina ${gone}`,
        );

        vi.mocked(api.listDevices).mockResolvedValue([
          kds("k2", [
            {
              kind: "station",
              available: true,
              everyStation: false,
              everyZone: true,
              profileEveryStation: false,
              stations: [slot("s1"), slot("s3")],
              zones: null,
            },
          ]),
        ]);
        liveData.invalidate([{ type: "devices", id: "k2" }]);
        await vi.waitFor(() =>
          expect(deepText(el, "[data-test=device-screen-k2-station]")).toBe(
            `${kind("station")}: Cocina, Deli`,
          ),
        );
      } finally {
        setLocale(before);
      }
    });
  }
});

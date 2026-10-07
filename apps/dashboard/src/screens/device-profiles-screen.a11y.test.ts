import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./device-profiles-screen.js";
import type { DeviceProfilesScreen } from "./device-profiles-screen.js";
import type {
  Canvas,
  DeviceProfile,
  DashboardApi,
  PersonSummary,
  Printer,
  ProfileScopeChoices,
  Station,
  Watcher,
} from "../api/client.js";

/**
 * Scanned in LIST and EDITOR mode. The `api` stub must resolve `listDeviceProfiles`, `listCanvases`,
 * `listPrinters` and `getDeviceProfile`, or a stray rejection pollutes the run.
 */
const canvases: Canvas[] = [{ id: "c1", name: "Counter till", definition: {} }];

const profiles: DeviceProfile[] = [
  {
    id: "p1",
    name: "Front counter",
    canvasId: "c1",
    capabilities: ["integrated-card-payment"],
    formFactor: "till",
    inactivityTimeoutSeconds: null,
    receiptPrinterIds: ["pr2", "pr1"],
    paymentSlipPrinterIds: ["pr-old"],
    cashDrawerPrinterIds: [],
    receiptPrinterDefaultId: null,
    paymentSlipPrinterDefaultId: null,
    cashDrawerPrinterDefaultId: null,
    startingScreen: null,
    departmentId: "d1",
    allowedZoneIds: null,
    startingZoneId: "z1",
    admittedRoles: ["staff", "supervisor", "manager", "admin"],
    personExceptions: [],
  },
];

const scopeChoices: ProfileScopeChoices = {
  departments: [{ id: "d1", name: "Restaurante", active: true }],
  zones: [
    { id: "z1", name: "Comedor", departmentId: "d1", active: true },
    { id: "z2", name: "Terraza", departmentId: "d1", active: true },
  ],
};

const staff: PersonSummary[] = [
  {
    personId: "pe-ana",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: true,
    hasTotp: false,
    email: null,
  },
];

function printer(id: string, name: string, active = true): Printer {
  return {
    id,
    name,
    transport: "network_tcp",
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
    pendingJobs: 0,
    lastPrintAt: null,
    lastPrintAgentId: null,
    active,
  };
}

/** Two on the receipt list, one off it, and a switched-off one the slip list still holds. */
const venuePrinters = [
  printer("pr1", "Barra"),
  printer("pr2", "Cocina"),
  printer("pr3", "Terraza"),
  printer("pr-old", "Vieja", false),
];

function stubApi(
  printers: Printer[] = venuePrinters,
  overrides: Partial<DashboardApi> = {},
): DashboardApi {
  return {
    listPrinters: vi.fn().mockResolvedValue(printers),
    listDeviceProfiles: vi.fn().mockResolvedValue(profiles),
    getDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    createDeviceProfile: vi.fn().mockResolvedValue({ ...profiles[0], id: "p9" }),
    updateDeviceProfile: vi.fn().mockResolvedValue(profiles[0]),
    deleteDeviceProfile: vi.fn().mockResolvedValue(undefined),
    listCanvases: vi.fn().mockResolvedValue(canvases),
    listStations: vi.fn().mockResolvedValue([]),
    listWatchers: vi.fn().mockResolvedValue([]),
    listProfileKitchenLists: vi.fn().mockResolvedValue([]),
    getProfileScopeChoices: vi.fn().mockResolvedValue(scopeChoices),
    listStaff: vi.fn().mockResolvedValue(staff),
    listReaders: vi.fn().mockResolvedValue([]),
    getProfileReaders: vi.fn().mockResolvedValue({ readerIds: [], defaultReaderId: null }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: DeviceProfilesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("device-profiles-screen a11y (%s theme)", (theme) => {
  it("renders the profile gallery with its controls accessibly", async () => {
    const { el, host } = await mountWidget<DeviceProfilesScreen>(
      "dashboard-device-profiles-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the editor form accessibly", async () => {
    const { el, host } = await mountWidget<DeviceProfilesScreen>(
      "dashboard-device-profiles-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
    await flush(el);
    await vi.waitFor(() => {
      if (!el.shadowRoot!.querySelector("[data-test=receipt-printers-up-pr1]"))
        throw new Error("printer lists");
    });
    // Both printer lists, with order buttons and a switched-off printer still listed.
    expect(el.shadowRoot!.querySelector("[data-test=receipt-printers-up-pr1]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=payment-slip-printers-pr-old]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it.each([390, 1280])(
    "renders the drawer list, each list's default, the card readers and a refusal under a default accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const equipped: DeviceProfile = {
        ...profiles[0]!,
        cashDrawerPrinterIds: ["pr2"],
        receiptPrinterDefaultId: "pr1",
      };
      const api = stubApi(
        [...venuePrinters, { ...printer("pr-drawer", "Caja"), hasCashDrawer: true }],
        {
          getDeviceProfile: vi.fn().mockResolvedValue(equipped),
          listReaders: vi.fn().mockResolvedValue([
            {
              id: "r1",
              provider: "acme",
              name: "Mostrador",
              active: true,
              canEnable: true,
              deviceCount: 0,
            },
            {
              id: "r2",
              provider: "acme",
              name: "Terraza",
              active: true,
              canEnable: true,
              deviceCount: 0,
            },
          ]),
          getProfileReaders: vi
            .fn()
            .mockResolvedValue({ readerIds: ["r1"], defaultReaderId: "r1" }),
          updateDeviceProfile: vi.fn().mockRejectedValue({
            code: "device_profile.invalid",
            params: { reason: "default_not_listed", field: "receiptPrinterDefaultId" },
          }),
        },
      );
      const { el, host } = await mountWidget<DeviceProfilesScreen>(
        "dashboard-device-profiles-screen",
        { api },
        theme,
      );
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
      await flush(el);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=profile-readers]")).not.toBeNull(),
      );
      expect(el.shadowRoot!.querySelector("[data-test=cash-drawer-printers-pr2]")).not.toBeNull();
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      await flush(el);
      await flush(el);
      expect(
        (
          el.shadowRoot!.querySelector("[data-test=receipt-printers-default]") as HTMLElement & {
            error: string;
          }
        ).error,
      ).not.toBe("");
      expect(el.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );

  it.each([390, 1280])(
    "renders a kitchen display's station and watcher lists, and a refusal under them, accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const kitchen: DeviceProfile = {
        ...profiles[0]!,
        id: "p2",
        name: "Kitchen",
        formFactor: "kds",
        capabilities: [],
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [],
      };
      const station = (id: string, name: string, active = true): Station => ({
        id,
        name,
        displayOrder: 0,
        isDefault: false,
        active,
        showsRestOfOrder: false,
        warmAfterMinutes: 5,
        overdueAfterMinutes: 10,
        forgottenAfterMinutes: 15,
      });
      const watcher: Watcher = {
        id: "w1",
        name: "Pass",
        everyStation: true,
        stationIds: [],
        everyZone: true,
        zoneIds: [],
        runsPass: false,
        displayOrder: 0,
        active: true,
        printerIds: [],
      };
      const api = stubApi(venuePrinters, {
        listDeviceProfiles: vi.fn().mockResolvedValue([...profiles, kitchen]),
        getDeviceProfile: vi.fn().mockResolvedValue(kitchen),
        listStations: vi
          .fn()
          .mockResolvedValue([
            station("s1", "Grill"),
            station("s2", "Cold"),
            station("s-off", "Old grill", false),
          ]),
        listWatchers: vi.fn().mockResolvedValue([watcher]),
        listProfileKitchenLists: vi
          .fn()
          .mockResolvedValue([{ profileId: "p2", stationIds: ["s1", "s-off"], watcherIds: [] }]),
        updateDeviceProfile: vi.fn().mockRejectedValue({
          code: "device_profile.station_in_use",
          params: { stationId: "s1", deviceId: "d1", deviceName: "Grill screen" },
        }),
      });
      const { el, host } = await mountWidget<DeviceProfilesScreen>(
        "dashboard-device-profiles-screen",
        { api },
        theme,
      );
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p2]")!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=profile-station-s-off]")).not.toBeNull();
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector("[data-test=profile-station-s1]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { checked: false }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=profile-stations-error]")).not.toBeNull();
      expect(el.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );

  it.each([390, 1280])(
    "renders where a profile serves, who signs in and its field errors accessibly at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<DeviceProfilesScreen>(
        "dashboard-device-profiles-screen",
        {
          api: stubApi(venuePrinters, {
            updateDeviceProfile: vi.fn().mockRejectedValue({
              code: "device_profile.access_invalid",
              params: { field: "startingZoneId", reason: "unavailable" },
            }),
          }),
        },
        theme,
      );
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-p1]")!.click();
      await flush(el);
      const toggle = (test: string, checked: boolean) =>
        el
          .shadowRoot!.querySelector(`[data-test=${test}]`)!
          .dispatchEvent(
            new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
          );
      toggle("profile-every-zone", false);
      toggle("cap-show-schedule", true);
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
        "[data-test=profile-people]",
      )!.open = true;
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=profile-zone-z2]")).not.toBeNull();
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      await flush(el);
      for (const role of ["staff", "supervisor", "manager", "admin"])
        toggle(`profile-role-${role}`, false);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=profile-save]")!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=profile-roles-error]")).not.toBeNull();
      expect(el.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.viewport(1280, 900);
    },
  );

  it("renders the line asking for a printer first accessibly", async () => {
    const { el, host } = await mountWidget<DeviceProfilesScreen>(
      "dashboard-device-profiles-screen",
      { api: stubApi([]) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-printers]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

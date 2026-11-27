import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { passBoard, passCard, passItem } from "../test/pass-board-fixtures.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillPassScreen } from "./screens/till-pass-screen.js";
import type { TillPassBoard } from "./widgets/pass-board.js";
import type { CapabilityFlag } from "./layout.js";
import type { TillApi } from "./api/client.js";
import type { DevicePassBoard } from "./api/kitchen-api.js";
import type { KitchenScreenKind } from "./api/device-session-api.js";
import type { ZoneOffers } from "./api/menu-api.js";

const previousLocale = currentLocale();
beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

const till = {
  locale: "es-ES",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: "till",
  capabilities: ["show-expo"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

const counterOffers: ZoneOffers = {
  service: {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    keepOpen: null,
    zoneKeepOpen: null,
  },
  context: {
    dining: null,
    departmentName: "Restaurant",
    zoneId: "zone-counter",
    departmentId: "department-default",
    serviceMode: "prepay",
  },
  defaultMenuId: null,
  menus: servedMenus(
    [{ id: "cat-default", name: "Main menu", isDefault: true, versionId: "v1" }],
    [],
  ),
  offers: [],
};

const fireCard = passCard({
  key: "group:g-1",
  target: { kind: "group", partyId: "p-1", groupId: "g-1" },
  kind: "next_course",
  items: [passItem({ id: "a", phase: "requested", firedAt: null })],
  releaseTicketItemIds: ["r-1"],
  releaseContext: "ctx-1",
});
const deviceBoard = (): DevicePassBoard => ({
  board: passBoard({ toFire: [fireCard] }),
  stations: [],
  zones: null,
  display: { showNonPassStations: true },
});

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue(till),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal", status: 404 }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      kitchenScreens: [],
    }),
    reportBattery: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue([]),
    getLocales: vi.fn().mockResolvedValue({
      locales: [{ code: "es-ES", label: "Español" }],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
    getDeviceStationScreen: vi.fn().mockResolvedValue({ stations: [] }),
    getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()),
    releaseDevicePass: vi.fn().mockResolvedValue({ releasedTicketItemIds: ["r-1"] }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    listZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillApp): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await passScreen(el)?.updateComplete;
    await boardOf(el)?.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const passScreen = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillPassScreen>("till-pass-screen");
const boardOf = (el: TillApp) =>
  passScreen(el)?.shadowRoot?.querySelector<TillPassBoard>("till-pass-board") ?? null;
const fireButton = (el: TillApp) =>
  boardOf(el)!.shadowRoot!.querySelector<HTMLButtonElement>('[data-pass-fire="group:g-1"]');

async function mountDisplay(kind: KitchenScreenKind, capabilities: CapabilityFlag[]) {
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({ ...till, formFactor: "kds", capabilities }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "kd-1",
      name: "Pantalla Pase",
      formFactor: "kds",
      kitchenScreens: [{ kind, available: true, stations: [], zones: null }],
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  return { el, api: api as TillApi & Record<string, ReturnType<typeof vi.fn>> };
}

describe("A773 pass screen: app", () => {
  it.each([
    ["station", ["show-station", "show-expo"], ["Grill", "Cold"]],
    ["pass", ["show-station", "show-expo"], ["Pase"]],
    ["pass_monitor", ["show-station", "show-expo"], ["Monitor del pase"]],
    [null, ["show-station", "show-expo"], []],
    ["station", [], []],
    ["pass", [], []],
    ["pass_monitor", [], []],
  ] as const)(
    "offers the narrow floor kitchen rows for %s with %j",
    async (kind, capabilities, rows) => {
      const viewport = [innerWidth, innerHeight] as const;
      onTestFinished(() => page.viewport(...viewport));
      await page.viewport(390, 844);
      const stations = [
        { id: "grill", name: "Grill", displayOrder: 0, isDefault: true, active: true, open: true },
        { id: "cold", name: "Cold", displayOrder: 1, isDefault: false, active: true, open: true },
        {
          id: "closed",
          name: "Closed",
          displayOrder: 2,
          isDefault: false,
          active: true,
          open: true,
        },
      ];
      const slots = stations.map(({ id, name }) => ({ id, name, available: id !== "closed" }));
      const api = stubApi({
        getTill: vi.fn().mockResolvedValue({
          ...till,
          formFactor: "phone-portrait",
          capabilities: [...capabilities],
        }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "handheld",
          formFactor: "phone-portrait",
          name: "Handheld",
          kitchenScreens:
            kind === null
              ? []
              : [
                  {
                    kind,
                    available: true,
                    stations: slots,
                    zones: null,
                    showNonPassStations: true,
                  },
                ],
        }),
        getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture([], ["room"])),
        listZones: vi.fn().mockResolvedValue([
          {
            id: "room",
            name: "Room",
            displayOrder: 0,
            active: true,
            closed: false,
            hasPlan: true,
            layoutSetName: null,
            layoutDue: null,
            serviceMode: "table_tab",
            closesAt: null,
          },
        ]),
        listStations: vi.fn().mockResolvedValue(stations),
      });
      const { el } = await mountWidget<TillApp>("till-app", { api });
      await flush(el);
      emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
        personId: "p1",
        displayName: "Staff",
        permissions: [],
      });
      await flush(el);
      const shell = el.shadowRoot!.querySelector("till-shell")!;
      const chooser = () => shell.shadowRoot!.querySelector("[data-floor-zone-chooser]");
      const trigger = () => chooser()?.shadowRoot?.querySelector("button");
      await vi.waitFor(() => expect(trigger()).toBeInstanceOf(HTMLButtonElement));
      const more = shell.shadowRoot!.querySelector("[data-floor-bar] .floor-menu")!;
      await userEvent.click(trigger()!);
      const kitchen = page.getByRole("group", { name: "Pantallas de cocina" });
      expect(
        kitchen
          .elements()
          .flatMap((group) =>
            Array.from(group.querySelectorAll("wt-menu-row"), (row) => row.getAttribute("label")),
          ),
      ).toEqual(rows);
      expect(more.querySelector(".station, .expo")).toBeNull();
      if (rows.length === 0) return;
      if (kind === "station") {
        await kitchen.getByRole("menuitem", { name: "Cold", exact: true }).click();
        await vi.waitFor(() => {
          const screen = el.shadowRoot!.querySelector("till-station-screen");
          expect(screen?.shadowRoot!.querySelector("till-station-queue")).toHaveProperty(
            "stationId",
            "cold",
          );
        });
        expect(location.pathname).toMatch(/\/view\/station\/station\/cold$/u);
      } else {
        await kitchen.getByRole("menuitem", { name: rows[0], exact: true }).click();
        await vi.waitFor(() =>
          expect(boardOf(el)).toHaveProperty("mode", kind === "pass" ? "pass" : "monitor"),
        );
      }
      expect(shell.shadowRoot!.querySelector(".head")).toBeNull();
      await page.getByRole("button", { name: "Atrás", exact: true }).click();
      await vi.waitFor(() => expect(trigger()?.matches(":focus")).toBe(true));
      expect(location.pathname).not.toContain("/view/");
      expect(chooser()?.textContent).toContain("Room");
    },
  );

  it("a kitchen display without act-as-kds mounts no pass or station screen", async () => {
    const { el } = await mountDisplay("pass", ["run-the-pass"]);
    expect(passScreen(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-station-screen")).toBeNull();
  });

  it("a kitchen display with act-as-kds and a pass choice mounts the pass, whose Fire releases through the device route", async () => {
    const { el, api } = await mountDisplay("pass", ["act-as-kds", "run-the-pass"]);
    const screen = passScreen(el);
    expect(screen).not.toBeNull();
    expect(screen!.monitor).toBe(false);
    expect(screen!.deviceMode).toBe(true);
    expect(screen!.deviceId).toBe("kd-1");
    expect(screen!.serverOrigin).toBe(location.origin);
    await userEvent.click(fireButton(el)!);
    await flush(el);
    expect(api.releaseDevicePass).toHaveBeenCalledOnce();
    expect(vi.mocked(api.releaseDevicePass).mock.calls[0]![0]).toMatchObject({
      target: { kind: "group", partyId: "p-1", groupId: "g-1" },
      ticketItemIds: ["r-1"],
      expectedContext: "ctx-1",
    });
  });

  it("a kitchen display with a monitor choice mounts the pass in monitor mode, with no Fire", async () => {
    const { el, api } = await mountDisplay("pass_monitor", ["act-as-kds", "run-the-pass"]);
    const screen = passScreen(el);
    expect(screen).not.toBeNull();
    expect(screen!.monitor).toBe(true);
    expect(screen!.deviceId).toBe("kd-1");
    expect(screen!.serverOrigin).toBe(location.origin);
    expect(boardOf(el)).not.toBeNull();
    expect(boardOf(el)!.shadowRoot!.querySelector("[data-pass-fire]")).toBeNull();
    expect(api.releaseDevicePass).not.toHaveBeenCalled();
  });

  it("the till's configured Pass drill uses its profile board, and Back returns to the counter", async () => {
    const api = stubApi({
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "till-dev",
        name: "Till 1",
        formFactor: "till",
        kitchenScreens: [{ kind: "pass", available: true, stations: [], zones: null }],
      }),
    }) as TillApi & Record<string, ReturnType<typeof vi.fn>>;
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
      personId: "p1",
      displayName: "Ana",
      permissions: [],
    });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "show-expo");
    await flush(el);
    const screen = passScreen(el);
    expect(screen).not.toBeNull();
    expect(screen!.getAttribute("slot")).toBe("drill");
    expect(screen!.deviceId).toBe("till-dev");
    expect(screen!.serverOrigin).toBe(location.origin);
    expect(api.getDevicePassBoard).toHaveBeenCalled();
    expect(boardOf(el)).not.toBeNull();
    screen!.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
    await flush(el);
    expect(passScreen(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
  });
});

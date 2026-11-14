import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { passBoard, passCard, passItem } from "../test/pass-board-fixtures.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillPassScreen } from "./screens/till-pass-screen.js";
import type { TillPassBoard } from "./widgets/pass-board.js";
import type { CapabilityFlag } from "./layout.js";
import type {
  DevicePassBoard,
  KitchenScreenKind,
  TillApi,
  ZoneOfferCatalogue,
} from "./api/client.js";

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

const counterOffers: ZoneOfferCatalogue = {
  service: {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    keepOpen: null,
    zoneKeepOpen: null,
  },
  context: {
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
  display: { showNonPassStations: true, nonPassStationsOverride: null },
});

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue(till),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
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
    getExpoBoard: vi.fn().mockResolvedValue({ board: passBoard({ toFire: [fireCard] }) }),
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

  it("the till's Pass drill with no pass choice mounts the pass on the venue's board, and Back returns to the counter", async () => {
    const api = stubApi() as TillApi & Record<string, ReturnType<typeof vi.fn>>;
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
    expect(api.getExpoBoard).toHaveBeenCalled();
    expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    expect(boardOf(el)).not.toBeNull();
    screen!.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
    await flush(el);
    expect(passScreen(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
  });
});

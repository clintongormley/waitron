import { afterEach, expect, it, vi } from "vitest";
import { deviceZonesFixture } from "../test/device-zones.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { FloorZone, TableState, TillApi } from "./api/client.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const offered: FloorZone = {
  id: "z1",
  name: "Room",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: "Lunch",
  layoutDue: { setId: "set-dinner", revision: 3, periodName: "Dinner" },
  serviceMode: "table_tab",
};
const updated: FloorZone = { ...offered, layoutSetName: "Dinner", layoutDue: null };

const placed: TableState = {
  id: "t1",
  label: "1",
  zoneId: "z1",
  state: "free",
  condition: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  today: {
    placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 5,
  },
  signals: [],
  party: null,
};

async function mount(over: Record<string, unknown>) {
  setLocale("en-GB");
  const api = {
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "en-GB" }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getTill: vi.fn().mockResolvedValue({
      locale: "en-GB",
      invoiceLocale: "en-GB",
      venueName: "Restaurant",
      nif: "B12345678",
      orderFlow: "prepay",
      bumpMode: "line",
      fireControl: "waiter",
      courses: [],
      cardProvider: "none",
      tipsEnabled: false,
      formFactor: "till",
      capabilities: ["take-orders"],
      inactivityTimeoutSeconds: null,
      nodeId: "node",
      servers: [],
    }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "device",
      name: "Till",
      formFactor: "till",
      profileId: "profile",
    }),
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture([], ["z1"])),
    listDefaultZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    listZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    setServiceZone: vi.fn(),
    listStaff: vi.fn().mockResolvedValue([]),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
    getTablesState: vi.fn().mockResolvedValue([placed]),
    listStatuses: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
    putLocale: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const { el } = await mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { personId: "person", displayName: "Ana", permissions: [], locale: "en-GB" },
      bubbles: true,
      composed: true,
    }),
  );
  const floor = () => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
  await vi.waitFor(() =>
    expect(floor()?.shadowRoot?.querySelector("[data-layout-due]")).toBeTruthy(),
  );
  return { el, floor: floor()!, api };
}

const banner = (floor: TillFloorScreen) => floor.shadowRoot!.querySelector("[data-layout-due]");

async function press(floor: TillFloorScreen): Promise<void> {
  floor.shadowRoot!.querySelector<HTMLElement>("[data-update-layout]")!.click();
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await floor.updateComplete;
  }
}

it("re-reads the zones and the tables after Update layout, so the banner goes at once", async () => {
  const listZones = vi.fn().mockResolvedValueOnce([offered]).mockResolvedValue([updated]);
  const updateLayoutToday = vi.fn().mockResolvedValue({ zoneId: "z1", revision: 6 });
  const { floor, api } = await mount({ listZones, updateLayoutToday });
  const zoneReads = listZones.mock.calls.length;
  const tableReads = api.getTablesState.mock.calls.length;
  await press(floor);
  expect(updateLayoutToday).toHaveBeenCalledExactlyOnceWith(
    "z1",
    { setId: "set-dinner", revision: 3 },
    5,
  );
  expect(listZones.mock.calls.length).toBe(zoneReads + 1);
  expect(api.getTablesState.mock.calls.length).toBe(tableReads + 1);
  expect(banner(floor)).toBeNull();
});

it("re-reads both after a layout_changed refusal and shows what is now due", async () => {
  const later = { ...offered, layoutDue: { setId: "set-late", revision: 1, periodName: "Late" } };
  const listZones = vi.fn().mockResolvedValueOnce([offered]).mockResolvedValue([later]);
  const updateLayoutToday = vi
    .fn()
    .mockRejectedValue({ code: "floor_today.layout_changed", zoneId: "z1" });
  const { floor, api } = await mount({ listZones, updateLayoutToday });
  const tableReads = api.getTablesState.mock.calls.length;
  await press(floor);
  expect(api.getTablesState.mock.calls.length).toBe(tableReads + 1);
  expect(banner(floor)!.querySelector('[role="status"]')!.textContent!.trim()).toBe(
    "Late layout is ready.",
  );
  expect(floor.shadowRoot!.querySelector("[data-floor-refusal]")!.textContent!.trim()).toBe(
    codeMessage("floor_today.layout_changed"),
  );
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { answeredPartyAllergy } from "../test/answered-party-allergy.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import {
  adjustmentStubs,
  cleanupWidgets,
  draftServer,
  mountWidget,
  pageAt,
  resetPage,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillApi } from "./api/client.js";
import type { FloorZone, PartyBill, TableState } from "./api/floor-api.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";

const locale = currentLocale();
let drafts: DraftServer;
beforeEach(() => {
  drafts = draftServer(() => ({ tabId: "wo-7", revision: 4, groups: [] }));
  drafts.bills.add("wo-7");
});
const initialUrl = location.href;
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale(locale);
  history.replaceState(null, "", initialUrl);
});

const room: FloorZone = {
  id: "z1",
  name: "Room",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

const freeTable: TableState = {
  id: "t1",
  label: "1",
  shortName: "1",
  zoneId: "z1",
  state: "free",
  condition: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: null,
  signals: [],
  party: null,
};

const openTable: TableState = {
  ...freeTable,
  id: "t2",
  label: "2",
  shortName: "2",
  state: "open-tab",
  hasOpenTab: true,
  tabLineCount: 1,
  tabTotal: "3.00",
  pendingToServe: 1,
  party: {
    kitchenNote: { scope: { partyId: "v-2" }, note: null, revision: 0, ownerRevision: 3 },
    id: "v-2",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "2",
    openingBillId: "wo-7",
    outstanding: "3.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
  },
};

const openBill: PartyBill = {
  dining: "eat_in",
  diningChoice: "none",
  discounts: [],
  workingOrderId: "wo-7",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v-2",
  label: null,
  billNumber: 1,
  billName: null,
  status: "open",
  total: "3.00",
  outstanding: "3.00",
  hasPayments: false,
  receiptAvailable: false,
};

/** `counter` puts a counter zone first, so the till opens on the counter and the Floor is a tap. */
function stubApi(over: Record<string, unknown>, counter = false) {
  return {
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
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(counter ? undefined : [], ["z1"])),
    listDefaultZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    listZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    setServiceZone: vi.fn(),
    listStaff: vi.fn().mockResolvedValue([]),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
    getTablesState: vi.fn().mockResolvedValue([freeTable]),
    listZones: vi.fn().mockResolvedValue([room]),
    logout: vi.fn().mockResolvedValue(undefined),
    putLocale: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

async function settle(el: HTMLElement & { updateComplete: Promise<boolean> }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

const floorOf = (el: TillApp) => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
const noTables = (el: TillApp) => floorOf(el)?.shadowRoot?.querySelector("[data-floor-no-tables]");
const readFailed = (el: TillApp) =>
  floorOf(el)?.shadowRoot?.querySelector("[data-floor-read-failed]");
const drawn = (el: TillApp, id: string) =>
  floorOf(el)?.shadowRoot?.querySelector(`[data-table="${id}"]`);

const orderOf = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen");

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

async function signIn(api: Record<string, unknown>): Promise<TillApp> {
  setLocale("en-GB");
  const { el } = await mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
  Object.assign(api, answeredPartyAllergy(el));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
    personId: "person",
    displayName: "Ana",
    permissions: [],
    locale: "en-GB",
  });
  await settle(el);
  return el;
}

async function onFloor(api: Record<string, unknown>): Promise<TillApp> {
  const el = await signIn(api);
  await vi.waitFor(() => expect(floorOf(el)).not.toBeNull());
  await settle(el);
  return el;
}

it("says the zone has no tables when the first read answers none for it", async () => {
  const el = await onFloor(stubApi({ getTablesState: vi.fn().mockResolvedValue([]) }));

  expect(noTables(el)).toBeTruthy();
  expect(readFailed(el)).toBeNull();
});

it("says the read failed when the first tables read fails, and draws the tables once Retry answers", async () => {
  let failing = true;
  const getTablesState = vi.fn(async () => {
    if (failing) throw new TypeError("Failed to fetch");
    return [freeTable];
  });
  const el = await onFloor(stubApi({ getTablesState }));
  expect(readFailed(el)?.textContent).toContain("Can't reach the box");
  expect(noTables(el)).toBeNull();

  failing = false;
  floorOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-floor-retry]")!.click();
  await settle(el);

  expect(drawn(el, "t1")).toBeTruthy();
  expect(readFailed(el)).toBeNull();
  expect(noTables(el)).toBeNull();
});

it("says the read failed, not that the zone has no tables, when the re-read after moving guests fails", async () => {
  const getTablesState = vi
    .fn()
    .mockResolvedValueOnce([openTable])
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const moveGuests = vi.fn().mockResolvedValue({ partyId: "v-2", billIds: ["wo-7"] });
  const api = stubApi(
    {
      getTablesState,
      getPartyBills: vi.fn().mockResolvedValue([openBill]),
      listZoneOffers: vi.fn().mockResolvedValue({
        service: {
          open: true,
          zoneOpen: true,
          periodName: null,
          periodOccurrenceKey: null,
          keepOpen: null,
          closedZoneName: null,
        },
        context: {
          departmentName: "Restaurant",
          zoneId: "z1",
          departmentId: "department-default",
          serviceMode: "prepay",
        },
        defaultMenuId: null,
        menus: [],
        offers: [],
      }),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
      getBillBalance: vi.fn(async (workingOrderId: string) => ({
        workingOrderId,
        status: "open",
        total: "3.00",
        received: "0.00",
        reserved: "0.00",
        outstanding: "3.00",
        tips: "0.00",
        payments: [],
      })),
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [], printProblems: [] }),
      moveGuests,
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
      ...adjustmentStubs(),
    },
    true,
  );
  const el = await signIn(api);
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(drawn(el, "t2")).toBeTruthy());
  emit(floorOf(el)!, "open-table", { tableId: "t2", seated: true });
  await settle(el);
  await vi.waitFor(() => expect(orderOf(el)).not.toBeNull());
  const order = orderOf(el)!;
  emit(order, "move-guests", { toTableId: "t9" });
  await settle(el);
  expect(moveGuests).toHaveBeenCalledOnce();

  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(floorOf(el)).not.toBeNull());
  await settle(el);

  expect(floorOf(el)!.tables).toEqual([]);
  expect(noTables(el)).toBeNull();
  expect(readFailed(el)).toBeTruthy();
});

it("keeps saying the zone has no tables when a later poll fails", async () => {
  const getTablesState = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const el = await onFloor(stubApi({ getTablesState }));
  expect(noTables(el)).toBeTruthy();

  emit(floorOf(el)!, "floor-refresh", { poll: true });
  await settle(el);

  expect(getTablesState).toHaveBeenCalledTimes(2);
  expect(noTables(el)).toBeTruthy();
  expect(readFailed(el)).toBeNull();
});

it("keeps the tables drawn when a later poll fails", async () => {
  const getTablesState = vi
    .fn()
    .mockResolvedValueOnce([freeTable])
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const el = await onFloor(stubApi({ getTablesState }));
  expect(drawn(el, "t1")).toBeTruthy();

  emit(floorOf(el)!, "floor-refresh", { poll: true });
  await settle(el);

  expect(getTablesState).toHaveBeenCalledTimes(2);
  expect(drawn(el, "t1")).toBeTruthy();
  expect(readFailed(el)).toBeNull();
  expect(noTables(el)).toBeNull();
});

it("retries a slow Floor with fresh tables and zones, ignoring the old answers", async () => {
  let oldTables!: (tables: TableState[]) => void;
  let oldZones!: (zones: FloorZone[]) => void;
  const getTablesState = vi
    .fn<(options?: { signal?: AbortSignal }) => Promise<TableState[]>>()
    .mockImplementationOnce(() => new Promise((resolve) => (oldTables = resolve)))
    .mockResolvedValue([freeTable]);
  const listZones = vi
    .fn<(options?: { signal?: AbortSignal }) => Promise<FloorZone[]>>()
    .mockImplementationOnce(() => new Promise((resolve) => (oldZones = resolve)))
    .mockResolvedValue([room]);
  const el = await signIn(stubApi({ getTablesState, listZones }, true));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;

  emit(floorOf(el)!, "floor-refresh", { poll: true });
  await vi.advanceTimersByTimeAsync(15_000);
  vi.useRealTimers();
  await settle(el);

  expect(getTablesState).toHaveBeenCalledOnce();
  expect(listZones).toHaveBeenCalledOnce();
  expect(getTablesState.mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
  expect(listZones.mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
  expect(readFailed(el)?.textContent).toContain("Can't reach the box");
  expect(noTables(el)).toBeNull();

  floorOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-floor-retry]")!.click();
  await vi.waitFor(() => expect(drawn(el, "t1")).toBeTruthy());
  expect(getTablesState.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
  expect(listZones.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
  oldTables([openTable]);
  oldZones([{ ...room, name: "Old room" }]);
  await settle(el);

  expect(getTablesState).toHaveBeenCalledTimes(2);
  expect(listZones).toHaveBeenCalledTimes(2);
  expect(floorOf(el)!.zones).toEqual([room]);
  expect(drawn(el, "t1")).toBeTruthy();
  expect(drawn(el, "t2")).toBeNull();
  expect(readFailed(el)).toBeNull();
});

it("lets a poll recover the first Floor after its outstanding requests reach the poll limit", async () => {
  const getTablesState = vi
    .fn<(options?: { signal?: AbortSignal }) => Promise<TableState[]>>()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue([freeTable]);
  const listZones = vi
    .fn<(options?: { signal?: AbortSignal }) => Promise<FloorZone[]>>()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue([room]);
  const el = await signIn(stubApi({ getTablesState, listZones }, true));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.advanceTimersByTimeAsync(25_000);
  vi.useRealTimers();

  expect(getTablesState.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
  expect(listZones.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
  emit(floorOf(el)!, "floor-refresh", { poll: true });
  await vi.waitFor(() => expect(drawn(el, "t1")).toBeTruthy());
  expect(getTablesState).toHaveBeenCalledTimes(2);
  expect(listZones).toHaveBeenCalledTimes(2);
});

it("shows the Floor after sign-in while its first tables read is still out", async () => {
  let answer!: (tables: TableState[]) => void;
  const getTablesState = vi.fn(
    () =>
      new Promise<TableState[]>((resolve) => {
        answer = resolve;
      }),
  );
  const el = await signIn(stubApi({ getTablesState }));

  expect(floorOf(el)).toBeTruthy();
  expect(getTablesState).toHaveBeenCalledOnce();
  expect(noTables(el)).toBeNull();
  expect(readFailed(el)).toBeNull();
  await vi.waitFor(() =>
    expect(floorOf(el)?.shadowRoot?.querySelector("wt-placeholder")).toBeTruthy(),
  );

  answer([freeTable]);
  await settle(el);
  expect(drawn(el, "t1")).toBeTruthy();
});

it("opens the Floor frame as soon as the PIN is accepted while device zones wait", async () => {
  const getDeviceZones = vi.fn(() => new Promise(() => {}));
  const api = stubApi({ getDeviceZones });
  api.getTill.mockResolvedValue({ ...(await api.getTill()), formFactor: "phone-portrait" });
  const el = await signIn(api);

  expect(floorOf(el)).toBeTruthy();
  expect(el.shadowRoot!.querySelector("till-lock-screen")).toBeNull();
  await vi.waitFor(() =>
    expect(floorOf(el)?.shadowRoot?.querySelector("wt-placeholder")).toBeTruthy(),
  );
  expect(drawn(el, "t1")).toBeNull();
});

it("keeps a fixed till's frame neutral until its starting zone answers", async ({
  onTestFinished,
}) => {
  onTestFinished(resetPage);
  await pageAt(700, 390);
  let answer!: (zones: ReturnType<typeof deviceZonesFixture>) => void;
  const getDeviceZones = vi.fn(() => new Promise((resolve) => (answer = resolve)));
  const el = await signIn(stubApi({ getDeviceZones }, true));
  const shell = () => el.shadowRoot!.querySelector("till-shell");
  expect(shell()?.activeScreen).toBeUndefined();
  expect(floorOf(el)).toBeNull();
  await vi.waitFor(() => {
    const body = shell()!.shadowRoot!.querySelector("main")!.getBoundingClientRect();
    const grey = shell()!.querySelector("wt-placeholder")?.getBoundingClientRect();
    expect(grey?.height ?? 0).toBeGreaterThan(body.height / 2);
    const footer = shell()!.shadowRoot!.querySelector("footer")?.getBoundingClientRect();
    expect(footer?.top).toBeGreaterThanOrEqual(body.bottom);
  });
  answer(deviceZonesFixture(undefined, ["z1"]));
  await vi.waitFor(() => expect(shell()?.activeScreen).toBe("counter"));
});

it("shows Counter menu placeholders while the first offers read waits", async () => {
  const listDefaultZoneOffers = vi.fn(() => new Promise(() => {}));
  const el = await signIn(stubApi({ listDefaultZoneOffers }, true));
  const browser = () => el.shadowRoot!.querySelector("till-menu-browser");

  expect(el.shadowRoot!.querySelector("till-lock-screen")).toBeNull();
  await vi.waitFor(() =>
    expect(browser()?.shadowRoot?.querySelectorAll("wt-placeholder").length).toBeGreaterThan(1),
  );
  expect(browser()?.shadowRoot?.querySelector("button")).toBeNull();
});

it("shows the known Floor zone and keeps the view control quiet until tables arrive", async ({
  onTestFinished,
}) => {
  onTestFinished(resetPage);
  await pageAt(390, 844);
  const selection = deviceZonesFixture([], ["z1"]);
  const getDeviceZones = vi.fn().mockResolvedValue({
    ...selection,
    zones: selection.zones.map((zone) => ({ ...zone, name: "Dining room" })),
  });
  const el = await signIn(
    stubApi({
      getDeviceZones,
      getTablesState: vi.fn(() => new Promise(() => {})),
    }),
  );
  const footer = el.shadowRoot!.querySelector("till-shell")!.shadowRoot!;
  await vi.waitFor(() =>
    expect(footer.querySelector("[data-floor-zone-chooser]")?.getAttribute("label")).toBe(
      "Dining room",
    ),
  );
  const view = footer.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-view-toggle]");

  expect(view?.textContent).toContain("List");
  expect(view?.disabled).toBe(true);
});

it("shows the last Floor zone and its untappable table shapes before the box answers", async ({
  onTestFinished,
}) => {
  onTestFinished(resetPage);
  await pageAt(390, 844);
  const deviceId = "device-with-a-saved-floor";
  const memoryKeys = ["floor-plan", "floor-zone"].map(
    (name) => `waitron.${name}.${JSON.stringify([location.origin, deviceId])}`,
  );
  const [memoryKey] = memoryKeys;
  for (const key of memoryKeys) localStorage.removeItem(key);
  const phone = async (api: ReturnType<typeof stubApi>) => {
    api.getTill.mockResolvedValue({ ...(await api.getTill()), formFactor: "phone-portrait" });
    return api;
  };
  const getDeviceIdentity = vi.fn().mockResolvedValue({
    deviceId,
    name: "Till",
    formFactor: "till",
    profileId: "profile",
  });
  const placed = (x: number, label: string) => ({
    ...freeTable,
    id: `table-${x}`,
    label,
    zoneId: "terrace",
    today: {
      placement: { x, y: 2, width: 4, height: 4, shape: "round", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      zoneRevision: 0,
    },
  });
  try {
    const first = await onFloor(
      await phone(
        stubApi({
          getDeviceIdentity,
          getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture([], ["z1", "terrace"])),
          listZones: vi
            .fn()
            .mockResolvedValue([
              room,
              { ...room, id: "terrace", name: "Terrace", displayOrder: 1 },
            ]),
          getTablesState: vi.fn().mockResolvedValue([placed(1, "Window"), placed(9, "Wall")]),
        }),
      ),
    );
    const firstShell = first.shadowRoot!.querySelector("till-shell")!.shadowRoot!;
    const terrace = () =>
      firstShell.querySelector<HTMLButtonElement>('[data-floor-zone="terrace"]');
    await vi.waitFor(() => expect(terrace()).toBeTruthy());
    terrace()!.click();
    await vi.waitFor(() => expect(location.pathname).toMatch(/\/zone\/terrace$/u));
    first.remove();
    history.replaceState(null, "", initialUrl);
    const el = await signIn(
      await phone(
        stubApi({ getDeviceIdentity, getDeviceZones: vi.fn(() => new Promise(() => {})) }),
      ),
    );
    const map = () => floorOf(el)?.shadowRoot?.querySelector("wt-floor-map");
    const shapes = () => [...(map()?.shadowRoot?.querySelectorAll("wt-placeholder") ?? [])];
    await vi.waitFor(() => expect(shapes()).toHaveLength(2));
    const shell = el.shadowRoot!.querySelector("till-shell")!.shadowRoot!;
    expect(shell.querySelector("[data-floor-zone-chooser]")?.getAttribute("label")).toBe("Terrace");

    await vi.waitFor(() => {
      const [left, right] = shapes().map((shape) => shape.getBoundingClientRect());
      const mapRect = map()!.getBoundingClientRect();
      expect(left!.width, `map ${mapRect.width} × ${mapRect.height}`).toBeGreaterThan(0);
      expect(right!.left - left!.left).toBeGreaterThan(left!.width);
      expect(right!.top).toBe(left!.top);
    });
    expect(map()?.shadowRoot?.querySelector("button")).toBeNull();
    expect(map()?.shadowRoot?.textContent).not.toContain("Window");
    expect(localStorage.getItem(memoryKey!)).not.toContain("Window");
  } finally {
    for (const key of memoryKeys) localStorage.removeItem(key);
  }
});

it("loads the next operator's Floor while its first reply waits", async () => {
  const getTablesState = vi
    .fn<() => Promise<TableState[]>>()
    .mockResolvedValueOnce([freeTable])
    .mockImplementationOnce(() => new Promise(() => {}));
  const el = await onFloor(stubApi({ getTablesState }));
  expect(drawn(el, "t1")).toBeTruthy();

  emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).toBeTruthy());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
    personId: "next-person",
    displayName: "Bea",
    permissions: [],
    locale: "en-GB",
  });
  await vi.advanceTimersByTimeAsync(15_000);
  vi.useRealTimers();
  await settle(el);

  expect(getTablesState).toHaveBeenCalledTimes(2);
  expect(readFailed(el)?.textContent).toContain("Can't reach the box");
  expect(drawn(el, "t1")).toBeNull();
});

it("starts a fresh first Floor read when staff leave for Counter and return", async () => {
  const getTablesState = vi
    .fn<(options?: { signal?: AbortSignal }) => Promise<TableState[]>>()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue([freeTable]);
  const el = await signIn(stubApi({ getTablesState }, true));
  const shell = el.shadowRoot!.querySelector("till-shell")!;
  emit(shell, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(getTablesState).toHaveBeenCalledOnce());

  emit(shell, "screen-select", { screen: "counter" });
  await vi.waitFor(() => expect(floorOf(el)).toBeNull());
  expect(getTablesState.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);

  emit(shell, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(drawn(el, "t1")).toBeTruthy());
  expect(getTablesState).toHaveBeenCalledTimes(2);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { answeredPartyAllergy } from "../test/answered-party-allergy.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import {
  adjustmentStubs,
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { FloorZone, PartyBill, TableState, TillApi } from "./api/client.js";
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

/** A box that never answers until the read's signal aborts, as a stalled fetch does. */
function stalled(options?: { signal?: AbortSignal }): Promise<TableState[]> {
  return new Promise((_, reject) =>
    options?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    ),
  );
}

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
  expect(readFailed(el)).toBeTruthy();
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
          zoneKeepOpen: null,
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
        paidLines: [],
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

it("says the read failed when a poll is cut off by its time limit before any tables were read", async () => {
  // The Floor tap's own read stays out, so only the poll's cut-off can say anything.
  const getTablesState = vi.fn(stalled);
  const el = await signIn(stubApi({ getTablesState }, true));
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(floorOf(el)).not.toBeNull());
  await settle(el);
  expect(readFailed(el)).toBeNull();

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  emit(floorOf(el)!, "floor-refresh", { poll: true });
  await vi.advanceTimersByTimeAsync(25_000);
  vi.useRealTimers();
  await settle(el);

  expect(readFailed(el)).toBeTruthy();
  expect(noTables(el)).toBeNull();
});

it("says nothing while the first tables read is still out", async () => {
  let answer!: (tables: TableState[]) => void;
  const getTablesState = vi.fn(
    () =>
      new Promise<TableState[]>((resolve) => {
        answer = resolve;
      }),
  );
  const el = await signIn(stubApi({ getTablesState }, true));
  emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
  await vi.waitFor(() => expect(floorOf(el)).not.toBeNull());
  await settle(el);

  expect(noTables(el)).toBeNull();
  expect(readFailed(el)).toBeNull();

  answer([freeTable]);
  await settle(el);
  expect(drawn(el, "t1")).toBeTruthy();
});

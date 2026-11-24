import "../src/till-app.js";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import { answeredPartyAllergy } from "./answered-party-allergy.js";
import { deviceZonesFixture } from "./device-zones.js";
import { afterEach, beforeEach, vi } from "vitest";
import {
  adjustmentStubs,
  cancellationStubs,
  cleanupWidgets,
  draftServer,
  mountWidget,
  notingPersonRefusals,
  servedMenus,
  type DraftServer,
} from "../src/widgets/test-helpers.js";
import type { TillApp } from "../src/till-app.js";
import { setLocale } from "../src/i18n/t.js";
import type { TillLockScreen } from "../src/screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "../src/screens/till-table-order-screen.js";
import type { TillFloorScreen } from "../src/screens/till-floor-screen.js";
import type { FormFactor, CapabilityFlag } from "../src/layout.js";
import type {
  FloorZone,
  TabLine,
  TableState,
  TableParty,
  TillApi,
  TillSaleResult,
  PartyBill,
  ZoneOffers,
} from "../src/api/client.js";

export const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

export function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t4",
    label: "4",
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
    shortName: over.label ?? "4",
    ...over,
  };
}

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v1",
    revision: 3,
    guestCount: 3,
    state: "open",
    name: null,
    displayName: "4",
    openingBillId: "wo-4",
    outstanding: "44.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

export function seated(
  over: Partial<TableState> = {},
  partyOver: Partial<TableParty> = {},
): TableState {
  return table({
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 3,
    tabTotal: "44.00",
    party: party(partyOver),
    ...over,
  });
}

export const table4 = seated();
export const table7 = seated(
  { id: "t7", label: "7" },
  { id: "v7", revision: 9, openingBillId: "wo-7", tableIds: ["t7"] },
);
export const table9 = table({ id: "t9", label: "9" });

export const tabBill: PartyBill = {
  dining: "eat_in",
  diningChoice: "none",
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  billNumber: 1,
  billName: null,
  status: "open",
  total: "14.00",
  outstanding: "14.00",
  hasPayments: false,
  receiptAvailable: false,
};
export const checkBill: PartyBill = {
  dining: "eat_in",
  diningChoice: "none",
  workingOrderId: "wo-check",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  billNumber: 2,
  billName: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  hasPayments: false,
  receiptAvailable: false,
};
/** The one bill of the party a seat answers with (`seatTable`'s `tabId`), before anything is on it. */
export const newPartyBill: PartyBill = {
  ...tabBill,
  workingOrderId: "wo-new",
  partyId: "v-new",
  total: "0.00",
  outstanding: "0.00",
};

export const tabLine: TabLine = {
  changesAfterSending: null,
  stationId: null,
  movable: false,
  id: "line-1",
  groupId: null,
  lineNo: 1,
  productId: "vino",
  quantity: "1.000",
  unitPriceGross: "30.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

export const saleResult: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "30.00",
  vatBreakdown: [{ rate: "21", base: "24.79", tax: "5.21" }],
  lines: [{ descriptions: { "es-ES": "Vino" }, quantity: "1", gross: "30.00" }],
  tender: { method: "cash", change: "0.00" },
  qr: "https://example.test/receipt-check",
};

const formFactor: FormFactor = "till";

export const till = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: formFactor,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
  simplifiedInvoiceLimit: "3000.00" as string | null,
};

const offers: ZoneOffers = {
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
    zoneId: zone.id,
    departmentId: "department-default",
    serviceMode: "prepay",
  },
  defaultMenuId: "cat-default",
  menus: servedMenus([{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }], []),
  offers: [],
};

export let api: TillApi;

export function setApi(replacement: TillApi): void {
  api = replacement;
}

export function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return notingPersonRefusals({
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: SUPPORTED_LOCALES,
      venueDefault: "en",
      loginDefault: "en",
    }),
    getTill: vi.fn().mockResolvedValue(till),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal", status: 404 }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: {
        ...offers.context,
        ...(overrides.zonePolicy as Partial<ZoneOffers["context"]>),
      },
    }),
    listZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: {
        ...offers.context,
        ...(overrides.zonePolicy as Partial<ZoneOffers["context"]>),
      },
    }),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([table4, table7, table9]),
    listZones: vi.fn().mockResolvedValue([zone]),
    seatTable: vi
      .fn()
      .mockResolvedValue({ partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 }),
    getPartyBills: vi.fn(async (partyId: string) =>
      partyId === "v7" || partyId === "v9"
        ? [{ ...tabBill, partyId, workingOrderId: partyId === "v7" ? "wo-7" : "wo-9" }]
        : partyId === "v-new"
          ? [newPartyBill]
          : [tabBill, checkBill],
    ),
    finishTable: vi.fn().mockResolvedValue({ state: "closed" }),
    markTableCleared: vi.fn().mockResolvedValue(undefined),
    getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0 }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [], printProblems: [] }),
    fireGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    markServed: vi.fn().mockResolvedValue({ revision: 4 }),
    unmarkServed: vi.fn().mockResolvedValue({ revision: 4 }),
    markGroupServed: vi.fn().mockResolvedValue({ revision: 4 }),
    snoozeGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    unsnoozeGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    sendLines: vi.fn().mockResolvedValue(undefined),
    moveGuests: vi.fn().mockResolvedValue({ partyId: "v1", billIds: ["wo-4"] }),
    joinTables: vi.fn().mockResolvedValue({ partyId: "v1", billIds: ["wo-4"] }),
    splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", billIds: ["wo-check"] }),
    setPartyName: vi.fn().mockResolvedValue({ revision: 4, name: "Ana" }),
    setPartyGuestCount: vi.fn().mockResolvedValue({ revision: 4, guestCount: 4 }),
    setBillName: vi.fn().mockResolvedValue({ revision: 4, billNumber: 1, billName: "Clint" }),
    mergeBills: vi.fn().mockResolvedValue(undefined),
    moveDishes: vi.fn().mockResolvedValue({ billId: "wo-check" }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    collectOrder: vi.fn().mockResolvedValue(saleResult),
    moveBill: vi.fn().mockResolvedValue({ partyId: null, billId: "wo-check" }),
    reprint: vi.fn().mockResolvedValue(undefined),
    printReceipt: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...adjustmentStubs(),
    ...cancellationStubs(),
    listDrafts: vi.fn(async (partyId: string) => {
      const snapshot = await drafts.listDrafts(partyId);
      const billId = partyId === "v7" ? "wo-7" : partyId === "v9" ? "wo-9" : null;
      return billId === null
        ? snapshot
        : { ...snapshot, billEdits: snapshot.billEdits.filter((edit) => edit.billId === billId) };
    }),
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    ...overrides,
  } as unknown as TillApi);
}

/** The server's side of the party's drafts, fresh for each test. */
export let drafts: DraftServer;

export async function mountApp(
  overrides: Record<string, unknown> = {},
  props: Partial<TillApp> = {},
) {
  api = stubApi(overrides);
  const mounted = await mountWidget<TillApp>("till-app", { api, ...props });
  Object.assign(api, answeredPartyAllergy(mounted.el));
  return mounted;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Frame-driven effects need their own poll; these turns do not guarantee a frame. */
export async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await nextTask();
    await el.updateComplete;
  }
}

export function emit(source: Element, type: string, detail?: unknown): void {
  if (
    type === "change-line" &&
    typeof detail === "object" &&
    detail !== null &&
    !Object.hasOwn(detail, "expectedEdit")
  )
    detail = { ...detail, expectedEdit: (source as TillTableOrderScreen).billEdit };
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

export const lock = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
export const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-shell")!;
export const tabGrid = (el: TillApp) => el;
export const floor = (el: TillApp) =>
  tabGrid(el)?.shadowRoot?.querySelector<TillFloorScreen>("till-floor-screen") ?? null;
export const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen");
export const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");

export async function toFloor(el: TillApp): Promise<TillFloorScreen> {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  return floor(el)!;
}

export async function openPartyTable(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  const screen = await toFloor(el);
  emit(screen, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

export const closingEdits = [
  { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null },
  { billId: "wo-check", editorVersion: 0, draftId: null, draftRevision: null },
];

beforeEach(() => {
  setLocale("en");
  drafts = draftServer();
  for (const billId of ["wo-7", "wo-9"]) drafts.bills.add(billId);
});
afterEach(cleanupWidgets);

/** An API method whose answer waits until the test settles or refuses it. */
export function held() {
  const answer: { settle: (value: unknown) => void; refuse: (reason: unknown) => void } = {
    settle: () => undefined,
    refuse: () => undefined,
  };
  const call = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        answer.settle = resolve;
        answer.refuse = reject;
      }),
  );
  return { call, answer };
}

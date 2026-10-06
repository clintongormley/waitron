import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import {
  adjustmentStubs,
  cancelReason,
  cancelThroughDialog,
  cleanupWidgets,
  draftServer,
  mountWidget,
  servedMenus,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { productUnit } from "./widgets/product-name.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { formatMoney } from "@waitron/shared";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillModifierPicker } from "./widgets/modifier-picker.js";
import type { TillAdjustmentDialog } from "./widgets/adjustment-dialog.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  FloorZone,
  ProductCatalogue,
  Station,
  TabLine,
  TableState,
  TillApi,
  TillProduct,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
  catalogueId: "cat-default",
  catalogueName: "Carta",
};

const floorZone: FloorZone = { id: "z1", name: "Comedor", displayOrder: 0, active: true };

const openTable: TableState = {
  id: "t2",
  label: "2",
  zoneId: "z1",
  capacity: 4,
  state: "open-tab",
  condition: "free",
  hasOpenTab: true,
  tabLineCount: 2,
  tabTotal: "12.00",
  pendingDeliveries: 0,
  pendingToServe: 1,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
  signals: [],
  party: {
    id: "v-2",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "2",
    mainBillId: "wo-7",
    outstanding: "12.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
  },
};

const seatedFloor = () => ({ getTablesState: vi.fn().mockResolvedValue([openTable]) });

const tabLine: TabLine = {
  stationId: null,
  movable: false,
  id: "line-1",
  groupId: null,
  lineNo: 1,
  productId: "cafe",
  quantity: "2.000",
  unitPriceGross: "1.50",
  servedAt: null,
  courseId: null,
  sentAt: "2026-08-17T09:59:00.000Z",
  firedAt: "2026-08-17T09:59:00.000Z",
  state: "queued",
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
};

const saleResult: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "3.00",
  vatBreakdown: [{ rate: "21", base: "2.48", tax: "0.52" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
  tender: { method: "cash", change: "2.00" },
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=3.00",
};

const tillCanvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: {} }],
    },
    {
      key: "floor",
      title: "Floor",
      columns: 24,
      cards: [{ type: "floor-plan", colSpan: 24, rowSpan: 12, config: {} }],
    },
  ],
};

const phoneCanvas: CanvasDef = {
  formFactor: "phone-portrait",
  tabs: [
    {
      key: "floor",
      title: "Floor",
      columns: 12,
      cards: [{ type: "floor-plan", colSpan: 12, rowSpan: 8, config: {} }],
    },
    {
      key: "order",
      title: "Order",
      columns: 12,
      cards: [{ type: "table-order", colSpan: 12, rowSpan: 8, config: {} }],
    },
  ],
};

const till = {
  locale: "es-ES",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas: tillCanvas,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

function zoneOffers(catalogue: ProductCatalogue, defaultMenuId: string | null): ZoneOfferCatalogue {
  const body: ZoneOfferCatalogue = {
    context: { zoneId: floorZone.id, departmentId: "department-default", serviceMode: "prepay" },
    defaultMenuId,
    // No `versionId`: a line added from these offers asserts no version, so the wire bodies the
    // suites pin are the ones a till sends against the live version.
    menus: [],
    offers: catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
      id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
      menuId: product.catalogueId ?? "menu-fixture",
      productId: product.productId ?? product.id,
      grossPrice: product.unitPrice,
      unitPrice: product.unitPrice,
      available: true,
      image: null,
      description: null,
      menuName: product.catalogueName ?? "Menu",
      placements: [[]],
      name: product.name,
      customerName: null,
      kitchenName: null,
      unit: productUnit(product),
      vatClass: product.vatClass,
      category: product.category ?? "Other",
      allergens: product.allergens,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      offeredModifiers: [],
      variants: [],
      courseId: null,
    })),
  };
  body.menus = servedMenus(catalogue.menus, body.offers) as ZoneOfferCatalogue["menus"];
  return body;
}

const counterOffers = zoneOffers(
  { menus: [{ id: "cat-default", name: "Carta", isDefault: true }], products: [cafe] },
  "cat-default",
);

/** A dining zone with two menus, neither named as the zone's default — the second is MARKED default. */
const diningMenus = [
  { id: "menu-lunch", name: "Lunch", isDefault: false },
  { id: "menu-dinner", name: "Dinner", isDefault: true },
];
const diningOffers = zoneOffers(
  {
    menus: diningMenus,
    products: [
      { ...cafe, id: "sopa", name: "Sopa", catalogueId: "menu-lunch" },
      { ...cafe, id: "cordero", name: "Cordero", catalogueId: "menu-dinner" },
    ],
  },
  null,
);

let api: TillApi;
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    getTill: vi.fn().mockResolvedValue(till),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    listZoneOffers: vi.fn().mockResolvedValue(diningOffers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([openTable]),
    listZones: vi.fn().mockResolvedValue([floorZone]),
    listStatuses: vi.fn().mockResolvedValue([]),
    seatTable: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
    getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0, editSentLines: true }),
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
    getPartyBills: vi.fn().mockResolvedValue([]),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    fireGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    markServed: vi.fn().mockResolvedValue({ revision: 4 }),
    setLineCourse: vi.fn().mockResolvedValue(undefined),
    sendLines: vi.fn().mockResolvedValue(undefined),
    recallLines: vi.fn().mockResolvedValue(undefined),
    ...adjustmentStubs(),
    updateOrderLine: vi.fn().mockResolvedValue({ revision: 1, party: null }),
    setTableStatus: vi.fn().mockResolvedValue(undefined),
    moveGuests: vi.fn().mockResolvedValue({ partyId: "v-2", mainBillId: "wo-7", merged: false }),
    joinTables: vi.fn().mockResolvedValue({ partyId: "v-2", mainBillId: "wo-7", merged: false }),
    splitTable: vi.fn().mockResolvedValue({ partyId: "v-new", mainBillId: null }),
    setPartyName: vi.fn().mockResolvedValue({ revision: 4, name: "Ana" }),
    mergeBills: vi.fn().mockResolvedValue(undefined),
    transferItems: vi.fn().mockResolvedValue(undefined),
    splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    logout: vi.fn().mockResolvedValue(undefined),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    ...overrides,
  } as unknown as TillApi;
}

/** The server's side of the party's drafts, fresh for each test. */
let drafts: DraftServer;

/** Rings a café into the open table's draft, and gives the `submit-draft` a confirmed Fire all now
 * sends for it. */
async function ringCafe(el: TillApp, screen: TillTableOrderScreen) {
  const store = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;
  store.addProduct(
    {
      id: "cafe",
      menuItemId: "menu-item-cafe-0",
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
      allergens: null,
    },
    "1",
  );
  await flush(el);
  return {
    lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }],
    groups: [{ release: "fire", lineIndexes: [0] }],
    store,
    sent: store.lines,
  };
}

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api });
}

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
const shell = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement & { activeTabKey?: string }>("till-tab-shell")!;
const tabGrid = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-card-grid");
const floor = (el: TillApp) =>
  tabGrid(el)?.shadowRoot?.querySelector<TillFloorScreen>("till-floor-screen") ?? null;
/** A till opens table-order as a drill (app shadow root); a handheld mounts it as a tab card. */
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  tabGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
  null;
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const ticket = (el: TillApp) => el.shadowRoot!.querySelector("till-ticket-view");

async function logIn(el: TillApp): Promise<void> {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
}

async function openFromFloor(el: TillApp, table: TableState): Promise<void> {
  emit(floor(el)!, "open-table", { tableId: table.id, seated: table.hasOpenTab });
  await flush(el);
}

async function toTableOrder(el: TillApp): Promise<TillTableOrderScreen> {
  await logIn(el);
  emit(shell(el), "tab-select", { key: "floor" });
  await flush(el);
  await openFromFloor(el, openTable);
  return tableOrder(el)!;
}

beforeEach(() => {
  setLocale("es-ES");
  drafts = draftServer(() => ({ tabId: "wo-7", revision: 4, groups: [] }));
});
const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  localStorage.removeItem("waitron.makeNow.till-dev");
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app table ordering: the table's menus", () => {
  it("shows Make now after a table Send reports a drink", async () => {
    let receive: ((items: unknown[]) => void) | undefined;
    const submitDraft = vi.fn(async (...args: Parameters<TillApi["submitDraft"]>) => {
      const result = await drafts.submitDraft(args[0], args[1], args[2]);
      receive!([
        {
          lineId: "table-lager",
          name: "Lager",
          quantity: "1.000",
          unitName: null,
          soldInEach: true,
          optionSnapshots: [],
          extras: [],
          note: null,
        },
      ]);
      return result;
    });
    const { el } = await mountApp({
      onMadeHere: vi.fn((listener) => {
        receive = listener;
      }),
      submitDraft,
    });
    const screen = await toTableOrder(el);
    emit(screen, "submit-draft", await ringCafe(el, screen));
    await flush(el);
    expect(submitDraft).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("till-make-now")!.shadowRoot!.textContent).toContain(
      "Lager",
    );
  });

  it("falls back to the menu marked default when the table's zone names none", async () => {
    const { el } = await mountApp();
    const screen = await toTableOrder(el);

    expect(api.listZoneOffers).toHaveBeenCalledWith(floorZone.id);
    expect(screen.menus).toEqual(diningOffers.menus);
    expect(screen.selectedMenuId).toBe("menu-dinner");
  });

  it("switches the TABLE's menu on a pick, leaving the counter's menu and its stored preference alone", async () => {
    const { el } = await mountApp();
    const screen = await toTableOrder(el);
    const counterMenu = (el as unknown as { selectedCatalogueId: string }).selectedCatalogueId;
    const storedPreference = sessionStorage.getItem("waitron.lastMenu");

    emit(screen, "menu-selected", { id: "menu-lunch" });
    await flush(el);

    expect(tableOrder(el)!.selectedMenuId).toBe("menu-lunch");
    expect((el as unknown as { selectedCatalogueId: string }).selectedCatalogueId).toBe(
      counterMenu,
    );
    expect(sessionStorage.getItem("waitron.lastMenu")).toBe(storedPreference);
  });

  it("ignores a pick naming a menu the table's zone does not offer", async () => {
    const { el } = await mountApp();
    const screen = await toTableOrder(el);

    emit(screen, "menu-selected", { id: "menu-from-another-zone" });
    await flush(el);

    expect(tableOrder(el)!.selectedMenuId).toBe("menu-dinner");
  });

  it("accepts an empty pick, which selects no menu", async () => {
    const { el } = await mountApp();
    const screen = await toTableOrder(el);

    emit(screen, "menu-selected", { id: "" });
    await flush(el);

    expect(tableOrder(el)!.selectedMenuId).toBe("");
  });

  it("ignores a table menu pick that reaches an app no longer on the page", async () => {
    const { el, host } = await mountApp();
    await toTableOrder(el);
    const wrapper = el.shadowRoot!.querySelector<HTMLElement>(".app")!;

    host.removeChild(el);
    emit(wrapper, "menu-selected", { id: "menu-lunch" });

    expect((el as unknown as { tableSelectedCatalogueId: string }).tableSelectedCatalogueId).toBe(
      "menu-dinner",
    );
  });

  it("stays on the floor with table.error and opens no tab when the table's offers cannot load", async () => {
    const freeTable: TableState = {
      ...openTable,
      id: "t1",
      state: "free",
      hasOpenTab: false,
    };
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([freeTable]),
      listZoneOffers: vi.fn().mockRejectedValue({ code: "service_zone.not_found" }),
    });
    await logIn(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);

    await openFromFloor(el, freeTable);

    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(api.getTabLines).not.toHaveBeenCalled();
    expect(api.seatTable).not.toHaveBeenCalled();
  });

  it("says nothing about a failed offer load for a table the operator has already left", async () => {
    const tableA = {
      ...openTable,
      id: "table-a",
      zoneId: "zone-a",
      party: { ...openTable.party!, id: "party-a", mainBillId: "order-a" },
    };
    const tableB = {
      ...openTable,
      id: "table-b",
      zoneId: "zone-b",
      party: { ...openTable.party!, id: "party-b", mainBillId: "order-b" },
    };
    let rejectA!: (reason: unknown) => void;
    const listZoneOffers = vi.fn((zoneId: string) =>
      zoneId === "zone-a"
        ? new Promise<ZoneOfferCatalogue>((_resolve, reject) => (rejectA = reject))
        : Promise.resolve(diningOffers),
    );
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([tableA, tableB]),
      listZoneOffers,
    });
    await logIn(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);

    emit(floor(el)!, "open-table", { tableId: tableA.id, seated: true });
    emit(floor(el)!, "open-table", { tableId: tableB.id, seated: true });
    await flush(el);
    rejectA({ code: "service_zone.not_found" });
    await flush(el);

    expect(banner(el)).toBeNull();
    expect(tableOrder(el)!.orderId).toBe("order-b");
    expect(tableOrder(el)!.menus).toEqual(diningOffers.menus);
    expect(api.getTabLines).toHaveBeenCalledTimes(1);
    expect(api.getTabLines).toHaveBeenCalledWith("order-b");
  });
});

it("moves a table dish with one submission id and reloads its current orders", async () => {
  const listStations = vi.fn().mockResolvedValue([
    { id: "bar", name: "Bar", displayOrder: 0, isDefault: false, active: true, open: true },
    { id: "kitchen", name: "Kitchen", displayOrder: 1, isDefault: true, active: true, open: true },
  ]);
  const moveDishStation = vi.fn().mockResolvedValue({
    revision: 1,
    stationId: "kitchen",
    moved: [{ workingOrderLineId: "line-1", fromStationId: "bar" }],
  });
  const readCurrentOrders = vi
    .fn()
    .mockResolvedValue({ revision: 1, reminder: null, groups: [], ungrouped: [] });
  const { el } = await mountApp({
    ...seatedFloor(),
    listStations,
    moveDishStation,
    readCurrentOrders,
  });
  const screen = await toTableOrder(el);
  const readsBefore = readCurrentOrders.mock.calls.length;
  emit(screen, "move-station", {
    workingOrderId: "wo-7",
    lineId: "line-1",
    name: "Café",
    stationId: "bar",
  });
  await flush(el);
  const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-station-choice-dialog")!;
  expect(dialog).not.toBeNull();
  emit(dialog, "station-chosen", { stationId: "kitchen" });
  await flush(el);
  expect(moveDishStation).toHaveBeenCalledOnce();
  expect(moveDishStation).toHaveBeenCalledWith(
    "wo-7",
    {
      submissionId: expect.any(String),
      lineIds: ["line-1"],
      stationId: "kitchen",
    },
    expect.any(Object),
  );
  expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  expect(readCurrentOrders.mock.calls.length).toBeGreaterThan(readsBefore);
});

describe("opening a table station move while its station list is pending", () => {
  const listed: Station[] = [
    { id: "bar", name: "Bar", displayOrder: 0, isDefault: false, active: true, open: true },
    { id: "kitchen", name: "Kitchen", displayOrder: 1, isDefault: true, active: true, open: true },
  ];
  const move = { workingOrderId: "wo-7", lineId: "line-1", name: "Café", stationId: "bar" };

  it("does not reopen the dialog or repopulate stations after logout", async () => {
    const listStations = vi.fn().mockResolvedValue(listed);
    const { el } = await mountApp({ ...seatedFloor(), listStations });
    const screen = await toTableOrder(el);
    let answer!: (stations: Station[]) => void;
    listStations.mockImplementationOnce(
      () => new Promise<Station[]>((resolve) => (answer = resolve)),
    );
    emit(screen, "move-station", move);
    await flush(el);
    emit(shell(el), "logout");
    await flush(el);
    answer(listed);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
    expect((el as unknown as { stations: Station[] }).stations).toEqual([]);
  });

  it("does not open the old dish's dialog after switching tables", async () => {
    const otherTable: TableState = {
      ...openTable,
      id: "t3",
      label: "3",
      party: { ...openTable.party!, id: "v-3", mainBillId: "wo-8", tableIds: ["t3"] },
    };
    const listStations = vi.fn().mockResolvedValue(listed);
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
      listStations,
    });
    const screen = await toTableOrder(el);
    let answer!: (stations: Station[]) => void;
    listStations.mockImplementationOnce(
      () => new Promise<Station[]>((resolve) => (answer = resolve)),
    );
    emit(screen, "move-station", move);
    await flush(el);
    emit(screen, "back-to-floor");
    await flush(el);
    await openFromFloor(el, otherTable);
    expect(tableOrder(el)!.orderId).toBe("wo-8");
    answer(listed);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-station-choice-dialog")).toBeNull();
  });

  it("loads stations once for two rapid presses on the same dish", async () => {
    const listStations = vi.fn().mockResolvedValue(listed);
    const moveDishStation = vi.fn().mockResolvedValue({
      revision: 1,
      stationId: "kitchen",
      moved: [{ workingOrderLineId: "line-1", fromStationId: "bar" }],
    });
    const { el } = await mountApp({ ...seatedFloor(), listStations, moveDishStation });
    const screen = await toTableOrder(el);
    const reads = listStations.mock.calls.length;
    let answer!: (stations: Station[]) => void;
    listStations.mockImplementationOnce(
      () => new Promise<Station[]>((resolve) => (answer = resolve)),
    );
    emit(screen, "move-station", move);
    emit(screen, "move-station", move);
    await flush(el);
    expect(listStations.mock.calls.length).toBe(reads + 1);
    answer(listed);
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("till-station-choice-dialog")).toHaveLength(1);
    emit(el.shadowRoot!.querySelector("till-station-choice-dialog")!, "station-chosen", {
      stationId: "kitchen",
    });
    await flush(el);
    expect(moveDishStation).toHaveBeenCalledOnce();
  });
});

it("clears a saved draft station missing from the station list", async () => {
  drafts.drafts.push({
    id: "draft-1",
    partyId: "v-2",
    ownerId: "p1",
    ownerName: "Ana",
    revision: 1,
    takenOverFrom: null,
    lines: [
      {
        id: "draft-line-1",
        menuItemId: "menu-item-cafe-0",
        variantId: null,
        menuVersionId: null,
        options: [],
        extras: [],
        note: null,
        quantity: "1",
        courseId: null,
        makeAt: "switched-off",
        noMerge: false,
        unavailable: false,
      },
    ],
  });
  const { el } = await mountApp({
    ...seatedFloor(),
    listStations: vi.fn().mockResolvedValue([
      {
        id: "kitchen",
        name: "Kitchen",
        displayOrder: 0,
        isDefault: true,
        active: true,
        open: true,
      },
    ]),
  });
  const screen = await toTableOrder(el);
  expect(screen.draftStore!.lines[0]!.makeAt).toBeUndefined();
});

it("keeps the move dialog open with a raced start refusal and rereads the lines", async () => {
  const moveDishStation = vi.fn().mockRejectedValue({ code: "ticket.already_started" });
  const getTabLines = vi.fn().mockResolvedValue({
    lines: [{ ...tabLine, movable: false, state: "preparing" }],
    revision: 1,
    editSentLines: true,
  });
  const { el } = await mountApp({
    ...seatedFloor(),
    moveDishStation,
    getTabLines,
    listStations: vi.fn().mockResolvedValue([
      { id: "bar", name: "Bar", displayOrder: 0, isDefault: false, active: true, open: true },
      {
        id: "kitchen",
        name: "Kitchen",
        displayOrder: 1,
        isDefault: true,
        active: true,
        open: true,
      },
    ]),
  });
  const screen = await toTableOrder(el);
  const readsBefore = getTabLines.mock.calls.length;
  emit(screen, "move-station", {
    workingOrderId: "wo-7",
    lineId: "line-1",
    name: "Café",
    stationId: "bar",
  });
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-station-choice-dialog")!, "station-chosen", {
    stationId: "kitchen",
  });
  await flush(el);
  const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-station-choice-dialog")!;
  expect(dialog).not.toBeNull();
  expect(dialog.shadowRoot!.querySelector("[role='alert']")?.textContent).toContain(
    "se queda donde está",
  );
  expect(getTabLines.mock.calls.length).toBeGreaterThan(readsBefore);
});

it("reuses the submission id when a station move gets no answer", async () => {
  const moveDishStation = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue({
      revision: 1,
      stationId: "kitchen",
      moved: [{ workingOrderLineId: "line-1", fromStationId: "bar" }],
    });
  const { el } = await mountApp({
    ...seatedFloor(),
    moveDishStation,
    listStations: vi.fn().mockResolvedValue([
      { id: "bar", name: "Bar", displayOrder: 0, isDefault: false, active: true, open: true },
      {
        id: "kitchen",
        name: "Kitchen",
        displayOrder: 1,
        isDefault: true,
        active: true,
        open: true,
      },
    ]),
  });
  const screen = await toTableOrder(el);
  emit(screen, "move-station", {
    workingOrderId: "wo-7",
    lineId: "line-1",
    name: "Café",
    stationId: "bar",
  });
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-station-choice-dialog")!, "station-chosen", {
    stationId: "kitchen",
  });
  // One pause before the second try runs on real time; wait for that try.
  await vi.waitFor(() => expect(moveDishStation).toHaveBeenCalledTimes(2), {
    timeout: 4000,
    interval: 50,
  });
  await flush(el);
  expect(moveDishStation).toHaveBeenCalledTimes(2);
  expect(moveDishStation.mock.calls[0]![1].submissionId).toBe(
    moveDishStation.mock.calls[1]![1].submissionId,
  );
});

describe("till-app table ordering: a handheld's Order tab with no table opened", () => {
  // The Order tab is reachable from the tab strip before any table is opened, so the table-order
  // screen can emit its actions while the app holds no tab (and no table) to apply them to.
  async function toEmptyOrderTab(): Promise<{ el: TillApp; screen: TillTableOrderScreen }> {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "h1", formFactor: "phone-portrait", stationId: null }),
    });
    await logIn(el);
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);
    const screen = tableOrder(el)!;
    expect(screen.orderId).toBeUndefined();
    return { el, screen };
  }

  it.each([
    [
      "submit-draft",
      {
        lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }],
        groups: [{ release: "fire", lineIndexes: [0] }],
      },
      "submitDraft",
    ],
    ["serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] }, "markServed"],
    ["set-line-course", { lineNo: 1, courseId: null }, "setLineCourse"],
    ["send-lines", { lineNos: [1] }, "sendLines"],
    ["recall-lines", { lineNos: [1] }, "recallLines"],
    [
      "adjust",
      {
        kind: "cancel",
        target: { lineId: "line-1", name: "Café", quantity: "1", total: "1.50", unitTotal: null },
      },
      "listAdjustmentReasons",
    ],
    [
      "change-line",
      { lineNo: 1, lineName: "Café", patch: { note: "sin sal" }, revision: 0 },
      "updateOrderLine",
    ],
    ["set-status", { statusId: "s1" }, "setTableStatus"],
    ["move-guests", { toTableId: "t9", bills: "merge" }, "moveGuests"],
    ["join-tables", { tableId: "t9", bills: "merge" }, "joinTables"],
    ["split-table", { tableId: "t9", billId: null }, "splitTable"],
    ["name-party", { name: "Ana" }, "setPartyName"],
    ["merge-bills", { fromBillId: "wo-9" }, "mergeBills"],
    ["transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] }, "transferItems"],
    ["split-lines", { transfers: [{ lineNo: 1 }] }, "splitBill"],
    ["pay-tab", { method: "cash", amount: "10.00" }, "recordSale"],
  ] as const)("%s sends nothing to the server", async (type, detail, method) => {
    const { el, screen } = await toEmptyOrderTab();

    emit(screen, type, detail);
    await flush(el);

    expect(
      (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
    ).not.toHaveBeenCalled();
    expect(api.getTabLines).not.toHaveBeenCalled();
    expect(banner(el)).toBeNull();
    expect(ticket(el)).toBeNull();
  });
});

describe("till-app table ordering: refused and failed table actions", () => {
  it.each([
    [
      "submit-draft",
      {
        lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }],
        groups: [{ release: "fire", lineIndexes: [0] }],
      },
      "submitDraft",
    ],
    ["recall-lines", { lineNos: [1] }, "recallLines"],
    [
      "change-line",
      { lineNo: 1, lineName: "Café", patch: { note: "sin sal" }, revision: 0 },
      "updateOrderLine",
    ],
    ["send-lines", { lineNos: [1] }, "sendLines"],
    ["transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] }, "transferItems"],
  ] as const)(
    "a %s refused because a card payment of the order is running says so",
    async (type, detail, method) => {
      const { el } = await mountApp({
        ...seatedFloor(),
        [method]: vi.fn().mockRejectedValue({ code: "order.payment_in_flight" }),
      });
      const screen = await toTableOrder(el);

      emit(screen, type, type === "submit-draft" ? await ringCafe(el, screen) : detail);
      await flush(el);

      expect(banner(el)!.textContent).toContain(
        "Se está cobrando este pedido con tarjeta. Espera a que termine antes de cambiarlo",
      );
      expect(banner(el)!.textContent).not.toContain("order.payment_in_flight");
    },
  );

  it("a cancel refused because a card payment of the order is running says so", async () => {
    const { el } = await mountApp({
      ...seatedFloor(),
      previewAdjustment: vi.fn().mockRejectedValue({ code: "order.payment_in_flight" }),
    });
    const screen = await toTableOrder(el);

    await cancelThroughDialog(el, screen, "line-1", async () => {
      await flush(el);
      await flush(el);
    });

    const dialog = el.shadowRoot!.querySelector("till-adjustment-dialog")!;
    const message = dialog.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      "wt-form-actions",
    )!.error;
    expect(message).toContain(
      "Se está cobrando este pedido con tarjeta. Espera a que termine antes de cambiarlo",
    );
    expect(message).not.toContain("order.payment_in_flight");
  });

  it.each([
    ["join-tables", { tableId: "t9", bills: "merge" }, "joinTables"],
    ["merge-bills", { fromBillId: "wo-9" }, "mergeBills"],
    ["transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] }, "transferItems"],
  ] as const)(
    "a refused %s shows table.error and re-reads neither the tab nor the floor",
    async (type, detail, method) => {
      const { el } = await mountApp({
        [method]: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
      });
      const screen = await toTableOrder(el);
      const floorReads = vi.mocked(api.getTablesState).mock.calls.length;
      const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

      emit(screen, type, detail);
      await flush(el);

      expect(banner(el)!.textContent).toContain(t("table.error"));
      expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
      expect(api.getTabLines).toHaveBeenCalledTimes(lineReads);
      expect(tableOrder(el)).not.toBeNull();
    },
  );

  it.each(["bill.presented", "bill.paid", "bill.other_party", "bill.payments_received"])(
    "a merge refused %s says so in that code's own words",
    async (code) => {
      const { el } = await mountApp({
        ...seatedFloor(),
        mergeBills: vi.fn().mockRejectedValue({ code }),
      });
      const screen = await toTableOrder(el);

      emit(screen, "merge-bills", { fromBillId: "wo-9" });
      await flush(el);

      const text = banner(el)!.textContent!;
      expect(text).toContain(codeMessage(code));
      expect(text).not.toContain(t("table.error"));
    },
  );

  it.each([
    ["transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] }, "transferItems"],
    ["split-lines", { transfers: [{ lineNo: 1 }] }, "splitBill"],
  ] as const)(
    "a %s refused because an item is already paid for says so in that code's own words",
    async (type, detail, method) => {
      const { el } = await mountApp({
        ...seatedFloor(),
        [method]: vi.fn().mockRejectedValue({ code: "bill.line_paid" }),
      });
      const screen = await toTableOrder(el);

      emit(screen, type, detail);
      await flush(el);

      expect(banner(el)!.textContent).toContain(codeMessage("bill.line_paid"));
    },
  );

  it("a split refused for any other reason shows table.error and keeps paying the original tab", async () => {
    const { el } = await mountApp({
      splitBill: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
    });
    const screen = await toTableOrder(el);

    emit(screen, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    const text = banner(el)!.textContent!;
    expect(text).toContain(t("table.error"));
    expect(text).not.toContain(t("table.split_modifier_error"));

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "3.00" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledWith([], { method: "cash", amount: "3.00" }, "wo-7");
  });

  it("empties the floor the table actions pick from when the re-read after a move fails", async () => {
    const getTablesState = vi
      .fn()
      .mockResolvedValueOnce([openTable])
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ getTablesState });
    const screen = await toTableOrder(el);
    expect(screen.tables).toEqual([openTable]);

    emit(screen, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);

    expect(api.moveGuests).toHaveBeenCalledWith("v-2", "t9", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: null,
    });
    expect(tableOrder(el)!.tables).toEqual([]);
    expect(banner(el)).toBeNull();
  });

  it("shows an empty tab rather than stale lines when the re-read after a round fails", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [tabLine], revision: 0 })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ ...seatedFloor(), getTabLines });
    const screen = await toTableOrder(el);
    expect(screen.lines).toEqual([tabLine]);

    emit(screen, "submit-draft", await ringCafe(el, screen));
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.lines).toEqual([]);
    expect(banner(el)).toBeNull();
  });
});

describe("till-app table ordering: changing and cancelling a sent line", () => {
  const sent = "2026-08-17T09:59:00.000Z";
  const burgerOffers: ZoneOfferCatalogue = (() => {
    const offers = zoneOffers(
      {
        menus: diningMenus,
        products: [
          {
            ...cafe,
            id: "burger",
            menuItemId: "menu-item-burger",
            name: "Burger",
            unitPrice: "9.50",
            catalogueId: "menu-dinner",
          },
        ],
      },
      null,
    );
    // Three different texts for the three names, so a surface reading the wrong one fails.
    offers.offers[0] = {
      ...offers.offers[0]!,
      customerName: { es: "Hamburguesa de la casa" },
      kitchenName: "BRG",
    };
    return offers;
  })();
  const burgerLine: TabLine = {
    stationId: null,
    movable: false,
    id: "line-5",
    groupId: null,
    lineNo: 5,
    name: "Burger",
    productId: "burger",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "9.50",
    servedAt: null,
    courseId: null,
    sentAt: sent,
    firedAt: sent,
    state: "queued",
    note: null,
    listId: null,
    menuItemId: "menu-item-burger",
    parentProductId: null,
  };
  const change = { lineNo: 5, lineName: "Burger", patch: { note: "no onions" }, revision: 7 };

  async function openBurgerTab(overrides: Record<string, unknown> = {}) {
    const { el } = await mountApp({
      listZoneOffers: vi.fn().mockResolvedValue(burgerOffers),
      getTabLines: vi
        .fn()
        .mockResolvedValue({ lines: [burgerLine], revision: 7, editSentLines: true }),
      ...overrides,
    });
    const screen = await toTableOrder(el);
    return { el, screen };
  }

  /** The app's cancel dialog, or null when none is open. */
  const cancelDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillAdjustmentDialog>("till-adjustment-dialog");
  async function closeCancel(el: TillApp): Promise<void> {
    cancelDialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-adjust-close]")!.click();
    await flush(el);
  }

  it("saves a note typed into Change with the order's revision, and the line then shows it at the same price", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [burgerLine], revision: 7, editSentLines: true })
      .mockResolvedValueOnce({
        lines: [{ ...burgerLine, note: "no onions" }],
        revision: 8,
        editSentLines: true,
      });
    const { el, screen } = await openBurgerTab({
      getTabLines,
      updateOrderLine: vi.fn().mockResolvedValue({ revision: 8, party: null }),
    });
    screen.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await screen.updateComplete;
    screen.shadowRoot!.querySelector<HTMLElement>('[data-change-line="5"]')!.click();
    await screen.updateComplete;
    const picker = screen.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
    await picker.updateComplete;
    const note = picker
      .shadowRoot!.querySelector('[data-test="line-note"]')!
      .shadowRoot!.querySelector("textarea")!;
    note.value = "no onions";
    note.dispatchEvent(new Event("input"));
    await picker.updateComplete;
    picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
    await flush(el);

    expect(api.updateOrderLine).toHaveBeenCalledWith("wo-7", 5, { note: "no onions" }, 7);
    const row = tableOrder(el)!.shadowRoot!.querySelector(".pending-line")!;
    expect(row.querySelector(".line-note")!.textContent).toContain("no onions");
    expect(row.querySelector(".line-total")!.textContent).toBe(
      formatMoney("9.50", currentLocale()),
    );
    expect(tableOrder(el)!.revision).toBe(8);
    expect(banner(el)).toBeNull();
  });

  it("hands the order's revision and the venue's setting to the drilled-in table screen", async () => {
    const { screen } = await openBurgerTab({
      getTabLines: vi
        .fn()
        .mockResolvedValue({ lines: [burgerLine], revision: 7, editSentLines: false }),
    });
    expect(screen.revision).toBe(7);
    expect(screen.editSentLines).toBe(false);
  });

  it("hands them to the table screen a handheld mounts as a card too", async () => {
    const stations: Station[] = [
      { id: "bar", name: "Bar", displayOrder: 0, isDefault: true, active: true, open: true },
      { id: "grill", name: "Grill", displayOrder: 1, isDefault: false, active: true, open: true },
    ];
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "h1", formFactor: "phone-portrait", stationId: null }),
      listZoneOffers: vi.fn().mockResolvedValue(burgerOffers),
      listStations: vi.fn().mockResolvedValue(stations),
      getTabLines: vi
        .fn()
        .mockResolvedValue({ lines: [burgerLine], revision: 7, editSentLines: false }),
    });
    await logIn(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    await openFromFloor(el, openTable);
    await flush(el);
    const screen = tableOrder(el)!;
    expect(screen.embedded).toBe(true);
    expect(screen.revision).toBe(7);
    expect(screen.editSentLines).toBe(false);
    expect(screen.stations).toEqual(stations);
  });

  it("reloads the order and says so when another device changed it first", async () => {
    const { el, screen } = await openBurgerTab({
      updateOrderLine: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    const reads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(screen, "change-line", change);
    await flush(el);

    expect(api.updateOrderLine).toHaveBeenCalledWith("wo-7", 5, { note: "no onions" }, 7);
    expect(api.getTabLines).toHaveBeenCalledTimes(reads + 1);
    expect(banner(el)!.textContent).toContain(t("held.changed_elsewhere"));
  });

  it("says the kitchen has started the line, and offers to cancel it", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [burgerLine], revision: 7, editSentLines: true })
      .mockResolvedValueOnce({
        lines: [{ ...burgerLine, state: "preparing" }],
        revision: 7,
        editSentLines: true,
      });
    const { el, screen } = await openBurgerTab({
      getTabLines,
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });

    emit(screen, "change-line", change);
    await flush(el);

    expect(banner(el)!.textContent).toContain(
      "La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo",
    );
    await flush(el);
    const dialog = cancelDialog(el)!;
    expect(dialog.kind).toBe("cancel");
    expect(dialog.target!.lineId).toBe("line-5");
    expect(dialog.shadowRoot!.textContent).toContain(t("table.cancel_started"));
  });

  it("clears the offer to cancel once the offered cancel is made", async () => {
    const { el, screen } = await openBurgerTab({
      getTabLines: vi.fn().mockResolvedValue({
        lines: [{ ...burgerLine, state: "preparing" }],
        revision: 7,
        editSentLines: true,
      }),
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    emit(screen, "change-line", change);
    await flush(el);
    await flush(el);
    expect(banner(el)).not.toBeNull();

    emit(cancelDialog(el)!, "adjust-preview", {
      action: "cancel",
      reasonId: cancelReason.id,
      note: null,
    });
    await flush(el);
    emit(cancelDialog(el)!, "adjust-confirm");
    await flush(el);
    await flush(el);

    expect(api.applyAdjustment).toHaveBeenCalledWith(
      "wo-7",
      expect.objectContaining({ lineId: "line-5", action: "cancel" }),
      expect.anything(),
    );
    expect(cancelDialog(el)).toBeNull();
    expect(banner(el)).toBeNull();
  });

  it("keeps the offer to cancel on screen when the offered dialog is closed without cancelling", async () => {
    const { el, screen } = await openBurgerTab({
      getTabLines: vi.fn().mockResolvedValue({
        lines: [{ ...burgerLine, state: "preparing" }],
        revision: 7,
        editSentLines: true,
      }),
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    emit(screen, "change-line", change);
    await flush(el);
    await flush(el);

    await closeCancel(el);

    expect(banner(el)!.textContent).toContain(codeMessage("ticket.already_started"));
  });

  it("offers Cancel again when a second change of the same line is refused the same way", async () => {
    const { el, screen } = await openBurgerTab({
      getTabLines: vi.fn().mockResolvedValue({
        lines: [{ ...burgerLine, state: "preparing" }],
        revision: 7,
        editSentLines: true,
      }),
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    emit(screen, "change-line", change);
    await flush(el);
    await flush(el);
    await closeCancel(el);
    expect(cancelDialog(el)).toBeNull();

    emit(tableOrder(el)!, "change-line", change);
    await flush(el);
    await flush(el);

    expect(cancelDialog(el)).not.toBeNull();
  });

  it("shows a dismissed Cancel offer only once, even when a handheld's Order tab mounts again", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "h1", formFactor: "phone-portrait", stationId: null }),
      listZoneOffers: vi.fn().mockResolvedValue(burgerOffers),
      getTabLines: vi.fn().mockResolvedValue({
        lines: [{ ...burgerLine, state: "preparing" }],
        revision: 7,
        editSentLines: true,
      }),
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });
    await logIn(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    await openFromFloor(el, openTable);
    await flush(el);
    emit(tableOrder(el)!, "change-line", change);
    await flush(el);
    await flush(el);
    expect(cancelDialog(el)).not.toBeNull();
    await closeCancel(el);

    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);
    await flush(el);

    expect(cancelDialog(el)).toBeNull();
  });

  describe("an answer that arrives after the waiter has moved to another table", () => {
    const otherTable: TableState = {
      ...openTable,
      id: "t3",
      label: "3",
      party: { ...openTable.party!, id: "v-3", mainBillId: "wo-8", tableIds: ["t3"] },
    };
    const otherLine: TabLine = { ...burgerLine, name: "Tarta", state: "preparing" };

    /** Sends a change on table 2, then opens table 3 before the server answers it. */
    async function changeThenOpenTable3() {
      let settle!: { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
      const { el, screen } = await openBurgerTab({
        getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
        getTabLines: vi.fn((orderId: string) =>
          Promise.resolve({
            lines: [orderId === "wo-8" ? otherLine : burgerLine],
            revision: orderId === "wo-8" ? 2 : 7,
            editSentLines: true,
          }),
        ),
        updateOrderLine: vi.fn(
          () => new Promise((resolve, reject) => (settle = { resolve, reject })),
        ),
      });
      emit(screen, "change-line", change);
      await flush(el);
      emit(screen, "back-to-floor");
      await flush(el);
      await openFromFloor(el, otherTable);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-8");
      return { el, settle, reads: vi.mocked(api.getTabLines).mock.calls.length };
    }

    it("says the change to the old table's line was refused, and touches nothing on the new table", async () => {
      const { el, settle, reads } = await changeThenOpenTable3();

      settle.reject({ code: "ticket.already_started" });
      await flush(el);

      expect(banner(el)!.textContent).toContain(
        "Tu cambio en Burger de la mesa 2 no se ha guardado. La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo",
      );
      expect(banner(el)!.textContent).not.toContain("Tarta");
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
      expect(tableOrder(el)!.revision).toBe(2);
      expect(api.getTabLines).toHaveBeenCalledTimes(reads);
    });

    it("says it cannot tell whether the change was saved when the server did not answer", async () => {
      const { el, settle } = await changeThenOpenTable3();

      settle.reject(new TypeError("Failed to fetch"));
      await flush(el);

      expect(banner(el)!.textContent).toContain(
        "El servidor no ha respondido a tu cambio en Burger de la mesa 2. Abre esa mesa y comprueba si se ha guardado.",
      );
    });

    it("says the change was not saved, in general words, when the failure names no reason", async () => {
      const { el, settle } = await changeThenOpenTable3();

      settle.reject(new Error("unexpected"));
      await flush(el);

      expect(banner(el)!.textContent).toContain(
        "Tu cambio en Burger de la mesa 2 no se ha guardado. Algo salió mal, inténtalo de nuevo",
      );
    });

    it("says nothing when the change was saved", async () => {
      const { el, settle, reads } = await changeThenOpenTable3();

      settle.resolve({ revision: 8, party: null });
      await flush(el);

      expect(banner(el)).toBeNull();
      expect(tableOrder(el)!.revision).toBe(2);
      expect(api.getTabLines).toHaveBeenCalledTimes(reads);
    });

    /** Sends a change on table 2 and goes back to the floor; the server's answer and table 3's
     * offers are each settled by the test. */
    async function changeThenLeave(overrides: Record<string, unknown> = {}) {
      let settle!: { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
      let releaseOffers: () => void = () => undefined;
      const { el, screen } = await openBurgerTab({
        getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
        getTabLines: vi.fn((orderId: string) =>
          Promise.resolve({
            lines: [orderId === "wo-8" ? otherLine : burgerLine],
            revision: orderId === "wo-8" ? 2 : 7,
            editSentLines: true,
          }),
        ),
        updateOrderLine: vi.fn(
          () => new Promise((resolve, reject) => (settle = { resolve, reject })),
        ),
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockImplementation(
            () => new Promise((resolve) => (releaseOffers = () => resolve(burgerOffers))),
          ),
        ...overrides,
      });
      emit(screen, "change-line", change);
      await flush(el);
      emit(screen, "back-to-floor");
      await flush(el);
      return {
        el,
        settle: () => settle,
        release: () => releaseOffers(),
        reads: vi.mocked(api.getTabLines).mock.calls.length,
      };
    }

    const startedRefusal =
      "Tu cambio en Burger de la mesa 2 no se ha guardado. La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo";

    it("names the refused change, and offers nothing on the next table, when the refusal lands while that table is still opening", async () => {
      const { el, settle, release, reads } = await changeThenLeave();
      await openFromFloor(el, otherTable);

      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      release();
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
      expect(banner(el)!.textContent).toContain(startedRefusal);
      expect(tableOrder(el)!.revision).toBe(2);
      expect(vi.mocked(api.getTabLines).mock.calls.slice(reads)).toEqual([["wo-8"]]);
    });

    it("keeps the named refusal that landed on the floor once the waiter opens another table", async () => {
      const { el, settle, release, reads } = await changeThenLeave();

      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      expect(banner(el)!.textContent).toContain(startedRefusal);
      await openFromFloor(el, otherTable);
      release();
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      expect(banner(el)!.textContent).toContain(startedRefusal);
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
      expect(vi.mocked(api.getTabLines).mock.calls.slice(reads)).toEqual([["wo-8"]]);
    });

    it("keeps the named refusal on screen when the waiter goes back to the floor again", async () => {
      const { el, settle } = await changeThenOpenTable3();
      settle.reject({ code: "ticket.already_started" });
      await flush(el);

      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);

      expect(tableOrder(el)).toBeNull();
      expect(banner(el)!.textContent).toContain(startedRefusal);
    });

    it("names the refused change on a handheld, which leaves the order through its Floor tab, while the next table is opening", async () => {
      let settle!: { reject: (reason: unknown) => void };
      let releaseOffers!: () => void;
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phoneCanvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "h1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
        getTabLines: vi.fn((orderId: string) =>
          Promise.resolve({
            lines: [orderId === "wo-8" ? otherLine : burgerLine],
            revision: orderId === "wo-8" ? 2 : 7,
            editSentLines: true,
          }),
        ),
        updateOrderLine: vi.fn(() => new Promise((_resolve, reject) => (settle = { reject }))),
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockImplementation(
            () => new Promise((resolve) => (releaseOffers = () => resolve(burgerOffers))),
          ),
      });
      await logIn(el);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      await openFromFloor(el, openTable);
      await flush(el);
      emit(tableOrder(el)!, "change-line", change);
      await flush(el);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      await openFromFloor(el, otherTable);

      settle.reject({ code: "ticket.already_started" });
      await flush(el);
      releaseOffers();
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
      expect(banner(el)!.textContent).toContain(startedRefusal);
    });

    /** Sends a held change on table 2 from a device on `canvas`; the test settles its answer. */
    async function changeOnCanvas(canvas: CanvasDef, overrides: Record<string, unknown> = {}) {
      let settle!: { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
      let releaseOffers: () => void = () => undefined;
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "h1", formFactor: canvas.formFactor, stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
        getTabLines: vi.fn((orderId: string) =>
          Promise.resolve({
            lines: [orderId === "wo-8" ? otherLine : burgerLine],
            revision: orderId === "wo-8" ? 2 : 7,
            editSentLines: true,
          }),
        ),
        updateOrderLine: vi.fn(
          () => new Promise((resolve, reject) => (settle = { resolve, reject })),
        ),
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockImplementation(
            () => new Promise((resolve) => (releaseOffers = () => resolve(burgerOffers))),
          ),
        ...overrides,
      });
      await logIn(el);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      await openFromFloor(el, openTable);
      await flush(el);
      emit(tableOrder(el)!, "change-line", change);
      await flush(el);
      return {
        el,
        settle: () => settle,
        release: () => releaseOffers(),
        reads: () => vi.mocked(api.getTabLines).mock.calls.length,
      };
    }

    it("names the refusal that lands while a handheld shows its Floor tab, and keeps it when another table opens", async () => {
      const { el, settle, release, reads } = await changeOnCanvas(phoneCanvas);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      const readsOnLeaving = reads();

      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      expect(banner(el)!.textContent).toContain(startedRefusal);
      expect(reads()).toBe(readsOnLeaving);
      await openFromFloor(el, otherTable);
      release();
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      expect(banner(el)!.textContent).toContain(startedRefusal);
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
    });

    it("names the refusal that lands after a till closes the table's view by selecting another tab", async () => {
      const { el, settle, reads } = await changeOnCanvas(tillCanvas);
      emit(shell(el), "tab-select", { key: "counter" });
      await flush(el);
      expect(tableOrder(el)).toBeNull();
      const readsOnLeaving = reads();

      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      expect(banner(el)!.textContent).toContain(startedRefusal);
      expect(reads()).toBe(readsOnLeaving);
    });

    it("treats a handheld's tap on the Order tab it is already on as staying on the order", async () => {
      const { el, settle } = await changeOnCanvas(phoneCanvas);
      emit(shell(el), "tab-select", { key: "order" });
      await flush(el);

      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      expect(banner(el)!.textContent).not.toContain("Tu cambio");
      await flush(el);
      expect(cancelDialog(el)).not.toBeNull();
    });

    it("names the refusal that lands while a tablet opens another table from the same tab", async () => {
      const tabletCanvas: CanvasDef = {
        formFactor: "tablet-landscape",
        tabs: [
          {
            key: "floor",
            title: "Floor",
            columns: 24,
            cards: [
              { type: "floor-plan", colSpan: 12, rowSpan: 12, config: {} },
              { type: "table-order", colSpan: 12, rowSpan: 12, config: {} },
            ],
          },
        ],
      };
      const { el, settle, release } = await changeOnCanvas(tabletCanvas);
      await openFromFloor(el, otherTable);

      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      release();
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
      expect(banner(el)!.textContent).toContain(startedRefusal);
    });

    it("keeps the named refusal when the next table's menus then fail to load", async () => {
      const { el, settle } = await changeThenLeave({
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockRejectedValue(new Error("offers down")),
      });
      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      await openFromFloor(el, otherTable);
      await flush(el);

      expect(banner(el)!.textContent).toContain(startedRefusal);
    });

    it("leaves the table out of the message when the floor no longer lists the changed order's table", async () => {
      const { el, settle } = await changeThenLeave({
        getTablesState: vi
          .fn()
          .mockResolvedValueOnce([openTable, otherTable])
          .mockResolvedValue([otherTable]),
      });

      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      expect(banner(el)!.textContent!.trim()).toBe(
        "Tu cambio en Burger no se ha guardado. La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo",
      );
    });

    it("leaves the table out of the unanswered message too", async () => {
      const { el, settle } = await changeThenLeave({
        getTablesState: vi
          .fn()
          .mockResolvedValueOnce([openTable, otherTable])
          .mockResolvedValue([otherTable]),
      });

      settle().reject(new TypeError("Failed to fetch"));
      await flush(el);

      expect(banner(el)!.textContent!.trim()).toBe(
        "El servidor no ha respondido a tu cambio en Burger. Abre su mesa y comprueba si se ha guardado.",
      );
    });

    it("also says the next table did not open when its menus fail to load under the named refusal", async () => {
      const { el, settle } = await changeThenLeave({
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockRejectedValue(new Error("offers down")),
      });
      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      await openFromFloor(el, otherTable);
      await flush(el);

      const text = banner(el)!.textContent!;
      expect(text).toContain(startedRefusal);
      expect(text).toContain(t("table.error"));
    });

    it("shows the named refusal and the failed open as two visibly separate messages", async () => {
      const { el, settle } = await changeThenLeave({
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockRejectedValue(new Error("offers down")),
      });
      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      await openFromFloor(el, otherTable);
      await flush(el);

      const parts = [...banner(el)!.querySelectorAll<HTMLElement>(".error-part")];
      expect(parts.map((part) => part.textContent!.trim())).toEqual([
        startedRefusal,
        t("table.error"),
      ]);
      const second = getComputedStyle(parts[1]!);
      expect(second.display).toBe("block");
      expect(parseFloat(second.borderTopWidth)).toBeGreaterThan(0);
      expect(parseFloat(second.paddingTop)).toBeGreaterThan(0);
      expect(parseFloat(second.marginTop)).toBeGreaterThan(0);
    });

    it("drops the failed open from the banner, and keeps the named refusal, when the waiter tries a table again", async () => {
      let offersUp = true;
      const { el, settle } = await changeThenLeave({
        listZoneOffers: vi.fn(() =>
          offersUp ? Promise.resolve(burgerOffers) : Promise.reject(new Error("offers down")),
        ),
      });
      offersUp = false;
      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      await openFromFloor(el, otherTable);
      await flush(el);
      expect(banner(el)!.textContent).toContain(t("table.error"));

      offersUp = true;
      await openFromFloor(el, otherTable);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      const text = banner(el)!.textContent!;
      expect(text).toContain(startedRefusal);
      expect(text).not.toContain(t("table.error"));
    });

    it("names the refusal that lands after the operator logged out, and reads nothing again", async () => {
      const { el, settle, reads } = await changeOnCanvas(tillCanvas);
      emit(shell(el), "logout");
      await flush(el);
      expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
      const readsOnLeaving = reads();

      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      expect(banner(el)!.textContent).toContain(startedRefusal);
      expect(reads()).toBe(readsOnLeaving);
    });
  });

  describe("an answer that arrives once the waiter is back on the same order", () => {
    const otherTable: TableState = {
      ...openTable,
      id: "t3",
      label: "3",
      party: { ...openTable.party!, id: "v-3", mainBillId: "wo-8", tableIds: ["t3"] },
    };
    const noted: TabLine = { ...burgerLine, note: "no onions" };

    /** Sends a held change on table 2 from a device on `canvas`. Once `saved()` is called, table 2
     * reads back with the note at revision 8; table 3's menus are held until `release()`. */
    async function changeHeld(canvas: CanvasDef, overrides: Record<string, unknown> = {}) {
      let settle!: { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
      let releaseOffers: () => void = () => undefined;
      let isSaved = false;
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "h1", formFactor: canvas.formFactor, stationId: null }),
        getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
        getTabLines: vi.fn((orderId: string) =>
          Promise.resolve(
            orderId === "wo-8"
              ? { lines: [{ ...burgerLine, name: "Tarta" }], revision: 2, editSentLines: true }
              : isSaved
                ? { lines: [noted], revision: 8, editSentLines: true }
                : { lines: [burgerLine], revision: 7, editSentLines: true },
          ),
        ),
        updateOrderLine: vi.fn(
          () => new Promise((resolve, reject) => (settle = { resolve, reject })),
        ),
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockImplementation(
            () => new Promise((resolve) => (releaseOffers = () => resolve(burgerOffers))),
          ),
        ...overrides,
      });
      await logIn(el);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      await openFromFloor(el, openTable);
      await flush(el);
      emit(tableOrder(el)!, "change-line", change);
      await flush(el);
      return {
        el,
        settle: () => settle,
        saved: () => (isSaved = true),
        release: () => releaseOffers(),
        reads: () => vi.mocked(api.getTabLines).mock.calls.length,
      };
    }

    it("takes the saved revision and reads the order again after a handheld goes to its Floor tab and back", async () => {
      const { el, settle, saved, reads } = await changeHeld(phoneCanvas);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      emit(shell(el), "tab-select", { key: "order" });
      await flush(el);
      const readsBack = reads();

      saved();
      settle().resolve({ revision: 8, party: null });
      await flush(el);

      expect(reads()).toBe(readsBack + 1);
      expect(tableOrder(el)!.revision).toBe(8);
      expect(tableOrder(el)!.lines[0]!.note).toBe("no onions");
      expect(banner(el)).toBeNull();
    });

    it("says the kitchen has started the line, and offers to cancel it, after a handheld goes to its Floor tab and back", async () => {
      const { el, settle, reads } = await changeHeld(phoneCanvas);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      emit(shell(el), "tab-select", { key: "order" });
      await flush(el);
      const readsBack = reads();

      settle().reject({ code: "ticket.already_started" });
      await flush(el);

      const text = banner(el)!.textContent!;
      expect(text).not.toContain("Tu cambio");
      expect(text).toContain(
        "La cocina ya ha empezado este plato, así que ya no se puede cambiar. Puedes cancelarlo",
      );
      expect(reads()).toBe(readsBack + 1);
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      await flush(el);
      const dialog = cancelDialog(el)!;
      expect(dialog.kind).toBe("cancel");
      expect(dialog.target!.name).toBe("Burger");
    });

    it("takes the saved revision after a till goes back to the floor and opens the same table again", async () => {
      const { el, settle, saved, release, reads } = await changeHeld(tillCanvas);
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);
      await openFromFloor(el, openTable);
      release();
      await flush(el);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      const readsBack = reads();

      saved();
      settle().resolve({ revision: 8, party: null });
      await flush(el);

      expect(reads()).toBe(readsBack + 1);
      expect(tableOrder(el)!.revision).toBe(8);
      expect(banner(el)).toBeNull();
    });

    it("takes the saved revision when a tablet's open of another table fails and leaves the order on screen", async () => {
      const tablet: CanvasDef = {
        formFactor: "tablet-landscape",
        tabs: [
          {
            key: "floor",
            title: "Floor",
            columns: 24,
            cards: [
              { type: "floor-plan", colSpan: 12, rowSpan: 12, config: {} },
              { type: "table-order", colSpan: 12, rowSpan: 12, config: {} },
            ],
          },
        ],
      };
      const { el, settle, saved, reads } = await changeHeld(tablet, {
        listZoneOffers: vi
          .fn()
          .mockResolvedValueOnce(burgerOffers)
          .mockRejectedValue(new Error("offers down")),
      });
      await openFromFloor(el, otherTable);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      const readsBefore = reads();

      saved();
      settle().resolve({ revision: 8, party: null });
      await flush(el);

      expect(reads()).toBe(readsBefore + 1);
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      expect(tableOrder(el)!.revision).toBe(8);
      expect(tableOrder(el)!.lines[0]!.note).toBe("no onions");
    });

    it("reads the order again at once when the change is saved while a till is reopening the same table", async () => {
      const { el, settle, saved, release, reads } = await changeHeld(tillCanvas);
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);
      await openFromFloor(el, openTable);
      const readsBefore = reads();

      saved();
      settle().resolve({ revision: 8, party: null });
      await flush(el);
      expect(reads()).toBe(readsBefore + 1);

      release();
      await flush(el);
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      expect(tableOrder(el)!.revision).toBe(8);
    });

    it("names the refusal when a handheld goes back to the order while another table is still opening", async () => {
      const { el, settle, release } = await changeHeld(phoneCanvas);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      await openFromFloor(el, otherTable);
      emit(shell(el), "tab-select", { key: "order" });
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-7");

      settle().reject({ code: "ticket.already_started" });
      await flush(el);
      release();
      await flush(el);
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-8");
      await flush(el);
      expect(cancelDialog(el)).toBeNull();
      expect(banner(el)!.textContent).toContain(
        "Tu cambio en Burger de la mesa 2 no se ha guardado.",
      );
    });
  });

  it("shows the table the waiter opened, not the lines of an earlier order whose read answers later", async () => {
    const otherTable: TableState = {
      ...openTable,
      id: "t3",
      label: "3",
      party: { ...openTable.party!, id: "v-3", mainBillId: "wo-8", tableIds: ["t3"] },
    };
    const otherLine: TabLine = { ...burgerLine, name: "Tarta", state: "preparing" };
    let finishReload!: () => void;
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [burgerLine], revision: 7, editSentLines: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishReload = () =>
              resolve({
                lines: [{ ...burgerLine, note: "no onions" }],
                revision: 8,
                editSentLines: false,
              });
          }),
      )
      .mockResolvedValue({ lines: [otherLine], revision: 2, editSentLines: true });
    const { el, screen } = await openBurgerTab({
      getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
      getTabLines,
      updateOrderLine: vi.fn().mockResolvedValue({ revision: 8, party: null }),
    });

    emit(screen, "change-line", change);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    await openFromFloor(el, otherTable);
    await flush(el);
    finishReload();
    await flush(el);

    expect(getTabLines.mock.calls.map(([orderId]) => orderId)).toEqual(["wo-7", "wo-7", "wo-8"]);
    expect(tableOrder(el)!.orderId).toBe("wo-8");
    expect(tableOrder(el)!.lines.map((line) => line.name)).toEqual(["Tarta"]);
    expect(tableOrder(el)!.revision).toBe(2);
    expect(tableOrder(el)!.editSentLines).toBe(true);
  });

  it("keeps the opened table's lines when an earlier order's read fails after them", async () => {
    const otherTable: TableState = {
      ...openTable,
      id: "t3",
      label: "3",
      party: { ...openTable.party!, id: "v-3", mainBillId: "wo-8", tableIds: ["t3"] },
    };
    const otherLine: TabLine = { ...burgerLine, name: "Tarta", state: "preparing" };
    let failReload!: () => void;
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [burgerLine], revision: 7, editSentLines: true })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failReload = () => reject(new TypeError("Failed to fetch"));
          }),
      )
      .mockResolvedValue({ lines: [otherLine], revision: 2, editSentLines: true });
    const { el, screen } = await openBurgerTab({
      getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
      getTabLines,
      updateOrderLine: vi.fn().mockResolvedValue({ revision: 8, party: null }),
    });

    emit(screen, "change-line", change);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    await openFromFloor(el, otherTable);
    await flush(el);
    failReload();
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-8");
    expect(tableOrder(el)!.lines.map((line) => line.name)).toEqual(["Tarta"]);
  });

  it("offers no Cancel when the waiter moves to another table while the refused line reloads", async () => {
    const otherTable: TableState = {
      ...openTable,
      id: "t3",
      label: "3",
      party: { ...openTable.party!, id: "v-3", mainBillId: "wo-8", tableIds: ["t3"] },
    };
    const otherLine: TabLine = { ...burgerLine, name: "Tarta", state: "preparing" };
    let finishReload!: () => void;
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce({ lines: [burgerLine], revision: 7, editSentLines: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishReload = () => resolve({ lines: [otherLine], revision: 7, editSentLines: true });
          }),
      )
      .mockResolvedValue({ lines: [otherLine], revision: 2, editSentLines: true });
    const { el, screen } = await openBurgerTab({
      getTablesState: vi.fn().mockResolvedValue([openTable, otherTable]),
      getTabLines,
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_started" }),
    });

    emit(screen, "change-line", change);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    await openFromFloor(el, otherTable);
    await flush(el);
    finishReload();
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-8");
    await flush(el);
    expect(cancelDialog(el)).toBeNull();
  });

  it("says changes to sent items are switched off, and reloads the line's actions", async () => {
    const { el, screen } = await openBurgerTab({
      updateOrderLine: vi.fn().mockRejectedValue({ code: "ticket.already_fired" }),
    });
    const reads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(screen, "change-line", change);
    await flush(el);

    expect(banner(el)!.textContent).toContain(
      "Este plato ya ha ido a cocina y en este local no se pueden cambiar los platos enviados. Puedes cancelarlo",
    );
    expect(api.getTabLines).toHaveBeenCalledTimes(reads + 1);
  });

  const settle = (el: TillApp) => async () => {
    await flush(el);
    await flush(el);
  };

  it("cancels one of a line as a cancel adjustment with the quantity", async () => {
    const { el, screen } = await openBurgerTab();

    await cancelThroughDialog(el, screen, "line-5", settle(el), "1");

    expect(api.applyAdjustment).toHaveBeenCalledWith(
      "wo-7",
      expect.objectContaining({ lineId: "line-5", action: "cancel", quantity: "1" }),
      expect.anything(),
    );
    expect(api.updateOrderLine).not.toHaveBeenCalled();
  });

  it("says so under the quantity when the quantity to cancel is refused", async () => {
    const { el, screen } = await openBurgerTab({
      applyAdjustment: vi.fn().mockRejectedValue({ code: "adjustment.quantity_invalid" }),
    });

    await cancelThroughDialog(el, screen, "line-5", settle(el), "1");

    expect(
      cancelDialog(el)!.shadowRoot!.querySelector('[data-error-for="quantity"]')!.textContent,
    ).toBe(codeMessage("adjustment.quantity_invalid"));
  });
});

describe("till-app table ordering: paying the tab", () => {
  it("files the tab once when pay-tab fires again while the first payment is in flight", async () => {
    let settle!: (result: TillSaleResult) => void;
    const recordSale = vi.fn(() => new Promise<TillSaleResult>((resolve) => (settle = resolve)));
    const { el } = await mountApp({ recordSale });
    const screen = await toTableOrder(el);

    emit(screen, "pay-tab", { method: "cash", amount: "3.00" });
    emit(screen, "pay-tab", { method: "cash", amount: "3.00" });
    await flush(el);
    expect(recordSale).toHaveBeenCalledOnce();

    settle(saleResult);
    await flush(el);
    expect(ticket(el)).not.toBeNull();
    expect(recordSale).toHaveBeenCalledOnce();
  });

  it("says the sale is unconfirmed when paying the tab gets no answer", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const screen = await toTableOrder(el);

    emit(screen, "pay-tab", { method: "cash", amount: "3.00" });
    await flush(el);

    const text = banner(el)!.textContent!;
    expect(text).toContain(t("sale.unconfirmed"));
    expect(text).not.toContain(t("sale.error"));
    expect(ticket(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
  });

  it("says the operator may not take payments when paying the tab is refused the payment permission", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "authorization.not_permitted",
        status: 403,
        permission: "sale.take_payment",
      }),
    });
    const screen = await toTableOrder(el);

    emit(screen, "pay-tab", { method: "cash", amount: "3.00" });
    await flush(el);

    const text = banner(el)!.textContent!;
    expect(text).toContain(t("take_payment.not_permitted"));
    expect(text).not.toContain(t("sale.error"));
    expect(ticket(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
  });

  it("says the bill is over the simplified-invoice limit, naming the limit, when paying the tab is refused for it", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({
        code: "sale.total_exceeds_simplified_limit",
        total: "3150.00",
        limit: "3010.00",
        status: 409,
      }),
    });
    const screen = await toTableOrder(el);

    emit(screen, "pay-tab", { method: "cash", amount: "3.00" });
    await flush(el);

    const text = banner(el)!.textContent!;
    expect(text).toBe(
      t("sale.over_simplified_limit").replace("{amount}", () =>
        formatMoney("3010.00", currentLocale()),
      ),
    );
    expect(text).toContain("3010,00");
    expect(ticket(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
  });
});

describe("till-app table ordering: logout while a request is waiting for the server", () => {
  it("stays on the lock screen when a new tab's answer arrives after the operator logged out", async () => {
    let answerOpenTab!: (tab: { tabId: string; orderNumber: number }) => void;
    const { el } = await mountApp({
      seatTable: vi.fn(
        () =>
          new Promise<{ tabId: string; orderNumber: number }>(
            (resolve) => (answerOpenTab = resolve),
          ),
      ),
    });
    await logIn(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    await openFromFloor(el, { ...openTable, hasOpenTab: false });
    expect(api.seatTable).toHaveBeenCalledWith(openTable.id, null);

    emit(shell(el), "logout");
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();

    answerOpenTab({ tabId: "wo-new", orderNumber: 12 });
    await flush(el);
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-tab-shell")).toBeNull();
    expect((el as unknown as { operatorName: string }).operatorName).toBe("");
  });

  it("stays locked when a tab payment's answer arrives after logout, and the next sign-in opens on the first tab, not that ticket", async () => {
    let settle!: (result: TillSaleResult) => void;
    const recordSale = vi.fn(() => new Promise<TillSaleResult>((resolve) => (settle = resolve)));
    const { el } = await mountApp({ recordSale });
    const screen = await toTableOrder(el);
    emit(screen, "pay-tab", { method: "cash", amount: "3.00" });
    await flush(el);
    emit(shell(el), "logout");
    await flush(el);

    settle(saleResult);
    await flush(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-tab-shell")).toBeNull();

    await logIn(el);
    expect(shell(el).activeTabKey).toBe("counter");
    expect(ticket(el)).toBeNull();
  });
});

describe("till-app table ordering: a menu published while a table is open", () => {
  it("reloads the table's offers, sends the round again once, and says why when that is refused too", async () => {
    const { el } = await mountApp({
      ...seatedFloor(),
      submitDraft: vi.fn().mockRejectedValue({
        code: "menu.version_changed",
        status: 409,
        menus: [{ menuId: "menu-lunch", liveVersionId: "v2" }],
      }),
    });
    const screen = await toTableOrder(el);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(1);

    const round = screen.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;
    round.addProduct(
      screen.products.find((product) => product.menuItemId === "menu-item-sopa-0")!,
      "1",
    );
    await flush(el);
    emit(screen, "submit-draft", {
      lines: [{ menuItemId: "menu-item-sopa-0", quantity: "1" }],
      groups: [{ release: "fire", lineIndexes: [0] }],
      store: round,
      sent: round.lines,
    });
    await flush(el);
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledTimes(2);
    expect(api.listZoneOffers).toHaveBeenCalledTimes(3);
    expect(api.listZoneOffers).toHaveBeenLastCalledWith(floorZone.id, {
      signal: expect.any(AbortSignal),
    });
    expect(banner(el)!.textContent).toContain(codeMessage("menu.version_changed"));
  });

  it("greys a table's sold-out dish at the next poll of the table's zone, without reloading", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const menuState = vi.fn(async (zoneId: string) => ({
        menus: (zoneId === floorZone.id ? diningOffers : counterOffers).menus.map((menu) => ({
          menuId: menu.id,
          versionId: menu.versionId,
        })),
        unavailable: {
          products: ["cordero"],
          optionLabels: [],
        },
      }));
      const { el } = await mountApp({
        menuState,
        listDefaultZoneOffers: vi.fn().mockResolvedValue({
          ...counterOffers,
          context: { ...counterOffers.context, zoneId: "zone-counter" },
        }),
      });
      await toTableOrder(el);
      vi.advanceTimersByTime(15_000);
      await flush(el);
      await flush(el);

      expect(menuState.mock.calls.map((call) => call[0])).toEqual(["zone-counter", floorZone.id]);
      const cordero = tableOrder(el)!.products.find((product) => product.id === "cordero")!;
      expect(cordero.available).toBe(false);
      expect(api.listZoneOffers).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reloads a table's offers when the poll names a new version of a menu in the table's zone", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const republished = {
        ...diningOffers,
        menus: diningOffers.menus
          .filter((menu) => menu.id === "menu-dinner")
          .map((menu) => ({ ...menu, versionId: "v2" })),
        offers: diningOffers.offers.filter((offer) => offer.menuId === "menu-dinner"),
      };
      const listZoneOffers = vi
        .fn()
        .mockResolvedValueOnce(diningOffers)
        .mockResolvedValue(republished);
      const menuState = vi.fn(async (zoneId: string) => ({
        menus:
          zoneId === floorZone.id
            ? [{ menuId: "menu-dinner", versionId: "v2" }]
            : counterOffers.menus.map((menu) => ({ menuId: menu.id, versionId: menu.versionId })),
        unavailable: { products: [], optionLabels: [] },
      }));
      const { el } = await mountApp({
        menuState,
        listZoneOffers,
        listDefaultZoneOffers: vi.fn().mockResolvedValue({
          ...counterOffers,
          context: { ...counterOffers.context, zoneId: "zone-counter" },
        }),
      });
      const screen = await toTableOrder(el);
      emit(screen, "menu-selected", { id: "menu-lunch" });
      await flush(el);
      vi.advanceTimersByTime(15_000);
      await flush(el);
      await flush(el);

      expect(listZoneOffers).toHaveBeenLastCalledWith(floorZone.id, {
        signal: expect.any(AbortSignal),
      });
      expect(tableOrder(el)!.products.map((product) => product.id)).toEqual(["cordero"]);
      // Lunch is no longer in the zone, so the table falls back to its default menu.
      expect(tableOrder(el)!.selectedMenuId).toBe("menu-dinner");
    } finally {
      vi.useRealTimers();
    }
  });
});

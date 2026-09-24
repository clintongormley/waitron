import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { productUnit } from "./widgets/product-name.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  FloorZone,
  ProductCatalogue,
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
  hasOpenTab: true,
  tabId: "wo-7",
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
};

const tabLine: TabLine = {
  lineNo: 1,
  productId: "cafe",
  quantity: "2.000",
  unitPriceGross: "1.50",
  servedAt: null,
  courseId: null,
  firedAt: "2026-08-17T09:59:00.000Z",
  state: "queued",
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
  return {
    context: { zoneId: floorZone.id, departmentId: "department-default", serviceMode: "prepay" },
    defaultMenuId,
    menus: catalogue.menus,
    offers: catalogue.products.map((product, index): ZoneOfferCatalogue["offers"][number] => ({
      id: product.menuItemId ?? `menu-item-${product.id}-${index}`,
      menuId: product.catalogueId ?? "menu-fixture",
      productId: product.productId ?? product.id,
      sectionId: `section-${index}`,
      grossPrice: product.unitPrice,
      unitPrice: product.unitPrice,
      displayOrder: index,
      active: true,
      menuName: product.catalogueName ?? "Menu",
      sectionName: { en: product.category ?? "Other" },
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
    getTablesState: vi.fn().mockResolvedValue([openTable]),
    listZones: vi.fn().mockResolvedValue([floorZone]),
    listStatuses: vi.fn().mockResolvedValue([]),
    openTab: vi.fn().mockResolvedValue({ tabId: "wo-new", orderNumber: 12 }),
    getTabLines: vi.fn().mockResolvedValue([tabLine]),
    addTabRound: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    markLineServed: vi.fn().mockResolvedValue(undefined),
    setLineCourse: vi.fn().mockResolvedValue(undefined),
    sendLines: vi.fn().mockResolvedValue(undefined),
    recallLines: vi.fn().mockResolvedValue(undefined),
    voidLine: vi.fn().mockResolvedValue(undefined),
    setTableStatus: vi.fn().mockResolvedValue(undefined),
    moveTab: vi.fn().mockResolvedValue(undefined),
    joinTable: vi.fn().mockResolvedValue(undefined),
    mergeTabs: vi.fn().mockResolvedValue(undefined),
    transferLines: vi.fn().mockResolvedValue(undefined),
    splitTab: vi.fn().mockResolvedValue({ checkId: "wo-check" }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
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
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
}

async function openFromFloor(el: TillApp, table: TableState): Promise<void> {
  emit(floor(el)!, "open-table", { tableId: table.id, hasOpenTab: table.hasOpenTab });
  await flush(el);
}

async function toTableOrder(el: TillApp): Promise<TillTableOrderScreen> {
  await logIn(el);
  emit(shell(el), "tab-select", { key: "floor" });
  await flush(el);
  await openFromFloor(el, openTable);
  return tableOrder(el)!;
}

beforeEach(() => setLocale("es-ES"));
const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  sessionStorage.removeItem("waitron.lastMenu");
  sessionStorage.removeItem("waitron.dietFilter");
  history.replaceState(null, "", initialUrl);
});

describe("till-app table ordering: the table's menus", () => {
  it("falls back to the menu marked default when the table's zone names none", async () => {
    const { el } = await mountApp();
    const screen = await toTableOrder(el);

    expect(api.listZoneOffers).toHaveBeenCalledWith(floorZone.id);
    expect(screen.menus).toEqual(diningMenus);
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
      tabId: undefined,
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
    expect(api.openTab).not.toHaveBeenCalled();
  });

  it("says nothing about a failed offer load for a table the operator has already left", async () => {
    const tableA = { ...openTable, id: "table-a", tabId: "order-a", zoneId: "zone-a" };
    const tableB = { ...openTable, id: "table-b", tabId: "order-b", zoneId: "zone-b" };
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

    emit(floor(el)!, "open-table", { tableId: tableA.id, hasOpenTab: true });
    emit(floor(el)!, "open-table", { tableId: tableB.id, hasOpenTab: true });
    await flush(el);
    rejectA({ code: "service_zone.not_found" });
    await flush(el);

    expect(banner(el)).toBeNull();
    expect(tableOrder(el)!.orderId).toBe("order-b");
    expect(tableOrder(el)!.menus).toEqual(diningMenus);
    expect(api.getTabLines).toHaveBeenCalledTimes(1);
    expect(api.getTabLines).toHaveBeenCalledWith("order-b");
  });
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
    ["send-round", { lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }] }, "addTabRound"],
    ["fire-course", { courseId: "c1" }, "fireCourse"],
    ["serve-line", { lineNo: 1 }, "markLineServed"],
    ["set-line-course", { lineNo: 1, courseId: null }, "setLineCourse"],
    ["send-lines", { lineNos: [] }, "sendLines"],
    ["recall-lines", { lineNos: [1] }, "recallLines"],
    ["void-line", { lineNo: 1 }, "voidLine"],
    ["set-status", { statusId: "s1" }, "setTableStatus"],
    ["move-tab", { toTableId: "t9" }, "moveTab"],
    ["join-table", { tableId: "t9" }, "joinTable"],
    ["merge-tabs", { fromTabId: "wo-9", freeSourceTable: true }, "mergeTabs"],
    ["transfer-lines", { toTabId: "wo-9", transfers: [{ lineNo: 1 }] }, "transferLines"],
    ["split-lines", { transfers: [{ lineNo: 1 }] }, "splitTab"],
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
    ["join-table", { tableId: "t9" }, "joinTable"],
    ["merge-tabs", { fromTabId: "wo-9", freeSourceTable: true }, "mergeTabs"],
    ["transfer-lines", { toTabId: "wo-9", transfers: [{ lineNo: 1 }] }, "transferLines"],
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

  it("a split refused for any other reason shows table.error and keeps paying the original tab", async () => {
    const { el } = await mountApp({
      splitTab: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
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

    emit(screen, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(api.moveTab).toHaveBeenCalledWith("wo-7", "t9");
    expect(tableOrder(el)!.tables).toEqual([]);
    expect(banner(el)).toBeNull();
  });

  it("shows an empty tab rather than stale lines when the re-read after a round fails", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValueOnce([tabLine])
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ getTabLines });
    const screen = await toTableOrder(el);
    expect(screen.lines).toEqual([tabLine]);

    emit(screen, "send-round", { lines: [{ menuItemId: "menu-item-cafe-0", quantity: "1" }] });
    await flush(el);

    expect(api.addTabRound).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.lines).toEqual([]);
    expect(banner(el)).toBeNull();
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
});

describe("till-app table ordering: logout while a request is waiting for the server", () => {
  it("stays on the lock screen when a new tab's answer arrives after the operator logged out", async () => {
    let answerOpenTab!: (tab: { tabId: string; orderNumber: number }) => void;
    const { el } = await mountApp({
      openTab: vi.fn(
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
    expect(api.openTab).toHaveBeenCalledWith(openTable.id);

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
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { SUBMIT_RETRY_PAUSE_MS, TillApp } from "./till-app.js";
import { formatMoney } from "@waitron/shared";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import { WorkingOrderStore } from "./state/working-order.js";
import type {
  CurrentOrders,
  FloorZone,
  OrderGroup,
  PrintProblem,
  TabLine,
  TableState,
  TableParty,
  TillApi,
  TillProduct,
  TillSaleResult,
  PartyBill,
  ZoneOfferCatalogue,
} from "./api/client.js";

const zone: FloorZone = { id: "z1", name: "Comedor", displayOrder: 0, active: true };

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t4",
    label: "4",
    zoneId: "z1",
    capacity: 4,
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
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    party: null,
    ...over,
  };
}

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "v1",
    revision: 3,
    guestCount: 3,
    state: "open",
    outstanding: "44.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function seated(over: Partial<TableState> = {}, partyOver: Partial<TableParty> = {}): TableState {
  return table({
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabId: "wo-4",
    tabLineCount: 3,
    tabTotal: "44.00",
    party: party(partyOver),
    ...over,
  });
}

const mesa4 = seated();
const mesa7 = seated(
  { id: "t7", label: "7", tabId: "wo-7" },
  { id: "v7", revision: 9, tableIds: ["t7"] },
);
const mesa9 = table({ id: "t9", label: "9" });

const tabBill: PartyBill = {
  workingOrderId: "wo-4",
  partyId: "v1",
  label: null,
  status: "open",
  total: "14.00",
  outstanding: "14.00",
  receiptAvailable: false,
};
const checkBill: PartyBill = {
  workingOrderId: "wo-check",
  partyId: "v1",
  label: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  receiptAvailable: false,
};

const tabLine: TabLine = {
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

const saleResult: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "F-0001",
  issuedAt: "2026-08-05T10:00:00.000Z",
  total: "30.00",
  vatBreakdown: [{ rate: "21", base: "24.79", tax: "5.21" }],
  lines: [{ descriptions: { "es-ES": "Vino" }, quantity: "1", gross: "30.00" }],
  tender: { method: "cash", change: "0.00" },
  qr: "https://example.test/vf?nif=B1&num=F-0001&fecha=05-08-2026&total=30.00",
};

const canvas: CanvasDef = {
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

const till = {
  locale: "en",
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
  canvas,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
  context: { zoneId: zone.id, departmentId: "department-default", serviceMode: "prepay" },
  defaultMenuId: null,
  menus: [],
  offers: [],
};

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
    listDefaultZoneOffers: vi.fn().mockResolvedValue(offers),
    listZoneOffers: vi.fn().mockResolvedValue(offers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9]),
    listZones: vi.fn().mockResolvedValue([zone]),
    listStatuses: vi.fn().mockResolvedValue([]),
    seatTable: vi
      .fn()
      .mockResolvedValue({ partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 }),
    getPartyBills: vi.fn().mockResolvedValue([tabBill, checkBill]),
    finishTable: vi.fn().mockResolvedValue({ state: "closed" }),
    markTableCleared: vi.fn().mockResolvedValue(undefined),
    getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    fireGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    markServed: vi.fn().mockResolvedValue({ revision: 4 }),
    unmarkServed: vi.fn().mockResolvedValue({ revision: 4 }),
    markGroupServed: vi.fn().mockResolvedValue({ revision: 4 }),
    snoozeGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    unsnoozeGroup: vi.fn().mockResolvedValue({ revision: 4 }),
    sendLines: vi.fn().mockResolvedValue(undefined),
    moveTab: vi.fn().mockResolvedValue(undefined),
    joinTable: vi.fn().mockResolvedValue(undefined),
    mergeTabs: vi.fn().mockResolvedValue(undefined),
    transferLines: vi.fn().mockResolvedValue(undefined),
    splitTab: vi.fn().mockResolvedValue({ checkId: "wo-check" }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    reprint: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
    ...overrides,
  } as unknown as TillApi;
}

/** The server's side of the party's drafts, fresh for each test. */
let drafts: DraftServer;

type SubmitArgs = Parameters<DraftServer["apply"]>;
/** A draft submission the server takes, answering `value` about the groups it placed. */
const answering = (value: object) =>
  vi.fn(async (...args: SubmitArgs) => ({ ...drafts.apply(...args), ...value }));

/** The signed-in person's draft on the open table. */
const partyDraft = (order: TillTableOrderScreen) =>
  order.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api });
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!;
const tabGrid = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-card-grid");
const floor = (el: TillApp) =>
  tabGrid(el)?.shadowRoot?.querySelector<TillFloorScreen>("till-floor-screen") ?? null;
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen");
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
/** The party's groups as the open order's Tab drawer lists them. */
const heldGroupsList = (el: TillApp) =>
  [...(tableOrder(el)?.shadowRoot?.querySelectorAll<HTMLElement>("[data-group]") ?? [])].map(
    (row) => ({
      position: row.querySelector("[data-group-position]")!.textContent!.trim(),
      state: row.dataset.groupState,
      summary: row.querySelector("[data-group-summary]")!.textContent!.trim(),
      lines: [...row.querySelectorAll(".group-line-name")].map((name) =>
        name.textContent!.replace(/\s+/g, " ").trim(),
      ),
    }),
  );

async function toFloor(el: TillApp): Promise<TillFloorScreen> {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  emit(shell(el), "tab-select", { key: "floor" });
  await flush(el);
  return floor(el)!;
}

async function openMesa(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
  const screen = await toFloor(el);
  emit(screen, "open-table", { tableId, seated: true });
  await flush(el);
  return tableOrder(el)!;
}

beforeEach(() => {
  setLocale("en");
  drafts = draftServer();
});
afterEach(cleanupWidgets);

describe("till-app: seating a party", () => {
  it("taps a free table, takes a guest count of 3 and opens the new party's tab", async () => {
    const seatedMesa9 = seated(
      { id: "t9", label: "9", tabId: "wo-new", tabLineCount: 0, tabTotal: "0.00" },
      { id: "v-new", revision: 0, outstanding: "0.00", tableIds: ["t9"] },
    );
    const getTablesState = vi
      .fn()
      .mockResolvedValueOnce([mesa4, mesa7, mesa9])
      .mockResolvedValue([mesa4, mesa7, seatedMesa9]);
    const { el } = await mountApp({ getTablesState, getPartyBills: vi.fn().mockResolvedValue([]) });
    const screen = await toFloor(el);

    screen.shadowRoot!.querySelector<HTMLElement>('[data-table="t9"]')!.click();
    await flush(el);
    const dialog = screen.shadowRoot!.querySelector("till-seat-dialog")!;
    await dialog.updateComplete;
    const input = dialog
      .shadowRoot!.querySelector("wt-input")!
      .shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.value = "3";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!.click();
    await flush(el, 5);

    expect(api.seatTable).toHaveBeenCalledWith("t9", 3);
    const order = tableOrder(el)!;
    expect(order.orderId).toBe("wo-new");
    expect(order.party).toEqual(seatedMesa9.party);
    expect(api.getPartyBills).toHaveBeenCalledWith("v-new");
  });

  it("acts on the party the seat answered with when the floor cannot be read after seating", async () => {
    const getTablesState = vi
      .fn()
      .mockResolvedValueOnce([mesa4, mesa7, mesa9])
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({
      getTablesState,
      getPartyBills: vi.fn().mockResolvedValue([]),
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    const screen = await toFloor(el);

    emit(screen, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    const order = tableOrder(el)!;
    expect(order.orderId).toBe("wo-new");
    expect(api.getPartyBills).toHaveBeenCalledWith("v-new");

    emit(order, "finish-table", {});
    await flush(el);
    expect(api.finishTable).toHaveBeenCalledWith("v-new", 0);

    emit(tableOrder(el)!, "join-table", { tableId: "t4" });
    await flush(el);
    expect(api.joinTable).toHaveBeenCalledWith("wo-new", "t4", { expectedPartyRevision: 0 });
  });

  it("says the table needs cleaning when seating it is refused for that, and re-reads the floor", async () => {
    const { el } = await mountApp({
      seatTable: vi.fn().mockRejectedValue({ code: "table.needs_cleaning", tableId: "t9" }),
    });
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "open-table", { tableId: "t9", seated: false, guestCount: null });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("table.needs_cleaning"));
    expect(tableOrder(el)).toBeNull();
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("says why when another device seated the table first, and re-reads the floor", async () => {
    const { el } = await mountApp({
      seatTable: vi.fn().mockRejectedValue({ code: "tab.already_open" }),
    });
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "open-table", { tableId: "t9", seated: false, guestCount: null });
    await flush(el);

    expect(api.seatTable).toHaveBeenCalledWith("t9", null);
    expect(banner(el)!.textContent).toContain(codeMessage("tab.already_open"));
    expect(tableOrder(el)).toBeNull();
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });
});

/** The open bill's total and amount to pay, and the party's still to pay, as the drawer shows them. */
function figures(el: TillApp) {
  const screen = tableOrder(el)!.shadowRoot!;
  const shown = screen.querySelector('[data-bill="wo-4"]')!;
  return {
    total: shown.querySelector("[data-bill-total]")?.textContent,
    toPay: shown.querySelector("[data-bill-state]")?.textContent,
    stillToPay: screen.querySelector("[data-party-outstanding]")?.textContent,
  };
}

/** {@link figures} as they read for these amounts. */
function figuresOf(total: string, stillToPay: string) {
  return {
    total: formatMoney(total, "en"),
    toPay: t("table.bill_to_pay").replace("{amount}", formatMoney(total, "en")),
    stillToPay: formatMoney(stillToPay, "en"),
  };
}

describe("till-app: the party's bills and Finish table", () => {
  it("gives the table screen the party and every bill it has", async () => {
    const { el } = await mountApp();

    const order = await openMesa(el);

    expect(api.getPartyBills).toHaveBeenCalledWith("v1");
    expect(order.party).toEqual(mesa4.party);
    expect(order.bills).toEqual([tabBill, checkBill]);
  });

  it("finishes the table at the revision it read and goes back to the floor", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(order, "finish-table", {});
    await flush(el);

    expect(api.finishTable).toHaveBeenCalledWith("v1", 3);
    expect(tableOrder(el)).toBeNull();
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("shows the refusal when a bill is unpaid, and Take payment opens that bill to charge", async () => {
    const { el } = await mountApp({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    const order = await openMesa(el);

    emit(order, "finish-table", {});
    await flush(el);
    expect(tableOrder(el)!.finishRefused).toBe(true);

    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    expect(tableOrder(el)!.finishRefused).toBe(false);
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-check");

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "30.00" });
    await flush(el);
    expect(api.recordSale).toHaveBeenCalledWith(
      [],
      { method: "cash", amount: "30.00" },
      "wo-check",
    );
  });

  it("shows the bill's new figures right after a dish is cancelled", async () => {
    const server = { voided: false };
    const cancelled = { ...tabBill, total: "9.00", outstanding: "9.00" };
    const { el } = await mountApp({
      voidLine: vi.fn(async () => {
        server.voided = true;
        return { party: { id: "v1", revision: 4 } };
      }),
      getPartyBills: vi.fn(async () =>
        server.voided ? [cancelled, checkBill] : [tabBill, checkBill],
      ),
      getTablesState: vi.fn(async () =>
        server.voided
          ? [seated({ tabTotal: "9.00" }, { revision: 4, outstanding: "39.00" }), mesa7, mesa9]
          : [mesa4, mesa7, mesa9],
      ),
    });
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    expect(figures(el)).toEqual(figuresOf("14.00", "44.00"));

    emit(order, "void-line", { lineNo: 1 });
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("9.00", "39.00"));
  });

  it("shows the new figures after a cancel that got no answer but reached the server", async () => {
    const server = { voided: false };
    const cancelled = { ...tabBill, total: "9.00", outstanding: "9.00" };
    const { el } = await mountApp({
      voidLine: vi.fn(async () => {
        server.voided = true;
        throw new TypeError("Failed to fetch");
      }),
      getPartyBills: vi.fn(async () =>
        server.voided ? [cancelled, checkBill] : [tabBill, checkBill],
      ),
      getTablesState: vi.fn(async () =>
        server.voided
          ? [seated({ tabTotal: "9.00" }, { revision: 4, outstanding: "39.00" }), mesa7, mesa9]
          : [mesa4, mesa7, mesa9],
      ),
    });
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);

    emit(order, "void-line", { lineNo: 1 });
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("9.00", "39.00"));
  });

  it("a refused cancel reads the order's lines again and nothing else", async () => {
    const { el } = await mountApp({
      voidLine: vi.fn().mockRejectedValue({ code: "tab.void_quantity_invalid" }),
    });
    const order = await openMesa(el);
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(order, "void-line", { lineNo: 1 });
    await flush(el);

    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads);
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
  });

  it("says so when the floor cannot be read after a cancel, and still to pay follows the new bills", async () => {
    const server = { voided: false };
    const cancelled = { ...tabBill, total: "9.00", outstanding: "9.00" };
    const { el } = await mountApp({
      voidLine: vi.fn(async () => {
        server.voided = true;
        return { party: { id: "v1", revision: 4 } };
      }),
      getPartyBills: vi.fn(async () =>
        server.voided ? [cancelled, checkBill] : [tabBill, checkBill],
      ),
      getTablesState: vi.fn(async () => {
        if (server.voided) throw new TypeError("Failed to fetch");
        return [mesa4, mesa7, mesa9];
      }),
    });
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);

    emit(order, "void-line", { lineNo: 1 });
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("9.00", "39.00"));
    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("says so when the bills cannot be read after a cancel", async () => {
    const server = { voided: false };
    const { el } = await mountApp({
      voidLine: vi.fn(async () => {
        server.voided = true;
        return { party: { id: "v1", revision: 4 } };
      }),
      getPartyBills: vi.fn(async () => {
        if (server.voided) throw new TypeError("Failed to fetch");
        return [tabBill, checkBill];
      }),
    });
    const order = await openMesa(el);

    emit(order, "void-line", { lineNo: 1 });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  /** A Change adding a priced extra (cheese at 1.50) to the tab's dish, as the server answers it. */
  const cheese = {
    lineNo: 1,
    lineName: "Hamburguesa",
    patch: { extras: [{ listId: "toppings", picks: [{ productId: "cheese", quantity: 1 }] }] },
    revision: 0,
  };

  /** The server's bills and floor for {@link cheese}: 14.00 on the tab, 44.00 to pay, until the
   * change lands, then 15.50 and 45.50. */
  function cheeseServer(updateOrderLine: () => Promise<unknown>) {
    const server = { changed: false };
    const withCheese = { ...tabBill, total: "15.50", outstanding: "15.50" };
    return {
      updateOrderLine: vi.fn(async () => {
        server.changed = true;
        return updateOrderLine();
      }),
      getPartyBills: vi.fn(async () =>
        server.changed ? [withCheese, checkBill] : [tabBill, checkBill],
      ),
      getTablesState: vi.fn(async () =>
        server.changed
          ? [seated({ tabTotal: "15.50" }, { revision: 4, outstanding: "45.50" }), mesa7, mesa9]
          : [mesa4, mesa7, mesa9],
      ),
    };
  }

  it("shows the bill's new figures right after a Change adds a priced extra", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    expect(figures(el)).toEqual(figuresOf("14.00", "44.00"));

    emit(order, "change-line", cheese);
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("15.50", "45.50"));
  });

  it("shows the new figures after a Change that got no answer but reached the server", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);

    emit(order, "change-line", cheese);
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("15.50", "45.50"));
  });

  it("says so when the floor cannot be read after a Change, and still to pay follows the new bills", async () => {
    const server = cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } }));
    let changed = false;
    const { el } = await mountApp({
      ...server,
      updateOrderLine: vi.fn(async () => {
        changed = true;
        return server.updateOrderLine();
      }),
      getTablesState: vi.fn(async () => {
        if (changed) throw new TypeError("Failed to fetch");
        return [mesa4, mesa7, mesa9];
      }),
    });
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);

    emit(order, "change-line", cheese);
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("15.50", "45.50"));
    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("a Change that got no answer, with the floor unread, keeps saying it got no answer", async () => {
    const { el } = await mountApp({
      updateOrderLine: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      getTablesState: vi
        .fn()
        .mockResolvedValueOnce([mesa4, mesa7, mesa9])
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);

    emit(order, "change-line", cheese);
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(banner(el)!.textContent).not.toContain(t("table.reread_failed"));
  });

  it("an order with no party gets no still to pay when the floor cannot be read after a cancel", async () => {
    const partyless = table({ state: "open-tab", hasOpenTab: true, tabId: "wo-4" });
    const { el } = await mountApp({
      voidLine: vi.fn().mockResolvedValue({ party: null }),
      getTablesState: vi
        .fn()
        .mockResolvedValueOnce([partyless, mesa7, mesa9])
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);
    expect(order.party).toBeNull();

    emit(order, "void-line", { lineNo: 1 });
    await flush(el);

    expect(tableOrder(el)!.party).toBeNull();
    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("a refused Change reads the order's lines again and nothing else", async () => {
    const { el } = await mountApp({
      updateOrderLine: vi.fn().mockRejectedValue({ code: "tab.line_not_found" }),
    });
    const order = await openMesa(el);
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(order, "change-line", cheese);
    await flush(el);

    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads);
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
  });

  it("a Change's bills answering after another table opened leave that table's bills alone and say nothing", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    let answer!: (bills: PartyBill[]) => void;
    vi.mocked(api.getPartyBills).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    const other = [
      { ...tabBill, workingOrderId: "wo-7", partyId: "v7", total: "70.00", outstanding: "70.00" },
    ];
    vi.mocked(api.getPartyBills).mockResolvedValue(other);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(tableOrder(el)!.bills).toEqual(other);
    expect(banner(el)).toBeNull();

    answer([{ ...tabBill, total: "15.50", outstanding: "15.50" }, checkBill]);
    await flush(el);

    expect(tableOrder(el)!.bills).toEqual(other);
    expect(banner(el)).toBeNull();
  });

  it("a slow line read after an earlier Change does not put back the older still to pay", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));
    let answerLines!: (lines: Awaited<ReturnType<TillApi["getTabLines"]>>) => void;
    vi.mocked(api.getTabLines).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerLines = resolve;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    expect(tableOrder(el)!.bills[0]!.outstanding).toBe("15.50");
    vi.mocked(api.getPartyBills).mockResolvedValue([
      { ...tabBill, total: "18.50", outstanding: "18.50" },
      checkBill,
    ]);
    emit(tableOrder(el)!, "change-line", { ...cheese, revision: 1 });
    await flush(el);
    expect(figures(el)).toEqual(figuresOf("18.50", "48.50"));

    answerLines({ lines: [tabLine], revision: 1, editSentLines: true });
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("18.50", "48.50"));
  });

  it("a Change's floor read failing after another table opened reads nothing more and says nothing", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    let rejectFloor!: (error: unknown) => void;
    vi.mocked(api.getTablesState).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFloor = reject;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;

    rejectFloor(new TypeError("Failed to fetch"));
    await flush(el);

    expect(banner(el)).toBeNull();
    expect(api.getPartyBills).toHaveBeenCalledTimes(reads);
  });

  it("a Change's floor read failing once the waiter is back on the floor says nothing", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    let rejectFloor!: (error: unknown) => void;
    vi.mocked(api.getTablesState).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFloor = reject;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    expect(floor(el)).not.toBeNull();

    rejectFloor(new TypeError("Failed to fetch"));
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("an earlier Change's floor read failing after a later Change's re-read has finished changes nothing", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    let rejectFloor!: (error: unknown) => void;
    vi.mocked(api.getTablesState).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFloor = reject;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    emit(tableOrder(el)!, "change-line", { ...cheese, revision: 1 });
    await flush(el);
    expect(figures(el)).toEqual(figuresOf("15.50", "45.50"));
    expect(banner(el)).toBeNull();
    const reads = vi.mocked(api.getPartyBills).mock.calls.length;

    rejectFloor(new TypeError("Failed to fetch"));
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("15.50", "45.50"));
    expect(banner(el)).toBeNull();
    expect(api.getPartyBills).toHaveBeenCalledTimes(reads);
  });

  it("an earlier Change's bills answering while a later Change's re-read is under way say nothing", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    vi.mocked(api.getTablesState).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let answerBills!: (bills: PartyBill[]) => void;
    vi.mocked(api.getPartyBills).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerBills = resolve;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    let answerFloor!: (tables: TableState[]) => void;
    vi.mocked(api.getTablesState).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFloor = resolve;
        }),
    );
    emit(tableOrder(el)!, "change-line", { ...cheese, revision: 1 });
    await flush(el);

    answerBills([{ ...tabBill, total: "15.50", outstanding: "15.50" }, checkBill]);
    await flush(el);

    expect(banner(el)).toBeNull();
    answerFloor([
      seated({ tabTotal: "15.50" }, { revision: 4, outstanding: "45.50" }),
      mesa7,
      mesa9,
    ]);
    await flush(el);
    expect(figures(el)).toEqual(figuresOf("15.50", "45.50"));
    expect(banner(el)).toBeNull();
  });

  it("a Change's bills answering after a table move read the order again keep the move's still to pay", async () => {
    const { el } = await mountApp(
      cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
    );
    const order = await openMesa(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    vi.mocked(api.getTablesState).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let answerBills!: (bills: PartyBill[]) => void;
    vi.mocked(api.getPartyBills).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerBills = resolve;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    vi.mocked(api.getTablesState).mockResolvedValueOnce([
      table(),
      mesa7,
      seated(
        { id: "t9", label: "9", tabTotal: "18.50" },
        { revision: 5, outstanding: "48.50", tableIds: ["t9"] },
      ),
    ]);
    vi.mocked(api.getPartyBills).mockResolvedValue([
      { ...tabBill, total: "18.50", outstanding: "18.50" },
      checkBill,
    ]);
    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(figures(el)).toEqual(figuresOf("18.50", "48.50"));

    answerBills([{ ...tabBill, total: "15.50", outstanding: "15.50" }, checkBill]);
    await flush(el);

    expect(figures(el)).toEqual(figuresOf("18.50", "48.50"));
    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("says so when the floor cannot be read after a Change and a refused Finish reads the bills first", async () => {
    const { el } = await mountApp({
      ...cheeseServer(async () => ({ revision: 1, party: { id: "v1", revision: 4 } })),
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    const order = await openMesa(el);
    vi.mocked(api.getTablesState).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let answerBills!: (bills: PartyBill[]) => void;
    vi.mocked(api.getPartyBills).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerBills = resolve;
        }),
    );
    emit(order, "change-line", cheese);
    await flush(el);
    emit(tableOrder(el)!, "finish-table", {});
    await flush(el);
    expect(tableOrder(el)!.finishRefused).toBe(true);

    answerBills([{ ...tabBill, total: "15.50", outstanding: "15.50" }, checkBill]);
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("a cancel answering once the waiter is back on the floor, with the floor unread, says nothing", async () => {
    let answerVoid!: (answer: { party: { id: string; revision: number } }) => void;
    const { el } = await mountApp({
      voidLine: vi.fn(
        () =>
          new Promise((resolve) => {
            answerVoid = resolve;
          }),
      ),
    });
    const order = await openMesa(el);
    emit(order, "void-line", { lineNo: 1 });
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    expect(floor(el)).not.toBeNull();
    vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

    answerVoid({ party: { id: "v1", revision: 4 } });
    await flush(el);

    expect(banner(el)).toBeNull();
  });

  it("prints a copy of a paid bill's receipt", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);

    emit(order, "reprint-bill", { workingOrderId: "wo-old" });
    await flush(el);

    expect(api.reprint).toHaveBeenCalledWith("wo-old");
  });

  it("says so when the receipt copy could not be printed", async () => {
    const { el } = await mountApp({
      reprint: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const order = await openMesa(el);

    emit(order, "reprint-bill", { workingOrderId: "wo-old" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("reprint.error"));
  });
});

const phone: CanvasDef = {
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

describe("till-app: the party on a handheld", () => {
  const orderCard = (el: TillApp) =>
    tabGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ?? null;

  it("shows the party's bills on the order tab, and returns to the floor tab once finished", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phone }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
    await flush(el);
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    emit(shell(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);

    const card = orderCard(el)!;
    expect(card.party).toEqual(mesa4.party);
    expect(card.bills).toEqual([tabBill, checkBill]);

    emit(card, "finish-table", {});
    await flush(el);

    expect(api.finishTable).toHaveBeenCalledWith("v1", 3);
    expect((shell(el) as HTMLElement & { activeTabKey?: string }).activeTabKey).toBe("floor");
  });

  /** The server's side of D19: a command carrying any revision but the party's current one is
   * refused. */
  function currentRevisionOnly<R>(current: number, answer: R) {
    return vi.fn(async (...args: unknown[]) => {
      const sent = (args.at(-1) as { expectedPartyRevision?: number }).expectedPartyRevision;
      if (sent !== current) throw { code: "party.out_of_date", partyId: "v1", revision: current };
      return answer;
    });
  }

  it.each([
    ["split-lines", { transfers: [{ lineNo: 1 }] }, "splitTab", { checkId: "wo-check" }],
    ["join-table", { tableId: "t9" }, "joinTable", undefined],
  ] as const)(
    "refuses %s sent from an order read before a glance at the floor saw another device's change",
    async (type, detail, method, answer) => {
      const splitElsewhere = seated({}, { revision: 6, billCount: 2 });
      const reads = floorThat([mesa4, mesa9], [splitElsewhere, mesa9]);
      const command = currentRevisionOnly(6, answer);
      const { el } = await mountApp({
        getTill: vi.fn().mockResolvedValue({ ...till, canvas: phone }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        getTablesState: reads.getTablesState,
        [method]: command,
      });
      await flush(el);
      emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
      await flush(el);
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      emit(shell(el), "open-table", { tableId: "t4", seated: true });
      await flush(el);
      const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
      const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

      reads.other.acted = true;
      emit(shell(el), "tab-select", { key: "floor" });
      await flush(el);
      emit(shell(el), "tab-select", { key: "order" });
      await flush(el);
      expect(api.getTabLines).toHaveBeenCalledTimes(lineReads);
      emit(orderCard(el)!, type, detail);
      await flush(el);

      expect(command).toHaveBeenCalledOnce();
      await expect(command.mock.results[0]!.value).rejects.toMatchObject({
        code: "party.out_of_date",
      });
      expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
      expect(api.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
      expect(orderCard(el)!.party).toEqual(splitElsewhere.party);
      const text = banner(el)!.textContent!;
      expect(text).toContain(t("party.changed").replace("{table}", "4"));
      expect(text).toContain(
        t("party.changed_bills").replace("{amount}", formatMoney("44.00", "en")),
      );
    },
  );
});

/** The party's bills read left unanswered until the test settles it. */
interface LateBills {
  resolve: (bills: PartyBill[]) => void;
  reject: (error: unknown) => void;
}

describe("till-app: reads and refusals around the party", () => {
  it("shows no bills rather than stale ones when the party's bills cannot be read", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    const order = await openMesa(el);

    expect(order.bills).toEqual([]);
  });

  it.each([
    ["answers", (late: LateBills) => late.resolve([tabBill, checkBill])],
    ["fails", (late: LateBills) => late.reject(new TypeError("Failed to fetch"))],
  ] as const)(
    "keeps the next table's bills when the last table's bills read %s after them",
    async (_outcome, settle) => {
      const bill7: PartyBill = { ...tabBill, workingOrderId: "wo-7", partyId: "v7" };
      const late = {} as LateBills;
      let v1Reads = 0;
      const { el } = await mountApp({
        getPartyBills: vi.fn((partyId: string) => {
          if (partyId !== "v1") return Promise.resolve([bill7]);
          v1Reads++;
          if (v1Reads === 1) return Promise.resolve([tabBill, checkBill]);
          return new Promise<PartyBill[]>((resolve, reject) =>
            Object.assign(late, { resolve, reject }),
          );
        }),
      });
      const first = await openMesa(el);
      // The join reads the party's bills again, and that read is still unanswered when the waiter
      // goes to the next table.
      emit(first, "join-table", { tableId: "t9" });
      await flush(el);
      expect(v1Reads).toBe(2);
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el);
      expect(tableOrder(el)!.bills).toEqual([bill7]);

      settle(late);
      await flush(el);

      expect(tableOrder(el)!.bills).toEqual([bill7]);
    },
  );

  it("offers no Finish command for a tab that belongs to no party", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([{ ...mesa4, party: null }]),
    });
    const order = await openMesa(el);

    emit(order, "finish-table", {});
    await flush(el);

    expect(api.getPartyBills).not.toHaveBeenCalled();
    expect(api.finishTable).not.toHaveBeenCalled();
  });

  it("says why Mark cleared was refused and re-reads the floor", async () => {
    const { el } = await mountApp({
      markTableCleared: vi.fn().mockRejectedValue({ code: "table.not_found", tableId: "t4" }),
    });
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "mark-cleared", { tableId: "t4" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("table.not_found"));
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("describes the open table's party when a stale refusal does not name one", async () => {
    const reads = floorThat([mesa4], [seated({}, { revision: 5, tableIds: ["t4", "t9"] }), mesa9]);
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      moveTab: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
    expect(banner(el)!.textContent).toContain(
      t("party.changed_tables").replace("{tables}", "4, 9"),
    );
  });

  it("says the table changed, in general words, when a stale refusal names no party", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([{ ...mesa4, party: null }]),
      moveTab: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    });
    const order = await openMesa(el);

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("party.out_of_date"));
  });
});

describe("till-app: a table needing cleaning", () => {
  it("marks that one table cleared and re-reads the floor", async () => {
    const { el } = await mountApp();
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "mark-cleared", { tableId: "t4" });
    await flush(el);

    expect(api.markTableCleared).toHaveBeenCalledExactlyOnceWith("t4");
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });
});

describe("till-app: every table move sends the party revision it last read", () => {
  it.each([
    ["move-tab", { toTableId: "t9" }, "moveTab", ["wo-4", "t9", { expectedPartyRevision: 3 }]],
    ["join-table", { tableId: "t9" }, "joinTable", ["wo-4", "t9", { expectedPartyRevision: 3 }]],
    [
      "merge-tabs",
      { fromTabId: "wo-7", freeSourceTable: true },
      "mergeTabs",
      ["wo-4", "wo-7", true, { expectedPartyRevision: 3, expectedSourcePartyRevision: 9 }],
    ],
    [
      "transfer-lines",
      { toTabId: "wo-7", transfers: [{ lineNo: 1 }] },
      "transferLines",
      [
        "wo-4",
        "wo-7",
        [{ lineNo: 1 }],
        { expectedPartyRevision: 9, expectedSourcePartyRevision: 3 },
      ],
    ],
    [
      "split-lines",
      { transfers: [{ lineNo: 1 }] },
      "splitTab",
      ["wo-4", [{ lineNo: 1 }], { expectedPartyRevision: 3 }],
    ],
  ] as const)("%s", async (type, detail, method, args) => {
    const { el } = await mountApp();
    const order = await openMesa(el);

    emit(order, type, detail);
    await flush(el);

    expect(
      (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
    ).toHaveBeenCalledWith(...args);
  });

  it("sends no source revision when both bills belong to the same party", async () => {
    const joined = seated({ id: "t5", label: "5", tabId: "wo-check", hasOpenTab: true });
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, joined]),
    });
    const order = await openMesa(el);

    emit(order, "merge-tabs", { fromTabId: "wo-check", freeSourceTable: true });
    await flush(el);

    expect(api.mergeTabs).toHaveBeenCalledWith("wo-4", "wo-check", true, {
      expectedPartyRevision: 3,
    });
  });

  it("moves a party whose tab has been paid, from the paid tab", async () => {
    const paid = seated(
      { hasOpenTab: false, tabId: "wo-paid", tabLineCount: undefined, tabTotal: undefined },
      { outstanding: "0.00" },
    );
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([paid, mesa9]),
      getTabLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
    });
    const order = await openMesa(el);
    expect(api.seatTable).not.toHaveBeenCalled();
    expect(order.orderId).toBe("wo-paid");

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(api.moveTab).toHaveBeenCalledWith("wo-paid", "t9", { expectedPartyRevision: 3 });
    expect(banner(el)).toBeNull();
  });
});

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
const onTablet = () => ({
  getTill: vi.fn().mockResolvedValue({ ...till, canvas: tablet }),
  getDeviceIdentity: vi
    .fn()
    .mockResolvedValue({ deviceId: "tb1", formFactor: "tablet-landscape", stationId: null }),
});
const tabletOrderCard = (el: TillApp) =>
  tabGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ?? null;

describe("till-app: a party's split-off bill left unpaid goes back with the party's revision", () => {
  const orderCard = tabletOrderCard;

  /** The floor reads the party at revision 3 until the split, and at 4 once the split has moved it. */
  function floorAcrossSplit() {
    let split = false;
    return {
      getTablesState: vi.fn(async () => [
        split ? seated({}, { revision: 4 }) : mesa4,
        mesa7,
        mesa9,
      ]),
      splitTab: vi.fn(async () => {
        split = true;
        return { checkId: "wo-check" };
      }),
    };
  }

  it("sends the revision the floor read after the split when a till goes Back", async () => {
    const { el } = await mountApp(floorAcrossSplit());
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");

    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);

    expect(api.mergeTabs).toHaveBeenCalledExactlyOnceWith("wo-4", "wo-check", false, {
      expectedPartyRevision: 4,
    });
    expect(banner(el)).toBeNull();
  });

  it("reads the floor once after the merge when a till goes Back", async () => {
    const { el } = await mountApp(floorAcrossSplit());
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);

    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("sends the returned party's revision, not the next table's, when a tablet opens another table", async () => {
    const { el } = await mountApp({
      ...floorAcrossSplit(),
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: tablet }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "tb1", formFactor: "tablet-landscape", stationId: null }),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(orderCard(el)!, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(orderCard(el)!.orderId).toBe("wo-check");

    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    expect(api.mergeTabs).toHaveBeenCalledExactlyOnceWith("wo-4", "wo-check", false, {
      expectedPartyRevision: 4,
    });
    expect(orderCard(el)!.orderId).toBe("wo-7");
  });

  it("sends the revision the merge moved the party to when a tablet comes back to its table", async () => {
    let revision = 3;
    const { el } = await mountApp({
      ...onTablet(),
      getTablesState: vi.fn(async () => [seated({}, { revision }), mesa7, mesa9]),
      splitTab: vi.fn(async () => {
        revision = 4;
        return { checkId: "wo-check" };
      }),
      mergeTabs: vi.fn(async () => {
        revision = 5;
      }),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(orderCard(el)!, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(api.mergeTabs).toHaveBeenCalledOnce();

    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(orderCard(el)!, "finish-table", {});
    await flush(el);

    expect(api.finishTable).toHaveBeenCalledExactlyOnceWith("v1", 5);
  });

  it("sends the revision the merge moved the party to when a handheld comes back to its Order tab", async () => {
    let revision = 3;
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phone }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
      getTablesState: vi.fn(async () => [seated({}, { revision }), mesa7, mesa9]),
      splitTab: vi.fn(async () => {
        revision = 4;
        return { checkId: "wo-check" };
      }),
      mergeTabs: vi.fn(async () => {
        revision = 5;
      }),
    });
    await toFloor(el);
    emit(shell(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(orderCard(el)!, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);
    expect(orderCard(el)!.orderId).toBe("wo-4");
    emit(orderCard(el)!, "finish-table", {});
    await flush(el);

    expect(api.finishTable).toHaveBeenCalledExactlyOnceWith("v1", 5);
  });

  /** A handheld with the party's bill split off, on its Order tab. */
  async function splitOnHandheld(mergeTabs: () => Promise<void>) {
    const { el } = await mountApp({
      ...floorAcrossSplit(),
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: phone }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
      mergeTabs: vi.fn(mergeTabs),
    });
    await toFloor(el);
    emit(shell(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    emit(orderCard(el)!, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    return el;
  }

  it("reads the floor once when a handheld leaves its Order tab twice before the merge answers", async () => {
    let answerMerge!: () => void;
    const el = await splitOnHandheld(() => new Promise<void>((resolve) => (answerMerge = resolve)));
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    answerMerge();
    await flush(el);

    expect(api.mergeTabs).toHaveBeenCalledOnce();
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("reads the floor again when a handheld leaves its Order tab after the merge has answered", async () => {
    const el = await splitOnHandheld(async () => undefined);

    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);

    expect(api.mergeTabs).toHaveBeenCalledOnce();
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("keeps the bill held, without sending it again, when the party changed elsewhere first", async () => {
    const { el } = await mountApp({
      ...floorAcrossSplit(),
      mergeTabs: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 6 }),
    });
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);

    expect(api.mergeTabs).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(t("table.check_kept_held"));
    expect(floor(el)).not.toBeNull();
  });
});

/** The floor reads `before` until the test says the other device has acted, then `after`. */
function floorThat(before: TableState[], after: TableState[]) {
  const other = { acted: false };
  return { other, getTablesState: vi.fn(async () => (other.acted ? after : before)) };
}

describe("till-app: another device changed the table first", () => {
  const moved = seated(
    {},
    { revision: 5, tableIds: ["t4", "t5"], billCount: 2, outstanding: "50.00" },
  );
  const mesa5 = seated({ id: "t5", label: "5" }, { revision: 5, tableIds: ["t4", "t5"] });

  it("reloads, says what changed, and sends the new revision only when the person acts again", async () => {
    const moveTab = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 5 })
      .mockResolvedValue(undefined);
    const { other, getTablesState } = floorThat([mesa4, mesa9], [moved, mesa5, mesa9]);
    const { el } = await mountApp({ moveTab, getTablesState });
    const order = await openMesa(el);
    other.acted = true;
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(moveTab).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party).toEqual(moved.party);
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    const text = banner(el)!.textContent!;
    expect(text).toContain(t("party.changed").replace("{table}", "4"));
    expect(text).toContain(t("party.changed_tables").replace("{tables}", "4, 5"));
    expect(text).toContain(t("party.try_again"));

    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(moveTab).toHaveBeenLastCalledWith("wo-4", "t9", { expectedPartyRevision: 5 });
  });

  it("names the bills and what is left to pay when those are what changed", async () => {
    const split = seated({}, { revision: 5, billCount: 2, outstanding: "44.00" });
    const reads = floorThat([mesa4], [split]);
    const { el } = await mountApp({
      splitTab: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(banner(el)!.textContent).toContain(
      t("party.changed_bills").replace("{amount}", formatMoney("44.00", "en")),
    );
  });

  it("says the party has left the table when it is no longer there", async () => {
    const reads = floorThat([mesa4], [table()]);
    const { el } = await mountApp({
      finishTable: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "finish-table", {});
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed_gone"));
  });

  it("says something else changed when its tables and bills read the same", async () => {
    const reads = floorThat([mesa4], [seated({}, { revision: 5 })]);
    const { el } = await mountApp({
      joinTable: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "join-table", { tableId: "t9" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed_other"));
  });

  it("names the other table when it is the other party that changed", async () => {
    const reads = floorThat(
      [mesa4, mesa7],
      [
        mesa4,
        seated(
          { id: "t7", label: "7", tabId: "wo-7" },
          { id: "v7", revision: 10, tableIds: ["t7"] },
        ),
      ],
    );
    const { el } = await mountApp({
      transferLines: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v7", revision: 10 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "transfer-lines", { toTabId: "wo-7", transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "7"));
  });

  it.each([
    ["table.occupied", "move-tab", { toTableId: "t9" }, "moveTab"],
    ["table.occupied", "join-table", { tableId: "t9" }, "joinTable"],
    ["table.needs_cleaning", "move-tab", { toTableId: "t9" }, "moveTab"],
    ["table.needs_cleaning", "join-table", { tableId: "t9" }, "joinTable"],
    ["party.not_open", "split-lines", { transfers: [{ lineNo: 1 }] }, "splitTab"],
    [
      "group.held_leaves_party",
      "transfer-lines",
      { toTabId: "wo-7", transfers: [{ lineNo: 1 }] },
      "transferLines",
    ],
    [
      "group.held_leaves_party",
      "merge-tabs",
      { fromTabId: "wo-7", freeSourceTable: false },
      "mergeTabs",
    ],
    ["tab.not_table_tab", "join-table", { tableId: "t9" }, "joinTable"],
    ["tab.not_table_tab", "merge-tabs", { fromTabId: "wo-7", freeSourceTable: false }, "mergeTabs"],
    [
      "tab.party_mismatch",
      "merge-tabs",
      { fromTabId: "wo-7", freeSourceTable: false },
      "mergeTabs",
    ],
    [
      "tab.party_has_other_open_bill",
      "merge-tabs",
      { fromTabId: "wo-7", freeSourceTable: false },
      "mergeTabs",
    ],
    [
      "tab.merge_leaves_no_table",
      "merge-tabs",
      { fromTabId: "wo-7", freeSourceTable: true },
      "mergeTabs",
    ],
  ] as const)("shows %s in its own words after %s", async (code, type, detail, method) => {
    const { el } = await mountApp({ [method]: vi.fn().mockRejectedValue({ code }) });
    const order = await openMesa(el);

    emit(order, type, detail);
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
  });
});

describe("till-app: leaving a finished party", () => {
  it("keeps the finished party's lines and bills off the screen when their read answers late", async () => {
    let answerLines!: (tab: unknown) => void;
    let answerBills!: (bills: PartyBill[]) => void;
    const { el } = await mountApp(onTablet());
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    vi.mocked(api.getTabLines).mockImplementationOnce(
      () => new Promise((resolve) => (answerLines = resolve as (tab: unknown) => void)),
    );
    vi.mocked(api.getPartyBills).mockImplementationOnce(
      () => new Promise((resolve) => (answerBills = resolve)),
    );
    emit(tabletOrderCard(el)!, "join-table", { tableId: "t9" });
    await flush(el);

    emit(tabletOrderCard(el)!, "finish-table", {});
    await flush(el);
    answerLines({ lines: [tabLine], revision: 0, editSentLines: true });
    answerBills([tabBill, checkBill]);
    await flush(el);

    expect(api.finishTable).toHaveBeenCalledOnce();
    expect(tabletOrderCard(el)!.lines).toEqual([]);
    expect(tabletOrderCard(el)!.bills).toEqual([]);
  });
});

describe("till-app: the order's groups", () => {
  const cafe: TillProduct = {
    id: "cafe",
    menuItemId: "menu-item-cafe",
    name: "Café",
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
  };

  function groupOf(id: string, position: number, state: OrderGroup["state"]): OrderGroup {
    return {
      id,
      position,
      state,
      firedAt: state === "fired" ? "2026-09-27T10:00:00.000Z" : null,
      remindAt: null,
      lineIds: [],
      summary: "",
    };
  }

  /** The server's side of D19 for a fire: refused unless it carries the party's current revision,
   * which each fire moves on by one. */
  function chainedFire(start: number) {
    let current = start;
    return vi.fn(
      async (_partyId: string, _groupId: string, command: { expectedPartyRevision: number }) => {
        if (command.expectedPartyRevision !== current)
          throw { code: "party.out_of_date", partyId: "v1" };
        current += 1;
        return { revision: current };
      },
    );
  }

  const roundLines = [
    { menuItemId: "flan", quantity: "1" },
    { menuItemId: "pan", quantity: "2", courseId: "entrantes" },
  ];
  const roundDish = (menuItemId: string): TillProduct => ({
    id: menuItemId,
    menuItemId,
    name: menuItemId,
    pricingUnit: "each",
    unitPrice: "5.00",
    vatClass: "general",
    category: null,
    allergens: null,
  });

  /** Rings {@link roundLines} into the party's draft, as taps and a course pick would. */
  async function ringRound(el: TillApp, order: TillTableOrderScreen): Promise<void> {
    const draft = partyDraft(order);
    draft.addProduct(roundDish("flan"), "1");
    draft.addProduct(roundDish("pan"), "2");
    draft.setLineCourse(draft.lineCount - 1, "entrantes");
    await flush(el);
  }

  /** A confirmed preview's `submit-draft` for the first `count` of {@link roundLines}, as rung. */
  function roundDetail(
    order: TillTableOrderScreen,
    groups: { release: "fire" | "hold"; lineIndexes: number[] }[],
    count = roundLines.length,
  ) {
    const draft = partyDraft(order);
    return {
      lines: roundLines.slice(0, count),
      groups,
      store: draft,
      sent: draft.lines.slice(0, count),
    };
  }

  it("reads the party's groups with the order's lines and gives them to the screen", async () => {
    const groups = [groupOf("g1", 1, "held")];
    const { el } = await mountApp({
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups }),
    });
    const order = await openMesa(el);
    expect(api.listGroups).toHaveBeenCalledWith("v1");
    expect(order.groups).toEqual(groups);
  });

  it("gives the party's groups to an order shown as a card too", async () => {
    const groups = [groupOf("g1", 1, "held")];
    const { el } = await mountApp({
      ...onTablet(),
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups }),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tabletOrderCard(el)!.groups).toEqual(groups);
  });

  it("sends a round to the party as its groups in one submission, with the revision the screen showed", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-4", revision: 4, groups: [] }),
    });
    const order = await openMesa(el);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    await ringRound(el, order);
    emit(
      order,
      "submit-draft",
      roundDetail(order, [
        { release: "fire", lineIndexes: [1] },
        { release: "hold", lineIndexes: [0] },
      ]),
    );
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(api.submitDraft).toHaveBeenCalledWith(
      "v1",
      "draft-1",
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 3,
        draftRevision: 1,
        groups: [
          { release: "fire", lineIds: [expect.any(String)] },
          { release: "hold", lineIds: [expect.any(String)] },
        ],
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(drafts.sentGroups(vi.mocked(api.submitDraft).mock.calls[0]![2])).toEqual([
      { release: "fire", lines: [roundLines[1]] },
      { release: "hold", lines: [roundLines[0]] },
    ]);
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
  });

  it("sends each round under a submission id of its own", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-4", revision: 4, groups: [] }),
    });
    const order = await openMesa(el);
    const groups = [{ release: "fire" as const, lineIndexes: [0, 1] }];
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, groups));
    await flush(el);
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, groups));
    await flush(el);
    const [first, second] = vi
      .mocked(api.submitDraft)
      .mock.calls.map((call) => call[2].submissionId);
    expect(first).not.toBe(second);
  });

  it("says so when the floor cannot be read after a Change and a sent round reads the bills first", async () => {
    const { el } = await mountApp({
      updateOrderLine: vi.fn().mockResolvedValue({ revision: 1, party: { id: "v1", revision: 4 } }),
      submitDraft: answering({ tabId: "wo-4", revision: 5, groups: [] }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);
    vi.mocked(api.getTablesState).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let answerBills!: (bills: PartyBill[]) => void;
    vi.mocked(api.getPartyBills).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerBills = resolve;
        }),
    );
    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Hamburguesa",
      patch: { extras: [{ listId: "toppings", picks: [{ productId: "cheese", quantity: 1 }] }] },
      revision: 0,
    });
    await flush(el);
    emit(tableOrder(el)!, "submit-draft", {
      ...roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0] }], 1),
      draft: { laterAddition: false, tally: { fired: 0, held: 0, joined: 0 } },
    });
    await flush(el);
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(tableOrder(el)).not.toBeNull();

    answerBills([tabBill, checkBill]);
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("sends the revision the submission answered with on the party's next command", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-4", revision: 4, groups: [] }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]));
    await flush(el);

    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
  });

  it("follows the round onto the party's next tab after its tab was paid", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-next", revision: 5, groups: [] }),
    });
    const order = await openMesa(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, [{ release: "fire", lineIndexes: [0] }], 1));
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-next");
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-next");
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("reloads the table and says so when another device changed the party first, keeping the round", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
    });
    const order = await openMesa(el);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const round = partyDraft(order);
    round.addProduct(cafe, "1");

    emit(order, "submit-draft", {
      lines: [{ menuItemId: "menu-item-cafe", quantity: "1" }],
      groups: [{ release: "fire", lineIndexes: [0] }],
      store: round,
      sent: round.lines,
    });
    await flush(el);

    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
    expect(round.lineCount).toBe(1);
  });

  it("sends nothing, and says so, for an order with no party to put the round on", async () => {
    const barTab = table({ state: "open-tab", hasOpenTab: true, tabId: "wo-bar" });
    const { el } = await mountApp({ getTablesState: vi.fn().mockResolvedValue([barTab]) });
    const order = await openMesa(el);
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]));
    await flush(el);
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("takes the party's revision from the floor read after a round that got no answer", async () => {
    let landed = false;
    const { el } = await mountApp({
      getTablesState: vi.fn(async () => [
        landed ? seated({}, { revision: 4 }) : mesa4,
        mesa7,
        mesa9,
      ]),
      submitDraft: vi.fn(async () => {
        landed = true;
        throw new TypeError("offline");
      }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]));
    await new Promise((resolve) => setTimeout(resolve, 2 * SUBMIT_RETRY_PAUSE_MS + 50));
    await flush(el);

    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
  });

  it("keeps another party's revision when a round's answer arrives after the screen opened its table", async () => {
    let answer: (value: { tabId: string; revision: number; groups: [] }) => void = () => {};
    const { el } = await mountApp({
      submitDraft: vi.fn(
        (...args: SubmitArgs) =>
          new Promise((resolve) => {
            answer = (value) => resolve({ ...drafts.apply(...args), ...value });
          }),
      ),
    });
    const order = await openMesa(el);
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]));
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");

    answer({ tabId: "wo-4", revision: 12, groups: [] });
    await flush(el);
    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(api.moveTab).toHaveBeenCalledWith("wo-7", "t9", { expectedPartyRevision: 9 });
  });

  it("sends no round while a split-off check is the order on screen, and says what a refused round said", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    const round = new WorkingOrderStore();
    round.addProduct(cafe, "1");

    emit(tableOrder(el)!, "submit-draft", {
      lines: [{ menuItemId: "menu-item-cafe", quantity: "1" }],
      groups: [{ release: "fire", lineIndexes: [0] }],
      store: round,
      sent: round.lines,
    });
    await flush(el);

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(round.lineCount).toBe(1);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
  });

  it("sends a round from a party just seated when the floor could not be read after seating", async () => {
    const { el } = await mountApp({
      getTablesState: vi
        .fn()
        .mockResolvedValueOnce([mesa4, mesa7, mesa9])
        .mockRejectedValue(new TypeError("Failed to fetch")),
      getPartyBills: vi.fn().mockResolvedValue([]),
      submitDraft: answering({ tabId: "wo-new", revision: 1, groups: [] }),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-new");

    await ringRound(el, tableOrder(el)!);
    emit(
      tableOrder(el)!,
      "submit-draft",
      roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0, 1] }]),
    );
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledWith(
      "v-new",
      expect.any(String),
      expect.objectContaining({ expectedPartyRevision: 0 }),
      expect.anything(),
    );
    expect(banner(el)).toBeNull();
  });

  it("keeps the higher revision when two answers about the party arrive out of order", async () => {
    const answers: ((value: { party: { id: string; revision: number } }) => void)[] = [];
    const { el } = await mountApp({
      voidLine: vi.fn(
        () =>
          new Promise((resolve) => {
            answers.push(resolve);
          }),
      ),
    });
    const order = await openMesa(el);
    emit(order, "void-line", { lineNo: 1 });
    emit(order, "void-line", { lineNo: 2 });
    await flush(el);
    expect(answers).toHaveLength(2);

    answers[1]!({ party: { id: "v1", revision: 5 } });
    await flush(el);
    answers[0]!({ party: { id: "v1", revision: 4 } });
    await flush(el);

    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 5 });
  });

  describe("editing held groups", () => {
    const at = "2026-09-27T10:00:00.000Z";
    function dish(
      id: string,
      lineNo: number,
      name: string,
      quantity: string,
      groupId: string,
      fired = false,
    ): TabLine {
      return {
        ...tabLine,
        id,
        lineNo,
        name,
        productId: id,
        quantity,
        unitPrecision: 0,
        groupId,
        state: "queued",
        sentAt: fired ? at : null,
        firedAt: fired ? at : null,
      };
    }

    /** The server's side of the held groups: every command is refused unless it carries the party's
     * current revision, which it moves on by one; a group that has fired refuses `group.not_held`, and
     * a group whose last line moved out is removed. Beer has fired; Croquetas, Steak ×`steaks` with
     * Fish, and Flan are held groups 2, 3 and 4. */
    function editServer(steaks = "2.000") {
      let revision = 3;
      let lineNos = 5;
      const lines = [
        dish("line-beer", 1, "Beer", "1.000", "g1", true),
        dish("line-croq", 2, "Croquetas", "1.000", "g2"),
        dish("line-steak", 3, "Steak", steaks, "g3"),
        dish("line-fish", 4, "Fish", "1.000", "g3"),
        dish("line-flan", 5, "Flan", "1.000", "g4"),
      ];
      const groups: { id: string; position: number; state: OrderGroup["state"] }[] = [
        { id: "g1", position: 1, state: "fired" },
        { id: "g2", position: 2, state: "held" },
        { id: "g3", position: 3, state: "held" },
        { id: "g4", position: 4, state: "held" },
      ];
      const listed = (): OrderGroup[] =>
        groups
          .filter((group) => lines.some((line) => line.groupId === group.id))
          .sort((a, b) => a.position - b.position)
          .map((group) => {
            const own = lines.filter((line) => line.groupId === group.id);
            return {
              ...group,
              firedAt: group.state === "fired" ? at : null,
              remindAt: null,
              lineIds: own.map((line) => line.id),
              summary: own.map((line) => `${Number(line.quantity)} × ${line.name}`).join(", "),
            };
          });
      const check = (command: { expectedPartyRevision: number }) => {
        if (command.expectedPartyRevision !== revision)
          throw { code: "party.out_of_date", partyId: "v1" };
      };
      const held = (id: string) => {
        const group = groups.find((each) => each.id === id)!;
        if (group.state !== "held") throw { code: "group.not_held" };
        return group;
      };
      return {
        lines,
        groups,
        getTablesState: vi.fn(async () => [seated({}, { revision }), mesa7, mesa9]),
        getTabLines: vi.fn(async () => ({
          lines: lines.map((line) => ({ ...line })),
          revision: 0,
          editSentLines: true,
        })),
        listGroups: vi.fn(async () => ({ revision, groups: listed() })),
        fireGroup: vi.fn(
          async (_partyId: string, groupId: string, command: { expectedPartyRevision: number }) => {
            check(command);
            held(groupId).state = "fired";
            return { revision: ++revision };
          },
        ),
        reorderGroups: vi.fn(
          async (_partyId: string, ids: string[], command: { expectedPartyRevision: number }) => {
            check(command);
            const positions = ids.map((id) => held(id).position).sort((a, b) => a - b);
            ids.forEach((id, index) => (held(id).position = positions[index]!));
            return { revision: ++revision };
          },
        ),
        moveLinesToGroup: vi.fn(
          async (
            _partyId: string,
            moves: { lineId: string; quantity: string }[],
            target: { groupId: string } | "new",
            command: { submissionId: string; expectedPartyRevision: number },
          ) => {
            check(command);
            let targetId: string;
            if (target === "new") {
              targetId = `g${groups.length + 1}`;
              groups.push({ id: targetId, position: groups.length + 1, state: "held" });
            } else targetId = held(target.groupId).id;
            for (const { lineId, quantity } of moves) {
              const line = lines.find((each) => each.id === lineId)!;
              held(line.groupId!);
              if (Number(quantity) === Number(line.quantity)) {
                line.groupId = targetId;
                continue;
              }
              line.quantity = (Number(line.quantity) - Number(quantity)).toFixed(3);
              const part = {
                ...line,
                id: `line-${++lineNos}`,
                lineNo: lineNos,
                quantity: Number(quantity).toFixed(3),
                groupId: targetId,
              };
              lines.splice(lines.indexOf(line) + 1, 0, part);
            }
            return { revision: ++revision };
          },
        ),
      };
    }

    async function openGroups(el: TillApp): Promise<TillTableOrderScreen> {
      const order = await openMesa(el);
      order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await flush(el);
      return order;
    }

    async function press(el: TillApp, selector: string): Promise<void> {
      tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
      await flush(el);
    }

    const command = (revision: number) => ({
      submissionId: expect.any(String),
      expectedPartyRevision: revision,
    });

    it("fires a held group once the waiter confirms, then reads the order again and carries its revision on", async () => {
      const server = editServer();
      const { el } = await mountApp(server);
      await openGroups(el);
      const lineReads = server.getTabLines.mock.calls.length;
      const groupReads = server.listGroups.mock.calls.length;

      await press(el, '[data-group-fire="g3"]');
      expect(server.fireGroup).not.toHaveBeenCalled();
      await press(el, "[data-fire-confirm]");

      expect(server.fireGroup.mock.calls).toEqual([["v1", "g3", command(3)]]);
      expect(server.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
      expect(server.listGroups).toHaveBeenCalledTimes(groupReads + 1);
      expect(heldGroupsList(el).map((group) => group.state)).toEqual([
        "fired",
        "held",
        "fired",
        "held",
      ]);
      expect(banner(el)).toBeNull();

      emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
      await flush(el);
      expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
    });

    it("moves a held group down by sending the whole held order, then shows the order the server kept", async () => {
      const server = editServer();
      const { el } = await mountApp(server);
      await openGroups(el);

      await press(el, '[data-group-down="g2"]');

      expect(server.reorderGroups.mock.calls).toEqual([["v1", ["g3", "g2", "g4"], command(3)]]);
      expect(heldGroupsList(el).map((group) => group.summary)).toEqual([
        "1 × Beer",
        "2 × Steak, 1 × Fish",
        "1 × Croquetas",
        "1 × Flan",
      ]);
    });

    it("moves a whole line to another held group", async () => {
      const server = editServer();
      const { el } = await mountApp(server);
      await openGroups(el);

      await press(el, '[data-move-line="line-flan"]');
      await press(el, '[data-move-target="g2"]');

      expect(server.moveLinesToGroup.mock.calls).toEqual([
        ["v1", [{ lineId: "line-flan", quantity: "1.000" }], { groupId: "g2" }, command(3)],
      ]);
      expect(heldGroupsList(el).map((group) => group.lines)).toEqual([
        ["Beer ×1"],
        ["Croquetas ×1", "Flan ×1"],
        ["Steak ×2", "Fish ×1"],
      ]);
    });

    it("moves a whole line into a new held group at the end", async () => {
      const server = editServer();
      const { el } = await mountApp(server);
      await openGroups(el);

      await press(el, '[data-move-line="line-fish"]');
      await press(el, '[data-move-target="new"]');

      expect(server.moveLinesToGroup.mock.calls).toEqual([
        ["v1", [{ lineId: "line-fish", quantity: "1.000" }], "new", command(3)],
      ]);
      expect(heldGroupsList(el).map((group) => group.lines)).toEqual([
        ["Beer ×1"],
        ["Croquetas ×1"],
        ["Steak ×2"],
        ["Flan ×1"],
        ["Fish ×1"],
      ]);
    });

    it("splits Steak ×2 into two rows of one, which stay separate in their group", async () => {
      const server = editServer();
      const { el } = await mountApp(server);
      await openGroups(el);

      await press(el, '[data-split-group-line="line-steak"]');

      expect(server.moveLinesToGroup.mock.calls).toEqual([
        ["v1", [{ lineId: "line-steak", quantity: "1" }], { groupId: "g3" }, command(3)],
      ]);
      expect(heldGroupsList(el)[2]!.lines).toEqual(["Steak ×1", "Steak ×1", "Fish ×1"]);
      expect(tableOrder(el)!.shadowRoot!.querySelector("[data-split-group-line]")).toBeNull();

      await press(el, '[data-group-up="g3"]');
      expect(heldGroupsList(el)[1]!.lines).toEqual(["Steak ×1", "Steak ×1", "Fish ×1"]);
    });

    it("splits Steak ×3 in two requests, each with a submission id of its own and the revision the one before answered", async () => {
      const server = editServer("3.000");
      const { el } = await mountApp(server);
      await openGroups(el);

      await press(el, '[data-split-group-line="line-steak"]');

      const calls = server.moveLinesToGroup.mock.calls;
      expect(calls).toEqual([
        ["v1", [{ lineId: "line-steak", quantity: "1" }], { groupId: "g3" }, command(3)],
        ["v1", [{ lineId: "line-steak", quantity: "1" }], { groupId: "g3" }, command(4)],
      ]);
      expect(calls[0]![3].submissionId).not.toBe(calls[1]![3].submissionId);
      expect(heldGroupsList(el)[2]!.lines).toEqual(["Steak ×1", "Steak ×1", "Steak ×1", "Fish ×1"]);
      expect(banner(el)).toBeNull();

      emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
      await flush(el);
      expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 5 });
    });

    it("a split refused part-way keeps the rows already split, reads the order again, says so and sends no more", async () => {
      const server = editServer("4.000");
      const split = server.moveLinesToGroup;
      split.mockImplementationOnce(split.getMockImplementation()!);
      split.mockRejectedValueOnce({ code: "group.not_held" });
      const { el } = await mountApp(server);
      await openGroups(el);
      const lineReads = server.getTabLines.mock.calls.length;

      await press(el, '[data-split-group-line="line-steak"]');

      expect(split).toHaveBeenCalledTimes(2);
      expect(split.mock.calls[1]![3]).toEqual(command(4));
      expect(server.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
      expect(heldGroupsList(el)[2]!.lines).toEqual(["Steak ×3", "Steak ×1", "Fish ×1"]);
      expect(banner(el)!.textContent).toContain(codeMessage("group.not_held"));
    });

    it("a group another device already fired: reads the order and its groups again, then says so", async () => {
      const server = editServer();
      server.fireGroup.mockRejectedValueOnce({ code: "group.not_held" });
      const { el } = await mountApp(server);
      await openGroups(el);
      const lineReads = server.getTabLines.mock.calls.length;
      const groupReads = server.listGroups.mock.calls.length;

      await press(el, '[data-group-fire="g3"]');
      await press(el, "[data-fire-confirm]");

      expect(server.fireGroup).toHaveBeenCalledOnce();
      expect(server.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
      expect(server.listGroups).toHaveBeenCalledTimes(groupReads + 1);
      expect(banner(el)!.textContent).toContain(codeMessage("group.not_held"));
      expect(codeMessage("group.not_held")).not.toMatch(/reload the table and try again/i);
    });

    it("takes the party's revision from the floor read after a fire that got no answer", async () => {
      let landed = false;
      const { el } = await mountApp({
        ...editServer(),
        getTablesState: vi.fn(async () => [
          landed ? seated({}, { revision: 4 }) : mesa4,
          mesa7,
          mesa9,
        ]),
        fireGroup: vi.fn(async () => {
          landed = true;
          throw new TypeError("offline");
        }),
      });
      const order = await openMesa(el);

      emit(order, "fire-group", { groupId: "g3" });
      await flush(el);
      expect(banner(el)!.textContent).toContain(t("table.error"));
      emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
      await flush(el);

      expect(api.fireGroup).toHaveBeenCalledOnce();
      expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
    });

    it("a split whose request gets no answer stops, reads the floor again, and the next command carries the server's revision", async () => {
      const server = editServer("4.000");
      const split = server.moveLinesToGroup;
      const landed = split.getMockImplementation()!;
      split.mockImplementationOnce(landed);
      split.mockImplementationOnce(async (...args) => {
        await landed(...args);
        throw new TypeError("offline");
      });
      const { el } = await mountApp(server);
      await openGroups(el);
      const floorReads = server.getTablesState.mock.calls.length;

      await press(el, '[data-split-group-line="line-steak"]');

      expect(split.mock.calls.map((call) => call[3])).toEqual([command(3), command(4)]);
      expect(server.getTablesState).toHaveBeenCalledTimes(floorReads + 1);
      expect(banner(el)!.textContent).toContain(t("table.error"));
      expect(heldGroupsList(el)[2]!.lines).toEqual(["Steak ×2", "Steak ×1", "Steak ×1", "Fish ×1"]);

      emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
      await flush(el);
      expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 5 });
    });

    it("a split refused part-way because another device changed the party stops, reloads the table, says so and never sends again", async () => {
      const server = editServer("4.000");
      const split = server.moveLinesToGroup;
      split.mockImplementationOnce(split.getMockImplementation()!);
      split.mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1" });
      const { el } = await mountApp(server);
      await openGroups(el);
      const floorReads = server.getTablesState.mock.calls.length;
      const lineReads = server.getTabLines.mock.calls.length;

      await press(el, '[data-split-group-line="line-steak"]');

      expect(split.mock.calls.map((call) => call[3])).toEqual([command(3), command(4)]);
      expect(server.getTablesState).toHaveBeenCalledTimes(floorReads + 1);
      expect(server.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
      expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
      expect(heldGroupsList(el)[2]!.lines).toEqual(["Steak ×3", "Steak ×1", "Fish ×1"]);
    });

    it("two presses of ↑ in one turn move the group once, and show no message", async () => {
      const server = editServer();
      const { el } = await mountApp(server);
      await openGroups(el);
      const up = tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>('[data-group-up="g4"]')!;

      up.click();
      up.click();
      await flush(el);

      expect(server.reorderGroups.mock.calls).toEqual([["v1", ["g2", "g4", "g3"], command(3)]]);
      expect(banner(el)).toBeNull();
      expect(heldGroupsList(el).map((group) => group.summary)).toEqual([
        "1 × Beer",
        "1 × Croquetas",
        "1 × Flan",
        "2 × Steak, 1 × Fish",
      ]);
    });

    it("two presses of Split quantity in one turn split the line once, and show no message", async () => {
      const server = editServer("3.000");
      const { el } = await mountApp(server);
      await openGroups(el);
      const split = tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>(
        '[data-split-group-line="line-steak"]',
      )!;

      split.click();
      split.click();
      await flush(el);

      expect(server.moveLinesToGroup.mock.calls.map((call) => call[3])).toEqual([
        command(3),
        command(4),
      ]);
      expect(banner(el)).toBeNull();
      expect(heldGroupsList(el)[2]!.lines).toEqual(["Steak ×1", "Steak ×1", "Steak ×1", "Fish ×1"]);
    });

    const handheldOrder = (el: TillApp) =>
      tabGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ??
      null;

    it.each([
      [
        "the till's table screen",
        {},
        async (el: TillApp) => (await openGroups(el), tableOrder(el)!),
      ],
      [
        "a handheld's order card",
        {
          getTill: vi.fn().mockResolvedValue({ ...till, canvas: phone }),
          getDeviceIdentity: vi
            .fn()
            .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
        },
        async (el: TillApp) => {
          await flush(el);
          emit(lock(el), "logged-in", {
            personId: "p1",
            displayName: "Ana",
            canConfigureTill: false,
          });
          await flush(el);
          emit(shell(el), "open-table", { tableId: "t4", seated: true });
          await flush(el);
          const order = handheldOrder(el)!;
          order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
          await flush(el);
          return handheldOrder(el)!;
        },
      ],
    ] as const)(
      "%s disables the group controls while a group command waits for its answer",
      async (_mount, over, open) => {
        const server = editServer();
        let answer!: () => void;
        const reorder = server.reorderGroups.getMockImplementation()!;
        server.reorderGroups.mockImplementationOnce(async (...args) => {
          await new Promise<void>((resolve) => (answer = resolve));
          return reorder(...args);
        });
        const { el } = await mountApp({ ...server, ...over });
        const order = await open(el);
        const disabled = () =>
          ['[data-group-up="g4"]', '[data-group-fire="g4"]', '[data-move-line="line-flan"]'].map(
            (selector) =>
              order.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(selector)!
                .disabled,
          );
        expect(disabled()).toEqual([false, false, false]);

        order.shadowRoot!.querySelector<HTMLElement>('[data-group-down="g2"]')!.click();
        await flush(el);
        expect(disabled()).toEqual([true, true, true]);

        answer();
        await flush(el);
        expect(server.reorderGroups).toHaveBeenCalledOnce();
        expect(disabled()).toEqual([false, false, false]);
      },
    );

    const commands = [
      ["fire-group", { groupId: "g3" }, "fireGroup"],
      ["reorder-groups", { heldGroupIds: ["g3", "g2", "g4"] }, "reorderGroups"],
      [
        "move-group-line",
        { lineId: "line-flan", quantity: "1.000", target: { groupId: "g2" } },
        "moveLinesToGroup",
      ],
      [
        "split-group-line",
        { lineId: "line-steak", groupId: "g3", quantity: "2.000" },
        "moveLinesToGroup",
      ],
    ] as const;

    it.each(commands)(
      "%s refused because another device changed the party reloads the table, says so and never sends again",
      async (type, detail, method) => {
        const refused = vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" });
        const { el } = await mountApp({ ...editServer(), [method]: refused });
        const order = await openMesa(el);
        const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
        const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

        emit(order, type, detail);
        await flush(el);

        expect(refused).toHaveBeenCalledOnce();
        expect(refused.mock.calls[0]!.at(-1)).toEqual(command(3));
        expect(api.getTablesState).toHaveBeenCalledTimes(floorReads + 1);
        expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
        expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
      },
    );

    it.each(commands)(
      "%s sends nothing, says so and reads the groups again while they could not be read",
      async (type, detail, method) => {
        const listGroups = vi.fn().mockRejectedValue(new TypeError("offline"));
        const { el } = await mountApp({ ...editServer(), listGroups });
        const order = await openMesa(el);
        const groupReads = listGroups.mock.calls.length;

        emit(order, type, detail);
        await flush(el);

        expect(
          (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
        ).not.toHaveBeenCalled();
        expect(banner(el)!.textContent).toContain(t("table.error"));
        expect(listGroups).toHaveBeenCalledTimes(groupReads + 1);
      },
    );

    it.each(commands)(
      "%s sends nothing, and says so, for an order with no party",
      async (type, detail, method) => {
        const { el } = await mountApp({
          ...editServer(),
          getTablesState: vi.fn().mockResolvedValue([seated({ party: null }), mesa7, mesa9]),
        });
        const order = await openMesa(el);

        emit(order, type, detail);
        await flush(el);

        expect(
          (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
        ).not.toHaveBeenCalled();
        expect(banner(el)!.textContent).toContain(t("table.error"));
      },
    );

    it("reads the groups again after refusing a fire, so pressing Fire again fires the group", async () => {
      const server = editServer();
      const listGroups = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockImplementation(server.listGroups);
      const { el } = await mountApp({ ...server, listGroups });
      const order = await openMesa(el);
      emit(order, "fire-group", { groupId: "g3" });
      await flush(el);
      expect(server.fireGroup).not.toHaveBeenCalled();

      emit(tableOrder(el)!, "fire-group", { groupId: "g3" });
      await flush(el);

      expect(server.fireGroup.mock.calls).toEqual([["v1", "g3", command(3)]]);
      expect(banner(el)).toBeNull();
    });

    it("a draft refused joining a held group another device fired reads the groups again, then says so", async () => {
      const { el } = await mountApp({
        ...editServer(),
        submitDraft: vi.fn().mockRejectedValue({ code: "group.not_held" }),
      });
      const order = await openMesa(el);
      const groupReads = vi.mocked(api.listGroups).mock.calls.length;
      const round = partyDraft(order);
      round.addProduct(cafe, "1");

      emit(order, "submit-draft", {
        lines: [{ menuItemId: "menu-item-cafe", quantity: "1" }],
        groups: [{ release: "hold", lineIndexes: [0] }],
        joinGroupId: "g2",
        store: round,
        sent: round.lines,
      });
      await flush(el);

      expect(api.submitDraft).toHaveBeenCalledOnce();
      expect(api.listGroups).toHaveBeenCalledTimes(groupReads + 1);
      expect(banner(el)!.textContent).toContain(codeMessage("group.not_held"));
      expect(round.lineCount).toBe(1);
    });

    const withGroups = (over: Record<string, unknown> = {}) => ({
      ...editServer(),
      fireGroup: chainedFire(3),
      sendLines: vi.fn().mockResolvedValue(undefined),
      ...over,
    });

    describe("after a void or a change, which move the party on", () => {
      /** The server's side of D19 for a submission: refused unless it carries `current`. */
      const submitAt = (current: number) =>
        vi.fn(async (...args: SubmitArgs) => {
          if (args[2].expectedPartyRevision !== current)
            throw { code: "party.out_of_date", partyId: "v1" };
          return { ...drafts.apply(...args), tabId: "wo-4", revision: current + 1, groups: [] };
        });

      it("a round sent after a void carries the revision the void answered", async () => {
        const { el } = await mountApp(
          withGroups({
            voidLine: vi.fn().mockResolvedValue({ party: { id: "v1", revision: 4 } }),
            submitDraft: submitAt(4),
          }),
        );
        const order = await openMesa(el);

        emit(order, "void-line", { lineNo: 1 });
        await flush(el);
        await ringRound(el, tableOrder(el)!);
        emit(
          tableOrder(el)!,
          "submit-draft",
          roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0, 1] }]),
        );
        await flush(el);

        expect(api.voidLine).toHaveBeenCalledWith("wo-4", 1);
        expect(vi.mocked(api.submitDraft).mock.calls[0]![2].expectedPartyRevision).toBe(4);
        expect(banner(el)).toBeNull();
      });

      it("a Fire after a saved change carries the revision the change answered", async () => {
        const { el } = await mountApp(
          withGroups({
            updateOrderLine: vi
              .fn()
              .mockResolvedValue({ revision: 1, party: { id: "v1", revision: 4 } }),
            fireGroup: chainedFire(4),
          }),
        );
        const order = await openMesa(el);

        emit(order, "change-line", {
          lineNo: 3,
          lineName: "Vino",
          patch: { note: "sin hielo" },
          revision: 0,
        });
        await flush(el);
        emit(tableOrder(el)!, "fire-group", { groupId: "g3" });
        await flush(el);

        expect(vi.mocked(api.fireGroup).mock.calls).toEqual([
          ["v1", "g3", { submissionId: expect.any(String), expectedPartyRevision: 4 }],
        ]);
        expect(banner(el)).toBeNull();
      });

      /** The floor reads the party at revision 3 until `landed`, and at 4 after. */
      function floorMovedBy(request: string) {
        let landed = false;
        return {
          getTablesState: vi.fn(async () => [
            landed ? seated({}, { revision: 4 }) : mesa4,
            mesa7,
            mesa9,
          ]),
          [request]: vi.fn(async () => {
            landed = true;
            throw new TypeError("offline");
          }),
        };
      }

      it("a round sent after a void that got no answer carries the floor's revision", async () => {
        const { el } = await mountApp(
          withGroups({ ...floorMovedBy("voidLine"), submitDraft: submitAt(4) }),
        );
        const order = await openMesa(el);

        emit(order, "void-line", { lineNo: 1 });
        await flush(el);
        await ringRound(el, tableOrder(el)!);
        emit(
          tableOrder(el)!,
          "submit-draft",
          roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0, 1] }]),
        );
        await flush(el);

        expect(vi.mocked(api.submitDraft).mock.calls[0]![2].expectedPartyRevision).toBe(4);
        expect(banner(el)).toBeNull();
      });

      it("a move after a line change that got no answer carries the floor's revision", async () => {
        const { el } = await mountApp(withGroups(floorMovedBy("updateOrderLine")));
        const order = await openMesa(el);

        emit(order, "change-line", {
          lineNo: 3,
          lineName: "Vino",
          patch: { note: "sin hielo" },
          revision: 0,
        });
        await flush(el);
        emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
        await flush(el);

        expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
      });

      /** The floor lists the party at revision 3, and cannot be read once `request` has been
       * answered once: its second call gets no answer and takes the floor offline with it. */
      function offlineAfterOneAnswer(
        request: string,
        answer: object,
        take: (...args: SubmitArgs) => object = () => ({}),
      ) {
        let offline = false;
        return {
          getTablesState: vi.fn(async () => {
            if (offline) throw new TypeError("offline");
            return [mesa4, mesa7, mesa9];
          }),
          [request]: vi
            .fn()
            .mockImplementationOnce(async (...args: SubmitArgs) => ({
              ...take(...args),
              ...answer,
            }))
            .mockImplementation(async () => {
              offline = true;
              throw new TypeError("offline");
            }),
        };
      }

      it("a void that got no answer, with the floor unread, keeps the revision an earlier void answered", async () => {
        const { el } = await mountApp(
          withGroups(offlineAfterOneAnswer("voidLine", { party: { id: "v1", revision: 4 } })),
        );
        const order = await openMesa(el);

        emit(order, "void-line", { lineNo: 1 });
        await flush(el);
        emit(tableOrder(el)!, "void-line", { lineNo: 2 });
        await flush(el);
        emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
        await flush(el);

        expect(api.voidLine).toHaveBeenCalledTimes(2);
        expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
      });

      it("a round that got no answer, with the floor unread, keeps the revision an earlier round answered", async () => {
        const { el } = await mountApp(
          withGroups(
            offlineAfterOneAnswer(
              "submitDraft",
              { tabId: "wo-4", revision: 4, groups: [] },
              drafts.apply,
            ),
          ),
        );
        const order = await openMesa(el);
        const groups = [{ release: "fire" as const, lineIndexes: [0, 1] }];

        await ringRound(el, order);
        emit(order, "submit-draft", roundDetail(order, groups));
        await flush(el);
        await ringRound(el, tableOrder(el)!);
        emit(tableOrder(el)!, "submit-draft", roundDetail(tableOrder(el)!, groups));
        await flush(el);
        emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
        await flush(el);

        // A retry after no answer keeps its round's submission id, so two ids are two rounds.
        const rounds = vi.mocked(api.submitDraft).mock.calls.map((call) => call[2].submissionId);
        expect(new Set(rounds).size).toBe(2);
        expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 4 });
      });

      it.each([
        ["no party", null],
        ["another party", { id: "v7", revision: 10 }],
      ])("a void answering %s leaves the revision the screen showed", async (_name, answered) => {
        const { el } = await mountApp(
          withGroups({ voidLine: vi.fn().mockResolvedValue({ party: answered }) }),
        );
        const order = await openMesa(el);

        emit(order, "void-line", { lineNo: 1 });
        await flush(el);
        emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
        await flush(el);

        expect(api.moveTab).toHaveBeenCalledWith("wo-4", "t9", { expectedPartyRevision: 3 });
      });
    });
  });
});

describe("till-app: submitting the draft", () => {
  const serviceCourses = [
    { id: "drinks", name: "Drinks", displayOrder: 0 },
    { id: "cold", name: "Cold starters", displayOrder: 1 },
    { id: "warm", name: "Warm starters", displayOrder: 2 },
    { id: "mains", name: "Mains", displayOrder: 3 },
    { id: "desserts", name: "Desserts", displayOrder: 4 },
  ];
  const dish = (id: string, name: string, courseId: string): TillProduct => ({
    id,
    menuItemId: `offer-${id}`,
    name,
    pricingUnit: "each",
    unitPrice: "5.00",
    vatClass: "general",
    category: null,
    allergens: null,
    courseId,
  });
  const beer = dish("beer", "Beer", "drinks");
  const salad = dish("salad", "Salad", "cold");
  const croquetas = dish("croquetas", "Croquetas", "warm");
  const steak = dish("steak", "Steak", "mains");
  const flan = dish("flan", "Flan", "desserts");

  /** The server's side of groups: each submission appends its groups at the end of the party's
   * sequence, or adds its lines to the held group it joins; each is refused unless it carries the
   * party's current revision, which it moves on by one. */
  function groupsServer(start = 3) {
    let revision = start;
    let lineIds = 0;
    const groups: OrderGroup[] = [];
    return {
      groups,
      /** The floor lists the party at the revision the server holds. */
      getTablesState: vi.fn(async () => [seated({}, { revision }), mesa7, mesa9]),
      listGroups: vi.fn(async () => ({ revision, groups: groups.map((group) => ({ ...group })) })),
      submitDraft: vi.fn(async (partyId: string, draftId: string, submission: SubmitArgs[2]) => {
        if (submission.expectedPartyRevision !== revision)
          throw { code: "party.out_of_date", partyId: "v1" };
        const taken = drafts.apply(partyId, draftId, submission);
        for (const group of drafts.sentGroups(submission)) {
          const ids = group.lines.map(() => `line-${++lineIds}`);
          const joined = groups.find((held) => held.id === submission.joinGroupId);
          if (joined !== undefined) {
            joined.lineIds.push(...ids);
            continue;
          }
          groups.push({
            id: `g${groups.length + 1}`,
            position: groups.length + 1,
            state: group.release === "fire" ? "fired" : "held",
            firedAt: group.release === "fire" ? "2026-09-27T10:00:00.000Z" : null,
            remindAt: null,
            lineIds: ids,
            summary: group.lines.map((line) => `1 × ${line.menuItemId}`).join(", "),
          });
        }
        revision += 1;
        return { ...taken, tabId: "wo-4", revision, groups: [] };
      }),
    };
  }

  const withCourses = () => ({
    getTill: vi.fn().mockResolvedValue({ ...till, courses: serviceCourses }),
  });

  const draftOf = (order: TillTableOrderScreen) =>
    order.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!.store;

  async function ring(el: TillApp, order: TillTableOrderScreen, ...products: TillProduct[]) {
    for (const product of products) draftOf(order).addProduct(product, "1");
    await flush(el);
  }

  async function toggle(el: TillApp, order: TillTableOrderScreen, name: string): Promise<void> {
    [...order.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-select]")]
      .find((button) => button.textContent!.includes(name))!
      .click();
    await flush(el);
  }

  async function act(el: TillApp, order: TillTableOrderScreen, kind: string): Promise<void> {
    order.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${kind}"]`)!.click();
    await flush(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
    await flush(el);
  }

  const toast = (el: TillApp) =>
    el.shadowRoot!.querySelector<
      HTMLElement & { open: boolean; message: string; tone: string; duration: number }
    >("wt-toast[data-submitted-toast]");

  it("files the spec's five groups from one draft, then returns to the floor saying what it did", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    const order = await openMesa(el);
    await ring(el, order, beer, salad, croquetas, steak, flan);

    await toggle(el, order, "Beer");
    await act(el, order, "fire-selected");
    await toggle(el, tableOrder(el)!, "Salad");
    await act(el, tableOrder(el)!, "fire-selected");
    await toggle(el, tableOrder(el)!, "Croquetas");
    await act(el, tableOrder(el)!, "send-selected");
    expect(tableOrder(el)).not.toBeNull();
    expect(toast(el)?.open ?? false).toBe(false);
    await act(el, tableOrder(el)!, "send-all");

    expect(
      server.groups.map((group) => ({
        position: group.position,
        state: group.state,
        summary: group.summary,
      })),
    ).toEqual([
      { position: 1, state: "fired", summary: "1 × offer-beer" },
      { position: 2, state: "fired", summary: "1 × offer-salad" },
      { position: 3, state: "held", summary: "1 × offer-croquetas" },
      { position: 4, state: "held", summary: "1 × offer-steak" },
      { position: 5, state: "held", summary: "1 × offer-flan" },
    ]);
    expect(api.submitDraft).toHaveBeenCalledTimes(4);
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
    expect(toast(el)!.open).toBe(true);
    expect(toast(el)!.tone).toBe("info");
    expect(toast(el)!.message).toBe("Fired: 2 groups. Held: 3 groups.");
    expect(toast(el)!.getAttribute("close-label")).toBe(t("table.submitted_close"));

    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    tableOrder(el)!.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);
    expect(heldGroupsList(el).map(({ position, state }) => ({ position, state }))).toEqual([
      { position: "Group 1", state: "fired" },
      { position: "Group 2", state: "fired" },
      { position: "Group 3", state: "held" },
      { position: "Group 4", state: "held" },
      { position: "Group 5", state: "held" },
    ]);
  });

  it("shows the notice over the floor without moving it, so a tap as it closes lands where it was aimed", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    const order = await openMesa(el);
    await ring(el, order, beer, steak);
    await act(el, order, "fire-all");
    expect(toast(el)!.open).toBe(true);
    const withNotice = floor(el)!.getBoundingClientRect().top;

    toast(el)!.shadowRoot!.querySelector<HTMLElement>("button.close")!.click();
    await flush(el);
    expect(toast(el)!.open).toBe(false);
    expect(floor(el)!.getBoundingClientRect().top).toBe(withNotice);
  });

  it("stays on the table after a partial submission, keeping the unchecked lines in the draft", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    const order = await openMesa(el);
    await ring(el, order, beer, steak);
    const draft = draftOf(order);

    await toggle(el, order, "Beer");
    await act(el, order, "fire-selected");

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(tableOrder(el)).toBe(order);
    expect(draft.lines.map((line) => line.product.id)).toEqual(["steak"]);
    expect(toast(el)?.open ?? false).toBe(false);
  });

  describe("a partial submission that lands on the party's next bill", () => {
    const toNextBill = (over: Record<string, unknown> = {}) => ({
      ...withCourses(),
      submitDraft: answering({ tabId: "wo-next", revision: 4, groups: [] }),
      ...over,
    });
    const partyOnNextBill = () =>
      vi
        .mocked(api.getTablesState)
        .mockResolvedValue([seated({ tabId: "wo-next" }, { revision: 4 }), mesa7, mesa9]);
    const courseOf = (order: TillTableOrderScreen, index: number) =>
      order.shadowRoot!.querySelector<HTMLSelectElement>(`[data-round-course="${index}"]`)!.value;

    const firedGroup = (id: string, summary: string): OrderGroup => ({
      id,
      position: 1,
      state: "fired",
      firedAt: "2026-09-27T10:00:00Z",
      remindAt: null,
      lineIds: [],
      summary,
    });

    it("keeps the rest of a first order a first order, with its course choice and its count, on the bill it follows, though the party now has a group", async () => {
      const { el } = await mountApp(
        toNextBill({
          submitDraft: vi.fn(async (...args: SubmitArgs) => {
            vi.mocked(api.listGroups).mockResolvedValue({
              revision: 4,
              groups: [firedGroup("g1", "1 × Beer")],
            });
            return { ...drafts.apply(...args), tabId: "wo-next", revision: 4, groups: [] };
          }),
        }),
      );
      const order = await openMesa(el);
      await ring(el, order, beer, steak);
      const steakCourse =
        order.shadowRoot!.querySelector<HTMLSelectElement>('[data-round-course="1"]')!;
      steakCourse.value = "desserts";
      steakCourse.dispatchEvent(new Event("change"));
      await flush(el);
      partyOnNextBill();

      await toggle(el, order, "Beer");
      await act(el, order, "fire-selected");

      const next = tableOrder(el)!;
      expect(next.orderId).toBe("wo-next");
      expect(draftOf(next).lines.map((line) => line.product.id)).toEqual(["steak"]);
      expect(courseOf(next, 0)).toBe("desserts");
      expect(next.shadowRoot!.querySelector('[data-draft-action="send-all"]')).not.toBeNull();
      expect(next.shadowRoot!.querySelector("[data-destination-choice]")).toBeNull();

      await act(el, tableOrder(el)!, "send-all");
      expect(drafts.sentGroups(vi.mocked(api.submitDraft).mock.calls[1]![2])).toEqual([
        {
          release: "hold",
          lines: [{ menuItemId: "offer-steak", quantity: "1", courseId: "desserts" }],
        },
      ]);
      expect(toast(el)!.message).toBe("Fired: 1 group. Held: 1 group.");
    });

    it("keeps a later addition's rest a later addition", async () => {
      const prior = firedGroup("g-prior", "1 × Coffee");
      const { el } = await mountApp(
        toNextBill({ listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [prior] }) }),
      );
      const order = await openMesa(el);
      await ring(el, order, beer, steak);
      partyOnNextBill();

      await toggle(el, order, "Beer");
      await act(el, order, "submit");

      const next = tableOrder(el)!;
      expect(next.orderId).toBe("wo-next");
      expect(draftOf(next).lines.map((line) => line.product.id)).toEqual(["steak"]);
      expect(next.shadowRoot!.querySelector("[data-destination-choice]")).not.toBeNull();
    });

    it("keeps a later addition's chosen destination and held group for its rest", async () => {
      const held = (id: string, position: number): OrderGroup => ({
        ...firedGroup(id, `1 × ${id}`),
        position,
        state: "held",
        firedAt: null,
      });
      const { el } = await mountApp(
        toNextBill({
          listGroups: vi
            .fn()
            .mockResolvedValue({ revision: 3, groups: [held("g-a", 1), held("g-b", 2)] }),
        }),
      );
      const order = await openMesa(el);
      await ring(el, order, beer, steak);
      order.shadowRoot!.querySelector<HTMLElement>('[data-destination="add-to-held"]')!.click();
      await flush(el);
      order.shadowRoot!.querySelector<HTMLElement>('[data-held-group="g-b"]')!.click();
      await flush(el);
      partyOnNextBill();

      await toggle(el, order, "Beer");
      await act(el, order, "submit");

      const next = tableOrder(el)!;
      const pressed = (selector: string) =>
        next.shadowRoot!.querySelector(selector)!.getAttribute("aria-pressed");
      expect(next.orderId).toBe("wo-next");
      expect(vi.mocked(api.submitDraft).mock.calls[0]![2].joinGroupId).toBe("g-b");
      expect(pressed('[data-destination="add-to-held"]')).toBe("true");
      expect(pressed('[data-held-group="g-b"]')).toBe("true");
    });
  });

  it("counts only this draft's groups when the last one was emptied by hand after a partial submission", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    const order = await openMesa(el);
    await ring(el, order, beer, steak);
    await toggle(el, order, "Beer");
    await act(el, order, "fire-selected");
    draftOf(order).removeLines(draftOf(order).lines);
    await flush(el);

    await ring(el, order, flan);
    await act(el, order, "submit");

    expect(server.groups).toHaveLength(2);
    expect(toast(el)!.message).toBe("Fired: 1 group.");
  });

  it("says one group in the singular, and leaves out a clause with nothing in it", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    const order = await openMesa(el);
    await ring(el, order, beer, steak);
    await act(el, order, "fire-all");
    expect(toast(el)!.message).toBe("Fired: 1 group.");
  });

  it("gives a second identical notice its own full time on screen", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    const order = await openMesa(el);
    toast(el)!.duration = 1000;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await ring(el, order, beer);
      await act(el, order, "fire-all");
      expect(toast(el)!.message).toBe("Fired: 1 group.");

      await vi.advanceTimersByTimeAsync(600);
      emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
      await flush(el);
      await ring(el, tableOrder(el)!, flan);
      await act(el, tableOrder(el)!, "submit");
      expect(server.groups).toHaveLength(2);
      expect(toast(el)!.message).toBe("Fired: 1 group.");
      expect(toast(el)!.open).toBe(true);

      // Past the first notice's 1000 ms, short of the second's.
      await vi.advanceTimersByTimeAsync(600);
      expect(toast(el)!.open).toBe(true);
      await vi.advanceTimersByTimeAsync(400);
      expect(toast(el)!.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count a draft added to a held group as a new group", async () => {
    const server = groupsServer();
    const { el } = await mountApp({ ...withCourses(), ...server });
    let order = await openMesa(el);
    await ring(el, order, steak);
    await act(el, order, "send-all");
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    order = tableOrder(el)!;
    await ring(el, order, flan);
    order.shadowRoot!.querySelector<HTMLElement>('[data-destination="add-to-held"]')!.click();
    await flush(el);
    await act(el, order, "submit");

    expect(vi.mocked(api.submitDraft).mock.calls[1]![2]).toEqual({
      submissionId: expect.any(String),
      expectedPartyRevision: 4,
      draftRevision: expect.any(Number),
      joinGroupId: "g1",
      groups: [{ release: "hold", lineIds: [expect.any(String)] }],
    });
    expect(drafts.sentGroups(vi.mocked(api.submitDraft).mock.calls[1]![2])).toEqual([
      { release: "hold", lines: [{ menuItemId: "offer-flan", quantity: "1" }] },
    ]);
    expect(server.groups).toHaveLength(1);
    expect(toast(el)!.message).toBe(t("table.submitted_joined"));
  });

  it("returns a handheld to its floor tab after a complete submission, keeping the order it showed", async () => {
    const server = groupsServer();
    const { el } = await mountApp({
      ...server,
      getTill: vi.fn().mockResolvedValue({ ...till, courses: serviceCourses, canvas: phone }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
    await flush(el);
    emit(shell(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const card =
      tabGrid(el)!.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
    await ring(el, card, beer);
    await act(el, card, "fire-all");

    expect((shell(el) as HTMLElement & { activeTabKey?: string }).activeTabKey).toBe("floor");
    expect(toast(el)!.message).toBe("Fired: 1 group.");
    emit(shell(el), "tab-select", { key: "order" });
    await flush(el);
    expect(
      tabGrid(el)!.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!
        .orderId,
    ).toBe("wo-4");
  });

  it("reloads and says so when another device changed the party first, and never sends again", async () => {
    const { el } = await mountApp({
      ...withCourses(),
      submitDraft: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
    });
    const order = await openMesa(el);
    await ring(el, order, beer);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

    await act(el, order, "fire-all");
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads + 1);
    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
    expect(draftOf(order).lineCount).toBe(1);
    expect(tableOrder(el)).toBe(order);
    expect(toast(el)?.open ?? false).toBe(false);
  });

  it("refuses to add to a held group while the groups could not be read, and reads them again", async () => {
    // A preview opened before a read failed still names the group it joins.
    const listGroups = vi.fn().mockRejectedValue(new TypeError("offline"));
    const { el } = await mountApp({ ...withCourses(), listGroups });
    const order = await openMesa(el);
    const reads = listGroups.mock.calls.length;
    const round = new WorkingOrderStore();
    round.addProduct(flan, "1");

    emit(order, "submit-draft", {
      lines: [{ menuItemId: "offer-flan", quantity: "1" }],
      groups: [{ release: "hold", lineIndexes: [0] }],
      joinGroupId: "g1",
      store: round,
      sent: round.lines,
    });
    await flush(el);

    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("table.error"));
    expect(listGroups).toHaveBeenCalledTimes(reads + 1);
    expect(round.lineCount).toBe(1);
  });

  it("still submits a first-order draft while the groups could not be read", async () => {
    const { el } = await mountApp({
      ...withCourses(),
      listGroups: vi.fn().mockRejectedValue(new TypeError("offline")),
    });
    const order = await openMesa(el);
    await ring(el, order, beer);
    await act(el, order, "fire-all");
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(banner(el)).toBeNull();
  });
});

describe("till-app: a party's kitchen tickets that have not printed", () => {
  const problems: PrintProblem[] = [
    {
      workingOrderId: "wo-4",
      stationId: "st-1",
      stationName: "Cocina",
      since: "2026-09-27T10:00:00Z",
    },
    {
      workingOrderId: "wo-4",
      stationId: "st-2",
      stationName: "Barra",
      since: "2026-09-27T10:01:00Z",
    },
    {
      workingOrderId: "wo-check",
      stationId: "st-1",
      stationName: "Cocina",
      since: "2026-09-27T10:02:00Z",
    },
  ];

  it("reads them with the order and gives them to the screen", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
    });
    const order = await openMesa(el);
    expect(api.listPrintProblems).toHaveBeenCalledWith("v1");
    expect(order.printProblems).toEqual(problems);
  });

  it("gives them to an order shown as a card too", async () => {
    const { el } = await mountApp({
      ...onTablet(),
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    expect(tabletOrderCard(el)!.printProblems).toEqual(problems);
  });

  it("a failed read shows none, and the order still opens", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);
    expect(order.printProblems).toEqual([]);
    expect(order.orderId).toBe("wo-4");
  });

  it("Reprint reprints each bill through the kitchen reprint, then reads again, and the notice clears once none is left", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi
        .fn()
        .mockResolvedValueOnce({ problems })
        .mockResolvedValue({ problems: [] }),
      reprintOrder: vi.fn().mockResolvedValue(undefined),
    });
    const order = await openMesa(el);
    expect(order.printProblems).toEqual(problems);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4", "wo-check"] });
    await flush(el);
    expect(vi.mocked(api.reprintOrder).mock.calls).toEqual([["wo-4"], ["wo-check"]]);
    expect(api.listPrintProblems).toHaveBeenCalledTimes(2);
    expect(order.printProblems).toEqual([]);
    expect(banner(el)).toBeNull();
  });

  it("a refused Reprint says why and reads again", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
      reprintOrder: vi.fn().mockRejectedValue({ code: "working_order.not_found" }),
    });
    const order = await openMesa(el);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4", "wo-check"] });
    await flush(el);
    expect(api.reprintOrder).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(codeMessage("working_order.not_found"));
    expect(api.listPrintProblems).toHaveBeenCalledTimes(2);
  });

  const reprintButton = (order: TillTableOrderScreen) =>
    order.shadowRoot!.querySelector("[data-print-problem-reprint]");

  it("a second press while a Reprint runs sends nothing", async () => {
    let finish!: () => void;
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
      reprintOrder: vi.fn(
        () => new Promise<void>((resolve) => (finish = () => resolve(undefined))),
      ),
    });
    const order = await openMesa(el);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4"] });
    await flush(el);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4"] });
    await flush(el);
    finish();
    await flush(el);
    expect(vi.mocked(api.reprintOrder).mock.calls).toEqual([["wo-4"]]);
  });

  it("while the server still reports them, the bills sent again show as sent and offer no Reprint", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
      reprintOrder: vi.fn().mockResolvedValue(undefined),
    });
    const order = await openMesa(el);
    expect(order.reprintSent).toEqual([]);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4", "wo-check"] });
    await flush(el);
    expect(order.printProblems).toEqual(problems);
    expect(order.reprintSent).toEqual(["wo-4", "wo-check"]);
    await order.updateComplete;
    expect(reprintButton(order)).toBeNull();
    expect(order.shadowRoot!.querySelector("[data-print-problem]")!.textContent).toContain(
      t("table.print_problem_sent").replace("{stations}", "Cocina, Barra"),
    );
  });

  it("a Reprint refused part way marks only the bills that were sent", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
      reprintOrder: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue({ code: "working_order.not_found" }),
    });
    const order = await openMesa(el);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4", "wo-check"] });
    await flush(el);
    expect(order.reprintSent).toEqual(["wo-4"]);
    await order.updateComplete;
    expect(reprintButton(order)).not.toBeNull();
  });

  it("opening the table again reads the problems afresh and offers Reprint again", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
      reprintOrder: vi.fn().mockResolvedValue(undefined),
    });
    const order = await openMesa(el);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4", "wo-check"] });
    await flush(el);
    expect(order.reprintSent).toEqual(["wo-4", "wo-check"]);
    const reads = vi.mocked(api.listPrintProblems).mock.calls.length;
    emit(order, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const reopened = tableOrder(el)!;
    expect(api.listPrintProblems).toHaveBeenCalledTimes(reads + 1);
    expect(reopened.reprintSent).toEqual([]);
    await reopened.updateComplete;
    expect(reprintButton(reopened)).not.toBeNull();
  });

  it("a Reprint that fails with no code says so in general words", async () => {
    const { el } = await mountApp({
      listPrintProblems: vi.fn().mockResolvedValue({ problems }),
      reprintOrder: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);
    emit(order, "reprint-kitchen-tickets", { workingOrderIds: ["wo-4"] });
    await flush(el);
    expect(banner(el)!.textContent).toContain(codeMessage("server.internal"));
  });
});

// The shared stub has no `readCurrentOrders`, so every other suite here sees the read fail and the
// groups fall back to this bill's lines.
describe("till-app: Current orders", () => {
  const noCurrentOrders = () => ({
    readCurrentOrders: vi
      .fn()
      .mockResolvedValue({ revision: 3, reminder: null, groups: [], ungrouped: [] }),
  });
  const orders: CurrentOrders = {
    revision: 3,
    reminder: { groupId: "g2", dueAt: "2026-09-28T20:15:00.000Z" },
    groups: [
      {
        id: "g1",
        position: 1,
        state: "fired",
        firedAt: "2026-09-28T19:50:00.000Z",
        remindAt: null,
        sentAt: "2026-09-28T19:50:00.000Z",
        sentBy: "Luis",
        rows: [
          {
            lineId: "line-1",
            workingOrderId: "wo-4",
            lineNo: 1,
            name: "Vino",
            quantity: "1.000",
            unitPrecision: 0,
            servedQuantity: "0.000",
            servedAt: null,
            released: true,
            kitchen: null,
            note: null,
            extras: [],
          },
        ],
      },
    ],
    ungrouped: [],
  };

  it("reads the party's Current orders with its order and hands them to the screen", async () => {
    const { el } = await mountApp({ readCurrentOrders: vi.fn().mockResolvedValue(orders) });
    const order = await openMesa(el);

    expect(api.readCurrentOrders).toHaveBeenCalledWith("v1");
    expect(order.currentOrders).toEqual(orders);
  });

  it("opens the order with no Current orders when their read fails", async () => {
    const { el } = await mountApp({
      readCurrentOrders: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const order = await openMesa(el);

    expect(order.currentOrders).toBeNull();
    expect(order.lines).toEqual([tabLine]);
    expect(banner(el)).toBeNull();
  });

  it("hands them to an order card on a tablet too", async () => {
    const { el } = await mountApp({
      ...onTablet(),
      readCurrentOrders: vi.fn().mockResolvedValue(orders),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    expect(tabletOrderCard(el)!.currentOrders).toEqual(orders);
  });

  it("tells a tablet's order card when Current orders could not be read", async () => {
    const { el } = await mountApp({
      ...onTablet(),
      readCurrentOrders: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const screen = await toFloor(el);
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    expect(tabletOrderCard(el)!.currentOrdersUnread).toBe(true);
  });

  it.each([
    [
      "serve-lines",
      { items: [{ lineId: "line-1", quantity: "1" }] },
      "markServed",
      [[{ lineId: "line-1", quantity: "1" }]],
    ],
    [
      "unserve-lines",
      { items: [{ lineId: "line-1", quantity: "1" }] },
      "unmarkServed",
      [[{ lineId: "line-1", quantity: "1" }]],
    ],
    ["serve-group", { groupId: "g1" }, "markGroupServed", ["g1"]],
    ["snooze-group", { groupId: "g2", minutes: 5 }, "snoozeGroup", ["g2", 5]],
    ["unsnooze-group", { groupId: "g2" }, "unsnoozeGroup", ["g2"]],
  ] as const)(
    "%s goes to the party under a fresh submission id at the revision shown, then reads Current orders again",
    async (type, detail, method, args) => {
      const { el } = await mountApp(noCurrentOrders());
      const order = await openMesa(el);
      const reads = vi.mocked(api.readCurrentOrders).mock.calls.length;

      emit(order, type, detail);
      await flush(el);
      emit(order, type, detail);
      await flush(el);

      const sent = (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]!;
      const command = { submissionId: expect.any(String), expectedPartyRevision: 3 };
      expect(sent.mock.calls[0]).toEqual(["v1", ...args, command]);
      // The second press carries the revision the first one answered, under an id of its own.
      expect(sent.mock.calls[1]).toEqual(["v1", ...args, { ...command, expectedPartyRevision: 4 }]);
      expect(sent.mock.calls[1]![args.length + 1].submissionId).not.toBe(
        sent.mock.calls[0]![args.length + 1].submissionId,
      );
      expect(api.readCurrentOrders).toHaveBeenCalledTimes(reads + 2);
      expect(banner(el)).toBeNull();
    },
  );

  it("reloads Current orders and says what changed when another device changed the party first, never sending the press again", async () => {
    const markServed = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 5 })
      .mockResolvedValue({ revision: 6 });
    const { other, getTablesState } = floorThat(
      [mesa4, mesa9],
      [seated({}, { revision: 5 }), mesa9],
    );
    const { el } = await mountApp({ ...noCurrentOrders(), markServed, getTablesState });
    const order = await openMesa(el);
    other.acted = true;
    const reads = vi.mocked(api.readCurrentOrders).mock.calls.length;
    const items = [{ lineId: "line-1", quantity: "1" }];

    emit(order, "serve-lines", { items });
    await flush(el);

    expect(markServed).toHaveBeenCalledOnce();
    expect(api.readCurrentOrders).toHaveBeenCalledTimes(reads + 1);
    const text = banner(el)!.textContent!;
    expect(text).toContain(t("party.changed").replace("{table}", "4"));
    expect(text).toContain(t("party.changed_other"));
    expect(text).toContain(t("party.try_again"));

    emit(tableOrder(el)!, "serve-lines", { items });
    await flush(el);
    expect(markServed).toHaveBeenLastCalledWith("v1", items, {
      submissionId: expect.any(String),
      expectedPartyRevision: 5,
    });
  });

  it("tells the screen when Current orders could not be read, and when they could", async () => {
    const readCurrentOrders = vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue(orders);
    const { el } = await mountApp({ readCurrentOrders });
    const order = await openMesa(el);
    expect(order.currentOrdersUnread).toBe(true);

    emit(order, "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el);

    expect(tableOrder(el)!.currentOrdersUnread).toBe(false);
    expect(tableOrder(el)!.currentOrders).toEqual(orders);
  });

  it("moves a held row on another open bill of the party from Current orders", async () => {
    const heldOnCheck: CurrentOrders = {
      revision: 3,
      reminder: null,
      groups: [
        {
          id: "g1",
          position: 1,
          state: "held",
          firedAt: null,
          remindAt: null,
          sentAt: "2026-09-28T20:02:00.000Z",
          sentBy: "Ana",
          rows: [
            {
              lineId: "line-9",
              workingOrderId: "wo-check",
              lineNo: 1,
              name: "Pulpo",
              quantity: "1.000",
              unitPrecision: 0,
              servedQuantity: "0.000",
              servedAt: null,
              released: false,
              kitchen: null,
              note: null,
              extras: [],
            },
          ],
        },
      ],
      ungrouped: [],
    };
    const moveLinesToGroup = vi.fn().mockResolvedValue({ revision: 4 });
    const { el } = await mountApp({
      readCurrentOrders: vi.fn().mockResolvedValue(heldOnCheck),
      listGroups: vi.fn().mockResolvedValue({
        revision: 3,
        groups: [
          {
            id: "g1",
            position: 1,
            state: "held",
            firedAt: null,
            remindAt: null,
            lineIds: ["line-9"],
            summary: "1 × Pulpo",
          },
        ],
      }),
      moveLinesToGroup,
    });
    const order = await openMesa(el);
    const reads = vi.mocked(api.readCurrentOrders).mock.calls.length;
    order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);

    order.shadowRoot!.querySelector<HTMLElement>('[data-move-line="line-9"]')!.click();
    await flush(el);
    order.shadowRoot!.querySelector<HTMLElement>('[data-move-target="new"]')!.click();
    await flush(el);

    expect(moveLinesToGroup).toHaveBeenCalledExactlyOnceWith(
      "v1",
      [{ lineId: "line-9", quantity: "1.000" }],
      "new",
      { submissionId: expect.any(String), expectedPartyRevision: 3 },
    );
    expect(api.readCurrentOrders).toHaveBeenCalledTimes(reads + 1);
    expect(banner(el)).toBeNull();
  });

  it("says a refused serve in its own words and reads Current orders again", async () => {
    const { el } = await mountApp({
      ...noCurrentOrders(),
      markGroupServed: vi.fn().mockRejectedValue({ code: "group.line_held" }),
    });
    const order = await openMesa(el);
    const reads = vi.mocked(api.readCurrentOrders).mock.calls.length;

    emit(order, "serve-group", { groupId: "g1" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("group.line_held"));
    expect(api.readCurrentOrders).toHaveBeenCalledTimes(reads + 1);
  });

  it("says a snooze refused for a group that is not the one waiting in its own words, and reads Current orders again", async () => {
    const { el } = await mountApp({
      ...noCurrentOrders(),
      snoozeGroup: vi.fn().mockRejectedValue({ code: "group.not_waiting" }),
    });
    const order = await openMesa(el);
    const reads = vi.mocked(api.readCurrentOrders).mock.calls.length;

    emit(order, "snooze-group", { groupId: "g2", minutes: 5 });
    await flush(el);

    expect(banner(el)!.textContent).toContain(
      "Only the next group to fire can be snoozed. Check the table before trying again",
    );
    expect(api.readCurrentOrders).toHaveBeenCalledTimes(reads + 1);
  });
});

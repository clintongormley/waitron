import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { formatMoney } from "@waitron/shared";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  FloorZone,
  TabLine,
  TableState,
  TableVisit,
  TillApi,
  TillSaleResult,
  VisitBill,
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
    visit: null,
    ...over,
  };
}

function party(over: Partial<TableVisit> = {}): TableVisit {
  return {
    id: "v1",
    revision: 3,
    guestCount: 3,
    state: "open",
    outstanding: "44.00",
    billCount: 1,
    tableIds: ["t4"],
    ...over,
  };
}

function seated(over: Partial<TableState> = {}, visit: Partial<TableVisit> = {}): TableState {
  return table({
    state: "open-tab",
    hasOpenTab: true,
    tabId: "wo-4",
    tabLineCount: 3,
    tabTotal: "44.00",
    visit: party(visit),
    ...over,
  });
}

const mesa4 = seated();
const mesa7 = seated(
  { id: "t7", label: "7", tabId: "wo-7" },
  { id: "v7", revision: 9, tableIds: ["t7"] },
);
const mesa9 = table({ id: "t9", label: "9" });

const tabBill: VisitBill = {
  workingOrderId: "wo-4",
  visitId: "v1",
  label: null,
  status: "open",
  total: "14.00",
  outstanding: "14.00",
  receiptAvailable: false,
};
const checkBill: VisitBill = {
  workingOrderId: "wo-check",
  visitId: "v1",
  label: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  receiptAvailable: false,
};

const tabLine: TabLine = {
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
      .mockResolvedValue({ visitId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 }),
    getVisitBills: vi.fn().mockResolvedValue([tabBill, checkBill]),
    finishTable: vi.fn().mockResolvedValue({ state: "closed" }),
    markCleared: vi.fn().mockResolvedValue(undefined),
    getTabLines: vi.fn().mockResolvedValue({ lines: [tabLine], revision: 0, editSentLines: true }),
    addTabRound: vi.fn().mockResolvedValue({ tabId: "wo-4" }),
    moveTab: vi.fn().mockResolvedValue(undefined),
    joinTable: vi.fn().mockResolvedValue(undefined),
    mergeTabs: vi.fn().mockResolvedValue(undefined),
    transferLines: vi.fn().mockResolvedValue(undefined),
    splitTab: vi.fn().mockResolvedValue({ checkId: "wo-check" }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    reprint: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api });
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
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

beforeEach(() => setLocale("en"));
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
    const { el } = await mountApp({ getTablesState, getVisitBills: vi.fn().mockResolvedValue([]) });
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
    expect(order.visit).toEqual(seatedMesa9.visit);
    expect(api.getVisitBills).toHaveBeenCalledWith("v-new");
  });

  it("acts on the party the seat answered with when the floor cannot be read after seating", async () => {
    const getTablesState = vi
      .fn()
      .mockResolvedValueOnce([mesa4, mesa7, mesa9])
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({
      getTablesState,
      getVisitBills: vi.fn().mockResolvedValue([]),
      finishTable: vi.fn().mockRejectedValue({ code: "visit.bill_outstanding" }),
    });
    const screen = await toFloor(el);

    emit(screen, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);
    const order = tableOrder(el)!;
    expect(order.orderId).toBe("wo-new");
    expect(api.getVisitBills).toHaveBeenCalledWith("v-new");

    emit(order, "finish-table", {});
    await flush(el);
    expect(api.finishTable).toHaveBeenCalledWith("v-new", 0);

    emit(tableOrder(el)!, "join-table", { tableId: "t4" });
    await flush(el);
    expect(api.joinTable).toHaveBeenCalledWith("wo-new", "t4", { expectedVisitRevision: 0 });
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

describe("till-app: the party's bills and Finish table", () => {
  it("gives the table screen the party and every bill it has", async () => {
    const { el } = await mountApp();

    const order = await openMesa(el);

    expect(api.getVisitBills).toHaveBeenCalledWith("v1");
    expect(order.visit).toEqual(mesa4.visit);
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
      finishTable: vi.fn().mockRejectedValue({ code: "visit.bill_outstanding" }),
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

describe("till-app: the party on a handheld", () => {
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
    expect(card.visit).toEqual(mesa4.visit);
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
      const sent = (args.at(-1) as { expectedVisitRevision?: number }).expectedVisitRevision;
      if (sent !== current) throw { code: "visit.out_of_date", visitId: "v1", revision: current };
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
      const billReads = vi.mocked(api.getVisitBills).mock.calls.length;

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
        code: "visit.out_of_date",
      });
      expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
      expect(api.getVisitBills).toHaveBeenCalledTimes(billReads + 1);
      expect(orderCard(el)!.visit).toEqual(splitElsewhere.visit);
      const text = banner(el)!.textContent!;
      expect(text).toContain(t("visit.changed").replace("{table}", "4"));
      expect(text).toContain(
        t("visit.changed_bills").replace("{amount}", formatMoney("44.00", "en")),
      );
    },
  );
});

/** The party's bills read left unanswered until the test settles it. */
interface LateBills {
  resolve: (bills: VisitBill[]) => void;
  reject: (error: unknown) => void;
}

describe("till-app: reads and refusals around the party", () => {
  it("shows no bills rather than stale ones when the party's bills cannot be read", async () => {
    const { el } = await mountApp({
      getVisitBills: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
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
      const bill7: VisitBill = { ...tabBill, workingOrderId: "wo-7", visitId: "v7" };
      const late = {} as LateBills;
      let v1Reads = 0;
      const { el } = await mountApp({
        getVisitBills: vi.fn((visitId: string) => {
          if (visitId !== "v1") return Promise.resolve([bill7]);
          v1Reads++;
          if (v1Reads === 1) return Promise.resolve([tabBill, checkBill]);
          return new Promise<VisitBill[]>((resolve, reject) =>
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
      getTablesState: vi.fn().mockResolvedValue([{ ...mesa4, visit: null }]),
    });
    const order = await openMesa(el);

    emit(order, "finish-table", {});
    await flush(el);

    expect(api.getVisitBills).not.toHaveBeenCalled();
    expect(api.finishTable).not.toHaveBeenCalled();
  });

  it("says why Mark cleared was refused and re-reads the floor", async () => {
    const { el } = await mountApp({
      markCleared: vi.fn().mockRejectedValue({ code: "visit.not_open", visitId: "v1" }),
    });
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "mark-cleared", { visitId: "v1", expectedVisitRevision: 6 });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("visit.not_open"));
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });

  it("describes the open table's party when a stale refusal does not name one", async () => {
    const reads = floorThat([mesa4], [seated({}, { revision: 5, tableIds: ["t4", "t9"] }), mesa9]);
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      moveTab: vi.fn().mockRejectedValue({ code: "visit.out_of_date" }),
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("visit.changed").replace("{table}", "4"));
    expect(banner(el)!.textContent).toContain(
      t("visit.changed_tables").replace("{tables}", "4, 9"),
    );
  });

  it("says the table changed, in general words, when a stale refusal names no party", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([{ ...mesa4, visit: null }]),
      moveTab: vi.fn().mockRejectedValue({ code: "visit.out_of_date" }),
    });
    const order = await openMesa(el);

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("visit.out_of_date"));
  });
});

describe("till-app: a table needing clearing", () => {
  it("marks it cleared at the revision it read and re-reads the floor", async () => {
    const { el } = await mountApp();
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "mark-cleared", { visitId: "v1", expectedVisitRevision: 6 });
    await flush(el);

    expect(api.markCleared).toHaveBeenCalledWith("v1", 6);
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });
});

describe("till-app: every table move sends the party revision it last read", () => {
  it.each([
    ["move-tab", { toTableId: "t9" }, "moveTab", ["wo-4", "t9", { expectedVisitRevision: 3 }]],
    ["join-table", { tableId: "t9" }, "joinTable", ["wo-4", "t9", { expectedVisitRevision: 3 }]],
    [
      "merge-tabs",
      { fromTabId: "wo-7", freeSourceTable: true },
      "mergeTabs",
      ["wo-4", "wo-7", true, { expectedVisitRevision: 3, expectedSourceVisitRevision: 9 }],
    ],
    [
      "transfer-lines",
      { toTabId: "wo-7", transfers: [{ lineNo: 1 }] },
      "transferLines",
      [
        "wo-4",
        "wo-7",
        [{ lineNo: 1 }],
        { expectedVisitRevision: 9, expectedSourceVisitRevision: 3 },
      ],
    ],
    [
      "split-lines",
      { transfers: [{ lineNo: 1 }] },
      "splitTab",
      ["wo-4", [{ lineNo: 1 }], { expectedVisitRevision: 3 }],
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
      expectedVisitRevision: 3,
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

    expect(api.moveTab).toHaveBeenCalledWith("wo-paid", "t9", { expectedVisitRevision: 3 });
    expect(banner(el)).toBeNull();
  });

  it("follows the round onto the party's next tab after its tab was paid", async () => {
    const { el } = await mountApp({ addTabRound: vi.fn().mockResolvedValue({ tabId: "wo-next" }) });
    const order = await openMesa(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(order, "send-round", { lines: [{ menuItemId: "flan", quantity: "1" }] });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-next");
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-next");
    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
  });
});

describe("till-app: a party's split-off bill left unpaid goes back with the party's revision", () => {
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
  const orderCard = (el: TillApp) =>
    tabGrid(el)?.shadowRoot?.querySelector<TillTableOrderScreen>("till-table-order-screen") ?? null;

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
      expectedVisitRevision: 4,
    });
    expect(banner(el)).toBeNull();
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
      expectedVisitRevision: 4,
    });
    expect(orderCard(el)!.orderId).toBe("wo-7");
  });

  it("keeps the bill held, without sending it again, when the party changed elsewhere first", async () => {
    const { el } = await mountApp({
      ...floorAcrossSplit(),
      mergeTabs: vi
        .fn()
        .mockRejectedValue({ code: "visit.out_of_date", visitId: "v1", revision: 6 }),
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
      .mockRejectedValueOnce({ code: "visit.out_of_date", visitId: "v1", revision: 5 })
      .mockResolvedValue(undefined);
    const { other, getTablesState } = floorThat([mesa4, mesa9], [moved, mesa5, mesa9]);
    const { el } = await mountApp({ moveTab, getTablesState });
    const order = await openMesa(el);
    other.acted = true;
    const billReads = vi.mocked(api.getVisitBills).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(order, "move-tab", { toTableId: "t9" });
    await flush(el);

    expect(moveTab).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.visit).toEqual(moved.visit);
    expect(api.getVisitBills).toHaveBeenCalledTimes(billReads + 1);
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    const text = banner(el)!.textContent!;
    expect(text).toContain(t("visit.changed").replace("{table}", "4"));
    expect(text).toContain(t("visit.changed_tables").replace("{tables}", "4, 5"));
    expect(text).toContain(t("visit.try_again"));

    emit(tableOrder(el)!, "move-tab", { toTableId: "t9" });
    await flush(el);
    expect(moveTab).toHaveBeenLastCalledWith("wo-4", "t9", { expectedVisitRevision: 5 });
  });

  it("names the bills and what is left to pay when those are what changed", async () => {
    const split = seated({}, { revision: 5, billCount: 2, outstanding: "44.00" });
    const reads = floorThat([mesa4], [split]);
    const { el } = await mountApp({
      splitTab: vi
        .fn()
        .mockRejectedValue({ code: "visit.out_of_date", visitId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(banner(el)!.textContent).toContain(
      t("visit.changed_bills").replace("{amount}", formatMoney("44.00", "en")),
    );
  });

  it("says the party has left the table when it is no longer there", async () => {
    const reads = floorThat([mesa4], [table()]);
    const { el } = await mountApp({
      finishTable: vi
        .fn()
        .mockRejectedValue({ code: "visit.out_of_date", visitId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "finish-table", {});
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("visit.changed_gone"));
  });

  it("says something else changed when its tables and bills read the same", async () => {
    const reads = floorThat([mesa4], [seated({}, { revision: 5 })]);
    const { el } = await mountApp({
      joinTable: vi
        .fn()
        .mockRejectedValue({ code: "visit.out_of_date", visitId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "join-table", { tableId: "t9" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("visit.changed_other"));
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
        .mockRejectedValue({ code: "visit.out_of_date", visitId: "v7", revision: 10 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "transfer-lines", { toTabId: "wo-7", transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("visit.changed").replace("{table}", "7"));
  });

  it("reloads the floor and says so when Mark cleared was stale", async () => {
    const { el } = await mountApp({
      markCleared: vi
        .fn()
        .mockRejectedValue({ code: "visit.out_of_date", visitId: "v1", revision: 7 }),
    });
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "mark-cleared", { visitId: "v1", expectedVisitRevision: 6 });
    await flush(el);

    expect(api.getTablesState).toHaveBeenCalledTimes(reads + 1);
    expect(banner(el)!.textContent).toContain(t("visit.changed").replace("{table}", "4"));
  });

  it.each([
    ["table.occupied", "move-tab", { toTableId: "t9" }, "moveTab"],
    ["table.occupied", "join-table", { tableId: "t9" }, "joinTable"],
    ["visit.not_open", "split-lines", { transfers: [{ lineNo: 1 }] }, "splitTab"],
  ] as const)("shows %s in its own words after %s", async (code, type, detail, method) => {
    const { el } = await mountApp({ [method]: vi.fn().mockRejectedValue({ code }) });
    const order = await openMesa(el);

    emit(order, type, detail);
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
  });
});

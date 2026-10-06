import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import {
  adjustmentStubs,
  cancelThroughDialog,
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { SUBMIT_RETRY_PAUSE_MS, TillApp } from "./till-app.js";
import { ServerRouter } from "./api/server-router.js";
import { formatMoney } from "@waitron/shared";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { TillUnpaidDepartureDialog } from "./widgets/unpaid-departure-dialog.js";
import type { TillCancelCreditDialog } from "./widgets/cancel-credit-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
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
    signals: [],
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
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
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
    tabLineCount: 3,
    tabTotal: "44.00",
    party: party(partyOver),
    ...over,
  });
}

const mesa4 = seated();
const mesa7 = seated(
  { id: "t7", label: "7" },
  { id: "v7", revision: 9, mainBillId: "wo-7", tableIds: ["t7"] },
);
const mesa9 = table({ id: "t9", label: "9" });

const tabBill: PartyBill = {
  workingOrderId: "wo-4",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "14.00",
  outstanding: "14.00",
  hasPayments: false,
  receiptAvailable: false,
};
const checkBill: PartyBill = {
  workingOrderId: "wo-check",
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  status: "open",
  total: "30.00",
  outstanding: "30.00",
  hasPayments: false,
  receiptAvailable: false,
};

const tabLine: TabLine = {
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
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "en",
      loginDefault: "en",
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
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: {
        ...offers.context,
        ...(overrides.zonePolicy as Partial<ZoneOfferCatalogue["context"]>),
      },
    }),
    listZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: {
        ...offers.context,
        ...(overrides.zonePolicy as Partial<ZoneOfferCatalogue["context"]>),
      },
    }),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
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
    moveGuests: vi.fn().mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: false }),
    joinTables: vi.fn().mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: false }),
    splitTable: vi.fn().mockResolvedValue({ partyId: "v-split", mainBillId: "wo-check" }),
    setPartyName: vi.fn().mockResolvedValue({ revision: 4, name: "Ana" }),
    mergeBills: vi.fn().mockResolvedValue(undefined),
    transferItems: vi.fn().mockResolvedValue(undefined),
    splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
    recordSale: vi.fn().mockResolvedValue(saleResult),
    collectOrder: vi.fn().mockResolvedValue(saleResult),
    moveBill: vi.fn().mockResolvedValue({ partyId: null, billId: "wo-check", merged: false }),
    reprint: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...adjustmentStubs(),
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

/** A recorded cancel's answer, naming the bill's party as `party`. */
const cancelAnswer = (party: { id: string; revision: number } | null) => ({
  adjustmentIds: ["a-1"],
  revision: 1,
  party,
});

/** Cancels `lineId` of the open order through its dialog. */
const cancelLine = (el: TillApp, order: TillTableOrderScreen, lineId = "line-1") =>
  cancelThroughDialog(el, order, lineId, () => flush(el));

/** How long a cancel that gets no answer is given to be sent again until it gives up. The resends
 * wait real time, which a loaded machine stretches past a fixed sleep; the poll returns once the
 * message shows. */
const GIVE_UP_MS = 10_000;

/** Waits for the message a cancel that got no answer leaves once its resends give up. */
const untilUnconfirmed = (el: TillApp) =>
  expect
    .poll(() => banner(el)?.textContent ?? "", { timeout: GIVE_UP_MS })
    .toContain(t("adjust.unconfirmed"));

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
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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
      { id: "t9", label: "9", tabLineCount: 0, tabTotal: "0.00" },
      { id: "v-new", revision: 0, mainBillId: "wo-new", outstanding: "0.00", tableIds: ["t9"] },
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

    emit(tableOrder(el)!, "join-tables", { tableId: "t4", bills: "merge" });
    await flush(el);
    expect(api.joinTables).toHaveBeenCalledWith("v-new", "t4", "merge", {
      expectedPartyRevision: 0,
      otherPartyId: null,
    });
  });

  it("says the table needs clearing when seating it is refused for that, and re-reads the floor", async () => {
    const { el } = await mountApp({
      seatTable: vi.fn().mockRejectedValue({ code: "table.needs_clearing", tableId: "t9" }),
    });
    const screen = await toFloor(el);
    const reads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(screen, "open-table", { tableId: "t9", seated: false, guestCount: null });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("table.needs_clearing"));
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

  it("says a bill owing nothing still holds money when Finish is refused for it, in its own words", async () => {
    const { el } = await mountApp({
      finishTable: vi.fn().mockRejectedValue({
        code: "bill.payments_received",
        status: 409,
        workingOrderId: "wo-check",
      }),
    });
    const order = await openMesa(el);
    const holding = { ...checkBill, total: "0.00", outstanding: "0.00", hasPayments: true };
    vi.mocked(api.getPartyBills).mockResolvedValue([tabBill, holding]);
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

    emit(order, "finish-table", {});
    await flush(el);

    const text = banner(el)!.textContent!;
    expect(text).toContain(
      "A bill on this table owes nothing but still holds money. Give it back before finishing the table",
    );
    expect(text).not.toContain(codeMessage("bill.payments_received"));
    expect(tableOrder(el)!.finishRefused).toBe(false);
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
    expect(tableOrder(el)!.bills).toEqual([tabBill, holding]);
  });

  it("shows the bill's new figures right after a dish is cancelled", async () => {
    const server = { voided: false };
    const cancelled = { ...tabBill, total: "9.00", outstanding: "9.00" };
    const { el } = await mountApp({
      applyAdjustment: vi.fn(async () => {
        server.voided = true;
        return cancelAnswer({ id: "v1", revision: 4 });
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

    await cancelLine(el, order);

    expect(figures(el)).toEqual(figuresOf("9.00", "39.00"));
  });

  it(
    "shows the new figures after a cancel that got no answer but reached the server",
    { timeout: 2 * GIVE_UP_MS },
    async () => {
      const server = { voided: false };
      const cancelled = { ...tabBill, total: "9.00", outstanding: "9.00" };
      const { el } = await mountApp({
        applyAdjustment: vi.fn(async () => {
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

      await cancelLine(el, order);
      await untilUnconfirmed(el);
      await flush(el);

      expect(figures(el)).toEqual(figuresOf("9.00", "39.00"));
    },
  );

  it("a refused cancel stays in its dialog, saying why, and reads nothing again", async () => {
    const { el } = await mountApp({
      applyAdjustment: vi.fn().mockRejectedValue({ code: "adjustment.quantity_invalid" }),
    });
    const order = await openMesa(el);
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    await cancelLine(el, order);

    const dialog = el.shadowRoot!.querySelector("till-adjustment-dialog")!;
    expect(
      dialog.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
    ).toBe(codeMessage("adjustment.quantity_invalid"));
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads);
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads);
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
  });

  it("says so when the floor cannot be read after a cancel, and still to pay follows the new bills", async () => {
    const server = { voided: false };
    const cancelled = { ...tabBill, total: "9.00", outstanding: "9.00" };
    const { el } = await mountApp({
      applyAdjustment: vi.fn(async () => {
        server.voided = true;
        return cancelAnswer({ id: "v1", revision: 4 });
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

    await cancelLine(el, order);

    expect(figures(el)).toEqual(figuresOf("9.00", "39.00"));
    expect(banner(el)!.textContent).toContain(t("table.reread_failed"));
  });

  it("says so when the bills cannot be read after a cancel", async () => {
    const server = { voided: false };
    const { el } = await mountApp({
      applyAdjustment: vi.fn(async () => {
        server.voided = true;
        return cancelAnswer({ id: "v1", revision: 4 });
      }),
      getPartyBills: vi.fn(async () => {
        if (server.voided) throw new TypeError("Failed to fetch");
        return [tabBill, checkBill];
      }),
    });
    const order = await openMesa(el);

    await cancelLine(el, order);

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
    // The till opens a table by its party's bills, so an order has no party only once the party
    // has left the table while its order is still on screen.
    const partyless = table({ state: "open-tab", hasOpenTab: true });
    const floor = { phase: "seated" as "seated" | "left" | "unreadable" };
    const { el } = await mountApp({
      applyAdjustment: vi.fn().mockResolvedValue(cancelAnswer(null)),
      getTablesState: vi.fn(async () => {
        if (floor.phase === "unreadable") throw new TypeError("Failed to fetch");
        return [floor.phase === "seated" ? mesa4 : partyless, mesa7, mesa9];
      }),
    });
    const order = await openMesa(el);
    floor.phase = "left";
    emit(order, "merge-bills", { fromBillId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.party).toBeNull();
    floor.phase = "unreadable";

    await cancelLine(el, tableOrder(el)!);

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
    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
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
    let answerVoid!: (answer: ReturnType<typeof cancelAnswer>) => void;
    const { el } = await mountApp({
      applyAdjustment: vi.fn(
        () =>
          new Promise((resolve) => {
            answerVoid = resolve;
          }),
      ),
    });
    const order = await openMesa(el);
    await cancelLine(el, order);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    expect(floor(el)).not.toBeNull();
    vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

    answerVoid(cancelAnswer({ id: "v1", revision: 4 }));
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

  it("asks which language a paid bill's receipt copy prints in, starting on the one it was filed in", async () => {
    const paid: PartyBill = {
      ...tabBill,
      workingOrderId: "wo-old",
      status: "settled",
      outstanding: "0.00",
      receiptAvailable: true,
      receiptLanguage: "ca-ES",
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        invoiceLocale: "eu-ES",
        receiptLanguages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      }),
      getPartyBills: vi.fn().mockResolvedValue([paid, checkBill]),
    });
    const order = await openMesa(el);

    emit(order, "reprint-bill", { workingOrderId: "wo-old" });
    await flush(el);

    expect(api.reprint).not.toHaveBeenCalled();
    const dialog = el.shadowRoot!.querySelector("till-reprint-language-dialog")!;
    const radio = (language: string) =>
      dialog.shadowRoot!.querySelector<HTMLInputElement>(`input[value="${language}"]`)!;
    expect(radio("ca-ES").checked).toBe(true);
    radio("es-ES").click();
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-reprint-confirm]")!.click();
    await flush(el);

    expect(vi.mocked(api.reprint).mock.calls).toEqual([["wo-old", "es-ES"]]);
    expect(el.shadowRoot!.querySelector("till-reprint-language-dialog")).toBeNull();
  });

  it("starts a paid bill's receipt copy on the location's language when the bill names none", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        invoiceLocale: "eu-ES",
        receiptLanguages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      }),
    });
    const order = await openMesa(el);

    emit(order, "reprint-bill", { workingOrderId: "wo-old" });
    await flush(el);

    const dialog = el.shadowRoot!.querySelector("till-reprint-language-dialog")!;
    expect(
      dialog.shadowRoot!.querySelector<HTMLInputElement>('input[value="eu-ES"]')!.checked,
    ).toBe(true);
  });

  it("starts a paid bill's receipt copy on the location's language when the bill's is not offered", async () => {
    const paid: PartyBill = {
      ...tabBill,
      workingOrderId: "wo-old",
      status: "settled",
      outstanding: "0.00",
      receiptAvailable: true,
      receiptLanguage: "en-GB",
    };
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        invoiceLocale: "eu-ES",
        receiptLanguages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      }),
      getPartyBills: vi.fn().mockResolvedValue([paid, checkBill]),
    });
    const order = await openMesa(el);

    emit(order, "reprint-bill", { workingOrderId: "wo-old" });
    await flush(el);

    const dialog = el.shadowRoot!.querySelector("till-reprint-language-dialog")!;
    expect(
      dialog.shadowRoot!.querySelector<HTMLInputElement>('input[value="eu-ES"]')!.checked,
    ).toBe(true);
  });

  it("prints a paid bill's receipt copy at once when there is one receipt language", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, receiptLanguages: ["es-ES"] }),
    });
    const order = await openMesa(el);

    emit(order, "reprint-bill", { workingOrderId: "wo-old" });
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-reprint-language-dialog")).toBeNull();
    expect(vi.mocked(api.reprint).mock.calls).toEqual([["wo-old"]]);
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

/** An API method whose answer waits until the test settles or refuses it. */
function held() {
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
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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
    ["split-lines", { transfers: [{ lineNo: 1 }] }, "splitBill", { billId: "wo-check" }],
    [
      "join-tables",
      { tableId: "t9", bills: "merge" },
      "joinTables",
      { partyId: "v1", mainBillId: "wo-4", merged: false },
    ],
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
      emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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

  describe("a table action's answer once the waiter has gone to the floor tab", () => {
    const onPhone = (canvas: CanvasDef = phone) => ({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", formFactor: "phone-portrait", stationId: null }),
    });
    const withCounter: CanvasDef = {
      ...phone,
      tabs: [
        ...phone.tabs,
        {
          key: "counter",
          title: "Counter",
          columns: 12,
          cards: [{ type: "product-grid", colSpan: 12, rowSpan: 8, config: {} }],
        },
      ],
    };
    const activeTab = (el: TillApp) =>
      (shell(el) as HTMLElement & { activeTabKey?: string }).activeTabKey;
    async function selectTab(el: TillApp, key: string): Promise<void> {
      emit(shell(el), "tab-select", { key });
      await flush(el);
    }
    async function openOnPhone(el: TillApp, tableId = "t4"): Promise<TillTableOrderScreen> {
      await flush(el);
      emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      emit(shell(el), "open-table", { tableId, seated: true });
      await flush(el);
      return orderCard(el)!;
    }

    it("Finish clears the finished party from the order tab", async () => {
      const { call, answer } = held();
      const { el } = await mountApp({ ...onPhone(), finishTable: call });
      emit(await openOnPhone(el), "finish-table", {});
      await flush(el);
      await selectTab(el, "floor");

      answer.settle({ state: "closed" });
      await flush(el);
      await selectTab(el, "order");

      expect(call).toHaveBeenCalledWith("v1", 3);
      expect(orderCard(el)!.party).toBeNull();
      expect(orderCard(el)!.orderId).toBeUndefined();
    });

    it("Finish, with an open of another table under way that then fails, clears the finished party from the order tab", async () => {
      const { call, answer } = held();
      const offersRead = held();
      const { el } = await mountApp({ ...onPhone(), finishTable: call });
      emit(await openOnPhone(el), "finish-table", {});
      await flush(el);
      await selectTab(el, "floor");
      vi.mocked(api.listZoneOffers).mockImplementation(offersRead.call as never);
      emit(shell(el), "open-table", { tableId: "t7", seated: true });
      await flush(el);

      answer.settle({ state: "closed" });
      await flush(el);
      offersRead.answer.refuse(new TypeError("Failed to fetch"));
      await flush(el);
      await selectTab(el, "order");

      expect(offersRead.call).toHaveBeenCalledOnce();
      expect(orderCard(el)!.party).toBeNull();
      expect(orderCard(el)!.orderId).toBeUndefined();
    });

    it("Finish, answering once the waiter has moved on from the floor tab to the counter, stays on the counter and clears the finished party", async () => {
      const { call, answer } = held();
      const { el } = await mountApp({ ...onPhone(withCounter), finishTable: call });
      emit(await openOnPhone(el), "finish-table", {});
      await flush(el);
      await selectTab(el, "floor");
      await selectTab(el, "counter");

      answer.settle({ state: "closed" });
      await flush(el);

      expect(call).toHaveBeenCalledOnce();
      expect(activeTab(el)).toBe("counter");
      await selectTab(el, "order");
      expect(orderCard(el)!.party).toBeNull();
      expect(orderCard(el)!.orderId).toBeUndefined();
    });

    it("Move guests: back on the order tab, the screen has followed the guests into the other party, and the floor tab said nothing about the bills", async () => {
      const { call, answer } = held();
      const mesa9Seated = seated(
        { id: "t9", label: "9" },
        { id: "v9", revision: 1, mainBillId: "wo-9", tableIds: ["t9"] },
      );
      let moved = false;
      const { el } = await mountApp({
        ...onPhone(),
        getTablesState: vi.fn(async () =>
          moved ? [table(), mesa7, mesa9Seated] : [mesa4, mesa7, mesa9Seated],
        ),
        moveGuests: call,
      });
      emit(await openOnPhone(el), "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);
      await selectTab(el, "floor");

      moved = true;
      answer.settle({ partyId: "v9", mainBillId: "wo-9", merged: false });
      await flush(el);
      expect(banner(el)).toBeNull();
      await selectTab(el, "order");

      expect(call).toHaveBeenCalledOnce();
      expect(orderCard(el)!.party?.id).toBe("v9");
      expect(orderCard(el)!.orderId).toBe("wo-9");
      expect(banner(el)).toBeNull();
    });

    it("Join a seated table: the floor tab is read again and shows the tables joined, with nothing said about the bills there", async () => {
      const { call, answer } = held();
      const mesa9Seated = seated(
        { id: "t9", label: "9" },
        { id: "v9", revision: 1, mainBillId: "wo-9", tableIds: ["t9"] },
      );
      const joinedAtFour = seated({}, { revision: 4, tableIds: ["t4", "t9"] });
      const joinedAtNine = seated(
        { id: "t9", label: "9" },
        { revision: 4, tableIds: ["t4", "t9"] },
      );
      let joined = false;
      const { el } = await mountApp({
        ...onPhone(),
        getTablesState: vi.fn(async () =>
          joined ? [joinedAtFour, mesa7, joinedAtNine] : [mesa4, mesa7, mesa9Seated],
        ),
        joinTables: call,
      });
      emit(await openOnPhone(el), "join-tables", { tableId: "t9", bills: "merge" });
      await flush(el);
      await selectTab(el, "floor");
      const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

      joined = true;
      answer.settle({ partyId: "v1", mainBillId: "wo-4", merged: false });
      await flush(el);

      expect(call).toHaveBeenCalledOnce();
      expect(vi.mocked(api.getTablesState).mock.calls.length).toBeGreaterThan(floorReads);
      expect(floor(el)!.tables).toEqual([joinedAtFour, mesa7, joinedAtNine]);
      expect(banner(el)).toBeNull();
    });

    it("Split items onto a new bill: back on the order tab, the new bill is on screen", async () => {
      const { call, answer } = held();
      const { el } = await mountApp({ ...onPhone(), splitBill: call });
      emit(await openOnPhone(el), "split-lines", { transfers: [{ lineNo: 1 }] });
      await flush(el);
      await selectTab(el, "floor");

      answer.settle({ billId: "wo-check" });
      await flush(el);
      await selectTab(el, "order");

      expect(call).toHaveBeenCalledOnce();
      expect(orderCard(el)!.orderId).toBe("wo-check");
    });

    it("Split a table taking the bill on screen: back on the order tab, a bill of this party is on screen, not the one that left", async () => {
      const atTwo = seated({}, { tableIds: ["t4", "t5"] });
      const mesa5 = seated({ id: "t5", label: "5" }, { tableIds: ["t4", "t5"] });
      const remaining: PartyBill = { ...tabBill, workingOrderId: "remaining-a" };
      let split = false;
      let heldRead = false;
      let release: () => void = () => undefined;
      const { el } = await mountApp({
        ...onPhone(),
        getTablesState: vi.fn(async () =>
          split
            ? [seated({}, { revision: 4, mainBillId: null, tableIds: ["t4"] }), mesa7]
            : [atTwo, mesa5, mesa7],
        ),
        getPartyBills: vi.fn(() => {
          if (!split) return Promise.resolve([tabBill, checkBill]);
          heldRead = true;
          return new Promise<PartyBill[]>((resolve) => (release = () => resolve([remaining])));
        }),
        splitTable: vi.fn(async () => {
          split = true;
          return { partyId: "v-split", mainBillId: "wo-check" };
        }),
      });
      emit(await openOnPhone(el), "split-lines", { transfers: [{ lineNo: 1 }] });
      await flush(el);
      expect(orderCard(el)!.orderId).toBe("wo-check");
      emit(orderCard(el)!, "split-table", { tableId: "t5", billId: "wo-check" });
      await flush(el);
      expect(heldRead).toBe(true);
      await selectTab(el, "floor");

      release();
      await flush(el);
      await selectTab(el, "order");

      expect(api.splitTable).toHaveBeenCalledOnce();
      expect(orderCard(el)!.orderId).toBe("remaining-a");
    });
  });
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
      emit(first, "join-tables", { tableId: "t9", bills: "merge" });
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
      moveGuests: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
    expect(banner(el)!.textContent).toContain(
      t("party.changed_tables").replace("{tables}", "4, 9"),
    );
  });

  it("says the table changed, in general words, when a stale refusal names a party the floor did not show", async () => {
    const { el } = await mountApp({
      moveGuests: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v-seated-since", revision: 0 }),
    });
    const order = await openMesa(el);

    emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("party.out_of_date"));
  });
});

describe("till-app: table actions on the party", () => {
  it("moves the party to a free table, sending its revision and that it read the table free, and follows it there", async () => {
    const atNine = seated({ id: "t9", label: "9" }, { revision: 4, tableIds: ["t9"] });
    const reads = floorThat([mesa4, mesa7, mesa9], [table(), mesa7, atNine]);
    const { el } = await mountApp({ getTablesState: reads.getTablesState });
    const order = await openMesa(el);
    reads.other.acted = true;
    const readsBefore = vi.mocked(api.getTablesState).mock.calls.length;

    emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);

    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: null,
    });
    expect(vi.mocked(api.getTablesState).mock.calls.length).toBeGreaterThan(readsBefore);
    expect(tableOrder(el)!.party).toEqual(atNine.party);
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(banner(el)).toBeNull();
  });

  it("sends the other party's id and revision when the guests move to a seated table, follows them into it, and says when the bills stayed apart", async () => {
    const combined = seated(
      { id: "t7", label: "7" },
      { id: "v7", revision: 10, mainBillId: "wo-7", tableIds: ["t7"] },
    );
    const reads = floorThat([mesa4, mesa7, mesa9], [table(), combined, mesa9]);
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      moveGuests: vi.fn(async () => {
        reads.other.acted = true;
        return { partyId: "v7", mainBillId: "wo-7", merged: false };
      }),
    });
    const order = await openMesa(el);

    emit(order, "move-guests", { toTableId: "t7", bills: "merge" });
    await flush(el);

    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t7", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: "v7",
      expectedOtherPartyRevision: 9,
    });
    expect(tableOrder(el)!.party).toEqual(combined.party);
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(api.getPartyBills).toHaveBeenLastCalledWith("v7");
    expect(banner(el)!.textContent).toContain(t("table.bills_kept_separate"));
  });

  it("opens the first unpaid bill of the party the guests moved into when it has no main bill", async () => {
    const combined = seated(
      { id: "t7", label: "7" },
      { id: "v7", revision: 10, mainBillId: null, tableIds: ["t7"] },
    );
    const reads = floorThat([mesa4, mesa7, mesa9], [table(), combined, mesa9]);
    const luisBill: PartyBill = { ...checkBill, workingOrderId: "wo-luis", partyId: "v7" };
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      getPartyBills: vi.fn(async (partyId: string) =>
        partyId === "v7"
          ? [{ ...tabBill, workingOrderId: "wo-7", status: "placed" }, luisBill]
          : [tabBill],
      ),
      moveGuests: vi.fn(async () => {
        reads.other.acted = true;
        return { partyId: "v7", mainBillId: null, merged: false };
      }),
    });
    const order = await openMesa(el);

    emit(order, "move-guests", { toTableId: "t7", bills: "separate" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(tableOrder(el)!.party).toEqual(combined.party);
  });

  it.each([
    ["merged", "merge", true],
    ["kept apart when asked to", "separate", false],
  ] as const)("says nothing about the bills when they %s", async (_how, bills, merged) => {
    const { el } = await mountApp({
      moveGuests: vi.fn().mockResolvedValue({ partyId: "v7", mainBillId: "wo-7", merged }),
    });
    const order = await openMesa(el);

    emit(order, "move-guests", { toTableId: "t7", bills });
    await flush(el);

    expect(api.moveGuests).toHaveBeenCalledOnce();
    expect(banner(el)).toBeNull();
  });

  it("joins a free table with the party's revision, and a seated one with the other party's too", async () => {
    const { el } = await mountApp({
      joinTables: vi
        .fn()
        .mockResolvedValueOnce({ partyId: "v1", mainBillId: "wo-4", merged: false })
        .mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: false }),
    });
    const order = await openMesa(el);

    emit(order, "join-tables", { tableId: "t9", bills: "merge" });
    await flush(el);
    emit(tableOrder(el)!, "join-tables", { tableId: "t7", bills: "merge" });
    await flush(el);

    expect(api.joinTables).toHaveBeenNthCalledWith(1, "v1", "t9", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: null,
    });
    expect(api.joinTables).toHaveBeenNthCalledWith(2, "v1", "t7", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: "v7",
      expectedOtherPartyRevision: 9,
    });
    expect(banner(el)!.textContent).toContain(t("table.bills_kept_separate"));
    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it("sends a move to one of the party's own tables without another party's read", async () => {
    const atTwo = seated({}, { tableIds: ["t4", "t5"] });
    const mesa5 = seated({ id: "t5", label: "5" }, { tableIds: ["t4", "t5"] });
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([atTwo, mesa5, mesa7, mesa9]),
    });
    const order = await openMesa(el);

    emit(order, "move-guests", { toTableId: "t5", bills: "merge" });
    await flush(el);

    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t5", "merge", { expectedPartyRevision: 3 });
  });

  it("splits a table off with the chosen bill, or none, and stays with the party at its other table", async () => {
    const atTwo = seated({}, { tableIds: ["t4", "t5"] });
    const mesa5 = seated({ id: "t5", label: "5" }, { tableIds: ["t4", "t5"] });
    const afterSplit = [
      seated({}, { revision: 4, tableIds: ["t4"] }),
      seated({ id: "t5", label: "5" }, { id: "v-split", revision: 0, tableIds: ["t5"] }),
      mesa7,
      mesa9,
    ];
    const reads = floorThat([atTwo, mesa5, mesa7, mesa9], afterSplit);
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      splitTable: vi.fn(async () => {
        reads.other.acted = true;
        return { partyId: "v-split", mainBillId: "wo-check" };
      }),
    });
    const order = await openMesa(el, "t5");

    emit(order, "split-table", { tableId: "t5", billId: "wo-check" });
    await flush(el);

    expect(api.splitTable).toHaveBeenCalledWith("v1", "t5", "wo-check", 3);
    expect(tableOrder(el)!.party).toEqual(afterSplit[0]!.party);

    emit(tableOrder(el)!, "split-table", { tableId: "t4", billId: null });
    await flush(el);
    expect(api.splitTable).toHaveBeenLastCalledWith("v1", "t4", null, 4);
  });

  it("opens the party's main bill once the bill on screen has gone with the table split off", async () => {
    const atTwo = seated({}, { tableIds: ["t4", "t5"] });
    const mesa5 = seated({ id: "t5", label: "5" }, { tableIds: ["t4", "t5"] });
    const reads = floorThat(
      [atTwo, mesa5, mesa7, mesa9],
      [seated({}, { revision: 4, tableIds: ["t4"] }), mesa7, mesa9],
    );
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      splitTable: vi.fn(async () => {
        reads.other.acted = true;
        return { partyId: "v-split", mainBillId: "wo-check" };
      }),
    });
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");

    emit(tableOrder(el)!, "split-table", { tableId: "t5", billId: "wo-check" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it.each([
    ["table.needs_clearing", "move-guests", { toTableId: "t9", bills: "merge" }, "moveGuests"],
    ["table.already_in_party", "join-tables", { tableId: "t9", bills: "merge" }, "joinTables"],
    ["table.inactive", "move-guests", { toTableId: "t9", bills: "merge" }, "moveGuests"],
    [
      "service_zone.mode_incompatible",
      "move-guests",
      { toTableId: "t9", bills: "merge" },
      "moveGuests",
    ],
    ["service_zone.join_mismatch", "join-tables", { tableId: "t9", bills: "merge" }, "joinTables"],
    ["party.not_open", "join-tables", { tableId: "t9", bills: "merge" }, "joinTables"],
    ["table.not_shared", "split-table", { tableId: "t4", billId: null }, "splitTable"],
    ["table.not_joined", "split-table", { tableId: "t9", billId: null }, "splitTable"],
    ["party.main_bill_stays", "split-table", { tableId: "t4", billId: "wo-4" }, "splitTable"],
    ["group.held_leaves_party", "split-table", { tableId: "t4", billId: "wo-check" }, "splitTable"],
    ["party.not_open", "name-party", { name: "Ana" }, "setPartyName"],
  ] as const)("shows %s in its own words after %s", async (code, type, detail, method) => {
    const { el } = await mountApp({ [method]: vi.fn().mockRejectedValue({ code }) });
    const order = await openMesa(el);

    emit(order, type, detail);
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
  });

  it.each([
    ["merge-bills", { fromBillId: "wo-check" }, "mergeBills"],
    ["transfer-lines", { toBillId: "wo-check", transfers: [{ lineNo: 1 }] }, "transferItems"],
  ] as const)(
    "says the two bills are served differently when %s is refused for their service modes",
    async (type, detail, method) => {
      const { el } = await mountApp({
        [method]: vi.fn().mockRejectedValue({ code: "service_zone.mode_incompatible" }),
      });
      const order = await openMesa(el);

      emit(order, type, detail);
      await flush(el);

      expect(banner(el)!.textContent).toContain(t("table.bills_served_differently"));
      expect(banner(el)!.textContent).not.toContain(codeMessage("service_zone.mode_incompatible"));
    },
  );

  it("names the party at the revision it read, and the floor then shows the name", async () => {
    const named = seated({}, { revision: 4, name: "Ana", displayName: "Ana" });
    const reads = floorThat([mesa4, mesa7, mesa9], [named, mesa7, mesa9]);
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      setPartyName: vi.fn(async () => {
        reads.other.acted = true;
        return { revision: 4, name: "Ana" };
      }),
    });
    const order = await openMesa(el);

    emit(order, "name-party", { name: "Ana" });
    await flush(el);
    expect(api.setPartyName).toHaveBeenCalledWith("v1", "Ana", 3);
    expect(tableOrder(el)!.party).toEqual(named.party);

    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    const card = floor(el)!.shadowRoot!.querySelector('[data-table="t4"] [data-party-name]');
    expect(card!.textContent!.trim()).toBe("Ana");
  });

  it("clears the name with null", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);

    emit(order, "name-party", { name: null });
    await flush(el);

    expect(api.setPartyName).toHaveBeenCalledWith("v1", null, 3);
  });

  it("hands a refusal of the name back to the screen, beside the field, without a banner", async () => {
    const { el } = await mountApp({
      setPartyName: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", field: "name" }),
    });
    const order = await openMesa(el);

    emit(order, "name-party", { name: "Ana" });
    await flush(el);

    expect(tableOrder(el)!.nameRefusal).toEqual({
      name: "Ana",
      message: t("table.name_too_long"),
    });
    expect(banner(el)).toBeNull();
  });

  it("does not hand a refused name to the next table opened", async () => {
    const { el } = await mountApp({
      setPartyName: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", field: "name" }),
    });
    const order = await openMesa(el);
    emit(order, "name-party", { name: "Ana" });
    await flush(el);

    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    expect(tableOrder(el)!.nameRefusal).toBeNull();
  });

  it("drops a refusal of the name that arrives after the waiter has opened another party's table", async () => {
    let refuse!: (reason: unknown) => void;
    const { el } = await mountApp({
      setPartyName: vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            refuse = reject;
          }),
      ),
    });
    const order = await openMesa(el);
    emit(order, "name-party", { name: "Ana" });
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    refuse({ code: "management.request_invalid", field: "name" });
    await flush(el);

    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(tableOrder(el)!.nameRefusal).toBeNull();
    expect(tableOrder(el)!.shadowRoot!.querySelector("till-party-name-dialog")).toBeNull();
    expect(api.setPartyName).toHaveBeenCalledOnce();
    expect(banner(el)).toBeNull();
  });

  it("reloads and says what changed when another device changed the party before the name arrived", async () => {
    const reads = floorThat([mesa4], [seated({}, { revision: 5, tableIds: ["t4", "t9"] }), mesa9]);
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      setPartyName: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "name-party", { name: "Ana" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(
      t("party.changed_tables").replace("{tables}", "4, 9"),
    );
  });
});

describe("till-app: a table action's answer once the waiter has opened another party", () => {
  const mesa9Seated = seated(
    { id: "t9", label: "9" },
    { id: "v9", revision: 1, mainBillId: "wo-9", tableIds: ["t9"] },
  );
  const bill7: PartyBill = { ...tabBill, workingOrderId: "wo-7", partyId: "v7" };

  it.each([
    {
      action: "Move guests to a seated table",
      method: "moveGuests",
      event: "move-guests",
      detail: { toTableId: "t9", bills: "merge" },
      answer: { partyId: "v9", mainBillId: "wo-9", merged: false },
    },
    {
      action: "Join a seated table",
      method: "joinTables",
      event: "join-tables",
      detail: { tableId: "t9", bills: "merge" },
      answer: { partyId: "v1", mainBillId: "wo-4", merged: false },
    },
    {
      action: "Split items onto a new bill",
      method: "splitBill",
      event: "split-lines",
      detail: { transfers: [{ lineNo: 1 }] },
      answer: { billId: "wo-check" },
    },
    {
      action: "Finish table",
      method: "finishTable",
      event: "finish-table",
      detail: {},
      answer: { state: "closed" },
    },
  ])("$action: an answer arriving late leaves the other party's screen as it is", async (c) => {
    const { call, answer } = held();
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9Seated]),
      getPartyBills: vi.fn((partyId: string) =>
        Promise.resolve(partyId === "v7" ? [bill7] : [tabBill, checkBill]),
      ),
      [c.method]: call,
    });
    const order = await openMesa(el);
    emit(order, c.event, c.detail);
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");

    answer.settle(c.answer);
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(tableOrder(el)?.party?.id).toBe("v7");
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(tableOrder(el)!.bills).toEqual([bill7]);
    expect(banner(el)).toBeNull();
  });

  it("a refusal of Finish for a bill still unpaid, arriving late, offers no payment on the other party", async () => {
    const { call, answer } = held();
    const { el } = await mountApp({ finishTable: call });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    answer.refuse({ code: "party.bill_outstanding" });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(tableOrder(el)!.finishRefused).toBe(false);
    expect(banner(el)).toBeNull();
  });

  it("a refusal of Finish for a bill still holding money, arriving late, says nothing on the other party", async () => {
    const { call, answer } = held();
    const { el } = await mountApp({ finishTable: call });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);

    answer.refuse({ code: "bill.payments_received", status: 409, workingOrderId: "wo-9" });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(banner(el)).toBeNull();
  });

  it.each([
    {
      read: "the floor",
      answer: { partyId: "v9", mainBillId: "wo-9", merged: false },
      holds: (method: string, partyId?: string) => method === "getTablesState" && !partyId,
    },
    {
      read: "the bills it opens one of",
      answer: { partyId: "v9", mainBillId: null, merged: false },
      holds: (method: string, partyId?: string) => method === "getPartyBills" && partyId === "v9",
    },
    {
      read: "the bills it says the merge from",
      answer: { partyId: "v9", mainBillId: "wo-9", merged: false },
      holds: (method: string, partyId?: string) => method === "getPartyBills" && partyId === "v9",
    },
  ])(
    "Move guests: $read, read after the answer and answering once the waiter has opened another party, changes nothing",
    async (c) => {
      let holding = false;
      let release: () => void = () => undefined;
      /** Once `holding`, the first read `c.holds` picks waits for `release`. */
      function answer<T>(method: string, value: () => T, partyId?: string): Promise<T> {
        if (!holding || !c.holds(method, partyId)) return Promise.resolve(value());
        holding = false;
        return new Promise<T>((resolve) => (release = () => resolve(value())));
      }
      let moved = false;
      const { el } = await mountApp({
        getTablesState: vi.fn(() =>
          answer("getTablesState", () =>
            moved ? [mesa7, mesa9Seated] : [mesa4, mesa7, mesa9Seated],
          ),
        ),
        getPartyBills: vi.fn((partyId: string) =>
          answer(
            "getPartyBills",
            () => (partyId === "v7" ? [bill7] : [tabBill, checkBill]),
            partyId,
          ),
        ),
        moveGuests: vi.fn(async () => {
          moved = true;
          holding = true;
          return c.answer;
        }),
      });
      const order = await openMesa(el);
      emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-7");

      release();
      await flush(el);

      expect(tableOrder(el)!.party?.id).toBe("v7");
      expect(tableOrder(el)!.orderId).toBe("wo-7");
      expect(banner(el)).toBeNull();
    },
  );

  it("Move guests answering after the waiter came back to the same party still follows the guests", async () => {
    const { call, answer } = held();
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, mesa7, mesa9Seated]),
      moveGuests: call,
    });
    const order = await openMesa(el);
    emit(order, "move-guests", { toTableId: "t9", bills: "separate" });
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);

    answer.settle({ partyId: "v9", mainBillId: "wo-9", merged: false });
    await flush(el);

    expect(tableOrder(el)!.party?.id).toBe("v9");
    expect(tableOrder(el)!.orderId).toBe("wo-9");
  });

  it("Join a seated table: an answer arriving after the waiter opened that table leaves it as opened, saying nothing about the bills", async () => {
    const { call, answer } = held();
    const bill9: PartyBill = { ...tabBill, workingOrderId: "wo-9", partyId: "v9" };
    const joinedAtFour = seated({}, { revision: 4, tableIds: ["t4", "t9"] });
    const joinedAtNine = seated({ id: "t9", label: "9" }, { revision: 4, tableIds: ["t4", "t9"] });
    let joined = false;
    const { el } = await mountApp({
      getTablesState: vi.fn(async () =>
        joined ? [joinedAtFour, mesa7, joinedAtNine] : [mesa4, mesa7, mesa9Seated],
      ),
      getPartyBills: vi.fn((partyId: string) =>
        Promise.resolve(partyId === "v9" ? [bill9] : [tabBill, checkBill]),
      ),
      joinTables: call,
    });
    const order = await openMesa(el);
    emit(order, "join-tables", { tableId: "t9", bills: "merge" });
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-9");

    joined = true;
    answer.settle({ partyId: "v1", mainBillId: "wo-4", merged: false });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party?.id).toBe("v9");
    expect(tableOrder(el)!.orderId).toBe("wo-9");
    expect(tableOrder(el)!.bills).toEqual([bill9]);
    expect(banner(el)).toBeNull();
  });

  it("Move guests into another party, with the floor unreadable after the answer, still opens that party's bill and says the bills stayed apart", async () => {
    let moved = false;
    const { el } = await mountApp({
      getTablesState: vi.fn(async () => {
        if (moved) throw new TypeError("Failed to fetch");
        return [mesa4, mesa7, mesa9];
      }),
      moveGuests: vi.fn(async () => {
        moved = true;
        return { partyId: "v7", mainBillId: "wo-7", merged: false };
      }),
    });
    const order = await openMesa(el);

    emit(order, "move-guests", { toTableId: "t7", bills: "merge" });
    await flush(el);

    await expect(vi.mocked(api.getTablesState).mock.results.at(-1)!.value).rejects.toThrow();
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(banner(el)!.textContent).toContain(t("table.bills_kept_separate"));
  });

  it("Finish answering after the waiter logged out leaves the till locked", async () => {
    const { call, answer } = held();
    const { el } = await mountApp({ finishTable: call });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    emit(tableOrder(el)!, "logout");
    await flush(el);
    expect(lock(el)).not.toBeNull();
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

    answer.settle({ state: "closed" });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
    expect(lock(el)).not.toBeNull();
  });

  it("Finish answering after the till moved to another server leaves the till locked", async () => {
    const { call, answer } = held();
    const data = new Map<string, string>();
    const router = new ServerRouter({
      origin: "https://box.deli.test",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
    });
    api = stubApi({ finishTable: call });
    const { el } = await mountWidget<TillApp>("till-app", { api, router });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    router.dispatchEvent(
      new CustomEvent("server-changed", {
        detail: { from: "https://box.deli.test", to: "https://cloud.deli.test" },
      }),
    );
    await flush(el);
    expect(lock(el)).not.toBeNull();
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

    answer.settle({ state: "closed" });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
    expect(lock(el)).not.toBeNull();
  });

  it("Move guests answering while a free table is being seated leaves that table the one on screen", async () => {
    const moved = held();
    const seating = held();
    const { el } = await mountApp({
      moveGuests: moved.call,
      seatTable: seating.call,
      setTableStatus: vi.fn().mockResolvedValue(undefined),
    });
    const order = await openMesa(el);
    emit(order, "move-guests", { toTableId: "t7", bills: "merge" });
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);

    moved.answer.settle({ partyId: "v7", mainBillId: "wo-7", merged: false });
    await flush(el);
    seating.answer.settle({ partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 });
    await flush(el);
    emit(tableOrder(el)!, "set-status", { statusId: "s1" });
    await flush(el);

    expect(moved.call).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.orderId).toBe("wo-new");
    expect(api.setTableStatus).toHaveBeenCalledWith("t9", "s1");
  });

  it("Finish answering while a free table is being seated leaves that table the one on screen", async () => {
    const finished = held();
    const seating = held();
    const { el } = await mountApp({
      finishTable: finished.call,
      seatTable: seating.call,
      setTableStatus: vi.fn().mockResolvedValue(undefined),
    });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t9", seated: false, guestCount: 2 });
    await flush(el);

    finished.answer.settle({ state: "closed" });
    await flush(el);
    seating.answer.settle({ partyId: "v-new", tabId: "wo-new", revision: 0, orderNumber: 12 });
    await flush(el);
    emit(tableOrder(el)!, "set-status", { statusId: "s1" });
    await flush(el);

    expect(finished.call).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.orderId).toBe("wo-new");
    expect(api.setTableStatus).toHaveBeenCalledWith("t9", "s1");
  });

  it("Join answering after the waiter logged out reads nothing more", async () => {
    const { call, answer } = held();
    const { el } = await mountApp({ joinTables: call });
    const order = await openMesa(el);
    emit(order, "join-tables", { tableId: "t9", bills: "merge" });
    await flush(el);
    emit(tableOrder(el)!, "logout");
    await flush(el);
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    answer.settle({ partyId: "v1", mainBillId: "wo-4", merged: false });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads);
    expect(lock(el)).not.toBeNull();
  });

  it("Finish answering once a till is back on the floor reads the floor again", async () => {
    const { call, answer } = held();
    let finished = false;
    const { el } = await mountApp({
      getTablesState: vi.fn(async () =>
        finished ? [table(), mesa7, mesa9] : [mesa4, mesa7, mesa9],
      ),
      finishTable: call,
    });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);

    finished = true;
    answer.settle({ state: "closed" });
    await flush(el);

    expect(call).toHaveBeenCalledOnce();
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)!.tables).toEqual([table(), mesa7, mesa9]);
  });

  it("Split a table: the party's bills, read after the answer and answering once the waiter has opened another party, leave that party's bill on screen", async () => {
    const atTwo = seated({}, { tableIds: ["t4", "t5"] });
    const mesa5 = seated({ id: "t5", label: "5" }, { tableIds: ["t4", "t5"] });
    const remaining: PartyBill = { ...tabBill, workingOrderId: "remaining-a" };
    let split = false;
    let heldRead = false;
    let release: () => void = () => undefined;
    const { el } = await mountApp({
      getTablesState: vi.fn(async () =>
        split
          ? [seated({}, { revision: 4, mainBillId: null, tableIds: ["t4"] }), mesa7]
          : [atTwo, mesa5, mesa7],
      ),
      getPartyBills: vi.fn((partyId: string) => {
        if (partyId === "v7") return Promise.resolve([bill7]);
        if (!split) return Promise.resolve([tabBill, checkBill]);
        heldRead = true;
        return new Promise<PartyBill[]>((resolve) => (release = () => resolve([remaining])));
      }),
      splitTable: vi.fn(async () => {
        split = true;
        return { partyId: "v-split", mainBillId: "wo-check" };
      }),
    });
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    emit(tableOrder(el)!, "split-table", { tableId: "t5", billId: "wo-check" });
    await flush(el);
    expect(heldRead).toBe(true);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");

    release();
    await flush(el);

    expect(tableOrder(el)!.party?.id).toBe("v7");
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(tableOrder(el)!.bills).toEqual([bill7]);
  });
});

describe("till-app: moving a bill", () => {
  const heldRows = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement & { heldOrders: unknown[] }>("till-counter-screen")
      ?.heldOrders ?? null;

  it("asks where to make a bill's dish before moving it to the counter", async () => {
    const askOrderDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      revision: 3,
      deadEnds: [
        {
          key: "line-1",
          name: "Café",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const setMakeAt = vi.fn().mockResolvedValue({ revision: 4 });
    const moveBill = vi
      .fn()
      .mockResolvedValue({ partyId: null, billId: "wo-check", merged: false });
    const { el } = await mountApp({ askOrderDeadEnds, setMakeAt, moveBill });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "move-bill", { to: { counter: true }, bills: "separate" });
    await flush(el);
    expect(askOrderDeadEnds).toHaveBeenCalledWith("wo-check", zone.id);
    expect(moveBill).not.toHaveBeenCalled();
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(
        new CustomEvent("make-at", { detail: { key: "line-1", stationId: "kitchen" } }),
      );
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(setMakeAt).toHaveBeenCalledWith("wo-check", 3, { "line-1": "kitchen" });
    expect(moveBill).toHaveBeenCalledOnce();
  });

  it("rechecks a table bill move after its replacement station closes", async () => {
    const askOrderDeadEnds = vi
      .fn()
      .mockResolvedValueOnce({ sends: false, deadEnds: [], stations: [] })
      .mockResolvedValue({
        sends: true,
        revision: 3,
        deadEnds: [
          {
            key: "line-1",
            name: "Café",
            quantity: "1",
            stationId: "bar",
            stationName: "Bar",
            why: "closed",
          },
        ],
        stations: [{ id: "kitchen", name: "Kitchen", open: true }],
      });
    const setMakeAt = vi.fn().mockResolvedValue({ revision: 4 });
    const moveBill = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue({ partyId: null, billId: "wo-check", merged: false });
    const { el } = await mountApp({ askOrderDeadEnds, setMakeAt, moveBill });
    const order = await openMesa(el);
    emit(order, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);
    expect(askOrderDeadEnds).toHaveBeenCalledTimes(2);
    expect(moveBill).toHaveBeenCalledOnce();
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(dialog).not.toBeNull();
    dialog
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(
        new CustomEvent("make-at", { detail: { key: "line-1", stationId: "kitchen" } }),
      );
    await (dialog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(setMakeAt).toHaveBeenCalledOnce();
    expect(moveBill).toHaveBeenCalledTimes(2);
  });

  it("moves the bill on screen to the counter, sending the counter's zone and the party revision", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "move-bill", { to: { counter: true }, bills: "separate" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledWith(
      "wo-check",
      { counter: { zoneId: zone.id } },
      "separate",
      { expectedPartyRevision: 3, partyId: "v1" },
    );
  });

  it("sends no counter zone when the counter's offers could not be read", async () => {
    const { el } = await mountApp({
      listDefaultZoneOffers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);

    emit(order, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledWith("wo-4", { counter: { zoneId: null } }, "merge", {
      expectedPartyRevision: 3,
      partyId: "v1",
    });
  });

  it("after a move to the counter shows the party's remaining bills, and the counter's held orders list the moved bill", async () => {
    const moved = {
      id: "wo-check",
      orderNumber: 14,
      label: "4",
      itemCount: 1,
      total: "30.00",
      outstanding: "30.00",
      hasPayments: false,
      partyId: null,
      openedAt: "2026-08-05T10:00:00.000Z",
      signals: [],
    };
    const bills = vi.fn().mockResolvedValue([tabBill, checkBill]);
    const listWorkingOrders = vi.fn().mockResolvedValue([]);
    const { el } = await mountApp({ getPartyBills: bills, listWorkingOrders });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    bills.mockResolvedValue([tabBill]);
    listWorkingOrders.mockResolvedValue([moved]);

    emit(tableOrder(el)!, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.bills).toEqual([tabBill]);
    expect(api.getTabLines).toHaveBeenLastCalledWith("wo-4");
    expect(banner(el)).toBeNull();
    emit(shell(el), "tab-select", { key: "counter" });
    await flush(el);
    expect(heldRows(el)).toEqual([moved]);
  });

  it("keeps the floor it had when the floor cannot be read after the move", async () => {
    const bills = vi.fn().mockResolvedValue([tabBill, checkBill]);
    const { el } = await mountApp({ getPartyBills: bills });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    bills.mockResolvedValue([tabBill]);
    vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

    emit(tableOrder(el)!, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.tables).toEqual([mesa4, mesa7, mesa9]);
  });

  it("keeps the party on screen, not the older copy on the kept floor, when the floor cannot be read after the move", async () => {
    const bills = vi.fn().mockResolvedValue([tabBill, checkBill]);
    const { el } = await mountApp({ getPartyBills: bills });
    const order = await openMesa(el);
    emit(order, "fire-group", { groupId: "g3" });
    await flush(el);
    expect(tableOrder(el)!.party?.revision).toBe(4);
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    bills.mockResolvedValue([tabBill]);
    vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));

    emit(tableOrder(el)!, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.tables).toEqual([mesa4, mesa7, mesa9]);
    expect(tableOrder(el)!.party).toEqual({ ...mesa4.party, revision: 4 });
  });

  it("says the move stands when the held orders cannot be read again after a move to the counter", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);
    vi.mocked(api.listWorkingOrders).mockRejectedValue(new TypeError("Failed to fetch"));

    emit(order, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledOnce();
    expect(
      el
        .shadowRoot!.querySelector('[data-refresh-notice="held"] .refresh-message')!
        .textContent!.trim(),
    ).toBe(t("refresh.held_after_move"));
  });

  it("goes back to the floor when the moved bill was the party's last", async () => {
    const bills = vi.fn().mockResolvedValue([tabBill]);
    const { el } = await mountApp({ getPartyBills: bills });
    const order = await openMesa(el);
    bills.mockResolvedValue([]);

    emit(order, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledOnce();
    expect(tableOrder(el)).toBeNull();
    expect(floor(el)).not.toBeNull();
  });

  it("sends that it read a free table free, and stays with the party", async () => {
    const { el } = await mountApp({
      moveBill: vi.fn().mockResolvedValue({ partyId: "v9", billId: "wo-check", merged: false }),
    });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    vi.mocked(api.getPartyBills).mockResolvedValue([tabBill]);

    emit(tableOrder(el)!, "move-bill", { to: { tableId: "t9", seated: null }, bills: "merge" });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledWith("wo-check", { tableId: "t9" }, "merge", {
      expectedPartyRevision: 3,
      partyId: "v1",
      otherPartyId: null,
    });
    expect(tableOrder(el)!.party).toEqual(mesa4.party);
    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it("sends the party it read at a seated table with that party's revision, and says when the bills stayed apart", async () => {
    const { el } = await mountApp({
      moveBill: vi.fn().mockResolvedValue({ partyId: "v7", billId: "wo-check", merged: false }),
    });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "move-bill", {
      to: { tableId: "t7", seated: { id: "v7", revision: 9 } },
      bills: "merge",
    });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledWith("wo-check", { tableId: "t7" }, "merge", {
      expectedPartyRevision: 3,
      partyId: "v1",
      otherPartyId: "v7",
      expectedOtherPartyRevision: 9,
    });
    expect(banner(el)!.textContent).toContain(t("table.bills_kept_separate"));
  });

  it("sends the party the bill choice named, though the floor read since seats another there", async () => {
    const pedro = seated(
      { id: "t7", label: "7" },
      { id: "v8", revision: 2, mainBillId: "wo-8", tableIds: ["t7"] },
    );
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([mesa4, pedro, mesa9]),
    });
    const order = await openMesa(el);

    emit(order, "move-bill", {
      to: { tableId: "t7", seated: { id: "v7", revision: 9 } },
      bills: "merge",
    });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledWith("wo-4", { tableId: "t7" }, "merge", {
      expectedPartyRevision: 3,
      partyId: "v1",
      otherPartyId: "v7",
      expectedOtherPartyRevision: 9,
    });
  });

  it("leaves another table's bill on screen when the moved bill's party is read after the waiter opened it", async () => {
    const bill7: PartyBill = { ...tabBill, workingOrderId: "wo-7", partyId: "v7" };
    let release: (bills: PartyBill[]) => void = () => undefined;
    const bills = vi.fn().mockResolvedValue([tabBill, checkBill]);
    const { el } = await mountApp({ getPartyBills: bills });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    bills.mockImplementation((partyId: string) =>
      partyId === "v1"
        ? new Promise<PartyBill[]>((resolve) => (release = resolve))
        : Promise.resolve([bill7]),
    );

    emit(tableOrder(el)!, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);
    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-7");
    release([tabBill]);
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-7");
    expect(tableOrder(el)!.party!.id).toBe("v7");
    expect(tableOrder(el)!.bills).toEqual([bill7]);
  });

  it.each([
    ["merged into their main bill", "merge", true],
    ["kept separate when asked to", "separate", false],
  ] as const)("says nothing about the bills when the bill was %s", async (_how, bills, merged) => {
    const { el } = await mountApp({
      moveBill: vi.fn().mockResolvedValue({ partyId: "v7", billId: "wo-7", merged }),
    });
    const order = await openMesa(el);

    emit(order, "move-bill", { to: { tableId: "t7", seated: { id: "v7", revision: 9 } }, bills });
    await flush(el);

    expect(api.moveBill).toHaveBeenCalledOnce();
    expect(banner(el)).toBeNull();
  });

  it.each([
    "party.main_bill_stays",
    "bill.paid",
    "group.held_leaves_party",
    "table.needs_clearing",
    "table.already_in_party",
  ])("shows %s in its own words, and moves nothing on screen", async (code) => {
    const { el } = await mountApp({ moveBill: vi.fn().mockRejectedValue({ code }) });
    const order = await openMesa(el);

    emit(order, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it("reloads and says what changed when another device changed the party first", async () => {
    const reads = floorThat(
      [mesa4, mesa7, mesa9],
      [seated({}, { revision: 5, billCount: 2 }), mesa7, mesa9],
    );
    const { el } = await mountApp({
      getTablesState: reads.getTablesState,
      moveBill: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 5 }),
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "move-bill", { to: { counter: true }, bills: "merge" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
    expect(tableOrder(el)!.party!.revision).toBe(5);
  });
});

describe("till-app: paying a bill by its state", () => {
  const placedCheck: PartyBill = { ...checkBill, status: "placed" };

  it("collects a presented bill moved into the party, and Finish then closes the table", async () => {
    const bills = vi.fn().mockResolvedValue([tabBill, placedCheck]);
    const { el } = await mountApp({
      getPartyBills: bills,
      finishTable: vi
        .fn()
        .mockRejectedValueOnce({ code: "party.bill_outstanding" })
        .mockResolvedValue({ state: "closed" }),
    });
    const order = await openMesa(el);
    emit(order, "finish-table", {});
    await flush(el);
    expect(tableOrder(el)!.finishRefused).toBe(true);
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    bills.mockResolvedValue([
      { ...tabBill, status: "settled", outstanding: "0.00" },
      { ...placedCheck, status: "settled", outstanding: "0.00" },
    ]);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "30.00" });
    await flush(el);

    expect(api.collectOrder).toHaveBeenCalledWith("wo-check", { method: "cash", amount: "30.00" });
    expect(api.recordSale).not.toHaveBeenCalled();
    emit(el.shadowRoot!.querySelector("till-ticket-view")!, "new-sale");
    await flush(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const reopened = tableOrder(el)!;
    expect(reopened.bills.map((bill) => bill.status)).toEqual(["settled", "settled"]);
    emit(reopened, "finish-table", {});
    await flush(el);
    expect(api.finishTable).toHaveBeenLastCalledWith("v1", 3);
    expect(tableOrder(el)).toBeNull();
  });

  it("collects a presented bill again under the same id after a collection that got no answer", async () => {
    const collectOrder = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(saleResult);
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([tabBill, placedCheck]),
      collectOrder,
    });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "30.00" });
    await flush(el);
    expect(banner(el)!.textContent).toContain(t("sale.unconfirmed"));
    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "30.00" });
    await flush(el);

    expect(collectOrder.mock.calls).toEqual([
      ["wo-check", { method: "cash", amount: "30.00" }],
      ["wo-check", { method: "cash", amount: "30.00" }],
    ]);
    expect(api.recordSale).not.toHaveBeenCalled();
  });

  it("takes no single payment for a partly paid bill, and says to take the rest as a bill payment", async () => {
    const partly: PartyBill = { ...checkBill, outstanding: "10.00", hasPayments: true };
    const { el } = await mountApp({ getPartyBills: vi.fn().mockResolvedValue([tabBill, partly]) });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "10.00" });
    await flush(el);

    expect(api.recordSale).not.toHaveBeenCalled();
    expect(api.collectOrder).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("bill.pay_with_bill_payments"));
  });

  it("takes no single payment for a bill whose only payment is a card still at the reader", async () => {
    const pending: PartyBill = { ...checkBill, hasPayments: true };
    const { el } = await mountApp({ getPartyBills: vi.fn().mockResolvedValue([tabBill, pending]) });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "30.00" });
    await flush(el);

    expect(api.recordSale).not.toHaveBeenCalled();
    expect(api.collectOrder).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("bill.pay_with_bill_payments"));
  });

  it.each([
    ["offers the original receipt when collecting filed the bill's sale", false, true],
    ["offers no original receipt when the bill's sale was filed before", true, false],
  ])("%s", async (_case, filedBefore, offered) => {
    const { el } = await mountApp({
      zonePolicy: { receiptPrintMode: "on_request" },
      getTill: vi.fn().mockResolvedValue({ ...till, receiptPrintMode: "on_request" }),
      getPartyBills: vi
        .fn()
        .mockResolvedValue([tabBill, { ...placedCheck, receiptAvailable: filedBefore }]),
    });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);

    emit(tableOrder(el)!, "pay-tab", { method: "cash", amount: "30.00" });
    await flush(el);

    expect(api.collectOrder).toHaveBeenCalledOnce();
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { originalReceiptAvailable: boolean }>(
        "till-ticket-view",
      )!.originalReceiptAvailable,
    ).toBe(offered);
  });

  it("says to take the rest as a bill payment when the single payment is refused for money already on the bill", async () => {
    const { el } = await mountApp({
      recordSale: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    });
    const order = await openMesa(el);

    emit(order, "pay-tab", { method: "cash", amount: "14.00" });
    await flush(el);

    expect(api.recordSale).toHaveBeenCalledWith([], { method: "cash", amount: "14.00" }, "wo-4");
    expect(banner(el)!.textContent).toContain(t("bill.pay_with_bill_payments"));
  });
});

describe("till-app: opening a seated table", () => {
  it("opens the party's main bill", async () => {
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([seated({}, { mainBillId: "wo-check" }), mesa9]),
    });

    const order = await openMesa(el);

    expect(order.orderId).toBe("wo-check");
  });

  it("opens the first unpaid bill when the party has no main bill, its main having been paid", async () => {
    const paid: PartyBill = {
      ...tabBill,
      workingOrderId: "wo-paid",
      status: "settled",
      outstanding: "0.00",
    };
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([seated({}, { mainBillId: null }), mesa9]),
      getPartyBills: vi.fn().mockResolvedValue([paid, checkBill]),
    });

    const order = await openMesa(el);

    expect(order.orderId).toBe("wo-check");
    expect(api.getTabLines).toHaveBeenCalledWith("wo-check");
  });

  it("opens the latest bill when every bill of the party is paid", async () => {
    const first: PartyBill = {
      ...tabBill,
      workingOrderId: "wo-1",
      status: "settled",
      outstanding: "0.00",
    };
    const last: PartyBill = {
      ...tabBill,
      workingOrderId: "wo-2",
      status: "settled",
      outstanding: "0.00",
    };
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([seated({}, { mainBillId: null }), mesa9]),
      getPartyBills: vi.fn().mockResolvedValue([first, last]),
    });

    const order = await openMesa(el);

    expect(order.orderId).toBe("wo-2");
  });
});

describe("till-app: a table needing clearing", () => {
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
    [
      "move-guests",
      { toTableId: "t9", bills: "merge" },
      "moveGuests",
      ["v1", "t9", "merge", { expectedPartyRevision: 3, otherPartyId: null }],
    ],
    [
      "join-tables",
      { tableId: "t9", bills: "merge" },
      "joinTables",
      ["v1", "t9", "merge", { expectedPartyRevision: 3, otherPartyId: null }],
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

  it.each([
    [
      "merge-bills",
      { fromBillId: "wo-check" },
      "mergeBills",
      ["wo-4", "wo-check", { expectedPartyRevision: 3, partyId: "v1" }],
    ],
    [
      "transfer-lines",
      { toBillId: "wo-check", transfers: [{ lineNo: 1 }] },
      "transferItems",
      ["wo-4", "wo-check", [{ lineNo: 1 }], { expectedPartyRevision: 3, partyId: "v1" }],
    ],
    [
      "split-lines",
      { transfers: [{ lineNo: 1 }] },
      "splitBill",
      ["wo-4", [{ lineNo: 1 }], { expectedPartyRevision: 3, partyId: "v1" }],
    ],
  ] as const)("%s sends the party revision it last read", async (type, detail, method, args) => {
    const { el } = await mountApp();
    const order = await openMesa(el);

    emit(order, type, detail);
    await flush(el);

    expect(
      (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method],
    ).toHaveBeenCalledWith(...args);
  });

  it("sends no transfer that carries no items", async () => {
    const { el } = await mountApp();
    const order = await openMesa(el);

    emit(order, "transfer-lines", { toBillId: "wo-check", transfers: [] });
    await flush(el);

    expect(api.transferItems).not.toHaveBeenCalled();
    expect(banner(el)).toBeNull();
  });

  it("asks before splitting a bill over €3,000 and cancel sends no split", async () => {
    const { el } = await mountApp({
      getPartyBills: vi
        .fn()
        .mockResolvedValue([{ ...tabBill, total: "3500.00", outstanding: "3500.00" }, checkBill]),
    });
    const order = await openMesa(el);

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");
    expect(dialog?.textContent).toContain(t("table.confirm_different_people"));
    expect(api.splitBill).not.toHaveBeenCalled();

    dialog!.querySelector<HTMLElement>("[data-cancel]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).toBeNull();
    expect(api.splitBill).not.toHaveBeenCalled();
    expect(tableOrder(el)!.orderId).toBe("wo-4");
  });

  it("splits a large bill after staff confirm different people", async () => {
    const { el } = await mountApp({
      getPartyBills: vi
        .fn()
        .mockResolvedValue([{ ...tabBill, total: "3500.00", outstanding: "3500.00" }, checkBill]),
    });
    const order = await openMesa(el);

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(api.splitBill).not.toHaveBeenCalled();

    el.shadowRoot!.querySelector<HTMLElement>(
      "[data-confirm-different-people] [data-confirm]",
    )!.click();
    await flush(el);

    expect(api.splitBill).toHaveBeenCalledWith("wo-4", [{ lineNo: 1 }], {
      expectedPartyRevision: 3,
      partyId: "v1",
    });
    expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).toBeNull();
  });

  it("splits a bill at €3,000 without asking for different people", async () => {
    const { el } = await mountApp({
      getPartyBills: vi
        .fn()
        .mockResolvedValue([{ ...tabBill, total: "3000.00", outstanding: "3000.00" }, checkBill]),
    });
    const order = await openMesa(el);

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).toBeNull();
    expect(api.splitBill).toHaveBeenCalledWith("wo-4", [{ lineNo: 1 }], {
      expectedPartyRevision: 3,
      partyId: "v1",
    });
  });

  it("does not split when the bill total could not be read", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const order = await openMesa(el);

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(api.splitBill).not.toHaveBeenCalled();
    expect(banner(el)?.textContent).toContain(t("table.reread_failed"));
  });

  it("sends a large-bill line transfer only after staff confirm different people", async () => {
    const { el } = await mountApp({
      getPartyBills: vi
        .fn()
        .mockResolvedValue([{ ...tabBill, total: "3500.00", outstanding: "3500.00" }, checkBill]),
    });
    const order = await openMesa(el);

    emit(order, "transfer-lines", { toBillId: "wo-check", transfers: [{ lineNo: 1 }] });
    await flush(el);

    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-confirm-different-people]");
    expect(dialog).not.toBeNull();
    expect(api.transferItems).not.toHaveBeenCalled();

    dialog!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await flush(el);
    expect(api.transferItems).toHaveBeenCalledWith("wo-4", "wo-check", [{ lineNo: 1 }], {
      expectedPartyRevision: 3,
      partyId: "v1",
    });
    expect(el.shadowRoot!.querySelector("[data-confirm-different-people]")).toBeNull();
  });

  it("leaves an unpaid split-off bill listed when the waiter leaves it and comes back, and merges nothing (decision 8)", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([tabBill, checkBill]),
    });
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");

    emit(tableOrder(el)!, "back-to-floor");
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const reopened = tableOrder(el)!;
    reopened.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await flush(el);

    const listed = [...reopened.shadowRoot!.querySelectorAll<HTMLElement>("[data-bill]")].map(
      (row) => row.dataset.bill,
    );
    expect(listed).toContain(checkBill.workingOrderId);
    expect(api.mergeBills).not.toHaveBeenCalled();
    expect(api.transferItems).not.toHaveBeenCalled();
  });

  it("moves a party whose tab has been paid, from the paid tab", async () => {
    const paid = seated(
      { hasOpenTab: false, tabLineCount: undefined, tabTotal: undefined },
      { outstanding: "0.00", mainBillId: null },
    );
    const { el } = await mountApp({
      getTablesState: vi.fn().mockResolvedValue([paid, mesa9]),
      getPartyBills: vi
        .fn()
        .mockResolvedValue([
          { ...tabBill, workingOrderId: "wo-paid", status: "settled", outstanding: "0.00" },
        ]),
      getTabLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
    });
    const order = await openMesa(el);
    expect(api.seatTable).not.toHaveBeenCalled();
    expect(order.orderId).toBe("wo-paid");

    emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);

    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 3,
      otherPartyId: null,
    });
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

/** The floor reads `before` until the test says the other device has acted, then `after`. */
function floorThat(before: TableState[], after: TableState[]) {
  const other = { acted: false };
  return { other, getTablesState: vi.fn(async () => (other.acted ? after : before)) };
}

describe("till-app: the bill request", () => {
  const requestedAt = "2026-09-30T20:00:00.000Z";
  /** Mesa 4 as the floor reads it once the party has asked for the bill. */
  const asked = (revision: number) => ({
    ...seated({}, { revision }),
    signals: [{ kind: "bill_requested" as const, requestedAt }],
  });
  /** Opens the order's Tab drawer, where the bills are, if it is closed. */
  async function drawer(el: TillApp): Promise<ShadowRoot> {
    const root = tableOrder(el)!.shadowRoot!;
    if (root.querySelector("[data-drawer]") === null) {
      root.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await flush(el);
    }
    return root;
  }
  const requestedOnScreen = async (el: TillApp) =>
    (await drawer(el)).querySelector("[data-chip='bill-requested']") !== null;

  it("records the request under a submission id of its own, at the revision the party was shown at", async () => {
    const requestBill = vi.fn().mockResolvedValue({ revision: 4, billRequestedAt: requestedAt });
    const { el } = await mountApp({
      requestBill,
      getTablesState: vi.fn(async () =>
        requestBill.mock.calls.length > 0 ? [asked(4), mesa7, mesa9] : [mesa4, mesa7, mesa9],
      ),
    });
    const order = await openMesa(el);

    emit(order, "request-bill", { requested: true });
    await flush(el);

    expect(requestBill).toHaveBeenCalledOnce();
    expect(requestBill).toHaveBeenCalledWith(
      "v1",
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 3,
        requested: true,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(tableOrder(el)!.party!.revision).toBe(4);
    expect(await requestedOnScreen(el)).toBe(true);
    expect(banner(el)).toBeNull();
  });

  it("cancels the request, and the screen offers it again", async () => {
    const requestBill = vi.fn().mockResolvedValue({ revision: 5, billRequestedAt: null });
    const { el } = await mountApp({
      requestBill,
      getTablesState: vi.fn(async () =>
        requestBill.mock.calls.length > 0
          ? [seated({}, { revision: 5 }), mesa7, mesa9]
          : [asked(4), mesa7, mesa9],
      ),
    });
    const order = await openMesa(el);
    expect(await requestedOnScreen(el)).toBe(true);

    emit(order, "request-bill", { requested: false });
    await flush(el);

    expect(requestBill).toHaveBeenCalledWith(
      "v1",
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 4,
        requested: false,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(await requestedOnScreen(el)).toBe(false);
    expect((await drawer(el)).querySelector("[data-request-bill]")).not.toBeNull();
  });

  it("sends a request that got no answer again under the same submission id, and a new press under a new one", async () => {
    const requestBill = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ revision: 4, billRequestedAt: requestedAt });
    const { el } = await mountApp({ requestBill });
    const order = await openMesa(el);

    emit(order, "request-bill", { requested: true });
    await expect.poll(() => tableOrder(el)!.party!.revision, { timeout: 10_000 }).toBe(4);
    await flush(el);
    emit(tableOrder(el)!, "request-bill", { requested: true });
    await flush(el);

    const [first, retry, next] = requestBill.mock.calls.map(([, command]) => command);
    expect(requestBill).toHaveBeenCalledTimes(3);
    expect(retry).toEqual(first);
    expect(next.submissionId).not.toBe(first.submissionId);
  });

  it("reads the floor again and says so when no answer comes at all", async () => {
    const requestBill = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ requestBill });
    const order = await openMesa(el);
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

    emit(order, "request-bill", { requested: true });
    await expect
      .poll(() => banner(el)?.textContent ?? "", { timeout: 10_000 })
      .toContain(t("table.error"));
    await flush(el);

    expect(requestBill).toHaveBeenCalledTimes(3);
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads + 1);
    expect(banner(el)!.textContent).toContain(t("table.error"));
  });

  it("drops a second press while the first is out, and a press with no party's order open", async () => {
    let answer!: (value: { revision: number; billRequestedAt: string }) => void;
    const requestBill = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { el } = await mountApp({ requestBill });
    const screen = await toFloor(el);
    emit(screen, "request-bill", { requested: true });
    await flush(el);
    expect(requestBill).not.toHaveBeenCalled();
    emit(screen, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const order = tableOrder(el)!;

    emit(order, "request-bill", { requested: true });
    await flush(el);
    emit(order, "request-bill", { requested: true });
    await flush(el);
    answer({ revision: 4, billRequestedAt: requestedAt });
    await flush(el);

    expect(requestBill).toHaveBeenCalledOnce();
  });

  it("shows a refusal in its code's own words", async () => {
    const { el } = await mountApp({
      requestBill: vi.fn().mockRejectedValue({ code: "party.not_open" }),
    });
    const order = await openMesa(el);

    emit(order, "request-bill", { requested: true });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
  });

  it("reloads and says the bill was asked for elsewhere, and sends nothing more until the person acts again", async () => {
    const requestBill = vi
      .fn()
      .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 5 });
    const reads = floorThat([mesa4, mesa7, mesa9], [asked(5), mesa7, mesa9]);
    const { el } = await mountApp({ requestBill, getTablesState: reads.getTablesState });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "request-bill", { requested: true });
    await flush(el);

    expect(requestBill).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));
    expect(banner(el)!.textContent).toContain(t("party.changed_bill_requested"));
    expect(tableOrder(el)!.party!.revision).toBe(5);
    expect(await requestedOnScreen(el)).toBe(true);

    requestBill.mockResolvedValue({ revision: 6, billRequestedAt: null });
    emit(tableOrder(el)!, "request-bill", { requested: false });
    await flush(el);

    expect(requestBill).toHaveBeenLastCalledWith(
      "v1",
      {
        submissionId: expect.any(String),
        expectedPartyRevision: 5,
        requested: false,
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("says the request was cancelled elsewhere when that is what changed", async () => {
    const reads = floorThat([asked(4), mesa7, mesa9], [seated({}, { revision: 5 }), mesa7, mesa9]);
    const { el } = await mountApp({
      requestBill: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "request-bill", { requested: false });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed_bill_request_cancelled"));
  });

  describe("once the waiter has signed out or opened another party", () => {
    afterEach(() => vi.useRealTimers());

    async function signOutAndIn(el: TillApp): Promise<void> {
      emit(tableOrder(el)!, "logout");
      await flush(el);
      emit(lock(el), "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
      await flush(el);
    }

    it("sends nothing more after a sign-out during the pause before a resend, and shows the next person nothing", async () => {
      const requestBill = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { el } = await mountApp({ requestBill });
      const order = await openMesa(el);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      emit(order, "request-bill", { requested: true });
      await flush(el);
      expect(requestBill).toHaveBeenCalledOnce();

      await signOutAndIn(el);
      await vi.advanceTimersByTimeAsync(2 * SUBMIT_RETRY_PAUSE_MS);
      await flush(el);

      expect(requestBill).toHaveBeenCalledOnce();
      expect(banner(el)).toBeNull();
    });

    it.each([
      { outcome: "recorded", answer: { settle: { revision: 4, billRequestedAt: requestedAt } } },
      { outcome: "refused", answer: { refuse: { code: "party.not_open" } } },
      {
        outcome: "changed elsewhere",
        answer: { refuse: { code: "party.out_of_date", partyId: "v1" } },
      },
    ])(
      "an answer ($outcome) arriving after the waiter signed out reads nothing and says nothing to the next person",
      async ({ answer: late }) => {
        const { call, answer } = held();
        const { el } = await mountApp({ requestBill: call });
        const order = await openMesa(el);
        emit(order, "request-bill", { requested: true });
        await flush(el);
        await signOutAndIn(el);
        const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

        if ("settle" in late) answer.settle(late.settle);
        else answer.refuse(late.refuse);
        await flush(el);

        expect(call).toHaveBeenCalledOnce();
        expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
        expect(banner(el)).toBeNull();
      },
    );

    it.each([
      { outcome: "recorded", answer: { settle: { revision: 4, billRequestedAt: requestedAt } } },
      { outcome: "refused", answer: { refuse: { code: "party.not_open" } } },
      {
        outcome: "changed elsewhere",
        answer: { refuse: { code: "party.out_of_date", partyId: "v1" } },
      },
    ])(
      "an answer ($outcome) arriving after the waiter opened another party leaves that party's screen as it is",
      async ({ answer: late }) => {
        const { call, answer } = held();
        const { el } = await mountApp({ requestBill: call });
        const order = await openMesa(el);
        emit(order, "request-bill", { requested: true });
        await flush(el);
        emit(tableOrder(el)!, "back-to-floor");
        await flush(el);
        emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
        await flush(el);
        expect(tableOrder(el)!.orderId).toBe("wo-7");
        const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

        if ("settle" in late) answer.settle(late.settle);
        else answer.refuse(late.refuse);
        await flush(el);

        expect(tableOrder(el)?.party?.id).toBe("v7");
        expect(tableOrder(el)!.orderId).toBe("wo-7");
        expect(api.getTablesState).toHaveBeenCalledTimes(floorReads);
        expect(banner(el)).toBeNull();
      },
    );

    it("gives up a request that gets no answer at all at the time limit, and the next press is sent", async () => {
      const requestBill = vi.fn(
        (_partyId: string, _command: unknown, options?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      );
      const { el } = await mountApp({ requestBill });
      const order = await openMesa(el);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      emit(order, "request-bill", { requested: true });
      await flush(el);

      await vi.advanceTimersByTimeAsync(150_000);
      await flush(el);

      expect(requestBill).toHaveBeenCalledOnce();
      expect(banner(el)!.textContent).toContain(t("table.error"));
      emit(tableOrder(el)!, "request-bill", { requested: true });
      await flush(el);
      expect(requestBill).toHaveBeenCalledTimes(2);
    });

    /** The floor answers at once, except the first read after `hold`, which waits for `release`. */
    function floorHeldOnce() {
      let holdNext = false;
      let release: () => void = () => undefined;
      const getTablesState = vi.fn(async () => {
        if (holdNext) {
          holdNext = false;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return [mesa4, mesa7, mesa9];
      });
      return { getTablesState, hold: () => (holdNext = true), release: () => release() };
    }

    it("says nothing on the other party's screen when the waiter opened it while the floor was read again after no answer", async () => {
      const floorRead = floorHeldOnce();
      const requestBill = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { el } = await mountApp({ requestBill, getTablesState: floorRead.getTablesState });
      const order = await openMesa(el);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      floorRead.hold();
      emit(order, "request-bill", { requested: true });
      await vi.advanceTimersByTimeAsync(2 * SUBMIT_RETRY_PAUSE_MS);
      await flush(el);
      expect(requestBill).toHaveBeenCalledTimes(3);
      emit(tableOrder(el)!, "back-to-floor");
      await flush(el);
      emit(floor(el)!, "open-table", { tableId: "t7", seated: true });
      await flush(el);
      expect(tableOrder(el)!.orderId).toBe("wo-7");

      floorRead.release();
      await flush(el);

      expect(tableOrder(el)!.orderId).toBe("wo-7");
      expect(banner(el)).toBeNull();
    });

    it("says nothing to the next person when the reads after a change elsewhere answer after sign-out", async () => {
      const floorRead = floorHeldOnce();
      const { el } = await mountApp({
        requestBill: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
        getTablesState: floorRead.getTablesState,
      });
      const order = await openMesa(el);
      floorRead.hold();
      emit(order, "request-bill", { requested: true });
      await flush(el);
      await signOutAndIn(el);

      floorRead.release();
      await flush(el);

      expect(banner(el)).toBeNull();
    });
  });
});

describe("till-app: another device changed the table first", () => {
  const moved = seated(
    {},
    { revision: 5, tableIds: ["t4", "t5"], billCount: 2, outstanding: "50.00" },
  );
  const mesa5 = seated({ id: "t5", label: "5" }, { revision: 5, tableIds: ["t4", "t5"] });

  it("reloads, says what changed, and sends the new revision only when the person acts again", async () => {
    const moveGuests = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 5 })
      .mockResolvedValue({ partyId: "v1", mainBillId: "wo-4", merged: false });
    const { other, getTablesState } = floorThat([mesa4, mesa9], [moved, mesa5, mesa9]);
    const { el } = await mountApp({ moveGuests, getTablesState });
    const order = await openMesa(el);
    other.acted = true;
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;

    emit(order, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);

    expect(moveGuests).toHaveBeenCalledOnce();
    expect(tableOrder(el)!.party).toEqual(moved.party);
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads + 1);
    const text = banner(el)!.textContent!;
    expect(text).toContain(t("party.changed").replace("{table}", "4"));
    expect(text).toContain(t("party.changed_tables").replace("{tables}", "4, 5"));
    expect(text).toContain(t("party.try_again"));

    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);
    expect(moveGuests).toHaveBeenLastCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 5,
      otherPartyId: null,
    });
  });

  it("names the bills and what is left to pay when those are what changed", async () => {
    const split = seated({}, { revision: 5, billCount: 2, outstanding: "44.00" });
    const reads = floorThat([mesa4], [split]);
    const { el } = await mountApp({
      splitBill: vi
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
      joinTables: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v1", revision: 5 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "join-tables", { tableId: "t9", bills: "merge" });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed_other"));
  });

  it("names the other table when it is the other party that changed", async () => {
    const reads = floorThat(
      [mesa4, mesa7],
      [
        mesa4,
        seated(
          { id: "t7", label: "7" },
          { id: "v7", revision: 10, mainBillId: "wo-7", tableIds: ["t7"] },
        ),
      ],
    );
    const { el } = await mountApp({
      transferItems: vi
        .fn()
        .mockRejectedValue({ code: "party.out_of_date", partyId: "v7", revision: 10 }),
      getTablesState: reads.getTablesState,
    });
    const order = await openMesa(el);
    reads.other.acted = true;

    emit(order, "transfer-lines", { toBillId: "wo-check", transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "7"));
  });

  it.each([
    ["table.needs_clearing", "move-guests", { toTableId: "t9", bills: "merge" }, "moveGuests"],
    ["table.needs_clearing", "join-tables", { tableId: "t9", bills: "merge" }, "joinTables"],
    ["party.not_open", "split-lines", { transfers: [{ lineNo: 1 }] }, "splitBill"],
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
    emit(tabletOrderCard(el)!, "join-tables", { tableId: "t9", bills: "merge" });
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

  it("sends the round to the bill chosen in Send to after a refresh shows that bill presented", async () => {
    let finish!: (value: unknown) => void;
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([tabBill, checkBill]),
      updateOrderLine: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      submitDraft: answering({ tabId: "wo-4", revision: 6, groups: [] }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);
    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Vino",
      patch: { note: "note" },
      revision: 0,
    });
    await flush(el);
    order.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="fire-all"]')!.click();
    await flush(el);
    const choice = order.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="billId"][value="wo-check"]',
    )!;
    choice.click();
    await flush(el);
    expect(choice.checked).toBe(true);
    vi.mocked(api.getTablesState).mockResolvedValue([seated({}, { revision: 5 }), mesa7, mesa9]);
    vi.mocked(api.getPartyBills).mockResolvedValue([tabBill, { ...checkBill, status: "placed" }]);

    finish({ revision: 1, party: { id: "v1", revision: 4 } });
    await flush(el);
    expect(order.bills[1]!.status).toBe("placed");
    order.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(vi.mocked(api.submitDraft).mock.calls[0]![2]).toHaveProperty("billId", "wo-check");
  });

  it("sends the revision the submission answered with on the party's next command", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-4", revision: 4, groups: [] }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);
    emit(order, "submit-draft", roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]));
    await flush(el);

    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 4,
      otherPartyId: null,
    });
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
    // As above: an order has no party only once its party has left the table.
    const reads = floorThat(
      [mesa4, mesa9],
      [table({ state: "open-tab", hasOpenTab: true }), mesa9],
    );
    const { el } = await mountApp({ getTablesState: reads.getTablesState });
    const order = await openMesa(el);
    await ringRound(el, order);
    const detail = roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]);
    reads.other.acted = true;
    emit(order, "merge-bills", { fromBillId: "wo-check" });
    await flush(el);
    expect(tableOrder(el)!.party).toBeNull();
    emit(tableOrder(el)!, "submit-draft", detail);
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
    // The retries wait real time, which a loaded machine stretches past a fixed sleep; the poll
    // returns once the message shows.
    await expect
      .poll(() => banner(el)?.textContent ?? "", { timeout: 10_000 })
      .toContain(t("table.round_unconfirmed"));
    await flush(el);

    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 4,
      otherPartyId: null,
    });
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
    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledWith("v7", "t9", "merge", {
      expectedPartyRevision: 9,
      otherPartyId: null,
    });
  });

  it("sends the party's draft from a bill split off the main bill, naming no bill unless one is chosen", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-4", revision: 4, groups: [] }),
    });
    const order = await openMesa(el);
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }] });
    await flush(el);
    expect(tableOrder(el)!.orderId).toBe("wo-check");
    const onCheck = tableOrder(el)!;
    await ringRound(el, onCheck);

    emit(onCheck, "submit-draft", roundDetail(onCheck, [{ release: "fire", lineIndexes: [0, 1] }]));
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(vi.mocked(api.submitDraft).mock.calls[0]![2]).not.toHaveProperty("billId");
    expect(banner(el)).toBeNull();
  });

  it("sends an order to the bill the waiter chose", async () => {
    const { el } = await mountApp({
      submitDraft: answering({ tabId: "wo-check", revision: 4, groups: [] }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);

    emit(order, "submit-draft", {
      ...roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]),
      billId: "wo-check",
    });
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledWith(
      "v1",
      expect.any(String),
      expect.objectContaining({ billId: "wo-check" }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("shows the chosen bill when a send to it got no answer", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);
    await ringRound(el, order);

    emit(order, "submit-draft", {
      ...roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]),
      billId: "wo-check",
    });
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(
      () => expect(banner(el)?.textContent).toContain(t("table.round_unconfirmed")),
      {
        timeout: 4000,
        interval: 50,
      },
    );
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledTimes(3);
    expect(banner(el)!.textContent).toContain(t("table.round_unconfirmed"));
    expect(tableOrder(el)!.orderId).toBe("wo-check");
  });

  it("keeps the party on screen, not the older copy on the kept floor, when a send from another bill got no answer and the floor cannot be read", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openMesa(el);
    emit(order, "fire-group", { groupId: "g3" });
    await flush(el);
    expect(tableOrder(el)!.party?.revision).toBe(4);
    emit(tableOrder(el)!, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    vi.mocked(api.getTablesState).mockRejectedValue(new TypeError("Failed to fetch"));
    await ringRound(el, tableOrder(el)!);

    emit(
      tableOrder(el)!,
      "submit-draft",
      roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0, 1] }]),
    );
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(
      () => expect(banner(el)?.textContent).toContain(t("table.round_unconfirmed")),
      {
        timeout: 4000,
        interval: 50,
      },
    );
    await flush(el);

    expect(api.submitDraft).toHaveBeenCalledTimes(3);
    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.party).toEqual({ ...mesa4.party, revision: 4 });
    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 4,
      otherPartyId: null,
    });
  });

  it("takes the party from the floor read after a send from another bill landed on the main bill, when the floor has it at a later revision", async () => {
    let landed = false;
    const later = seated({}, { revision: 6, name: "Ana" });
    const { el } = await mountApp({
      getTablesState: vi.fn(async () => [landed ? later : mesa4, mesa7, mesa9]),
      submitDraft: vi.fn(async (...args: SubmitArgs) => {
        landed = true;
        return { ...drafts.apply(...args), tabId: "wo-4", revision: 4, groups: [] };
      }),
    });
    const order = await openMesa(el);
    emit(order, "take-payment", { workingOrderId: "wo-check" });
    await flush(el);
    await ringRound(el, tableOrder(el)!);

    emit(
      tableOrder(el)!,
      "submit-draft",
      roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0, 1] }]),
    );
    await flush(el);

    expect(tableOrder(el)!.orderId).toBe("wo-4");
    expect(tableOrder(el)!.party).toEqual(later.party);
  });

  it("shows a refusal of the chosen bill in its own words", async () => {
    const { el } = await mountApp({
      submitDraft: vi
        .fn()
        .mockRejectedValue({ code: "bill.presented", workingOrderId: "wo-check" }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);

    emit(order, "submit-draft", {
      ...roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]),
      billId: "wo-check",
    });
    await flush(el);

    expect(banner(el)!.textContent).toContain(codeMessage("bill.presented"));
  });

  it("shows a chosen bill merged away meanwhile in its own words", async () => {
    const { el } = await mountApp({
      submitDraft: vi.fn().mockRejectedValue({ code: "tab.not_open", tabId: "wo-check" }),
    });
    const order = await openMesa(el);
    await ringRound(el, order);

    emit(order, "submit-draft", {
      ...roundDetail(order, [{ release: "fire", lineIndexes: [0, 1] }]),
      billId: "wo-check",
    });
    await flush(el);

    const text = banner(el)!.textContent!;
    expect(text).toContain(codeMessage("tab.not_open"));
    expect(text).not.toContain(t("table.error"));
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
    const answers: ((value: object) => void)[] = [];
    const later = () =>
      new Promise((resolve) => {
        answers.push(resolve);
      });
    const { el } = await mountApp({ applyAdjustment: vi.fn(later), updateOrderLine: vi.fn(later) });
    const order = await openMesa(el);
    await cancelLine(el, order);
    emit(order, "change-line", {
      lineNo: 2,
      lineName: "Vino",
      patch: { note: "sin hielo" },
      revision: 0,
    });
    await flush(el);
    expect(answers).toHaveLength(2);

    answers[1]!({ revision: 1, party: { id: "v1", revision: 5 } });
    await flush(el);
    answers[0]!(cancelAnswer({ id: "v1", revision: 4 }));
    await flush(el);

    emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
    await flush(el);
    expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
      expectedPartyRevision: 5,
      otherPartyId: null,
    });
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

      emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);
      expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
        expectedPartyRevision: 4,
        otherPartyId: null,
      });
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

      emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);
      expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
        expectedPartyRevision: 5,
        otherPartyId: null,
      });
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
      emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);

      expect(api.fireGroup).toHaveBeenCalledOnce();
      expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
        expectedPartyRevision: 4,
        otherPartyId: null,
      });
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

      emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
      await flush(el);
      expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
        expectedPartyRevision: 5,
        otherPartyId: null,
      });
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
            permissions: [],
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
            applyAdjustment: vi.fn().mockResolvedValue(cancelAnswer({ id: "v1", revision: 4 })),
            submitDraft: submitAt(4),
          }),
        );
        const order = await openMesa(el);

        await cancelLine(el, order);
        await ringRound(el, tableOrder(el)!);
        emit(
          tableOrder(el)!,
          "submit-draft",
          roundDetail(tableOrder(el)!, [{ release: "fire", lineIndexes: [0, 1] }]),
        );
        await flush(el);

        expect(api.applyAdjustment).toHaveBeenCalledWith(
          "wo-4",
          expect.objectContaining({ lineId: "line-1", action: "cancel" }),
          expect.anything(),
        );
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

      it(
        "a round sent after a void that got no answer carries the floor's revision",
        { timeout: 2 * GIVE_UP_MS },
        async () => {
          const { el } = await mountApp(
            withGroups({ ...floorMovedBy("applyAdjustment"), submitDraft: submitAt(4) }),
          );
          const order = await openMesa(el);

          await cancelLine(el, order);
          await untilUnconfirmed(el);
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
        },
      );

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
        emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
        await flush(el);

        expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
          expectedPartyRevision: 4,
          otherPartyId: null,
        });
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

      it(
        "a void that got no answer, with the floor unread, keeps the revision an earlier void answered",
        { timeout: 2 * GIVE_UP_MS },
        async () => {
          const { el } = await mountApp(
            withGroups(
              offlineAfterOneAnswer("applyAdjustment", cancelAnswer({ id: "v1", revision: 4 })),
            ),
          );
          const order = await openMesa(el);

          await cancelLine(el, order);
          await cancelLine(el, tableOrder(el)!, "line-2");
          await untilUnconfirmed(el);
          await flush(el);
          emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
          await flush(el);

          // A resend after no answer keeps its cancel's submission id, so two ids are two cancels.
          const cancels = vi
            .mocked(api.applyAdjustment)
            .mock.calls.map(([, command]) => command.submissionId);
          expect(new Set(cancels).size).toBe(2);
          expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
            expectedPartyRevision: 4,
            otherPartyId: null,
          });
        },
      );

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
        emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
        await flush(el);

        // A retry after no answer keeps its round's submission id, so two ids are two rounds.
        const rounds = vi.mocked(api.submitDraft).mock.calls.map((call) => call[2].submissionId);
        expect(new Set(rounds).size).toBe(2);
        expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
          expectedPartyRevision: 4,
          otherPartyId: null,
        });
      });

      it.each([
        ["no party", null],
        ["another party", { id: "v7", revision: 10 }],
      ])("a void answering %s leaves the revision the screen showed", async (_name, answered) => {
        const { el } = await mountApp(
          withGroups({ applyAdjustment: vi.fn().mockResolvedValue(cancelAnswer(answered)) }),
        );
        const order = await openMesa(el);

        await cancelLine(el, order);
        emit(tableOrder(el)!, "move-guests", { toTableId: "t9", bills: "merge" });
        await flush(el);

        expect(api.moveGuests).toHaveBeenCalledWith("v1", "t9", "merge", {
          expectedPartyRevision: 3,
          otherPartyId: null,
        });
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
        .mockResolvedValue([seated({}, { revision: 4, mainBillId: "wo-next" }), mesa7, mesa9]);
    const courseOf = (order: TillTableOrderScreen, index: number) =>
      order.shadowRoot!.querySelector<WtCombobox>(`[data-round-course="${index}"]`)!.value;

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
      const steakCourse = order.shadowRoot!.querySelector<WtCombobox>('[data-round-course="1"]')!;
      await chooseOption(steakCourse, "desserts");
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
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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

describe("till-app: recording an unpaid departure", () => {
  const recorded = {
    state: "closed",
    departures: [
      { id: "ud-1", workingOrderId: "wo-4", saleId: "s-4", invoiceNumber: "F-4", amount: "14.00" },
      {
        id: "ud-2",
        workingOrderId: "wo-check",
        saleId: "s-5",
        invoiceNumber: "F-5",
        amount: "30.00",
      },
    ],
  };
  const dialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillUnpaidDepartureDialog>("till-unpaid-departure-dialog");
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog[data-departure-approval]",
    );

  /** Finish is refused for an unpaid bill, and the refusal's Record unpaid departure is pressed. */
  async function openDeparture(overrides: Record<string, unknown> = {}) {
    const mounted = await mountApp({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      recordUnpaidDeparture: vi.fn().mockResolvedValue(recorded),
      listUnpaidDepartureAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "sup-1", displayName: "Luis" }]),
      ...overrides,
    });
    const order = await openMesa(mounted.el);
    emit(order, "finish-table", {});
    await flush(mounted.el);
    const screen = tableOrder(mounted.el)!.shadowRoot!;
    if (screen.querySelector("[data-drawer]") === null) {
      screen.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await flush(mounted.el);
    }
    screen.querySelector<HTMLElement>("[data-finish-refusal] [data-record-departure]")!.click();
    await flush(mounted.el);
    return mounted;
  }

  async function typeReason(el: TillApp, reason: string): Promise<void> {
    const input = dialog(el)!
      .shadowRoot!.querySelector('wt-input[name="reason"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = reason;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
  }

  async function confirmDeparture(el: TillApp): Promise<void> {
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-departure-confirm]")!.click();
    await flush(el, 5);
  }

  it("opens over the table and shows each bill left unpaid, named as the table screen names it", async () => {
    const { el } = await openDeparture();

    expect(dialog(el)!.bills).toEqual([
      { workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" },
      { workingOrderId: "wo-check", name: "4 · Bill 2", outstanding: "30.00" },
    ]);
    expect(api.recordUnpaidDeparture).not.toHaveBeenCalled();
  });

  /** A presented bill of 18.00 whose invoice owes `amountDue` once its credit notes are counted. */
  const creditedBill = (workingOrderId: string, amountDue: string): PartyBill => ({
    workingOrderId,
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    status: "placed",
    total: "18.00",
    outstanding: "18.00",
    hasPayments: false,
    receiptAvailable: true,
    receiptLanguage: "es-ES",
    invoiceNumber: `A/${workingOrderId}`,
    creditNotes: [`R/${workingOrderId}`],
    amountDue,
  });
  const confirmText = (el: TillApp) =>
    dialog(el)!
      .shadowRoot!.querySelector("[data-departure-confirm]")!
      .textContent!.replace(/\s+/g, " ")
      .trim();

  it("leaves out a presented bill whose credit notes cancel its invoice, and its amount from the total", async () => {
    const { el } = await openDeparture({
      getPartyBills: vi.fn().mockResolvedValue([tabBill, creditedBill("wo-credited", "0.00")]),
    });

    expect(dialog(el)!.bills).toEqual([
      { workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" },
    ]);
    expect(confirmText(el)).toBe(
      t("departure.confirm").replace("{amount}", formatMoney("14.00", "en")),
    );
  });

  it("shows a partly credited presented bill at what its invoice still owes", async () => {
    const { el } = await openDeparture({
      getPartyBills: vi.fn().mockResolvedValue([tabBill, creditedBill("wo-part", "15.58")]),
    });

    expect(dialog(el)!.bills).toEqual([
      { workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" },
      { workingOrderId: "wo-part", name: "4 · Bill 2", outstanding: "15.58" },
    ]);
    expect(confirmText(el)).toBe(
      t("departure.confirm").replace("{amount}", formatMoney("29.58", "en")),
    );
  });

  it("refuses an empty reason without sending anything", async () => {
    const { el } = await openDeparture();

    await confirmDeparture(el);

    expect(api.recordUnpaidDeparture).not.toHaveBeenCalled();
    expect(dialog(el)).not.toBeNull();
  });

  it("with the permission, sends the reason and the revision it read, and the table finishes as Finish leaves it", async () => {
    const { el } = await openDeparture();
    const floorReads = vi.mocked(api.getTablesState).mock.calls.length;

    await typeReason(el, "  Ran off ");
    await confirmDeparture(el);

    expect(api.recordUnpaidDeparture).toHaveBeenCalledOnce();
    expect(vi.mocked(api.recordUnpaidDeparture).mock.calls[0]!.slice(0, 2)).toEqual([
      "v1",
      { expectedPartyRevision: 3, reason: "Ran off" },
    ]);
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)).toBeNull();
    expect(api.getTablesState).toHaveBeenCalledTimes(floorReads + 1);
  });

  it("without the permission, asks a supervisor or manager for their PIN and sends it with the same reason", async () => {
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 })
      .mockResolvedValue(recorded);
    const { el } = await openDeparture({ recordUnpaidDeparture, openDrawer: vi.fn() });

    await typeReason(el, "Ran off");
    await confirmDeparture(el);

    expect(api.listUnpaidDepartureAuthorizers).toHaveBeenCalledOnce();
    expect(approval(el)!.authorizers).toEqual([{ personId: "sup-1", displayName: "Luis" }]);
    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el, 5);

    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(2);
    expect(recordUnpaidDeparture.mock.calls[1]!.slice(0, 2)).toEqual([
      "v1",
      { expectedPartyRevision: 3, reason: "Ran off", override: { personId: "sup-1", pin: "4321" } },
    ]);
    expect(approval(el)).toBeNull();
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)).toBeNull();
    expect(api.openDrawer).not.toHaveBeenCalled();
  });

  it("shows a wrong PIN in the PIN prompt, and sends nothing more", async () => {
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 })
      .mockRejectedValueOnce({ code: "pin.invalid", status: 401 });
    const { el } = await openDeparture({ recordUnpaidDeparture });
    await typeReason(el, "Ran off");
    await confirmDeparture(el);

    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "0000" });
    await flush(el, 5);

    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(2);
    expect(approval(el)!.error).toBe("pin.invalid");
    expect(dialog(el)).not.toBeNull();
    expect(tableOrder(el)).not.toBeNull();
  });

  it.each(["unpaid_departure.unfired_dishes", "unpaid_departure.bill_holds_payment"])(
    "keeps the dialog open with %s's own sentence, and reads the bills again",
    async (code) => {
      const { el } = await openDeparture({
        recordUnpaidDeparture: vi
          .fn()
          .mockRejectedValue({ code, status: 409, workingOrderId: "wo-check" }),
      });
      const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
      await typeReason(el, "Ran off");
      await confirmDeparture(el);

      expect(dialog(el)!.refusal).toEqual({ code });
      const bottom = dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(
        "wt-form-actions",
      )!;
      expect(bottom.error).toBe(codeMessage(code));
      expect(api.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
      expect(tableOrder(el)).not.toBeNull();
    },
  );

  it("sends a fresh request on each press, with what the dialog holds then", async () => {
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce({ code: "unpaid_departure.unfired_dishes", status: 409 })
      .mockResolvedValue(recorded);
    const { el } = await openDeparture({ recordUnpaidDeparture });
    await typeReason(el, "Ran off");
    await confirmDeparture(el);

    await typeReason(el, "Ran off after the dessert was cancelled");
    await confirmDeparture(el);

    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(2);
    expect(recordUnpaidDeparture.mock.calls[1]![1]).toEqual({
      expectedPartyRevision: 3,
      reason: "Ran off after the dessert was cancelled",
    });
    expect(tableOrder(el)).toBeNull();
  });

  it("sends the same request again when one gets no answer, and the table finishes", async () => {
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(recorded);
    const { el } = await openDeparture({ recordUnpaidDeparture });
    await typeReason(el, "Ran off");

    await confirmDeparture(el);
    await expect.poll(() => tableOrder(el), { timeout: GIVE_UP_MS }).toBeNull();

    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(2);
    expect(recordUnpaidDeparture.mock.calls[1]![1]).toEqual(
      recordUnpaidDeparture.mock.calls[0]![1],
    );
  });

  it("when another device changed the table first, closes, reloads, says what changed, and sends the new revision only when pressed again", async () => {
    const moved = seated({}, { revision: 5, outstanding: "50.00" });
    const reads = floorThat([mesa4, mesa7, mesa9], [moved, mesa7, mesa9]);
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 5 })
      .mockResolvedValue(recorded);
    const { el } = await openDeparture({
      recordUnpaidDeparture,
      getTablesState: reads.getTablesState,
    });
    reads.other.acted = true;
    await typeReason(el, "Ran off");

    await confirmDeparture(el);

    expect(recordUnpaidDeparture).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)!.party).toEqual(moved.party);
    const text = banner(el)!.textContent!;
    expect(text).toContain(t("party.changed").replace("{table}", "4"));
    expect(text).toContain(t("party.try_again"));

    emit(tableOrder(el)!, "record-unpaid-departure", {});
    await flush(el);
    await typeReason(el, "Ran off");
    await confirmDeparture(el);
    expect(recordUnpaidDeparture).toHaveBeenLastCalledWith(
      "v1",
      { expectedPartyRevision: 5, reason: "Ran off" },
      expect.anything(),
    );
  });

  it("when a resend after a lost reply finds the table closed, says the departure was probably recorded, never to try again", async () => {
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce({ code: "party.not_open", status: 409 });
    const { el } = await openDeparture({ recordUnpaidDeparture });
    await typeReason(el, "Ran off");

    await confirmDeparture(el);
    await expect.poll(() => tableOrder(el), { timeout: GIVE_UP_MS }).toBeNull();
    await flush(el);

    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(2);
    expect(dialog(el)).toBeNull();
    const text = banner(el)!.textContent!;
    expect(text).toContain(t("departure.probably_recorded"));
    expect(text).not.toContain(codeMessage("party.not_open"));
  });

  it("when the first send finds the table closed, says the table changed, as Finish does", async () => {
    const { el } = await openDeparture({
      recordUnpaidDeparture: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
    });
    await typeReason(el, "Ran off");

    await confirmDeparture(el);

    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
  });

  it("puts the server's refusal of the reason beside the reason", async () => {
    const { el } = await openDeparture({
      recordUnpaidDeparture: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", status: 400, field: "reason" }),
    });
    await typeReason(el, "Ran off");

    await confirmDeparture(el);

    const field = dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      'wt-input[name="reason"]',
    )!;
    expect(field.error).toBe(codeMessage("management.request_invalid"));
  });

  it("says who can approve it could not be read, and opens no PIN prompt", async () => {
    const { el } = await openDeparture({
      recordUnpaidDeparture: vi
        .fn()
        .mockRejectedValue({ code: "authorization.not_permitted", status: 403 }),
      listUnpaidDepartureAuthorizers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await typeReason(el, "Ran off");

    await confirmDeparture(el);

    expect(approval(el)).toBeNull();
    const bottom = dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(
      "wt-form-actions",
    )!;
    expect(bottom.error).toBe(t("departure.approvers_failed"));
  });

  it("says a departure whose resends all got no answer may have been recorded", async () => {
    const recordUnpaidDeparture = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await openDeparture({ recordUnpaidDeparture });
    await typeReason(el, "Ran off");

    await confirmDeparture(el);
    const bottom = () =>
      dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
        .error;
    await expect.poll(bottom, { timeout: GIVE_UP_MS }).toBe(t("departure.unconfirmed"));

    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(3);
    expect(tableOrder(el)).not.toBeNull();
  });

  it("leaves out of the dialog a bill with nothing left to pay", async () => {
    const empty: PartyBill = {
      ...checkBill,
      workingOrderId: "wo-empty",
      total: "0.00",
      outstanding: "0.00",
    };
    const { el } = await openDeparture({
      getPartyBills: vi.fn().mockResolvedValue([tabBill, empty, checkBill]),
    });

    expect(dialog(el)!.bills).toEqual([
      { workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" },
      { workingOrderId: "wo-check", name: "4 · Bill 3", outstanding: "30.00" },
    ]);
  });

  for (const action of ["Cancel", "Escape"]) {
    it(`unpaid departure ${action} retains the reason and bills until local Discard`, async () => {
      const { el } = await openDeparture();
      const order = tableOrder(el)!;
      const bills = structuredClone(order.bills);
      const form = dialog(el)!;
      await typeReason(el, "  Left during clearing  ");
      const input = form.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
      input.focus();
      if (action === "Cancel")
        form.shadowRoot!.querySelector<HTMLElement>("[data-departure-close]")!.click();
      else await userEvent.keyboard("{Escape}");
      await flush(el);
      const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
      expect(question.open).toBe(true);
      expect(dialog(el)).toBe(form);
      expect(api.recordUnpaidDeparture).not.toHaveBeenCalled();
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await flush(el);
      expect(question.open).toBe(false);
      expect(input.value).toBe("  Left during clearing  ");
      expect(tableOrder(el)!.bills).toEqual(bills);
      form.shadowRoot!.querySelector<HTMLElement>("[data-departure-close]")!.click();
      await flush(el);
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => dialog(el)).toBeNull();
      expect(tableOrder(el)).toBe(order);
      expect(tableOrder(el)!.bills).toEqual(bills);
      expect(api.recordUnpaidDeparture).not.toHaveBeenCalled();
    });
  }

  it("discarding departure approval keeps the reason; recording afterwards closes without a warning", async () => {
    const recordUnpaidDeparture = vi
      .fn()
      .mockRejectedValueOnce({ code: "authorization.not_permitted", status: 403 })
      .mockResolvedValue(recorded);
    const { el } = await openDeparture({ recordUnpaidDeparture, openDrawer: vi.fn() });
    await typeReason(el, "Ran off");
    await confirmDeparture(el);
    const parent = dialog(el)!;
    const child = approval(el)!;
    child.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
    await child.updateComplete;
    const pad = child.shadowRoot!.querySelector("till-numeric-pad")!;
    pad.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "0042" }, bubbles: true, composed: true }),
    );
    await child.updateComplete;
    await userEvent.keyboard("{Escape}");
    await flush(el);
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    expect(question.open).toBe(true);
    question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await flush(el);
    await expect.poll(() => approval(el)).toBeNull();
    expect(dialog(el)).toBe(parent);
    expect(parent.shadowRoot!.querySelector("wt-input")!.value).toBe("Ran off");
    expect(recordUnpaidDeparture).toHaveBeenCalledTimes(1);
    await confirmDeparture(el);
    expect(recordUnpaidDeparture.mock.calls[1]!.slice(0, 2)).toEqual([
      "v1",
      { expectedPartyRevision: 3, reason: "Ran off" },
    ]);
    expect(question.open).toBe(false);
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)).toBeNull();
    expect(api.openDrawer).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog and sends nothing", async () => {
    const { el } = await openDeparture();

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-departure-close]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(api.recordUnpaidDeparture).not.toHaveBeenCalled();
    expect(tableOrder(el)!.finishRefused).toBe(true);
  });
});

describe("till-app: cancelling and crediting an invoiced bill", () => {
  const invoiced: PartyBill = {
    ...checkBill,
    status: "placed",
    receiptAvailable: true,
    receiptLanguage: "es",
    invoiceNumber: "A/12",
    creditNotes: [],
  };
  const cancelled: PartyBill = {
    ...invoiced,
    status: "abandoned",
    outstanding: "0.00",
    creditNotes: ["R/3"],
  };
  const dialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillCancelCreditDialog>("till-cancel-credit-dialog");
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog[data-cancel-credit-approval]",
    );
  const bottom = (el: TillApp) =>
    dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!
      .error;
  const doneText = (el: TillApp) =>
    dialog(el)!
      .shadowRoot!.querySelector("[data-cancel-credit-done]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;
  const offered = (el: TillApp) =>
    tableOrder(el)!.shadowRoot!.querySelector('[data-bill="wo-check"] [data-cancel-credit]');

  /** The server's side of the party's bills: `cancelOrder` cancels the bill unless it rejects. */
  function billServer(cancel: (id: string) => Promise<void> = async () => {}) {
    let bills: PartyBill[] = [tabBill, invoiced];
    let readsFail = false;
    return {
      getPartyBills: vi.fn(async () => {
        if (readsFail) throw new TypeError("Failed to fetch");
        return bills;
      }),
      cancelOrder: vi.fn(async (id: string) => {
        await cancel(id);
        bills = [tabBill, cancelled];
      }),
      cancelBehindTheScenes: () => {
        bills = [tabBill, cancelled];
      },
      failReads: () => {
        readsFail = true;
      },
    };
  }

  /** The table is opened and the invoiced bill's Cancel and credit is pressed. */
  async function openCancel(overrides: Record<string, unknown> = {}) {
    const mounted = await mountApp({
      listCancelCreditAuthorizers: vi
        .fn()
        .mockResolvedValue([{ personId: "sup-1", displayName: "Luis" }]),
      ...billServer(),
      ...overrides,
    });
    await openMesa(mounted.el);
    await pressCancelCredit(mounted.el);
    return mounted;
  }

  /** The open table's drawer shows its bills, and the invoiced bill's Cancel and credit is pressed. */
  async function pressCancelCredit(el: TillApp): Promise<void> {
    const screen = tableOrder(el)!.shadowRoot!;
    if (screen.querySelector("[data-drawer]") === null) {
      screen.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await flush(el);
    }
    screen.querySelector<HTMLElement>('[data-bill="wo-check"] [data-cancel-credit]')!.click();
    await flush(el);
  }

  async function typeReason(el: TillApp, reason: string): Promise<void> {
    const input = dialog(el)!
      .shadowRoot!.querySelector('wt-input[name="reason"]')!
      .shadowRoot!.querySelector("input")!;
    input.value = reason;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
  }

  async function confirmCancel(el: TillApp): Promise<void> {
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]")!.click();
    await flush(el, 6);
  }

  it("opens over the table naming the bill's invoice and amount, and sends nothing yet", async () => {
    const { el } = await openCancel();

    expect(dialog(el)!.invoiceNumber).toBe("A/12");
    expect(dialog(el)!.amount).toBe("30.00");
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it("with the permission, sends the reason alone and names the credit note the bills now carry", async () => {
    const { el } = await openCancel();

    await typeReason(el, "  Charged to the wrong table ");
    await confirmCancel(el);

    expect(api.cancelOrder).toHaveBeenCalledOnce();
    expect(vi.mocked(api.cancelOrder).mock.calls[0]).toEqual([
      "wo-check",
      "Charged to the wrong table",
      undefined,
      { signal: expect.any(AbortSignal) },
    ]);
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
    expect(offered(el)).toBeNull();

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    await flush(el);
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el)).not.toBeNull();
  });

  it("without the permission, asks someone who may issue credit notes for their PIN and sends it with the same reason", async () => {
    let refuse = true;
    const server = billServer(async () => {
      if (refuse) {
        refuse = false;
        throw { code: "authorization.not_permitted", status: 403 };
      }
    });
    const { el } = await openCancel({ ...server, openDrawer: vi.fn() });

    await typeReason(el, "Wrong table");
    await confirmCancel(el);

    expect(api.listCancelCreditAuthorizers).toHaveBeenCalledOnce();
    expect(approval(el)!.authorizers).toEqual([{ personId: "sup-1", displayName: "Luis" }]);
    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(server.cancelOrder.mock.calls[1]).toEqual([
      "wo-check",
      "Wrong table",
      { personId: "sup-1", pin: "4321" },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(approval(el)).toBeNull();
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
    expect(api.openDrawer).not.toHaveBeenCalled();
  });

  it("shows a wrong PIN in the PIN prompt, and sends nothing more", async () => {
    let sends = 0;
    const server = billServer(async () => {
      sends++;
      throw sends === 1
        ? { code: "authorization.not_permitted", status: 403 }
        : { code: "pin.invalid", status: 401 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);

    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "0000" });
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(approval(el)!.error).toBe("pin.invalid");
    expect(doneText(el)).toBeNull();
  });

  it("Cancel on the PIN prompt closes it, leaves the dialog open and sends nothing more", async () => {
    const server = billServer(async () => {
      throw { code: "authorization.not_permitted", status: 403 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);

    emit(approval(el)!, "override-cancel");
    await flush(el);

    expect(approval(el)).toBeNull();
    expect(dialog(el)).not.toBeNull();
    expect(server.cancelOrder).toHaveBeenCalledOnce();
  });

  it("says who can approve it could not be read, and opens no PIN prompt", async () => {
    const { el } = await openCancel({
      ...billServer(async () => {
        throw { code: "authorization.not_permitted", status: 403 };
      }),
      listCancelCreditAuthorizers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(approval(el)).toBeNull();
    expect(bottom(el)).toBe(t("cancel_credit.approvers_failed"));
  });

  it.each([
    ["bill.payments_received", "cancel_credit.refused_payments"],
    ["order.payment_in_flight", "cancel_credit.refused_payment_in_flight"],
    ["series.no_rectificative_for_node", null],
    ["device.unauthorized", null],
    ["sale.correction_exceeds_total", null],
    ["sale.correction_not_whole", null],
    ["working_order.not_placed", null],
  ] as const)(
    "keeps the dialog open with %s's sentence, and reads the bills again",
    async (code, key) => {
      const server = billServer(async () => {
        throw { code, status: 409 };
      });
      const { el } = await openCancel(server);
      const billReads = server.getPartyBills.mock.calls.length;
      await typeReason(el, "Wrong table");

      await confirmCancel(el);

      expect(server.cancelOrder).toHaveBeenCalledOnce();
      expect(bottom(el)).toBe(key === null ? codeMessage(code) : t(key));
      expect(doneText(el)).toBeNull();
      expect(server.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
    },
  );

  it("when the cancel got no answer and the bills read again show it cancelled, says so without sending it again", async () => {
    const server = billServer();
    server.cancelOrder.mockImplementationOnce(async () => {
      server.cancelBehindTheScenes();
      throw new TypeError("Failed to fetch");
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
  });

  it("when the cancel got no answer and the bill still waits for payment, says it may have been made, without sending it again", async () => {
    const server = billServer();
    server.cancelOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(bottom(el)).toBe(t("cancel_credit.unconfirmed"));
    expect(doneText(el)).toBeNull();
  });

  it("a second press refused as no longer waiting, once the first cancel that got no answer has landed, names the credit note", async () => {
    const server = billServer();
    server.cancelOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    server.cancelOrder.mockImplementationOnce(async () => {
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);
    expect(bottom(el)).toBe(t("cancel_credit.unconfirmed"));

    server.cancelBehindTheScenes();
    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
  });

  it("a cancel refused as no longer waiting shows that refusal when the bills cannot be read again", async () => {
    const server = billServer(async () => {
      server.cancelBehindTheScenes();
      server.failReads();
      throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(bottom(el)).toBe(codeMessage("working_order.not_placed"));
    expect(doneText(el)).toBeNull();
  });

  it("when the bills cannot be read after the cancel, still says the bill is cancelled and offers no cancel again", async () => {
    const server = billServer();
    server.cancelOrder.mockImplementationOnce(async () => server.failReads());
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(offered(el)).toBeNull();
  });

  it("shows a completed table cancel while the credit-note read has not answered", async () => {
    const server = billServer();
    const { el } = await openCancel(server);
    server.getPartyBills.mockImplementationOnce(() => new Promise<PartyBill[]>(() => undefined));
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(dialog(el)!.busy).toBe(false);
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
  });

  it("shows a table cancel refusal while the follow-up bills read has not answered", async () => {
    const server = billServer(async () => {
      throw { code: "bill.payments_received", status: 409 };
    });
    const { el } = await openCancel(server);
    server.getPartyBills.mockImplementationOnce(() => new Promise<PartyBill[]>(() => undefined));
    await typeReason(el, "Wrong table");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(dialog(el)!.busy).toBe(false);
    expect(bottom(el)).toBe(t("cancel_credit.refused_payments"));
  });

  it("keeps the retry's credit note number when the earlier bills read answers late", async () => {
    let sends = 0;
    const server = billServer(async () => {
      sends++;
      if (sends === 1) throw { code: "working_order.not_placed", status: 409 };
    });
    const { el } = await openCancel(server);
    let answerFirst: (bills: PartyBill[]) => void = () => undefined;
    server.getPartyBills.mockImplementationOnce(
      () => new Promise<PartyBill[]>((resolve) => (answerFirst = resolve)),
    );
    await typeReason(el, "Wrong table");

    await confirmCancel(el);
    expect(dialog(el)!.busy).toBe(false);
    expect(dialog(el)!.refusal).not.toBeNull();

    await confirmCancel(el);
    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));

    answerFirst([tabBill, { ...cancelled, creditNotes: [] }]);
    await flush(el, 5);

    expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
  });

  it("an earlier operator's cancel answering after a sign-out leaves the next operator's PIN prompt open", async () => {
    let sends = 0;
    let answerFirst: () => void = () => undefined;
    const server = billServer(async () => {
      sends++;
      if (sends === 1) await new Promise<void>((resolve) => (answerFirst = resolve));
      else throw { code: "authorization.not_permitted", status: 403 };
    });
    const { el } = await openCancel(server);
    await typeReason(el, "Wrong table");
    await confirmCancel(el);
    emit(tableOrder(el)!, "logout");
    await flush(el);
    expect(dialog(el)).toBeNull();
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
    await flush(el);
    await pressCancelCredit(el);
    await typeReason(el, "Charged to the wrong table");
    await confirmCancel(el);
    expect(approval(el)).not.toBeNull();

    answerFirst();
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(approval(el)).not.toBeNull();
    expect(dialog(el)!.done).toBeNull();
  });

  describe("a cancel that gets no answer at all", () => {
    afterEach(() => vi.useRealTimers());

    /** A cancel that never answers, and rejects as `fetch` does once its signal aborts, after
     * `meanwhile` runs. */
    function unanswered(meanwhile: () => void = () => undefined) {
      return vi.fn(
        (_id: string, _reason: string, _override?: unknown, options?: { signal?: AbortSignal }) =>
          new Promise<void>((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () => {
              meanwhile();
              reject(new DOMException("aborted", "AbortError"));
            }),
          ),
      );
    }

    it("is given up at the time limit, the bills are read again, and the operator may try again while the bill still waits", async () => {
      const server = billServer();
      const cancelOrder = unanswered();
      const { el } = await openCancel({ ...server, cancelOrder });
      await typeReason(el, "Wrong table");
      const billReads = server.getPartyBills.mock.calls.length;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await confirmCancel(el);
      expect(dialog(el)!.busy).toBe(true);

      await vi.advanceTimersByTimeAsync(150_000);
      await flush(el, 6);

      expect(cancelOrder).toHaveBeenCalledOnce();
      expect(cancelOrder.mock.calls[0]![3]).toEqual({ signal: expect.any(AbortSignal) });
      expect(server.getPartyBills).toHaveBeenCalledTimes(billReads + 1);
      expect(dialog(el)!.busy).toBe(false);
      expect(bottom(el)).toBe(t("cancel_credit.unconfirmed"));
      expect(
        dialog(el)!.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
          "[data-cancel-credit-confirm]",
        )!.disabled,
      ).toBe(false);
    });

    it("is given up at the time limit, and a bill the bills read again show cancelled is shown cancelled", async () => {
      const server = billServer();
      const cancelOrder = unanswered(() => server.cancelBehindTheScenes());
      const { el } = await openCancel({ ...server, cancelOrder });
      await typeReason(el, "Wrong table");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await confirmCancel(el);

      await vi.advanceTimersByTimeAsync(150_000);
      await flush(el, 6);

      expect(cancelOrder).toHaveBeenCalledOnce();
      expect(doneText(el)).toBe(t("cancel_credit.done").replace("{number}", "R/3"));
    });
  });

  it("an accepted table credit clears unload protection before its bill refresh starts", async () => {
    const { el } = await openCancel();
    await typeReason(el, "  Wrong table  ");
    let protectedAtRefresh: boolean | undefined;
    vi.mocked(api.getPartyBills).mockImplementation(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      protectedAtRefresh = event.defaultPrevented;
      return new Promise(() => {});
    });
    await confirmCancel(el);
    expect(protectedAtRefresh).toBe(false);
    expect(vi.mocked(api.cancelOrder).mock.calls).toEqual([
      ["wo-check", "Wrong table", undefined, { signal: expect.any(AbortSignal) }],
    ]);
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });

  for (const action of ["Keep the bill", "Escape"]) {
    it(`table cancel-credit ${action} discards only the local reason and keeps both bills`, async () => {
      const { el } = await openCancel();
      await typeReason(el, "  Wrong table  ");
      if (action === "Escape") {
        dialog(el)!
          .shadowRoot!.querySelector("wt-input")!
          .shadowRoot!.querySelector("input")!
          .focus();
        await userEvent.keyboard("{Escape}");
      } else
        dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
      await flush(el);
      const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
      await q.updateComplete;
      expect(q.open).toBe(true);
      expect(api.cancelOrder).not.toHaveBeenCalled();
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(dialog(el)!.shadowRoot!.querySelector("wt-input")!.value).toBe("  Wrong table  ");
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
      await flush(el);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => dialog(el)).toBeNull();
      expect(tableOrder(el)).not.toBeNull();
      expect(tableOrder(el)!.bills).toEqual([tabBill, invoiced]);
      expect(api.cancelOrder).not.toHaveBeenCalled();
      expect(api.listCancelCreditAuthorizers).not.toHaveBeenCalled();
    });
  }

  it("Cancel closes the dialog and sends nothing", async () => {
    const { el } = await openCancel();

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });
});

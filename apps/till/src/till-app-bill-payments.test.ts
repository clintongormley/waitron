import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import {
  adjustmentStubs,
  cleanupWidgets,
  draftServer,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillBillPayDialog } from "./widgets/bill-pay-dialog.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  AllocationPreview,
  BillBalance,
  BillPaymentRequest,
  BillPaymentResult,
  BillPaymentView,
  CurrentOrders,
  FloorZone,
  OrderGroup,
  PartyBill,
  TabLine,
  TableParty,
  TableState,
  TillApi,
  TillSaleResult,
  ZoneOfferCatalogue,
} from "./api/client.js";

// A table's bill paid in parts through the bill payment dialog (plan Task 15, design §12): the
// dialog asks the server for each allocation, shows it, takes it, and the bill's balance follows.

const zone: FloorZone = { id: "z1", name: "Comedor", displayOrder: 0, active: true };

function partyOf(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "v1",
    revision: 3,
    guestCount: 4,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
    outstanding: "120.00",
    billCount: 1,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function mesa(partyOver: Partial<TableParty> = {}): TableState {
  return {
    id: "t4",
    label: "4",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 4,
    tabTotal: "120.00",
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
    party: partyOf(partyOver),
  };
}

function billOf(over: Partial<PartyBill> = {}): PartyBill {
  return {
    workingOrderId: "wo-4",
    partyId: "v1",
    label: null,
    status: "open",
    total: "120.00",
    outstanding: "120.00",
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}

function line(over: Partial<TabLine>): TabLine {
  return {
    id: `line-${over.lineNo}`,
    groupId: null,
    lineNo: 1,
    productId: "p",
    quantity: "1.000",
    unitPrecision: 0,
    unitPriceGross: "1.00",
    servedAt: null,
    courseId: null,
    sentAt: "2026-09-30T19:00:00.000Z",
    firedAt: "2026-09-30T19:00:00.000Z",
    state: "queued",
    note: null,
    listId: null,
    menuItemId: null,
    parentProductId: null,
    ...over,
  };
}

// The owner's €120.00 bill: Paella, Chuletón, Ensalada, and two items a guest takes onto a bill of
// their own, Tarta and Vino, €30.00 between them.
const paella = line({ lineNo: 1, name: "Paella", unitPriceGross: "40.00" });
const chuleton = line({ lineNo: 2, name: "Chuletón", unitPriceGross: "35.00" });
const ensalada = line({ lineNo: 3, name: "Ensalada", unitPriceGross: "15.00" });
const tarta = line({ lineNo: 4, name: "Tarta", unitPriceGross: "12.00" });
const vino = line({ lineNo: 5, name: "Vino", unitPriceGross: "18.00" });
const bill120 = [paella, chuleton, ensalada, tarta, vino];

function balanceOf(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "120.00",
    received: "0.00",
    reserved: "0.00",
    outstanding: "120.00",
    tips: "0.00",
    payments: [],
    paidLines: [],
    ...over,
  };
}

function paymentOf(over: Partial<BillPaymentView> = {}): BillPaymentView {
  return {
    id: "pay-1",
    submissionId: "sub-1",
    kind: "contribution",
    shareOf: null,
    method: "cash",
    applied: "50.00",
    tip: "0.00",
    tendered: "50.00",
    change: "0.00",
    state: "received",
    createdAt: "2026-09-30T20:00:00.000Z",
    receivedAt: "2026-09-30T20:00:00.000Z",
    lines: [],
    refunds: [],
    ...over,
  };
}

function takenOf(
  payment: Partial<BillPaymentView>,
  balance: Partial<BillBalance>,
  invoice?: TillSaleResult,
): BillPaymentResult {
  return {
    outcome: "received",
    payment: paymentOf(payment),
    balance: balanceOf(balance),
    ...(invoice === undefined ? {} : { invoice }),
  };
}

const cash = (applied: string, change: string, tip = "0.00"): AllocationPreview => ({
  kind: "allocated",
  choice: null,
  applied,
  tip,
  change,
  charged: null,
});

const invoiceOf = (total: string): TillSaleResult => ({
  orderLabel: "4",
  orderNumber: 7,
  invoiceNumber: "F-0007",
  issuedAt: "2026-09-30T20:30:00.000Z",
  total,
  vatBreakdown: [{ rate: "10", base: "27.27", tax: "2.73" }],
  lines: [{ descriptions: { "es-ES": "Tarta" }, quantity: "1", gross: "12.00" }],
  tender: { method: "cash", change: "0.00" },
  payments: [
    { method: "cash", amount: total, tip: "0.00", tendered: total, change: "0.00", refunds: [] },
  ],
  qr: "https://example.test/vf?nif=B1&num=F-0007&fecha=30-09-2026&total=30.00",
});

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
  tipsEnabled: true,
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

let drafts: DraftServer;
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
    getTablesState: vi.fn().mockResolvedValue([mesa()]),
    listZones: vi.fn().mockResolvedValue([zone]),
    listStatuses: vi.fn().mockResolvedValue([]),
    getPartyBills: vi.fn().mockResolvedValue([billOf()]),
    getTabLines: vi.fn().mockResolvedValue({ lines: bill120, revision: 0, editSentLines: true }),
    listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
    splitBill: vi.fn().mockResolvedValue({ billId: "wo-check" }),
    recordSale: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    collectOrder: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    pay: vi.fn().mockRejectedValue({ code: "bill.payments_received" }),
    getBillBalance: vi.fn().mockResolvedValue(balanceOf()),
    previewBillPayment: vi.fn().mockResolvedValue(cash("40.00", "10.00")),
    takeBillPayment: vi.fn(),
    reprint: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...adjustmentStubs(),
    listDrafts: drafts.listDrafts,
    saveDraft: drafts.saveDraft,
    submitDraft: drafts.submitDraft,
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

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const money = (amount: string) => formatMoney(amount, currentLocale());
const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen")!;
const shell = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>("till-tab-shell")!;
const floor = (el: TillApp) =>
  el
    .shadowRoot!.querySelector<HTMLElement>("till-card-grid")!
    .shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen")!;
const tableOrder = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillBillPayDialog>("till-bill-pay-dialog");
const inDialog = (el: TillApp, selector: string) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string; disabled: boolean }>(
    selector,
  );
const shownBalance = (el: TillApp) => ({
  total: text(inDialog(el, "[data-pay-total] dd")),
  received: text(inDialog(el, "[data-pay-received] dd")),
  reserved: text(inDialog(el, "[data-pay-reserved] dd")),
  outstanding: text(inDialog(el, "[data-pay-outstanding] dd")),
});
const balanceShows = (total: string, received: string, outstanding: string, reserved = "0.00") => ({
  total: money(total),
  received: money(received),
  reserved: money(reserved),
  outstanding: money(outstanding),
});
const sent = (): BillPaymentRequest[] =>
  vi.mocked(api.takeBillPayment).mock.calls.map(([, request]) => request);

async function openTable(el: TillApp): Promise<TillTableOrderScreen> {
  await flush(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  emit(shell(el), "tab-select", { key: "floor" });
  await flush(el);
  emit(floor(el), "open-table", { tableId: "t4", seated: true });
  await flush(el);
  const order = tableOrder(el);
  order.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
  await flush(el);
  return order;
}

async function openDialog(el: TillApp, way: "items" | "contribution" | "share" | "rest") {
  const order = tableOrder(el);
  const selector = way === "rest" ? "[data-pay-rest]" : `[data-open-bill-pay="${way}"]`;
  order.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await flush(el);
}

async function type(el: TillApp, name: string, value: string): Promise<void> {
  const input = inDialog(el, `wt-input[name="${name}"]`)!.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await flush(el);
}

async function press(el: TillApp, selector: string): Promise<void> {
  inDialog(el, selector)!.click();
  await flush(el);
}

beforeEach(() => {
  setLocale("en");
  drafts = draftServer();
});
afterEach(cleanupWidgets);

describe("till-app: the three ways to pay part of a bill", () => {
  it("pays for chosen items, then a contribution, then an equal share, showing the balance after each", async () => {
    const paidPaella = [{ lineId: "line-1", lineNo: 1, paidQuantity: "1.000" }];
    const answers = [
      takenOf(
        { kind: "items", applied: "40.00", tendered: "50.00", change: "10.00" },
        { received: "40.00", outstanding: "80.00", paidLines: paidPaella },
      ),
      takenOf(
        { applied: "20.00", tendered: "20.00" },
        { received: "60.00", outstanding: "60.00", paidLines: paidPaella },
      ),
      takenOf(
        { kind: "share", shareOf: 3, applied: "20.00", tendered: "20.00" },
        { received: "80.00", outstanding: "40.00", paidLines: paidPaella },
      ),
    ];
    // The server's side: each payment taken is what the bill and its balance read afterwards.
    let latest = balanceOf();
    const takeBillPayment = vi.fn(async () => {
      const answer = answers.shift()!;
      latest = answer.balance;
      return answer;
    });
    const previewBillPayment = vi
      .fn()
      .mockResolvedValueOnce(cash("40.00", "10.00"))
      .mockResolvedValueOnce(cash("20.00", "0.00"))
      .mockResolvedValueOnce(cash("20.00", "0.00"));
    const getBillBalance = vi.fn(async () => latest);
    const getPartyBills = vi.fn(async () => [
      billOf({ outstanding: latest.outstanding, hasPayments: latest.received !== "0.00" }),
    ]);
    const { el } = await mountApp({
      takeBillPayment,
      previewBillPayment,
      getBillBalance,
      getPartyBills,
    });
    await openTable(el);

    await openDialog(el, "items");
    expect(api.getBillBalance).toHaveBeenCalledWith("wo-4");
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "0.00", "120.00"));
    await press(el, 'input[name="line"][value="1"]');
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "40.00", "80.00"));
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
      t("bill_pay.taken_change").replace("{amount}", money("10.00")),
    );
    expect(dialog(el)!.shadowRoot!.querySelector('input[name="line"][value="1"]')).toBeNull();

    await press(el, 'input[name="way"][value="contribution"]');
    await type(el, "amount", "20");
    await type(el, "tendered", "20");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "60.00", "60.00"));

    await press(el, 'input[name="way"][value="share"]');
    await type(el, "people", "3");
    await type(el, "tendered", "20");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "80.00", "40.00"));

    expect(previewBillPayment.mock.calls.map(([billId, ask]) => [billId, ask])).toEqual([
      ["wo-4", { kind: "items", lines: [{ lineNo: 1 }], method: "cash", tendered: "50" }],
      ["wo-4", { kind: "contribution", amount: "20", method: "cash", tendered: "20" }],
      ["wo-4", { kind: "share", shareOf: 3, method: "cash", tendered: "20" }],
    ]);
    expect(sent()).toEqual([
      {
        kind: "items",
        lines: [{ lineNo: 1 }],
        method: "cash",
        tendered: "50",
        applied: "40.00",
        tip: "0.00",
        submissionId: expect.any(String),
      },
      {
        kind: "contribution",
        amount: "20",
        method: "cash",
        tendered: "20",
        applied: "20.00",
        tip: "0.00",
        submissionId: expect.any(String),
      },
      {
        kind: "share",
        shareOf: 3,
        method: "cash",
        tendered: "20",
        applied: "20.00",
        tip: "0.00",
        submissionId: expect.any(String),
      },
    ]);
    expect(new Set(sent().map((request) => request.submissionId)).size).toBe(3);
    expect(api.recordSale).not.toHaveBeenCalled();
    const paid = tableOrder(el).shadowRoot!.querySelector("[data-line-paid]");
    expect(text(paid)).toBe(t("bill_pay.paid"));
  });

  it("leaves all the change as a tip when the guest says so, and takes it", async () => {
    const previewBillPayment = vi
      .fn()
      .mockResolvedValueOnce(cash("40.00", "10.00"))
      .mockResolvedValueOnce(cash("40.00", "0.00", "10.00"));
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { applied: "40.00", tip: "10.00", change: "0.00" },
          { received: "40.00", outstanding: "80.00", tips: "10.00" },
        ),
      );
    const { el } = await mountApp({ previewBillPayment, takeBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");

    expect(text(inDialog(el, "[data-pay-change] dd"))).toBe(money("10.00"));
    await press(el, 'input[name="leaveTip"][value="all"]');
    expect(text(inDialog(el, "[data-pay-change] dd"))).toBe(money("0.00"));
    expect(text(inDialog(el, "[data-pay-tip] dd"))).toBe(money("10.00"));
    await press(el, "[data-pay-confirm]");

    expect(previewBillPayment.mock.calls[1]![1]).toEqual({
      kind: "contribution",
      amount: "40",
      method: "cash",
      tendered: "50",
      addedTip: "10.00",
    });
    expect(sent()[0]).toMatchObject({ addedTip: "10.00", applied: "40.00", tip: "10.00" });
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
  });

  it("shows a hand-keyed card's tip and charge before it is taken, and records it as a hand-keyed card", async () => {
    const previewBillPayment = vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "40.00",
      tip: "10.00",
      change: null,
      charged: "50.00",
    });
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { method: "card", applied: "40.00", tip: "10.00", tendered: null, change: null },
          { received: "40.00", outstanding: "80.00" },
        ),
      );
    const { el } = await mountApp({ previewBillPayment, takeBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await type(el, "cardTip", "10");
    await press(el, "[data-pay-continue]");

    expect(takeBillPayment).not.toHaveBeenCalled();
    expect(text(inDialog(el, "[data-pay-applied] dd"))).toBe(money("40.00"));
    expect(text(inDialog(el, "[data-pay-tip] dd"))).toBe(money("10.00"));
    expect(text(inDialog(el, "[data-pay-charged] dd"))).toBe(money("50.00"));
    await press(el, "[data-pay-confirm]");

    expect(previewBillPayment).toHaveBeenCalledWith("wo-4", {
      kind: "contribution",
      amount: "40",
      method: "card",
      addedTip: "10",
    });
    expect(sent()[0]).toEqual({
      kind: "contribution",
      amount: "40",
      method: "card",
      addedTip: "10",
      applied: "40.00",
      tip: "10.00",
      entry: "manual",
      submissionId: expect.any(String),
    });
  });
});

describe("till-app: a bill payment's refusals and retries", () => {
  it("reopens the confirmation with the new amounts when the bill changed, and sends nothing on its own", async () => {
    const changed = cash("30.00", "20.00");
    const takeBillPayment = vi
      .fn()
      .mockRejectedValueOnce({ code: "bill.allocation_changed", status: 409, preview: changed })
      .mockResolvedValueOnce(
        takenOf({ applied: "30.00", change: "20.00" }, { received: "120.00", outstanding: "0.00" }),
      );
    const getBillBalance = vi
      .fn()
      .mockResolvedValueOnce(balanceOf())
      .mockResolvedValue(balanceOf({ received: "90.00", outstanding: "30.00" }));
    const { el } = await mountApp({ takeBillPayment, getBillBalance });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(takeBillPayment).toHaveBeenCalledOnce();
    expect(text(inDialog(el, "[data-pay-applied] dd"))).toBe(money("30.00"));
    expect(text(inDialog(el, "[data-pay-change] dd"))).toBe(money("20.00"));
    expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("bill.allocation_changed"));
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "90.00", "30.00"));

    await press(el, "[data-pay-confirm]");
    expect(sent()[1]).toMatchObject({ applied: "30.00", tip: "0.00" });
    expect(sent()[1]!.submissionId).not.toBe(sent()[0]!.submissionId);
  });

  it("shows a refusal beside the action and reads the balance again", async () => {
    const takeBillPayment = vi.fn().mockRejectedValue({ code: "bill.line_paid", lineNo: 1 });
    const getBillBalance = vi
      .fn()
      .mockResolvedValueOnce(balanceOf())
      .mockResolvedValue(
        balanceOf({
          received: "40.00",
          outstanding: "80.00",
          paidLines: [{ lineId: "line-1", lineNo: 1, paidQuantity: "1.000" }],
        }),
      );
    const { el } = await mountApp({ takeBillPayment, getBillBalance });
    await openTable(el);
    await openDialog(el, "items");
    await press(el, 'input[name="line"][value="1"]');
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("bill.line_paid"));
    expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(false);
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "40.00", "80.00"));
    expect(dialog(el)!.shadowRoot!.querySelector('input[name="line"][value="1"]')).toBeNull();
  });

  it("reads the balance again after a refused preview", async () => {
    const previewBillPayment = vi.fn().mockRejectedValue({ code: "bill.nothing_outstanding" });
    const getBillBalance = vi
      .fn()
      .mockResolvedValueOnce(balanceOf())
      .mockResolvedValue(balanceOf({ received: "120.00", outstanding: "0.00" }));
    const { el } = await mountApp({ previewBillPayment, getBillBalance });
    await openTable(el);
    await openDialog(el, "share");
    await type(el, "people", "2");
    await type(el, "tendered", "60");
    await press(el, "[data-pay-continue]");

    expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("bill.nothing_outstanding"));
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "120.00", "0.00"));
  });

  it("sends a payment that got no answer again with the same submission id", async () => {
    const takeBillPayment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        takenOf({ applied: "40.00", change: "10.00" }, { received: "40.00", outstanding: "80.00" }),
      );
    const { el } = await mountApp({ takeBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await expect.poll(() => takeBillPayment.mock.calls.length, { timeout: 5_000 }).toBe(2);
    await expect.poll(() => text(inDialog(el, "[data-pay-taken]"))).not.toBe("");
    expect(sent()[1]).toEqual(sent()[0]);
  });

  it("offers to take a payment that never got an answer again, under the same submission id", async () => {
    const takeBillPayment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({ takeBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    await expect
      .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));
    const first = takeBillPayment.mock.calls.length;
    takeBillPayment.mockResolvedValueOnce(
      takenOf({ applied: "40.00", change: "10.00" }, { received: "40.00", outstanding: "80.00" }),
    );
    await press(el, "[data-pay-confirm]");

    await expect.poll(() => takeBillPayment.mock.calls.length).toBe(first + 1);
    expect(new Set(sent().map((request) => request.submissionId)).size).toBe(1);
  });
});

describe("till-app: the bill payment dialog's own steps", () => {
  it("goes back from the confirmation to the form and asks again", async () => {
    const { el } = await mountApp();
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-back]");

    expect(inDialog(el, "[data-pay-confirm]")).toBeNull();
    await press(el, "[data-pay-continue]");
    expect(api.previewBillPayment).toHaveBeenCalledTimes(2);
    expect(inDialog(el, "[data-pay-confirm]")).not.toBeNull();
  });

  it("opens one dialog for two presses, and asks once for two presses of Continue", async () => {
    let answer: (preview: AllocationPreview) => void = () => {};
    const previewBillPayment = vi.fn(
      () => new Promise<AllocationPreview>((resolve) => (answer = resolve)),
    );
    const { el } = await mountApp({ previewBillPayment });
    const order = await openTable(el);
    emit(order, "bill-pay", { way: "contribution", lines: [] });
    emit(order, "bill-pay", { way: "share", lines: [] });
    await flush(el);
    const asked = {
      choice: { kind: "contribution", amount: "40" },
      pay: { method: "cash", tendered: "50" },
    };

    emit(dialog(el)!, "bill-pay-preview", asked);
    emit(dialog(el)!, "bill-pay-preview", asked);
    answer(cash("40.00", "10.00"));
    await flush(el);

    expect(el.shadowRoot!.querySelectorAll("till-bill-pay-dialog")).toHaveLength(1);
    expect(api.getBillBalance).toHaveBeenCalledOnce();
    expect(previewBillPayment).toHaveBeenCalledOnce();
    emit(dialog(el)!, "bill-pay-confirm");
    emit(dialog(el)!, "bill-pay-confirm");
    await flush(el);
    expect(api.takeBillPayment).toHaveBeenCalledOnce();
  });

  it.each([
    ["an allocation", "resolve"],
    ["a refusal", "reject"],
  ] as const)(
    "changes nothing when %s arrives after the operator has logged out",
    async (_case, settle) => {
      let answer: { resolve: (value: unknown) => void; reject: (error: unknown) => void } = {
        resolve: () => {},
        reject: () => {},
      };
      const previewBillPayment = vi.fn(
        () => new Promise((resolve, reject) => (answer = { resolve, reject })),
      );
      const { el } = await mountApp({ previewBillPayment });
      await openTable(el);
      await openDialog(el, "contribution");
      await type(el, "amount", "40");
      await type(el, "tendered", "50");
      await press(el, "[data-pay-continue]");
      const balanceReads = vi.mocked(api.getBillBalance).mock.calls.length;

      emit(tableOrder(el), "logout");
      await flush(el);
      if (settle === "resolve") answer.resolve(cash("40.00", "10.00"));
      else answer.reject({ code: "bill.nothing_outstanding" });
      await flush(el);

      expect(dialog(el)).toBeNull();
      expect(api.getBillBalance).toHaveBeenCalledTimes(balanceReads);
    },
  );

  it("says when the bill's payments cannot be read", async () => {
    const { el } = await mountApp({
      getBillBalance: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    await openTable(el);
    await openDialog(el, "items");

    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("bill_pay.read_failed"));
    expect(text(inDialog(el, "[data-pay-balance]"))).toBe(t("bill_pay.reading"));
  });

  it("puts a refusal of the cash handed over under that field", async () => {
    const { el } = await mountApp({
      previewBillPayment: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", field: "tendered" }),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "30");
    await press(el, "[data-pay-continue]");

    expect(inDialog(el, 'wt-input[name="tendered"]')!.error).toBe(t("bill_pay.tendered_short"));
  });
});

describe("till-app: a bill that already holds money", () => {
  const partly = billOf({ outstanding: "70.00", hasPayments: true });
  const heldMoney = balanceOf({
    received: "50.00",
    outstanding: "70.00",
    payments: [paymentOf()],
  });

  it("takes the rest through the bill's payments from the sentence, and never as a single sale", async () => {
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { applied: "70.00", tendered: "70.00" },
          { received: "120.00", outstanding: "0.00", status: "settled" },
          invoiceOf("120.00"),
        ),
      );
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn().mockResolvedValue(heldMoney),
      previewBillPayment: vi.fn().mockResolvedValue(cash("70.00", "0.00")),
      takeBillPayment,
    });
    await openTable(el);
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-received]"))).toContain(
      money("50.00"),
    );

    await openDialog(el, "rest");
    expect(
      dialog(el)!.shadowRoot!.querySelector<HTMLElement & { value: string }>(
        'wt-input[name="amount"]',
      )!.value,
    ).toBe("70.00");
    await type(el, "tendered", "70");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(api.recordSale).not.toHaveBeenCalled();
    expect(api.collectOrder).not.toHaveBeenCalled();
    expect(api.pay).not.toHaveBeenCalled();
    expect(takeBillPayment).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
    const ticket = el.shadowRoot!.querySelector<HTMLElement & { result: TillSaleResult }>(
      "till-ticket-view",
    )!;
    expect(ticket.result.invoiceNumber).toBe("F-0007");
  });

  it("marks nothing paid and says nothing received when the bill's payments cannot be read", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const order = await openTable(el);
    expect(order.shadowRoot!.querySelector("[data-bill-received]")).toBeNull();
    expect(order.shadowRoot!.querySelector("[data-bill-payments]")).not.toBeNull();
  });

  it("does not offer a plain charge for such a bill", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn().mockResolvedValue(heldMoney),
    });
    const order = await openTable(el);
    expect(order.shadowRoot!.querySelector("till-tender-pay")).toBeNull();
  });
});

describe("till-app: the owner's split after a contribution", () => {
  it("moves two items to a bill of their own, pays it with its invoice at once, and leaves the original owing €40.00 with €50.00 still applied", async () => {
    const contribution = paymentOf({ applied: "50.00" });
    const original = { tabLines: [paella, chuleton, ensalada] };
    const moved = [
      line({ lineNo: 1, name: "Tarta", unitPriceGross: "12.00", id: "line-t" }),
      line({ lineNo: 2, name: "Vino", unitPriceGross: "18.00", id: "line-v" }),
    ];
    let split = false;
    const newBill = billOf({ workingOrderId: "wo-check", total: "30.00", outstanding: "30.00" });
    const getPartyBills = vi.fn(async () =>
      split
        ? [billOf({ total: "90.00", outstanding: "40.00", hasPayments: true }), newBill]
        : [billOf({ outstanding: "70.00", hasPayments: true })],
    );
    const getTabLines = vi.fn(async (billId: string) => ({
      lines: billId === "wo-check" ? moved : split ? original.tabLines : bill120,
      revision: 0,
      editSentLines: true,
    }));
    const getBillBalance = vi.fn(async (billId: string) =>
      billId === "wo-check"
        ? balanceOf({ workingOrderId: "wo-check", total: "30.00", outstanding: "30.00" })
        : balanceOf({
            total: split ? "90.00" : "120.00",
            received: "50.00",
            outstanding: split ? "40.00" : "70.00",
            payments: [contribution],
          }),
    );
    const splitBill = vi.fn(async () => {
      split = true;
      return { billId: "wo-check" };
    });
    const takeBillPayment = vi.fn().mockResolvedValue(
      takenOf(
        { kind: "items", applied: "30.00", tendered: "30.00" },
        {
          workingOrderId: "wo-check",
          total: "30.00",
          received: "30.00",
          outstanding: "0.00",
          status: "settled",
        },
        invoiceOf("30.00"),
      ),
    );
    const { el } = await mountApp({
      getPartyBills,
      getTabLines,
      getBillBalance,
      splitBill,
      previewBillPayment: vi.fn().mockResolvedValue(cash("30.00", "0.00")),
      takeBillPayment,
      getTablesState: vi.fn().mockResolvedValue([mesa({ billCount: 2, outstanding: "70.00" })]),
    });
    const order = await openTable(el);

    emit(order, "split-lines", { transfers: [{ lineNo: 4 }, { lineNo: 5 }] });
    await flush(el);
    expect(tableOrder(el).orderId).toBe("wo-check");
    await openDialog(el, "items");
    await press(el, 'input[name="line"][value="1"]');
    await press(el, 'input[name="line"][value="2"]');
    await type(el, "tendered", "30");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(takeBillPayment.mock.calls[0]![0]).toBe("wo-check");
    const ticket = el.shadowRoot!.querySelector<HTMLElement & { result: TillSaleResult }>(
      "till-ticket-view",
    )!;
    expect(ticket.result.total).toBe("30.00");

    emit(ticket, "new-sale");
    await flush(el);
    emit(shell(el), "tab-select", { key: "floor" });
    await flush(el);
    const back = await (async () => {
      emit(floor(el), "open-table", { tableId: "t4", seated: true });
      await flush(el);
      const screen = tableOrder(el);
      screen.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
      await flush(el);
      return screen;
    })();
    expect(back.orderId).toBe("wo-4");
    expect(text(back.shadowRoot!.querySelector("[data-bill-payments] .amount"))).toBe(
      t("table.bill_to_pay").replace("{amount}", money("40.00")),
    );
    await openDialog(el, "rest");
    expect(shownBalance(el)).toEqual(balanceShows("90.00", "50.00", "40.00"));
  });
});

describe("till-app: a guest leaving early pays for a held dish", () => {
  it("pays for one held Tiramisu on the table's own bill, which stays held in Current orders, marked paid, and is not offered again", async () => {
    const tiramisu = line({
      lineNo: 6,
      name: "Tiramisu",
      unitPriceGross: "6.00",
      groupId: "g-2",
      sentAt: null,
      firedAt: null,
      state: null,
    });
    const held: OrderGroup = {
      id: "g-2",
      position: 2,
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: [tiramisu.id],
      summary: "1 × Tiramisu",
    };
    const currentOrders: CurrentOrders = {
      revision: 3,
      reminder: null,
      groups: [
        {
          id: "g-2",
          position: 2,
          state: "held",
          firedAt: null,
          remindAt: null,
          sentAt: "2026-09-30T19:00:00.000Z",
          sentBy: "Ana",
          rows: [
            {
              lineId: tiramisu.id,
              workingOrderId: "wo-4",
              lineNo: 6,
              name: "Tiramisu",
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
    let paid = false;
    const paidTiramisu = [{ lineId: tiramisu.id, lineNo: 6, paidQuantity: "1.000" }];
    const { el } = await mountApp({
      getTabLines: vi.fn().mockResolvedValue({
        lines: [...bill120, tiramisu],
        revision: 0,
        editSentLines: true,
      }),
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [held] }),
      readCurrentOrders: vi.fn().mockResolvedValue(currentOrders),
      getPartyBills: vi.fn(async () => [
        billOf({ total: "126.00", outstanding: paid ? "120.00" : "126.00", hasPayments: paid }),
      ]),
      getBillBalance: vi.fn(async () =>
        balanceOf({
          total: "126.00",
          received: paid ? "6.00" : "0.00",
          outstanding: paid ? "120.00" : "126.00",
          paidLines: paid ? paidTiramisu : [],
        }),
      ),
      previewBillPayment: vi.fn().mockResolvedValue(cash("6.00", "4.00")),
      takeBillPayment: vi.fn(async () => {
        paid = true;
        return takenOf(
          { kind: "items", applied: "6.00", tendered: "10.00", change: "4.00" },
          { total: "126.00", received: "6.00", outstanding: "120.00", paidLines: paidTiramisu },
        );
      }),
    });
    await openTable(el);

    await openDialog(el, "items");
    await press(el, 'input[name="line"][value="6"]');
    await type(el, "tendered", "10");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(sent()[0]).toMatchObject({ kind: "items", lines: [{ lineNo: 6 }] });
    expect(dialog(el)!.shadowRoot!.querySelector('input[name="line"][value="6"]')).toBeNull();
    await press(el, "[data-pay-close]");
    const group = tableOrder(el).shadowRoot!.querySelector<HTMLElement>('[data-group="g-2"]')!;
    expect(group.dataset.groupState).toBe("held");
    expect(text(group.querySelector(`[data-group-line="${tiramisu.id}"] [data-line-paid]`))).toBe(
      t("bill_pay.paid"),
    );
    await openDialog(el, "items");
    expect(dialog(el)!.shadowRoot!.querySelector('input[name="line"][value="6"]')).toBeNull();
    expect(api.recordSale).not.toHaveBeenCalled();
  });
});

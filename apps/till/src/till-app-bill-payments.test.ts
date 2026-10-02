import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@waitron/shared";
import {
  adjustmentStubs,
  cancelThroughDialog,
  cleanupWidgets,
  draftServer,
  expectNoA11yViolations,
  mountWidget,
  type DraftServer,
} from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { SUBMIT_RETRY_PAUSE_MS } from "./state/draft-sync.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillBillPayDialog } from "./widgets/bill-pay-dialog.js";
import type { TillBillRefundDialog } from "./widgets/bill-refund-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  AllocationPreview,
  BillBalance,
  BillPaymentRequest,
  BillPaymentResult,
  BillPaymentView,
  BillRefundRequest,
  BillRefundResult,
  BillRefundView,
  CurrentOrders,
  FloorZone,
  HeldOrderSummary,
  OrderGroup,
  PartyBill,
  TabLine,
  TableParty,
  TableState,
  TillApi,
  TillProduct,
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
    entry: null,
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
    listCounterWaiting: vi.fn().mockResolvedValue([]),
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

async function mountApp(overrides: Record<string, unknown> = {}, theme?: "light" | "dark") {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api }, theme);
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
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
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
  it("asks where to make a bill dish before previewing a payment", async () => {
    const askOrderDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      revision: 2,
      deadEnds: [
        {
          key: "line-1",
          name: "Paella",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const setMakeAt = vi.fn().mockResolvedValue({ revision: 3 });
    const previewBillPayment = vi.fn().mockResolvedValue(cash("40.00", "10.00"));
    const { el } = await mountApp({ askOrderDeadEnds, setMakeAt, previewBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    emit(dialog(el)!, "bill-pay-preview", {
      choice: { kind: "contribution", amount: "40" },
      pay: { method: "cash", tendered: "50" },
    });
    await flush(el);
    expect(askOrderDeadEnds).toHaveBeenCalledWith("wo-4", undefined);
    expect(previewBillPayment).not.toHaveBeenCalled();
    const question = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(question).not.toBeNull();
    question
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(
        new CustomEvent("make-at", { detail: { key: "line-1", stationId: "kitchen" } }),
      );
    await (question as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(setMakeAt).toHaveBeenCalledWith("wo-4", 2, { "line-1": "kitchen" });
    expect(previewBillPayment).toHaveBeenCalledOnce();
    expect(setMakeAt.mock.invocationCallOrder[0]!).toBeLessThan(
      previewBillPayment.mock.invocationCallOrder[0]!,
    );
  });
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

  it("shows a refusal above the action and reads the balance again", async () => {
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

  it("says the operator may not take payments when the server refuses them the payment permission", async () => {
    const takeBillPayment = vi.fn().mockRejectedValue({
      code: "authorization.not_permitted",
      status: 403,
      permission: "sale.take_payment",
    });
    const { el } = await mountApp({ takeBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("take_payment.not_permitted"));
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

describe("till-app: the bill's balance is read once for each answer", () => {
  const partly = billOf({ outstanding: "70.00", hasPayments: true });
  const heldMoney = balanceOf({ received: "50.00", outstanding: "70.00", payments: [paymentOf()] });
  const twenty = paymentOf({ id: "pay-2", applied: "20.00", tendered: "20.00" });
  const after = balanceOf({
    received: "70.00",
    outstanding: "50.00",
    payments: [paymentOf(), twenty],
  });
  const readCounts = () => ({
    balance: vi.mocked(api.getBillBalance).mock.calls.length,
    bills: vi.mocked(api.getPartyBills).mock.calls.length,
    lines: vi.mocked(api.getTabLines).mock.calls.length,
  });

  /** The bill holding €50.00, its dialog asking for €20.00 in cash; `answer` is the server's
   * answer to the payment, and the read counts are taken as it is sent. */
  async function payTwenty(answer: () => Promise<BillPaymentResult>) {
    let latest = heldMoney;
    let atSend = { balance: 0, bills: 0, lines: 0 };
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn(async () => latest),
      previewBillPayment: vi.fn().mockResolvedValue(cash("20.00", "0.00")),
      takeBillPayment: vi.fn(async () => {
        atSend = readCounts();
        latest = after;
        return answer();
      }),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "20");
    await type(el, "tendered", "20");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await expect.poll(() => readCounts().bills).toBeGreaterThan(atSend.bills);
    await flush(el);
    return { el, atSend };
  }

  it("takes the bill's new balance from a payment's answer, and reads its lines and bills again but not its balance", async () => {
    const { el, atSend } = await payTwenty(async () => ({
      outcome: "received",
      payment: twenty,
      balance: after,
    }));

    expect(shownBalance(el)).toEqual(balanceShows("120.00", "70.00", "50.00"));
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-received]"))).toContain(
      money("70.00"),
    );
    expect(readCounts()).toEqual({
      balance: atSend.balance,
      bills: atSend.bills + 1,
      lines: atSend.lines + 1,
    });
  });

  it("reads the balance once after a refused payment, for the dialog and the table alike", async () => {
    const { el, atSend } = await payTwenty(() =>
      Promise.reject({ code: "bill.nothing_outstanding", status: 409 }),
    );

    expect(inDialog(el, "wt-form-actions")!.error).toBe(codeMessage("bill.nothing_outstanding"));
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "70.00", "50.00"));
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-received]"))).toContain(
      money("70.00"),
    );
    expect(readCounts()).toEqual({
      balance: atSend.balance + 1,
      bills: atSend.bills + 1,
      lines: atSend.lines + 1,
    });
  });

  it("reads nothing again after a preview refused for a field, which changed nothing on the bill", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn().mockResolvedValue(heldMoney),
      previewBillPayment: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", field: "tendered" }),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "20");
    await type(el, "tendered", "10");
    const before = readCounts();
    await press(el, "[data-pay-continue]");
    await flush(el);

    expect(inDialog(el, 'wt-input[name="tendered"]')!.error).toBe(t("bill_pay.tendered_short"));
    expect(readCounts()).toEqual(before);
  });

  it("reads the bill again after a preview refused for its lines, which another device may have changed", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn().mockResolvedValue(heldMoney),
      previewBillPayment: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", field: "lines" }),
    });
    await openTable(el);
    await openDialog(el, "items");
    await press(el, 'input[name="line"][value="1"]');
    await type(el, "tendered", "50");
    const before = readCounts();
    await press(el, "[data-pay-continue]");
    await expect.poll(() => readCounts().bills).toBeGreaterThan(before.bills);
    await flush(el);

    expect(readCounts()).toEqual({
      balance: before.balance + 1,
      bills: before.bills + 1,
      lines: before.lines + 1,
    });
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
    await flush(el);
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

  it("shows a payment answered after the waiter went back to the floor, and reads nothing of the table left", async () => {
    let answer: (value: BillPaymentResult) => void = () => {};
    const takeBillPayment = vi.fn(
      () => new Promise<BillPaymentResult>((resolve) => (answer = resolve)),
    );
    const { el } = await mountApp({
      takeBillPayment,
      previewBillPayment: vi.fn().mockResolvedValue(cash("40.00", "10.00")),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    emit(tableOrder(el), "back-to-floor");
    await flush(el);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    answer(
      takenOf({ applied: "40.00", change: "10.00" }, { received: "40.00", outstanding: "80.00" }),
    );
    await flush(el);

    expect(shownBalance(el)).toEqual(balanceShows("120.00", "40.00", "80.00"));
    expect(api.getTabLines).toHaveBeenCalledTimes(lineReads);
    expect(api.getPartyBills).toHaveBeenCalledTimes(billReads);
  });

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

describe("till-app: a change refused on a bill that holds money", () => {
  const partly = billOf({ outstanding: "70.00", hasPayments: true });
  const other = billOf({
    workingOrderId: "wo-9",
    label: "B",
    total: "12.00",
    outstanding: "12.00",
  });
  const heldMoney = balanceOf({ received: "50.00", outstanding: "70.00", payments: [paymentOf()] });
  const banner = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElement>('p.error[role="alert"]');
  const listed = (order: TillTableOrderScreen) =>
    [...order.shadowRoot!.querySelectorAll<HTMLElement>("[data-bill]")].map((row) => ({
      bill: row.dataset.bill,
      total: text(row.querySelector("[data-bill-total]")),
    }));

  /** The table open on the partly paid bill, with how often each read had run by then. */
  async function openHolding(overrides: Record<string, unknown>) {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly, other]),
      getBillBalance: vi.fn().mockResolvedValue(heldMoney),
      ...overrides,
    });
    const order = await openTable(el);
    const reads = {
      bills: vi.mocked(api.getPartyBills).mock.calls.length,
      balance: vi.mocked(api.getBillBalance).mock.calls.length,
      lines: vi.mocked(api.getTabLines).mock.calls.length,
    };
    return { el, order, reads };
  }

  function expectReadAgain(reads: { bills: number; balance: number; lines?: number }): void {
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(reads.bills);
    expect(vi.mocked(api.getBillBalance).mock.calls.length).toBeGreaterThan(reads.balance);
    if (reads.lines !== undefined)
      expect(vi.mocked(api.getTabLines).mock.calls.length).toBeGreaterThan(reads.lines);
  }

  it("says a paid item's quantity cannot be raised, and reads the bill, its lines and its payments again", async () => {
    const updateOrderLine = vi.fn().mockRejectedValue({ code: "bill.line_paid", lineNo: 1 });
    const { el, order, reads } = await openHolding({ updateOrderLine });

    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Paella",
      patch: { quantity: "2" },
      revision: 0,
    });
    await flush(el);

    expect(updateOrderLine).toHaveBeenCalledWith("wo-4", 1, { quantity: "2" }, 0);
    expect(text(banner(el))).toBe(codeMessage("bill.line_paid"));
    expectReadAgain(reads);
  });

  it("shows a Cancel refused because issuing the invoice finds a sold-out dish above the Cancel, and reads the bill again", async () => {
    const { el, order, reads } = await openHolding({
      ...adjustmentStubs(),
      applyAdjustment: vi
        .fn()
        .mockRejectedValue({ code: "product.unavailable", status: 409, productId: "p" }),
    });

    await cancelThroughDialog(el, order, "line-5", () => flush(el));

    const adjust = el.shadowRoot!.querySelector("till-adjustment-dialog")!;
    expect(
      adjust.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
    ).toBe(codeMessage("product.unavailable"));
    expectReadAgain(reads);
    expect(listed(tableOrder(el))).toEqual([
      { bill: "wo-4", total: money("120.00") },
      { bill: "wo-9", total: money("12.00") },
    ]);
  });

  it("says why a merge of a bill holding money was refused, lists both bills as they were, and reads them again", async () => {
    const mergeBills = vi
      .fn()
      .mockRejectedValue({ code: "bill.payments_received", status: 409, workingOrderId: "wo-4" });
    const { el, order, reads } = await openHolding({ mergeBills });
    const before = listed(order);

    emit(order, "merge-bills", { fromBillId: "wo-9" });
    await flush(el);

    expect(mergeBills).toHaveBeenCalledOnce();
    expect(text(banner(el))).toBe(codeMessage("bill.payments_received"));
    expect(before).toEqual([
      { bill: "wo-4", total: money("120.00") },
      { bill: "wo-9", total: money("12.00") },
    ]);
    expect(listed(tableOrder(el))).toEqual(before);
    expectReadAgain({ bills: reads.bills, balance: reads.balance });
  });

  it("says why a transfer to or from a bill holding money was refused, and reads the bills again", async () => {
    const transferItems = vi
      .fn()
      .mockRejectedValue({ code: "bill.payments_received", status: 409, workingOrderId: "wo-4" });
    const { el, order, reads } = await openHolding({ transferItems });
    const before = listed(order);

    emit(order, "transfer-lines", { toBillId: "wo-9", transfers: [{ lineNo: 1 }] });
    await flush(el);

    expect(transferItems).toHaveBeenCalledOnce();
    expect(text(banner(el))).toBe(codeMessage("bill.payments_received"));
    expect(listed(tableOrder(el))).toEqual(before);
    expectReadAgain({ bills: reads.bills, balance: reads.balance });
  });

  it.each(["bill.refund_in_progress", "working_order.not_open"])(
    "says a split refused %s in that code's own words, and reads the bill again",
    async (code) => {
      const { el, order, reads } = await openHolding({
        splitBill: vi.fn().mockRejectedValue({ code, status: 409 }),
      });

      emit(order, "split-lines", { transfers: [{ lineNo: 4 }] });
      await flush(el);

      expect(text(banner(el))).toBe(codeMessage(code));
      expect(text(banner(el))).not.toContain(t("table.error"));
      expectReadAgain({ bills: reads.bills, balance: reads.balance });
    },
  );

  it("names the excess of a split that would leave the bill owing less than it received, and offers to refund it first", async () => {
    const splitBill = vi.fn().mockRejectedValue({
      code: "bill.received_exceeds_total",
      status: 409,
      workingOrderId: "wo-4",
      excess: "20.00",
    });
    const { el, order, reads } = await openHolding({ splitBill });

    emit(order, "split-lines", { transfers: [{ lineNo: 1 }, { lineNo: 2 }] });
    await flush(el);

    expect(text(banner(el))).toContain(
      t("bill.received_exceeds_total_excess").replaceAll("{amount}", money("20.00")),
    );
    const refund = banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!;
    expect(text(refund)).toBe(t("bill.refund_excess").replace("{amount}", money("20.00")));
    expectReadAgain({ bills: reads.bills, balance: reads.balance });
    expect(tableOrder(el).orderId).toBe("wo-4");

    refund.click();
    await flush(el);

    expect(dialog(el)).not.toBeNull();
    const giving = el.shadowRoot!.querySelector<TillBillRefundDialog>("till-bill-refund-dialog")!;
    expect(giving.payment.id).toBe("pay-1");
    expect(
      giving.shadowRoot!.querySelector<HTMLInputElement>('input[name="howMuch"][value="part"]')!
        .checked,
    ).toBe(true);
    expect(
      giving.shadowRoot!.querySelector<HTMLElement & { value: string }>('wt-input[name="amount"]')!
        .value,
    ).toBe("20.00");
  });

  it("names the excess of a line change that would leave the bill owing less than it received", async () => {
    const { el, order } = await openHolding({
      updateOrderLine: vi
        .fn()
        .mockRejectedValue({ code: "bill.received_exceeds_total", status: 409, excess: "5.00" }),
    });

    emit(order, "change-line", {
      lineNo: 5,
      lineName: "Vino",
      patch: { quantity: "0.5" },
      revision: 0,
    });
    await flush(el);

    expect(text(banner(el))).toContain(
      t("bill.received_exceeds_total_line_excess").replaceAll("{amount}", money("5.00")),
    );
    expect(banner(el)!.querySelector("[data-refund-excess]")).not.toBeNull();
  });

  it("opens only the bill payment dialog, saying so, when the payments cannot be read to give the excess back", async () => {
    const getBillBalance = vi.fn().mockResolvedValue(heldMoney);
    const { el, order } = await openHolding({
      getBillBalance,
      splitBill: vi
        .fn()
        .mockRejectedValue({ code: "bill.received_exceeds_total", status: 409, excess: "20.00" }),
    });
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }, { lineNo: 2 }] });
    await flush(el);
    getBillBalance.mockRejectedValue(new TypeError("Failed to fetch"));

    banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!.click();
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-bill-refund-dialog")).toBeNull();
    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("bill_pay.read_failed"));
  });

  it("offers the bill's payments to choose from when more than one can give the excess back", async () => {
    const two = balanceOf({
      received: "50.00",
      outstanding: "70.00",
      payments: [paymentOf({ applied: "25.00" }), paymentOf({ id: "pay-2", applied: "25.00" })],
    });
    const { el, order } = await openHolding({
      getBillBalance: vi.fn().mockResolvedValue(two),
      splitBill: vi.fn().mockRejectedValue({
        code: "bill.received_exceeds_total",
        status: 409,
        excess: "20.00",
      }),
    });
    emit(order, "split-lines", { transfers: [{ lineNo: 1 }, { lineNo: 2 }] });
    await flush(el);

    banner(el)!.querySelector<HTMLElement>("[data-refund-excess]")!.click();
    await flush(el);

    expect(dialog(el)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-bill-refund-dialog")).toBeNull();
    expect(inDialog(el, '[data-payment-refund="pay-2"]')).not.toBeNull();
  });
});

describe.each(["light", "dark"] as const)(
  "till-app: a move refused for the money on the bill, a11y (%s theme)",
  (theme) => {
    it("has no violations naming the excess with the offer to give it back", async () => {
      setLocale("es-ES");
      const { el, host } = await mountApp(
        {
          getPartyBills: vi
            .fn()
            .mockResolvedValue([billOf({ outstanding: "70.00", hasPayments: true })]),
          getBillBalance: vi
            .fn()
            .mockResolvedValue(
              balanceOf({ received: "50.00", outstanding: "70.00", payments: [paymentOf()] }),
            ),
          splitBill: vi.fn().mockRejectedValue({
            code: "bill.received_exceeds_total",
            status: 409,
            excess: "20.00",
          }),
        },
        theme,
      );
      const order = await openTable(el);
      emit(order, "split-lines", { transfers: [{ lineNo: 1 }, { lineNo: 2 }] });
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-refund-excess]")).not.toBeNull();

      await expectNoA11yViolations(host);
    });
  },
);

describe("till-app: a single payment refused because money is already on the bill", () => {
  it("says so and offers to take the rest as a bill payment, once the bill is read again", async () => {
    const getPartyBills = vi
      .fn()
      .mockResolvedValueOnce([billOf()])
      .mockResolvedValue([billOf({ outstanding: "70.00", hasPayments: true })]);
    const { el } = await mountApp({
      getPartyBills,
      getBillBalance: vi
        .fn()
        .mockResolvedValue(
          balanceOf({ received: "50.00", outstanding: "70.00", payments: [paymentOf()] }),
        ),
    });
    const order = await openTable(el);
    expect(order.shadowRoot!.querySelector("[data-pay-rest]")).toBeNull();

    emit(order, "pay-tab", { method: "cash", amount: "120.00" });
    await flush(el);

    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toContain(
      t("bill.pay_with_bill_payments"),
    );
    const rest = tableOrder(el).shadowRoot!.querySelector<HTMLElement>("[data-pay-rest]")!;
    rest.click();
    await flush(el);
    expect(dialog(el)).not.toBeNull();
  });
});

describe("till-app: a partly paid order at the counter", () => {
  it("clears an inactive Make at choice before retrying the bill edit", async () => {
    const updateWorkingOrder = vi.fn(
      async (_id: string, request: { lines: { makeAt: string | null }[] }) => {
        if (request.lines[0]?.makeAt === "retired") throw { code: "route.station_inactive" };
        return { revision: 4 };
      },
    );
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const el = await retrieved({ updateWorkingOrder, askSaleDeadEnds });
    const c = counter(el);
    c.store.addProduct(
      {
        id: "beer",
        menuItemId: "offer-beer",
        name: "Beer",
        pricingUnit: "each",
        unitPrice: "5.00",
        vatClass: "general",
        category: null,
        allergens: null,
      },
      "2",
    );
    c.store.splitLine(0);
    c.store.setLineMakeAt(0, "retired");
    c.store.setLineMakeAt(1, "kitchen");
    emit(c, "counter-bill-pay", { amount: "70.00" });
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
    expect(updateWorkingOrder.mock.calls[1]![1].lines.map((line) => line.makeAt)).toEqual([
      null,
      "kitchen",
    ]);
    expect(dialog(el)).not.toBeNull();
  });

  it("rechecks a saved bill edit refused for a dead-end dish before opening payment", async () => {
    const updateWorkingOrder = vi
      .fn()
      .mockRejectedValueOnce({ code: "station.no_replacement" })
      .mockResolvedValue({ revision: 4 });
    const askSaleDeadEnds = vi.fn().mockResolvedValue({
      sends: true,
      deadEnds: [
        {
          key: "0",
          name: "Beer",
          quantity: "1",
          stationId: "bar",
          stationName: "Bar",
          why: "closed",
        },
      ],
      stations: [{ id: "kitchen", name: "Kitchen", open: true }],
    });
    const el = await retrieved({ updateWorkingOrder, askSaleDeadEnds });
    const c = counter(el);
    c.store.addProduct(
      {
        id: "beer",
        menuItemId: "offer-beer",
        name: "Beer",
        pricingUnit: "each",
        unitPrice: "5.00",
        vatClass: "general",
        category: null,
        allergens: null,
      },
      "1",
    );
    expect(c.store.persisted).toBe(true);
    expect(c.store.dirty).toBe(true);
    expect(c.store.id).toBe("wo-1");
    expect((el as unknown as { billPaying: unknown }).billPaying).toBeNull();
    expect((el as unknown as { heldOrders: HeldOrderSummary[] }).heldOrders).toEqual([held()]);
    expect(payRest(el)).not.toBeNull();
    emit(c, "counter-bill-pay", { amount: "70.00" });
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledOnce();
    const question = el.shadowRoot!.querySelector<HTMLElement>("till-dead-ends-dialog")!;
    expect(question).not.toBeNull();
    question
      .shadowRoot!.querySelector<HTMLElement>("till-dead-ends-section")!
      .dispatchEvent(new CustomEvent("make-at", { detail: { key: "0", stationId: "kitchen" } }));
    await (question as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    question.shadowRoot!.querySelector<HTMLElement>("[data-continue]")!.click();
    await flush(el);
    expect(updateWorkingOrder).toHaveBeenCalledTimes(2);
    expect(dialog(el)).not.toBeNull();
  });
  const counterCanvas: CanvasDef = {
    formFactor: "till",
    tabs: [
      {
        key: "counter",
        title: "Counter",
        columns: 12,
        cards: [
          { type: "basket", colSpan: 4, rowSpan: 4, config: {} },
          { type: "tender-pay", colSpan: 4, rowSpan: 2, config: {} },
          { type: "held-orders", colSpan: 8, rowSpan: 2, config: {} },
        ],
      },
    ],
  };
  const held = (over: Partial<HeldOrderSummary> = {}): HeldOrderSummary => ({
    id: "wo-1",
    orderNumber: 5,
    label: "Ana",
    itemCount: 5,
    total: "120.00",
    outstanding: "70.00",
    hasPayments: true,
    partyId: null,
    openedAt: "2026-09-30T19:00:00.000Z",
    signals: [],
    ...over,
  });
  const counterBalance = balanceOf({
    workingOrderId: "wo-1",
    received: "50.00",
    outstanding: "70.00",
    payments: [paymentOf()],
  });
  const counter = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  const grid = (el: TillApp) => counter(el).shadowRoot!.querySelector("till-card-grid")!;
  const payRest = (el: TillApp) =>
    grid(el).shadowRoot!.querySelector<HTMLElement>("[data-pay-rest]");

  /** Signed in at the counter with the held order `wo-1` retrieved into the basket. */
  async function retrieved(overrides: Record<string, unknown>): Promise<TillApp> {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, canvas: counterCanvas }),
      listWorkingOrders: vi.fn().mockResolvedValue([held()]),
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValue({ id: "wo-1", orderNumber: 5, label: "Ana", revision: 3, lines: [] }),
      getBillBalance: vi.fn().mockResolvedValue(counterBalance),
      previewBillPayment: vi.fn().mockResolvedValue(cash("70.00", "0.00")),
      ...overrides,
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(counter(el), "retrieve-order", { id: "wo-1" });
    await flush(el);
    return el;
  }

  async function payTheRest(el: TillApp): Promise<void> {
    payRest(el)!.click();
    await flush(el);
    await type(el, "tendered", "70");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
  }

  it("offers to take the rest as a bill payment in place of the single payment, and files the invoice when it is paid", async () => {
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { applied: "70.00", tendered: "70.00" },
          { workingOrderId: "wo-1", received: "120.00", outstanding: "0.00", status: "settled" },
          invoiceOf("120.00"),
        ),
      );
    const el = await retrieved({ takeBillPayment });
    expect(
      grid(el).shadowRoot!.querySelector<HTMLElement & { busy: boolean }>("till-tender-pay")!.busy,
    ).toBe(true);
    expect(text(payRest(el))).toBe(t("bill.take_rest"));
    const listReads = vi.mocked(api.listWorkingOrders).mock.calls.length;

    payRest(el)!.click();
    await flush(el);
    expect(api.getBillBalance).toHaveBeenCalledWith("wo-1");
    expect(inDialog(el, 'wt-input[name="amount"]') as unknown as { value: string }).toMatchObject({
      value: "70.00",
    });
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "50.00", "70.00"));
    await type(el, "tendered", "70");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(takeBillPayment).toHaveBeenCalledWith("wo-1", expect.anything(), expect.anything());
    expect(api.recordSale).not.toHaveBeenCalled();
    expect(api.pay).not.toHaveBeenCalled();
    expect(dialog(el)).toBeNull();
    const ticket = el.shadowRoot!.querySelector<HTMLElement & { result: TillSaleResult }>(
      "till-ticket-view",
    )!;
    expect(ticket.result.invoiceNumber).toBe("F-0007");
    expect(vi.mocked(api.listWorkingOrders).mock.calls.length).toBeGreaterThan(listReads);
  });

  it("reads the order and the held orders again after a payment that leaves some to pay", async () => {
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { applied: "70.00", tendered: "70.00" },
          { workingOrderId: "wo-1", received: "100.00", outstanding: "20.00" },
        ),
      );
    const el = await retrieved({ takeBillPayment });
    const orderReads = vi.mocked(api.retrieveWorkingOrder).mock.calls.length;
    const listReads = vi.mocked(api.listWorkingOrders).mock.calls.length;

    await payTheRest(el);

    expect(dialog(el)).not.toBeNull();
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "100.00", "20.00"));
    expect(vi.mocked(api.retrieveWorkingOrder).mock.calls.length).toBeGreaterThan(orderReads);
    expect(vi.mocked(api.listWorkingOrders).mock.calls.length).toBeGreaterThan(listReads);
  });

  it("reads nothing of the counter order when a payment is answered after the operator logged out", async () => {
    let answer: (value: BillPaymentResult) => void = () => {};
    const takeBillPayment = vi.fn(
      () => new Promise<BillPaymentResult>((resolve) => (answer = resolve)),
    );
    const el = await retrieved({ takeBillPayment });
    await payTheRest(el);
    expect(takeBillPayment).toHaveBeenCalledOnce();

    emit(counter(el), "logout");
    await flush(el);
    const orderReads = vi.mocked(api.retrieveWorkingOrder).mock.calls.length;
    answer(
      takenOf(
        { applied: "70.00", tendered: "70.00" },
        { workingOrderId: "wo-1", received: "100.00", outstanding: "20.00" },
      ),
    );
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(orderReads);
  });

  it("shows no ticket and reads nothing when the payment that issues the invoice is answered after the next operator signed in", async () => {
    let answer: (value: BillPaymentResult) => void = () => {};
    const takeBillPayment = vi.fn(
      () => new Promise<BillPaymentResult>((resolve) => (answer = resolve)),
    );
    const el = await retrieved({ takeBillPayment });
    await payTheRest(el);
    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    const listReads = vi.mocked(api.listWorkingOrders).mock.calls.length;

    answer(
      takenOf(
        { applied: "70.00", tendered: "70.00" },
        { workingOrderId: "wo-1", received: "120.00", outstanding: "0.00", status: "settled" },
        invoiceOf("120.00"),
      ),
    );
    await flush(el);

    expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
    expect(api.listWorkingOrders).toHaveBeenCalledTimes(listReads);
  });

  it("keeps the next operator's payment that got no answer when an earlier operator's payment is answered late", async () => {
    let answer: (value: BillPaymentResult) => void = () => {};
    const takeBillPayment = vi
      .fn()
      .mockImplementationOnce(() => new Promise<BillPaymentResult>((resolve) => (answer = resolve)))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await retrieved({ takeBillPayment });
    await payTheRest(el);
    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    emit(counter(el), "retrieve-order", { id: "wo-1" });
    await flush(el);
    await payTheRest(el);
    await expect
      .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));
    const unanswered = sent().at(-1)!.submissionId;

    answer(
      takenOf(
        { applied: "70.00", tendered: "70.00" },
        { workingOrderId: "wo-1", received: "100.00", outstanding: "20.00" },
      ),
    );
    await flush(el);
    takeBillPayment.mockResolvedValueOnce(
      takenOf(
        { applied: "70.00", tendered: "70.00" },
        { workingOrderId: "wo-1", received: "100.00", outstanding: "20.00" },
      ),
    );
    await press(el, "[data-pay-confirm]");

    expect(sent().at(-1)!.submissionId).toBe(unanswered);
  });

  it("resends the next operator's unanswered payment under its own id when an earlier operator's payment is refused while it is out", async () => {
    let refuseEarlier: (error: unknown) => void = () => {};
    let failNext: (error: unknown) => void = () => {};
    const takeBillPayment = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<BillPaymentResult>((_resolve, reject) => (refuseEarlier = reject)),
      )
      .mockImplementationOnce(
        () => new Promise<BillPaymentResult>((_resolve, reject) => (failNext = reject)),
      )
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await retrieved({ takeBillPayment });
    await payTheRest(el);
    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    emit(counter(el), "retrieve-order", { id: "wo-1" });
    await flush(el);
    await payTheRest(el);
    const [earlier, next] = sent().map((request) => request.submissionId);
    expect(next).not.toBe(earlier);

    refuseEarlier({ code: "session.expired", status: 401 });
    await flush(el);
    failNext(new TypeError("Failed to fetch"));
    await expect
      .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));
    takeBillPayment.mockResolvedValueOnce(
      takenOf(
        { applied: "70.00", tendered: "70.00" },
        { workingOrderId: "wo-1", received: "100.00", outstanding: "20.00" },
      ),
    );
    await press(el, "[data-pay-confirm]");

    expect(sent().at(-1)!.submissionId).toBe(next);
  });

  it("sends the next operator's same payment under the id of one that got no answer after its operator logged out", async () => {
    let failEarlier: (error: unknown) => void = () => {};
    const takeBillPayment = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<BillPaymentResult>((_resolve, reject) => (failEarlier = reject)),
      )
      .mockResolvedValue(
        takenOf(
          { applied: "70.00", tendered: "70.00" },
          { workingOrderId: "wo-1", received: "100.00", outstanding: "20.00" },
        ),
      );
    const el = await retrieved({ takeBillPayment });
    await payTheRest(el);
    emit(counter(el), "logout");
    await flush(el);
    failEarlier(new TypeError("Failed to fetch"));
    // The send waits one retry pause, then sees the session has ended and gives up.
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_RETRY_PAUSE_MS));
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p2", displayName: "Luis", permissions: [] });
    await flush(el);
    emit(counter(el), "retrieve-order", { id: "wo-1" });
    await flush(el);
    await payTheRest(el);

    const [earlier, next] = sent().map((request) => request.submissionId);
    expect(next).toBe(earlier);
  });

  it("offers the bill payment once a card at the reader is refused because another till took a payment first", async () => {
    const el = await retrieved({
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([held({ outstanding: "120.00", hasPayments: false })])
        .mockResolvedValueOnce([held({ outstanding: "120.00", hasPayments: false })])
        .mockResolvedValue([held()]),
    });

    emit(counter(el), "collect-card", {});
    await flush(el);

    expect(api.pay).toHaveBeenCalledOnce();
    expect(payRest(el)).not.toBeNull();
  });

  it("keeps the message and the held list as they were when the held list cannot be read after such a refusal", async () => {
    const el = await retrieved({
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([held({ outstanding: "120.00", hasPayments: false })])
        .mockResolvedValueOnce([held({ outstanding: "120.00", hasPayments: false })])
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });

    emit(counter(el), "confirm-payment", { method: "cash", amount: "120.00" });
    await flush(el);

    expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toContain(
      t("bill.pay_with_bill_payments"),
    );
    expect(payRest(el)).toBeNull();
  });

  it("opens one dialog for two presses, with no items to pick when the order's lines could not be read", async () => {
    const el = await retrieved({
      getTabLines: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });

    payRest(el)!.click();
    payRest(el)!.click();
    await flush(el);

    expect(el.shadowRoot!.querySelectorAll("till-bill-pay-dialog")).toHaveLength(1);
    expect(dialog(el)!.lines).toEqual([]);
    expect(api.getBillBalance).toHaveBeenCalledTimes(1);
  });

  describe("an edit made to the order in the basket", () => {
    const flan: TillProduct = {
      id: "flan",
      menuItemId: "offer-flan",
      name: "Flan",
      customerName: { es: "Flan casero" },
      pricingUnit: "each",
      unitPrice: "5.00",
      vatClass: "general",
      category: null,
      allergens: null,
      catalogueId: "cat-default",
      catalogueName: "Carta",
    };

    async function edited(overrides: Record<string, unknown>): Promise<TillApp> {
      const el = await retrieved(overrides);
      counter(el).store.addProduct(flan, "1");
      await flush(el);
      return el;
    }

    it("is saved before the dialog opens", async () => {
      const updateWorkingOrder = vi.fn().mockResolvedValue({ revision: 4 });
      const el = await edited({ updateWorkingOrder });

      payRest(el)!.click();
      await flush(el);

      expect(updateWorkingOrder).toHaveBeenCalledWith(
        "wo-1",
        expect.objectContaining({ revision: 3 }),
      );
      expect(dialog(el)).not.toBeNull();
    });

    it("that is refused opens no dialog and says so", async () => {
      const el = await edited({
        updateWorkingOrder: vi.fn().mockRejectedValue({ code: "server.internal", status: 500 }),
      });

      payRest(el)!.click();
      await flush(el);

      expect(dialog(el)).toBeNull();
      expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toBe(t("sale.error"));
    });

    it("saved from a copy another till changed opens no dialog", async () => {
      const el = await edited({
        updateWorkingOrder: vi
          .fn()
          .mockRejectedValue({ code: "working_order.out_of_date", status: 409 }),
      });

      payRest(el)!.click();
      await flush(el);

      expect(dialog(el)).toBeNull();
      expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toBe(
        t("held.changed_elsewhere"),
      );
    });

    it("answered after the operator logged out opens no dialog and says nothing", async () => {
      for (const outcome of ["saved", "refused"] as const) {
        let answer: { resolve: (value: unknown) => void; reject: (error: unknown) => void } = {
          resolve: () => {},
          reject: () => {},
        };
        const el = await edited({
          updateWorkingOrder: vi.fn(
            () => new Promise((resolve, reject) => (answer = { resolve, reject })),
          ),
        });
        payRest(el)!.click();
        await flush(el);

        emit(counter(el), "logout");
        await flush(el);
        if (outcome === "saved") answer.resolve({ revision: 4 });
        else answer.reject({ code: "server.internal", status: 500 });
        await flush(el);

        expect(dialog(el)).toBeNull();
        expect(el.shadowRoot!.querySelector('p.error[role="alert"]')).toBeNull();
        cleanupWidgets();
      }
    });
  });

  it("offers the bill payment once the single payment is refused because another till took a payment first", async () => {
    const el = await retrieved({
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([held({ outstanding: "120.00", hasPayments: false })])
        .mockResolvedValueOnce([held({ outstanding: "120.00", hasPayments: false })])
        .mockResolvedValue([held()]),
    });
    expect(payRest(el)).toBeNull();

    emit(counter(el), "confirm-payment", { method: "cash", amount: "120.00" });
    await flush(el);

    expect(api.recordSale).toHaveBeenCalledOnce();
    expect(text(el.shadowRoot!.querySelector('p.error[role="alert"]'))).toContain(
      t("bill.pay_with_bill_payments"),
    );
    payRest(el)!.click();
    await flush(el);
    expect(dialog(el)).not.toBeNull();
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

    expect(sent()[0]!.kind).toBe("items");
    expect(sent()[0]!.lines).toEqual([{ lineNo: 6 }]);
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

// Design §3.3: €105.00 contributed on a €120.00 bill, and a guest's €25.00 steak with €15.00 left.
describe("till-app: the steak's two choices", () => {
  const steak = line({ lineNo: 6, name: "Chuletón", unitPriceGross: "25.00" });
  const choices = (tip = "0.00"): AllocationPreview => ({
    kind: "choose",
    options: [
      { choice: "full_with_tip", applied: "15.00", tip: `${10 + Number(tip)}.00` },
      { choice: "use_pool", applied: "15.00", tip },
    ],
  });
  const contributed = balanceOf({ received: "105.00", outstanding: "15.00" });

  async function toChoices(overrides: Record<string, unknown>) {
    const { el } = await mountApp({
      getPartyBills: vi
        .fn()
        .mockResolvedValue([billOf({ outstanding: "15.00", hasPayments: true })]),
      getBillBalance: vi.fn().mockResolvedValue(contributed),
      getTabLines: vi
        .fn()
        .mockResolvedValue({ lines: [...bill120, steak], revision: 0, editSentLines: true }),
      ...overrides,
    });
    await openTable(el);
    await openDialog(el, "items");
    await press(el, 'input[name="line"][value="6"]');
    return el;
  }

  it("charges a card €25.00, €10.00 of it a tip, when the full price with a tip is chosen", async () => {
    const previewBillPayment = vi.fn().mockResolvedValueOnce(choices()).mockResolvedValueOnce({
      kind: "allocated",
      choice: "full_with_tip",
      applied: "15.00",
      tip: "10.00",
      change: null,
      charged: "25.00",
    });
    const takeBillPayment = vi.fn().mockResolvedValue(
      takenOf(
        {
          kind: "items",
          method: "card",
          applied: "15.00",
          tip: "10.00",
          tendered: null,
          change: null,
        },
        { received: "120.00", outstanding: "0.00", status: "settled" },
        invoiceOf("120.00"),
      ),
    );
    const el = await toChoices({ previewBillPayment, takeBillPayment });
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");

    expect(text(inDialog(el, '[data-pay-choice="full_with_tip"]'))).toBe(
      t("bill_pay.choice_tip").replace("{amount}", money("25.00")).replace("{tip}", money("10.00")),
    );
    await press(el, '[data-pay-choice="full_with_tip"]');
    expect(text(inDialog(el, "[data-pay-charged] dd"))).toBe(money("25.00"));
    await press(el, "[data-pay-confirm]");

    expect(previewBillPayment.mock.calls.map(([, ask]) => ask)).toEqual([
      { kind: "items", lines: [{ lineNo: 6 }], method: "card" },
      { kind: "items", lines: [{ lineNo: 6 }], method: "card", choice: "full_with_tip" },
    ]);
    expect(sent()).toEqual([
      {
        kind: "items",
        lines: [{ lineNo: 6 }],
        method: "card",
        choice: "full_with_tip",
        applied: "15.00",
        tip: "10.00",
        entry: "manual",
        submissionId: expect.any(String),
      },
    ]);
  });

  it("takes €15.00 in cash, using €10.00 of the earlier contribution, when that is chosen", async () => {
    const previewBillPayment = vi
      .fn()
      .mockResolvedValueOnce(choices())
      .mockResolvedValueOnce({ ...cash("15.00", "0.00"), choice: "use_pool" });
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { kind: "items", applied: "15.00", tendered: "15.00", change: "0.00" },
          { received: "120.00", outstanding: "0.00", status: "settled" },
          invoiceOf("120.00"),
        ),
      );
    const el = await toChoices({ previewBillPayment, takeBillPayment });
    await type(el, "tendered", "15");
    await press(el, "[data-pay-continue]");

    expect(text(inDialog(el, '[data-pay-choice="use_pool"]'))).toBe(
      t("bill_pay.choice_pool")
        .replace("{amount}", money("15.00"))
        .replace("{pool}", money("10.00")),
    );
    await press(el, '[data-pay-choice="use_pool"]');
    await press(el, "[data-pay-confirm]");

    expect(previewBillPayment.mock.calls[1]![1]).toEqual({
      kind: "items",
      lines: [{ lineNo: 6 }],
      method: "cash",
      tendered: "15",
      choice: "use_pool",
    });
    expect(sent()[0]).toMatchObject({ choice: "use_pool", applied: "15.00", tip: "0.00" });
    expect(dialog(el)).toBeNull();
  });

  it("offers only the earlier contribution in a venue that takes no tips", async () => {
    const el = await toChoices({
      getTill: vi.fn().mockResolvedValue({ ...till, tipsEnabled: false }),
      previewBillPayment: vi.fn().mockResolvedValue({
        kind: "choose",
        options: [{ choice: "use_pool", applied: "15.00", tip: "0.00" }],
      }),
    });
    await type(el, "tendered", "15");
    await press(el, "[data-pay-continue]");

    expect(
      [...dialog(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-pay-choice]")].map(
        (choice) => choice.dataset.payChoice,
      ),
    ).toEqual(["use_pool"]);
  });
});

describe("till-app: a venue that takes no tips", () => {
  const noTips = { getTill: vi.fn().mockResolvedValue({ ...till, tipsEnabled: false }) };

  it("asks for no tip on a card, and shows under the amount the most a card can be charged", async () => {
    const previewBillPayment = vi
      .fn()
      .mockRejectedValue({ code: "bill.tip_not_allowed", status: 422, chargeable: "30.00" });
    const { el } = await mountApp({ ...noTips, previewBillPayment });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "150");
    await press(el, 'input[name="method"][value="card"]');

    expect(inDialog(el, 'wt-input[name="cardTip"]')).toBeNull();
    await press(el, "[data-pay-continue]");

    expect(previewBillPayment).toHaveBeenCalledWith("wo-4", {
      kind: "contribution",
      amount: "150",
      method: "card",
    });
    expect(inDialog(el, 'wt-input[name="amount"]')!.error).toBe(
      t("bill_pay.chargeable").replace("{amount}", money("30.00")),
    );
    expect(inDialog(el, "[data-pay-continue]")!.disabled).toBe(false);
  });

  it("gives cash change back with no offer to leave it as a tip", async () => {
    const { el } = await mountApp(noTips);
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");

    expect(text(inDialog(el, "[data-pay-change] dd"))).toBe(money("10.00"));
    expect(inDialog(el, "[data-leave-tip]")).toBeNull();
  });
});

describe("till-app: a bill payment on the card reader", () => {
  const readers = [
    { id: "5b1c3a52-0000-4000-8000-000000000001", name: "Barra", provider: "stripe_terminal" },
    { id: "5b1c3a52-0000-4000-8000-000000000002", name: "Terraza", provider: "stripe_terminal" },
  ];
  const withReader = {
    getTill: vi.fn().mockResolvedValue({
      ...till,
      cardProvider: "stripe_terminal",
      capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      activeReaders: readers,
      defaultReaderId: readers[0]!.id,
    }),
  };
  const cardPreview: AllocationPreview = {
    kind: "allocated",
    choice: null,
    applied: "40.00",
    tip: "0.00",
    change: null,
    charged: "40.00",
  };
  const onReader = (
    outcome: BillPaymentResult["outcome"],
    state: BillPaymentView["state"],
    balance: Partial<BillBalance>,
  ): BillPaymentResult => ({
    ...takenOf({ method: "card", applied: "40.00", tendered: null, change: null, state }, balance),
    outcome,
  });

  async function takeOnReader(takeBillPayment: unknown, overrides: Record<string, unknown> = {}) {
    const { el } = await mountApp({
      ...withReader,
      previewBillPayment: vi.fn().mockResolvedValue(cardPreview),
      takeBillPayment,
      ...overrides,
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    return el;
  }

  it("charges the card on the reader picked, and shows the bill's new balance", async () => {
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        onReader("received", "received", { received: "40.00", outstanding: "80.00" }),
      );
    const el = await takeOnReader(takeBillPayment);

    expect(sent()).toEqual([
      {
        kind: "contribution",
        amount: "40",
        method: "card",
        applied: "40.00",
        tip: "0.00",
        entry: "reader",
        readerId: readers[1]!.id,
        submissionId: expect.any(String),
      },
    ]);
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "40.00", "80.00"));
  });

  it("says a declined card took nothing, above the action, and tries it again as a new payment", async () => {
    const takeBillPayment = vi
      .fn()
      .mockResolvedValueOnce(onReader("declined", "failed", {}))
      .mockResolvedValueOnce(
        onReader("received", "received", { received: "40.00", outstanding: "80.00" }),
      );
    const el = await takeOnReader(takeBillPayment);

    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("bill_pay.card_declined"));
    expect(inDialog(el, "[data-pay-taken]")).toBeNull();
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "0.00", "120.00"));
    expect(inDialog(el, "[data-pay-confirm]")!.disabled).toBe(false);

    await press(el, "[data-pay-confirm]");
    expect(sent()).toHaveLength(2);
    expect(sent()[1]!.submissionId).not.toBe(sent()[0]!.submissionId);
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
  });

  // The server refuses a reader it cannot reach before it looks the submission id up, so the
  // refusal says nothing of whether the card that got no answer was charged.
  it("sends a card that got no answer under the same submission id after the reader is refused", async () => {
    const takeBillPayment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await takeOnReader(takeBillPayment);
    await expect
      .poll(() => inDialog(el, "wt-form-actions")?.error ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));

    takeBillPayment.mockRejectedValueOnce({ code: "reader.provider_disconnected", status: 503 });
    await press(el, "[data-pay-confirm]");
    expect(inDialog(el, "[data-pay-confirm]")).toBeNull();
    takeBillPayment.mockResolvedValueOnce(
      onReader("received", "received", { received: "40.00", outstanding: "80.00" }),
    );
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
    expect(new Set(sent().map((request) => request.submissionId)).size).toBe(1);
  });

  it("says a reader that could not reach the card network took nothing", async () => {
    const el = await takeOnReader(
      vi.fn().mockResolvedValue(onReader("network_unavailable", "failed", {})),
    );
    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("bill_pay.card_unreachable"));
  });

  it("shows a card still at the reader as in progress, its amount held on the bill, and where a manager clears it", async () => {
    const getTabLines = vi
      .fn()
      .mockResolvedValue({ lines: bill120, revision: 0, editSentLines: true });
    const readsAtTake: number[] = [];
    const takeBillPayment = vi.fn(async () => {
      readsAtTake.push(getTabLines.mock.calls.length);
      return onReader("timeout", "pending", { reserved: "40.00", outstanding: "80.00" });
    });
    const el = await takeOnReader(takeBillPayment, { getTabLines });

    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
      t("bill_pay.card_pending").replace("{amount}", money("40.00")),
    );
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "0.00", "80.00", "40.00"));
    expect(inDialog(el, "[data-pay-continue]")).not.toBeNull();
    expect(getTabLines.mock.calls.length).toBeGreaterThan(readsAtTake[0]!);
  });

  it("offers no reader to a handheld whose profile lacks integrated card payment: its card is keyed on a separate terminal", async () => {
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
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        onReader("received", "received", { received: "40.00", outstanding: "80.00" }),
      );
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: phoneCanvas,
        capabilities: ["print-receipt"] as CapabilityFlag[],
        cardProvider: "stripe_terminal",
        activeReaders: readers,
        defaultReaderId: readers[0]!.id,
      }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "d1",
        name: "Móvil",
        formFactor: "phone-portrait",
        stationId: null,
      }),
      previewBillPayment: vi.fn().mockResolvedValue(cardPreview),
      takeBillPayment,
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const grid = el.shadowRoot!.querySelector<HTMLElement>("till-card-grid")!;
    emit(grid.shadowRoot!.querySelector("till-table-order-screen")!, "bill-pay", {
      way: "contribution",
      lines: [],
    });
    await flush(el);
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');

    expect(inDialog(el, 'input[name="reader"]')).toBeNull();
    expect(inDialog(el, 'wt-input[name="externalRef"]')).not.toBeNull();
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(sent()[0]!.entry).toBe("manual");
  });

  it("offers no reader to a till whose profile lacks integrated card payment: its card is keyed on a separate terminal", async () => {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        capabilities: ["print-receipt"] as CapabilityFlag[],
        cardProvider: "stripe_terminal",
        activeReaders: readers,
        defaultReaderId: readers[0]!.id,
      }),
      previewBillPayment: vi.fn().mockResolvedValue(cardPreview),
      takeBillPayment: vi
        .fn()
        .mockResolvedValue(
          onReader("received", "received", { received: "40.00", outstanding: "80.00" }),
        ),
    });
    await openTable(el);
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');

    expect(inDialog(el, 'input[name="reader"]')).toBeNull();
    expect(inDialog(el, 'wt-input[name="externalRef"]')).not.toBeNull();
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(sent()[0]!.entry).toBe("manual");
  });

  /** A handheld whose profile declares the integrated reader, taking a card on the second reader. */
  async function takeOnHandheldReader(takeBillPayment: unknown): Promise<TillApp> {
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        canvas: {
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
        } satisfies CanvasDef,
        capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
        cardProvider: "stripe_terminal",
        activeReaders: readers,
        defaultReaderId: readers[0]!.id,
      }),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "d1",
        name: "Móvil",
        formFactor: "phone-portrait",
        stationId: null,
      }),
      previewBillPayment: vi.fn().mockResolvedValue(cardPreview),
      takeBillPayment,
    });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el);
    const grid = el.shadowRoot!.querySelector<HTMLElement>("till-card-grid")!;
    emit(grid.shadowRoot!.querySelector("till-table-order-screen")!, "bill-pay", {
      way: "contribution",
      lines: [],
    });
    await flush(el);
    await type(el, "amount", "40");
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    return el;
  }

  it("charges the card on the reader picked on a handheld whose profile has the reader", async () => {
    const takeBillPayment = vi
      .fn()
      .mockResolvedValue(
        onReader("received", "received", { received: "40.00", outstanding: "80.00" }),
      );
    const el = await takeOnHandheldReader(takeBillPayment);

    expect(sent()).toEqual([
      {
        kind: "contribution",
        amount: "40",
        method: "card",
        applied: "40.00",
        tip: "0.00",
        entry: "reader",
        readerId: readers[1]!.id,
        submissionId: expect.any(String),
      },
    ]);
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
  });

  it("tells a handheld the same as a till when the server refuses the device the reader", async () => {
    const refused = { code: "device.forbidden_action", status: 403, action: "pay" };
    const says = t("card_reader.not_set_up");
    const onTill = await takeOnReader(vi.fn().mockRejectedValue(refused));
    expect(inDialog(onTill, "wt-form-actions")!.error).toBe(says);
    cleanupWidgets();

    const onHandheld = await takeOnHandheldReader(vi.fn().mockRejectedValue(refused));
    expect(inDialog(onHandheld, "wt-form-actions")!.error).toBe(says);
  });

  it("stops saying to tap or insert the card once the reader payment is refused", async () => {
    let refuse: (reason: unknown) => void = () => undefined;
    const el = await takeOnReader(
      vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
    );
    expect(text(inDialog(el, "[data-pay-collecting]"))).toBe(t("card.collecting"));

    refuse({ code: "device.forbidden_action", status: 403, action: "pay" });
    await flush(el);
    expect(inDialog(el, "wt-form-actions")!.error).toBe(t("card_reader.not_set_up"));
    expect(inDialog(el, "[data-pay-collecting]")).toBeNull();
  });
});

describe("till-app: giving back a bill payment", () => {
  const partly = billOf({ outstanding: "70.00", hasPayments: true });
  const cashPaid = paymentOf();
  const keyedCard = paymentOf({
    method: "card",
    entry: "manual",
    applied: "50.00",
    tendered: null,
    change: null,
  });
  const readerCard = paymentOf({ ...keyedCard, entry: "reader" });
  const refundOf = (over: Partial<BillRefundView> = {}): BillRefundView => ({
    id: "r-1",
    paymentId: "pay-1",
    submissionId: "rs-1",
    appliedAmount: "50.00",
    tipAmount: "0.00",
    reason: "Charged twice",
    state: "completed",
    createdAt: "2026-09-30T20:10:00.000Z",
    completedAt: "2026-09-30T20:10:00.000Z",
    ...over,
  });
  const holding = (payment: BillPaymentView) =>
    balanceOf({ received: "50.00", outstanding: "70.00", payments: [payment] });
  const givenBack = (payment: BillPaymentView, refund: BillRefundView): BillRefundResult => ({
    refund,
    balance: balanceOf({ payments: [{ ...payment, refunds: [refund] }] }),
  });
  const manager = [{ personId: "m-1", displayName: "Marta" }];

  const refundDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillBillRefundDialog>("till-bill-refund-dialog");
  const inRefund = (el: TillApp, selector: string) =>
    refundDialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>(selector);
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
      "till-supervisor-override-dialog[data-refund-approval]",
    );
  const refunds = () =>
    vi
      .mocked(api.refundBillPayment)
      .mock.calls.map(([billId, paymentId, request]) => ({ billId, paymentId, request }));
  const notPermitted = {
    code: "authorization.not_permitted",
    status: 403,
    permission: "sale.refund",
  };
  /** The server as it answers an operator who cannot give refunds: refused without a PIN, and a
   * refund carrying one answered by `withPin`. */
  const needsApproval =
    (withPin: (request: BillRefundRequest) => Promise<unknown>) =>
    (_billId: string, _paymentId: string, request: BillRefundRequest) =>
      request.override === undefined ? Promise.reject(notPermitted) : withPin(request);

  /** The bill holding `payment`, its dialog open, and a refund of it asked with `reason`. */
  async function askRefund(
    overrides: Record<string, unknown>,
    payment: BillPaymentView,
    reason = "Charged twice",
  ): Promise<TillApp> {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([partly]),
      getBillBalance: vi.fn().mockResolvedValue(holding(payment)),
      listRefundAuthorizers: vi.fn().mockResolvedValue(manager),
      ...overrides,
    });
    await signInAndAskRefund(el, payment, reason);
    return el;
  }

  async function signInAndAskRefund(
    el: TillApp,
    payment: BillPaymentView,
    reason = "Charged twice",
  ): Promise<void> {
    await openTable(el);
    await openDialog(el, "rest");
    await press(el, `[data-payment-refund="${payment.id}"]`);
    const input = inRefund(el, 'wt-input[name="reason"]')!.shadowRoot!.querySelector("input")!;
    input.value = reason;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await flush(el);
    inRefund(el, "[data-refund-continue]")!.click();
    await flush(el);
  }

  async function pinPad(el: TillApp, digits: string): Promise<void> {
    const override = approval(el)!;
    override.shadowRoot!.querySelector<HTMLElement>('[data-person="m-1"]')!.click();
    await override.updateComplete;
    for (const digit of digits) {
      override
        .shadowRoot!.querySelector("till-numeric-pad")!
        .shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!
        .click();
      await override.updateComplete;
    }
    override.shadowRoot!.querySelector<HTMLElement>(".authorize")!.click();
    await flush(el);
  }

  it("gives back the cash payment of an operator who can give refunds with no PIN, and asks for none", async () => {
    const refundBillPayment = vi.fn().mockResolvedValue(givenBack(cashPaid, refundOf()));
    const el = await askRefund({ refundBillPayment }, cashPaid);

    expect(refunds()).toEqual([
      {
        billId: "wo-4",
        paymentId: "pay-1",
        request: {
          submissionId: expect.any(String),
          appliedAmount: "50.00",
          tipAmount: "0.00",
          reason: "Charged twice",
        },
      },
    ]);
    expect(api.listRefundAuthorizers).not.toHaveBeenCalled();
    expect(approval(el)).toBeNull();
    expect(refundDialog(el)).toBeNull();
    expect(text(inDialog(el, "[data-pay-refunded]"))).toBe(
      t("bill_refund.done_cash").replace("{amount}", money("50.00")),
    );
  });

  it("gives back a cash payment with a manager's PIN when the operator cannot, under the same submission id, opens no drawer from the till, and shows the bill after it", async () => {
    const refunded = givenBack(cashPaid, refundOf());
    let latest = holding(cashPaid);
    const refundBillPayment = vi.fn(
      needsApproval(async () => {
        latest = refunded.balance;
        return refunded;
      }),
    );
    const getTabLines = vi
      .fn()
      .mockResolvedValue({ lines: bill120, revision: 0, editSentLines: true });
    const openDrawer = vi.fn();
    const el = await askRefund(
      { refundBillPayment, getBillBalance: vi.fn(async () => latest), getTabLines, openDrawer },
      cashPaid,
    );

    expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
    expect(approval(el)!.authorizers).toEqual(manager);
    const readsBefore = getTabLines.mock.calls.length;
    await pinPad(el, "1234");

    const ask = { appliedAmount: "50.00", tipAmount: "0.00", reason: "Charged twice" };
    expect(refunds()).toEqual([
      {
        billId: "wo-4",
        paymentId: "pay-1",
        request: { submissionId: expect.any(String), ...ask },
      },
      {
        billId: "wo-4",
        paymentId: "pay-1",
        request: {
          submissionId: refunds()[0]!.request.submissionId,
          ...ask,
          override: { personId: "m-1", pin: "1234" },
        },
      },
    ]);
    expect(approval(el)).toBeNull();
    expect(refundDialog(el)).toBeNull();
    expect(text(inDialog(el, "[data-pay-refunded]"))).toBe(
      t("bill_refund.done_cash").replace("{amount}", money("50.00")),
    );
    expect(shownBalance(el)).toEqual(balanceShows("120.00", "0.00", "120.00"));
    expect(text(inDialog(el, '[data-payment="pay-1"] [data-payment-refunded]'))).toBe(
      t("bill_pay.refunded").replace("{amount}", money("50.00")),
    );
    expect(inDialog(el, "[data-payment-refund]")).toBeNull();
    expect(getTabLines.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it("gives back a hand-keyed card on its terminal first, then records it with one manager's PIN", async () => {
    const refundBillPayment = vi.fn().mockResolvedValue(givenBack(keyedCard, refundOf()));
    const el = await askRefund({ refundBillPayment }, keyedCard);

    expect(approval(el)).toBeNull();
    expect(api.listRefundAuthorizers).not.toHaveBeenCalled();
    expect(refundBillPayment).not.toHaveBeenCalled();
    expect(text(inRefund(el, "[data-refund-terminal]"))).toBe(
      t("bill_refund.terminal").replace("{amount}", money("50.00")),
    );
    inRefund(el, "[data-refund-terminal-done]")!.click();
    await flush(el);
    expect(approval(el)).not.toBeNull();
    await pinPad(el, "1234");

    expect(refunds()).toEqual([
      {
        billId: "wo-4",
        paymentId: "pay-1",
        request: {
          submissionId: expect.any(String),
          appliedAmount: "50.00",
          tipAmount: "0.00",
          reason: "Charged twice",
          manualConfirmed: true,
          override: { personId: "m-1", pin: "1234" },
        },
      },
    ]);
    expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
    expect(refundDialog(el)).toBeNull();
    expect(text(inDialog(el, "[data-pay-refunded]"))).toBe(
      t("bill_refund.done_terminal").replace("{amount}", money("50.00")),
    );
  });

  it("shows above the action a card taken at a reader that the server cannot give back, and asks for no terminal", async () => {
    const refundBillPayment = vi
      .fn()
      .mockRejectedValue({ code: "bill.refund_unsupported", status: 422, paymentId: "pay-1" });
    const el = await askRefund({ refundBillPayment }, readerCard);

    expect(refunds()).toHaveLength(1);
    expect(refunds()[0]!.request).not.toHaveProperty("manualConfirmed");
    expect(approval(el)).toBeNull();
    expect(inRefund(el, "[data-refund-terminal]")).toBeNull();
    expect(inRefund(el, "wt-form-actions")!.error).toBe(codeMessage("bill.refund_unsupported"));
  });

  it("keeps the PIN prompt open after a wrong PIN, saying so, and reads the bill again", async () => {
    const getBillBalance = vi.fn().mockResolvedValue(holding(cashPaid));
    const el = await askRefund(
      {
        getBillBalance,
        refundBillPayment: needsApproval(() =>
          Promise.reject({ code: "pin.invalid", status: 401 }),
        ),
      },
      cashPaid,
    );
    const readsBefore = getBillBalance.mock.calls.length;
    await pinPad(el, "0000");

    expect(approval(el)!.error).toBe("pin.invalid");
    expect(approval(el)!.shadowRoot!.querySelector(".error")!.textContent).toBe(t("pin.invalid"));
    expect(refundDialog(el)).not.toBeNull();
    expect(getBillBalance.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it.each([
    [
      "takes the bill's new balance from a refund's answer, reading",
      0,
      () => givenBack(cashPaid, refundOf()),
    ],
    [
      "reads the balance once after a refused refund, and reads",
      1,
      () => Promise.reject({ code: "bill.refund_in_progress", status: 409 }),
    ],
  ] as const)("%s the bill's lines and bills again", async (_case, balanceReads, answer) => {
    const readCounts = () => ({
      balance: vi.mocked(api.getBillBalance).mock.calls.length,
      bills: vi.mocked(api.getPartyBills).mock.calls.length,
      lines: vi.mocked(api.getTabLines).mock.calls.length,
    });
    let atSend = { balance: 0, bills: 0, lines: 0 };
    const refundBillPayment = vi.fn(async () => {
      atSend = readCounts();
      return answer();
    });
    const el = await askRefund({ refundBillPayment }, cashPaid);
    await expect.poll(() => readCounts().bills).toBeGreaterThan(atSend.bills);
    await flush(el);

    expect(refundBillPayment).toHaveBeenCalledOnce();
    expect(readCounts()).toEqual({
      balance: atSend.balance + balanceReads,
      bills: atSend.bills + 1,
      lines: atSend.lines + 1,
    });
  });

  it("keeps the PIN prompt open after too many wrong PINs, saying to wait, with the refund open and not busy", async () => {
    const el = await askRefund(
      {
        refundBillPayment: needsApproval(() =>
          Promise.reject({
            code: "pin.throttled",
            params: { retryAfterSeconds: 2 },
            status: 429,
          }),
        ),
      },
      cashPaid,
    );
    await pinPad(el, "7777");

    expect(approval(el)!.error).toBe("pin.throttled");
    expect(approval(el)!.shadowRoot!.querySelector(".error")!.textContent).toBe(t("pin.throttled"));
    expect(refundDialog(el)).not.toBeNull();
    expect(refundDialog(el)!.busy).toBe(false);
  });

  it("shows a refund the server refused above the refund's action, and reads the bill and its lines again", async () => {
    const getBillBalance = vi.fn().mockResolvedValue(holding(cashPaid));
    const getTabLines = vi
      .fn()
      .mockResolvedValue({ lines: bill120, revision: 0, editSentLines: true });
    const el = await askRefund(
      {
        getBillBalance,
        getTabLines,
        refundBillPayment: needsApproval(() =>
          Promise.reject({ code: "bill.refund_in_progress", status: 409 }),
        ),
      },
      cashPaid,
    );
    const reads = [getBillBalance.mock.calls.length, getTabLines.mock.calls.length];
    await pinPad(el, "1234");

    expect(approval(el)).toBeNull();
    expect(inRefund(el, "wt-form-actions")!.error).toBe(codeMessage("bill.refund_in_progress"));
    expect(getBillBalance.mock.calls.length).toBeGreaterThan(reads[0]!);
    expect(getTabLines.mock.calls.length).toBeGreaterThan(reads[1]!);
  });

  it("says a card refund is waiting for the card provider", async () => {
    const el = await askRefund(
      {
        refundBillPayment: vi
          .fn()
          .mockResolvedValue(
            givenBack(readerCard, refundOf({ state: "pending", completedAt: null })),
          ),
      },
      readerCard,
    );

    expect(text(inDialog(el, "[data-pay-refunded]"))).toBe(
      t("bill_refund.pending").replace("{amount}", money("50.00")),
    );
  });

  it("sends a refund that got no answer again under the same submission id", async () => {
    const refundBillPayment = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(givenBack(cashPaid, refundOf()));
    const el = await askRefund({ refundBillPayment }, cashPaid);

    await expect.poll(() => refundBillPayment.mock.calls.length, { timeout: 5_000 }).toBe(2);
    await expect.poll(() => refundDialog(el)).toBeNull();
    const [first, again] = refunds();
    expect(again!.request.submissionId).toBe(first!.request.submissionId);
  });

  it("says a refund that never got an answer may have been made, and gives the same id to the same refund again", async () => {
    const refundBillPayment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await askRefund({ refundBillPayment }, cashPaid);

    await expect
      .poll(() => inRefund(el, "wt-form-actions")?.error, { timeout: 5_000 })
      .toBe(t("bill_refund.unconfirmed"));
    inRefund(el, "[data-refund-continue]")!.click();
    await flush(el);
    await expect.poll(() => refundBillPayment.mock.calls.length, { timeout: 5_000 }).toBe(6);

    const ids = new Set(refunds().map(({ request }) => request.submissionId));
    expect(ids.size).toBe(1);
  });

  // The server checks the approver's PIN before it looks the submission id up, so a wrong PIN says
  // nothing of whether the refund that got no answer was made.
  it("gives a refund that got no answer the same submission id after a wrong PIN, and again with the right one", async () => {
    const withPin = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await askRefund({ refundBillPayment: vi.fn(needsApproval(withPin)) }, cashPaid);
    await pinPad(el, "1234");
    await expect
      .poll(() => inRefund(el, "wt-form-actions")?.error, { timeout: 5_000 })
      .toBe(t("bill_refund.unconfirmed"));

    withPin
      .mockRejectedValueOnce({ code: "pin.invalid", status: 401 })
      .mockResolvedValueOnce(givenBack(cashPaid, refundOf()));
    inRefund(el, "[data-refund-continue]")!.click();
    await flush(el);
    await pinPad(el, "0000");
    expect(approval(el)!.error).toBe("pin.invalid");
    emit(approval(el)!, "override-confirm", { personId: "m-1", pin: "1234" });
    await flush(el);

    expect(refundDialog(el)).toBeNull();
    const ids = refunds().map(({ request }) => request.submissionId);
    expect(new Set(ids).size).toBe(1);
    expect(refunds().at(-1)!.request.override).toEqual({ personId: "m-1", pin: "1234" });
  });

  it("says who can approve could not be read, above the refund's action", async () => {
    const el = await askRefund(
      {
        refundBillPayment: needsApproval(vi.fn()),
        listRefundAuthorizers: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      },
      cashPaid,
    );

    expect(approval(el)).toBeNull();
    expect(inRefund(el, "wt-form-actions")!.error).toBe(t("bill_refund.approvers_failed"));
  });

  it("puts a refusal of the reason under the reason", async () => {
    const el = await askRefund(
      {
        refundBillPayment: vi.fn().mockRejectedValue({
          code: "management.request_invalid",
          status: 400,
          field: "reason",
        }),
      },
      cashPaid,
    );

    expect(inRefund(el, 'wt-input[name="reason"]')!.error).toBe(
      codeMessage("management.request_invalid"),
    );
  });

  it("asks once who can approve for two presses, and sends once for two approvals", async () => {
    let approvers: (list: typeof manager) => void = () => {};
    const listRefundAuthorizers = vi.fn(
      () => new Promise<typeof manager>((resolve) => (approvers = resolve)),
    );
    let refunded: (result: BillRefundResult) => void = () => {};
    const withPin = vi.fn(() => new Promise<BillRefundResult>((resolve) => (refunded = resolve)));
    const refundBillPayment = vi.fn(needsApproval(withPin));
    const el = await askRefund({ listRefundAuthorizers, refundBillPayment }, cashPaid);
    const ask = { appliedAmount: "50.00", tipAmount: "0.00", reason: "Charged twice" };
    emit(refundDialog(el)!, "bill-refund-continue", ask);
    approvers(manager);
    await flush(el);
    expect(refundBillPayment).toHaveBeenCalledOnce();
    expect(listRefundAuthorizers).toHaveBeenCalledOnce();

    const approve = () => emit(approval(el)!, "override-confirm", { personId: "m-1", pin: "1234" });
    approve();
    approve();
    refunded(givenBack(cashPaid, refundOf()));
    await flush(el);
    expect(withPin).toHaveBeenCalledOnce();
  });

  it.each([
    ["who can approve", "approvers", "resolve"],
    ["a failed read of who can approve", "approvers", "reject"],
    ["a refund", "refund", "resolve"],
    ["a refusal", "refund", "reject"],
  ] as const)(
    "changes nothing when %s arrives after the operator has logged out",
    async (_case, request, settle) => {
      let answer: { resolve: (value: unknown) => void; reject: (error: unknown) => void } = {
        resolve: () => {},
        reject: () => {},
      };
      const later = () => new Promise((resolve, reject) => (answer = { resolve, reject }));
      const getBillBalance = vi.fn().mockResolvedValue(holding(cashPaid));
      const el = await askRefund(
        request === "approvers"
          ? {
              getBillBalance,
              refundBillPayment: needsApproval(vi.fn()),
              listRefundAuthorizers: vi.fn(later),
            }
          : { getBillBalance, refundBillPayment: needsApproval(vi.fn(later)) },
        cashPaid,
      );
      if (request === "refund") {
        const override = approval(el)!;
        emit(override, "override-confirm", { personId: "m-1", pin: "1234" });
        await flush(el);
      }
      const reads = getBillBalance.mock.calls.length;

      emit(tableOrder(el), "logout");
      await flush(el);
      if (settle === "resolve")
        answer.resolve(request === "approvers" ? manager : givenBack(cashPaid, refundOf()));
      else answer.reject({ code: "bill.refund_in_progress" });
      await flush(el);

      expect(refundDialog(el)).toBeNull();
      expect(approval(el)).toBeNull();
      expect(dialog(el)).toBeNull();
      expect(getBillBalance).toHaveBeenCalledTimes(reads);
    },
  );

  it("keeps the next operator's refund that got no answer when an earlier operator's refund is answered late", async () => {
    let answer: (value: BillRefundResult) => void = () => {};
    const refundBillPayment = vi
      .fn()
      .mockImplementationOnce(() => new Promise<BillRefundResult>((resolve) => (answer = resolve)))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await askRefund({ refundBillPayment }, cashPaid);
    emit(tableOrder(el), "logout");
    await flush(el);
    await signInAndAskRefund(el, cashPaid);
    await expect
      .poll(() => inRefund(el, "wt-form-actions")?.error, { timeout: 5_000 })
      .toBe(t("bill_refund.unconfirmed"));
    const unanswered = refunds().at(-1)!.request.submissionId;

    answer(givenBack(cashPaid, refundOf()));
    await flush(el);
    refundBillPayment.mockResolvedValueOnce(givenBack(cashPaid, refundOf()));
    inRefund(el, "[data-refund-continue]")!.click();
    await flush(el);

    expect(refunds().at(-1)!.request.submissionId).toBe(unanswered);
  });

  it("resends the next operator's unanswered refund under its own id when an earlier operator's refund is refused while it is out", async () => {
    let refuseEarlier: (error: unknown) => void = () => {};
    let failNext: (error: unknown) => void = () => {};
    const refundBillPayment = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<BillRefundResult>((_resolve, reject) => (refuseEarlier = reject)),
      )
      .mockImplementationOnce(
        () => new Promise<BillRefundResult>((_resolve, reject) => (failNext = reject)),
      )
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await askRefund({ refundBillPayment }, cashPaid);
    emit(tableOrder(el), "logout");
    await flush(el);
    await signInAndAskRefund(el, cashPaid);
    const [earlier, next] = refunds().map(({ request }) => request.submissionId);
    expect(next).not.toBe(earlier);

    refuseEarlier({ code: "session.expired", status: 401 });
    await flush(el);
    failNext(new TypeError("Failed to fetch"));
    await expect
      .poll(() => inRefund(el, "wt-form-actions")?.error, { timeout: 5_000 })
      .toBe(t("bill_refund.unconfirmed"));
    refundBillPayment.mockResolvedValueOnce(givenBack(cashPaid, refundOf()));
    inRefund(el, "[data-refund-continue]")!.click();
    await flush(el);

    expect(refunds().at(-1)!.request.submissionId).toBe(next);
  });

  it("sends the next operator's same refund under the id of one that got no answer after its operator logged out", async () => {
    let failEarlier: (error: unknown) => void = () => {};
    const refundBillPayment = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<BillRefundResult>((_resolve, reject) => (failEarlier = reject)),
      )
      .mockResolvedValue(givenBack(cashPaid, refundOf()));
    const el = await askRefund({ refundBillPayment }, cashPaid);
    emit(tableOrder(el), "logout");
    await flush(el);
    failEarlier(new TypeError("Failed to fetch"));
    // The send waits one retry pause, then sees the session has ended and gives up.
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_RETRY_PAUSE_MS));
    await flush(el);
    await signInAndAskRefund(el, cashPaid);

    const [earlier, next] = refunds().map(({ request }) => request.submissionId);
    expect(next).toBe(earlier);
  });

  it("asks for no approver when the operator's own refund is refused after they logged out", async () => {
    let refuse: (error: unknown) => void = () => {};
    const refundBillPayment = vi.fn(
      () => new Promise<BillRefundResult>((_resolve, reject) => (refuse = reject)),
    );
    const el = await askRefund({ refundBillPayment }, cashPaid);

    emit(tableOrder(el), "logout");
    await flush(el);
    refuse(notPermitted);
    await flush(el);

    expect(api.listRefundAuthorizers).not.toHaveBeenCalled();
    expect(approval(el)).toBeNull();
    expect(refundDialog(el)).toBeNull();
  });

  it("goes back to the refund when the PIN prompt is cancelled, and closes it on Cancel", async () => {
    const withPin = vi.fn();
    const el = await askRefund({ refundBillPayment: needsApproval(withPin) }, cashPaid);
    approval(el)!.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await flush(el);

    expect(approval(el)).toBeNull();
    expect(refundDialog(el)).not.toBeNull();
    inRefund(el, "[data-refund-close]")!.click();
    await flush(el);
    expect(refundDialog(el)).toBeNull();
    expect(dialog(el)).not.toBeNull();
    expect(withPin).not.toHaveBeenCalled();
  });
});

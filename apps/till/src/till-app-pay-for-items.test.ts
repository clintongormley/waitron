import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  balanceOf,
  bill120,
  billOf,
  cash,
  dialog,
  flush,
  emit,
  equipmentWith,
  heldTable,
  inDialog,
  invoiceOf,
  lock,
  money,
  openDialog,
  openTable,
  paymentOf,
  press,
  resetBillPayDrafts,
  SECOND_READER,
  stubApi,
  takenOf,
  tableOrder,
  text,
  till,
  type,
} from "../test/bill-pay-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { switchToBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import { TillApp } from "./till-app.js";
import { codeMessage } from "./i18n/codes.js";
import { fill, setLocale, t } from "./i18n/t.js";
import type { BillBalance, BillPaymentResult, BillPaymentView, TillApi } from "./api/client.js";
import type {
  ItemPaymentPreview,
  ItemPaymentRequest,
  ItemPaymentResult,
} from "./api/item-payment-types.js";
import type { CapabilityFlag } from "./layout.js";

let api: TillApi;

async function mountApp(overrides: Record<string, unknown> = {}) {
  api = stubApi(overrides);
  return mountWidget<TillApp>("till-app", { api });
}

const wo4Edit = { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null };

const itemsPreview = (over: Partial<ItemPaymentPreview> = {}): ItemPaymentPreview => ({
  total: "30.00",
  applied: "30.00",
  tip: "0.00",
  change: "20.00",
  ...over,
});

/** The server's answer: the new bill `wo-9`, settled by the payment, with its receipt. */
const paidOnWo9 = (over: Parameters<typeof takenOf>[0] = {}): ItemPaymentResult => ({
  billId: "wo-9",
  payment: takenOf(
    { applied: "30.00", tendered: "50.00", change: "20.00", ...over },
    {
      workingOrderId: "wo-9",
      status: "settled",
      total: "30.00",
      received: "30.00",
      outstanding: "0.00",
    },
    invoiceOf("30.00"),
  ),
});

const formError = (el: TillApp) => inDialog(el, "wt-form-actions")!.error;

/** Pay > Items on wo-4, the dishes on `lineNos` chosen. */
async function chooseItems(el: TillApp, lineNos: number[]): Promise<void> {
  await openTable(el);
  await openDialog(el, "items");
  for (const lineNo of lineNos) await press(el, `input[name="line"][value="${lineNo}"]`);
}

beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);

describe("till-app: Pay for items on a bill of their own", () => {
  it("pays for two dishes in cash on a bill of their own, shows its receipt, then the table's bill", async () => {
    const owing = billOf({ workingOrderId: "wo-5", billNumber: 2, outstanding: "20.00" });
    let paid = false;
    const getPartyBills = vi.fn(async () => [
      billOf(),
      owing,
      ...(paid
        ? [
            billOf({
              workingOrderId: "wo-9",
              billNumber: 3,
              status: "settled",
              total: "30.00",
              outstanding: "0.00",
              hasPayments: true,
            }),
          ]
        : []),
    ]);
    const payForItems = vi.fn(async () => {
      paid = true;
      return paidOnWo9();
    });
    const getReceiptPrintStatus = vi.fn().mockRejectedValue({ code: "network" });
    const { el } = await mountApp({
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
      payForItems,
      getPartyBills,
      getReceiptPrintStatus,
    });
    await chooseItems(el, [4, 5]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");

    expect(api.previewItemPayment).toHaveBeenCalledWith("wo-4", {
      picks: [{ lineId: "line-4" }, { lineId: "line-5" }],
      method: "cash",
      tendered: "50",
    });
    expect(api.previewBillPayment).not.toHaveBeenCalled();
    expect(text(inDialog(el, "[data-pay-scope]"))).toBe(
      fill(t("bill_pay.scope_items"), { items: "Tarta, Vino", amount: money("30.00") }),
    );

    await press(el, "[data-pay-confirm]");
    expect(payForItems).toHaveBeenCalledOnce();
    const [billId, body] = payForItems.mock.calls[0]! as unknown as [string, object];
    expect(billId).toBe("wo-4");
    expect(body).toEqual({
      submissionId: expect.any(String),
      picks: [{ lineId: "line-4" }, { lineId: "line-5" }],
      expectedEdits: [wo4Edit],
      expectedPartyRevision: 3,
      partyId: "v1",
      method: "cash",
      tendered: "50",
      applied: "30.00",
      tip: "0.00",
    });
    expect(api.takeBillPayment).not.toHaveBeenCalled();

    const ticket = el.shadowRoot!.querySelector<
      HTMLElementTagNameMap["till-settlement-document-dialog"]
    >("till-settlement-document-dialog")!;
    expect(ticket).not.toBeNull();
    expect(ticket.cashChange).toBe("20.00");
    expect(getReceiptPrintStatus).toHaveBeenCalledWith("wo-9");
    expect(dialog(el)).toBeNull();
    expect(tableOrder(el).billBalance?.workingOrderId).toBe("wo-4");

    emit(ticket, "settlement-close");
    await flush(el, 6);
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).toBeNull();
    const switcher = tableOrder(el).shadowRoot!.querySelector("[data-bill-switcher]")!;
    expect(switcher.querySelector('[data-switch-bill="wo-4"]')!.getAttribute("aria-checked")).toBe(
      "true",
    );
    const newBill = switcher.querySelector('[data-switch-bill="wo-9"]');
    expect(text(newBill)).toContain(t("table.bill_paid"));
    expect(newBill!.querySelector("[data-paid-mark]")).not.toBeNull();
  });

  it("on a phone, closing the new bill's receipt shows the table's bill, not an earlier bill owing", async () => {
    let paid = false;
    const getPartyBills = vi.fn(async () => [
      billOf({ workingOrderId: "wo-5", billNumber: 1, outstanding: "20.00" }),
      billOf({ billNumber: 2 }),
      ...(paid
        ? [
            billOf({
              workingOrderId: "wo-9",
              billNumber: 3,
              status: "settled",
              outstanding: "0.00",
            }),
          ]
        : []),
    ]);
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, formFactor: "phone-portrait" }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "h1", name: "Handheld", formFactor: "phone-portrait" }),
      getPartyBills,
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
      payForItems: vi.fn(async () => {
        paid = true;
        return paidOnWo9();
      }),
    });
    const order = await openTable(el);
    if (order.orderId !== "wo-4") {
      await switchToBill(order, "wo-4");
      await flush(el);
    }
    expect(order.orderId).toBe("wo-4");
    emit(order, "bill-pay", {
      way: "items",
      lines: bill120.map((dish) => ({
        lineNo: dish.lineNo,
        lineId: dish.id,
        name: dish.name,
        quantity: "1",
        total: dish.unitPriceGross,
        unitTotal: null,
      })),
    });
    await flush(el);
    await press(el, 'input[name="line"][value="4"]');
    await press(el, 'input[name="line"][value="5"]');
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(api.payForItems).toHaveBeenCalledOnce();
    await flush(el, 6);
    emit(el.shadowRoot!.querySelector("till-settlement-document-dialog")!, "settlement-close");
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-4");
  });

  it("a hand-keyed card sends its operation number and machine", async () => {
    const payForItems = vi.fn().mockResolvedValue(paidOnWo9({ method: "card", change: null }));
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, cardProvider: "stripe_terminal" }),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems,
    });
    await chooseItems(el, [4, 5]);
    await press(el, 'input[name="method"][value="card"]');
    await type(el, "externalRef", "OP-73");
    await type(el, "externalMachine", "Bank");
    await press(el, "[data-pay-continue]");
    expect(api.previewItemPayment).toHaveBeenCalledWith("wo-4", {
      picks: [{ lineId: "line-4" }, { lineId: "line-5" }],
      method: "card",
    });
    await press(el, "[data-pay-confirm]");
    expect(payForItems).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({
        method: "card",
        externalRef: "OP-73",
        externalProvider: "other",
        externalMachine: "Bank",
        applied: "30.00",
      }),
      expect.anything(),
    );
    expect(payForItems.mock.calls[0]![1]).not.toHaveProperty("entry");
  });

  it("choosing every dish pays the whole bill", async () => {
    const { el } = await mountApp({
      previewBillPayment: vi.fn().mockResolvedValue(cash("120.00", "0.00")),
    });
    await chooseItems(el, [1, 2, 3, 4, 5]);
    await type(el, "tendered", "120");
    await press(el, "[data-pay-continue]");
    expect(api.previewBillPayment).toHaveBeenCalledWith("wo-4", {
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "120",
      expectedEdit: wo4Edit,
    });
    expect(api.previewItemPayment).not.toHaveBeenCalled();
    expect(api.payForItems).not.toHaveBeenCalled();
  });

  it("a printed bill's items still go to today's route", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewBillPayment: vi.fn().mockResolvedValue(cash("12.00", "38.00")),
      takeBillPayment: vi
        .fn()
        .mockResolvedValue(
          takenOf(
            { kind: "items", applied: "12.00", tendered: "50.00", change: "38.00" },
            { status: "placed", received: "12.00", outstanding: "108.00" },
          ),
        ),
    });
    await openTable(el);
    // A printed bill's Pay opens its presented sheet, whose Pay in parts opens the Pay window.
    tableOrder(el).shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-presented-pay-dialog")!, "presented-pay-parts");
    await flush(el);
    await press(el, 'input[name="way"][value="items"]');
    await press(el, 'input[name="line"][value="4"]');
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(api.previewBillPayment).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({ kind: "items", lines: [{ lineNo: 4 }] }),
    );
    expect(api.takeBillPayment).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({ kind: "items", lines: [{ lineNo: 4 }], applied: "12.00" }),
      expect.anything(),
    );
    expect(api.previewItemPayment).not.toHaveBeenCalled();
    expect(api.payForItems).not.toHaveBeenCalled();
  });

  it("the advances refusal names its amount", async () => {
    const { el } = await mountApp({
      previewItemPayment: vi
        .fn()
        .mockRejectedValue({ code: "bill.below_advances", status: 409, advances: "15.00" }),
    });
    await chooseItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    expect(formError(el)).toBe(codeMessage("bill.below_advances", "en", { advances: "15.00" }));
    expect(formError(el)).toContain(`its own receipt (${money("15.00")})`);
  });

  it("a set-menu dish chosen alone says to choose its set menu too", async () => {
    const { el } = await mountApp({
      previewItemPayment: vi.fn().mockRejectedValue({
        code: "set_menu.no_place_on_target",
        status: 409,
        dishName: "Tarta",
      }),
    });
    await chooseItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    expect(formError(el)).toBe(fill(t("bill_pay.items_set_menu_dish"), { dishName: "Tarta" }));
  });

  it("a changed allocation shows the items' new total", async () => {
    const payForItems = vi.fn().mockRejectedValue({
      code: "bill.allocation_changed",
      status: 409,
      preview: cash("31.00", "19.00"),
    });
    const { el } = await mountApp({
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
      payForItems,
    });
    await chooseItems(el, [4, 5]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(payForItems).toHaveBeenCalledOnce();
    expect(inDialog(el, "[data-pay-confirm]")).not.toBeNull();
    expect(text(inDialog(el, "[data-pay-scope]"))).toBe(
      fill(t("bill_pay.scope_items"), { items: "Tarta, Vino", amount: money("31.00") }),
    );
    expect(inDialog(el, "[data-pay-own-receipt]")).toBeNull();
  });
});

describe("till-app: Pay for items by card reader, after no answer, and at the Counter", () => {
  const readers = [
    { id: "5b1c3a52-0000-4000-8000-000000000001", name: "Barra" },
    { id: "5b1c3a52-0000-4000-8000-000000000002", name: "Terraza" },
  ];
  const withReader = (provider: "stripe_terminal" | "sumup_cloud" = "stripe_terminal") => ({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      cardProvider: provider,
      capabilities: ["print-receipt", "integrated-card-payment"] as CapabilityFlag[],
      activeReaders: readers.map((reader) => ({ ...reader, provider })),
      defaultReaderId: readers[0]!.id,
    }),
  });
  /** The reader's answer for the new bill `wo-9`, with `wo-9`'s balance. */
  const onWo9 = (
    outcome: BillPaymentResult["outcome"],
    state: BillPaymentView["state"],
    balance: Partial<BillBalance> = {},
  ): ItemPaymentResult => ({
    billId: "wo-9",
    payment: {
      ...takenOf(
        { method: "card", entry: "reader", applied: "30.00", tendered: null, change: null, state },
        { workingOrderId: "wo-9", total: "30.00", outstanding: "30.00", ...balance },
      ),
      outcome,
    },
  });
  const itemsSent = () =>
    vi.mocked(api.payForItems).mock.calls.map(([, request]) => request as ItemPaymentRequest);

  async function confirmOnReader(el: TillApp): Promise<void> {
    await chooseItems(el, [4, 5]);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a declined reader card leaves the table's bill as it was", async () => {
    const { el } = await mountApp({
      ...withReader(),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn().mockResolvedValue(onWo9("declined", "failed")),
    });
    await chooseItems(el, [4, 5]);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el);

    expect(api.payForItems).toHaveBeenCalledOnce();
    expect(formError(el)).toBe(t("bill_pay.card_declined"));
    expect(inDialog(el, "[data-pay-confirm]")).toBeNull();
    expect(inDialog(el, "[data-pay-continue]")).not.toBeNull();
    expect(vi.mocked(api.getTabLines).mock.calls.slice(lineReads)).toContainEqual(["wo-4"]);
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
    expect(tableOrder(el).billBalance?.workingOrderId).toBe("wo-4");
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-4");
  });

  it("Cancel payment stops the reader under the table's bill", async () => {
    let settle!: (result: ItemPaymentResult) => void;
    const cancelBillReaderPayment = vi.fn().mockResolvedValue({ outcome: "requested" });
    const { el } = await mountApp({
      ...withReader("sumup_cloud"),
      cancelBillReaderPayment,
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(
        () =>
          new Promise<ItemPaymentResult>((resolve) => {
            settle = resolve;
          }),
      ),
    });
    await confirmOnReader(el);
    try {
      await press(el, "[data-pay-cancel-reader]");
      expect(cancelBillReaderPayment).toHaveBeenCalledWith(
        "wo-4",
        itemsSent()[0]!.submissionId,
        expect.anything(),
      );
    } finally {
      settle(onWo9("declined", "failed"));
      await flush(el);
    }
    expect(formError(el)).toBe(t("bill_pay.no_payment_taken"));
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-4");
  });

  it("no answer resends the same body under the same submission id", async () => {
    let party = 3;
    const payForItems = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await mountApp({
      getTablesState: vi.fn(async () => [heldTable({ revision: party })]),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
      payForItems,
    });
    await chooseItems(el, [4, 5]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    party = 4;
    await press(el, "[data-pay-confirm]");
    await expect
      .poll(() => formError(el) ?? "", { timeout: 10_000 })
      .toBe(t("bill_pay.unconfirmed"));
    expect(
      (el as unknown as { orderParty: { revision: number } | null }).orderParty?.revision,
    ).toBe(4);
    const first = payForItems.mock.calls.length;
    payForItems.mockResolvedValueOnce(paidOnWo9());
    await press(el, "[data-pay-confirm]");

    await expect.poll(() => payForItems.mock.calls.length).toBe(first + 1);
    const bodies = itemsSent();
    expect(bodies[0]).toMatchObject({ expectedPartyRevision: 3, partyId: "v1" });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it("a stale party revision asks again with a fresh id", async () => {
    let party = 3;
    const payForItems = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", status: 409 })
      .mockResolvedValueOnce(paidOnWo9());
    const { el } = await mountApp({
      getTablesState: vi.fn(async () => [heldTable({ revision: party })]),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
      payForItems,
    });
    await chooseItems(el, [4, 5]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    party = 4;
    await press(el, "[data-pay-confirm]");
    await flush(el);
    expect(inDialog(el, "[data-pay-confirm]")).toBeNull();

    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    expect(payForItems).toHaveBeenCalledTimes(2);
    const [first, second] = itemsSent();
    expect(first!.expectedPartyRevision).toBe(3);
    expect(second!.expectedPartyRevision).toBe(4);
    expect(second!.submissionId).not.toBe(first!.submissionId);
  });

  it("a card still pending on a till shows the payment in progress and reads the table's bill", async () => {
    const { el } = await mountApp({
      ...withReader(),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi
        .fn()
        .mockResolvedValue(onWo9("timeout", "pending", { reserved: "30.00", outstanding: "0.00" })),
    });
    await chooseItems(el, [4, 5]);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const balanceReads = vi.mocked(api.getBillBalance).mock.calls.length;
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    // A failed read keeps what the window showed, so it must not show the new bill's.
    vi.mocked(api.getBillBalance).mockRejectedValue(new TypeError("Failed to fetch"));
    await press(el, "[data-pay-confirm]");
    await flush(el);

    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
      t("bill_pay.card_pending").replace("{amount}", money("30.00")),
    );
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-4");
    expect(tableOrder(el).billBalance?.workingOrderId).toBe("wo-4");
    expect(vi.mocked(api.getBillBalance).mock.calls.slice(balanceReads)).toContainEqual(["wo-4"]);
    expect(vi.mocked(api.getTabLines).mock.calls.length).toBeGreaterThan(lineReads);
  });

  it("a card still pending on a handheld is read on its own bill until it is taken", async () => {
    const pendingOn9 = balanceOf({
      workingOrderId: "wo-9",
      total: "30.00",
      reserved: "30.00",
      outstanding: "0.00",
      payments: [paymentOf({ id: "pay-1", method: "card", entry: "reader", state: "pending" })],
    });
    const getBillBalance = vi.fn(async (billId: string) =>
      billId === "wo-9" ? pendingOn9 : balanceOf(),
    );
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        formFactor: "phone-portrait",
        capabilities: ["print-receipt", "integrated-card-payment", "take-cash"],
        cardProvider: "sumup_cloud",
        activeReaders: [{ id: "r2", name: "Lector 2", provider: "sumup_cloud" }],
        defaultReaderId: "r2",
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", name: "Phone", formFactor: "phone-portrait" }),
      getDeviceEquipment: vi.fn().mockResolvedValue(equipmentWith(SECOND_READER)),
      getBillBalance,
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi
        .fn()
        .mockResolvedValue(onWo9("timeout", "pending", { reserved: "30.00", outstanding: "0.00" })),
    });
    const order = await openTable(el);
    emit(order, "bill-pay", {
      way: "items",
      lines: bill120.map((dish) => ({
        lineNo: dish.lineNo,
        lineId: dish.id,
        name: dish.name,
        quantity: "1",
        total: dish.unitPriceGross,
        unitTotal: null,
      })),
    });
    await flush(el);
    await press(el, 'input[name="line"][value="4"]');
    await press(el, 'input[name="line"][value="5"]');
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull());
    await flush(el);
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-4");
    getBillBalance.mockClear();

    await vi.advanceTimersByTimeAsync(5_000);
    await flush(el);
    expect(getBillBalance).toHaveBeenCalledWith("wo-9", expect.anything());
    expect(inDialog(el, "[data-pay-uncertain]")).not.toBeNull();

    getBillBalance.mockImplementation(async (billId: string) =>
      billId === "wo-9"
        ? {
            ...pendingOn9,
            status: "settled",
            reserved: "0.00",
            received: "30.00",
            payments: [{ ...pendingOn9.payments[0]!, state: "received" }],
          }
        : balanceOf(),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await flush(el);
    expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-4");
    expect(getBillBalance).toHaveBeenCalledWith("wo-4");
  });

  describe("at the Counter", () => {
    const counterEdit = { billId: "wo-1", editorVersion: 2, draftId: null, draftRevision: null };
    const counter = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-counter-screen"]>(
        "till-counter-screen",
      )!;

    /** Signed in at the counter with the held order `wo-1` retrieved, its edit state as each
     * read in `edits` gives it (the last one repeating). */
    async function retrieved(
      overrides: Record<string, unknown>,
      edits: (typeof counterEdit | null)[] = [counterEdit],
    ): Promise<TillApp> {
      let reads = 0;
      const { el } = await mountApp({
        listWorkingOrders: vi.fn().mockResolvedValue([
          {
            zoneId: null,
            items: [],
            id: "wo-1",
            orderNumber: 5,
            label: "Ana",
            counts: { ordered: 5, unsent: 0, held: 0, waiting: 0, ready: 0 },
            total: "120.00",
            outstanding: "120.00",
            hasPayments: false,
            partyId: null,
            billNumber: null,
            billName: null,
            openedAt: "2026-09-30T19:00:00.000Z",
            signals: [],
          },
        ]),
        retrieveWorkingOrder: vi.fn(async () => ({
          zoneId: null,
          kitchenNote: {
            scope: { workingOrderId: "wo-1" },
            note: null,
            revision: 0,
            ownerRevision: 3,
          },
          id: "wo-1",
          orderNumber: 5,
          label: "Ana",
          revision: 3,
          expectedEdit: edits[Math.min(reads++, edits.length - 1)],
          lines: [
            {
              workingOrderLineId: "counter-dish",
              menuItemId: "offer-meal",
              quantity: "1.000",
              product: {
                id: "meal",
                menuItemId: "offer-meal",
                menuId: "cat-default",
                name: "Meal",
                pricingUnit: "each",
                unitPrice: "120.00",
                vatClass: "general",
                category: null,
                allergens: null,
              },
            },
          ],
        })),
        getBillBalance: vi.fn().mockResolvedValue(balanceOf({ workingOrderId: "wo-1" })),
        ...overrides,
      });
      await flush(el);
      emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
      await flush(el);
      emit(counter(el), "retrieve-order", { id: "wo-1" });
      await flush(el);
      return el;
    }

    async function chooseFirst(el: TillApp): Promise<string> {
      emit(counter(el), "counter-bill-pay", {});
      await flush(el);
      await press(el, 'input[name="way"][value="items"]');
      const first = dialog(el)!.lines[0]!;
      await press(el, `input[name="line"][value="${first.lineNo}"]`);
      await type(el, "tendered", "50");
      return first.lineId;
    }

    it("at the Counter the window stays, says the payment was taken, and reads the order again", async () => {
      let paid = false;
      const payForItems = vi.fn(async () => {
        paid = true;
        return paidOnWo9();
      });
      const el = await retrieved({
        getTabLines: vi.fn(async () => ({
          lines: paid ? bill120.slice(1) : bill120,
          revision: paid ? 1 : 0,
        })),
        previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
        payForItems,
      });
      const lineId = await chooseFirst(el);
      await press(el, "[data-pay-continue]");
      const orderReads = vi.mocked(api.retrieveWorkingOrder).mock.calls.length;
      const balanceReads = vi.mocked(api.getBillBalance).mock.calls.length;
      await press(el, "[data-pay-confirm]");
      await flush(el);

      expect(api.previewItemPayment).toHaveBeenCalledWith("wo-1", {
        picks: [{ lineId }],
        method: "cash",
        tendered: "50",
      });
      expect(payForItems).toHaveBeenCalledWith(
        "wo-1",
        {
          submissionId: expect.any(String),
          picks: [{ lineId }],
          expectedEdits: [counterEdit],
          method: "cash",
          tendered: "50",
          applied: "30.00",
          tip: "0.00",
        },
        expect.anything(),
      );
      expect(api.previewBillPayment).not.toHaveBeenCalled();
      expect(api.takeBillPayment).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).toBeNull();
      expect(dialog(el)).not.toBeNull();
      expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
        t("bill_pay.taken_change").replace("{amount}", money("20.00")),
      );
      expect(dialog(el)!.balance?.workingOrderId).toBe("wo-1");
      expect(vi.mocked(api.getBillBalance).mock.calls.slice(balanceReads)).toContainEqual(["wo-1"]);
      expect(vi.mocked(api.retrieveWorkingOrder).mock.calls.length).toBeGreaterThan(orderReads);
      expect(dialog(el)!.lines.map((row) => row.lineId)).toEqual(
        bill120.slice(1).map((dish) => dish.id),
      );
    });

    it("at the Counter a card charged for a different amount still warns", async () => {
      const answer = paidOnWo9();
      answer.payment.balance.captureWarning = { requestedAmount: "30.00", reportedAmount: "25.00" };
      const el = await retrieved({
        previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
        payForItems: vi.fn().mockResolvedValue(answer),
      });
      await chooseFirst(el);
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      await flush(el);

      expect(dialog(el)).not.toBeNull();
      const warning = el.shadowRoot!.querySelector<
        HTMLElement & { open: boolean; message: string }
      >("[data-capture-warning]");
      expect(warning?.open).toBe(true);
      expect(warning?.message).toContain(money("25.00"));
    });

    it("at the Counter with no edit state the order is read again before items are paid", async () => {
      const el = await retrieved(
        { previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()) },
        [null, counterEdit],
      );
      await chooseFirst(el);
      const orderReads = vi.mocked(api.retrieveWorkingOrder).mock.calls.length;
      await press(el, "[data-pay-continue]");
      await flush(el);

      expect(api.previewItemPayment).not.toHaveBeenCalled();
      expect(api.previewBillPayment).not.toHaveBeenCalled();
      expect(inDialog(el, "[data-pay-confirm]")).toBeNull();
      expect(vi.mocked(api.retrieveWorkingOrder).mock.calls.length).toBeGreaterThan(orderReads);

      await press(el, "[data-pay-continue]");
      expect(api.previewItemPayment).toHaveBeenCalledOnce();
      expect(inDialog(el, "[data-pay-confirm]")).not.toBeNull();
    });
  });
});

describe("till-app: a bill paid more than it comes to", () => {
  const overpaidRow = billOf({
    total: "10.00",
    outstanding: "0.00",
    overpaid: "5.00",
    hasPayments: true,
  });
  const overpaidBalance = balanceOf({
    total: "10.00",
    received: "15.00",
    outstanding: "-5.00",
    overpaid: "5.00",
    payments: [paymentOf({ applied: "15.00", tendered: "15.00" })],
  });
  const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");

  it("Keep as tip sends a fresh submission id and shows the bill paid", async () => {
    let kept = false;
    const getPartyBills = vi.fn(async () => [
      kept
        ? billOf({ total: "10.00", outstanding: "0.00", status: "settled", hasPayments: true })
        : overpaidRow,
    ]);
    const keepOverpaidAsTip = vi.fn(async () => {
      kept = true;
      return balanceOf({
        status: "settled",
        total: "10.00",
        received: "10.00",
        outstanding: "0.00",
        tips: "5.00",
      });
    });
    const { el } = await mountApp({
      getPartyBills,
      getBillBalance: vi.fn().mockResolvedValue(overpaidBalance),
      keepOverpaidAsTip,
    });
    const order = await openTable(el, ["payment.take"]);
    await flush(el);
    expect(order.shadowRoot!.querySelector("[data-overpaid]")).not.toBeNull();
    const reads = getPartyBills.mock.calls.length;

    order.shadowRoot!.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
    await flush(el, 6);

    expect(keepOverpaidAsTip).toHaveBeenCalledOnce();
    const [billId, submissionId] = keepOverpaidAsTip.mock.calls[0]! as unknown as [string, string];
    expect(billId).toBe("wo-4");
    expect(submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(getPartyBills.mock.calls.length).toBeGreaterThan(reads);
    const row = order.shadowRoot!.querySelector('[data-switch-bill="wo-4"]');
    expect(text(row)).toContain(t("table.bill_paid"));
    expect(row!.querySelector("[data-paid-mark]")).not.toBeNull();
    expect(order.shadowRoot!.querySelector("[data-overpaid]")).toBeNull();
  });

  it("each Keep as tip sends its own submission id", async () => {
    const keepOverpaidAsTip = vi.fn().mockRejectedValue({ code: "bill.not_overpaid", status: 409 });
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([overpaidRow]),
      getBillBalance: vi.fn().mockResolvedValue(overpaidBalance),
      keepOverpaidAsTip,
    });
    const order = await openTable(el, ["payment.take"]);
    await flush(el);

    order.shadowRoot!.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
    await flush(el, 6);
    order.shadowRoot!.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
    await flush(el, 6);

    const ids = keepOverpaidAsTip.mock.calls.map((call) => call[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("a refused Keep as tip says why and reads the bill again", async () => {
    const getPartyBills = vi.fn().mockResolvedValue([overpaidRow]);
    const { el } = await mountApp({
      getPartyBills,
      getBillBalance: vi.fn().mockResolvedValue(overpaidBalance),
      keepOverpaidAsTip: vi.fn().mockRejectedValue({ code: "bill.not_overpaid", status: 409 }),
    });
    const order = await openTable(el, ["payment.take"]);
    await flush(el);
    const reads = getPartyBills.mock.calls.length;

    order.shadowRoot!.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
    await flush(el, 6);

    expect(text(banner(el))).toContain(codeMessage("bill.not_overpaid"));
    expect(getPartyBills.mock.calls.length).toBeGreaterThan(reads);
    expect(order.overpaidBusy).toBe(false);
  });

  it("Keep as tip refused on a bill that comes to nothing says why in its own words", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([overpaidRow]),
      getBillBalance: vi.fn().mockResolvedValue(overpaidBalance),
      keepOverpaidAsTip: vi.fn().mockRejectedValue({ code: "bill.tip_needs_a_sale", status: 409 }),
    });
    const order = await openTable(el, ["payment.take"]);
    await flush(el);

    order.shadowRoot!.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
    await flush(el, 6);

    expect(text(banner(el))).toContain(codeMessage("bill.tip_needs_a_sale"));
  });

  it("Give back opens the Refund window on the excess", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([overpaidRow]),
      getBillBalance: vi.fn().mockResolvedValue(overpaidBalance),
    });
    const order = await openTable(el);
    await flush(el);

    order.shadowRoot!.querySelector<HTMLElement>("[data-give-back]")!.click();
    await flush(el, 6);

    expect(dialog(el)).not.toBeNull();
    const giving =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-bill-refund-dialog"]>(
        "till-bill-refund-dialog",
      )!;
    expect(giving).not.toBeNull();
    expect(giving.suggested).toBe("5.00");
  });
});

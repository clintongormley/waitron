import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  balanceOf,
  bill120,
  billOf,
  cash,
  dialog,
  flush,
  emit,
  equipmentWith,
  BAR_PRINTER,
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
  roleOf,
  SECOND_READER,
  stubApi,
  takenOf,
  tableOrder,
  tarta,
  text,
  till,
  type,
  vino,
} from "../test/bill-pay-app.js";
import { cancelReason, cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { switchToBill } from "./screens/till-table-order-screen.bill-switcher.test-helpers.js";
import { TillApp } from "./till-app.js";
import { billLabel } from "./state/bill-state.js";
import { codeMessage } from "./i18n/codes.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import { fill, setLocale, t } from "./i18n/t.js";
import type {
  BillBalance,
  BillPaymentResult,
  BillPaymentView,
  TabLine,
  TillApi,
} from "./api/client.js";
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

/** The server's answer: the new bill `wo-9`, settled by the payment, with its receipt, and the
 * table's bill `source`. */
const paidOnWo9 = (
  over: Parameters<typeof takenOf>[0] = {},
  source: Partial<BillBalance> = {},
): ItemPaymentResult => ({
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
  sourceBalance: balanceOf(source),
});

const formError = (el: TillApp) => inDialog(el, "wt-form-actions")!.error;

/** The printed bill wo-4, its receipt issued. */
const printedWo4 = billOf({ status: "placed", invoiceNumber: "A-1/405" });

/** The printed bill wo-4 as the bills read lists it once Pay for items has credited its receipt. */
const creditedWo4 = billOf({
  billNumber: null,
  status: "abandoned",
  invoiceNumber: "A-1/405",
  correctives: ["R-1/4"],
  outstanding: "0.00",
  amountDue: "0.00",
});

/** The Pay window's own line saying wo-4's receipt was credited, or null when it shows none. */
const windowCredited = (el: TillApp) => {
  const line = inDialog(el, "[data-pay-credited]");
  return line === null ? null : text(line);
};

/** The screen's notice once Pay for items credited wo-4's receipt, its dishes on `shown`. */
const creditedNotice = (shown: string) => `Receipt cancelled. The dishes are on ${shown}.`;

/** Pay > Items on wo-4, the dishes on `lineNos` chosen. */
async function chooseItems(el: TillApp, lineNos: number[]): Promise<void> {
  await openTable(el);
  await openDialog(el, "items");
  for (const lineNo of lineNos) await press(el, `input[name="line"][value="${lineNo}"]`);
}

/** Pay > Items on the printed bill wo-4: its Pay opens the Pay window. */
async function choosePrintedItems(el: TillApp, lineNos: number[]): Promise<void> {
  const order = await openTable(el);
  if (order.orderId !== "wo-4") {
    await switchToBill(order, "wo-4");
    await flush(el);
  }
  order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
  await flush(el);
  await press(el, 'input[name="way"][value="items"]');
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

  it("the new bill's receipt offers the payment slip on the new bill", async () => {
    const printPaymentSlip = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountApp({
      getDeviceEquipment: vi.fn().mockResolvedValue({
        roles: [roleOf("payment_slip", BAR_PRINTER, [BAR_PRINTER])],
      }),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
      payForItems: vi.fn().mockResolvedValue(paidOnWo9({ id: "new-payment" })),
      printPaymentSlip,
    });
    await chooseItems(el, [4, 5]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");

    el.shadowRoot!.querySelector("till-settlement-document-dialog")!
      .shadowRoot!.querySelector<HTMLElement>("[data-print-payment-slip]")!
      .click();
    await flush(el);

    expect(printPaymentSlip).toHaveBeenCalledExactlyOnceWith("wo-9", "new-payment");
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

  it("a printed bill's items go to the new route and the table shows the reopened bill", async () => {
    const owing = billOf({ workingOrderId: "bill-1", billNumber: 1, outstanding: "20.00" });
    // The draft fixture serves wo-5, so it stands for the reopened bill.
    let paid = false;
    const getPartyBills = vi.fn(async () =>
      paid
        ? [
            owing,
            creditedWo4,
            billOf({
              workingOrderId: "wo-5",
              billNumber: 2,
              total: "108.00",
              outstanding: "108.00",
            }),
            billOf({
              workingOrderId: "wo-9",
              billNumber: 3,
              status: "settled",
              outstanding: "0.00",
            }),
          ]
        : [owing, billOf({ billNumber: 2, status: "placed", invoiceNumber: "A-1/405" })],
    );
    const payForItems = vi.fn(async () => {
      paid = true;
      return paidOnWo9(
        { applied: "12.00", change: "38.00" },
        { workingOrderId: "wo-5", total: "108.00", outstanding: "108.00" },
      );
    });
    const { el } = await mountApp({
      getPartyBills,
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi
        .fn()
        .mockResolvedValue(itemsPreview({ total: "12.00", applied: "12.00", change: "38.00" })),
      payForItems,
      getReceiptPrintStatus: vi.fn().mockRejectedValue({ code: "network" }),
    });
    await choosePrintedItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    expect(text(inDialog(el, "[data-pay-own-bill]"))).toBe(
      "This cancels the existing receipt and reopens the bill.",
    );
    await press(el, "[data-pay-confirm]");

    expect(api.previewItemPayment).toHaveBeenCalledWith("wo-4", {
      picks: [{ lineId: "line-4" }],
      method: "cash",
      tendered: "50",
    });
    expect(payForItems).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({ picks: [{ lineId: "line-4" }], expectedEdits: [wo4Edit] }),
      expect.anything(),
    );
    expect(api.previewBillPayment).not.toHaveBeenCalled();
    expect(api.takeBillPayment).not.toHaveBeenCalled();
    const ticket = el.shadowRoot!.querySelector("till-settlement-document-dialog")!;
    expect(ticket).not.toBeNull();
    expect(api.getReceiptPrintStatus).toHaveBeenCalledWith("wo-9");

    emit(ticket, "settlement-close");
    await flush(el, 6);
    const order = tableOrder(el);
    expect(order.orderId).toBe("wo-5");
    expect(text(order.shadowRoot!.querySelector("[data-bill-gone]"))).toBe(
      creditedNotice("Bill 2"),
    );
    expect(order.shadowRoot!.querySelector('[data-switch-bill="wo-4"]')).toBeNull();
    order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-presented-pay-dialog")).toBeNull();
    expect(dialog(el)).not.toBeNull();
  });

  it("on a phone, the bills read behind the receipt says the printed bill's receipt was credited", async () => {
    let paid = false;
    const getPartyBills = vi.fn(async () =>
      paid
        ? [
            // Another bill still owing, listed first: the screen still shows the reopened bill.
            billOf({ workingOrderId: "bill-1", billNumber: 1, outstanding: "20.00" }),
            creditedWo4,
            billOf({
              workingOrderId: "wo-5",
              billNumber: 2,
              total: "108.00",
              outstanding: "108.00",
            }),
            billOf({
              workingOrderId: "wo-9",
              billNumber: 3,
              status: "settled",
              outstanding: "0.00",
            }),
          ]
        : [printedWo4],
    );
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({ ...till, formFactor: "phone-portrait" }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "d1", name: "Phone", formFactor: "phone-portrait" }),
      getPartyBills,
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi
        .fn()
        .mockResolvedValue(itemsPreview({ total: "12.00", applied: "12.00", change: "38.00" })),
      payForItems: vi.fn(async () => {
        paid = true;
        return paidOnWo9(
          { applied: "12.00", change: "38.00" },
          { workingOrderId: "wo-5", total: "108.00", outstanding: "108.00" },
        );
      }),
      getReceiptPrintStatus: vi.fn().mockRejectedValue({ code: "network" }),
    });
    await choosePrintedItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el, 6);

    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
    const order = tableOrder(el);
    expect(order.orderId).toBe("wo-5");
    expect(text(order.shadowRoot!.querySelector("[data-bill-gone]"))).toBe(
      creditedNotice("Bill 2"),
    );
  });

  it("a Counter order sent to the kitchen and moved to the table, with no receipt, shows Items barred", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([billOf({ status: "placed" })]),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
    });
    const order = await openTable(el);
    order.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!.click();
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-presented-pay-dialog")!, "presented-pay-parts");
    await flush(el);

    const root = dialog(el)!.shadowRoot!;
    expect(root.querySelector<HTMLInputElement>('[name="way"][value="items"]')!.disabled).toBe(
      true,
    );
    expect(text(root.querySelector("[data-pay-items-reason]"))).toBe(
      t("bill_pay.items_barred_counter"),
    );
  });

  it("the preview's reopen refusal shows before any money", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([printedWo4]),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi
        .fn()
        .mockRejectedValue({ code: "bill.unserved_dishes", status: 409, dishes: [] }),
    });
    await choosePrintedItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");

    expect(api.previewItemPayment).toHaveBeenCalledOnce();
    expect(formError(el)).toBe(codeMessage("bill.unserved_dishes"));
    expect(inDialog(el, "[data-pay-confirm]")).toBeNull();
    expect(api.payForItems).not.toHaveBeenCalled();
    expect(api.takeBillPayment).not.toHaveBeenCalled();
  });

  it("a printed bill that has had an advance says its dishes cannot be paid for separately and names the Pay window's other buttons", async () => {
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([printedWo4]),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi.fn().mockRejectedValue({ code: "bill.has_advance", status: 409 }),
    });
    await choosePrintedItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");

    expect(formError(el)).toBe(codeMessage("bill.has_advance"));
    expect(formError(el)).toContain("so its dishes cannot be paid for separately.");
    expect(formError(el)).toContain("with An amount or Split equally");
    expect(api.payForItems).not.toHaveBeenCalled();
    onTestFinished(() => setLocale("en"));
    setLocale("es");
    expect(codeMessage("bill.has_advance", "es")).toContain(t("bill_pay.way_contribution"));
    expect(codeMessage("bill.has_advance", "es")).toContain(t("bill_pay.way_share"));
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

  it("a cancelled set-menu dish still charged, chosen alone, says to choose its set menu too", async () => {
    const { el } = await mountApp({
      previewItemPayment: vi.fn().mockRejectedValue({
        code: "set_menu.moves_with_set_menu",
        status: 409,
        dishName: "Tarta",
      }),
    });
    await chooseItems(el, [4]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    expect(formError(el)).toBe(fill(t("bill_pay.items_set_menu_dish"), { dishName: "Tarta" }));
  });

  it("a comped or discounted set-menu dish chosen alone says to choose its set menu too", async () => {
    const { el } = await mountApp({
      previewItemPayment: vi.fn().mockRejectedValue({
        code: "set_menu.move_adjusted",
        status: 409,
        dishNames: ["Tarta", "Vino"],
      }),
    });
    await chooseItems(el, [4, 5]);
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    expect(formError(el)).toBe(
      fill(t("bill_pay.items_set_menu_adjusted"), { dishNames: "Tarta and Vino" }),
    );
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
    sourceBalance: balanceOf(),
  });
  const itemsSent = () =>
    vi.mocked(api.payForItems).mock.calls.map(([, request]) => request as ItemPaymentRequest);
  /** The new bill as a card that charged nothing leaves it once its dishes went back. */
  const putBack = { status: "abandoned" as const, outstanding: "0.00" };

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

  it("a declined reader card leaves the table's bill as it was, shown from the answer, reading no balance", async () => {
    const table = balanceOf({ total: "90.00", outstanding: "90.00" });
    const { el } = await mountApp({
      ...withReader(),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi
        .fn()
        .mockResolvedValue({ ...onWo9("declined", "failed"), sourceBalance: table }),
    });
    await chooseItems(el, [4, 5]);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;
    const balanceReads = vi.mocked(api.getBillBalance).mock.calls.length;
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
    expect(tableOrder(el).billBalance).toEqual(table);
    expect(dialog(el)!.balance).toEqual(table);
    expect(vi.mocked(api.getBillBalance).mock.calls.slice(balanceReads)).toEqual([]);
  });

  it("a declined card on an open bill keeps the dishes chosen, back under new numbers", async () => {
    let paid = false;
    // The declined dishes come back to the table's bill with their ids, at its end.
    const back = [...bill120.slice(0, 3), { ...tarta, lineNo: 6 }, { ...vino, lineNo: 7 }];
    const { el } = await mountApp({
      ...withReader(),
      getTabLines: vi.fn(async () => ({ lines: paid ? back : bill120, revision: 0 })),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(async () => {
        paid = true;
        return onWo9("declined", "failed");
      }),
    });
    await confirmOnReader(el);
    await flush(el, 6);

    expect(formError(el)).toBe(t("bill_pay.card_declined"));
    expect(windowCredited(el)).toBeNull();
    expect(inDialog(el, "#lines-error")).toBeNull();
    expect(
      [...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="line"]')]
        .filter((box) => box.checked)
        .map((box) => box.value),
    ).toEqual(["6", "7"]);
  });

  it("a declined card on a printed bill moves to the reopened bill and says so", async () => {
    let paid = false;
    // The draft fixture serves wo-5, so it stands for the reopened bill.
    const reopened = balanceOf({ workingOrderId: "wo-5" });
    const { el } = await mountApp({
      ...withReader(),
      getPartyBills: vi.fn(async () =>
        paid ? [creditedWo4, billOf({ workingOrderId: "wo-5", billNumber: 2 })] : [printedWo4],
      ),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(async () => {
        paid = true;
        return { ...onWo9("declined", "failed", putBack), sourceBalance: reopened };
      }),
    });
    await choosePrintedItems(el, [4, 5]);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el, 6);

    expect(api.payForItems).toHaveBeenCalledWith("wo-4", expect.anything(), expect.anything());
    expect(formError(el)).toBe(t("bill_pay.card_declined"));
    expect(inDialog(el, "[data-pay-continue]")).not.toBeNull();
    expect(tableOrder(el).orderId).toBe("wo-5");
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(
      creditedNotice("Bill 2"),
    );
    expect(windowCredited(el)).toBe(creditedNotice("Bill 2"));
    expect(tableOrder(el).billBalance).toEqual(reopened);
    expect(dialog(el)!.balance).toEqual(reopened);
    expect(vi.mocked(api.getTabLines).mock.calls).toContainEqual(["wo-5"]);
    await press(el, 'input[name="line"][value="4"]');
    await press(el, "[data-pay-continue]");
    expect(vi.mocked(api.previewItemPayment).mock.calls.at(-1)![0]).toBe("wo-5");
  });

  it("a declined card whose dishes could not go back to the reopened bill shows the bill they stayed on", async () => {
    let paid = false;
    // While the card was out the reopened bill wo-5 was printed again, so the dishes stay on wo-9.
    const stayed = { status: "open" as const, outstanding: "30.00" };
    const { el } = await mountApp({
      ...withReader(),
      getPartyBills: vi.fn(async () =>
        paid
          ? [
              creditedWo4,
              billOf({
                workingOrderId: "wo-5",
                billNumber: 2,
                status: "placed",
                invoiceNumber: "A-1/406",
              }),
              billOf({ workingOrderId: "wo-9", billNumber: 3, total: "30.00", ...stayed }),
            ]
          : [printedWo4],
      ),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(async () => {
        paid = true;
        return {
          ...onWo9("declined", "failed", stayed),
          sourceBalance: balanceOf({
            workingOrderId: "wo-5",
            status: "placed",
            outstanding: "90.00",
          }),
        };
      }),
    });
    await choosePrintedItems(el, [4, 5]);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el, 6);

    const kept = creditedNotice("Bill 3");
    expect(formError(el)).toBe(t("bill_pay.card_declined"));
    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(kept);
    expect(windowCredited(el)).toBe(kept);
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-9");
  });

  /** A declined card on the printed bill wo-4, whose dishes are `printed`, after choosing the
   * dishes on `chosen`. The reopened bill wo-5 holds copies of them, with ids of their own and
   * numbered from 1, the chosen ones moved back to its end under new numbers, as the server's
   * reopen and the declined card leave them. */
  async function declinedOnPrinted(printed: TabLine[], chosen: number[]): Promise<TillApp> {
    let paid = false;
    // The draft fixture serves wo-5, so it stands for the reopened bill.
    const copies = printed.map((dish, index) => ({
      ...dish,
      id: `copy-${dish.lineNo}`,
      lineNo: index + 1,
    }));
    const back = copies.filter((_, index) => chosen.includes(printed[index]!.lineNo));
    const reopenedLines = [
      ...copies.filter((copy) => !back.includes(copy)),
      ...back.map((copy, index) => ({ ...copy, lineNo: copies.length + index + 1 })),
    ];
    const { el } = await mountApp({
      ...withReader(),
      getPartyBills: vi.fn(async () => [paid ? billOf({ workingOrderId: "wo-5" }) : printedWo4]),
      getTabLines: vi.fn(async (billId: string) => ({
        lines: billId === "wo-5" ? reopenedLines : printed,
        revision: 0,
      })),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(async () => {
        paid = true;
        return {
          ...onWo9("declined", "failed", putBack),
          sourceBalance: balanceOf({ workingOrderId: "wo-5" }),
        };
      }),
    });
    await choosePrintedItems(el, chosen);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-5");
    return el;
  }

  it("the credited-receipt notices follow a change of language", async () => {
    onTestFinished(() => setLocale("en"));
    const el = await declinedOnPrinted(bill120, [4]);
    setLocale("es");
    await flush(el);

    const spanish = fill(t("table.bill_credited"), {
      shown: billLabel({ billNumber: 1, billName: null }),
    });
    expect(spanish).toContain("Cuenta");
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(spanish);
    expect(windowCredited(el)).toBe(spanish);
  });

  const ticked = (el: TillApp) =>
    [...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="line"]')]
      .filter((box) => box.checked)
      .map((box) => box.value);

  it("a declined card on a printed bill says only that it was declined, and the dishes are chosen again", async () => {
    const el = await declinedOnPrinted(bill120, [4, 5]);

    expect(formError(el)).toBe(t("bill_pay.card_declined"));
    expect(inDialog(el, "#lines-error")).toBeNull();
    expect(ticked(el)).toEqual([]);
    await press(el, 'input[name="line"][value="7"]');
    await press(el, "[data-pay-continue]");
    expect(vi.mocked(api.previewItemPayment).mock.calls.at(-1)).toEqual([
      "wo-5",
      expect.objectContaining({ picks: [{ lineId: "copy-5" }] }),
    ]);
  });

  it("a declined card on a printed bill never leaves another dish chosen under a reused number", async () => {
    // A printed bill whose numbers start at 2, as when its first dish was moved off it.
    const printed = bill120.map((dish) => ({ ...dish, lineNo: dish.lineNo + 1 }));
    const el = await declinedOnPrinted(printed, [5]);

    expect(ticked(el)).toEqual([]);
    expect(formError(el)).toBe(t("bill_pay.card_declined"));
  });

  it("a card still pending on a printed bill moves to the reopened bill, its outcome unknown there", async () => {
    let paid = false;
    // The draft fixture serves wo-5, so it stands for the reopened bill.
    const reopened = balanceOf({ workingOrderId: "wo-5" });
    const { el } = await mountApp({
      getTill: vi.fn().mockResolvedValue({
        ...till,
        cardProvider: "stripe_terminal",
        capabilities: [
          "print-receipt",
          "integrated-card-payment",
          "close-deferred",
        ] as CapabilityFlag[],
        activeReaders: readers.map((reader) => ({ ...reader, provider: "stripe_terminal" })),
        defaultReaderId: readers[0]!.id,
      }),
      getPartyBills: vi.fn(async () =>
        paid ? [creditedWo4, billOf({ workingOrderId: "wo-5", billNumber: 2 })] : [printedWo4],
      ),
      readCurrentOrders: vi.fn().mockResolvedValue({
        revision: 1,
        hasGroups: false,
        nextDisplayNumber: 1,
        retainedCourses: [],
        reminder: null,
        groups: [],
        ungrouped: [],
      }),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(async () => {
        paid = true;
        return {
          ...onWo9("timeout", "pending", { reserved: "30.00", outstanding: "0.00" }),
          sourceBalance: reopened,
        };
      }),
    });
    await choosePrintedItems(el, [4, 5]);
    expect(dialog(el)!.deferredOffered).toEqual({ state: "offered" });
    const balanceReads = vi.mocked(api.getBillBalance).mock.calls.length;
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el, 6);

    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
      t("bill_pay.card_pending").replace("{amount}", money("30.00")),
    );
    expect(tableOrder(el).orderId).toBe("wo-5");
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(
      creditedNotice("Bill 2"),
    );
    expect(windowCredited(el)).toBe(creditedNotice("Bill 2"));
    expect(tableOrder(el).billBalance).toEqual(reopened);
    expect(dialog(el)!.balance).toEqual(reopened);
    expect(vi.mocked(api.getBillBalance).mock.calls.slice(balanceReads)).toEqual([]);
    expect(dialog(el)!.deferredOffered).toEqual({
      state: "off",
      reason: "deferred_close.payment_unconfirmed",
    });
  });

  it("on a phone, a card pending on a printed bill then declined, its dishes kept on their own bill, shows that bill", async () => {
    let paid = false;
    let declined = false;
    const pendingOn9 = balanceOf({
      workingOrderId: "wo-9",
      total: "30.00",
      reserved: "30.00",
      outstanding: "0.00",
      payments: [paymentOf({ id: "pay-1", method: "card", entry: "reader", state: "pending" })],
    });
    // While the card was out the reopened bill wo-5 was printed again, so the dishes stay on wo-9.
    const declinedOn9 = {
      ...pendingOn9,
      status: "open" as const,
      reserved: "0.00",
      outstanding: "30.00",
      payments: [{ ...pendingOn9.payments[0]!, state: "failed" as const }],
    };
    const getBillBalance = vi.fn(async (billId: string) =>
      billId === "wo-9"
        ? declined
          ? declinedOn9
          : pendingOn9
        : balanceOf({ status: "placed", workingOrderId: billId }),
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
      getPartyBills: vi.fn(async () =>
        !paid
          ? [printedWo4]
          : declined
            ? [
                creditedWo4,
                billOf({
                  workingOrderId: "wo-5",
                  billNumber: 2,
                  status: "placed",
                  invoiceNumber: "A-1/406",
                }),
                billOf({
                  workingOrderId: "wo-9",
                  billNumber: 3,
                  total: "30.00",
                  outstanding: "30.00",
                }),
              ]
            : [creditedWo4, billOf({ workingOrderId: "wo-5", billNumber: 2 })],
      ),
      getBillBalance,
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(async () => {
        paid = true;
        return {
          ...onWo9("timeout", "pending", { reserved: "30.00", outstanding: "0.00" }),
          sourceBalance: balanceOf({ workingOrderId: "wo-5" }),
        };
      }),
    });
    await choosePrintedItems(el, [4, 5]);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, "[data-pay-continue]");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(tableOrder(el).orderId).toBe("wo-5"));
    await flush(el);
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(
      creditedNotice("Bill 2"),
    );

    declined = true;
    await vi.advanceTimersByTimeAsync(5_000);
    await flush(el, 6);

    const kept = creditedNotice("Bill 3");
    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(kept);
    expect(windowCredited(el)).toBe(kept);
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-9");
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

  it("Cancel payment on a printed bill moves to the reopened bill and says its receipt was credited", async () => {
    let settle!: (result: ItemPaymentResult) => void;
    let paid = false;
    const cancelBillReaderPayment = vi.fn().mockResolvedValue({ outcome: "requested" });
    const { el } = await mountApp({
      ...withReader("sumup_cloud"),
      cancelBillReaderPayment,
      getPartyBills: vi.fn(async () =>
        paid ? [creditedWo4, billOf({ workingOrderId: "wo-5", billNumber: 2 })] : [printedWo4],
      ),
      getBillBalance: vi.fn().mockResolvedValue(balanceOf({ status: "placed" })),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn(
        () =>
          new Promise<ItemPaymentResult>((resolve) => {
            settle = resolve;
          }),
      ),
    });
    await choosePrintedItems(el, [4, 5]);
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await press(el, "[data-pay-cancel-reader]");
    paid = true;
    settle({
      ...onWo9("declined", "failed", putBack),
      sourceBalance: balanceOf({ workingOrderId: "wo-5" }),
    });
    await flush(el, 6);

    expect(cancelBillReaderPayment).toHaveBeenCalledWith(
      "wo-4",
      expect.any(String),
      expect.anything(),
    );
    expect(formError(el)).toBe(t("bill_pay.no_payment_taken"));
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-5");
    expect(tableOrder(el).orderId).toBe("wo-5");
    expect(text(tableOrder(el).shadowRoot!.querySelector("[data-bill-gone]"))).toBe(
      creditedNotice("Bill 2"),
    );
    expect(windowCredited(el)).toBe(creditedNotice("Bill 2"));
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

  it("a card still pending on a till shows the payment in progress and the table's bill from the answer, reading no balance", async () => {
    const table = balanceOf({ total: "90.00", outstanding: "90.00" });
    const { el } = await mountApp({
      ...withReader(),
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi.fn().mockResolvedValue({
        ...onWo9("timeout", "pending", { reserved: "30.00", outstanding: "0.00" }),
        sourceBalance: table,
      }),
    });
    await chooseItems(el, [4, 5]);
    const lineReads = vi.mocked(api.getTabLines).mock.calls.length;
    const balanceReads = vi.mocked(api.getBillBalance).mock.calls.length;
    await press(el, 'input[name="method"][value="card"]');
    await press(el, `input[name="reader"][value="${readers[1]!.id}"]`);
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await flush(el);

    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
      t("bill_pay.card_pending").replace("{amount}", money("30.00")),
    );
    expect(dialog(el)!.balance).toEqual(table);
    expect(tableOrder(el).billBalance).toEqual(table);
    expect(vi.mocked(api.getBillBalance).mock.calls.slice(balanceReads)).toEqual([]);
    expect(vi.mocked(api.getTabLines).mock.calls.length).toBeGreaterThan(lineReads);
  });

  it("a card taken after it was pending on a handheld offers its slip on the bill that received it", async () => {
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
    const printPaymentSlip = vi.fn().mockResolvedValue(undefined);
    const equipment = equipmentWith(SECOND_READER);
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
      getDeviceEquipment: vi.fn().mockResolvedValue({
        roles: [...equipment.roles, roleOf("payment_slip", BAR_PRINTER, [BAR_PRINTER])],
      }),
      getBillBalance,
      previewItemPayment: vi.fn().mockResolvedValue(itemsPreview({ change: null })),
      payForItems: vi
        .fn()
        .mockResolvedValue(onWo9("timeout", "pending", { reserved: "30.00", outstanding: "0.00" })),
      printPaymentSlip,
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
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));

    await press(el, "[data-print-payment-slip]");

    expect(printPaymentSlip).toHaveBeenCalledExactlyOnceWith("wo-9", "pay-1");
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
    expect(api.printReceipt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await flush(el);
    expect(inDialog(el, "[data-pay-uncertain]")).toBeNull();
    expect(text(inDialog(el, "[data-pay-taken]"))).toBe(t("bill_pay.taken"));
    expect(dialog(el)!.balance?.workingOrderId).toBe("wo-4");
    expect(getBillBalance).toHaveBeenCalledWith("wo-4");
    await vi.advanceTimersByTimeAsync(10_000);
    await flush(el);
    expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith("wo-9", { ifOwed: true });
  });

  describe("at the Counter", () => {
    const onWo1 = { workingOrderId: "wo-1" };
    const counterEdit = { billId: "wo-1", editorVersion: 2, draftId: null, draftRevision: null };
    const counter = (el: TillApp) =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-counter-screen"]>(
        "till-counter-screen",
      )!;

    const heldWo1 = {
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
    };

    /** Signed in at the counter with the held order `wo-1` retrieved, its edit state as each
     * read in `edits` gives it (the last one repeating). */
    async function retrieved(
      overrides: Record<string, unknown>,
      edits: (typeof counterEdit | null)[] = [counterEdit],
      permissions: string[] = [],
    ): Promise<TillApp> {
      let reads = 0;
      const { el } = await mountApp({
        listWorkingOrders: vi.fn().mockResolvedValue([heldWo1]),
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
      emit(lock(el), "logged-in", { personId: "p1", displayName: "Ana", permissions });
      await flush(el);
      emit(counter(el), "retrieve-order", { id: "wo-1" });
      await flush(el);
      return el;
    }

    it("at the Counter retrieving an order paid over its total says nothing negative is to pay", async () => {
      const el = await retrieved({
        listWorkingOrders: vi
          .fn()
          .mockResolvedValue([
            { ...heldWo1, total: "90.00", outstanding: "-5.00", hasPayments: true },
          ]),
        getBillBalance: vi.fn().mockResolvedValue(
          balanceOf({
            workingOrderId: "wo-1",
            total: "90.00",
            received: "95.00",
            overpaid: "5.00",
          }),
        ),
      });

      expect(text(el.shadowRoot!.querySelector(".error"))).toBe(
        [
          t("table.bill_to_pay").replace("{amount}", money("0.00")),
          t("bill.pay_with_bill_payments"),
        ].join(". "),
      );
    });

    async function chooseFirst(el: TillApp): Promise<string> {
      emit(counter(el), "counter-bill-pay", {});
      await flush(el);
      await press(el, 'input[name="way"][value="items"]');
      const first = dialog(el)!.lines[0]!;
      await press(el, `input[name="line"][value="${first.lineNo}"]`);
      await type(el, "tendered", "50");
      return first.lineId;
    }

    it("at the Counter the window stays, says the payment was taken, and reads the order again without a balance read", async () => {
      let paid = false;
      const table = balanceOf({ workingOrderId: "wo-1", total: "90.00", outstanding: "90.00" });
      const payForItems = vi.fn(async () => {
        paid = true;
        return { ...paidOnWo9({}, onWo1), sourceBalance: table };
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
      expect(dialog(el)!.balance).toEqual(table);
      expect(vi.mocked(api.getBillBalance).mock.calls.slice(balanceReads)).toEqual([]);
      expect(vi.mocked(api.retrieveWorkingOrder).mock.calls.length).toBeGreaterThan(orderReads);
      expect(dialog(el)!.lines.map((row) => row.lineId)).toEqual(
        bill120.slice(1).map((dish) => dish.id),
      );
    });

    it.each([
      [["print-receipt", "take-cash"], [["wo-9", { ifOwed: true }]]],
      [["take-cash"], []],
    ] as const)(
      "at the Counter the new bill's receipt prints once its invoice is issued (capabilities %j)",
      async (capabilities, asked) => {
        const el = await retrieved({
          getTill: vi.fn().mockResolvedValue({ ...till, capabilities: [...capabilities] }),
          previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
          payForItems: vi.fn().mockResolvedValue(paidOnWo9({}, onWo1)),
        });
        await chooseFirst(el);
        await press(el, "[data-pay-continue]");
        expect(api.printReceipt).not.toHaveBeenCalled();
        await press(el, "[data-pay-confirm]");
        await flush(el);

        expect(text(inDialog(el, "[data-pay-taken]"))).toBe(
          t("bill_pay.taken_change").replace("{amount}", money("20.00")),
        );
        expect(vi.mocked(api.printReceipt).mock.calls).toEqual(asked);
      },
    );

    /** `wo-1` holding €95.00 on dishes that now come to €90.00 once the chosen dish is paid on
     * `wo-9`, as after An amount and then Pay for items. */
    async function leftOverpaid(
      overrides: Record<string, unknown> = {},
      permissions: string[] = [],
    ): Promise<TillApp> {
      let paid = false;
      const el = await retrieved(
        {
          listWorkingOrders: vi.fn(async () => [
            paid
              ? { ...heldWo1, total: "90.00", outstanding: "-5.00", hasPayments: true }
              : { ...heldWo1, outstanding: "25.00", hasPayments: true },
          ]),
          getBillBalance: vi.fn(async () =>
            balanceOf({
              workingOrderId: "wo-1",
              total: paid ? "90.00" : "120.00",
              received: "95.00",
              outstanding: paid ? "0.00" : "25.00",
              overpaid: paid ? "5.00" : "0.00",
              payments: [paymentOf({ applied: "95.00", tendered: "95.00" })],
            }),
          ),
          previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
          payForItems: vi.fn(async () => {
            paid = true;
            return paidOnWo9({}, onWo1);
          }),
          ...overrides,
        },
        [counterEdit],
        permissions,
      );
      await chooseFirst(el);
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      await flush(el);
      emit(dialog(el)!, "bill-pay-close");
      await flush(el);
      return el;
    }

    it("at the Counter an order left paid over its total offers Give back and no Pay", async () => {
      const el = await leftOverpaid();

      const notice = counter(el).shadowRoot!.querySelector("[data-overpaid]");
      expect(text(notice?.querySelector("p"))).toBe(
        fill(t("table.overpaid"), { amount: money("5.00") }),
      );
      expect(notice!.querySelector("[data-keep-as-tip]")).toBeNull();
      const pay = counter(el).shadowRoot!.querySelector("till-tender-pay")!;
      expect(pay.shadowRoot!.querySelector("[data-counter-pay]")).toBeNull();

      notice!.querySelector<HTMLElement>("[data-give-back]")!.click();
      await flush(el, 6);

      expect(dialog(el)!.balance?.workingOrderId).toBe("wo-1");
      const giving =
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-bill-refund-dialog"]>(
          "till-bill-refund-dialog",
        );
      expect(giving?.suggested).toBe("5.00");
    });

    it("at the Counter Keep as tip keeps the excess, prints the order's receipt and starts a new sale", async () => {
      const keepOverpaidAsTip = vi.fn().mockResolvedValue(
        balanceOf({
          workingOrderId: "wo-1",
          status: "settled",
          total: "90.00",
          received: "90.00",
          outstanding: "0.00",
          tips: "5.00",
        }),
      );
      const el = await leftOverpaid({ keepOverpaidAsTip }, ["payment.take"]);
      vi.mocked(api.printReceipt).mockClear();

      counter(el)
        .shadowRoot!.querySelector<HTMLElement>("[data-overpaid] [data-keep-as-tip]")!
        .click();
      await flush(el, 6);

      expect(keepOverpaidAsTip).toHaveBeenCalledExactlyOnceWith(
        "wo-1",
        expect.stringMatching(/^[0-9a-f-]{36}$/),
        "5.00",
        expect.anything(),
      );
      expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith("wo-1", { ifOwed: true });
      expect(counter(el).store.id).not.toBe("wo-1");
      expect(counter(el).shadowRoot!.querySelector("[data-overpaid]")).toBeNull();
    });

    it("at the Counter Keep as tip refused because the excess changed says so in its own words", async () => {
      const el = await leftOverpaid(
        {
          keepOverpaidAsTip: vi
            .fn()
            .mockRejectedValue({ code: "bill.overpaid_changed", status: 409 }),
        },
        ["payment.take"],
      );

      counter(el)
        .shadowRoot!.querySelector<HTMLElement>("[data-overpaid] [data-keep-as-tip]")!
        .click();
      await flush(el, 6);

      expect(text(el.shadowRoot!.querySelector(".error"))).toBe(
        codeMessage("bill.overpaid_changed"),
      );
    });

    it("at the Counter the overpaid amount shown and sent is the bill balance's, read once", async () => {
      const keepOverpaidAsTip = vi.fn().mockResolvedValue(balanceOf({ workingOrderId: "wo-1" }));
      let paid = false;
      const getBillBalance = vi.fn(async () =>
        balanceOf({
          workingOrderId: "wo-1",
          total: paid ? "88.00" : "120.00",
          received: "95.00",
          outstanding: paid ? "0.00" : "25.00",
          overpaid: paid ? "7.00" : "0.00",
          payments: [paymentOf({ applied: "95.00", tendered: "95.00" })],
        }),
      );
      const el = await leftOverpaid(
        {
          listWorkingOrders: vi.fn(async () => [
            paid
              ? { ...heldWo1, total: "90.00", outstanding: "-5.00", hasPayments: true }
              : { ...heldWo1, outstanding: "25.00", hasPayments: true },
          ]),
          getBillBalance,
          keepOverpaidAsTip,
          payForItems: vi.fn(async () => {
            paid = true;
            return paidOnWo9({}, onWo1);
          }),
        },
        ["payment.take"],
      );
      await flush(el, 6);
      const reads = getBillBalance.mock.calls.length;

      const notice = counter(el).shadowRoot!.querySelector("[data-overpaid]");
      expect(text(notice?.querySelector("p"))).toBe(
        fill(t("table.overpaid"), { amount: money("7.00") }),
      );
      counter(el).requestUpdate();
      el.requestUpdate();
      await flush(el, 4);
      expect(getBillBalance.mock.calls.length).toBe(reads);

      notice!.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
      await flush(el, 6);

      expect(keepOverpaidAsTip.mock.calls[0]![2]).toBe("7.00");
    });

    it("at the Counter Pay returns once an unanswered bill balance read reaches its time limit", async () => {
      let paid = false;
      // Only the Counter's own read of the overpaid order is left unanswered; the Pay window's
      // reads, which send no signal, answer.
      const getBillBalance = vi.fn(
        (_billId: string, options?: { signal?: AbortSignal }) =>
          new Promise<BillBalance>((resolve, reject) => {
            if (paid && options?.signal !== undefined) {
              options.signal.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError")),
              );
              return;
            }
            resolve(
              balanceOf({
                workingOrderId: "wo-1",
                total: paid ? "90.00" : "120.00",
                received: "95.00",
                outstanding: paid ? "0.00" : "25.00",
                overpaid: paid ? "5.00" : "0.00",
                payments: [paymentOf({ applied: "95.00", tendered: "95.00" })],
              }),
            );
          }),
      );
      // Faked before the read starts, so its time limit runs on the fake clock; flush's own
      // zero-length waits still pass as real time does.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const el = await leftOverpaid({
        listWorkingOrders: vi.fn(async () => [
          paid
            ? { ...heldWo1, total: "90.00", outstanding: "-5.00", hasPayments: true }
            : { ...heldWo1, outstanding: "25.00", hasPayments: true },
        ]),
        getBillBalance,
        payForItems: vi.fn(async () => {
          paid = true;
          return paidOnWo9({}, onWo1);
        }),
      });
      const payButton = () =>
        counter(el)
          .shadowRoot!.querySelector("till-tender-pay")!
          .shadowRoot!.querySelector("[data-counter-pay]");
      await flush(el, 4);
      expect(counter(el).shadowRoot!.querySelector("[data-overpaid]")).toBeNull();
      expect(payButton()).toBeNull();

      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1_000);
      await flush(el, 4);
      expect(payButton()).toBeNull();

      await vi.advanceTimersByTimeAsync(1_000);
      await flush(el, 4);

      expect(payButton()).not.toBeNull();
      expect(
        counter(el).shadowRoot!.querySelector("[data-counter-bill-payments]")!.textContent,
      ).toContain(t("table.bill_to_pay").replace("{amount}", money("0.00")));
    });

    it("at the Counter giving back the whole excess starts a new sale", async () => {
      const settledByGiveBack = {
        refund: {
          id: "r-1",
          paymentId: "pay-1",
          submissionId: "rs-1",
          appliedAmount: "5.00",
          tipAmount: "0.00",
          reason: cancelReason.name,
          state: "completed" as const,
          createdAt: "2026-09-30T20:10:00.000Z",
          completedAt: "2026-09-30T20:10:00.000Z",
        },
        balance: balanceOf({
          workingOrderId: "wo-1",
          status: "settled",
          total: "90.00",
          received: "90.00",
          outstanding: "0.00",
        }),
      };
      const el = await leftOverpaid({
        listAdjustmentReasons: vi.fn().mockResolvedValue([cancelReason]),
        refundBillPayment: vi.fn(async () => {
          vi.mocked(api.retrieveWorkingOrder).mockRejectedValue({
            code: "working_order.not_found",
            status: 404,
          });
          vi.mocked(api.listWorkingOrders).mockResolvedValue([]);
          return settledByGiveBack;
        }),
      });
      vi.mocked(api.printReceipt).mockClear();
      counter(el)
        .shadowRoot!.querySelector<HTMLElement>("[data-overpaid] [data-give-back]")!
        .click();
      await flush(el, 6);
      const refund =
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-bill-refund-dialog"]>(
          "till-bill-refund-dialog",
        )!;
      const combo = refund.shadowRoot!.querySelector(
        'wt-combobox[name="reason"]',
      ) as HTMLElementTagNameMap["wt-combobox"];
      await expect.poll(() => combo.options[0]?.value).toBeDefined();
      combo.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: combo.options[0]!.value },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      refund.shadowRoot!.querySelector<HTMLElement>("[data-refund-continue]")!.click();
      await flush(el, 8);

      expect(api.refundBillPayment).toHaveBeenCalledOnce();
      expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith("wo-1", { ifOwed: true });
      expect(counter(el).store.id).not.toBe("wo-1");
      expect(counter(el).shadowRoot!.querySelector("[data-overpaid]")).toBeNull();
      expect(el.shadowRoot!.querySelector(".error")).toBeNull();
    });

    it("at the Counter Print payment slip names the bill that received the payment", async () => {
      const printPaymentSlip = vi.fn().mockResolvedValue(undefined);
      const el = await retrieved({
        getDeviceEquipment: vi.fn().mockResolvedValue({
          roles: [roleOf("payment_slip", BAR_PRINTER, [BAR_PRINTER])],
        }),
        previewItemPayment: vi.fn().mockResolvedValue(itemsPreview()),
        payForItems: vi.fn().mockResolvedValue(paidOnWo9({ id: "new-payment" }, onWo1)),
        printPaymentSlip,
      });
      await chooseFirst(el);
      await press(el, "[data-pay-continue]");
      await press(el, "[data-pay-confirm]");
      await flush(el);

      await press(el, "[data-print-payment-slip]");

      expect(printPaymentSlip).toHaveBeenCalledExactlyOnceWith("wo-9", "new-payment");
    });

    it("at the Counter a card charged for a different amount still warns", async () => {
      const answer = paidOnWo9({}, onWo1);
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
    const [billId, submissionId, overpaid] = keepOverpaidAsTip.mock.calls[0]! as unknown as [
      string,
      string,
      string,
    ];
    expect(billId).toBe("wo-4");
    expect(submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(overpaid).toBe("5.00");
    expect(getPartyBills.mock.calls.length).toBeGreaterThan(reads);
    const row = order.shadowRoot!.querySelector('[data-switch-bill="wo-4"]');
    expect(text(row)).toContain(t("table.bill_paid"));
    expect(row!.querySelector("[data-paid-mark]")).not.toBeNull();
    expect(order.shadowRoot!.querySelector("[data-overpaid]")).toBeNull();
    expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith("wo-4", { ifOwed: true });
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
    expect(api.printReceipt).not.toHaveBeenCalled();
  });

  it("Keep as tip refused because the excess changed says so and shows the new amount to confirm", async () => {
    let balance = overpaidBalance;
    const keepOverpaidAsTip = vi.fn<TillApi["keepOverpaidAsTip"]>(async () => {
      balance = balanceOf({
        total: "3.00",
        received: "18.00",
        outstanding: "-15.00",
        overpaid: "15.00",
        payments: [paymentOf({ applied: "18.00", tendered: "18.00" })],
      });
      throw { code: "bill.overpaid_changed", status: 409 };
    });
    const { el } = await mountApp({
      getPartyBills: vi.fn().mockResolvedValue([overpaidRow]),
      getBillBalance: vi.fn(async () => balance),
      keepOverpaidAsTip,
    });
    const order = await openTable(el, ["payment.take"]);
    await flush(el);
    const keep = () => order.shadowRoot!.querySelector<HTMLElement>("[data-keep-as-tip]")!;
    expect(text(keep())).toContain(money("5.00"));

    keep().click();
    await flush(el, 6);

    expect(keepOverpaidAsTip.mock.calls[0]![2]).toBe("5.00");
    expect(text(banner(el))).toContain(codeMessage("bill.overpaid_changed"));
    expect(text(keep())).toContain(money("15.00"));
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

describe("till-app: giving back money just taken on this bill", () => {
  const keyed = paymentOf({
    method: "card",
    entry: "manual",
    applied: "15.00",
    tendered: null,
    change: null,
  });
  const keyedOverpaid = (overpaid: string) =>
    balanceOf({
      total: overpaid === "0.00" ? "15.00" : "10.00",
      received: "15.00",
      outstanding: overpaid === "0.00" ? "0.00" : `-${overpaid}`,
      overpaid,
      payments: [keyed],
    });
  const givenBack = {
    refund: {
      id: "r-1",
      paymentId: "pay-1",
      submissionId: "rs-1",
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Charged twice",
      state: "completed",
      createdAt: "2026-09-30T20:10:00.000Z",
      completedAt: "2026-09-30T20:10:00.000Z",
    },
    balance: balanceOf({ total: "10.00", received: "10.00", outstanding: "0.00" }),
  };
  const refundDialog = (el: TillApp) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-bill-refund-dialog"]>(
      "till-bill-refund-dialog",
    );
  const inRefund = (el: TillApp, selector: string) =>
    refundDialog(el)!.shadowRoot!.querySelector<HTMLElement>(selector);
  const approval = (el: TillApp) =>
    el.shadowRoot!.querySelector("till-supervisor-override-dialog[data-refund-approval]");
  const refunds = () => vi.mocked(api.refundBillPayment).mock.calls.map(([, , request]) => request);

  /** wo-4 holding `keyed` with `overpaid` over its total: the Refund window opened on `keyed` by
   * Give back (by Pay's Refund when nothing is overpaid) and a reason chosen and continued. */
  async function giveBackKeyed(overrides: Record<string, unknown>, overpaid: string) {
    const { el } = await mountApp({
      getPartyBills: vi
        .fn()
        .mockResolvedValue([
          billOf({ total: "10.00", outstanding: "0.00", overpaid, hasPayments: true }),
        ]),
      getBillBalance: vi.fn().mockResolvedValue(keyedOverpaid(overpaid)),
      listRefundAuthorizers: vi.fn().mockResolvedValue([{ personId: "m-1", displayName: "Marta" }]),
      listAdjustmentReasons: vi.fn().mockResolvedValue([cancelReason]),
      ...overrides,
    });
    const order = await openTable(el);
    if (overpaid === "0.00") {
      await openDialog(el, "rest");
      await press(el, `[data-payment-refund="${keyed.id}"]`);
    } else {
      await flush(el);
      order.shadowRoot!.querySelector<HTMLElement>("[data-give-back]")!.click();
      await flush(el, 6);
      expect(refundDialog(el)!.suggested).toBe(overpaid);
    }
    const combo = inRefund(
      el,
      'wt-combobox[name="reason"]',
    ) as HTMLElementTagNameMap["wt-combobox"];
    await expect.poll(() => combo.options[0]?.value).toBeDefined();
    combo.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: combo.options[0]!.value },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    inRefund(el, "[data-refund-continue]")!.click();
    await flush(el);
    return el;
  }

  async function pinPad(el: TillApp, digits: string): Promise<void> {
    const override = approval(el)! as HTMLElement & { updateComplete: Promise<unknown> };
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

  it("a hand-keyed give-back within the excess is recorded with no PIN", async () => {
    const el = await giveBackKeyed(
      { refundBillPayment: vi.fn().mockResolvedValue(givenBack) },
      "5.00",
    );
    expect(refunds()).toEqual([]);

    inRefund(el, "[data-refund-terminal-done]")!.click();
    await flush(el);

    expect(refunds()).toEqual([
      {
        submissionId: expect.any(String),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: cancelReason.name,
        manualConfirmed: true,
      },
    ]);
    expect(approval(el)).toBeNull();
    expect(api.listRefundAuthorizers).not.toHaveBeenCalled();
    expect(refundDialog(el)).toBeNull();
    expect(api.printReceipt).not.toHaveBeenCalled();
  });

  it("a give-back that issues the bill prints its receipt", async () => {
    const el = await giveBackKeyed(
      {
        refundBillPayment: vi.fn().mockResolvedValue({
          ...givenBack,
          balance: { ...givenBack.balance, status: "settled" },
        }),
      },
      "5.00",
    );

    inRefund(el, "[data-refund-terminal-done]")!.click();
    await flush(el);

    expect(api.printReceipt).toHaveBeenCalledExactlyOnceWith("wo-4", { ifOwed: true });
  });

  it("a hand-keyed give-back the server still wants approved asks a PIN", async () => {
    const refundBillPayment = vi
      .fn()
      .mockRejectedValueOnce({
        code: "bill.manual_refund_pin_required",
        status: 403,
        paymentId: keyed.id,
      })
      .mockResolvedValue(givenBack);
    const el = await giveBackKeyed({ refundBillPayment }, "5.00");

    inRefund(el, "[data-refund-terminal-done]")!.click();
    await flush(el);
    expect(api.listRefundAuthorizers).toHaveBeenCalledOnce();
    expect(approval(el)).not.toBeNull();
    await pinPad(el, "1234");

    const sent = refunds();
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toHaveProperty("override");
    expect(sent[1]).toMatchObject({
      manualConfirmed: true,
      override: { personId: "m-1", pin: "1234" },
    });
    expect(sent[1]!.submissionId).toBe(sent[0]!.submissionId);
    expect(refundDialog(el)).toBeNull();
  });

  it("any other hand-keyed refund asks the PIN first, as today", async () => {
    const el = await giveBackKeyed(
      { refundBillPayment: vi.fn().mockResolvedValue(givenBack) },
      "0.00",
    );

    inRefund(el, "[data-refund-terminal-done]")!.click();
    await flush(el);

    expect(refunds()).toEqual([]);
    expect(approval(el)).not.toBeNull();
  });
});

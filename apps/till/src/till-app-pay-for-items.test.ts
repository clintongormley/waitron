import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  balanceOf,
  bill120,
  billOf,
  cash,
  dialog,
  flush,
  emit,
  inDialog,
  invoiceOf,
  money,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
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
import type { TillApi } from "./api/client.js";
import type { ItemPaymentPreview, ItemPaymentResult } from "./api/item-payment-types.js";

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

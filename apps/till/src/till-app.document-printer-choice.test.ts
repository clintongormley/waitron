import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DeviceEquipment, InvoiceDeliveryStatus, TillApi } from "./api/client.js";
import { TillApp } from "./till-app.js";
import { TillTicketView } from "./screens/till-ticket-view.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import {
  emit,
  flush,
  invoiceOf,
  lock,
  resetBillPayDrafts,
  shell,
  stubApi,
  till,
  offers,
} from "../test/bill-pay-app.js";
import { equipmentItem, roleOf } from "../test/pay-equipment-fixtures.js";
import { billOptions, listPage, transactionRow } from "../test/find-bill-fixtures.js";

const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
const belt = equipmentItem("belt", "Belt", {
  kind: "receipt",
  portable: true,
  heldBy: { deviceId: "other", deviceName: "Patio", personName: null },
});
const equipment = (item = bar): DeviceEquipment => ({
  roles: [roleOf("receipt", item, [bar, belt])],
});
const delivered: InvoiceDeliveryStatus = {
  current: null,
  originalCompleted: true,
  originalPrinterId: null,
  history: [],
  actions: { print: null, retryOriginal: null, receiptInstead: null, email: null },
};
const ticket = (el: TillApp) => el.shadowRoot!.querySelector<TillTicketView>("till-ticket-view")!;
const part = (el: TillApp, key: string) =>
  ticket(el).shadowRoot!.querySelector<HTMLElement>(`[data-test=${key}]`)!;
const press = async (el: TillApp, key: string) => {
  expect(part(el, key), key).not.toBeNull();
  await userEvent.click(part(el, key));
  await flush(el);
};
beforeEach(() => {
  resetBillPayDrafts();
  setLocale("en-GB");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function sold(invoiceType = "F1", overrides: Record<string, unknown> = {}) {
  const api = stubApi({
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: { ...offers.context, receiptPrintMode: "on_request" },
    }),
    listZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: { ...offers.context, receiptPrintMode: "on_request" },
    }),
    printReceipt: vi.fn().mockResolvedValue(undefined),
    getTill: vi.fn().mockResolvedValue({
      ...till,
      deviceId: "dev-1",
      receiptLanguages: ["en-GB"],
      receiptPrintMode: "on_request",
      capabilities: ["take-orders", "take-cash", "print-receipt"],
    }),
    recordSale: vi.fn().mockResolvedValue({ ...invoiceOf("12.00"), invoiceType }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getInvoiceDeliveries: vi.fn().mockResolvedValue(null),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipment()),
    ...overrides,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "staff", displayName: "Staff", permissions: [] });
  await flush(el);
  const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
  counter.store.addProduct(
    {
      id: "coffee",
      menuItemId: "coffee",
      name: "Coffee",
      customerName: { en: "Coffee" },
      pricingUnit: "each",
      unitPrice: "12.00",
      vatClass: "general",
      category: null,
      allergens: null,
      catalogueId: "cat-default",
      catalogueName: "Menu",
    },
    "1",
  );
  const id = counter.store.id;
  emit(counter, "confirm-payment", { method: "cash", amount: "12.00" });
  await flush(el);
  await press(el, "document-print-toggle");
  if (invoiceType === "F1") await press(el, "document-receipt");
  return { el, api, id };
}

it.each(["F1", "F2"])(
  "%s waits for Receipt's PUT snapshot, without an Invoice offer read, then dispatches its original",
  async (type) => {
    let saved!: (value: DeviceEquipment) => void;
    const setDeviceEquipment = vi.fn<TillApi["setDeviceEquipment"]>(
      () =>
        new Promise((resolve) => {
          saved = resolve;
        }),
    );
    const { el, api, id } = await sold(type, { setDeviceEquipment });
    const reads = vi.mocked(api.getInvoiceDeliveries).mock.calls.length;
    ticket(el)
      .shadowRoot!.querySelector("wt-combobox")!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "belt" },
          bubbles: true,
          composed: true,
        }),
      );
    await flush(el);
    await userEvent.click(
      ticket(el).shadowRoot!.querySelector<HTMLElement>("[data-equipment-take]")!,
    );
    await flush(el);
    expect(setDeviceEquipment.mock.calls.map(([change]) => change)).toEqual([
      { role: "receipt", selection: { id: "belt" }, via: "list", takeOver: true },
    ]);
    expect(part(el, "print-receipt").hasAttribute("disabled")).toBe(true);
    saved(equipment({ ...belt, heldBy: null }));
    await flush(el);
    expect(part(el, "print-receipt").textContent!.trim()).toBe("Print on Belt");
    expect(part(el, "print-receipt").hasAttribute("disabled")).toBe(false);
    expect(api.getInvoiceDeliveries).toHaveBeenCalledTimes(reads);
    expect(api.printReceipt).not.toHaveBeenCalled();
    await press(el, "print-receipt");
    expect(api.printReceipt).toHaveBeenCalledWith(id);
  },
);

it("Equipment's Receipt save updates the open document row", async () => {
  const { el } = await sold("F2", {
    setDeviceEquipment: vi.fn().mockResolvedValue(equipment(belt)),
  });
  emit(shell(el), "open-equipment");
  await flush(el);
  const dialog = el.shadowRoot!.querySelector("till-equipment-dialog")!;
  emit(dialog, "equipment-change", {
    role: "receipt",
    selection: { id: "belt" },
    via: "list",
    takeOver: true,
  });
  await flush(el);
  emit(dialog, "close");
  await flush(el);
  expect(part(el, "print-receipt").textContent!.trim()).toBe("Print on Belt");
});

it.each([false, true])(
  "F1 Receipt copy refreshes both statuses and shows its domain refusal, history=%s",
  async (historical) => {
    const refusal = { code: "invoice.delivery_in_progress", status: 409 };
    const { el, api, id } = await sold("F1", {
      getInvoiceDeliveries: vi.fn().mockResolvedValue(delivered),
      reprint: vi.fn().mockRejectedValue(refusal),
      reprintTransaction: vi.fn().mockRejectedValue(refusal),
      findBillOptions: vi.fn().mockResolvedValue(billOptions),
      listBills: vi.fn().mockResolvedValue(listPage([])),
      listTransactions: vi.fn().mockResolvedValue(listPage([])),
      getTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ ...invoiceOf("12.00"), invoiceType: "F1" }),
    });
    if (historical) {
      emit(ticket(el), "new-sale");
      await flush(el);
      emit(shell(el), "find-bill");
      await flush(el);
      emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
        row: transactionRow({ saleId: "sale-history", workingOrderId: "wo-history" }),
      });
      await flush(el);
      await press(el, "document-print-toggle");
      await press(el, "document-receipt");
    }
    const receiptReads = vi.mocked(api.getReceiptPrintStatus).mock.calls.length;
    const deliveryReads = vi.mocked(api.getInvoiceDeliveries).mock.calls.length;
    await press(el, "reprint");
    expect(historical ? api.reprintTransaction : api.reprint).toHaveBeenCalledWith(
      historical ? "sale-history" : id,
      ...(historical ? [undefined] : []),
    );
    expect(api.getReceiptPrintStatus).toHaveBeenCalledTimes(receiptReads + 1);
    expect(api.getInvoiceDeliveries).toHaveBeenCalledTimes(deliveryReads + 1);
    expect(part(el, "delivery-refused").textContent).toContain(codeMessage(refusal.code));
  },
);

it("Copy still asks for language, and Cancel leaves the print requests untouched", async () => {
  const { el, api } = await sold("F1", {
    getTill: vi.fn().mockResolvedValue({
      ...till,
      deviceId: "dev-1",
      receiptLanguages: ["en-GB", "es-ES"],
      capabilities: ["take-orders", "take-cash", "print-receipt"],
    }),
    getInvoiceDeliveries: vi.fn().mockResolvedValue(delivered),
  });
  await press(el, "reprint");
  const dialog = el.shadowRoot!.querySelector("till-reprint-language-dialog")!;
  expect(dialog).not.toBeNull();
  emit(dialog, "reprint-language-cancel");
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-reprint-language-dialog")).toBeNull();
  expect(api.reprint).not.toHaveBeenCalled();
  expect(api.printReceipt).not.toHaveBeenCalled();
});

it("Equipment still saves an Invoice preference while the ticket is F2", async () => {
  const setDeviceEquipment = vi.fn().mockResolvedValue(equipment());
  const { el } = await sold("F2", { setDeviceEquipment });
  emit(shell(el), "open-equipment");
  await flush(el);
  const dialog = el.shadowRoot!.querySelector("till-equipment-dialog")!;
  emit(dialog, "equipment-change", { role: "invoice", selection: "default", via: "list" });
  await flush(el);
  expect(setDeviceEquipment.mock.calls.map(([change]) => change)).toEqual([
    { role: "invoice", selection: "default", via: "list" },
  ]);
});

it("Back from a refused Receipt choice lets staff use the saved Invoice printer", async () => {
  const office = equipmentItem("office", "Office", { kind: "a4" });
  const all = { roles: [...equipment().roles, roleOf("invoice", office, [office])] };
  const { el } = await sold("F1", {
    getDeviceEquipment: vi.fn().mockResolvedValue(all),
    setDeviceEquipment: vi.fn().mockRejectedValue({ status: 400, code: "printer.not_found" }),
    getInvoiceDeliveries: vi
      .fn()
      .mockResolvedValue({
        ...delivered,
        originalCompleted: false,
        actions: {
          ...delivered.actions,
          print: {
            printers: [{ id: "office", name: "Office", kind: "a4" }],
            designation: "original",
          },
        },
      }),
  });
  ticket(el)
    .shadowRoot!.querySelector("wt-combobox")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
    );
  await flush(el);
  expect(part(el, "print-receipt").hasAttribute("disabled")).toBe(true);
  await press(el, "document-back");
  await press(el, "document-invoice");
  expect(ticket(el).shadowRoot!.querySelector("wt-combobox")!.value).toBe("office");
  expect(part(el, "print-invoice").hasAttribute("disabled")).toBe(false);
});

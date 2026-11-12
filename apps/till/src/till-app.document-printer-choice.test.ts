import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DeviceEquipment, InvoiceDeliveryStatus, TillApi } from "./api/client.js";
import { TillApp } from "./till-app.js";
import { TillTicketView } from "./screens/till-ticket-view.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
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
const ticket = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillTicketView>(
    "till-ticket-view, till-settlement-document-dialog",
  )!;
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
      context: { ...offers.context },
    }),
    listZoneOffers: vi.fn().mockResolvedValue({
      ...offers,
      context: { ...offers.context },
    }),
    printReceipt: vi.fn().mockResolvedValue(undefined),
    getTill: vi.fn().mockResolvedValue({
      ...till,
      deviceId: "dev-1",
      receiptLanguages: ["en-GB"],
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
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  await press(el, "invoice-printer-toggle");
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

it.each([false, true, "orderless"])(
  "F1 Receipt copy refreshes both statuses and shows its domain refusal, history=%s",
  async (historical) => {
    const refusal = { code: "invoice_delivery.active", status: 409 };
    const { el, api, id } = await sold("F1", {
      getTill: vi.fn().mockResolvedValue({
        ...till,
        deviceId: "dev-1",
        receiptLanguages: ["en-GB", "es-ES"],
        capabilities: ["take-orders", "take-cash", "print-receipt"],
      }),
      getInvoiceDeliveries: vi.fn().mockResolvedValue(delivered),
      reprint: vi.fn().mockRejectedValue(refusal),
      reprintTransaction: vi.fn().mockRejectedValue(refusal),
      findBillOptions: vi.fn().mockResolvedValue(billOptions),
      listBills: vi.fn().mockResolvedValue(listPage([])),
      listTransactions: vi.fn().mockResolvedValue(listPage([])),
      getTransactionDeliveries: vi.fn().mockResolvedValue(delivered),
      getTransactionReceiptPrint: vi.fn().mockResolvedValue({ status: "not_queued" }),
      getTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ ...invoiceOf("12.00"), invoiceType: "F1" }),
    });
    if (historical) {
      emit(ticket(el), "settlement-close");
      await flush(el);
      emit(shell(el), "find-bill");
      await flush(el);
      emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
        row: transactionRow({
          saleId: "sale-history",
          workingOrderId: historical === "orderless" ? null : "wo-history",
        }),
      });
      await flush(el);
      await press(el, "document-print-toggle");
      await press(el, "document-receipt");
    }
    const receiptStatus =
      historical === "orderless" ? api.getTransactionReceiptPrint : api.getReceiptPrintStatus;
    const deliveries =
      historical === "orderless" ? api.getTransactionDeliveries : api.getInvoiceDeliveries;
    const receiptReads = vi.mocked(receiptStatus).mock.calls.length;
    const deliveryReads = vi.mocked(deliveries).mock.calls.length;
    await press(el, "reprint");
    const language = el.shadowRoot!.querySelector("till-reprint-language-dialog")!;
    expect(language).not.toBeNull();
    emit(language, "reprint-language-confirm", { language: "es-ES" });
    await flush(el);
    expect(historical ? api.reprintTransaction : api.reprint).toHaveBeenCalledWith(
      historical ? "sale-history" : id,
      "es-ES",
    );
    expect(receiptStatus).toHaveBeenCalledTimes(receiptReads + 1);
    expect(deliveries).toHaveBeenCalledTimes(deliveryReads + 1);
    expect(part(el, "delivery-refused").textContent).toContain(
      "This invoice is already waiting for delivery. Check its status before trying again.",
    );
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
    getInvoiceDeliveries: vi.fn().mockResolvedValue({
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
  await userEvent.click(
    ticket(el).shadowRoot!.querySelector<HTMLElement>("[data-settlement-choice=invoice]")!,
  );
  await flush(el);
  expect(ticket(el).shadowRoot!.querySelector("wt-combobox")!.value).toBe("office");
  expect(part(el, "print-invoice").hasAttribute("disabled")).toBe(false);
});

it("Receipt opens without waiting for a changed Invoice printer's offer", async () => {
  const office = equipmentItem("office", "Office", { kind: "a4" });
  const getInvoiceDeliveries = vi.fn().mockResolvedValue({
    ...delivered,
    originalCompleted: false,
    actions: {
      ...delivered.actions,
      print: {
        printers: [{ id: "earlier", name: "Earlier office", kind: "a4" }],
        designation: "original",
      },
    },
  });
  const { el } = await sold("F1", {
    getInvoiceDeliveries,
    getDeviceEquipment: vi
      .fn()
      .mockResolvedValue({ roles: [...equipment().roles, roleOf("invoice", office, [office])] }),
  });
  expect(part(el, "print-receipt").hasAttribute("disabled")).toBe(false);
  expect(part(el, "print-receipt").textContent!.trim()).toBe("Print on Bar");
  expect(getInvoiceDeliveries).toHaveBeenCalledOnce();
});

async function orderless(overrides: Record<string, unknown> = {}) {
  const api = stubApi({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      deviceId: "dev-1",
      capabilities: ["take-orders", "print-receipt"],
    }),
    findBillOptions: vi.fn().mockResolvedValue(billOptions),
    listBills: vi.fn().mockResolvedValue(listPage([])),
    listTransactions: vi.fn().mockResolvedValue(listPage([])),
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("12.00"), invoiceType: "F1" }),
    getTransactionReceiptPrint: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getTransactionDeliveries: vi.fn().mockResolvedValue({ ...delivered, originalCompleted: false }),
    getDeviceEquipment: vi.fn().mockResolvedValue(equipment()),
    getReceiptPrintStatus: vi.fn(),
    getInvoiceDeliveries: vi.fn(),
    printReceipt: vi.fn(),
    printTransactionInvoice: vi.fn().mockResolvedValue({}),
    ...overrides,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el), "logged-in", { personId: "staff", displayName: "Staff", permissions: [] });
  await flush(el);
  emit(shell(el), "find-bill");
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
    row: transactionRow({ saleId: "sale-history", workingOrderId: null }),
  });
  await flush(el);
  return { el, api };
}

it.each(["receipt", "a4"] as const)(
  "orderless Invoice uses the saved %s choice only after confirmation; Receipt has no original action",
  async (kind) => {
    const chosen = equipmentItem("invoice", "Invoice desk", { kind });
    const all = { roles: [...equipment().roles, roleOf("invoice", chosen, [chosen])] };
    let saved!: (value: DeviceEquipment) => void;
    const state = {
      ...delivered,
      originalCompleted: false,
      actions: {
        ...delivered.actions,
        print: {
          printers: [{ id: chosen.id, name: chosen.name, kind }],
          designation: "original" as const,
        },
      },
    };
    const { el, api } = await orderless({
      getDeviceEquipment: vi.fn().mockResolvedValue(all),
      setDeviceEquipment: vi.fn(
        () =>
          new Promise((resolve) => {
            saved = resolve;
          }),
      ),
      getTransactionDeliveries: vi.fn().mockResolvedValue(state),
    });
    await press(el, "document-print-toggle");
    expect(part(el, "document-receipt")).toBeNull();
    expect(part(el, "print-receipt")).toBeNull();
    emit(ticket(el), "print-receipt");
    await flush(el);
    expect(api.printReceipt).not.toHaveBeenCalled();
    await press(el, "document-invoice");
    emit(ticket(el), "equipment-change", { role: "invoice", selection: "default", via: "list" });
    await flush(el);
    expect(part(el, "print-invoice").hasAttribute("disabled")).toBe(true);
    expect(api.printTransactionInvoice).not.toHaveBeenCalled();
    saved(all);
    await flush(el);
    expect(part(el, "print-invoice").textContent).toContain("Invoice desk");
    await press(el, "print-invoice");
    expect(api.printTransactionInvoice).toHaveBeenCalledWith(
      "sale-history",
      "invoice",
      expect.any(String),
    );
    expect(api.getReceiptPrintStatus).not.toHaveBeenCalled();
    expect(api.getInvoiceDeliveries).not.toHaveBeenCalled();
  },
);

it.each(["en-GB", "es-ES"])(
  "orderless recovery names its retained retry and fallback printer in %s",
  async (locale) => {
    const a4Waiting: InvoiceDeliveryStatus = {
      ...delivered,
      originalCompleted: false,
      current: {
        id: "a4-job",
        medium: "a4",
        designation: "original",
        status: "queued",
        failureCode: null,
        requestedAt: "2026-11-12T12:00:00Z",
        at: null,
        personId: "staff",
        printerHold: null,
        lateSuccess: false,
      },
      actions: { ...delivered.actions, receiptInstead: { deliveryId: "a4-job" } },
    };
    const getTransactionDeliveries = vi.fn().mockResolvedValue({
      ...delivered,
      originalCompleted: false,
      current: { ...a4Waiting.current!, id: "receipt-job", medium: "receipt", status: "failed" },
    });
    const { el, api } = await orderless({
      getTransactionReceiptPrint: vi.fn().mockResolvedValue({
        status: "failed",
        jobId: "job",
        canRetry: true,
        printerId: "old",
        printerName: "Retained belt",
      }),
      getTransactionDeliveries,
      retryTransactionReceipt: vi.fn().mockResolvedValue({ jobId: "retry" }),
      transactionReceiptInstead: vi.fn().mockResolvedValue({}),
    });
    setLocale(locale);
    await flush(el);
    expect(part(el, "retry-receipt").textContent).toContain("Retained belt");
    const reads = vi.mocked(api.getTransactionReceiptPrint).mock.calls.length;
    await press(el, "retry-receipt");
    expect(api.retryTransactionReceipt).toHaveBeenCalledWith("sale-history");
    expect(api.getTransactionReceiptPrint).toHaveBeenCalledTimes(reads + 1);
    getTransactionDeliveries.mockResolvedValue(a4Waiting);
    emit(ticket(el), "refresh-receipt");
    await flush(el);
    expect(part(el, "receipt-instead").textContent).toContain("Retained belt");
    await press(el, "receipt-instead");
    expect(api.transactionReceiptInstead).toHaveBeenCalledWith(
      "sale-history",
      "a4-job",
      expect.any(String),
    );
    expect(api.getTransactionReceiptPrint).toHaveBeenCalledTimes(reads + 3);
    expect(api.getTransactionDeliveries).toHaveBeenCalledTimes(reads + 3);
  },
);

it("orderless handover targets the sale and ignores its answer after Back and reopening", async () => {
  let confirm!: (value: unknown) => void;
  const done = { status: "done", jobId: "original", canRetry: false };
  const { el, api } = await orderless({
    getTransactionReceiptPrint: vi.fn().mockResolvedValue(done),
    getTransactionDeliveries: vi.fn().mockResolvedValue(delivered),
    confirmTransactionReceiptHandover: vi.fn(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    ),
  });
  await press(el, "confirm-handover");
  expect(api.confirmTransactionReceiptHandover).toHaveBeenCalledWith("sale-history");
  emit(ticket(el), "back-to-find-bill");
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
    row: transactionRow({ saleId: "sale-new", workingOrderId: null }),
  });
  await flush(el);
  confirm({ ...done, handover: { personId: "old", confirmedAt: "2026-11-12T12:00:00Z" } });
  await flush(el);
  expect(part(el, "confirm-handover")).not.toBeNull();
  expect(api.printReceipt).not.toHaveBeenCalled();
  expect(api.printTransactionInvoice).not.toHaveBeenCalled();
});

it("an orderless F2 retains the immediate Receipt copy and never reads Invoice delivery status", async () => {
  const { el, api } = await orderless({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      deviceId: "dev-1",
      receiptLanguages: ["en-GB"],
      capabilities: ["take-orders", "print-receipt"],
    }),
    getTransactionReceipt: vi
      .fn()
      .mockResolvedValue({ ...invoiceOf("12.00"), invoiceType: "F2", locale: "en-GB" }),
    reprintTransaction: vi.fn().mockResolvedValue(undefined),
  });
  expect(part(el, "document-print-toggle")).toBeNull();
  await press(el, "reprint");
  expect(api.reprintTransaction).toHaveBeenCalledWith("sale-history", undefined);
  expect(api.getTransactionDeliveries).not.toHaveBeenCalled();
  expect(api.getTransactionReceiptPrint).not.toHaveBeenCalled();
});

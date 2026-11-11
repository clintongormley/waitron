import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import {
  balanceOf,
  emit,
  flush,
  invoiceOf,
  openTable,
  resetBillPayDrafts,
  stubApi,
  shell,
} from "../test/bill-pay-app.js";

import { transactionRow } from "../test/find-bill-fixtures.js";
import type { InvoiceDeliveryStatus } from "./api/client.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

it("emails an F2 receipt only after Send and offers paper as a copy afterwards", async () => {
  const status: InvoiceDeliveryStatus = {
    current: null,
    originalCompleted: false,
    originalPrinterId: null,
    history: [],
    actions: {
      print: null,
      retryOriginal: null,
      receiptInstead: null,
      email: { designation: "original" },
    },
  };
  const api = stubApi({
    recordSale: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getReceiptEmailDeliveries: vi.fn().mockResolvedValue(status),
    requestEmailDelivery: vi.fn().mockResolvedValue({}),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  emit(order, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  const chooser = el.shadowRoot!.querySelector("till-settlement-document-dialog")!;
  const email = chooser.shadowRoot!.querySelector<HTMLElement>("[data-test=email-invoice]");
  expect(email).not.toBeNull();
  email!.click();
  await flush(el);
  const form = chooser.shadowRoot!.querySelector("till-invoice-email-dialog");
  expect(form).not.toBeNull();
  expect(api.requestEmailDelivery).not.toHaveBeenCalled();
  const input = form!.shadowRoot!.querySelector("wt-input")!;
  emit(input, "wt-change", { value: "guest@example.com" });
  await flush(el);
  vi.mocked(api.getReceiptEmailDeliveries).mockResolvedValue({
    ...status,
    originalCompleted: true,
    actions: { ...status.actions, email: { designation: "duplicate" } },
  });
  form!.shadowRoot!.querySelector<HTMLElement>("wt-form-actions wt-button:not([slot])")!.click();
  await flush(el);
  expect(api.requestEmailDelivery).toHaveBeenCalledExactlyOnceWith(
    "wo-4",
    "guest@example.com",
    expect.any(String),
  );
  expect(chooser.shadowRoot!.querySelector("till-invoice-email-dialog")).toBeNull();
  expect(chooser.shadowRoot!.querySelector("[data-test=print-receipt]")).toBeNull();
  expect(chooser.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
});

it("offers documents to the active editor when changing a line settles its bill", async () => {
  const api = stubApi({
    updateOrderLine: vi.fn().mockResolvedValue({
      revision: 1,
      party: { id: "v1", revision: 4 },
      invoice: {
        ...invoiceOf("120.00"),
        tender: { method: "cash", change: "30.00" },
        payments: [
          {
            method: "cash",
            amount: "120.00",
            tip: "0.00",
            tendered: "150.00",
            change: "30.00",
            refunds: [],
          },
        ],
      },
    }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  emit(order, "change-line", {
    lineNo: 1,
    lineName: "Paella",
    patch: { quantity: "1" },
    revision: 0,
  });
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
  expect(
    el
      .shadowRoot!.querySelector("till-settlement-document-dialog")!
      .shadowRoot!.querySelector("[data-settlement-change]"),
  ).toBeNull();
});

it("offers documents after the retained whole-payment handler completes", async () => {
  const api = stubApi({
    recordSale: vi.fn().mockResolvedValue(invoiceOf("120.00")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  emit(order, "pay-tab", { method: "cash", amount: "120.00" });
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("till-ticket-view")).toBeNull();
});

it("reads an unprinted F2 original when it is opened later from Find bill", async () => {
  const api = stubApi({
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  emit(shell(el), "find-bill");
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
    row: transactionRow({ workingOrderId: "wo-4" }),
  });
  await flush(el);
  expect(api.getReceiptPrintStatus).toHaveBeenCalledWith("wo-4");
  const ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  await ticket.updateComplete;
  ticket.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!.click();
  await flush(el);
  expect(ticket.shadowRoot!.querySelector("[data-test=print-receipt]")).not.toBeNull();
  expect(ticket.shadowRoot!.querySelector("[data-test=reprint]")).toBeNull();
});

it("opens the receipt email form and retries a failed original from Find bill", async () => {
  const attempt = {
    id: "email-original",
    medium: "email" as const,
    designation: "original" as const,
    status: "failed" as const,
    failureCode: "email.transport_failed",
    requestedAt: "2026-11-11T12:00:00.000Z",
    at: null,
    personId: "p1",
    printerHold: null,
    lateSuccess: false,
  };
  const status: InvoiceDeliveryStatus = {
    current: attempt,
    history: [attempt],
    originalCompleted: false,
    originalPrinterId: null,
    actions: {
      print: null,
      receiptInstead: null,
      retryOriginal: { medium: "email" },
      email: { designation: "original" },
    },
  };
  const api = stubApi({
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    getReceiptEmailDeliveries: vi.fn().mockResolvedValue(status),
    retryEmailDelivery: vi.fn().mockResolvedValue({}),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  emit(shell(el), "find-bill");
  await flush(el);
  emit(el.shadowRoot!.querySelector("till-find-bill-screen")!, "find-transaction-open", {
    row: transactionRow({ workingOrderId: "wo-4" }),
  });
  await flush(el);
  const ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  ticket.shadowRoot!.querySelector<HTMLElement>("[data-test=email-invoice]")!.click();
  await flush(el);
  expect(ticket.shadowRoot!.querySelector("till-invoice-email-dialog")).not.toBeNull();
  emit(ticket, "invoice-email-cancel");
  await flush(el);
  ticket.shadowRoot!.querySelector<HTMLElement>("[data-test=email-again]")!.click();
  await flush(el);
  expect(api.retryEmailDelivery).toHaveBeenCalledExactlyOnceWith(
    "wo-4",
    "email-original",
    expect.any(String),
  );
  expect(ticket.shadowRoot!.querySelector("[data-test=print-invoice]")).toBeNull();
  expect(ticket.shadowRoot!.querySelector("[data-test=receipt-instead]")).toBeNull();
});

it("clears another sale's print status before opening an orderless correction", async () => {
  const api = stubApi({
    getTransactionReceipt: vi.fn().mockResolvedValue({ ...invoiceOf("120.00"), invoiceType: "F2" }),
    getReceiptPrintStatus: vi
      .fn()
      .mockResolvedValue({ status: "failed", jobId: "earlier-original", canRetry: true }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  emit(shell(el), "find-bill");
  await flush(el);
  const find = el.shadowRoot!.querySelector("till-find-bill-screen")!;
  emit(find, "find-transaction-open", { row: transactionRow({ workingOrderId: "wo-4" }) });
  await flush(el);
  let ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  expect(ticket.originalReceiptPrint).toMatchObject({ jobId: "earlier-original" });
  emit(ticket, "back-to-find-bill");
  await flush(el);
  vi.mocked(api.getTransactionReceipt).mockResolvedValue({
    ...invoiceOf("120.00"),
    invoiceType: "F2",
    invoiceNumber: "CORR/1",
  });
  emit(find, "find-transaction-open", {
    row: transactionRow({ saleId: "correction", workingOrderId: null }),
  });
  await flush(el);
  ticket = el.shadowRoot!.querySelector("till-ticket-view")!;
  expect(ticket.originalReceiptPrint).toBeUndefined();
  expect(ticket.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
  expect(api.getReceiptPrintStatus).toHaveBeenCalledOnce();
});

it.each([
  ["refused retry", { code: "working_order.not_open", status: 409 }],
  ["lost reply", new TypeError("Failed to fetch")],
])("recovers the settled line edit invoice after a %s", async (_reason, failure) => {
  const api = stubApi({
    updateOrderLine: vi.fn().mockRejectedValue(failure),
    getFiledTicket: vi.fn().mockResolvedValue(invoiceOf("120.00")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const order = await openTable(el);
  vi.mocked(api.getBillBalance).mockResolvedValue(
    balanceOf({ status: "settled", outstanding: "0.00", received: "120.00" }),
  );
  emit(order, "change-line", {
    lineNo: 1,
    lineName: "Dish",
    patch: { quantity: "1" },
    revision: 0,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull(),
  );
  expect(api.getFiledTicket).toHaveBeenCalledWith("wo-4");
  expect(
    el.shadowRoot!.querySelector("till-settlement-document-dialog")!.result.invoiceNumber,
  ).toBe("F-0007");
});

it.each(["party.out_of_date", "bill.paid"])(
  "recovers the source invoice after moving dishes is refused with %s",
  async (code) => {
    const api = stubApi({
      moveDishes: vi.fn().mockRejectedValue({ code, status: 409 }),
      getFiledTicket: vi.fn().mockResolvedValue(invoiceOf("120.00")),
      getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    vi.mocked(api.getBillBalance).mockResolvedValue(
      balanceOf({ status: "settled", outstanding: "0.00", received: "120.00" }),
    );
    emit(order, "move-dishes", { lineIds: ["line-1"], toBillId: null });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull(),
    );
    expect(api.getFiledTicket).toHaveBeenCalledWith("wo-4");
    expect(
      el.shadowRoot!.querySelector("till-settlement-document-dialog")!.result.invoiceNumber,
    ).toBe("F-0007");
  },
);

it.each(["open", "invoice read fails"])(
  "keeps line-edit refusal recovery when the bill is %s",
  async (state) => {
    const api = stubApi({
      updateOrderLine: vi.fn().mockRejectedValue({ code: "working_order.not_open", status: 409 }),
      getFiledTicket: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    const order = await openTable(el);
    if (state !== "open")
      vi.mocked(api.getBillBalance).mockResolvedValue(
        balanceOf({ status: "settled", outstanding: "0.00", received: "120.00" }),
      );
    emit(order, "change-line", {
      lineNo: 1,
      lineName: "Dish",
      patch: { quantity: "1" },
      revision: 0,
    });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector(".error")).not.toBeNull());
    expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).toBeNull();
    if (state === "open") expect(api.getFiledTicket).not.toHaveBeenCalled();
    else expect(api.getFiledTicket).toHaveBeenCalledWith("wo-4");
  },
);

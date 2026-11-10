import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import {
  emit,
  flush,
  invoiceOf,
  openTable,
  resetBillPayDrafts,
  stubApi,
  shell,
} from "../test/bill-pay-app.js";

import { transactionRow } from "../test/find-bill-fixtures.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

it("offers documents to the active editor when changing a line settles its bill", async () => {
  const api = stubApi({
    updateOrderLine: vi.fn().mockResolvedValue({
      revision: 1,
      party: { id: "v1", revision: 4 },
      invoice: invoiceOf("120.00"),
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
  expect(el.shadowRoot!.querySelector("till-ticket-view, till-paid-view")).toBeNull();
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
  expect(el.shadowRoot!.querySelector("till-ticket-view, till-paid-view")).toBeNull();
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

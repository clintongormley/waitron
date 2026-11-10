import { afterEach, expect, it, vi } from "vitest";
import { TillApp } from "../till-app.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  cash,
  flush,
  invoiceOf,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
  stubApi,
  takenOf,
  type,
} from "../../test/bill-pay-app.js";

const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

it("a disconnected till discards the final choice instead of reopening it on reconnection", async () => {
  setLocale("en");
  resetBillPayDrafts();
  const printReceipt = vi.fn().mockResolvedValue(undefined);
  const api = stubApi({
    printReceipt,
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    previewBillPayment: vi.fn().mockResolvedValue(cash("120.00", "0.00")),
    takeBillPayment: vi
      .fn()
      .mockResolvedValue(
        takenOf(
          { applied: "120.00", tendered: "120.00", change: "0.00" },
          { total: "120.00", received: "120.00", outstanding: "0.00", status: "settled" },
          invoiceOf("120.00"),
        ),
      ),
  });
  const { el, host } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  await openDialog(el, "rest");
  await type(el, "tendered", "120");
  await press(el, "[data-pay-continue]");
  await press(el, "[data-pay-confirm]");
  await flush(el);
  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).not.toBeNull();

  expect(el.shadowRoot!.querySelector("till-ticket-view, till-paid-view")).toBeNull();
  el.remove();
  host.appendChild(el);
  await flush(el);

  expect(el.shadowRoot!.querySelector("till-settlement-document-dialog")).toBeNull();
  expect(printReceipt).not.toHaveBeenCalled();
});

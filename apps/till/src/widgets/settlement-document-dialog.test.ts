import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { TillTicketView } from "../screens/till-ticket-view.js";
import { invoiceOf } from "../../test/bill-pay-app.js";
import "./settlement-document-dialog.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";

const originalLocale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

it("selects Receipt without sending a print command, and None closes the choice", async () => {
  const { el } = await mountWidget<TillTicketView>("till-settlement-document-dialog", {
    result: invoiceOf("30.00"),
    originalReceiptAvailable: true,
    originalReceiptPrint: { status: "not_queued" },
  });
  const printed = vi.fn();
  const closed = vi.fn();
  el.addEventListener("print-receipt", printed);
  el.addEventListener("settlement-close", closed);
  const receipt = el.shadowRoot?.querySelector<HTMLElement>("[data-settlement-choice=receipt]");
  expect(receipt).toBeTruthy();
  expect(receipt?.getAttribute("aria-pressed")).toBe("true");
  expect((receipt as HTMLElementTagNameMap["wt-button"]).variant).toBe("primary");
  expect(printed).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("[data-test=original-delivery]")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-none]")!.click();
  await el.updateComplete;
  expect(closed).toHaveBeenCalledOnce();
  expect(printed).not.toHaveBeenCalled();
});

it("explains F2 replacement is unavailable and prints its receipt only on the named Print action", async () => {
  const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
  const { el } = await mountWidget<TillTicketView>("till-settlement-document-dialog", {
    result: { ...invoiceOf("30.00"), invoiceType: "F2" },
    invoicePrintersEnabled: true,
    originalReceiptAvailable: true,
    originalReceiptPrint: { status: "not_queued" },
    receiptEquipment: { ...roleOf("receipt", bar, [bar]), default: bar },
  });
  const printed = vi.fn();
  el.addEventListener("print-receipt", printed);
  el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-choice=invoice]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("Full invoice replacement is not available yet");
  expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog, wt-input")).toBeNull();
  expect(printed).not.toHaveBeenCalled();
  const print = el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-receipt]");
  expect(print?.textContent).toContain("Print on Bar");
  print!.click();
  expect(printed).toHaveBeenCalledOnce();
});

it("keeps the recorded F1 recipient and offers Email as a separate explicit action", async () => {
  const { el } = await mountWidget<TillTicketView>("till-settlement-document-dialog", {
    result: {
      ...invoiceOf("30.00"),
      invoiceType: "F1",
      recipient: {
        legalName: "Harbour Ltd",
        taxId: "B12345678",
        address: "1 Harbour Road",
        countryCode: "ES",
      },
    },
    invoicePrintersEnabled: true,
    originalReceiptPrint: { status: "not_queued" },
    deliveries: {
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
    },
  });
  const email = vi.fn();
  const print = vi.fn();
  el.addEventListener("email-invoice", email);
  el.addEventListener("print-receipt", print);
  el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-choice=invoice]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("Harbour Ltd");
  expect(el.shadowRoot!.querySelector("till-invoice-recipient-dialog")).toBeNull();
  expect(email).not.toHaveBeenCalled();
  expect(print).not.toHaveBeenCalled();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=email-invoice]")!.click();
  expect(email).toHaveBeenCalledOnce();
  el.emailOpen = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-invoice-email-dialog")).not.toBeNull();
});

it.each([
  ["failed", "retry-receipt"],
  ["done", "confirm-handover"],
] as const)("keeps F1 receipt recovery after printing is %s", async (status, action) => {
  const { el } = await mountWidget<TillTicketView>("till-settlement-document-dialog", {
    result: {
      ...invoiceOf("30.00"),
      invoiceType: "F1",
      recipient: {
        legalName: "Harbour Ltd",
        taxId: "B12345678",
        countryCode: "ES",
        address: "1 Harbour Road",
      },
    },
    invoicePrintersEnabled: true,
    originalReceiptPrint: { status, jobId: "original", canRetry: status === "failed" },
  });
  const heard = vi.fn();
  el.addEventListener(action, heard);
  const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`);
  expect(button).not.toBeNull();
  button!.click();
  expect(heard).toHaveBeenCalledOnce();
  expect(el.shadowRoot!.querySelector('[data-test="refresh-receipt"]')).not.toBeNull();
});

it("keeps the final cash change beside the document choice", async () => {
  const { el } = await mountWidget<TillTicketView>("till-settlement-document-dialog", {
    result: { ...invoiceOf("120.00"), tender: { method: "cash", change: "30.00" } },
  });
  expect(el.shadowRoot!.querySelector("[data-settlement-change]")?.textContent).toContain("30.00");
});

it("keeps failed F2 original recovery in the document choice", async () => {
  const { el } = await mountWidget<TillTicketView>("till-settlement-document-dialog", {
    result: { ...invoiceOf("30.00"), invoiceType: "F2" },
    originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
  });
  const heard = vi.fn();
  el.addEventListener("retry-receipt", heard);
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-receipt]");
  expect(button).not.toBeNull();
  button!.click();
  expect(heard).toHaveBeenCalledOnce();
});

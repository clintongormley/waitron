import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { TillSettlementDocumentDialog } from "./settlement-document-dialog.js";
import { invoiceOf } from "../../test/bill-pay-app.js";
import "./settlement-document-dialog.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { RoleEquipment } from "../api/client.js";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";

const originalLocale = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

it("selects Receipt without sending a print command, and Done closes the choice", async () => {
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
      result: invoiceOf("30.00"),
      originalReceiptAvailable: true,
      originalReceiptPrint: { status: "not_queued" },
    },
  );
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
  expect(el.shadowRoot!.querySelector("[data-settlement-none]")).toBeNull();
  const done = el.shadowRoot!.querySelector<HTMLElement>("[data-settlement-done]")!;
  expect(done.textContent?.trim()).toBe("Done");
  done.click();
  await el.updateComplete;
  expect(closed).toHaveBeenCalledOnce();
  expect(printed).not.toHaveBeenCalled();
});

it("explains F2 replacement is unavailable and prints its receipt only on the named Print action", async () => {
  const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
      result: { ...invoiceOf("30.00"), invoiceType: "F2" },
      invoicePrintersEnabled: true,
      originalReceiptAvailable: true,
      originalReceiptPrint: { status: "not_queued" },
      receiptEquipment: { ...roleOf("receipt", bar, [bar]), default: bar },
    },
  );
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
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
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
    },
  );
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
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
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
    },
  );
  const heard = vi.fn();
  el.addEventListener(action, heard);
  const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`);
  expect(button).not.toBeNull();
  button!.click();
  expect(heard).toHaveBeenCalledOnce();
  expect(el.shadowRoot!.querySelector('[data-test="refresh-receipt"]')).not.toBeNull();
});

it("keeps the final cash change beside the document choice", async () => {
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
      cashChange: "30.00",
      result: { ...invoiceOf("120.00"), payments: [], tender: { method: "cash", change: "30.00" } },
    },
  );
  expect(el.shadowRoot!.querySelector("[data-settlement-change]")?.textContent).toContain("30.00");
});

it("keeps failed F2 original recovery in the document choice", async () => {
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
      result: { ...invoiceOf("30.00"), invoiceType: "F2" },
      originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true },
    },
  );
  const heard = vi.fn();
  el.addEventListener("retry-receipt", heard);
  const button = el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-receipt]");
  expect(button).not.toBeNull();
  button!.click();
  expect(heard).toHaveBeenCalledOnce();
});

it("waits for an F2 email original before offering a paper copy", async () => {
  const attempt = {
    id: "email-original",
    medium: "email" as const,
    designation: "original" as const,
    status: "sending" as const,
    failureCode: null,
    requestedAt: "2026-11-11T12:00:00.000Z",
    at: null,
    personId: "p1",
    printerHold: null,
    lateSuccess: false,
  };
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    {
      result: { ...invoiceOf("30.00"), invoiceType: "F2" },
      originalReceiptPrint: { status: "not_queued" },
      deliveries: {
        current: attempt,
        history: [attempt],
        originalCompleted: false,
        originalPrinterId: null,
        actions: { print: null, receiptInstead: null, retryOriginal: null, email: null },
      },
    },
  );
  expect(el.shadowRoot!.querySelector("[data-test=delivery-status]")?.textContent).toContain(
    "Sending",
  );
  expect(el.shadowRoot!.querySelector("[data-test=print-receipt], [data-test=reprint]")).toBeNull();
  el.deliveries = {
    ...el.deliveries!,
    current: { ...attempt, status: "sent" },
    originalCompleted: true,
  };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
});

it.each(["F1", "F2"] as const)(
  "says an earlier %s attempt was delivered after all, beneath a newer failure",
  async (invoiceType) => {
    const earlier = {
      id: "a4-first",
      medium: "a4" as const,
      designation: "original" as const,
      status: "unknown" as const,
      failureCode: null,
      requestedAt: "2026-11-11T12:00:00.000Z",
      at: "2026-11-11T12:05:00.000Z",
      personId: "p1",
      printerHold: null,
      lateSuccess: true,
    };
    const current = {
      ...earlier,
      id: "email-second",
      medium: "email" as const,
      status: "failed" as const,
      requestedAt: "2026-11-11T12:06:00.000Z",
      lateSuccess: false,
    };
    const { el } = await mountWidget<TillSettlementDocumentDialog>(
      "till-settlement-document-dialog",
      {
        result: { ...invoiceOf("30.00"), invoiceType },
        originalReceiptPrint: { status: "not_queued" },
        deliveries: {
          current,
          history: [current, earlier],
          originalCompleted: false,
          originalPrinterId: null,
          actions: { print: null, receiptInstead: null, retryOriginal: null, email: null },
        },
      },
    );
    expect(el.shadowRoot!.querySelector("[data-test=delivery-status]")?.textContent).toContain(
      "May not have been delivered.",
    );
    expect(
      el.shadowRoot!.querySelector("[data-test=delivery-late-success]")?.textContent?.trim(),
    ).toBe("A delivery attempt succeeded after all.");
    expect(
      el.shadowRoot!.querySelector("[data-test=delivery-late-check]")?.textContent?.trim(),
    ).toBe("Check before trying again: it may already have been delivered.");
  },
);

it.each(["cash", "card"] as const)(
  "shows the completion’s cash change for %s despite an earlier cash tender",
  async (method) => {
    const { el } = await mountWidget<TillSettlementDocumentDialog>(
      "till-settlement-document-dialog",
      {
        cashChange: method === "cash" ? "10.00" : null,
        result: {
          ...invoiceOf("120.00"),
          tender: { method: "cash", change: "20.00" },
          payments: [
            {
              method: "cash",
              amount: "60.00",
              tip: "0.00",
              tendered: "80.00",
              change: "20.00",
              refunds: [],
            },
            method === "cash"
              ? {
                  method,
                  amount: "60.00",
                  tip: "0.00",
                  tendered: "70.00",
                  change: "10.00",
                  refunds: [],
                }
              : { method, amount: "60.00", tip: "0.00", reference: null, refunds: [] },
          ],
        },
      },
    );
    const change = el.shadowRoot!.querySelector("[data-settlement-change]");
    if (method === "cash") {
      expect(change?.textContent).toContain("10.00");
      expect(change?.textContent).not.toContain("20.00");
    } else expect(change).toBeNull();
  },
);

it.each(["queued", "failed"] as const)(
  "keeps a fresh F2 original's %s recovery without offering a copy",
  async (status) => {
    const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
    const { el } = await mountWidget<TillSettlementDocumentDialog>(
      "till-settlement-document-dialog",
      {
        result: { ...invoiceOf("30.00"), invoiceType: "F2" },
        invoicePrintersEnabled: true,
        originalReceiptPrint: { status, jobId: "original", canRetry: status === "failed" },
        receiptEquipment: { ...roleOf("receipt", bar, [bar]), default: bar },
      },
    );
    expect(
      el.shadowRoot!.querySelector("[data-test=print-receipt], [data-test=reprint]"),
    ).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=refresh-receipt]")).not.toBeNull();
    if (status === "failed")
      expect(el.shadowRoot!.querySelector("[data-test=retry-receipt]")).not.toBeNull();
  },
);

describe("why the receipt Print button is greyed", () => {
  const bar = equipmentItem("bar", "Bar", { kind: "receipt" });
  const off = equipmentItem("bar", "Bar", { kind: "receipt", available: false });
  const patio = equipmentItem("patio", "Patio", { kind: "receipt" });
  const mount = (receiptEquipment: RoleEquipment) =>
    mountWidget<TillSettlementDocumentDialog>("till-settlement-document-dialog", {
      result: { ...invoiceOf("30.00"), invoiceType: "F2" },
      invoicePrintersEnabled: true,
      originalReceiptAvailable: true,
      originalReceiptPrint: { status: "not_queued" },
      receiptEquipment,
    });
  const line = (el: TillSettlementDocumentDialog, key: string) =>
    el.shadowRoot!.querySelector(`[data-test=${key}]`)?.textContent?.trim();
  const lines = (el: TillSettlementDocumentDialog) =>
    ["receipt-no-printer", "receipt-printer-off", "receipt-no-printers"].flatMap((key) => {
      const words = line(el, key);
      return words === undefined ? [] : [[key, words]];
    });
  const disabled = (el: TillSettlementDocumentDialog) =>
    el.shadowRoot!.querySelector("[data-test=print-receipt]")!.hasAttribute("disabled");

  it.each([
    [
      "no printer set",
      roleOf("receipt", null, [bar]),
      "receipt-no-printer",
      () => t("document.no_receipt_printer"),
    ],
    [
      "a switched-off printer",
      roleOf("receipt", off, [patio]),
      "receipt-printer-off",
      () => t("pay_equipment.printer_switched_off").replace("{item}", "Bar"),
    ],
    [
      "no receipt printer listed",
      roleOf("receipt", null, []),
      "receipt-no-printers",
      () => t("document.no_printers_note"),
    ],
    [
      "its only receipt printer switched off",
      roleOf("receipt", off, []),
      "receipt-printer-off",
      () => t("document.printer_off_no_other").replace("{item}", "Bar"),
    ],
  ] as const)("says why with %s", async (_name, receiptEquipment, key, words) => {
    const { el } = await mount(receiptEquipment);
    expect(disabled(el)).toBe(true);
    expect(lines(el)).toEqual([[key, words()]]);
    el.invoicePrinterLoading = true;
    await el.updateComplete;
    expect(lines(el)).toEqual([]);
    el.invoicePrinterLoading = false;
    el.invoicePrinterReadFailed = true;
    await el.updateComplete;
    expect(lines(el)).toEqual([]);
    el.invoicePrinterReadFailed = false;
    el.invoicePrinterBlocked = true;
    await el.updateComplete;
    expect(lines(el)).toEqual([]);
  });

  it("says nothing with a printer that is switched on", async () => {
    const { el } = await mount(roleOf("receipt", bar, [bar]));
    expect(disabled(el)).toBe(false);
    expect(lines(el)).toEqual([]);
  });

  it("leaves the empty list's line to the printer list while it is open", async () => {
    const { el } = await mount(roleOf("receipt", null, []));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=invoice-printer-toggle]")!.click();
    await el.updateComplete;
    expect(lines(el)).toEqual([]);
    expect(el.shadowRoot!.textContent!.split(t("document.no_printers"))).toHaveLength(2);
  });
});

it("names the Done button Listo in Spanish", async () => {
  setLocale("es-ES");
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    { result: invoiceOf("30.00") },
  );
  expect(el.shadowRoot!.querySelector("[data-settlement-done]")?.textContent?.trim()).toBe("Listo");
});

const closingLines = {
  prints: {
    en: "Closing prints the receipt.",
    es: "Al cerrar se imprime el recibo.",
  },
  "switched-off": {
    en: "Bar is switched off. The receipt will print when it is switched back on.",
    es: "Bar está desactivada. El recibo se imprimirá cuando vuelva a activarse.",
  },
  "no-printer": {
    en: "This device has no receipt printer. Choose one above before closing.",
    es: "Este dispositivo no tiene impresora de recibos. Elige una arriba antes de cerrar.",
  },
  "not-allowed": {
    en: "This device may not print or email receipts. Print it from Find a bill on a till that can.",
    es: "Este dispositivo no puede imprimir ni enviar recibos. Imprímelo desde Buscar cuenta en una caja que pueda.",
  },
} as const;
type ClosingState = keyof typeof closingLines;
const closingLinesWithEmail: Partial<Record<ClosingState, { en: string; es: string }>> = {
  prints: {
    en: "Closing prints the receipt unless you email it.",
    es: "Al cerrar se imprime el recibo, salvo que lo envíes por correo electrónico.",
  },
  "no-printer": {
    en: "This device has no receipt printer. Choose one above or email the receipt before closing.",
    es: "Este dispositivo no tiene impresora de recibos. Elige una arriba o envía el recibo por correo antes de cerrar.",
  },
};

function closingProps(state: ClosingState, email = false) {
  const bar = equipmentItem("bar", "Bar", {
    kind: "receipt",
    available: state !== "switched-off",
  });
  return {
    result: { ...invoiceOf("30.00"), invoiceType: "F2" as const },
    invoicePrintersEnabled: true,
    originalReceiptAvailable: true,
    originalReceiptPrint: { status: "not_queued" as const },
    canPrintReceipt: state !== "not-allowed",
    receiptEquipment:
      state === "no-printer" ? roleOf("receipt", null, [bar]) : roleOf("receipt", bar, [bar]),
    deliveries: {
      current: null,
      history: [],
      originalCompleted: false,
      originalPrinterId: null,
      actions: {
        print: null,
        receiptInstead: null,
        retryOriginal: null,
        email: email ? { designation: "original" as const } : null,
      },
    },
  };
}

for (const language of ["en", "es"] as const)
  for (const state of Object.keys(closingLines) as ClosingState[])
    for (const email of [false, true])
      it(`says what closing does when ${state}, ${email ? "with" : "without"} email offered, in ${language}`, async () => {
        setLocale(language === "en" ? "en-GB" : "es-ES");
        const { el } = await mountWidget<TillSettlementDocumentDialog>(
          "till-settlement-document-dialog",
          closingProps(state, email),
        );
        expect(el.shadowRoot!.querySelector("[data-test=email-invoice]") !== null).toBe(
          email && state !== "not-allowed",
        );
        const lines = [...el.shadowRoot!.querySelectorAll("[data-settlement-closing]")];
        expect(lines.map((line) => line.getAttribute("data-settlement-closing"))).toEqual([state]);
        const expected = (email && closingLinesWithEmail[state]) || closingLines[state];
        expect(lines[0]!.textContent?.trim()).toBe(expected[language]);
      });

for (const invoiceType of ["F2", "F1"] as const)
  for (const state of Object.keys(closingLines) as ClosingState[]) {
    const promisesPrint = state === "prints" || state === "switched-off";
    it(`${promisesPrint ? "drops" : "keeps"} "not sent to a printer" on a ${invoiceType} when closing ${state}`, async () => {
      const { el } = await mountWidget<TillSettlementDocumentDialog>(
        "till-settlement-document-dialog",
        {
          ...closingProps(state, true),
          result: { ...invoiceOf("30.00"), invoiceType },
        },
      );
      expect(
        el
          .shadowRoot!.querySelector("[data-settlement-closing]")
          ?.getAttribute("data-settlement-closing"),
      ).toBe(state);
      const delivery = el.shadowRoot!.querySelector("[data-test=original-delivery]");
      expect(delivery).not.toBeNull();
      expect(delivery!.textContent?.includes("The original has not been sent to a printer.")).toBe(
        !promisesPrint,
      );
    });
  }

it.each<[string, Partial<TillSettlementDocumentDialog>]>([
  ["queued", { originalReceiptPrint: { status: "queued", jobId: "original", canRetry: false } }],
  ["failed", { originalReceiptPrint: { status: "failed", jobId: "original", canRetry: true } }],
  ["done", { originalReceiptPrint: { status: "done", jobId: "original", canRetry: false } }],
  [
    "emailed",
    {
      deliveries: {
        current: {
          id: "email-original",
          medium: "email",
          designation: "original",
          status: "sending",
          failureCode: null,
          requestedAt: "2026-11-11T12:00:00.000Z",
          at: null,
          personId: "p1",
          printerHold: null,
          lateSuccess: false,
        },
        history: [],
        originalCompleted: false,
        originalPrinterId: null,
        actions: { print: null, receiptInstead: null, retryOriginal: null, email: null },
      },
    },
  ],
])("says nothing about closing once the original is %s", async (_status, props) => {
  for (const state of Object.keys(closingLines) as ClosingState[]) {
    const { el } = await mountWidget<TillSettlementDocumentDialog>(
      "till-settlement-document-dialog",
      { ...closingProps(state), ...props },
    );
    expect(el.shadowRoot!.querySelector("[data-settlement-closing]")).toBeNull();
    cleanupWidgets();
  }
});

it("says nothing about closing until the receipt printer is known", async () => {
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    { ...closingProps("prints"), receiptEquipment: undefined },
  );
  expect(el.shadowRoot!.querySelector("[data-settlement-closing]")).toBeNull();
});

it.each<[string, Partial<TillSettlementDocumentDialog>]>([
  ["no receipt printer", { receiptEquipment: roleOf("receipt", null, []) }],
  ["equipment not yet read", { receiptEquipment: undefined }],
])(
  "says the device may not print before anything about its printer, with %s",
  async (_case, props) => {
    const { el } = await mountWidget<TillSettlementDocumentDialog>(
      "till-settlement-document-dialog",
      { ...closingProps("not-allowed"), ...props },
    );
    const lines = [...el.shadowRoot!.querySelectorAll("[data-settlement-closing]")];
    expect(lines.map((line) => line.getAttribute("data-settlement-closing"))).toEqual([
      "not-allowed",
    ]);
  },
);

it.each([
  ["emailed", "email", "sending", false],
  ["sent on A4", "a4", "sent", true],
] as const)(
  "says nothing about closing once a full invoice's original is %s",
  async (_case, medium, status, originalCompleted) => {
    const attempt = {
      id: "original",
      medium,
      designation: "original" as const,
      status,
      failureCode: null,
      requestedAt: "2026-11-11T12:00:00.000Z",
      at: null,
      personId: "p1",
      printerHold: null,
      lateSuccess: false,
    };
    for (const state of Object.keys(closingLines) as ClosingState[]) {
      const { el } = await mountWidget<TillSettlementDocumentDialog>(
        "till-settlement-document-dialog",
        {
          ...closingProps(state),
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
          deliveries: {
            current: attempt,
            history: [attempt],
            originalCompleted,
            originalPrinterId: null,
            actions: { print: null, receiptInstead: null, retryOriginal: null, email: null },
          },
        },
      );
      expect(el.shadowRoot!.querySelector("[data-settlement-closing]")).toBeNull();
      cleanupWidgets();
    }
  },
);

it("tells a full invoice with nothing sent that closing prints its receipt", async () => {
  const { el } = await mountWidget<TillSettlementDocumentDialog>(
    "till-settlement-document-dialog",
    { ...closingProps("prints"), result: { ...invoiceOf("30.00"), invoiceType: "F1" } },
  );
  expect(
    el
      .shadowRoot!.querySelector("[data-settlement-closing]")
      ?.getAttribute("data-settlement-closing"),
  ).toBe("prints");
});

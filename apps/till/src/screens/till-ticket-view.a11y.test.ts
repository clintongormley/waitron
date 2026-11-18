import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { equipmentItem, roleOf } from "../../test/pay-equipment-fixtures.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-ticket-view.js";
import type { TillTicketView } from "./till-ticket-view.js";
import { setLocale } from "../i18n/t.js";
import type {
  InvoiceDeliveryAttempt,
  InvoiceDeliveryStatus,
  OriginalReceiptPrint,
  TillSaleResult,
} from "../api/client.js";

const result: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
  orderLabel: "Table 6",
  orderNumber: 41,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-05T12:34:56.000Z",
  total: "9.40",
  vatBreakdown: [
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "5.82", tax: "0.58" },
  ],
  lines: [
    { descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" },
    { descriptions: { "es-ES": "Jamón" }, quantity: "0.32", gross: "6.40", parentLineNo: null },
    { descriptions: { "es-ES": "Extra queso" }, quantity: "1", gross: "0.50", parentLineNo: 2 },
  ],
  tender: { method: "cash", change: "0.60" },
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1",
};

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const a4Offer = {
  printers: [{ id: "p1", name: "Office", kind: "a4" as const }],
  designation: "original" as const,
};
const attempt = (over: Partial<InvoiceDeliveryAttempt>): InvoiceDeliveryAttempt => ({
  id: "d1",
  medium: "a4",
  designation: "original",
  status: "queued",
  failureCode: null,
  requestedAt: "2026-08-05T12:35:00.000Z",
  at: null,
  personId: "staff",
  printerHold: null,
  lateSuccess: false,
  ...over,
});
const none = { retryOriginal: null, print: null, receiptInstead: null, email: null };
/** One of each delivery state the sale view words, with the actions B1 offers beside it. */
const deliveryStates: [string, InvoiceDeliveryStatus, boolean][] = [
  [
    "no attempt, Print on Office offered",
    {
      current: null,
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, print: a4Offer },
      history: [],
    },
    false,
  ],
  [
    "no attempt, Print on a receipt printer offered",
    {
      current: null,
      originalCompleted: false,
      originalPrinterId: null,
      actions: {
        ...none,
        print: {
          printers: [{ id: "r1", name: "Bar printer", kind: "receipt" }],
          designation: "original",
        },
      },
      history: [],
    },
    false,
  ],
  [
    "A4 waiting, receipt instead offered",
    {
      current: attempt({}),
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, receiptInstead: { deliveryId: "d1" } },
      history: [],
    },
    false,
  ],
  [
    "A4 sending",
    {
      current: attempt({ status: "sending" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: none,
      history: [],
    },
    false,
  ],
  [
    "A4 held",
    {
      current: attempt({ status: "sending", printerHold: "paper_out" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: none,
      history: [],
    },
    false,
  ],
  [
    "A4 printed, duplicate offered",
    {
      current: attempt({ status: "sent" }),
      originalCompleted: true,
      originalPrinterId: null,
      actions: { ...none, print: { ...a4Offer, designation: "duplicate" } },
      history: [],
    },
    false,
  ],
  [
    "A4 failed, send again offered",
    {
      current: attempt({ status: "failed" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, retryOriginal: { medium: "a4" }, print: a4Offer },
      history: [],
    },
    false,
  ],
  [
    "A4 unknown after a hold",
    {
      current: attempt({ status: "unknown", printerHold: "paper_jam" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, retryOriginal: { medium: "a4" }, print: a4Offer },
      history: [],
    },
    false,
  ],
  [
    "email sent",
    {
      current: attempt({ medium: "email", status: "sent" }),
      originalCompleted: true,
      originalPrinterId: null,
      actions: none,
      history: [],
    },
    false,
  ],
  [
    "no attempt, Send by email offered",
    {
      current: null,
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, print: a4Offer, email: { designation: "original" } },
      history: [],
    },
    false,
  ],
  [
    "email waiting, receipt instead offered",
    {
      current: attempt({ medium: "email" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, receiptInstead: { deliveryId: "d1" } },
      history: [],
    },
    false,
  ],
  [
    "email failed, email again and another address offered",
    {
      current: attempt({ medium: "email", status: "failed" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: { ...none, retryOriginal: { medium: "email" }, email: { designation: "original" } },
      history: [],
    },
    false,
  ],
  [
    "email sent, a copy by email offered",
    {
      current: attempt({ medium: "email", status: "sent" }),
      originalCompleted: true,
      originalPrinterId: null,
      actions: { ...none, email: { designation: "duplicate" } },
      history: [],
    },
    false,
  ],
  [
    "email unknown, status read failed",
    {
      current: attempt({ medium: "email", status: "unknown" }),
      originalCompleted: false,
      originalPrinterId: null,
      actions: none,
      history: [],
    },
    true,
  ],
];

describe.each(["light", "dark"] as const)("till-ticket-view a11y (%s theme)", (theme) => {
  it.each(["ready", "loading", "read-failed", "save-failed", "empty"] as const)(
    "has no violations with the expanded Invoice printer row %s",
    async (state) => {
      const office = equipmentItem("office", "Office", { kind: "a4" });
      const { el, host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          result: { ...result, invoiceType: "F1" },
          deliveries: deliveryStates[0]![1],
          invoicePrintersEnabled: true,
          invoiceEquipment: roleOf(
            "invoice",
            state === "empty" ? null : office,
            state === "empty" ? [] : [office],
          ),
          invoicePrinterLoading: state === "loading",
          invoicePrinterReadFailed: state === "read-failed",
          invoicePrinterError:
            state === "save-failed" ? "Your printer choice was not saved. Try again." : "",
        },
        theme,
      );
      await userEvent.click(
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!,
      );
      await userEvent.click(
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-invoice]")!,
      );
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[aria-expanded=true]")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations choosing a document and taking over a Receipt printer", async () => {
    const carried = equipmentItem("belt", "Belt", {
      kind: "receipt",
      portable: true,
      heldBy: { deviceId: "other", deviceName: "Patio", personName: "Alex" },
    });
    const { el, host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: { ...result, invoiceType: "F1" },
        invoicePrintersEnabled: true,
        originalReceiptPrint: { status: "not_queued" },
        receiptEquipment: roleOf("receipt", null, [carried]),
      },
      theme,
    );
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-print-toggle]")!,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=document-receipt]")!,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "belt" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it.each(["en-GB", "es-ES"])("has no violations on an F1 in %s", async (locale) => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: { ...result, locale, invoiceType: "F1" },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each(["en-GB", "es-ES"])(
    "has no violations on a replacement of a full invoice (R4) with its day of sale in %s",
    async (locale) => {
      const { host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          result: {
            ...result,
            locale,
            invoiceType: "R4",
            invoiceNumber: "R/4",
            receiptPreview: [
              {
                kind: "text",
                text: locale === "es-ES" ? "Factura rectificativa" : "Corrective invoice",
                indent: 0,
              },
              {
                kind: "amount",
                caption: locale === "es-ES" ? "Fecha de operación" : "Date of sale",
                amount: "15 Mar 2026",
                indent: 0,
              },
              { kind: "text", text: "F/9", indent: 0 },
            ],
          },
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each([
    undefined,
    { status: "not_queued" },
    { status: "queued", jobId: "original", canRetry: false },
    { status: "printing", jobId: "original", canRetry: false },
    { status: "failed", jobId: "original", canRetry: false },
    { status: "failed", jobId: "original", canRetry: true },
    { status: "failed", jobId: "original", canRetry: false, failureCode: "printer.deleted" },
    { status: "failed", jobId: "original", canRetry: true, printerWithdrawn: true },
    { status: "done", jobId: "original", canRetry: false },
  ] as const)("has no violations with F1 original status %j", async (print) => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: print as OriginalReceiptPrint | undefined,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each([false, true])(
    "has no violations with F1 handover confirmed=%s and no printing capability",
    async (confirmed) => {
      const { host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          result: { ...result, invoiceType: "F1" },
          canPrintReceipt: false,
          originalReceiptPrint: {
            status: "done",
            jobId: "original",
            canRetry: false,
            ...(confirmed
              ? { handover: { personId: "staff", confirmedAt: "2026-08-05T12:40:00.000Z" } }
              : {}),
          },
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each(
    deliveryStates.flatMap((state) =>
      (["en-GB", "es-ES"] as const).map((locale) => [...state, locale] as const),
    ),
  )(
    "has no violations with F1 delivery state: %s (read failed %s, %s)",
    async (_name, deliveries, readFailed, locale) => {
      setLocale(locale);
      const { host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          result: { ...result, invoiceType: "F1" },
          originalReceiptPrint: { status: "not_queued" },
          deliveries,
          deliveriesReadFailed: readFailed,
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each(["en-GB", "es-ES"])(
    "has no violations with a refused delivery action and a failed read in %s",
    async (locale) => {
      setLocale(locale);
      const { host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          result: { ...result, invoiceType: "F1" },
          originalReceiptPrint: { status: "not_queued" },
          deliveries: deliveryStates[1]![1],
          deliveriesReadFailed: true,
          deliveryRefusal: { code: "invoice_delivery.active" },
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each(["en-GB", "es-ES"])(
    "has no violations with the email address form open over the sale view, refused, in %s",
    async (locale) => {
      setLocale(locale);
      const { el, host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          result: { ...result, invoiceType: "F1" },
          originalReceiptPrint: { status: "not_queued" },
          deliveries: deliveryStates.find(([name]) => name.startsWith("no attempt, Send"))![1],
          emailOpen: true,
          emailRefusal: { code: "invoice_delivery.email_unavailable" },
        },
        theme,
      );
      const form = el.shadowRoot!.querySelector("till-invoice-email-dialog")!;
      await form.updateComplete;
      expect(form.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations with the email actions held while a request is out", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: { status: "not_queued" },
        deliveries: deliveryStates.find(([name]) => name.startsWith("email failed"))![1],
        deliveryBusy: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with F1 delivery actions held while a request is out", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: { status: "not_queued" },
        deliveries: deliveryStates[1]![1],
        deliveryBusy: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with supplied text, QR, item table and tax table", async () => {
    const { el, host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          invoiceType: "F1",
          locale: "es-ES",
          receiptTrim: { logo: "a.png" },
          receiptPreview: [
            { kind: "text", text: "DOCUMENTO DE PRUEBA", indent: 0 },
            { kind: "align", alignment: "center" },
            { kind: "qr", text: result.qr },
            { kind: "logo" },
            { kind: "rule" },
            { kind: "align", alignment: "left" },
            {
              kind: "amount",
              caption: "FACTURA",
              amount: "A/1",
              indent: 0,
              style: { bold: true, double: true },
            },
            {
              kind: "table",
              table: {
                header: {
                  units: "Uds.",
                  item: "Artículo",
                  price: "Precio",
                  amount: "Importe",
                  rate: "IVA",
                },
                withRate: true,
                rows: [
                  { units: "0,32 kg", item: "Jamón", price: "18,18", amount: "5,82", rate: "10%" },
                ],
              },
            },
            {
              kind: "taxTable",
              header: { rate: "IVA", base: "Base imponible", tax: "Cuota", total: "Total" },
              rows: [{ rate: "10%", base: "5,82", tax: "0,58", total: "6,40" }],
            },
            { kind: "text", text: "DOCUMENTO DE PRUEBA", indent: 0 },
          ],
        },
      },
      theme,
    );
    expect(el.shadowRoot!.querySelectorAll("article table")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });
});

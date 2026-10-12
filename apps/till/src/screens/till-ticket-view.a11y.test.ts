import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-ticket-view.js";
import type { TicketIssuer, TillTicketView } from "./till-ticket-view.js";
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
  orderLabel: "Mesa 6",
  orderNumber: 41,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-05T12:34:56.000Z",
  total: "9.40",
  vatBreakdown: [
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "5.82", tax: "0.58" },
  ],
  // "Jamón" carries a selected option, so the indented `.option` row is swept too.
  lines: [
    { descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" },
    { descriptions: { "es-ES": "Jamón" }, quantity: "0.32", gross: "6.40", parentLineNo: null },
    { descriptions: { "es-ES": "Extra queso" }, quantity: "1", gross: "0.50", parentLineNo: 2 },
  ],
  tender: { method: "cash", change: "0.60" },
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1",
};

const issuer: TicketIssuer = { venueName: "Deli Delicioso SL", nif: "B12345678" };

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const a4Offer = { printer: { id: "p1", name: "Office" }, designation: "original" as const };
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
const none = { retryOriginal: null, printOnA4: null, receiptInstead: null, email: null };
/** One of each delivery state the sale view words, with the actions B1 offers beside it. */
const deliveryStates: [string, InvoiceDeliveryStatus, boolean][] = [
  [
    "no attempt, Print on A4 offered",
    {
      current: null,
      originalCompleted: false,
      actions: { ...none, printOnA4: a4Offer },
      history: [],
    },
    false,
  ],
  [
    "A4 waiting, receipt instead offered",
    {
      current: attempt({}),
      originalCompleted: false,
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
      actions: { ...none, printOnA4: { ...a4Offer, designation: "duplicate" } },
      history: [],
    },
    false,
  ],
  [
    "A4 failed, send again offered",
    {
      current: attempt({ status: "failed" }),
      originalCompleted: false,
      actions: { ...none, retryOriginal: { medium: "a4" }, printOnA4: a4Offer },
      history: [],
    },
    false,
  ],
  [
    "A4 unknown after a hold",
    {
      current: attempt({ status: "unknown", printerHold: "paper_jam" }),
      originalCompleted: false,
      actions: { ...none, retryOriginal: { medium: "a4" }, printOnA4: a4Offer },
      history: [],
    },
    false,
  ],
  [
    "email sent",
    {
      current: attempt({ medium: "email", status: "sent" }),
      originalCompleted: true,
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
      actions: { ...none, printOnA4: a4Offer, email: { designation: "original" } },
      history: [],
    },
    false,
  ],
  [
    "email waiting, receipt instead offered",
    {
      current: attempt({ medium: "email" }),
      originalCompleted: false,
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
      actions: none,
      history: [],
    },
    true,
  ],
];

describe.each(["light", "dark"] as const)("till-ticket-view a11y (%s theme)", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "has no violations with the saved F1 operation date in %s",
    async (locale) => {
      const { host } = await mountWidget<TillTicketView>(
        "till-ticket-view",
        {
          issuer,
          result: { ...result, locale, invoiceType: "F1", operationDate: "2026-08-04" },
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
    { status: "done", jobId: "original", canRetry: false },
  ] as const)("has no violations with F1 original status %j", async (print) => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        issuer,
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
          issuer,
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
          issuer,
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
          issuer,
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
          issuer,
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
        issuer,
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
        issuer,
        result: { ...result, invoiceType: "F1" },
        originalReceiptPrint: { status: "not_queued" },
        deliveries: deliveryStates[1]![1],
        deliveryBusy: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with F1 weighted and extra net-price rows", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        issuer,
        result: {
          ...result,
          invoiceType: "F1",
          lines: [
            {
              descriptions: { "es-ES": "Ham" },
              quantity: "0.32",
              gross: "6.40",
              listGross: "7.40",
              adjustments: [{ kind: "discount", amount: "1.00" }],
              unitName: { es: "kg" },
              net: {
                unitPrice: "1.82",
                priceQuantity: "0.100",
                base: "5.82",
                rate: "10.00",
                tax: "0.58",
              },
            },
            {
              descriptions: { "es-ES": "Extra" },
              quantity: "2",
              gross: "3.00",
              parentLineNo: 1,
              net: {
                unitPrice: "1.24",
                priceQuantity: "1.000",
                base: "2.48",
                rate: "21.00",
                tax: "0.52",
              },
            },
          ],
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the filed F1 issuer domicile and recipient", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        issuer,
        result: {
          ...result,
          invoiceType: "F1",
          issuer: {
            venueName: "Filed Venue SL",
            nif: "B87654321",
            domicile: "Calle fiscal original 27, Madrid",
          },
          recipient: {
            legalName: "Filed Customer SL",
            taxId: "B11223344",
            address: "Avenida original 123, Madrid",
            countryCode: "ES",
          },
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the filed ticket with a QR", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      { result, issuer },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a bill paid in parts, a card tip and a refund on their own rows", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          payments: [
            {
              method: "cash",
              amount: "5.00",
              tip: "0.00",
              tendered: "10.00",
              change: "5.00",
              refunds: [{ amount: "1.00", tip: "0.00" }],
            },
            { method: "card", amount: "6.40", tip: "1.00", reference: "OP-9", refunds: [] },
          ],
        },
        issuer,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a given-away and a discounted line and a bill discount on their own lines", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          lines: [
            {
              descriptions: { "es-ES": "Café" },
              quantity: "2",
              gross: "0.00",
              listGross: "3.00",
              adjustments: [{ kind: "comp", amount: "3.00" }],
            },
            {
              descriptions: { "es-ES": "Jamón" },
              quantity: "0.32",
              gross: "5.76",
              listGross: "6.40",
              adjustments: [{ kind: "discount", percentBp: 1000, amount: "0.64" }],
            },
            {
              descriptions: { "es-ES": "Extra queso" },
              quantity: "1",
              gross: "0.00",
              listGross: "0.50",
              parentLineNo: 2,
              adjustments: [{ kind: "comp", amount: "0.50" }],
            },
          ],
          billAdjustments: [{ kind: "discount", amount: "1.00" }],
        },
        issuer,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations when the verification URL is empty (no QR)", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      { result: { ...result, qr: "" }, issuer },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the non-fiscal receipt trim rendered (header subtitle + footer message)", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          receiptTrim: {
            headerSubtitle: "Calle Mayor 1, Madrid",
            footerMessage: "Gracias por su visita",
          },
        },
        issuer,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the logo, slogan, address, phone and email in the top block", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          receiptTrim: {
            headerSubtitle: "El mejor jamón",
            phone: "+34 912 345 678",
            email: "hola@deli.es",
            logo: `${"d".repeat(64)}.png`,
          },
          venueAddress: ["Calle Mayor 1", "28013 Madrid"],
        },
        issuer,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on a practice receipt filed in Catalan", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          locale: "ca-ES",
          lines: [{ descriptions: { "ca-ES": "Cafè" }, quantity: "2", gross: "3.00" }],
          tender: { method: "card", charged: "9.90", tip: "0.50", reference: "4471" },
        },
        issuer,
        invoiceLocale: "es-ES",
        simulated: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  // Tipped and manual-reference card branches render different markup, so each gets its own pass.
  it("has no violations on a tipped card receipt", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          tender: {
            method: "card",
            charged: "9.90",
            tip: "0.50",
            reference: null,
          },
        },
        issuer,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on a card receipt with a manual reference", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result: {
          ...result,
          tender: { method: "card", charged: "9.40", tip: "0.00", reference: "4471" },
        },
        issuer,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});

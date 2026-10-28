import { receiptLabelsFor } from "@waitron/country-packs";
import type { ReceiptQrText } from "@waitron/fiscal";
import type { EscSetting } from "@waitron/printing";
import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

const SAMPLE_QR = "https://example.invalid/waitron/sample-receipt";

/**
 * The sale a sample or preview receipt shows: it was never filed. It carries a sample QR only when
 * the venue's fiscal backend has words to print around one, as a filed sale's receipt would.
 */
export function sampleSale(
  qrText: ReceiptQrText | undefined,
  receiptLocale: string,
): ReceiptDocumentInput["result"] {
  const labels = receiptLabelsFor(receiptLocale);
  return {
    locale: receiptLocale,
    orderLabel: labels.sampleTableLabel,
    orderNumber: 41,
    invoiceNumber: labels.sampleInvoiceNumber,
    issuedAt: "2026-01-15T12:34:00.000Z",
    total: "5.50",
    vatBreakdown: [{ rate: "10", base: "5.00", tax: "0.50" }],
    lines: [
      {
        descriptions: { [receiptLocale]: labels.sampleItemName },
        quantity: "1",
        gross: "5.50",
      },
    ],
    tender: { method: "cash", change: "4.50" },
    ...(qrText === undefined ? { qr: "" } : { qr: SAMPLE_QR, qrText }),
  };
}

/** A realistic but unmistakably non-fiscal document: a sample receipt, or an office printer's test page. */
export function sampleDocument(
  qrText: ReceiptQrText | undefined,
  receiptLocale: string,
): ReceiptDocumentInput {
  const labels = receiptLabelsFor(receiptLocale);
  return {
    result: sampleSale(qrText, receiptLocale),
    issuer: { venueName: labels.sampleIssuerName, nif: "B00000000" },
    receipt: { footerMessage: labels.sampleFooter },
    invoiceLocale: receiptLocale,
    simulated: true,
  };
}

/** For checking the printer's current draft settings. */
export function formatSampleReceipt(
  printer: EscSetting,
  qrText: ReceiptQrText | undefined,
  receiptLocale: string,
): Uint8Array {
  return formatReceipt({ ...sampleDocument(qrText, receiptLocale), printer });
}

import { receiptLabelsFor, receiptSampleItemsFor } from "@waitron/country-packs";
import type { ReceiptQrText } from "@waitron/fiscal";
import type { EscSetting } from "@waitron/printing";
import {
  addDecimal,
  centsToDecimal,
  decimal,
  decimalToCents,
  MONEY_SCALE,
  multiplyDecimal,
  subtractDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
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
  const sale = sampleSale(qrText, receiptLocale);
  const names = receiptSampleItemsFor(receiptLocale);
  const count = decimal(String(names.length));
  const plus = (base: string, each: string): Decimal =>
    toScale(addDecimal(decimal(base), multiplyDecimal(decimal(each), count)), MONEY_SCALE);
  const total = plus("5.50", "2.20");
  const tenderedCents = (Math.floor(decimalToCents(total) / 1000) + 1) * 1000;
  return {
    result: {
      ...sale,
      total,
      vatBreakdown: [{ rate: "10", base: plus("5.00", "2.00"), tax: plus("0.50", "0.20") }],
      lines: [
        ...sale.lines,
        ...names.map((name) => ({
          descriptions: { [receiptLocale]: name },
          quantity: "1",
          gross: "2.20",
        })),
      ],
      tender: { method: "cash", change: subtractDecimal(centsToDecimal(tenderedCents), total) },
    },
    issuer: { venueName: labels.sampleIssuerName, nif: "B00000000" },
    receipt: {},
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

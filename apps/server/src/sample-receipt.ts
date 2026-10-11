import type { ReceiptQrText } from "@waitron/fiscal";
import type { EscSetting } from "@waitron/printing";
import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

const SAMPLE_QR = "https://example.invalid/waitron/sample-receipt";

/**
 * The sale a sample or preview receipt shows: it was never filed. It carries a sample QR only when
 * the venue's fiscal backend has words to print around one, as a filed sale's receipt would.
 */
export function sampleSale(qrText: ReceiptQrText | undefined): ReceiptDocumentInput["result"] {
  return {
    locale: "es-ES",
    orderLabel: "Mesa 6",
    orderNumber: 41,
    invoiceNumber: "MUESTRA/1",
    issuedAt: "2026-01-15T12:34:00.000Z",
    total: "5.50",
    vatBreakdown: [{ rate: "10", base: "5.00", tax: "0.50" }],
    lines: [
      {
        descriptions: { "es-ES": "Café y tostada" },
        quantity: "1",
        gross: "5.50",
      },
    ],
    tender: { method: "cash", change: "4.50" },
    ...(qrText === undefined ? { qr: "" } : { qr: SAMPLE_QR, qrText }),
  };
}

/** A realistic but unmistakably non-fiscal receipt for checking the printer's current draft settings. */
export function formatSampleReceipt(
  printer: EscSetting,
  qrText: ReceiptQrText | undefined,
): Uint8Array {
  return formatReceipt({
    result: sampleSale(qrText),
    issuer: { venueName: "Waitron - Recibo de muestra", nif: "B00000000" },
    receipt: { footerMessage: "Café, jamón, niño, pingüino · 5 €" },
    invoiceLocale: "es-ES",
    printer,
    simulated: true,
  });
}

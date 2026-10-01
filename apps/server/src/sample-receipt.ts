import type { EscSetting } from "@waitron/printing";
import { formatReceipt } from "./receipt-ticket.js";
import type { TillSaleResult } from "./till-sale.js";

/** The sale a sample or preview receipt shows: it was never filed. */
export const SAMPLE_SALE: TillSaleResult = {
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
  qr: "https://example.invalid/waitron/sample-receipt",
};

/** A realistic but unmistakably non-fiscal receipt for checking the printer's current draft settings. */
export function formatSampleReceipt(printer: EscSetting): Uint8Array {
  return formatReceipt({
    result: SAMPLE_SALE,
    issuer: { venueName: "Waitron - Recibo de muestra", nif: "B00000000" },
    receipt: { footerMessage: "Café, jamón, niño, pingüino · 5 €" },
    invoiceLocale: "es-ES",
    printer,
    simulated: true,
  });
}

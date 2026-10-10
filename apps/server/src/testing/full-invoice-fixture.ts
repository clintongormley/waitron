import type { FormatReceiptInput } from "../receipt-ticket.js";
import type { ReceiptDocumentInput } from "../receipt-document.js";

export const FULL_INVOICE_DOCUMENT_FIXTURE: ReceiptDocumentInput = {
  surface: "a4",
  result: {
    invoiceType: "F1",
    locale: "es-ES",
    orderLabel: "Mesa 6",
    orderNumber: 41,
    invoiceNumber: "FF/1",
    issuedAt: "2026-08-17T22:34:00.000Z",
    issuedOffsetMinutes: 120,
    operationDate: "2026-08-17",
    issuer: {
      venueName: "Charcutería La Buena SL",
      nif: "B12345678",
      domicile:
        "Calle del domicilio fiscal original número 27, edificio de la plaza mayor, segunda planta, Madrid 28001",
    },
    recipient: {
      legalName: "Cliente de nombre largo y completo Sociedad Limitada",
      taxId: "B11223344",
      countryCode: "ES",
      address:
        "Avenida del cliente original número 123, edificio de la estación, tercera planta, Madrid 28002",
    },
    total: "19.69",
    vatBreakdown: [
      { rate: "21", base: "9.00", tax: "1.89" },
      { rate: "10", base: "8.00", tax: "0.80" },
    ],
    lines: [
      {
        descriptions: {
          "es-ES": "Menú del día con un nombre especialmente largo",
          "en-GB": "Set menu with a particularly long name",
        },
        quantity: "1",
        gross: "10.89",
        listGross: "12.10",
        net: { unitPrice: "10.00", priceQuantity: "1.000", base: "9.00", tax: "1.89", rate: "21" },
        adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.21" }],
      },
      {
        descriptions: { "es-ES": "Agua mineral", "en-GB": "Mineral water" },
        quantity: "2",
        gross: "8.80",
        net: { unitPrice: "4.00", priceQuantity: "1.000", base: "8.00", tax: "0.80", rate: "10" },
      },
    ],
    tender: { method: "cash", change: "0.31" },
    qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=FF%2F1&fecha=18-08-2026&importe=19.69",
    qrText: { caption: "QR tributario:", legend: "VERI*FACTU" },
  },
  issuer: {
    venueName: "Current mutable issuer",
    nif: "B87654321",
    domicile: "Current mutable domicile",
  },
  receipt: {
    headerSubtitle: "Gracias por su visita",
    phone: "910000000",
    email: "venue@example.test",
    footerMessage: "Hasta pronto",
  },
  receiptHeader: { tradingName: "La Buena", printTradingName: true },
  venueAddress: ["Current mutable location address"],
  invoiceLocale: "es-ES",
};

export const FULL_INVOICE_FIXTURE: FormatReceiptInput = {
  ...FULL_INVOICE_DOCUMENT_FIXTURE,
  printer: { paperWidth: "80mm", resolution: "180dpi" },
};

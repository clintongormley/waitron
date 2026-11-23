import type { ReceiptDocumentInput } from "../receipt-document.js";
import type { TillSaleLine } from "../till-sale.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./full-invoice-fixture.js";

export const burgerAndBread = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Hamburguesa" },
      quantity: "1",
      gross: "9.72",
      listGross: "12.00",
      listUnitPriceGross: "12.00",
      net: {
        unitPrice: "8.03",
        priceQuantity: "1.000",
        base: "8.03",
        tax: "1.69",
        rate: "21.00",
      },
      adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
    },
    {
      descriptions: { "es-ES": "Pan de pueblo" },
      quantity: "1",
      gross: "2.25",
      listGross: "2.50",
      listUnitPriceGross: "2.50",
      net: {
        unitPrice: "2.05",
        priceQuantity: "1.000",
        base: "2.05",
        tax: "0.20",
        rate: "10.00",
      },
    },
  ];
  input.result.vatBreakdown = [
    { rate: "21.00", base: "8.03", tax: "1.69" },
    { rate: "10.00", base: "2.05", tax: "0.20" },
  ];
  input.result.total = "11.97";
  return input;
};

export const burgerAndBreadWithBillDiscount = (): ReceiptDocumentInput => {
  const input = burgerAndBread();
  input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "1.33" }];
  return input;
};

export const recordsNotPlaced = (): ReceiptDocumentInput => {
  const input = burgerAndBread();
  input.result.lines[0]!.adjustments = [{ kind: "discount", amount: "2.28" }];
  delete input.result.lines[1]!.listGross;
  delete input.result.lines[1]!.listUnitPriceGross;
  delete input.result.billAdjustments;
  return input;
};

export const billDiscountOverTwoRates = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Rioja crianza" },
      quantity: "1",
      gross: "27.00",
      listGross: "30.00",
      listUnitPriceGross: "30.00",
      net: {
        unitPrice: "22.31",
        priceQuantity: "1.000",
        base: "22.31",
        tax: "4.69",
        rate: "21.00",
      },
    },
    {
      descriptions: { "es-ES": "Pan de pueblo" },
      quantity: "1",
      gross: "2.25",
      listGross: "2.50",
      listUnitPriceGross: "2.50",
      net: { unitPrice: "2.05", priceQuantity: "1.000", base: "2.05", tax: "0.20", rate: "10.00" },
    },
  ];
  input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "3.25" }];
  input.result.vatBreakdown = [
    { rate: "21.00", base: "22.31", tax: "4.69" },
    { rate: "10.00", base: "2.05", tax: "0.20" },
  ];
  input.result.total = "29.25";
  return input;
};

export const fullComp = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Jamón ibérico" },
      unitName: { es: "kg" },
      quantity: "0.123",
      gross: "0.00",
      listGross: "2.95",
      listUnitPriceGross: "24.00",
      net: { unitPrice: "0.00", priceQuantity: "1.000", base: "0.00", tax: "0.00", rate: "10.00" },
      adjustments: [{ kind: "comp", amount: "2.95" }],
    },
  ];
  input.result.vatBreakdown = [{ rate: "10.00", base: "0.00", tax: "0.00" }];
  input.result.total = "0.00";
  return input;
};

export const ownPartCompUnderBillComp = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Hamburguesa" },
      quantity: "1",
      gross: "0.00",
      listGross: "10.00",
      listUnitPriceGross: "10.00",
      net: { unitPrice: "0.00", priceQuantity: "1.000", base: "0.00", tax: "0.00", rate: "10.00" },
      adjustments: [{ kind: "discount", amount: "6.00" }],
    },
  ];
  input.result.billAdjustments = [{ kind: "discount", percentBp: 10000, amount: "4.00" }];
  input.result.vatBreakdown = [{ rate: "10.00", base: "0.00", tax: "0.00" }];
  input.result.total = "0.00";
  return input;
};

export const unfiledDish = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  delete input.result.lines[0]!.net;
  return input;
};

/** A dish at 10% whose own discount also covers its extra at 21%. */
export const dishDiscountOverExtraAtAnotherRate = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Hamburguesa" },
      quantity: "1",
      gross: "9.00",
      listGross: "10.00",
      listUnitPriceGross: "10.00",
      net: { unitPrice: "8.18", priceQuantity: "1.000", base: "8.18", tax: "0.82", rate: "10.00" },
      adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.20" }],
    },
    {
      descriptions: { "es-ES": "Cheese" },
      parentLineNo: 1,
      quantity: "1",
      gross: "1.80",
      listGross: "2.00",
      listUnitPriceGross: "2.00",
      net: { unitPrice: "1.49", priceQuantity: "1.000", base: "1.49", tax: "0.31", rate: "21.00" },
    },
  ];
  input.result.vatBreakdown = [
    { rate: "10.00", base: "8.18", tax: "0.82" },
    { rate: "21.00", base: "1.49", tax: "0.31" },
  ];
  input.result.total = "10.80";
  return input;
};

/** The same dish and extra on a simplified ticket, where each amount carries its rate letter. */
export const simplifiedDishDiscountOverExtraAtAnotherRate = (): ReceiptDocumentInput => {
  const input = dishDiscountOverExtraAtAnotherRate();
  input.surface = "thermal";
  input.result.invoiceType = "F2";
  delete input.result.recipient;
  for (const line of input.result.lines) {
    line.vatRate = line.net!.rate;
    delete line.net;
  }
  return input;
};

const advanceTaken = { invoiceNumber: "A/12", issuedOn: "2026-11-19" };

const advanceLine = (gross: string): TillSaleLine => ({
  descriptions: { "es-ES": "Payment on account" },
  quantity: "1",
  gross,
  vatRate: "10.00",
  advance: advanceTaken,
});

/** A full invoice taking a whole-bill discount and then an advance off one dish. */
export const advanceTakenOff = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Pan de pueblo" },
      quantity: "1",
      gross: "108.00",
      listGross: "120.00",
      listUnitPriceGross: "120.00",
      net: {
        unitPrice: "98.18",
        priceQuantity: "1.000",
        base: "98.18",
        tax: "9.82",
        rate: "10.00",
      },
    },
    {
      ...advanceLine("-30.00"),
      net: {
        unitPrice: "-27.27",
        priceQuantity: "1.000",
        base: "-27.27",
        tax: "-2.73",
        rate: "10.00",
      },
    },
  ];
  input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "12.00" }];
  input.result.vatBreakdown = [{ rate: "10.00", base: "70.91", tax: "7.09" }];
  input.result.total = "78.00";
  return input;
};

/** The same bill as a simplified ticket: the bill discount and the advance print with VAT. */
export const simplifiedAdvanceTakenOff = (): ReceiptDocumentInput => ({
  result: {
    locale: "es-ES",
    orderLabel: null,
    orderNumber: 0,
    invoiceNumber: "T/40",
    issuedAt: "2026-12-05T22:00:00.000Z",
    issuedOffsetMinutes: 60,
    total: "78.00",
    vatBreakdown: [{ rate: "10.00", base: "70.91", tax: "7.09" }],
    lines: [
      {
        descriptions: { "es-ES": "Tasting menu" },
        quantity: "1",
        gross: "108.00",
        listGross: "120.00",
      },
      advanceLine("-30.00"),
    ],
    billAdjustments: [{ kind: "discount", percentBp: 1000, amount: "12.00" }],
    tender: { method: "cash", change: "0.00" },
    qr: "",
  },
  issuer: { venueName: "Venue", nif: "B12345678" },
  receipt: {},
  invoiceLocale: "es-ES",
});

/** Three 0,03 € dishes at 21 %: VAT worked out per row would come to a cent more than per rate. */
export const threeCentRows = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  const row = (name: string): TillSaleLine => ({
    descriptions: { "es-ES": name },
    quantity: "1",
    gross: "0.03",
    net: { unitPrice: "0.02", priceQuantity: "1.000", base: "0.02", tax: "0.01", rate: "21" },
  });
  input.result.lines = [row("One"), row("Two"), row("Three")];
  input.result.vatBreakdown = [{ rate: "21", base: "0.07", tax: "0.02" }];
  input.result.total = "0.09";
  return input;
};

/** Records that disagree: the dish's own adjustment takes a cent more than its list price less
 *  what it was charged, and the bill took a little more as well. */
export const ownAdjustmentAboveWhatTheDishLost = (): ReceiptDocumentInput => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  input.result.lines = [
    {
      descriptions: { "es-ES": "Burger" },
      quantity: "1",
      gross: "9.00",
      listGross: "10.00",
      listUnitPriceGross: "10.00",
      net: { unitPrice: "7.40", priceQuantity: "1.000", base: "7.40", tax: "1.60", rate: "21" },
      adjustments: [{ kind: "discount", amount: "1.01" }],
    },
  ];
  input.result.billAdjustments = [{ kind: "discount", amount: "0.05" }];
  input.result.vatBreakdown = [{ rate: "21", base: "7.40", tax: "1.60" }];
  input.result.total = "9.00";
  return input;
};

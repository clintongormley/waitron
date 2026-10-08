import { invoiceFont } from "./invoice-font.js";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { qrModules } from "./qr-matrix.js";

export const INVOICE_PAGE_WIDTH = 595.28;
export const INVOICE_PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;
const QR_SIZE = (35 * 72) / 25.4;

type PageText = { kind: "text"; text: string; x: number; y: number; size: number };
type PageQr = {
  kind: "qr";
  modules: readonly (readonly boolean[])[];
  x: number;
  y: number;
  size: number;
};
export type InvoicePageElement = PageText | PageQr;
export interface InvoicePage {
  elements: InvoicePageElement[];
}

function width(text: string): number {
  return (invoiceFont.layout(text).advanceWidth * BODY_SIZE) / invoiceFont.unitsPerEm;
}

function wrap(text: string, available: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const combined = line === "" ? word : `${line} ${word}`;
    if (width(combined) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = "";
    for (const character of word) {
      if (line !== "" && width(line + character) > available) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

export function layoutInvoicePages(input: ReceiptDocumentInput): InvoicePage[] {
  const pages: InvoicePage[] = [{ elements: [] }];
  let y = MARGIN;
  let alignment: "left" | "center" = "left";
  const room = (height: number): void => {
    if (y + height > INVOICE_PAGE_HEIGHT - MARGIN) {
      pages.push({ elements: [] });
      y = MARGIN;
    }
  };
  const text = (value: string, x: number, available: number, centered = false): void => {
    for (const line of wrap(value, available)) {
      room(LINE_HEIGHT);
      pages.at(-1)!.elements.push({
        kind: "text",
        text: line,
        x: centered ? (INVOICE_PAGE_WIDTH - width(line)) / 2 : x,
        y,
        size: BODY_SIZE,
      });
      y += LINE_HEIGHT;
    }
  };
  for (const element of buildReceiptDocument(input).elements) {
    switch (element.kind) {
      case "align":
        alignment = element.alignment;
        break;
      case "logo":
        break;
      case "break":
        y += LINE_HEIGHT / 2;
        break;
      case "qr":
        room(QR_SIZE);
        pages.at(-1)!.elements.push({
          kind: "qr",
          modules: qrModules(element.text),
          x: (INVOICE_PAGE_WIDTH - QR_SIZE) / 2,
          y,
          size: QR_SIZE,
        });
        y += QR_SIZE + LINE_HEIGHT / 2;
        break;
      case "text":
      case "amount": {
        const indent = typeof element.indent === "number" ? element.indent * 5 : 0;
        const x = MARGIN + indent;
        const available = INVOICE_PAGE_WIDTH - MARGIN - x;
        const value =
          element.kind === "text" ? element.text : `${element.caption} ${element.amount}`;
        text(value, x, available, alignment === "center");
        break;
      }
    }
  }
  return pages;
}

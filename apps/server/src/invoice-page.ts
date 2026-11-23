import type { ReceiptLogoRaster } from "@waitron/shared";
import { invoiceBoldFont, invoiceFont } from "./invoice-font.js";
import { CONTACT_SEPARATOR } from "./receipt-facts.js";

export const INVOICE_PAGE_WIDTH = 595.28;
export const INVOICE_PAGE_HEIGHT = 841.89;
export const INVOICE_INK = "#000000";
export const INVOICE_MUTED = "#6b6b6b";
export const INVOICE_BOX_FILLS = { heading: "#e4e4e8", panel: "#f2f2f4" } as const;

type PageText = {
  kind: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  weight: InvoiceTextWeight;
  tone: "ink" | "muted";
};
type PageQr = {
  kind: "qr";
  modules: readonly (readonly boolean[])[];
  x: number;
  y: number;
  moduleSize: number;
};
type PageLogo = {
  kind: "logo";
  raster: ReceiptLogoRaster;
  x: number;
  y: number;
  width: number;
  height: number;
};
type PageRule = { kind: "rule"; x: number; y: number; width: number; thickness: number };
type PageBox = {
  kind: "box";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: "heading" | "panel";
};
export type InvoiceTextWeight = "regular" | "bold";
export type InvoicePageElement = PageText | PageQr | PageLogo | PageRule | PageBox;
export interface InvoicePage {
  elements: InvoicePageElement[];
}

export const INVOICE_TEXT_WIDTH_MEMO_LIMIT = 5000;
// Bounded because the server runs for months and every invoice brings new names.
const faces = {
  regular: { font: invoiceFont, advanceWidths: new Map<string, number>() },
  bold: { font: invoiceBoldFont, advanceWidths: new Map<string, number>() },
};

function width(text: string, size: number, weight: InvoiceTextWeight = "regular"): number {
  const { font: load, advanceWidths } = faces[weight];
  const font = load();
  let advance = advanceWidths.get(text);
  if (advance === undefined) {
    if (advanceWidths.size >= INVOICE_TEXT_WIDTH_MEMO_LIMIT) advanceWidths.clear();
    advance = font.layout(text).advanceWidth;
    advanceWidths.set(text, advance);
  }
  return (advance * size) / font.unitsPerEm;
}
export { width as invoiceTextWidth, wrap as wrapInvoiceText, wrapParts as wrapInvoiceParts };

function wrap(
  text: string,
  available: number,
  size: number,
  weight: InvoiceTextWeight = "regular",
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const combined = line === "" ? word : `${line} ${word}`;
    if (width(combined, size, weight) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = "";
    for (const character of word) {
      if (line !== "" && width(line + character, size, weight) > available) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Whole parts packed onto each line; only a part too long for a line by itself is word-wrapped. */
function wrapParts(
  text: string,
  available: number,
  size: number,
  weight: InvoiceTextWeight,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const part of text.split(CONTACT_SEPARATOR)) {
    const combined = line === "" ? part : `${line}${CONTACT_SEPARATOR}${part}`;
    if (width(combined, size, weight) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    const wrapped = wrap(part, available, size, weight);
    line = wrapped.pop() ?? "";
    lines.push(...wrapped);
  }
  if (line !== "") lines.push(line);
  return lines;
}

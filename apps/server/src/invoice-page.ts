import type { ReceiptLogoRaster } from "@waitron/shared";
import { invoiceFont } from "./invoice-font.js";
import { buildReceiptDocument, type ReceiptDocumentInput } from "./receipt-document.js";
import { qrModules } from "./qr-matrix.js";

export const INVOICE_PAGE_WIDTH = 595.28;
export const INVOICE_PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;
const QR_SIZE = (35 * 72) / 25.4;
const RULE_THICKNESS = 0.75;

type PageText = {
  kind: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
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
export type InvoicePageElement = PageText | PageQr | PageLogo | PageRule;
export interface InvoicePage {
  elements: InvoicePageElement[];
}

function width(text: string, size: number): number {
  return (invoiceFont.layout(text).advanceWidth * size) / invoiceFont.unitsPerEm;
}

function wrap(text: string, available: number, size: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const combined = line === "" ? word : `${line} ${word}`;
    if (width(combined, size) <= available) {
      line = combined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = "";
    for (const character of word) {
      if (line !== "" && width(line + character, size) > available) {
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
  let afterBreak = false;
  const room = (height: number): void => {
    if (y + height > INVOICE_PAGE_HEIGHT - MARGIN) {
      pages.push({ elements: [] });
      y = MARGIN;
    }
  };
  const text = (
    value: string,
    x: number,
    available: number,
    { size, bold, centered }: { size: number; bold: boolean; centered: boolean },
  ): void => {
    const height = (LINE_HEIGHT * size) / BODY_SIZE;
    for (const line of wrap(value, available, size)) {
      room(height);
      pages.at(-1)!.elements.push({
        kind: "text",
        text: line,
        x: centered ? (INVOICE_PAGE_WIDTH - width(line, size)) / 2 : x,
        y,
        size,
        bold,
      });
      y += height;
    }
  };
  for (const element of buildReceiptDocument({ ...input, surface: "a4" }).elements) {
    const previousWasBreak = afterBreak;
    if (element.kind !== "align") afterBreak = element.kind === "break";
    switch (element.kind) {
      case "align":
        alignment = element.alignment;
        break;
      case "logo": {
        const raster = input.logo;
        if (raster) {
          const pitch = 72 / 203;
          const logoWidth = raster.widthDots * pitch;
          const logoHeight = raster.heightDots * pitch;
          if (!previousWasBreak) y += LINE_HEIGHT / 2;
          room(logoHeight + LINE_HEIGHT / 2);
          pages.at(-1)!.elements.push({
            kind: "logo",
            raster,
            x: (INVOICE_PAGE_WIDTH - logoWidth) / 2,
            y,
            width: logoWidth,
            height: logoHeight,
          });
          y += logoHeight + LINE_HEIGHT / 2;
        }
        break;
      }
      case "break":
        y += LINE_HEIGHT / 2;
        break;
      case "rule":
        room(LINE_HEIGHT / 2 + LINE_HEIGHT);
        pages.at(-1)!.elements.push({
          kind: "rule",
          x: MARGIN,
          y: y + (LINE_HEIGHT / 2 - RULE_THICKNESS) / 2,
          width: INVOICE_PAGE_WIDTH - 2 * MARGIN,
          thickness: RULE_THICKNESS,
        });
        y += LINE_HEIGHT / 2;
        break;
      case "qr": {
        const modules = qrModules(element.text);
        const moduleSize = QR_SIZE / modules.length;
        const quietZone = 4 * moduleSize;
        room(QR_SIZE + 2 * quietZone);
        pages.at(-1)!.elements.push({
          kind: "qr",
          modules,
          x: (INVOICE_PAGE_WIDTH - QR_SIZE) / 2,
          y: y + quietZone,
          moduleSize,
        });
        y += QR_SIZE + 2 * quietZone + LINE_HEIGHT / 2;
        break;
      }
      case "text":
      case "amount": {
        const indent = typeof element.indent === "number" ? element.indent * 5 : 0;
        const x = MARGIN + indent;
        const available = INVOICE_PAGE_WIDTH - MARGIN - x;
        const value =
          element.kind === "text" ? element.text : `${element.caption} ${element.amount}`;
        text(value, x, available, {
          size: element.style?.double === true ? BODY_SIZE * 2 : BODY_SIZE,
          bold: element.style?.bold === true,
          centered: alignment === "center",
        });
        break;
      }
    }
  }
  return pages;
}

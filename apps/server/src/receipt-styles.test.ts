import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReceiptElement } from "./receipt-document.js";
import { formatReceipt } from "./receipt-ticket.js";
import { layoutInvoicePages } from "./invoice-page.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { renderInvoiceRaster } from "./invoice-raster.js";
import {
  FULL_INVOICE_DOCUMENT_FIXTURE,
  FULL_INVOICE_FIXTURE,
} from "./testing/full-invoice-fixture.js";
import { printedCommands } from "./testing/decode-ticket.js";

// No document yet asks for every style, so these cases replace the built document's elements.
const injected = vi.hoisted(() => ({ elements: undefined as ReceiptElement[] | undefined }));
vi.mock("./receipt-document.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./receipt-document.js")>();
  return {
    ...real,
    buildReceiptDocument: (input: Parameters<typeof real.buildReceiptDocument>[0]) => {
      const document = real.buildReceiptDocument(input);
      return injected.elements === undefined
        ? document
        : { ...document, elements: injected.elements };
    },
  };
});

afterEach(() => {
  injected.elements = undefined;
});

const PLAIN: ReceiptElement = { kind: "text", text: "Gracias", indent: 0 };
const BOLD: ReceiptElement = { ...PLAIN, style: { bold: true } };

function pdfContent(bytes: Buffer): string {
  const text = bytes.toString("latin1");
  let content = "";
  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);
    try {
      content += inflateSync(bytes.subarray(start, end)).toString("latin1");
    } catch {
      content += text.slice(start, end);
    }
  }
  return content;
}

describe("styled elements on the A4 page", () => {
  it("lays out bold text, double text and a bold amount with their weight and size", () => {
    injected.elements = [
      BOLD,
      { kind: "text", text: "Grande", indent: 0, style: { double: true } },
      { kind: "amount", caption: "Base", amount: "1,00 €", indent: 0, style: { bold: true } },
      PLAIN,
    ];
    const texts = layoutInvoicePages(FULL_INVOICE_DOCUMENT_FIXTURE)[0]!.elements;
    expect(texts).toEqual([
      expect.objectContaining({ text: "Gracias", size: 10, bold: true, y: 36 }),
      expect.objectContaining({ text: "Grande", size: 20, bold: false, y: 50 }),
      expect.objectContaining({ text: "Base 1,00 €", size: 10, bold: true, y: 78 }),
      expect.objectContaining({ text: "Gracias", size: 10, bold: false, y: 92 }),
    ]);
  });

  it("fills and outlines bold text in the PDF, and only fills plain text", async () => {
    injected.elements = [BOLD];
    const bold = pdfContent(await renderInvoicePdf(FULL_INVOICE_DOCUMENT_FIXTURE));
    expect(bold).toMatch(/\b0\.35 w\b/);
    expect(bold).toMatch(/\b2 Tr\b/);
    injected.elements = [PLAIN];
    const plain = pdfContent(await renderInvoicePdf(FULL_INVOICE_DOCUMENT_FIXTURE));
    expect(plain).toContain("BT");
    expect(plain).not.toMatch(/\b2 Tr\b/);
  });

  it("draws bold text with more ink than the same text plain in the raster", async () => {
    const ink = async (element: ReceiptElement): Promise<number> => {
      injected.elements = [element];
      const [page] = await renderInvoiceRaster(FULL_INVOICE_DOCUMENT_FIXTURE, 300);
      let count = 0;
      for (const value of page!.pixels) if (value < 128) count++;
      return count;
    };
    const plain = await ink(PLAIN);
    const bold = await ink(BOLD);
    expect(plain).toBeGreaterThan(0);
    expect(bold).toBeGreaterThan(plain * 1.1);
  });
});

describe("styled elements on the roll", () => {
  const drawn = (elements: ReceiptElement[]) => {
    injected.elements = elements;
    return printedCommands(
      formatReceipt({
        ...FULL_INVOICE_FIXTURE,
        printer: { paperWidth: "58mm", resolution: "180dpi" },
      }),
    ).filter((command) => command.text !== undefined);
  };

  it("wraps a double text line at half of 58 mm's 30 columns, each line 56 dots high", () => {
    const lines = drawn([
      {
        kind: "text",
        text: "Gracias por su visita, hasta pronto",
        indent: 0,
        style: { double: true },
      },
    ]);
    expect(lines.map((line) => line.text!.trimEnd())).toEqual([
      "Gracias por su",
      "visita, hasta",
      "pronto",
    ]);
    expect(lines.map((line) => line.heightDots)).toEqual([56, 56, 56]);
  });

  it("measures a double line's hanging indent against the half width it is drawn in", () => {
    const lines = drawn([
      {
        kind: "text",
        text: "12345678  Croquetas caseras de jamón",
        indent: { after: "12345678  " },
        style: { double: true },
      },
    ]);
    expect(lines.map((line) => line.text!.trimEnd())).toEqual([
      "12345678",
      "  Croquetas",
      "  caseras de",
      "  jamón",
    ]);
  });
});

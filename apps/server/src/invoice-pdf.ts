import { once } from "node:events";
import PDFDocument from "pdfkit";
import { invoiceBoldFontBytes, invoiceFontBytes } from "./invoice-font.js";
import { layoutA4Invoice } from "./invoice-layout.js";
import {
  INVOICE_BOX_FILLS,
  INVOICE_INK,
  INVOICE_MUTED,
  INVOICE_PAGE_HEIGHT,
  INVOICE_PAGE_WIDTH,
} from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-facts.js";

export async function renderInvoicePdf(input: ReceiptDocumentInput): Promise<Buffer> {
  const issuedAt = new Date(input.result.issuedAt);
  const pdf = new PDFDocument({
    autoFirstPage: false,
    // PDFKit accepts font bytes here; its constructor option type names only a path.
    font: invoiceFontBytes() as unknown as string,
    info: { CreationDate: issuedAt, ModDate: issuedAt },
  });
  pdf.registerFont("regular", invoiceFontBytes());
  pdf.registerFont("bold", invoiceBoldFontBytes());
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(pdf, "end");
  for (const page of layoutA4Invoice(input)) {
    pdf.addPage({ size: [INVOICE_PAGE_WIDTH, INVOICE_PAGE_HEIGHT], margin: 0 });
    for (const element of page.elements) {
      // PDFKit keeps the last fill colour for later drawing, so every element sets its own.
      if (element.kind === "text") {
        pdf
          .font(element.weight)
          .fillColor(element.tone === "muted" ? INVOICE_MUTED : INVOICE_INK)
          .fontSize(element.size)
          .text(element.text, element.x, element.y, { lineBreak: false });
      } else if (element.kind === "box") {
        pdf
          .rect(element.x, element.y, element.width, element.height)
          .fill(INVOICE_BOX_FILLS[element.fill]);
      } else if (element.kind === "logo") {
        const { raster } = element;
        const pitch = element.width / raster.widthDots;
        const stride = Math.ceil(raster.widthDots / 8);
        for (let row = 0; row < raster.heightDots; row++) {
          for (let col = 0; col < raster.widthDots; col++) {
            if (raster.bits[row * stride + (col >> 3)]! & (0x80 >> (col & 7))) {
              pdf.rect(element.x + col * pitch, element.y + row * pitch, pitch, pitch);
            }
          }
        }
        pdf.fill(INVOICE_INK);
      } else if (element.kind === "rule") {
        pdf.rect(element.x, element.y, element.width, element.thickness).fill(INVOICE_INK);
      } else {
        const pitch = element.moduleSize;
        for (let row = 0; row < element.modules.length; row++) {
          for (let col = 0; col < element.modules.length; col++) {
            if (element.modules[row]![col]) {
              pdf.rect(element.x + col * pitch, element.y + row * pitch, pitch, pitch);
            }
          }
        }
        pdf.fill(INVOICE_INK);
      }
    }
  }
  pdf.end();
  await ended;
  return Buffer.concat(chunks);
}

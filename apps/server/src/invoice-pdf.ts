import { once } from "node:events";
import PDFDocument from "pdfkit";
import { invoiceFontBytes } from "./invoice-font.js";
import { INVOICE_PAGE_WIDTH, INVOICE_PAGE_HEIGHT, layoutInvoicePages } from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

export async function renderInvoicePdf(input: ReceiptDocumentInput): Promise<Buffer> {
  const issuedAt = new Date(input.result.issuedAt);
  const pdf = new PDFDocument({
    autoFirstPage: false,
    // PDFKit accepts font bytes here; its constructor option type names only a path.
    font: invoiceFontBytes as unknown as string,
    info: { CreationDate: issuedAt, ModDate: issuedAt },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(pdf, "end");
  for (const page of layoutInvoicePages(input)) {
    pdf.addPage({ size: [INVOICE_PAGE_WIDTH, INVOICE_PAGE_HEIGHT], margin: 0 });
    for (const element of page.elements) {
      if (element.kind === "text") {
        pdf.fontSize(element.size).text(element.text, element.x, element.y, { lineBreak: false });
      } else {
        const pitch = element.size / (element.modules.length + 8);
        for (let row = 0; row < element.modules.length; row++) {
          for (let col = 0; col < element.modules.length; col++) {
            if (element.modules[row]![col]) {
              pdf.rect(element.x + (col + 4) * pitch, element.y + (row + 4) * pitch, pitch, pitch);
            }
          }
        }
        pdf.fill();
      }
    }
  }
  pdf.end();
  await ended;
  return Buffer.concat(chunks);
}

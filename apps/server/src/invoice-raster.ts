import sharp from "sharp";
import { invoiceFont } from "./invoice-font.js";
import { INVOICE_PAGE_WIDTH, INVOICE_PAGE_HEIGHT, layoutInvoicePages } from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

export interface InvoiceRasterPage {
  width: number;
  height: number;
  resolution: 300 | 600;
  pixels: Buffer;
}

export async function renderInvoiceRaster(
  input: ReceiptDocumentInput,
  resolution: 300 | 600,
): Promise<InvoiceRasterPage[]> {
  const scale = resolution / 300;
  const width = 2480 * scale;
  const height = 3508 * scale;
  const pages: InvoiceRasterPage[] = [];
  for (const page of layoutInvoicePages(input)) {
    const paths: string[] = [];
    for (const element of page.elements) {
      if (element.kind === "text") {
        const run = invoiceFont.layout(element.text);
        const size = element.size / invoiceFont.unitsPerEm;
        let x = element.x;
        let y = element.y + invoiceFont.ascent * size;
        for (let index = 0; index < run.glyphs.length; index++) {
          const position = run.positions[index]!;
          const path = run.glyphs[index]!.path.toSVG();
          paths.push(
            `<path transform="translate(${x + position.xOffset * size} ${y - position.yOffset * size}) scale(${size} ${-size})" d="${path}"/>`,
          );
          x += position.xAdvance * size;
          y -= position.yAdvance * size;
        }
      } else {
        const pitch = element.size / (element.modules.length + 8);
        for (let row = 0; row < element.modules.length; row++) {
          for (let col = 0; col < element.modules.length; col++) {
            if (element.modules[row]![col]) {
              paths.push(
                `<rect shape-rendering="crispEdges" x="${element.x + (col + 4) * pitch}" y="${element.y + (row + 4) * pitch}" width="${pitch}" height="${pitch}"/>`,
              );
            }
          }
        }
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${INVOICE_PAGE_WIDTH} ${INVOICE_PAGE_HEIGHT}"><rect width="${INVOICE_PAGE_WIDTH}" height="${INVOICE_PAGE_HEIGHT}" fill="white"/><g fill="black">${paths.join("")}</g></svg>`;
    const pixels = await sharp(Buffer.from(svg)).greyscale().removeAlpha().raw().toBuffer();
    pages.push({ width, height, resolution, pixels });
  }
  return pages;
}

import { invoiceBoldFont, invoiceFont } from "./invoice-font.js";
import { layoutA4Invoice } from "./invoice-layout.js";
import {
  INVOICE_BOX_FILLS,
  INVOICE_INK,
  INVOICE_MUTED,
  INVOICE_PAGE_HEIGHT,
  INVOICE_PAGE_WIDTH,
} from "./invoice-page.js";
import type { ReceiptDocumentInput } from "./receipt-facts.js";

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
  const { default: sharp } = await import("sharp");
  const scale = resolution / 300;
  const width = 2480 * scale;
  const height = 3508 * scale;
  const pages: InvoiceRasterPage[] = [];
  for (const page of layoutA4Invoice(input)) {
    const paths: string[] = [];
    for (const element of page.elements) {
      if (element.kind === "text") {
        const font = element.weight === "bold" ? invoiceBoldFont() : invoiceFont();
        const run = font.layout(element.text);
        const size = element.size / font.unitsPerEm;
        const fill = element.tone === "muted" ? INVOICE_MUTED : INVOICE_INK;
        let x = element.x;
        let y = element.y + font.ascent * size;
        for (let index = 0; index < run.glyphs.length; index++) {
          const position = run.positions[index]!;
          const path = run.glyphs[index]!.path.toSVG();
          paths.push(
            `<path transform="translate(${x + position.xOffset * size} ${y - position.yOffset * size}) scale(${size} ${-size})" d="${path}" fill="${fill}"/>`,
          );
          x += position.xAdvance * size;
          y -= position.yAdvance * size;
        }
      } else if (element.kind === "box") {
        paths.push(
          `<rect shape-rendering="crispEdges" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" fill="${INVOICE_BOX_FILLS[element.fill]}"/>`,
        );
      } else if (element.kind === "logo") {
        const { raster } = element;
        const pitch = element.width / raster.widthDots;
        const stride = Math.ceil(raster.widthDots / 8);
        for (let row = 0; row < raster.heightDots; row++) {
          for (let col = 0; col < raster.widthDots; col++) {
            if (raster.bits[row * stride + (col >> 3)]! & (0x80 >> (col & 7))) {
              paths.push(
                `<rect shape-rendering="crispEdges" x="${element.x + col * pitch}" y="${element.y + row * pitch}" width="${pitch}" height="${pitch}" fill="${INVOICE_INK}"/>`,
              );
            }
          }
        }
      } else if (element.kind === "rule") {
        paths.push(
          `<rect shape-rendering="crispEdges" x="${element.x}" y="${element.y}" width="${element.width}" height="${element.thickness}" fill="${INVOICE_INK}"/>`,
        );
      } else if (element.kind === "qr") {
        const pitch = element.moduleSize;
        for (let row = 0; row < element.modules.length; row++) {
          for (let col = 0; col < element.modules.length; col++) {
            if (element.modules[row]![col]) {
              paths.push(
                `<rect shape-rendering="crispEdges" x="${element.x + col * pitch}" y="${element.y + row * pitch}" width="${pitch}" height="${pitch}" fill="${INVOICE_INK}"/>`,
              );
            }
          }
        }
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${INVOICE_PAGE_WIDTH} ${INVOICE_PAGE_HEIGHT}"><rect width="${INVOICE_PAGE_WIDTH}" height="${INVOICE_PAGE_HEIGHT}" fill="white"/>${paths.join("")}</svg>`;
    const pixels = await sharp(Buffer.from(svg)).greyscale().removeAlpha().raw().toBuffer();
    pages.push({ width, height, resolution, pixels });
  }
  return pages;
}

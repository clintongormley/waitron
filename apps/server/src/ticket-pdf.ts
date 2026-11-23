import { once } from "node:events";
import { crc32, deflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import {
  DOTS_PER_COLUMN,
  dpiValue,
  gridForWidth,
  TEXT_BAND_HEIGHT,
  textGrid,
  type EscSetting,
} from "@waitron/printing";
import { invoiceMonoFontBytes } from "./invoice-font.js";
import { previewPrintJob, type PrintPreviewBlock } from "./print-job-preview.js";

type ImageBlock = Extract<PrintPreviewBlock, { kind: "image" }>;

/** Acrobat's largest page side, in points. */
const MAX_PAGE_POINTS = 14_400;

/** A ticket's decoded lines, checked to draw dot for dot on one page. */
export interface TicketDrawing {
  printer: EscSetting;
  issuedAt: Date;
  widthDots: number;
  margin: number;
  images: ImageBlock[];
  heightDots: number;
}

/**
 * `bytes` decoded for `printer`, or `undefined` when the ticket cannot be drawn whole on one page:
 * the decoder stopped at its limits, or the page would be taller than a PDF page may be. A layout
 * the till never produces throws.
 */
export function ticketDrawing(
  bytes: Uint8Array,
  printer: EscSetting,
  issuedAt: Date,
): TicketDrawing | undefined {
  const { widthDots } = textGrid(printer.paperWidth, printer.resolution);
  const preview = previewPrintJob(bytes, { widthDots });
  if (preview.truncated) return undefined;
  if (preview.unsupported || preview.omittedGraphics) {
    throw new Error("the ticket's commands could not be read whole");
  }
  const images: ImageBlock[] = [];
  for (const block of preview.blocks) {
    if (block.kind !== "image") break;
    if (block.width > widthDots) throw new Error("the ticket draws wider than the print area");
    images.push(block);
  }
  // What follows the lines must be nothing, a cut, or a feed and a cut.
  const after = preview.blocks.slice(images.length).map((block) => block.kind);
  if (after.includes("text")) throw new Error("the ticket sends bytes as text");
  const cut = after[0] === "feed" ? 1 : 0;
  if (after.length > 0 && after[cut] !== "cut") {
    throw new Error("the ticket feeds paper other than before its cut");
  }
  if (after.length > cut + 1) throw new Error("the ticket goes on past its cut");
  if (images.length === 0) throw new Error("the ticket prints nothing");

  const dpi = dpiValue(printer.resolution);
  // Whole-dot margins keep every dot on the dot grid.
  const margin = Math.floor(
    ((Number.parseInt(printer.paperWidth, 10) / 25.4) * dpi - widthDots) / 2,
  );
  const heightDots = 2 * margin + images.reduce((sum, image) => sum + image.height, 0);
  if (heightDots > Math.floor((MAX_PAGE_POINTS * dpi) / 72)) return undefined;
  return { printer, issuedAt, widthDots, margin, images, heightDots };
}

/** A ticket drawn dot for dot on one page the printer's paper wide, dated when it was issued. */
export async function renderTicketPdf(drawing: TicketDrawing): Promise<Buffer> {
  const { printer, issuedAt, widthDots, margin, images, heightDots } = drawing;
  const dot = 72 / dpiValue(printer.resolution);
  const pdf = new PDFDocument({
    autoFirstPage: false,
    // PDFKit accepts font bytes here; its constructor option type names only a path. A fixed-width
    // font puts each hidden character over the grid cell its glyph was printed in.
    font: invoiceMonoFontBytes() as unknown as string,
    info: { CreationDate: issuedAt, ModDate: issuedAt },
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(pdf, "end");
  pdf.addPage({
    size: [(Number.parseInt(printer.paperWidth, 10) * 72) / 25.4, heightDots * dot],
    margin: 0,
  });

  const lefts = images.map((image) =>
    image.align === "center"
      ? Math.floor((widthDots - image.width) / 2)
      : image.align === "right"
        ? widthDots - image.width
        : 0,
  );
  const drawn = heightDots - 2 * margin;
  // One image for the whole print area, so its compression runs across lines.
  pdf.image(pngOf(images, lefts, widthDots, drawn), margin * dot, margin * dot, {
    width: widthDots * dot,
    height: drawn * dot,
  });
  let top = margin;
  images.forEach((image, index) => {
    const text = image.text?.trimStart() ?? "";
    if (text !== "") {
      // The text holds one character a grid cell from the first, trailing blanks dropped.
      const cell = (DOTS_PER_COLUMN * image.height) / TEXT_BAND_HEIGHT;
      const start =
        margin +
        lefts[index]! +
        gridForWidth(image.width).offsetDots +
        (image.text!.length - text.length) * cell;
      pdf.fontSize(image.height * dot);
      const natural = pdf.widthOfString(text);
      pdf
        .fillOpacity(0)
        .text(text, start * dot, top * dot, {
          lineBreak: false,
          horizontalScaling: ([...text].length * cell * dot * 100) / natural,
        } as PDFKit.Mixins.TextOptions)
        .fillOpacity(1);
    }
    top += image.height;
  });
  pdf.end();
  await ended;
  return Buffer.concat(chunks);
}

/**
 * The images stacked top to bottom, each `lefts` dots in, as one greyscale PNG of one bit a dot
 * `widthDots` across, where 0 is black.
 */
function pngOf(images: ImageBlock[], lefts: number[], widthDots: number, height: number): Buffer {
  const stride = Math.ceil(widthDots / 8);
  const ink = Buffer.alloc(stride * height);
  let top = 0;
  images.forEach((image, index) => {
    const data = Buffer.from(image.data, "base64");
    const across = Math.ceil(image.width / 8);
    const first = lefts[index]! >> 3;
    const shift = lefts[index]! & 7;
    for (let row = 0; row < image.height; row++) {
      const at = (top + row) * stride + first;
      for (let byte = 0; byte < across; byte++) {
        const bits = data[row * across + byte]!;
        ink[at + byte] = ink[at + byte]! | (bits >> shift);
        if (shift !== 0) ink[at + byte + 1] = ink[at + byte + 1]! | ((bits << (8 - shift)) & 0xff);
      }
    }
    top += image.height;
  });
  const rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    for (let byte = 0; byte < stride; byte++) {
      rows[row * (stride + 1) + 1 + byte] = ~ink[row * stride + byte]! & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(widthDots, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, body: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const framed = Buffer.alloc(typed.length + 8);
  framed.writeUInt32BE(body.length, 0);
  typed.copy(framed, 4);
  framed.writeUInt32BE(crc32(typed), typed.length + 4);
  return framed;
}

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
import { loadRecoveryPackFonts } from "./invoice-font.js";
import { previewPrintJob, type PrintPreviewBlock } from "./print-job-preview.js";

type ImageBlock = Extract<PrintPreviewBlock, { kind: "image" }>;

let monoFont: Promise<Buffer> | undefined;

/** A ticket's commands drawn dot for dot on one page the printer's paper wide. */
export async function renderTicketPdf(bytes: Uint8Array, printer: EscSetting): Promise<Buffer> {
  const { widthDots } = textGrid(printer.paperWidth, printer.resolution);
  const preview = previewPrintJob(bytes, { widthDots });
  if (preview.unsupported || preview.truncated || preview.omittedGraphics) {
    throw new Error("the ticket's commands could not be read whole");
  }
  const images: ImageBlock[] = [];
  const { blocks } = preview;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (block.kind === "image") {
      if (block.width > widthDots) throw new Error("the ticket draws wider than the print area");
      images.push(block);
    } else if (block.kind === "text") throw new Error("the ticket sends bytes as text");
    else if (block.kind === "feed" && blocks[index + 1]?.kind !== "cut") {
      throw new Error("the ticket feeds paper other than before its cut");
    } else if (block.kind === "cut" && index !== blocks.length - 1) {
      throw new Error("the ticket goes on past its cut");
    }
  }

  const dpi = dpiValue(printer.resolution);
  const dot = 72 / dpi;
  const paperMm = Number.parseInt(printer.paperWidth, 10);
  // Whole-dot margins keep every dot on the dot grid.
  const margin = Math.floor(((paperMm / 25.4) * dpi - widthDots) / 2);
  const drawn = images.reduce((sum, image) => sum + image.height, 0);
  monoFont ??= loadRecoveryPackFonts().then((fonts) => fonts.mono);
  const pdf = new PDFDocument({
    autoFirstPage: false,
    // PDFKit accepts font bytes here; its constructor option type names only a path. A fixed-width
    // font puts each hidden character over the grid cell its glyph was printed in.
    font: (await monoFont) as unknown as string,
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(pdf, "end");
  pdf.addPage({ size: [(paperMm * 72) / 25.4, (2 * margin + drawn) * dot], margin: 0 });

  let top = margin;
  for (const image of images) {
    const left =
      margin +
      (image.align === "center"
        ? Math.floor((widthDots - image.width) / 2)
        : image.align === "right"
          ? widthDots - image.width
          : 0);
    pdf.image(pngOf(image), left * dot, top * dot, {
      width: image.width * dot,
      height: image.height * dot,
    });
    const text = image.text?.trimStart() ?? "";
    if (text !== "") {
      // The text holds one character a grid cell from the first, trailing blanks dropped.
      const cell = (DOTS_PER_COLUMN * image.height) / TEXT_BAND_HEIGHT;
      const start =
        left + gridForWidth(image.width).offsetDots + (image.text!.length - text.length) * cell;
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
  }
  pdf.end();
  await ended;
  return Buffer.concat(chunks);
}

/** One image block as a greyscale PNG of one bit a dot, where 0 is black. */
function pngOf(image: ImageBlock): Buffer {
  const data = Buffer.from(image.data, "base64");
  const stride = Math.ceil(image.width / 8);
  const rows = Buffer.alloc((stride + 1) * image.height);
  for (let row = 0; row < image.height; row++) {
    for (let index = 0; index < stride; index++) {
      rows[row * (stride + 1) + 1 + index] = ~data[row * stride + index]! & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
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

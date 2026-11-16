import { once } from "node:events";
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
    if (block.kind === "image") images.push(block);
    else if (block.kind === "text") throw new Error("the ticket sends bytes as text");
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
    const data = Buffer.from(image.data, "base64");
    const stride = Math.ceil(image.width / 8);
    for (let row = 0; row < image.height; row++) {
      let start = -1;
      for (let col = 0; col <= image.width; col++) {
        const set =
          col < image.width && (data[row * stride + (col >> 3)]! & (0x80 >> (col & 7))) !== 0;
        if (set && start < 0) start = col;
        else if (!set && start >= 0) {
          pdf.rect((left + start) * dot, (top + row) * dot, (col - start) * dot, dot);
          start = -1;
        }
      }
    }
    pdf.fill("black");
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

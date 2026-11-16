import { once } from "node:events";
import PDFDocument from "pdfkit";
import { dpiValue, textGrid, type EscSetting } from "@waitron/printing";
import { invoiceFontBytes } from "./invoice-font.js";
import { previewPrintJob, type PrintPreviewBlock } from "./print-job-preview.js";

type ImageBlock = Extract<PrintPreviewBlock, { kind: "image" }>;

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
  const pdf = new PDFDocument({
    autoFirstPage: false,
    // PDFKit accepts font bytes here; its constructor option type names only a path.
    font: invoiceFontBytes as unknown as string,
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
    if (image.text !== undefined && image.text.trim() !== "") {
      const size = image.height * dot;
      const width = image.width * dot;
      pdf.fontSize(size);
      const natural = pdf.widthOfString(image.text);
      pdf
        .fillOpacity(0)
        .text(image.text, left * dot, top * dot, {
          lineBreak: false,
          horizontalScaling: (width / natural) * 100,
        } as PDFKit.Mixins.TextOptions)
        .fillOpacity(1);
    }
    top += image.height;
  }
  pdf.end();
  await ended;
  return Buffer.concat(chunks);
}

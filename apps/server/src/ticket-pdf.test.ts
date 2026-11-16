import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { dpiValue, esc, SETTING_WIDTHS, type EscSetting, type MonoRaster } from "@waitron/printing";
import { previewPrintJob } from "./print-job-preview.js";
import { formatReceipt } from "./receipt-ticket.js";
import { sampleDocument } from "./sample-receipt.js";
import { printedLines } from "./testing/decode-ticket.js";
import { renderTicketPdf } from "./ticket-pdf.js";

const QR_TEXT = { caption: "QR tributario:", legend: "VERI*FACTU" };
const PRINTER_80: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };
const PRINTER_58: EscSetting = { paperWidth: "58mm", resolution: "203dpi" };

/** A checked 96 × 40 picture, so a misplaced run of dots shows. */
const LOGO: MonoRaster = {
  widthDots: 96,
  heightDots: 40,
  bits: Uint8Array.from({ length: 12 * 40 }, (_, index) =>
    Math.floor(index / 12) % 2 === 0 ? 0xf0 : 0x0f,
  ),
};

function ticket(printer: EscSetting): Uint8Array {
  return formatReceipt({ ...sampleDocument(QR_TEXT, "es-ES"), printer, logo: LOGO });
}

function widthDotsOf(printer: EscSetting): number {
  return SETTING_WIDTHS.find(
    (each) => each.paperWidth === printer.paperWidth && each.resolution === printer.resolution,
  )!.widthDots;
}

/** The page drawn at one pixel per printer dot. */
function collapsed(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

async function read(pdf: Buffer, printer: EscSetting) {
  const loading = getDocument({ data: Uint8Array.from(pdf), useSystemFonts: false });
  const document = await loading.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: dpiValue(printer.resolution) / 72 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
      .promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const size = page.getViewport({ scale: 1 });
    return {
      pages: document.numPages,
      width: size.width,
      height: size.height,
      // pdfjs splits a line at its runs of spaces; the pieces of one line share a baseline.
      lines: content.items
        .reduce<{ y: number; text: string }[]>((lines, item) => {
          if (!("str" in item)) return lines;
          const y = item.transform[5] as number;
          if (lines.at(-1)?.y === y) lines.at(-1)!.text += item.str;
          else lines.push({ y, text: item.str });
          return lines;
        }, [])
        .map((line) => collapsed(line.text))
        .filter((line) => line !== ""),
      dark: (x: number, y: number) => pixels.data[(y * pixels.width + x) * 4]! < 128,
      qr: jsQR(pixels.data, canvas.width, canvas.height),
    };
  } finally {
    await loading.destroy();
  }
}

describe("renderTicketPdf", () => {
  it.each([
    [PRINTER_80, 226.77],
    [PRINTER_58, 164.41],
  ])(
    "draws one page as wide as the paper, holding every printed line in order",
    async (printer, width) => {
      const bytes = ticket(printer);
      const page = await read(await renderTicketPdf(bytes, printer), printer);
      expect(page.pages).toBe(1);
      expect(page.width).toBeCloseTo(width, 2);
      const printed = printedLines(bytes)
        .map(collapsed)
        .filter((line) => line !== "");
      expect(printed.length).toBeGreaterThan(10);
      expect(page.lines).toEqual(printed);
    },
  );

  it.each([PRINTER_80, PRINTER_58])(
    "puts a line's dots where the print area centred on the paper puts them, and a QR that reads",
    async (printer) => {
      const bytes = ticket(printer);
      const widthDots = widthDotsOf(printer);
      const page = await read(await renderTicketPdf(bytes, printer), printer);
      const paperDots =
        (Number.parseInt(printer.paperWidth, 10) / 25.4) * dpiValue(printer.resolution);
      const margin = Math.floor((paperDots - widthDots) / 2);

      const images = previewPrintJob(bytes, { widthDots }).blocks.flatMap((block) =>
        block.kind === "image" ? [block] : [],
      );
      const chosen = images.map((image) => Boolean(image.text?.trim())).lastIndexOf(true);
      const line = images[chosen]!;
      expect(line.width).toBe(widthDots);
      const top = margin + images.slice(0, chosen).reduce((sum, image) => sum + image.height, 0);
      const data = Buffer.from(line.data, "base64");
      const stride = Math.ceil(line.width / 8);
      let set = 0;
      for (let row = 0; row < line.height; row++) {
        for (let col = 0; col < line.width; col++) {
          const dot = (data[row * stride + (col >> 3)]! & (0x80 >> (col & 7))) !== 0;
          if (dot) set++;
          expect(page.dark(margin + col, top + row), `dot ${col},${row}`).toBe(dot);
        }
      }
      expect(set).toBeGreaterThan(100);

      const drawn = images.reduce((sum, image) => sum + image.height, 0);
      expect(page.height).toBeCloseTo(
        ((2 * margin + drawn) * 72) / dpiValue(printer.resolution),
        2,
      );
      expect(page.qr?.data).toBe(sampleDocument(QR_TEXT, "es-ES").result.qr);
    },
  );

  it("refuses bytes the preview cannot read whole", async () => {
    const whole = ticket(PRINTER_80);
    expect(previewPrintJob(whole.subarray(0, whole.length - 100)).truncated).toBe(true);
    await expect(
      renderTicketPdf(whole.subarray(0, whole.length - 100), PRINTER_80),
    ).rejects.toThrow();
    const unknown = Uint8Array.from([...whole, 0x1b, 0x21, 0x00]);
    expect(previewPrintJob(unknown).unsupported).toBe(true);
    await expect(renderTicketPdf(unknown, PRINTER_80)).rejects.toThrow();
    const tooWide = Uint8Array.from([0x1d, 0x76, 0x30, 0, 1, 1, 1, 0, ...new Uint8Array(257)]);
    expect(previewPrintJob(tooWide).omittedGraphics).toBe(true);
    await expect(renderTicketPdf(tooWide, PRINTER_80)).rejects.toThrow();
  });

  it("refuses bytes sent as text and a feed that is not straight before the cut", async () => {
    await expect(
      renderTicketPdf(esc(PRINTER_80).init().line("A").bytes(), PRINTER_80),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(renderTicketPdf(Uint8Array.from([0x41, 0x0a]), PRINTER_80)).rejects.toThrow();
    await expect(
      renderTicketPdf(esc(PRINTER_80).init().line("A").feed(2).line("B").cut().bytes(), PRINTER_80),
    ).rejects.toThrow();
    await expect(
      renderTicketPdf(esc(PRINTER_80).init().line("A").feedAndCut().bytes(), PRINTER_80),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

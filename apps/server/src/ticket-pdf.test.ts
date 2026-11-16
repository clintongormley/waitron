import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  DOTS_PER_COLUMN,
  dpiValue,
  esc,
  TEXT_BAND_HEIGHT,
  textGrid,
  type EscSetting,
  type MonoRaster,
} from "@waitron/printing";
import { previewPrintJob, type PrintPreviewBlock } from "./print-job-preview.js";
import { formatReceipt } from "./receipt-ticket.js";
import { sampleDocument } from "./sample-receipt.js";
import { printedLines } from "./testing/decode-ticket.js";
import { renderTicketPdf, ticketDrawing } from "./ticket-pdf.js";

const QR_TEXT = { caption: "QR tributario:", legend: "VERI*FACTU" };
const PRINTER_80: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };
const PRINTER_58: EscSetting = { paperWidth: "58mm", resolution: "203dpi" };
const ISSUED_AT = new Date("2026-08-17T22:34:00Z");

async function renderTicket(bytes: Uint8Array, printer: EscSetting): Promise<Buffer> {
  const drawing = ticketDrawing(bytes, printer, ISSUED_AT);
  expect(drawing).toBeDefined();
  return renderTicketPdf(drawing!);
}

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
  return textGrid(printer.paperWidth, printer.resolution).widthDots;
}

/** The whole dots between the paper's edge and the centred print area. */
function marginOf(printer: EscSetting): number {
  const paperDots = (Number.parseInt(printer.paperWidth, 10) / 25.4) * dpiValue(printer.resolution);
  return Math.floor((paperDots - widthDotsOf(printer)) / 2);
}

type ImageBlock = Extract<PrintPreviewBlock, { kind: "image" }>;

function collapsed(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function imagesOf(bytes: Uint8Array, widthDots: number): ImageBlock[] {
  return previewPrintJob(bytes, { widthDots }).blocks.flatMap((block) =>
    block.kind === "image" ? [block] : [],
  );
}

function isSet(image: ImageBlock, data: Buffer, col: number, row: number): boolean {
  return (data[row * Math.ceil(image.width / 8) + (col >> 3)]! & (0x80 >> (col & 7))) !== 0;
}

/** The page drawn at one pixel per printer dot, with its text pieces placed in printer dots. */
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
    const { fnArray } = await page.getOperatorList();
    const size = page.getViewport({ scale: 1 });
    const scale = dpiValue(printer.resolution) / 72;
    const pieces = content.items.flatMap((item) =>
      "str" in item && item.str.trim() !== ""
        ? [
            {
              y: item.transform[5] as number,
              start: (item.transform[4] as number) * scale,
              end: ((item.transform[4] as number) + item.width) * scale,
            },
          ]
        : [],
    );
    return {
      pieces,
      pages: document.numPages,
      operators: fnArray,
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

/**
 * Expects the page dark exactly where `image` prints, its top-left dot at (`left`, `top`) and one
 * dot round it pale, and returns how many dots it prints.
 */
function sameDots(
  page: { dark: (x: number, y: number) => boolean },
  image: ImageBlock,
  left: number,
  top: number,
): number {
  const data = Buffer.from(image.data, "base64");
  let set = 0;
  for (let row = 0; row < image.height; row++) {
    for (let col = -1; col <= image.width; col++) {
      const dot = col >= 0 && col < image.width && isSet(image, data, col, row);
      if (dot) set++;
      expect(page.dark(left + col, top + row), `dot ${col},${row}`).toBe(dot);
    }
  }
  return set;
}

describe("ticketDrawing and renderTicketPdf", () => {
  it.each([
    [PRINTER_80, 226.77],
    [PRINTER_58, 164.41],
  ])(
    "draws one page as wide as the paper, holding every printed line in order",
    async (printer, width) => {
      const bytes = ticket(printer);
      const page = await read(await renderTicket(bytes, printer), printer);
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
      const page = await read(await renderTicket(bytes, printer), printer);
      const margin = marginOf(printer);

      const images = imagesOf(bytes, widthDots);
      const topOf = (index: number) =>
        margin + images.slice(0, index).reduce((sum, image) => sum + image.height, 0);
      const line = images.map((image) => Boolean(image.text?.trim())).lastIndexOf(true);
      expect(images[line]!.width).toBe(widthDots);
      expect(sameDots(page, images[line]!, margin, topOf(line))).toBeGreaterThan(100);
      const logo = images.findIndex((image) => image.width === LOGO.widthDots);
      expect(images[logo]!.align).toBe("center");
      const logoLeft = margin + Math.floor((widthDots - LOGO.widthDots) / 2);
      expect(sameDots(page, images[logo]!, logoLeft, topOf(logo))).toBeGreaterThan(100);

      const drawn = images.reduce((sum, image) => sum + image.height, 0);
      expect(page.height).toBeCloseTo(
        ((2 * margin + drawn) * 72) / dpiValue(printer.resolution),
        2,
      );
      expect(page.qr?.data).toBe(sampleDocument(QR_TEXT, "es-ES").result.qr);
    },
  );

  it.each([PRINTER_80, PRINTER_58])(
    "lays each line's searchable text over that line's ink, within a character",
    async (printer) => {
      const bytes = ticket(printer);
      const widthDots = widthDotsOf(printer);
      const page = await read(await renderTicket(bytes, printer), printer);
      const margin = marginOf(printer);
      const lines = imagesOf(bytes, widthDots).filter((image) => image.text?.trim());
      expect(lines.map((line) => line.text)).toContain("PRUEBA - SIN COBRO REAL");
      const ys = [...new Set(page.pieces.map((piece) => piece.y))];
      expect(ys).toHaveLength(lines.length);
      ys.forEach((y, index) => {
        const line = lines[index]!;
        const data = Buffer.from(line.data, "base64");
        const cell = (DOTS_PER_COLUMN * line.height) / TEXT_BAND_HEIGHT;
        const inked = (from: number, to: number) => {
          for (
            let col = Math.max(0, from - margin);
            col < Math.min(line.width, to - margin);
            col++
          ) {
            for (let row = 0; row < line.height; row++) {
              if (isSet(line, data, col, row)) return true;
            }
          }
          return false;
        };
        // A piece starts and ends on a character's cell, with a blank cell either side of it.
        for (const piece of page.pieces.filter((each) => each.y === y)) {
          const start = Math.round(piece.start);
          const end = Math.round(piece.end);
          const where = `${line.text} ${start}-${end}`;
          expect(inked(start, start + cell), where).toBe(true);
          expect(inked(start - cell, start), where).toBe(false);
          expect(inked(end - cell, end), where).toBe(true);
          expect(inked(end, end + cell), where).toBe(false);
        }
      });
    },
  );

  it("puts a right-aligned picture's dots against the print area's right edge", async () => {
    const bytes = esc(PRINTER_80).init().align("right").bitmap(LOGO).cut().bytes();
    const widthDots = widthDotsOf(PRINTER_80);
    const page = await read(await renderTicket(bytes, PRINTER_80), PRINTER_80);
    const margin = marginOf(PRINTER_80);
    const [logo] = imagesOf(bytes, widthDots);
    expect(logo!.align).toBe("right");
    expect(sameDots(page, logo!, margin + widthDots - LOGO.widthDots, margin)).toBeGreaterThan(100);
  });

  it("puts a centred picture's dots where they print when it starts mid-byte", async () => {
    const odd: MonoRaster = {
      widthDots: 104,
      heightDots: 40,
      bits: Uint8Array.from({ length: 13 * 40 }, (_, index) => (index * 37) & 0xff),
    };
    const bytes = esc(PRINTER_80).init().align("center").bitmap(odd).cut().bytes();
    const widthDots = widthDotsOf(PRINTER_80);
    const page = await read(await renderTicket(bytes, PRINTER_80), PRINTER_80);
    const margin = marginOf(PRINTER_80);
    const [picture] = imagesOf(bytes, widthDots);
    const offset = Math.floor((widthDots - odd.widthDots) / 2);
    expect(offset % 8).not.toBe(0);
    expect(sameDots(page, picture!, margin + offset, margin)).toBeGreaterThan(1_000);
  });

  it("paints every picture the ticket prints as one image, and no shapes", async () => {
    const bytes = ticket(PRINTER_80);
    const { operators } = await read(await renderTicket(bytes, PRINTER_80), PRINTER_80);
    expect(imagesOf(bytes, widthDotsOf(PRINTER_80)).length).toBeGreaterThan(10);
    expect(operators.filter((op) => op === OPS.paintImageXObject)).toHaveLength(1);
    expect(operators).not.toContain(OPS.constructPath);
  });

  it("refuses a ticket laid out wider than the printer's print area", async () => {
    await expect(renderTicket(ticket(PRINTER_80), PRINTER_58)).rejects.toThrow(
      "wider than the print area",
    );
  });

  it("refuses a ticket that prints nothing", async () => {
    await expect(renderTicket(esc(PRINTER_80).init().cut().bytes(), PRINTER_80)).rejects.toThrow(
      "prints nothing",
    );
  });

  it("answers none for bytes the preview cut short, and refuses bytes it could not read", async () => {
    const whole = ticket(PRINTER_80);
    expect(previewPrintJob(whole.subarray(0, whole.length - 100)).truncated).toBe(true);
    expect(ticketDrawing(whole.subarray(0, whole.length - 100), PRINTER_80, ISSUED_AT)).toBe(
      undefined,
    );
    const unknown = Uint8Array.from([...whole, 0x1b, 0x21, 0x00]);
    expect(previewPrintJob(unknown).unsupported).toBe(true);
    await expect(renderTicket(unknown, PRINTER_80)).rejects.toThrow("could not be read whole");
    const tooWide = Uint8Array.from([0x1d, 0x76, 0x30, 0, 1, 1, 1, 0, ...new Uint8Array(257)]);
    expect(previewPrintJob(tooWide).omittedGraphics).toBe(true);
    await expect(renderTicket(tooWide, PRINTER_80)).rejects.toThrow("could not be read whole");
  });

  it("refuses bytes sent as text, a feed that is not straight before the cut, and a line after it", async () => {
    await expect(
      renderTicket(esc(PRINTER_80).init().line("A").bytes(), PRINTER_80),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(renderTicket(Uint8Array.from([0x41, 0x0a]), PRINTER_80)).rejects.toThrow(
      "sends bytes as text",
    );
    await expect(
      renderTicket(esc(PRINTER_80).init().line("A").feed(2).line("B").cut().bytes(), PRINTER_80),
    ).rejects.toThrow("feeds paper other than before its cut");
    await expect(
      renderTicket(esc(PRINTER_80).init().line("A").feedAndCut().bytes(), PRINTER_80),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      renderTicket(esc(PRINTER_80).init().line("A").cut().line("B").bytes(), PRINTER_80),
    ).rejects.toThrow("past its cut");
  });

  it("dates the document when the sale was issued", async () => {
    const loading = getDocument({
      data: Uint8Array.from(await renderTicket(ticket(PRINTER_80), PRINTER_80)),
      useSystemFonts: false,
    });
    try {
      const { info } = await (await loading.promise).getMetadata();
      expect((info as { CreationDate: string; ModDate: string }).CreationDate).toBe(
        "D:20260817223400Z",
      );
      expect((info as { CreationDate: string; ModDate: string }).ModDate).toBe("D:20260817223400Z");
    } finally {
      await loading.destroy();
    }
  });

  it.each([PRINTER_80, PRINTER_58])(
    "draws a page up to 14,400 points tall, its margins counted, and answers none past it",
    async (printer) => {
      const dpi = dpiValue(printer.resolution);
      const margin = marginOf(printer);
      const tallest = (14_400 * dpi) / 72 - 2 * margin;
      expect(Number.isInteger(tallest)).toBe(true);
      // The preview reads a picture at most 2,048 dots high, so the strip is drawn in pieces.
      const strip = (heightDots: number) => {
        const builder = esc(printer).init();
        for (let left = heightDots; left > 0; left -= 2_000) {
          const height = Math.min(left, 2_000);
          builder.bitmap({ widthDots: 8, heightDots: height, bits: new Uint8Array(height) });
        }
        return builder.cut().bytes();
      };
      const loading = getDocument({
        data: Uint8Array.from(await renderTicket(strip(tallest), printer)),
        useSystemFonts: false,
      });
      try {
        const page = await (await loading.promise).getPage(1);
        expect(page.view[3]).toBeCloseTo(14_400, 2);
      } finally {
        await loading.destroy();
      }
      expect(ticketDrawing(strip(tallest + 1), printer, ISSUED_AT)).toBe(undefined);
    },
  );
});

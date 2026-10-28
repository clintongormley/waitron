import { describe, expect, it } from "vitest";
import { textGrid, type EscSetting, type MonoRaster } from "@waitron/printing";
import { previewPrintJob, type PrintPreviewBlock } from "./print-job-preview.js";
import { drawReceipt, type FormatReceiptInput } from "./receipt-ticket.js";
import {
  previewMarks,
  type BlockRange,
  type ReceiptPreviewResponse,
} from "./receipt-preview-api.js";
import { sampleSale } from "./sample-receipt.js";

type Marks = ReceiptPreviewResponse["marks"];

/**
 * The marks as the preview found them by drawing the receipt again without each part and
 * comparing the two drawings, the way `previewMarks` must still place them.
 */
function marksByRedrawing(input: FormatReceiptInput): Marks {
  const { widthDots } = textGrid(input.printer.paperWidth, input.printer.resolution);
  const drawn = drawReceipt(input);
  const preview = previewPrintJob(drawn.bytes, { widthDots });
  const imageBlocks = preview.blocks.flatMap((block, index) =>
    block.kind === "image" ? [index] : [],
  );
  const rules = new Set(drawn.rules.map((picture) => imageBlocks[picture]!));
  const same = (a: PrintPreviewBlock | undefined, b: PrintPreviewBlock | undefined) =>
    JSON.stringify(a) === JSON.stringify(b);
  const added = (changes: Partial<FormatReceiptInput>): BlockRange => {
    const without = previewPrintJob(drawReceipt({ ...input, ...changes }).bytes, {
      widthDots,
    }).blocks;
    const withField = preview.blocks;
    let start = 0;
    while (start < without.length && same(without[start], withField[start])) start++;
    let tail = 0;
    while (
      tail < without.length - start &&
      tail < withField.length - start &&
      same(without.at(-1 - tail), withField.at(-1 - tail))
    )
      tail++;
    let end = withField.length - tail;
    while (start < end && rules.has(start)) start++;
    while (end > start && rules.has(end - 1)) end--;
    return { start, end };
  };
  const trim = (field: "headerSubtitle" | "footerMessage" | "phone" | "email") =>
    input.receipt[field] ? added({ receipt: { ...input.receipt, [field]: undefined } }) : null;
  return {
    headerSubtitle: trim("headerSubtitle"),
    footerMessage: trim("footerMessage"),
    phone: trim("phone"),
    email: trim("email"),
    address: input.venueAddress?.length ? added({ venueAddress: [] }) : null,
    logo: input.logo ? added({ logo: null }) : null,
  };
}

function marksFromOneDrawing(input: FormatReceiptInput): Marks {
  const { widthDots } = textGrid(input.printer.paperWidth, input.printer.resolution);
  const drawn = drawReceipt(input);
  return previewMarks(previewPrintJob(drawn.bytes, { widthDots }), drawn);
}

function raster(widthDots: number, heightDots: number): MonoRaster {
  const bits = new Uint8Array(Math.ceil(widthDots / 8) * heightDots);
  for (let i = 0; i < bits.length; i++) bits[i] = (i * 37) & 0xff;
  return { widthDots, heightDots, bits };
}

const ISSUER = { venueName: "Deli Test SL", nif: "B12345678" };
const PRINTERS: EscSetting[] = [
  { paperWidth: "80mm", resolution: "180dpi" },
  { paperWidth: "58mm", resolution: "203dpi" },
];
const ADDRESS = ["Calle Mayor 1", "28013 Madrid"];
const ALL = {
  headerSubtitle: "Desde 1990",
  footerMessage: "Gracias por su visita",
  phone: "910 000 000",
  email: "hola@deli.test",
};
const TRIMS: [string, FormatReceiptInput["receipt"]][] = [
  ["every part", ALL],
  ["none", {}],
  ["a header subtitle alone", { headerSubtitle: ALL.headerSubtitle }],
  ["a footer alone", { footerMessage: ALL.footerMessage }],
  ["a phone alone", { phone: ALL.phone }],
  ["an email alone", { email: ALL.email }],
  [
    "a subtitle and footer that wrap",
    {
      ...ALL,
      headerSubtitle: "Cocina de mercado desde mil novecientos noventa en el barrio de siempre",
      footerMessage: "Gracias por su visita, vuelva pronto y pregunte por el menú del día",
    },
  ],
  ["dashes", { ...ALL, headerSubtitle: "---", footerMessage: "-----" }],
  ["a footer as wide as the 58 mm rule", { ...ALL, footerMessage: "-".repeat(32) }],
  ["a footer as wide as the 80 mm rule", { ...ALL, footerMessage: "-".repeat(42) }],
  ["a subtitle that reads as the venue's name", { ...ALL, headerSubtitle: ISSUER.venueName }],
  ["a phone and email that read the same", { ...ALL, email: `Tel. ${ALL.phone}` }],
];
const LOGOS: [string, MonoRaster | null][] = [
  ["no logo", null],
  ["a small logo", raster(16, 4)],
  ["a wide logo", raster(384, 40)],
];

const QR_TEXT = { caption: "Factura verificable", legend: "VERI*FACTU" };

function receiptInput(options: {
  printer?: EscSetting;
  logo?: MonoRaster | null;
  simulated?: boolean;
  qr?: boolean;
  tradingName?: boolean;
  address?: boolean;
  receipt: FormatReceiptInput["receipt"];
}): FormatReceiptInput {
  return {
    result: sampleSale(options.qr === false ? undefined : QR_TEXT, "es-ES"),
    issuer: ISSUER,
    receiptHeader: { tradingName: "Deli", printTradingName: options.tradingName !== false },
    invoiceLocale: "es-ES",
    printer: options.printer ?? PRINTERS[0]!,
    logo: options.logo === undefined ? raster(16, 4) : options.logo,
    simulated: options.simulated !== false,
    venueAddress: options.address === false ? [] : ADDRESS,
    receipt: options.receipt,
  };
}

describe("previewMarks from one drawing", () => {
  it.each(
    TRIMS.flatMap(([trimName, receipt]) =>
      PRINTERS.flatMap((printer) =>
        [false, true].map((simulated) => ({
          name: `${trimName}, ${printer.paperWidth}, ${simulated ? "practice" : "real"}`,
          input: receiptInput({ printer, simulated, receipt }),
        })),
      ),
    ),
  )("places every mark where redrawing did: $name", ({ input }) => {
    expect(marksFromOneDrawing(input)).toEqual(marksByRedrawing(input));
  });

  it.each(
    LOGOS.flatMap(([logoName, logo]) =>
      [false, true].flatMap((simulated) =>
        [false, true].flatMap((qr) =>
          [false, true].flatMap((tradingName) =>
            [false, true].map((address) => ({
              name: `${logoName}, ${simulated ? "practice" : "real"}, ${qr ? "QR" : "no QR"}, ${tradingName ? "trading name" : "no trading name"}, ${address ? "address" : "no address"}`,
              options: { logo, simulated, qr, tradingName, address },
            })),
          ),
        ),
      ),
    ),
  )("places every mark where redrawing did around the top block: $name", ({ options }) => {
    for (const receipt of [ALL, {}]) {
      const input = receiptInput({ ...options, receipt });
      expect(marksFromOneDrawing(input)).toEqual(marksByRedrawing(input));
    }
  });

  it.each(PRINTERS)(
    "places an address mark where redrawing did when its lines draw as the rule below: $paperWidth",
    (printer) => {
      const dashes = "-".repeat(textGrid(printer.paperWidth, printer.resolution).columns);
      for (const venueAddress of [[dashes], ["Calle Mayor 1", dashes], [dashes, dashes]]) {
        const input = { ...receiptInput({ printer, receipt: {} }), venueAddress };
        expect(marksFromOneDrawing(input)).toEqual(marksByRedrawing(input));
      }
    },
  );
});

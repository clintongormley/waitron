// Writes PNG pictures of real receipts for a person to look at, never run by CI.
// Run: pnpm --filter @waitron/server exec tsx scripts/receipt-look.ts <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escPosCommands } from "@waitron/printing/src/testing/escpos-commands.js";
import type { EscSetting } from "@waitron/printing";
import { formatReceipt } from "../src/receipt-ticket.js";
import { renderInvoiceRaster } from "../src/invoice-raster.js";
import { renderInvoicePdf } from "../src/invoice-pdf.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "../src/testing/full-invoice-fixture.js";
import type { ReceiptDocumentInput } from "../src/receipt-document.js";

const { default: sharp } = await import("sharp"); // as invoice-raster.ts:16 loads it
const out = process.argv[2] ?? "/tmp/a663-look";
mkdirSync(out, { recursive: true });

const PRINTERS: Record<string, EscSetting> = {
  "58mm-203": { paperWidth: "58mm", resolution: "203dpi" },
  "80mm-180": { paperWidth: "80mm", resolution: "180dpi" },
};

async function ticketPng(bytes: Uint8Array, file: string): Promise<void> {
  const images = escPosCommands(bytes)
    .filter((c) => c.name === "GS v 0")
    .map((c) => ({
      width: c.widthDots!,
      height: c.heightDots!,
      bits: bytes.subarray(c.offset + 8, c.offset + c.length),
    }));
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((sum, i) => sum + i.height, 0);
  const pixels = Buffer.alloc(width * height, 255);
  let top = 0;
  for (const image of images) {
    const stride = image.width / 8;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        if (image.bits[y * stride + (x >> 3)]! & (0x80 >> (x & 7)))
          pixels[(top + y) * width + x] = 0;
    top += image.height;
  }
  await sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(join(out, file));
}

const line = (quantity: string, name: string, gross: string, unit = "ud") => ({
  descriptions: { "es-ES": name },
  unitName: { es: unit },
  quantity,
  gross,
});

// The sale in 1-simplified-receipt.png: seven lines, one rate, cash.
const MOCKUP: ReceiptDocumentInput = {
  result: {
    locale: "es-ES",
    orderLabel: "Mesa 12",
    orderNumber: 112,
    invoiceNumber: "T-2026/000112",
    issuedAt: "2026-10-13T14:53:00.000Z",
    total: "407.00",
    vatBreakdown: [{ rate: "10.00", base: "370.00", tax: "37.00" }],
    lines: [
      line("1", "Bloody Mary", "15.00"),
      line("4", "Agua, pan y aceite", "24.00"),
      line("4", "Menú degustación", "320.00"),
      line("4", "Copa de tinto", "28.00"),
      line("1", "Copa de blanco", "8.00"),
      line("1", "Café doble", "4.00"),
      line("1", "Orujo blanco", "8.00"),
    ],
    tender: { method: "cash", change: "13.00" },
    qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B00000000&numserie=T-2026%2F000112&fecha=13-10-2026&importe=407.00",
    qrText: { caption: "QR tributario:", legend: "VERI*FACTU" },
  },
  issuer: { venueName: "SANTET DELI CO S.L.", nif: "B00000000" },
  receiptHeader: { tradingName: "Santet Deli Co", printTradingName: true },
  receipt: { footerMessage: "¡Gracias por su visita!" },
  venueAddress: ["Avinguda d'Icària 215, Bajos", "08005 Barcelona"],
  invoiceLocale: "es-ES",
};

// A filed full invoice reads its rates in two-decimal form (Task 1.3), so the sample does too.
const FULL = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
FULL.result.lines[0]!.net!.rate = "21.00";
FULL.result.lines[1]!.net!.rate = "10.00";
FULL.result.vatBreakdown = [
  { rate: "21.00", base: "9.00", tax: "1.89" },
  { rate: "10.00", base: "8.00", tax: "0.80" },
];
for (const filed of FULL.result.lines) filed.unitName = { es: "ud" };

const SAMPLES: Record<string, ReceiptDocumentInput> = {
  "simplified-one-rate": MOCKUP,
  "simplified-two-rates": {
    ...MOCKUP,
    result: {
      ...MOCKUP.result,
      total: "83.10",
      vatBreakdown: [
        { rate: "10.00", base: "51.82", tax: "5.18" },
        { rate: "21.00", base: "21.57", tax: "4.53" },
      ],
      lines: [
        line("1", "Bloody Mary", "15.00"),
        line("0.35", "Jamón ibérico", "42.00", "kg"),
        line("2", "Refresco para llevar", "26.10"),
      ],
      tender: { method: "cash", change: "6.90" },
    },
  },
  "simplified-big-total": {
    ...MOCKUP,
    result: {
      ...MOCKUP.result,
      total: "12345.67",
      vatBreakdown: [{ rate: "10.00", base: "11223.34", tax: "1122.33" }],
      lines: [line("1", "Banquete de boda", "12345.67")],
      tender: { method: "cash", change: "0.00" },
    },
  },
  "full-invoice": { ...FULL, surface: "thermal" },
};

for (const [name, input] of Object.entries(SAMPLES))
  for (const [paper, printer] of Object.entries(PRINTERS))
    await ticketPng(formatReceipt({ ...input, printer }), `${name}-${paper}.png`);

const pages = await renderInvoiceRaster(FULL, 300);
for (const [index, page] of pages.entries())
  await sharp(page.pixels, { raw: { width: page.width, height: page.height, channels: 1 } })
    .png()
    .toFile(join(out, `full-invoice-a4-page${index + 1}.png`));
writeFileSync(join(out, "full-invoice-a4.pdf"), await renderInvoicePdf(FULL));

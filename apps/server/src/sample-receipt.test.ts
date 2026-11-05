import { receiptLabelsFor, receiptSampleItemsFor } from "@waitron/country-packs";
import { prepareText } from "@waitron/printing";
import { describe, expect, it } from "vitest";
import { formatSampleReceipt, sampleSale, sampleDocument } from "./sample-receipt.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

const WORDS = { caption: "CAP-X", legend: "LEG-Y" };

describe("formatSampleReceipt", () => {
  it.each(["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB"])(
    "A965 sample language keeps %s sample and document inputs together",
    (locale) => {
      const sale = sampleSale(WORDS, locale);
      const document = sampleDocument(WORDS, locale);
      const labels = receiptLabelsFor(locale);
      expect(sale.locale).toBe(locale);
      expect(document.invoiceLocale).toBe(locale);
      const dishes = receiptSampleItemsFor(locale);
      const { lines, total, vatBreakdown, tender } = document.result;
      expect({ ...document.result, lines: sale.lines, total: sale.total }).toEqual({
        ...sale,
        vatBreakdown,
        tender,
      });
      expect(lines).toEqual([
        ...sale.lines,
        ...dishes.map((name) => ({
          descriptions: { [locale]: name },
          quantity: "1",
          gross: "2.20",
        })),
      ]);
      if (dishes.length === 0) expect(document.result).toEqual(sale);
      else expect(total).not.toBe(sale.total);
      expect(sale.lines[0]!.descriptions).toEqual({ [locale]: labels.sampleItemName });
      expect(sale.orderLabel).toBe(labels.sampleTableLabel);
      expect(sale.invoiceNumber).toBe(labels.sampleInvoiceNumber);
      expect(document.issuer.venueName).toBe(labels.sampleIssuerName);
      expect(document.receipt.footerMessage).toBeUndefined();
      expect(sale.qr).toBe("https://example.invalid/waitron/sample-receipt");
      expect(sale.qrText).toEqual(WORDS);
      const text = printedLines(
        formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, WORDS, locale),
      ).join("\n");
      expect(text).toContain(labels.sampleIssuerName);
      expect(text).toContain(labels.practice);
      expect(text).toContain(labels.cash);
      expect(text).toContain(labels.sampleItemName);
    },
  );

  it.each([
    ["80mm", 369, 47],
    ["58mm", 328, 41],
  ] as const)(
    "prints the largest fitting sample QR on %s paper at 203 dpi",
    (paperWidth, height, stride) => {
      const bytes = formatSampleReceipt({ paperWidth, resolution: "203dpi" }, WORDS, "es-ES");
      const qr = printedCommands(bytes).find((c) => c.name === "GS v 0" && c.text === undefined);
      expect(qr).toBeDefined();
      expect(qr!.widthDots).toBe(stride * 8);
      expect(qr!.heightDots).toBe(height);
    },
  );

  it("draws at the selected setting and prints an unmistakably simulated realistic receipt", () => {
    const bytes = formatSampleReceipt(
      { paperWidth: "80mm", resolution: "203dpi" },
      undefined,
      "es-ES",
    );
    const commands = printedCommands(bytes);
    expect(commands.map((c) => c.name)).not.toContain("ESC t");
    expect(commands.map((c) => c.name)).not.toContain("FS .");
    const lines = commands.filter((c) => c.text !== undefined);
    for (const line of lines) expect(line.widthDots).toBe(576);
    const text = printedLines(bytes).join("\n");
    expect(text.match(/PRUEBA - SIN COBRO REAL/g)).toHaveLength(2);
    expect(text).toContain("Café y tostada");
    expect(text).toContain("16,50 €");
    expect(text).toContain("MUESTRA/1");
    expect(text).not.toContain("pingüino");
  });

  it.each(["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB"])(
    "draws every sample dish of %s without changing a letter",
    (locale) => {
      const names = receiptSampleItemsFor(locale);
      for (const name of names) expect(prepareText(name), name).toBe(name.normalize("NFC"));
      const wide = printedLines(
        formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, WORDS, locale),
      ).join("\n");
      for (const name of names) expect(wide, name).toContain(name);
      expect(wide).not.toContain("pingüino");
      const narrow = printedLines(
        formatSampleReceipt({ paperWidth: "58mm", resolution: "203dpi" }, WORDS, locale),
      )
        .join(" ")
        .replace(/ +/g, " ");
      for (const name of names) expect(narrow, name).toContain(name);
    },
  );

  it("totals the five Spanish sample dishes with the first dish, and gives change from 20", () => {
    const lines = printedLines(
      formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, undefined, "es-ES"),
    );
    expect(receiptSampleItemsFor("es-ES")).toHaveLength(5);
    for (const pattern of [
      /^TOTAL +16,50 €$/,
      /^Base imponible 10% +15,00 €$/,
      /^IVA 10% +1,50 €$/,
      /^Efectivo +20,00 €$/,
      /^Cambio +3,50 €$/,
    ])
      expect(
        lines.some((line) => pattern.test(line.trim())),
        String(pattern),
      ).toBe(true);
  });

  it.each(["58mm", "80mm"] as const)(
    "rules off TOTAL from the VAT lines on %s paper, as a real simplified receipt does",
    (paperWidth) => {
      const lines = printedLines(
        formatSampleReceipt({ paperWidth, resolution: "203dpi" }, WORDS, "es-ES"),
      );
      const totalAt = lines.findIndex((line) => line.trim().startsWith("TOTAL"));
      const taxAt = lines.findIndex((line) => line.startsWith("Base imponible"));
      expect(totalAt).toBeGreaterThan(0);
      expect(lines[taxAt - 1]).toMatch(/^-+$/);
      expect(lines[taxAt - 1]!.length).toBe(lines[taxAt]!.length);
      expect(lines.slice(totalAt, taxAt - 1).every((line) => /TOTAL|€/.test(line))).toBe(true);
      expect(taxAt - 1 - totalAt).toBeLessThanOrEqual(2);
    },
  );

  it("puts the fiscal backend's words around the sample QR", () => {
    const bytes = formatSampleReceipt({ paperWidth: "80mm", resolution: "203dpi" }, WORDS, "es-ES");
    const drawn = printedCommands(bytes)
      .filter((c) => c.name === "GS v 0")
      .map((c) => (c.text === undefined ? "<QR>" : c.text.trim()));
    const qrAt = drawn.indexOf("<QR>");
    expect(drawn.slice(qrAt - 1, qrAt + 2)).toEqual(["CAP-X", "<QR>", "LEG-Y"]);
  });

  it("prints no QR, caption or legend for a venue whose fiscal backend gives no words", () => {
    const bytes = formatSampleReceipt(
      { paperWidth: "80mm", resolution: "203dpi" },
      undefined,
      "es-ES",
    );
    const commands = printedCommands(bytes);
    expect(commands.filter((c) => c.name === "GS v 0" && c.text === undefined)).toEqual([]);
    const text = printedLines(bytes).join("\n");
    expect(text).not.toContain("VERI*FACTU");
    expect(text).not.toContain("QR tributario");
    expect(text).toContain("MUESTRA/1");
  });
});

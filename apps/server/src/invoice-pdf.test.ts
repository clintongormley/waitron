import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

async function rendered(input: ReceiptDocumentInput = fixture) {
  const { renderInvoicePdf } = await import("./invoice-pdf.js");
  const bytes = await renderInvoicePdf(input);
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      pages.push({
        text,
        viewport,
        qr: jsQR(pixels.data, canvas.width, canvas.height),
        content,
        pixels,
      });
    }
    return { bytes, pages, metadata: await pdf.getMetadata() };
  } finally {
    await loading.destroy();
  }
}

describe("A4 invoice PDF", () => {
  it("carries the saved identity, dates, discounted amounts and cent-exact VAT summary", async () => {
    const { pages, metadata } = await rendered();
    expect((metadata.info as { CreationDate: string; ModDate: string }).CreationDate).toBe(
      "D:20260817223400Z",
    );
    expect((metadata.info as { CreationDate: string; ModDate: string }).ModDate).toBe(
      "D:20260817223400Z",
    );
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.viewport.width / 2).toBeCloseTo(595.28, 2);
    expect(page.viewport.height / 2).toBeCloseTo(841.89, 2);
    for (const text of [
      "Charcutería La Buena SL",
      "B12345678",
      "Calle del domicilio fiscal original número 27, edificio de la plaza mayor, segunda planta, Madrid 28001",
      "Cliente de nombre largo y completo Sociedad Limitada",
      "B11223344",
      "Avenida del cliente original número 123, edificio de la estación, tercera planta, Madrid 28002",
      "Factura FF/1",
      "Fecha 18 ago 2026, 0:34",
      "Fecha de operación 17 ago 2026",
      "Menú del día con un nombre especialmente largo",
      "Precio sin IVA 10,00 € / 1",
      "Descuento 10% (IVA incluido) -1,21 €",
      "Base 21% 9,00 € IVA 21% 1,89 € Base 10% 8,00 € IVA 10% 0,80 €",
      "TOTAL 19,69 €",
      "Efectivo 20,00 €",
      "Cambio 0,31 €",
    ])
      expect(page.text).toContain(text);
    expect(page.text).not.toContain("Current mutable");
    expect(page.text).not.toContain("DUPLICADO");
    expect(page.text).not.toContain("PRUEBA - SIN COBRO REAL");
    expect((await rendered()).bytes).toEqual((await rendered()).bytes);
  });

  it("draws a centred 35 mm filed QR on the first page with its body-size legend", async () => {
    const { pages } = await rendered();
    const page = pages[0]!;
    expect(page.qr?.data).toBe(fixture.result.qr);
    const qr = page.qr!;
    // jsQR's corners bound the modules; the 35mm square also includes four white modules per side.
    const modules = qr.version * 4 + 17;
    const dark = (row: number, col: number): boolean => {
      const x = Math.floor(
        qr.location.topLeftCorner.x +
          ((col + 0.5) * (qr.location.topRightCorner.x - qr.location.topLeftCorner.x)) / modules,
      );
      const y = Math.floor(
        qr.location.topLeftCorner.y +
          ((row + 0.5) * (qr.location.bottomLeftCorner.y - qr.location.topLeftCorner.y)) / modules,
      );
      return page.pixels.data[(y * page.pixels.width + x) * 4]! < 128;
    };
    let format = 0;
    for (let bit = 0; bit < 15; bit++) {
      const row = bit < 6 ? bit : bit < 8 ? bit + 1 : modules - 15 + bit;
      if (dark(row, 8)) format |= 1 << bit;
    }
    expect((format ^ 0b101010000010010) >> 13, "drawn QR correction level M").toBe(0);

    const moduleWidth = (qr.location.topRightCorner.x - qr.location.topLeftCorner.x) / modules;
    expect((moduleWidth * (modules + 8)) / 2).toBeCloseTo((35 * 72) / 25.4, 0);
    expect((qr.location.topLeftCorner.x + qr.location.topRightCorner.x) / 2).toBeCloseTo(
      page.viewport.width / 2,
      0,
    );
    const legend = page.content.items.find((item) => "str" in item && item.str === "VERI*FACTU");
    expect(legend).toBeDefined();
    expect("height" in legend! ? legend.height : undefined).toBeCloseTo(10, 1);
  });

  it("wraps long unbroken names, paginates without clipping and never repeats the QR", async () => {
    const marker = "ABCDEFGHIJ".repeat(25);
    const input = {
      ...fixture,
      result: {
        ...fixture.result,
        lines: Array.from({ length: 35 }, (_, index) => ({
          ...fixture.result.lines[0]!,
          descriptions: { "es-ES": `Dish ${index} ${marker}` },
        })),
      },
    };
    const { pages } = await rendered(input);
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.map((page) => page.text).join(" ");
    expect(text).toContain("Dish 34");
    expect(text).toContain("Cambio 0,31 €");
    expect(text.replace(/\s/g, "").split(marker)).toHaveLength(36);
    expect(pages.filter((page) => page.qr !== null)).toHaveLength(1);
    expect(pages[0]!.qr?.data).toBe(fixture.result.qr);
    for (const page of pages) {
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(35);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(561);
        expect(item.transform[5]).toBeGreaterThan(35);
        expect(item.transform[5] + item.height).toBeLessThan(807);
      }
    }
  });

  it("keeps an unbroken customer name and ignores a whitespace-only optional subtitle", async () => {
    const name = "ABCDEFGHIJ".repeat(90);
    const input = {
      ...fixture,
      receipt: { ...fixture.receipt, headerSubtitle: " " },
      result: { ...fixture.result, recipient: { ...fixture.result.recipient!, legalName: name } },
    };
    const { pages, bytes } = await rendered(input);
    expect(
      pages
        .map((page) => page.text)
        .join("")
        .replace(/\s/g, ""),
    ).toContain(name);
    expect(bytes).toEqual(
      (await rendered({ ...input, receipt: { ...input.receipt, headerSubtitle: "" } })).bytes,
    );
    for (const page of pages)
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(561);
      }
  });

  it("marks a practice duplicate and omits a QR when the stored invoice has none", async () => {
    const { pages } = await rendered({
      ...fixture,
      duplicate: true,
      simulated: true,
      result: { ...fixture.result, qr: "" },
    });
    expect(pages[0]!.text).toContain("DUPLICADO");
    expect(pages[0]!.text).toContain("PRUEBA - SIN COBRO REAL");
    expect(pages[0]!.text).not.toContain("VERI*FACTU");
    expect(pages[0]!.qr).toBeNull();
  });
});

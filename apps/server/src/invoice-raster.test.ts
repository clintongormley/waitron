import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";

describe("invoice glyph-outline raster", () => {
  it.each([
    { resolution: 300 as const, width: 2480, height: 3508, qrDots: 413 },
    { resolution: 600 as const, width: 4960, height: 7016, qrDots: 827 },
  ])(
    "draws one grey A4 page and a decoded 35mm QR at $resolution dpi",
    async ({ resolution, width, height, qrDots }) => {
      const { renderInvoiceRaster } = await import("./invoice-raster.js");
      const pages = await renderInvoiceRaster(fixture, resolution);
      expect(pages).toHaveLength(1);
      const page = pages[0]!;
      expect(page.width).toBe(width);
      expect(page.height).toBe(height);
      expect(page.resolution).toBe(resolution);
      expect(page.pixels).toHaveLength(width * height);
      let ink = 0;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let pixel = 0; pixel < page.pixels.length; pixel++) {
        if (page.pixels[pixel]! < 128) ink++;
        rgba.set([page.pixels[pixel]!, page.pixels[pixel]!, page.pixels[pixel]!, 255], pixel * 4);
      }
      expect(ink / (width * height)).toBeGreaterThan(0.005);
      expect(ink / (width * height)).toBeLessThan(0.15);
      const qr = jsQR(rgba, width, height)!;
      expect(qr?.data).toBe(fixture.result.qr);
      const modules = qr.version * 4 + 17;
      const pitch = (qr.location.topRightCorner.x - qr.location.topLeftCorner.x) / modules;
      expect(Math.round(pitch * (modules + 8))).toBeCloseTo(qrDots, -1);
    },
  );

  it("places legible outlined text at the PDF's positions, including the wrapped address", async () => {
    const { renderInvoiceRaster } = await import("./invoice-raster.js");
    const [raster] = await renderInvoiceRaster(fixture, 300);
    const loading = getDocument({
      data: Uint8Array.from(await renderInvoicePdf(fixture)),
      useSystemFonts: false,
    });
    const pdf = await loading.promise;
    try {
      const page = await pdf.getPage(1);
      const canvas = createCanvas(2480, 3508);
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as never,
        canvasContext: context as never,
        viewport: page.getViewport({ scale: 2480 / 595.28 }),
      }).promise;
      const reference = context.getImageData(0, 0, 2480, 3508).data;
      let ink = 0;
      let matched = 0;
      // The header QR ends above row 650. Compare text only, allowing antialiasing within two dots.
      for (let y = 650; y < 3506; y++) {
        for (let x = 2; x < 2478; x++) {
          if (reference[(y * 2480 + x) * 4]! >= 128) continue;
          ink++;
          let present = false;
          for (let dy = -2; dy <= 2 && !present; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (raster!.pixels[(y + dy) * 2480 + x + dx]! < 128) {
                present = true;
                break;
              }
            }
          }
          if (present) matched++;
        }
      }
      expect(ink).toBeGreaterThan(20000);
      expect(matched / ink).toBeGreaterThan(0.99);
    } finally {
      await loading.destroy();
    }
  });
});

describe("department A4 office raster", () => {
  it.each([300, 600] as const)(
    "draws the same centered proportional logo at %s dpi",
    async (resolution) => {
      const { renderInvoiceRaster } = await import("./invoice-raster.js");
      const [page] = await renderInvoiceRaster(
        {
          ...fixture,
          logo: { widthDots: 80, heightDots: 40, bits: new Uint8Array(400).fill(255) },
          result: { ...fixture.result, qr: "" },
        },
        resolution,
      );
      const scale = resolution / 300;
      let ink = 0;
      for (let y = 215 * scale; y < 260 * scale; y++)
        for (let x = 1190 * scale; x < 1290 * scale; x++)
          if (page!.pixels[y * page!.width + x]! < 128) ink++;
      expect(ink).toBe(4500 * scale * scale);
      expect(page!.pixels[215 * scale * page!.width + 1150 * scale]).toBe(255);
      expect(page!.pixels[215 * scale * page!.width + 1330 * scale]).toBe(255);
    },
  );
});

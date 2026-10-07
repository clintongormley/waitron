import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { rasterReferencePages } from "./testing/raster-reference-pages.js";

describe("invoice printer raster encoders", () => {
  it.each([
    { format: "pwg" as const, resolution: 300 as const },
    { format: "apple" as const, resolution: 300 as const },
    { format: "pwg" as const, resolution: 600 as const },
    { format: "apple" as const, resolution: 600 as const },
  ])(
    "matches independent CUPS two-page $format output at $resolution dpi",
    async ({ format, resolution }) => {
      const { encodeInvoiceRaster } = await import("./invoice-raster-encode.js");
      const reference = gunzipSync(
        readFileSync(
          new URL(`./testing/raster-reference/${format}-${resolution}.gz`, import.meta.url),
        ),
      );
      const actual = encodeInvoiceRaster(rasterReferencePages(resolution), format);
      expect(actual.equals(reference)).toBe(true);
    },
  );
  it.each([
    { name: "no pages", change: "empty" },
    { name: "wrong page width", change: "width" },
    { name: "wrong page height", change: "height" },
    { name: "unsupported resolution", change: "resolution" },
    { name: "short pixel data", change: "pixels" },
    { name: "extra pixel data", change: "extra" },
  ])("refuses $name instead of emitting an unreadable document", async ({ change }) => {
    const { encodeInvoiceRaster } = await import("./invoice-raster-encode.js");
    const [page] = rasterReferencePages(300);
    const invalid = { ...page! };
    if (change === "width") {
      invalid.width--;
      invalid.pixels = Buffer.alloc(invalid.width * invalid.height, 255);
    }
    if (change === "height") {
      invalid.height++;
      invalid.pixels = Buffer.alloc(invalid.width * invalid.height, 255);
    }
    if (change === "resolution") {
      invalid.resolution = 150 as 300;
      invalid.width = 1240;
      invalid.height = 1754;
      invalid.pixels = Buffer.alloc(invalid.width * invalid.height, 255);
    }
    if (change === "pixels") invalid.pixels = invalid.pixels.subarray(1);
    if (change === "extra") invalid.pixels = Buffer.concat([invalid.pixels, Buffer.from([0])]);
    expect(() => encodeInvoiceRaster(change === "empty" ? [] : [invalid], "pwg")).toThrow(
      RangeError,
    );
    expect(() => encodeInvoiceRaster(change === "empty" ? [] : [invalid], "apple")).toThrow(
      RangeError,
    );
  });
});

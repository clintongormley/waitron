import { describe, expect, it, vi } from "vitest";
import { decodeLogoGreyscale } from "@waitron/media";
import { sampleImage } from "@waitron/media/testing/sample-image.js";
import { LOGO_MAX_HEIGHT_DOTS, type MonoRaster } from "@waitron/printing";
import { createLogoCache, drawLogoRasters, drawPreviewLogo } from "./receipt-logo.js";

vi.mock("@waitron/media", async (importOriginal) => {
  const media = await importOriginal<typeof import("@waitron/media")>();
  return { ...media, decodeLogoGreyscale: vi.fn(media.decodeLogoGreyscale) };
});

const FILE_A = `${"a".repeat(64)}.png`;
const FILE_B = `${"b".repeat(64)}.png`;

/** An image the library still holds, read by `bytes`. */
function held(bytes: () => Promise<Uint8Array | null>) {
  return { exists: async () => true, bytes };
}

function raster(widthDots: number): MonoRaster {
  return { widthDots, heightDots: 1, bits: new Uint8Array(Math.ceil(widthDots / 8)) };
}

describe("drawLogoRasters", () => {
  it("draws one raster per paper, each inside that paper's safe width and the logo height", async () => {
    const bytes = await sampleImage({ width: 300, height: 30, format: "png" });
    const rasters = await drawLogoRasters(bytes);
    expect(Object.keys(rasters).sort()).toEqual(["58mm", "80mm"]);
    expect([rasters["58mm"].widthDots, rasters["58mm"].heightDots]).toEqual([360, 36]);
    expect([rasters["80mm"].widthDots, rasters["80mm"].heightDots]).toEqual([504, 50]);
    for (const { widthDots, heightDots, data } of Object.values(rasters)) {
      expect(heightDots).toBeLessThanOrEqual(LOGO_MAX_HEIGHT_DOTS);
      expect(Buffer.from(data, "base64")).toHaveLength(Math.ceil(widthDots / 8) * heightDots);
    }
  });

  it("decodes once when the height binds on both papers, and both papers print that picture", async () => {
    const bytes = await sampleImage({ width: 40, height: 40, format: "png" });
    vi.mocked(decodeLogoGreyscale).mockClear();
    const rasters = await drawLogoRasters(bytes);
    expect(decodeLogoGreyscale).toHaveBeenCalledTimes(1);
    expect(rasters["58mm"]).toEqual(rasters["80mm"]);
    expect([rasters["58mm"].widthDots, rasters["58mm"].heightDots]).toEqual([160, 160]);
  });

  it("decodes again for 58 mm when the 80 mm picture is wider than 58 mm's safe width", async () => {
    const bytes = await sampleImage({ width: 400, height: 160, format: "png" });
    vi.mocked(decodeLogoGreyscale).mockClear();
    const rasters = await drawLogoRasters(bytes);
    expect(decodeLogoGreyscale).toHaveBeenCalledTimes(2);
    expect([rasters["80mm"].widthDots, rasters["80mm"].heightDots]).toEqual([400, 160]);
    expect([rasters["58mm"].widthDots, rasters["58mm"].heightDots]).toEqual([360, 144]);
  });

  it("refuses bytes that are not an image with media's image.invalid_file", async () => {
    await expect(drawLogoRasters(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "image.invalid_file",
    });
  });
});

describe("drawPreviewLogo", () => {
  it("draws the logo for the paper, and draws a file once however often it is asked for", async () => {
    const bytes = await sampleImage({ width: 40, height: 40, format: "png" });
    const cache = createLogoCache();
    const read = vi.fn(async () => bytes);
    const first = await drawPreviewLogo(cache, FILE_A, "58mm", held(read));
    expect([first?.widthDots, first?.heightDots]).toEqual([160, 160]);
    expect(await drawPreviewLogo(cache, FILE_A, "58mm", held(read))).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("gives no logo once the image is deleted, though it drew and kept it before", async () => {
    const bytes = await sampleImage({ width: 40, height: 40, format: "png" });
    const cache = createLogoCache();
    const read = vi.fn(async () => bytes);
    expect(await drawPreviewLogo(cache, FILE_A, "58mm", held(read))).not.toBeNull();
    const gone = { exists: vi.fn(async () => false), bytes: read };
    expect(await drawPreviewLogo(cache, FILE_A, "58mm", gone)).toBeNull();
    expect(gone.exists).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("gives no logo, and no error, for a missing image or one that will not decode", async () => {
    const cache = createLogoCache();
    expect(
      await drawPreviewLogo(
        cache,
        FILE_A,
        "80mm",
        held(async () => null),
      ),
    ).toBeNull();
    expect(
      await drawPreviewLogo(
        cache,
        FILE_B,
        "80mm",
        held(async () => new Uint8Array([1, 2, 3])),
      ),
    ).toBeNull();
  });

  it("passes on any other failure", async () => {
    const cache = createLogoCache();
    await expect(
      drawPreviewLogo(
        cache,
        FILE_A,
        "80mm",
        held(async () => {
          throw new Error("database closed");
        }),
      ),
    ).rejects.toThrow("database closed");
    vi.mocked(decodeLogoGreyscale).mockRejectedValueOnce(new Error("sharp did not load"));
    const bytes = await sampleImage({ width: 40, height: 40, format: "png" });
    await expect(
      drawPreviewLogo(
        cache,
        FILE_A,
        "80mm",
        held(async () => bytes),
      ),
    ).rejects.toThrow("sharp did not load");
  });
});

describe("createLogoCache", () => {
  it("keeps one entry per file and paper", () => {
    const cache = createLogoCache();
    cache.set(FILE_A, "58mm", raster(8));
    cache.set(FILE_A, "80mm", raster(16));
    expect(cache.get(FILE_A, "58mm")?.widthDots).toBe(8);
    expect(cache.get(FILE_A, "80mm")?.widthDots).toBe(16);
    expect(cache.get(FILE_B, "58mm")).toBeUndefined();
  });

  it("forgets the entry used longest ago once it holds more than its limit", () => {
    const cache = createLogoCache(2);
    cache.set(FILE_A, "58mm", raster(8));
    cache.set(FILE_A, "80mm", raster(16));
    expect(cache.get(FILE_A, "58mm")).toBeDefined();
    cache.set(FILE_B, "58mm", raster(24));
    expect(cache.get(FILE_A, "80mm")).toBeUndefined();
    expect(cache.get(FILE_A, "58mm")?.widthDots).toBe(8);
    expect(cache.get(FILE_B, "58mm")?.widthDots).toBe(24);
  });
});

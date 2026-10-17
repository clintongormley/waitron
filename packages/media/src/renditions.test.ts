import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DEFAULT_FRAMING } from "./framing.js";
import { prepareImage } from "./prepare.js";
import { renderRendition } from "./renditions.js";

async function markedImage(width: number, height: number): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour =
        x < width / 3
          ? [240, 20, 20]
          : x >= (width * 2) / 3
            ? [20, 20, 240]
            : y < height / 3
              ? [240, 240, 20]
              : y >= (height * 2) / 3
                ? [240, 20, 240]
                : [20, 220, 20];
      data.set(colour, (y * width + x) * 3);
    }
  }
  return new Uint8Array(
    await sharp(data, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

async function centrePixel(bytes: Uint8Array): Promise<number[]> {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const start =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [...data.subarray(start, start + 3)];
}

describe("framed image renditions", () => {
  it.each([
    { shape: "square", want: [480, 480] },
    { shape: "till", want: [480, 360] },
    { shape: "display", want: [1600, 1000] },
  ] as const)(
    "bounds the $shape response and retains the central dish",
    async ({ shape, want }) => {
      const bytes = await renderRendition(await markedImage(1600, 1000), shape, DEFAULT_FRAMING);
      const metadata = await sharp(bytes).metadata();
      expect([metadata.width, metadata.height]).toEqual(want);
      expect(metadata.format).toBe("webp");
      const [r, g, b] = await centrePixel(bytes);
      expect(g).toBeGreaterThan(180);
      expect(r).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    },
  );

  it.each([
    { x: 0, y: 0, channel: 0, other: 2 },
    { x: 10000, y: 10000, channel: 2, other: 0 },
  ])("zooms onto the selected edge at $x/$y", async ({ x, y, channel, other }) => {
    const bytes = await renderRendition(await markedImage(1200, 800), "square", {
      x,
      y,
      zoom: 400,
    });
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 200, height: 200 });
    const pixel = await centrePixel(bytes);
    expect(pixel[channel]).toBeGreaterThan(190);
    expect(pixel[other]).toBeLessThan(60);
    expect(pixel[1]).toBeLessThan(60);
  });

  it("moves to the bottom of a portrait rather than cropping its centre", async () => {
    const bytes = await renderRendition(await markedImage(600, 900), "till", {
      x: 5000,
      y: 10000,
      zoom: 200,
    });
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 300, height: 225 });
    const [r, g, b] = await centrePixel(bytes);
    expect(r).toBeGreaterThan(190);
    expect(b).toBeGreaterThan(190);
    expect(g).toBeLessThan(60);
  });

  it.each([
    { width: 1, height: 1, shape: "till", zoom: 400, want: [1, 1] },
    { width: 7, height: 11, shape: "square", zoom: 400, want: [3, 3] },
    { width: 11, height: 7, shape: "till", zoom: 400, want: [3, 3] },
    { width: 10, height: 6, shape: "display", zoom: 100, want: [10, 6] },
  ] as const)(
    "does not enlarge a tiny $width × $height $shape crop",
    async ({ width, height, shape, zoom, want }) => {
      const bytes = await renderRendition(await markedImage(width, height), shape, {
        x: 5000,
        y: 5000,
        zoom,
      });
      const metadata = await sharp(bytes).metadata();
      expect([metadata.width, metadata.height]).toEqual(want);
      expect(await sharp(bytes).stats()).toMatchObject({ isOpaque: true });
    },
  );

  it("uses the upright coordinates of a prepared phone photo", async () => {
    const sideways = await sharp(await markedImage(800, 600))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const prepared = await prepareImage(new Uint8Array(sideways), { maxUploadBytes: 1000000 });
    expect(await sharp(prepared.bytes).metadata()).toMatchObject({ width: 600, height: 800 });
    const output = await renderRendition(prepared.bytes, "square", { x: 5000, y: 0, zoom: 400 });
    const [r, g, b] = await centrePixel(output);
    expect(r).toBeGreaterThan(190);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it("preserves transparency and removes metadata", async () => {
    const input = await sharp({
      create: {
        width: 20,
        height: 10,
        channels: 4,
        background: { r: 20, g: 200, b: 20, alpha: 0.5 },
      },
    })
      .withMetadata()
      .png()
      .toBuffer();
    const bytes = await renderRendition(input, "display", DEFAULT_FRAMING);
    const metadata = await sharp(bytes).metadata();
    expect([metadata.width, metadata.height, metadata.hasAlpha]).toEqual([20, 10, true]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBeGreaterThanOrEqual(127);
    expect(data[3]).toBeLessThanOrEqual(128);
  });

  it("returns reproducible bytes for a recipe", async () => {
    const input = await markedImage(123, 77);
    const first = await renderRendition(input, "till", { x: 1234, y: 8765, zoom: 237 });
    expect(await renderRendition(input, "till", { x: 1234, y: 8765, zoom: 237 })).toEqual(first);
  });

  it("refuses undecodable bytes as an image refusal", async () => {
    await expect(
      renderRendition(new Uint8Array([1, 2, 3]), "square", DEFAULT_FRAMING),
    ).rejects.toMatchObject({ code: "image.invalid_file" });
  });
});

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_INPUT_PIXELS } from "./load-sharp.js";
import { decodeLogoGreyscale } from "./logo.js";
import { sampleImage } from "./testing/sample-image.js";

async function transparentPng(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("decodeLogoGreyscale", () => {
  it.each([
    [360, 160],
    [504, 160],
  ])(
    "fits a wide and a tall image inside %i × %i, keeping their proportions",
    async (maxWidth, maxHeight) => {
      const wide = await decodeLogoGreyscale(
        await sampleImage({ width: 300, height: 20, format: "png" }),
        maxWidth,
        maxHeight,
      );
      expect(wide.width).toBe(maxWidth);
      expect(wide.height).toBe(Math.round((maxWidth * 20) / 300));
      expect(wide.pixels).toHaveLength(wide.width * wide.height);

      const tall = await decodeLogoGreyscale(
        await sampleImage({ width: 20, height: 300, format: "webp" }),
        maxWidth,
        maxHeight,
      );
      expect(tall.height).toBe(maxHeight);
      expect(tall.width).toBe(Math.round((maxHeight * 20) / 300));
      expect(tall.pixels).toHaveLength(tall.width * tall.height);
    },
  );

  it("enlarges a small image to fill the box", async () => {
    const small = await decodeLogoGreyscale(
      await sampleImage({ width: 30, height: 10, format: "jpeg" }),
      360,
      160,
    );
    expect([small.width, small.height]).toEqual([360, 120]);
  });

  it("returns one grey byte per pixel: a coloured image turns grey, neither black nor white", async () => {
    const logo = await decodeLogoGreyscale(
      await sampleImage({ width: 8, height: 8, format: "png" }),
      8,
      8,
    );
    expect(new Set(logo.pixels).size).toBe(1);
    expect(logo.pixels[0]).toBeGreaterThan(0);
    expect(logo.pixels[0]).toBeLessThan(255);
  });

  it("flattens a transparent image onto white", async () => {
    const logo = await decodeLogoGreyscale(await transparentPng(40, 20), 360, 160);
    expect(logo.pixels.length).toBeGreaterThan(0);
    expect(logo.pixels.every((value) => value === 255)).toBe(true);
  });

  it("turns a sideways phone photo upright before fitting it", async () => {
    // Stored 300 × 100; EXIF orientation 6 shows it turned a quarter, 100 × 300.
    const sideways = await sharp({
      create: { width: 300, height: 100, channels: 3, background: "tan" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);
    const logo = await decodeLogoGreyscale(new Uint8Array(sideways), 504, 160);
    expect([logo.width, logo.height]).toEqual([53, 160]);
  });

  it("refuses a picture of more pixels than the library accepts, as image.invalid_file", async () => {
    // 100,010,000 pixels: over MAX_INPUT_PIXELS and under sharp's own default ceiling.
    const bomb = await sharp({
      create: { width: 10_001, height: 10_000, channels: 3, background: "white" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(10_001 * 10_000).toBeGreaterThan(MAX_INPUT_PIXELS);
    await expect(decodeLogoGreyscale(new Uint8Array(bomb), 504, 160)).rejects.toMatchObject({
      code: "image.invalid_file",
    });
  });

  it("refuses bytes that are not an image it can decode as image.invalid_file", async () => {
    await expect(decodeLogoGreyscale(Uint8Array.of(1, 2, 3), 360, 160)).rejects.toMatchObject({
      code: "image.invalid_file",
    });
  });
});

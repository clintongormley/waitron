import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_INPUT_PIXELS, prepareImage, STORED_LONG_EDGE } from "./prepare.js";
import { sampleImage } from "./testing/sample-image.js";

/** The upload limit `MAX_UPLOAD_BYTES` sets (Reconciliation O8). */
const UPLOAD_LIMIT = 20 * 1024 * 1024;

/** A photo-like JPEG: noise compresses about as badly as a real dish photographed close up. */
async function noisyPhoto(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      // sharp's type requires a background; beside `noise` it is never read (its `dist/input.mjs`).
      background: "black",
      noise: { type: "gaussian", mean: 128, sigma: 30 },
    },
  })
    .jpeg({ quality: 50 })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("prepareImage", () => {
  it("shrinks a large photo to the stored long edge as WebP, keeping its shape", async () => {
    const input = await noisyPhoto(4000, 2500);
    const prepared = await prepareImage(input, { maxUploadBytes: UPLOAD_LIMIT });
    const stored = await sharp(prepared.bytes).metadata();
    expect(STORED_LONG_EDGE).toBe(1600);
    expect({ format: stored.format, width: stored.width, height: stored.height }).toEqual({
      format: "webp",
      width: 1600,
      height: 1000,
    });
    expect(prepared.bytes.length).toBeLessThan(512 * 1024);
    expect(prepared.bytes.length).toBeLessThan(input.length / 3);
    expect(prepared.filename).toBe(
      `${createHash("sha256").update(prepared.bytes).digest("hex")}.webp`,
    );
  });

  it("turns a sideways phone photo upright and drops its location and every other tag", async () => {
    const sideways = await sharp({
      create: { width: 3200, height: 2400, channels: 3, background: "tan" },
    })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 25/1 0/1" } })
      .jpeg()
      .toBuffer();
    // The control: the fixture really carries what this case says is removed. 0x8825 is the EXIF
    // tag that points at the GPS block, searched for in either byte order.
    const before = await sharp(sideways).metadata();
    expect(before.orientation).toBe(6);
    expect(
      before.exif!.includes(Buffer.from([0x88, 0x25])) ||
        before.exif!.includes(Buffer.from([0x25, 0x88])),
    ).toBe(true);

    const prepared = await prepareImage(new Uint8Array(sideways), { maxUploadBytes: UPLOAD_LIMIT });
    const after = await sharp(prepared.bytes).metadata();
    expect([after.width, after.height]).toEqual([1200, 1600]);
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
  });

  it("never enlarges a photo already inside the limit", async () => {
    const small = await sharp({
      create: { width: 300, height: 225, channels: 3, background: "tan" },
    })
      .jpeg()
      .toBuffer();
    const prepared = await prepareImage(new Uint8Array(small), { maxUploadBytes: UPLOAD_LIMIT });
    const stored = await sharp(prepared.bytes).metadata();
    expect([stored.width, stored.height]).toEqual([300, 225]);
  });

  it("keeps transparency", async () => {
    const logo = await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 4,
        background: { r: 200, g: 30, b: 30, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const prepared = await prepareImage(new Uint8Array(logo), { maxUploadBytes: UPLOAD_LIMIT });
    const stored = await sharp(prepared.bytes).metadata();
    expect([stored.width, stored.height, stored.hasAlpha]).toEqual([1600, 800, true]);
  });

  it("stores the same bytes for the same upload, so a repeat upload finds the first", async () => {
    const input = await noisyPhoto(2000, 1500);
    const first = await prepareImage(input, { maxUploadBytes: UPLOAD_LIMIT });
    const again = await prepareImage(input, { maxUploadBytes: UPLOAD_LIMIT });
    expect(again.filename).toBe(first.filename);
    expect(again.bytes).toEqual(first.bytes);
  });

  it("refuses a file over the upload limit before reading it", async () => {
    await expect(prepareImage(new Uint8Array(101), { maxUploadBytes: 100 })).rejects.toMatchObject({
      code: "image.too_large",
      params: { maxBytes: 100 },
    });
  });

  it("refuses bytes that are not a JPEG, PNG or WebP", async () => {
    await expect(
      prepareImage(new Uint8Array([1, 2, 3]), { maxUploadBytes: UPLOAD_LIMIT }),
    ).rejects.toMatchObject({ code: "media.unsupported_type" });
  });

  it("refuses a picture whose header is damaged", async () => {
    await expect(
      prepareImage(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { maxUploadBytes: UPLOAD_LIMIT }),
    ).rejects.toMatchObject({ code: "image.invalid_file", params: {} });
  });

  it("refuses a picture cut short after a readable header", async () => {
    const whole = await noisyPhoto(800, 600);
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    // The control: the header still reads, so this reaches the decoder rather than the header check.
    await expect(sharp(cut).metadata()).resolves.toMatchObject({ width: 800, height: 600 });
    await expect(prepareImage(cut, { maxUploadBytes: UPLOAD_LIMIT })).rejects.toMatchObject({
      code: "image.invalid_file",
    });
  });

  it("refuses a picture declaring more pixels than the limit, from its header", async () => {
    // 311 KB on disk, 100,010,000 pixels declared.
    const bomb = await sharp({
      create: { width: 10_001, height: 10_000, channels: 3, background: "white" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(
      prepareImage(new Uint8Array(bomb), { maxUploadBytes: UPLOAD_LIMIT }),
    ).rejects.toMatchObject({
      code: "image.too_many_pixels",
      params: { maxPixels: MAX_INPUT_PIXELS },
    });
  });

  it("stores a small PNG and a small WebP as WebP too", async () => {
    for (const format of ["png", "webp"] as const) {
      const prepared = await prepareImage(await sampleImage({ width: 8, height: 6, format }), {
        maxUploadBytes: 1000,
      });
      expect(prepared.filename).toMatch(/^[0-9a-f]{64}\.webp$/);
    }
  });
});

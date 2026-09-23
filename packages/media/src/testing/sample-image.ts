import sharp from "sharp";

/**
 * A small solid-colour picture that sharp can decode, for tests that upload.
 *
 * Within ONE format, two different widths always store as two different photos. This was measured
 * for widths 8 to 307 at height 6 in each format. A JPEG and a PNG of the same width store as the
 * SAME photo, because a solid colour decodes identically from both, so a suite needing distinct
 * photos varies the width, not the format.
 */
export async function sampleImage(options: {
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp";
}): Promise<Uint8Array> {
  const image = sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  });
  return new Uint8Array(await image.toFormat(options.format).toBuffer());
}

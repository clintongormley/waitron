import sharp from "sharp";
import { DEFAULT_MAX_UPLOAD_BYTES, prepareImage, type PreparedImage } from "../prepare.js";

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
}): Promise<Uint8Array<ArrayBuffer>> {
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

/** {@link sampleImage} made ready to store by `prepareImage`: 6 pixels high and a JPEG unless named. */
export async function samplePreparedImage(options: {
  width: number;
  height?: number;
  format?: "jpeg" | "png" | "webp";
}): Promise<PreparedImage> {
  const bytes = await sampleImage({
    width: options.width,
    height: options.height ?? 6,
    format: options.format ?? "jpeg",
  });
  return prepareImage(bytes, { maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES });
}

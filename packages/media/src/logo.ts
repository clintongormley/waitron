import { AppError } from "@waitron/shared";
import { DECODE_OPTIONS, loadSharp } from "./load-sharp.js";
import "./errors.js";

/** An 8-bit greyscale picture, one byte per pixel row by row, 0 black and 255 white. */
export interface GreyscaleImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/**
 * A library image as a receipt logo: transparency flattened onto white, scaled up or down to fit
 * inside `maxWidth` × `maxHeight` keeping its proportions, in greyscale. Call it OUTSIDE any
 * transaction, as `prepareImage` explains.
 */
export async function decodeLogoGreyscale(
  bytes: Uint8Array,
  maxWidth: number,
  maxHeight: number,
): Promise<GreyscaleImage> {
  const sharp = await loadSharp();
  try {
    const { data, info } = await sharp(bytes, DECODE_OPTIONS)
      .flatten({ background: "#ffffff" })
      .resize(maxWidth, maxHeight, { fit: "inside" })
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, pixels: new Uint8Array(data) };
  } catch {
    throw new AppError("image.invalid_file", {});
  }
}

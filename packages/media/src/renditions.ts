import { AppError } from "@waitron/shared";
import { rasterCrop, validateFraming, type ImageFraming } from "./framing.js";
import { DECODE_OPTIONS, loadSharp } from "./load-sharp.js";
import { STORED_LONG_EDGE, STORED_WEBP_QUALITY } from "./prepare.js";
import "./errors.js";

export type RenditionShape = "square" | "till" | "display";

export async function renderRendition(
  bytes: Uint8Array,
  shape: RenditionShape,
  framing: ImageFraming,
): Promise<Uint8Array> {
  const frame = validateFraming(framing);
  const sharp = await loadSharp();
  try {
    const metadata = await sharp(bytes, DECODE_OPTIONS).metadata();
    const { width, height } = metadata.autoOrient;
    const ratio = shape === "square" ? 1 : shape === "till" ? 4 / 3 : width / height;
    const crop = rasterCrop(width, height, ratio, frame);
    const target =
      shape === "square"
        ? { width: 480, height: 480 }
        : shape === "till"
          ? { width: 480, height: 360 }
          : {
              width: Math.max(1, Math.round(STORED_LONG_EDGE * Math.min(1, ratio))),
              height: Math.max(1, Math.round(STORED_LONG_EDGE * Math.min(1, 1 / ratio))),
            };
    const output = await sharp(bytes, DECODE_OPTIONS)
      .extract(crop)
      .resize(target.width, target.height, {
        fit: "cover",
        position: "centre",
        withoutEnlargement: true,
      })
      .webp({ quality: STORED_WEBP_QUALITY })
      .toBuffer();
    return new Uint8Array(output);
  } catch {
    throw new AppError("image.invalid_file", {});
  }
}

import { validateImageBytes } from "@waitron/catalogue";
import { AppError } from "@waitron/shared";
import { imageFilename } from "./stored-filename.js";
import "./errors.js";

/**
 * The longer side, in pixels, of every photo the library stores: enough for a photo 800 CSS pixels
 * wide on a screen with two device pixels per CSS pixel.
 */
export const STORED_LONG_EDGE = 1600;
/** sharp's WebP quality, on its 1–100 scale. */
export const STORED_WEBP_QUALITY = 80;
/** The most pixels an upload may declare. Checked from the header, before anything is decoded. */
export const MAX_INPUT_PIXELS = 100_000_000;
/** The largest upload, in bytes: the route's fallback and the server's `MAX_UPLOAD_BYTES`. */
export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** `declare`d only for the brand below, the pattern `packages/shared/src/ids.ts` explains. */
export declare const preparedImageBrand: unique symbol;

/**
 * A photo ready to store. It is shrunk to at most `STORED_LONG_EDGE` on its longer side, never
 * enlarged, turned upright, stripped of every metadata block (EXIF with any GPS position, XMP and
 * ICC), and re-encoded as WebP. `filename` is the sha256 of THESE bytes plus their sniffed
 * extension, so `/media/<filename>`, served `immutable`, names exactly what it serves. Only
 * `prepareImage` makes one.
 */
export interface PreparedImage {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly [preparedImageBrand]: true;
}

type Sharp = typeof import("sharp").default;
let loading: Promise<Sharp> | undefined;

/**
 * sharp is loaded on first use, not at import. Bundles that never prepare a photo, such as
 * `waitron-provision`, reach this module and run with no sharp installed beside them.
 * `scripts/bundle-node.mjs` leaves sharp out of the bundles it builds, and the box image puts it in
 * `/app/node_modules`.
 * One libvips thread (sharp's own default on glibc Linux, the box's platform, per its
 * `dist/utility.mjs`) and no operation cache, so an upload takes neither every core nor memory it
 * keeps afterwards from the process serving sales.
 */
function loadSharp(): Promise<Sharp> {
  loading ??= import("sharp").then(({ default: sharp }) => {
    sharp.concurrency(1);
    sharp.cache(false);
    return sharp;
  });
  return loading;
}

/**
 * Turns an upload into the bytes the library stores. Call it OUTSIDE any transaction. The decode
 * takes long enough that holding the venue's one write lock (`withTransaction`) for it would make
 * every other write wait.
 */
export async function prepareImage(
  bytes: Uint8Array,
  options: { maxUploadBytes: number },
): Promise<PreparedImage> {
  if (bytes.length > options.maxUploadBytes)
    throw new AppError("image.too_large", { maxBytes: options.maxUploadBytes });
  validateImageBytes(bytes);
  const sharp = await loadSharp();
  let declared: { width: number; height: number };
  try {
    declared = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new AppError("image.invalid_file", {});
  }
  if (declared.width * declared.height > MAX_INPUT_PIXELS)
    throw new AppError("image.too_many_pixels", { maxPixels: MAX_INPUT_PIXELS });
  let output: Buffer;
  try {
    output = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
      autoOrient: true,
    })
      .resize(STORED_LONG_EDGE, STORED_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: STORED_WEBP_QUALITY })
      .toBuffer();
  } catch {
    throw new AppError("image.invalid_file", {});
  }
  const stored = new Uint8Array(output);
  return {
    bytes: stored,
    filename: imageFilename(stored),
  } as PreparedImage;
}

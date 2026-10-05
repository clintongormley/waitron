import { encodeLogoRaster, type ReceiptLogoRasters } from "@waitron/layouts";
import { decodeLogoGreyscale } from "@waitron/media";
import {
  LOGO_MAX_HEIGHT_DOTS,
  ditherToRaster,
  safeWidthDots,
  type MonoRaster,
  type PaperWidth,
} from "@waitron/printing";
import { isAppError } from "@waitron/shared";

/** Decodes with sharp, so it runs OUTSIDE any transaction (`prepareImage` says why). */
async function drawLogo(bytes: Uint8Array, paperWidth: PaperWidth): Promise<MonoRaster> {
  return ditherToRaster(
    await decodeLogoGreyscale(bytes, safeWidthDots(paperWidth), LOGO_MAX_HEIGHT_DOTS),
  );
}

/**
 * The logo as each paper prints it, ready for `putReceipt`. Outside any transaction. The 80 mm
 * picture serves 58 mm too when it already fits there: the height bound then decides both sizes.
 */
export async function drawLogoRasters(bytes: Uint8Array): Promise<ReceiptLogoRasters> {
  const wide = await drawLogo(bytes, "80mm");
  const narrow = wide.widthDots <= safeWidthDots("58mm") ? wide : await drawLogo(bytes, "58mm");
  return { "58mm": encodeLogoRaster(narrow), "80mm": encodeLogoRaster(wide) };
}

export interface LogoCache {
  get(filename: string, paperWidth: PaperWidth): MonoRaster | undefined;
  set(filename: string, paperWidth: PaperWidth, raster: MonoRaster): void;
}

/**
 * The logos drawn lately. A library filename is the hash of its bytes (checked again on import), so
 * what one draws on one paper never changes and an entry never goes stale.
 */
export function createLogoCache(limit = 8): LogoCache {
  const entries = new Map<string, MonoRaster>();
  return {
    get(filename, paperWidth) {
      const key = `${filename} ${paperWidth}`;
      const raster = entries.get(key);
      if (raster !== undefined) {
        entries.delete(key);
        entries.set(key, raster);
      }
      return raster;
    },
    set(filename, paperWidth, raster) {
      const key = `${filename} ${paperWidth}`;
      entries.delete(key);
      entries.set(key, raster);
      if (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
  };
}

/** A library image as a preview reads it. */
export interface PreviewImage {
  exists(): Promise<boolean>;
  bytes(): Promise<Uint8Array | null>;
}

/**
 * The logo a preview draws: `null` when the image is gone or will not decode, since a preview shows
 * the rest of the receipt anyway. Outside any transaction.
 */
export async function drawPreviewLogo(
  cache: LogoCache,
  filename: string,
  paperWidth: PaperWidth,
  image: PreviewImage,
): Promise<MonoRaster | null> {
  const cached = cache.get(filename, paperWidth);
  if (cached !== undefined) return (await image.exists()) ? cached : null;
  const bytes = await image.bytes();
  if (bytes === null) return null;
  let raster: MonoRaster;
  try {
    raster = await drawLogo(bytes, paperWidth);
  } catch (error) {
    if (isAppError(error) && error.code === "image.invalid_file") return null;
    throw error;
  }
  cache.set(filename, paperWidth, raster);
  return raster;
}

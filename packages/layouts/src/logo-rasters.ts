import {
  LOGO_MAX_HEIGHT_DOTS,
  safeWidthDots,
  type MonoRaster,
  type PaperWidth,
} from "@waitron/printing";
import type { ReceiptLogoRasters, StoredLogoRaster } from "./types.js";
import { isPlainObject } from "./validate.js";

const PAPER_WIDTHS: readonly PaperWidth[] = ["58mm", "80mm"];
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The longest stored picture, in bytes of JSON text, a read accepts for this paper. */
export function storedPictureMaxBytes(paper: PaperWidth): number {
  return Math.ceil((Math.ceil(safeWidthDots(paper) / 8) * LOGO_MAX_HEIGHT_DOTS) / 3) * 4 + 128;
}

function isDots(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

/** `null` for anything that is not a raster this paper can print. */
function decodeLogoRaster(value: unknown, paperWidth: PaperWidth): MonoRaster | null {
  if (!isPlainObject(value)) return null;
  const { widthDots, heightDots, data } = value;
  if (
    !isDots(widthDots, safeWidthDots(paperWidth)) ||
    !isDots(heightDots, LOGO_MAX_HEIGHT_DOTS) ||
    typeof data !== "string"
  ) {
    return null;
  }
  const size = Math.ceil(widthDots / 8) * heightDots;
  // Bounded before the pattern runs: on ten million characters it overflowed the stack.
  if (data.length !== Math.ceil(size / 3) * 4 || !BASE64.test(data)) return null;
  const bits = new Uint8Array(Buffer.from(data, "base64"));
  if (bits.length !== size) return null;
  return { widthDots, heightDots, bits };
}

export function readLogoRaster(json: string | null, paperWidth: PaperWidth): MonoRaster | null {
  if (json === null) return null;
  try {
    return decodeLogoRaster(JSON.parse(json), paperWidth);
  } catch {
    return null;
  }
}

export function encodeLogoRaster(raster: MonoRaster): StoredLogoRaster {
  return {
    widthDots: raster.widthDots,
    heightDots: raster.heightDots,
    data: Buffer.from(raster.bits).toString("base64"),
  };
}

export function printableLogoRasters(rasters: unknown): rasters is ReceiptLogoRasters {
  return (
    isPlainObject(rasters) &&
    PAPER_WIDTHS.every((paperWidth) => decodeLogoRaster(rasters[paperWidth], paperWidth) !== null)
  );
}

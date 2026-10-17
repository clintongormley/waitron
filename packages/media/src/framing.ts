import { AppError } from "@waitron/shared";
import "./errors.js";

export interface ImageFraming {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_FRAMING: Readonly<ImageFraming> = Object.freeze({
  x: 5000,
  y: 5000,
  zoom: 100,
});

export function validateFraming(input: unknown): ImageFraming {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AppError("image.invalid_framing", { field: "framing" });
  }
  const fields = Object.keys(input);
  const frame = input as Record<string, unknown>;
  if (
    fields.length !== 3 ||
    !fields.every((key) => key === "x" || key === "y" || key === "zoom") ||
    !Number.isInteger(frame.x) ||
    !Number.isInteger(frame.y) ||
    !Number.isInteger(frame.zoom) ||
    (frame.x as number) < 0 ||
    (frame.x as number) > 10000 ||
    (frame.y as number) < 0 ||
    (frame.y as number) > 10000 ||
    (frame.zoom as number) < 100 ||
    (frame.zoom as number) > 400
  ) {
    throw new AppError("image.invalid_framing", { field: "framing" });
  }
  return { x: frame.x as number, y: frame.y as number, zoom: frame.zoom as number };
}

export function cropRect(width: number, height: number, ratio: number, framing: ImageFraming) {
  const frame = validateFraming(framing);
  const cropWidth = (Math.min(width, height * ratio) * 100) / frame.zoom;
  const cropHeight = (Math.min(height, width / ratio) * 100) / frame.zoom;
  return {
    left: Math.max(0, Math.min(width - cropWidth, (width * frame.x) / 10000 - cropWidth / 2)),
    top: Math.max(0, Math.min(height - cropHeight, (height * frame.y) / 10000 - cropHeight / 2)),
    width: cropWidth,
    height: cropHeight,
  };
}

export function rasterCrop(width: number, height: number, ratio: number, framing: ImageFraming) {
  const crop = cropRect(width, height, ratio, framing);
  const left = Math.floor(crop.left);
  const top = Math.floor(crop.top);
  return {
    left,
    top,
    width: Math.max(1, Math.min(width, Math.ceil(crop.left + crop.width)) - left),
    height: Math.max(1, Math.min(height, Math.ceil(crop.top + crop.height)) - top),
  };
}

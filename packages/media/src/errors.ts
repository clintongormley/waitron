import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "image.not_found": { imageId: string };
    "image.invalid_metadata": Record<string, never>;
    "image.translation_required": { field: "names"; language: string };
    "image.too_large": { maxBytes: number };
    "image.invalid_query": Record<string, never>;
    "image.invalid_file": Record<string, never>;
    "image.invalid_framing": { field: "framing" };
    "image.busy": Record<string, never>;
    "image.changed": { imageId: string };
    "image.reference_conflict": { imageId: string };
    "image.hash_conflict": { filename: string };
    "image.too_many_pixels": { maxPixels: number };
  }
}

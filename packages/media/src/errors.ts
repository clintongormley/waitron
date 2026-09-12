import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    "image.not_found": { imageId: string };
    "image.invalid_metadata": Record<string, never>;
    "image.translation_required": { field: "names" | "altText"; language: string };
    "image.too_large": { maxBytes: number };
    "image.invalid_query": Record<string, never>;
  }
}

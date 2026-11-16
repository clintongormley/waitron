import { AppError, contentLanguageCode, resolveContentText } from "@waitron/shared";
import { normalizeImageMetadata, type ImageMetadataInput } from "./images.js";
import { imageFilename } from "./stored-filename.js";
import { validateFraming } from "./framing.js";
import { normalizeUploadFilename } from "./image-edits.js";
import "./errors.js";

const MAX_BYTES = 5 * 1024 * 1024;
function invalid(): never {
  throw new AppError("image.invalid_metadata", {});
}

/**
 * A `json` column, read back out of the bundle.
 *
 * It is one TEXT column holding JSON (`packages/db/src/schema/columns.ts`), and what parses it is
 * drizzle's read mapping — which the export does not go through: it takes a raw `select *` and says
 * so (`apps/server/src/configuration-transfer.ts`). So an image's names reach this function as the
 * JSON TEXT the engine stores, and a value that is anything else did not come out of a venue.
 */
function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") invalid();
  try {
    return JSON.parse(value);
  } catch {
    invalid();
  }
}

/** Validate bytes before any configuration writes, preserving immutable URL contents on import. */
export function validateMediaConfiguration(
  tables: Record<string, readonly Record<string, unknown>[]>,
  bundle?: { readonly contentLanguages: { readonly defaultLanguage: string } | null },
): void {
  const images = tables.media_images ?? [];
  const blobs = new Map<string, string>();
  for (const blob of tables.media_blobs ?? []) {
    if (typeof blob.hash !== "string" || !/^[a-f0-9]{64}$/.test(blob.hash) || blobs.has(blob.hash))
      invalid();
    if (
      typeof blob.bytes !== "string" ||
      blob.bytes.length > MAX_BYTES * 2 + 2 ||
      !/^\\x(?:[a-fA-F0-9]{2})+$/.test(blob.bytes)
    )
      invalid();
    try {
      if (imageFilename(Buffer.from(blob.bytes.slice(2), "hex")) !== `${blob.hash}.${blob.format}`)
        invalid();
    } catch {
      invalid();
    }
    blobs.set(blob.hash, blob.format as string);
  }
  const imageIds = new Set<string>();
  const filenames = new Set<string>();
  const referenced = new Set<string>();
  for (const image of images) {
    if (typeof image.id !== "string" || typeof image.filename !== "string") invalid();
    if (imageIds.has(image.id) || filenames.has(image.filename)) invalid();
    imageIds.add(image.id);
    filenames.add(image.filename);
    if (
      typeof image.original_hash !== "string" ||
      image.original_hash !== image.filename.slice(0, 64) ||
      image.filename !== `${image.original_hash}.${blobs.get(image.original_hash)}`
    )
      invalid();
    referenced.add(image.original_hash);
    if (image.source_hash !== null) {
      if (typeof image.source_hash !== "string" || blobs.get(image.source_hash) !== "webp")
        invalid();
      referenced.add(image.source_hash);
    }
    const metadata = normalizeImageMetadata({
      names: parsedJson(image.names),
    } as ImageMetadataInput);
    const defaultLanguage = bundle?.contentLanguages?.defaultLanguage;
    if (typeof defaultLanguage !== "string") invalid();
    const language = contentLanguageCode(defaultLanguage);
    if (resolveContentText(metadata.names, language, language) === "") invalid();
    if (!Number.isSafeInteger(image.revision) || (image.revision as number) < 1) invalid();
    try {
      validateFraming({ x: image.focus_x, y: image.focus_y, zoom: image.zoom });
      if (
        image.original_filename !== null &&
        (typeof image.original_filename !== "string" ||
          normalizeUploadFilename(image.original_filename) !== image.original_filename)
      )
        invalid();
    } catch {
      invalid();
    }
  }
  if (referenced.size !== blobs.size) invalid();
}

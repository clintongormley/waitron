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
): void {
  const images = tables.media_images ?? [];
  const data = tables.media_image_data ?? [];
  if (images.length !== data.length) invalid();
  const remaining = new Map<string, Record<string, unknown>>();
  for (const row of data) {
    if (typeof row.image_id !== "string") invalid();
    if (remaining.has(row.image_id)) invalid();
    remaining.set(row.image_id, row);
  }
  const imageIds = new Set<string>();
  const filenames = new Set<string>();
  for (const image of images) {
    if (typeof image.id !== "string" || typeof image.filename !== "string") invalid();
    if (imageIds.has(image.id) || filenames.has(image.filename)) invalid();
    imageIds.add(image.id);
    filenames.add(image.filename);
    const row = remaining.get(image.id);
    if (
      !row ||
      typeof row.bytes !== "string" ||
      row.bytes.length > MAX_BYTES * 2 + 2 ||
      !/^\\x(?:[a-fA-F0-9]{2})+$/.test(row.bytes)
    )
      invalid();
    const bytes = Buffer.from(row.bytes.slice(2), "hex");
    if (image.filename !== imageFilename(bytes)) invalid();
    const metadata = normalizeImageMetadata({
      names: parsedJson(image.names),
    } as ImageMetadataInput);
    // One tenant per database, so a bundle holds at most one content-language row.
    const config = tables.content_languages?.[0];
    if (typeof config?.default_language !== "string") invalid();
    const language = contentLanguageCode(config.default_language);
    if (resolveContentText(metadata.names, language, language) === "") invalid();
    remaining.delete(image.id);
  }
  const hashes = new Set<string>();
  for (const blob of tables.media_image_blobs ?? []) {
    if (typeof blob.hash !== "string" || !/^[a-f0-9]{64}$/.test(blob.hash) || hashes.has(blob.hash))
      invalid();
    if (
      typeof blob.bytes !== "string" ||
      blob.bytes.length > MAX_BYTES * 2 + 2 ||
      !/^\\x(?:[a-fA-F0-9]{2})+$/.test(blob.bytes)
    )
      invalid();
    const bytes = Buffer.from(blob.bytes.slice(2), "hex");
    try {
      if (imageFilename(bytes) !== `${blob.hash}.webp`) invalid();
    } catch {
      invalid();
    }
    hashes.add(blob.hash);
  }
  const edited = new Set<string>();
  for (const row of tables.media_image_edits ?? []) {
    if (typeof row.image_id !== "string" || !imageIds.has(row.image_id) || edited.has(row.image_id))
      invalid();
    if (
      row.source_hash !== null &&
      (typeof row.source_hash !== "string" || !hashes.has(row.source_hash))
    )
      invalid();
    if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 1) invalid();
    try {
      validateFraming({ x: row.focus_x, y: row.focus_y, zoom: row.zoom });
      if (
        row.original_filename !== null &&
        (typeof row.original_filename !== "string" ||
          normalizeUploadFilename(row.original_filename) !== row.original_filename)
      )
        invalid();
    } catch {
      invalid();
    }
    edited.add(row.image_id);
  }
}

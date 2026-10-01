import { AppError, contentLanguageCode, resolveContentText } from "@waitron/shared";
import { normalizeImageMetadata, type ImageMetadataInput } from "./images.js";
import { imageFilename } from "./stored-filename.js";
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
  for (const image of images) {
    if (typeof image.id !== "string" || typeof image.filename !== "string") invalid();
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
}

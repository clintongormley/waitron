import { createHash } from "node:crypto";
import { validateImageBytes } from "@waitron/catalogue";
import { AppError, contentLanguageCode, resolveContentText } from "@waitron/shared";
import { normalizeImageMetadata, type ImageMetadataInput } from "./images.js";
import "./errors.js";

const MAX_BYTES = 5 * 1024 * 1024;
function invalid(): never {
  throw new AppError("image.invalid_metadata", {});
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
    if (typeof row.image_id !== "string" || typeof row.tenant_id !== "string") invalid();
    const key = `${row.tenant_id}:${row.image_id}`;
    if (remaining.has(key)) invalid();
    remaining.set(key, row);
  }
  const labels = new Map<string, string>();
  for (const image of images) {
    if (
      typeof image.id !== "string" ||
      typeof image.tenant_id !== "string" ||
      typeof image.filename !== "string"
    )
      invalid();
    const key = `${image.tenant_id}:${image.id}`;
    const row = remaining.get(key);
    if (
      !row ||
      typeof row.bytes !== "string" ||
      row.bytes.length > MAX_BYTES * 2 + 2 ||
      !/^\\x(?:[a-fA-F0-9]{2})+$/.test(row.bytes)
    )
      invalid();
    const bytes = Buffer.from(row.bytes.slice(2), "hex");
    const extension = validateImageBytes(bytes);
    if (image.filename !== `${createHash("sha256").update(bytes).digest("hex")}.${extension}`)
      invalid();
    const input = {
      names: image.names,
      altText: image.alt_text,
      labels: image.labels,
    } as ImageMetadataInput;
    const metadata = normalizeImageMetadata(input);
    if (
      metadata.labels.length !== input.labels.length ||
      input.labels.some((label) => !metadata.labels.includes(label))
    )
      invalid();
    for (const label of metadata.labels) {
      const key = `${image.tenant_id}:${label.toLowerCase()}`;
      if (labels.has(key) && labels.get(key) !== label) invalid();
      labels.set(key, label);
    }
    const config = tables.content_languages?.find((config) => config.tenant_id === image.tenant_id);
    if (typeof config?.default_language !== "string") invalid();
    const language = contentLanguageCode(config.default_language);
    if (
      resolveContentText(metadata.names, language, language) === "" ||
      resolveContentText(metadata.altText, language, language) === ""
    )
      invalid();
    remaining.delete(key);
  }
}

import { createHash } from "node:crypto";
import {
  readContentLanguages,
  validateContentTranslations,
  validateImageBytes,
} from "@waitron/catalogue";
import { products, type Transaction } from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  FALLBACK_LOCALE,
  resolveContentText,
} from "@waitron/shared";
import { and, eq, sql } from "drizzle-orm";
import { mediaImageData, mediaImages } from "./schema/images.js";
import "./errors.js";

export interface ImageMetadataInput {
  names: Record<string, string>;
  altText: Record<string, string>;
  labels: string[];
}
export interface ImageRecord extends ImageMetadataInput {
  id: string;
  filename: string;
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
}
export interface ImageUsage {
  kind: "product";
  id: string;
  catalogueId: string;
  names: Record<string, string>;
  active: boolean;
}
export interface UploadImageOptions {
  fallbackLanguage?: string;
  maxUploadBytes: number;
}

function normalizeTranslations(
  value: Record<string, string>,
  maxLength: number,
): Record<string, string> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 200
  ) {
    throw new AppError("image.invalid_metadata", {});
  }
  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    const language = contentLanguageCode(key);
    if (typeof text !== "string" || text.length > maxLength || Object.hasOwn(result, language)) {
      throw new AppError("image.invalid_metadata", {});
    }
    result[language] = text.trim();
  }
  return result;
}

function normalizeLabels(labels: string[]): string[] {
  if (
    !Array.isArray(labels) ||
    labels.length > 50 ||
    labels.some(
      (label) => typeof label !== "string" || label.trim().length === 0 || label.length > 100,
    )
  ) {
    throw new AppError("image.invalid_metadata", {});
  }
  const seen = new Map<string, string>();
  for (const label of labels) {
    const display = label.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (!seen.has(display.toLowerCase())) seen.set(display.toLowerCase(), display);
  }
  return [...seen.values()].sort();
}

export function normalizeImageMetadata(input: ImageMetadataInput): ImageMetadataInput {
  return {
    names: normalizeTranslations(input.names, 200),
    altText: normalizeTranslations(input.altText, 2000),
    labels: normalizeLabels(input.labels),
  };
}

async function metadata(
  tx: Transaction,
  tenantId: string,
  input: ImageMetadataInput,
  fallbackLanguage: string,
): Promise<ImageMetadataInput> {
  const value = normalizeImageMetadata(input);
  for (const field of ["names", "altText"] as const) {
    try {
      await validateContentTranslations(tx, tenantId, value[field], fallbackLanguage);
    } catch (error) {
      if (error instanceof AppError && error.code === "content.translation_required") {
        const config = await readContentLanguages(tx, tenantId, fallbackLanguage);
        throw new AppError("image.translation_required", {
          field,
          language: config.defaultLanguage,
        });
      }
      throw error;
    }
  }
  const existing = new Map(
    (await listImageLabels(tx, tenantId)).map((label) => [label.toLowerCase(), label]),
  );
  value.labels = value.labels.map((label) => existing.get(label.toLowerCase()) ?? label).sort();
  return value;
}

export async function listImageUsages(
  tx: Transaction,
  tenantId: string,
  imageId: string,
): Promise<ImageUsage[]> {
  const image = await tx
    .select({ filename: mediaImages.filename })
    .from(mediaImages)
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.id, imageId)));
  if (!image[0]) throw new AppError("image.not_found", { imageId });
  const rows = await tx
    .select({
      id: products.id,
      catalogueId: products.catalogueId,
      names: products.descriptions,
      active: products.active,
    })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.image, image[0].filename)))
    .orderBy(products.id);
  return rows.map((row) => ({ kind: "product", ...row }));
}

export async function readImage(
  tx: Transaction,
  tenantId: string,
  imageId: string,
): Promise<ImageRecord> {
  const [row] = await tx
    .select()
    .from(mediaImages)
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.id, imageId)));
  if (!row) throw new AppError("image.not_found", { imageId });
  return {
    id: row.id,
    filename: row.filename,
    names: row.names,
    altText: row.altText,
    labels: row.labels,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageCount: (await listImageUsages(tx, tenantId, imageId)).length,
  };
}

export async function uploadImage(
  tx: Transaction,
  tenantId: string,
  input: ImageMetadataInput & { bytes: Uint8Array },
  options: UploadImageOptions,
): Promise<{ created: boolean; image: ImageRecord }> {
  if (input.bytes.length > options.maxUploadBytes)
    throw new AppError("image.too_large", { maxBytes: options.maxUploadBytes });
  const extension = validateImageBytes(input.bytes);
  const filename = `${createHash("sha256").update(input.bytes).digest("hex")}.${extension}`;
  const values = await metadata(tx, tenantId, input, options.fallbackLanguage ?? FALLBACK_LOCALE);
  // The content-language lock also serializes duplicate uploads within this tenant.
  const [existing] = await tx
    .select({ id: mediaImages.id })
    .from(mediaImages)
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.filename, filename)));
  if (existing) return { created: false, image: await readImage(tx, tenantId, existing.id) };
  const [row] = await tx
    .insert(mediaImages)
    .values({ tenantId, filename, ...values })
    .returning({ id: mediaImages.id });
  await tx.insert(mediaImageData).values({ tenantId, imageId: row!.id, bytes: input.bytes });
  return { created: true, image: await readImage(tx, tenantId, row!.id) };
}

export async function readImageBytes(
  tx: Transaction,
  tenantId: string,
  filename: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const [row] = await tx
    .select({ bytes: mediaImageData.bytes })
    .from(mediaImages)
    .innerJoin(
      mediaImageData,
      and(
        eq(mediaImages.tenantId, mediaImageData.tenantId),
        eq(mediaImages.id, mediaImageData.imageId),
      ),
    )
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.filename, filename)));
  if (!row) return null;
  const contentType = filename.endsWith(".jpg")
    ? "image/jpeg"
    : filename.endsWith(".png")
      ? "image/png"
      : "image/webp";
  return { bytes: row.bytes, contentType };
}

export async function updateImage(
  tx: Transaction,
  tenantId: string,
  imageId: string,
  input: ImageMetadataInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<ImageRecord> {
  await readImage(tx, tenantId, imageId);
  const values = await metadata(tx, tenantId, input, fallbackLanguage);
  const updated = await tx
    .update(mediaImages)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.id, imageId)))
    .returning({ id: mediaImages.id });
  if (updated.length === 0) throw new AppError("image.not_found", { imageId });
  return readImage(tx, tenantId, imageId);
}

export async function listImageLabels(tx: Transaction, tenantId: string): Promise<string[]> {
  const result = await tx.execute<{ label: string }>(sql`
    select distinct unnest(labels) as label from media_images where tenant_id = ${tenantId} order by label
  `);
  return result.rows.map((row) => row.label);
}

export async function listImageTranslationGaps(
  tx: Transaction,
  tenantId: string,
  language: string,
): Promise<{ kind: "image"; id: string }[]> {
  const code = contentLanguageCode(language);
  const rows = await tx
    .select({ id: mediaImages.id, names: mediaImages.names, altText: mediaImages.altText })
    .from(mediaImages)
    .where(eq(mediaImages.tenantId, tenantId));
  return rows
    .filter(
      (row) =>
        resolveContentText(row.names, code, code) === "" ||
        resolveContentText(row.altText, code, code) === "",
    )
    .map((row) => ({ kind: "image", id: row.id }));
}

export async function deleteImage(
  tx: Transaction,
  tenantId: string,
  imageId: string,
): Promise<{ deleted: boolean; uses: ImageUsage[] }> {
  // FOR UPDATE conflicts with the FK's KEY SHARE lock when a product attaches this image.
  const [image] = await tx
    .select({ id: mediaImages.id })
    .from(mediaImages)
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.id, imageId)))
    .for("update");
  if (!image) throw new AppError("image.not_found", { imageId });
  const uses = await listImageUsages(tx, tenantId, imageId);
  if (uses.length > 0) return { deleted: false, uses };
  await tx
    .delete(mediaImages)
    .where(and(eq(mediaImages.tenantId, tenantId), eq(mediaImages.id, imageId)));
  return { deleted: true, uses: [] };
}

export interface ListImagesOptions {
  query?: string;
  label?: string;
  sort?: "relevance" | "date" | "name";
  direction?: "asc" | "desc";
  offset?: number;
  limit?: number;
  language?: string;
  fallbackLanguage?: string;
}

export async function listImages(
  tx: Transaction,
  tenantId: string,
  options: ListImagesOptions = {},
): Promise<{ images: ImageRecord[]; total: number }> {
  const query = options.query?.trim() ?? "";
  const label = options.label?.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase() ?? "";
  const sort = options.sort ?? (query ? "relevance" : "date");
  const direction = options.direction ?? (sort === "name" ? "asc" : "desc");
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 40;
  if (
    query.length > 500 ||
    label.length > 100 ||
    !["relevance", "date", "name"].includes(sort) ||
    !["asc", "desc"].includes(direction) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new AppError("image.invalid_query", {});
  }
  const config = await readContentLanguages(
    tx,
    tenantId,
    options.fallbackLanguage ?? FALLBACK_LOCALE,
  );
  const requestedLanguage = contentLanguageCode(options.language ?? config.defaultLanguage);
  const language = config.languages.includes(requestedLanguage)
    ? requestedLanguage
    : config.defaultLanguage;
  const vector = sql`media_search_vector(m.names, m.alt_text, m.labels)`;
  const search = sql`media_search_query(${query})`;
  const where = sql`m.tenant_id = ${tenantId}
    and ${query ? sql`${vector} @@ ${search}` : sql`true`}
    and ${label ? sql`exists (select 1 from unnest(m.labels) as label where lower(label) = ${label})` : sql`true`}`;
  const rank = query ? sql`ts_rank_cd(${vector}, ${search})` : sql`0`;
  const nameMatch = query
    ? sql`media_search_vector(m.names, '{}'::jsonb, '{}'::text[]) @@ ${search}`
    : sql`false`;
  const name = sql`lower(coalesce(nullif(btrim(m.names ->> ${language}), ''), m.names ->> ${config.defaultLanguage}, '')) collate "C"`;
  const order =
    sort === "relevance"
      ? sql`${nameMatch} desc, ${rank} desc`
      : sql`${sort === "name" ? name : sql`m.created_at`} ${direction === "asc" ? sql`asc` : sql`desc`}`;
  const count = await tx.execute<{ total: number }>(
    sql`select count(*)::int as total from media_images m where ${where}`,
  );
  const result = await tx.execute<ImageRecord & Record<string, unknown>>(sql`
    select m.id, m.filename, m.names, m.alt_text as "altText", m.labels,
      m.created_at as "createdAt", m.updated_at as "updatedAt",
      (select count(*)::int from products p where p.tenant_id = m.tenant_id and p.image = m.filename) as "usageCount"
    from media_images m where ${where} order by ${order}, m.id asc limit ${limit} offset ${offset}
  `);
  return { images: result.rows, total: count.rows[0]!.total };
}

import {
  categoryDetails,
  parentJoin,
  parentProducts,
  readContentLanguages,
  staffPresentationName,
  validateContentTranslations,
} from "@waitron/catalogue";
import { categories, products, type Transaction } from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  FALLBACK_LOCALE,
  resolveContentText,
} from "@waitron/shared";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { mediaImageData, mediaImages } from "./schema/images.js";
import type { PreparedImage } from "./prepare.js";
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
  /** How many products (variants among them) and categories reference this photo. `readImage`
   * counts `listImageUsages`; `listImages` counts the same two sources in its own SQL, and the two
   * must stay in step or the library shows a free photo that then refuses to delete. */
  usageCount: number;
}
export type ImageUsage =
  | { kind: "category"; id: string; names: Record<string, string> }
  | {
      kind: "product";
      id: string;
      catalogueId: string;
      /** The staff-facing product name (`products.name`) — plain text, not per-language. */
      name: string;
      active: boolean;
    }
  | {
      kind: "variant";
      /** The variant's own `products` row id; `productId` is its parent's. */
      id: string;
      productId: string;
      catalogueId: string;
      /** The variant's staff name, as `staffPresentationName` names a variant. */
      name: string;
      /** The variant AND its product are Active. */
      active: boolean;
    };
export interface UploadImageOptions {
  fallbackLanguage?: string;
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
  input: ImageMetadataInput,
  fallbackLanguage: string,
): Promise<ImageMetadataInput> {
  const value = normalizeImageMetadata(input);
  // A name in the default language is required; alt text is optional (its language codes and lengths
  // are still validated by normalizeImageMetadata above).
  try {
    await validateContentTranslations(tx, value.names, fallbackLanguage);
  } catch (error) {
    if (error instanceof AppError && error.code === "content.translation_required") {
      const config = await readContentLanguages(tx, fallbackLanguage);
      throw new AppError("image.translation_required", {
        field: "names",
        language: config.defaultLanguage,
      });
    }
    throw error;
  }
  const existing = new Map(
    (await listImageLabels(tx)).map((label) => [label.toLowerCase(), label]),
  );
  value.labels = value.labels.map((label) => existing.get(label.toLowerCase()) ?? label).sort();
  return value;
}

export async function listImageUsages(tx: Transaction, imageId: string): Promise<ImageUsage[]> {
  const image = await tx
    .select({ filename: mediaImages.filename })
    .from(mediaImages)
    .where(eq(mediaImages.id, imageId));
  if (!image[0]) throw new AppError("image.not_found", { imageId });
  // A variant is a `products` row with a `parent_id`, so one column covers both. A variant with no
  // photo of its own shows its parent's and holds no use of it.
  const productRows = await tx
    .select({
      id: products.id,
      parentId: products.parentId,
      catalogueId: products.catalogueId,
      name: products.name,
      parentName: parentProducts.name,
      active: products.active,
      parentActive: parentProducts.active,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(eq(products.image, image[0].filename))
    // Products before variants, each in id order.
    .orderBy(isNotNull(products.parentId), products.id);
  const categoryRows = await tx
    .select({ id: categories.id, names: categories.name })
    .from(categoryDetails)
    .innerJoin(categories, eq(categories.id, categoryDetails.categoryId))
    .where(eq(categoryDetails.image, image[0].filename))
    .orderBy(categories.id);
  const usage = ({
    parentId,
    parentName,
    parentActive,
    name,
    active,
    ...row
  }: (typeof productRows)[number]): ImageUsage =>
    parentId === null
      ? { kind: "product", ...row, name, active }
      : {
          kind: "variant",
          ...row,
          productId: parentId,
          name: staffPresentationName({ name: parentName!, variantName: name }),
          active: active && parentActive === true,
        };
  return [
    ...productRows.map(usage),
    ...categoryRows.map((row): ImageUsage => ({ kind: "category", ...row })),
  ];
}

export async function readImage(tx: Transaction, imageId: string): Promise<ImageRecord> {
  const [row] = await tx.select().from(mediaImages).where(eq(mediaImages.id, imageId));
  if (!row) throw new AppError("image.not_found", { imageId });
  return {
    id: row.id,
    filename: row.filename,
    names: row.names,
    altText: row.altText,
    labels: row.labels,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageCount: (await listImageUsages(tx, imageId)).length,
  };
}

/**
 * Adds a photo to the library, or returns the existing entry when one already stores these exact
 * bytes. Takes a `PreparedImage`, so every photo stored through here has been through
 * `prepareImage`. Configuration import copies the media image rows as they are and does not
 * shrink them.
 */
export async function uploadImage(
  tx: Transaction,
  input: ImageMetadataInput & { image: PreparedImage },
  options: UploadImageOptions = {},
): Promise<{ created: boolean; image: ImageRecord }> {
  const { filename, bytes } = input.image;
  const values = await metadata(tx, input, options.fallbackLanguage ?? FALLBACK_LOCALE);
  // Inside a `withTransaction` body nothing can insert between this read and the insert below: it
  // holds the venue file's one write lock.
  const [existing] = await tx
    .select({ id: mediaImages.id })
    .from(mediaImages)
    .where(eq(mediaImages.filename, filename));
  if (existing) return { created: false, image: await readImage(tx, existing.id) };
  const [row] = await tx
    .insert(mediaImages)
    .values({ filename, ...values })
    .returning({ id: mediaImages.id });
  await tx.insert(mediaImageData).values({ imageId: row!.id, bytes });
  return { created: true, image: await readImage(tx, row!.id) };
}

export async function readImageBytes(
  tx: Transaction,
  filename: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const [row] = await tx
    .select({ bytes: mediaImageData.bytes })
    .from(mediaImages)
    .innerJoin(mediaImageData, eq(mediaImages.id, mediaImageData.imageId))
    .where(eq(mediaImages.filename, filename));
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
  imageId: string,
  input: ImageMetadataInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<ImageRecord> {
  await readImage(tx, imageId);
  const values = await metadata(tx, input, fallbackLanguage);
  await tx
    .update(mediaImages)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(mediaImages.id, imageId));
  return readImage(tx, imageId);
}

/** Every distinct label in use, in order. */
export async function listImageLabels(tx: Transaction): Promise<string[]> {
  const rows = await tx.select({ labels: mediaImages.labels }).from(mediaImages);
  return [...new Set(rows.flatMap((row) => row.labels))].sort();
}

export async function listImageTranslationGaps(
  tx: Transaction,
  language: string,
): Promise<{ kind: "image"; id: string }[]> {
  const code = contentLanguageCode(language);
  const rows = await tx.select({ id: mediaImages.id, names: mediaImages.names }).from(mediaImages);
  // Only a missing name is a gap; alt text is optional, so its absence never blocks a
  // default-language change.
  return rows
    .filter((row) => resolveContentText(row.names, code, code) === "")
    .map((row) => ({ kind: "image", id: row.id }));
}

export async function deleteImage(
  tx: Transaction,
  imageId: string,
): Promise<{ deleted: boolean; uses: ImageUsage[] }> {
  // No attach can slip between the usage check and the delete: one write transaction runs on the
  // venue file at a time (the pattern is on `assertExtraListForWrite`,
  // `packages/catalogue/src/extras.ts`).
  //
  // `packages/media/drizzle/0001_image_references.sql` refuses the delete at the database as well.
  // This returns the uses instead, which is what the library screen shows.
  const [image] = await tx
    .select({ id: mediaImages.id })
    .from(mediaImages)
    .where(eq(mediaImages.id, imageId));
  if (!image) throw new AppError("image.not_found", { imageId });
  const uses = await listImageUsages(tx, imageId);
  if (uses.length > 0) return { deleted: false, uses };
  await tx.delete(mediaImages).where(eq(mediaImages.id, imageId));
  return { deleted: true, uses: [] };
}

/** One searchable unit of text, with the weight of the field it came from. */
interface Field {
  readonly tokens: readonly string[];
  readonly weight: number;
}

/** One term of a parsed query: a single word, or a phrase that must appear intact. */
interface QueryItem {
  readonly negated: boolean;
  readonly tokens: readonly string[];
}

/**
 * Words, lowercased, with everything that is not a letter or a digit treated as a separator.
 *
 * Nothing here stems: matching is by whole lowercased token, so a plural in the text is found only
 * by that plural. FTS5's `porter` tokenizer is deliberately not taken: it would need an FTS5
 * virtual table, and it would apply English suffix rules to every language. Stopwords are kept.
 */
function searchTokens(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Double-quoted phrases, a leading `-` for exclusion, and a bare `or` joining groups.
 *
 * `or` binds LOOSER than the implicit `and`, so the result is a list of groups and a row matches
 * when ANY group does.
 *
 * A non-empty query that yields no groups matches NOTHING. An EMPTY query never reaches here; its
 * caller skips the filter entirely.
 */
function parseSearch(query: string): QueryItem[][] {
  const groups: QueryItem[][] = [];
  let current: QueryItem[] = [];
  // A phrase in double quotes, or a run of anything that is not a space or a quote.
  for (const [raw] of query.matchAll(/-?"[^"]*"|[^\s"]+/gu)) {
    if (/^or$/iu.test(raw)) {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    const negated = raw.startsWith("-");
    const tokens = searchTokens(negated ? raw.slice(1) : raw);
    if (tokens.length > 0) current.push({ negated, tokens });
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Does `tokens` appear intact and in order inside `field`? A single word is the length-1 case. */
function fieldHolds(field: readonly string[], tokens: readonly string[]): boolean {
  for (let start = 0; start + tokens.length <= field.length; start += 1) {
    if (tokens.every((token, offset) => field[start + offset] === token)) return true;
  }
  return false;
}

/**
 * The best weight at which `item` is found, or `null` when it is not found at all.
 *
 * A phrase is matched WITHIN one field value — one translation, or one label — so it cannot
 * straddle two labels.
 */
function itemWeight(fields: readonly Field[], item: QueryItem): number | null {
  let best: number | null = null;
  for (const field of fields) {
    if (fieldHolds(field.tokens, item.tokens) && (best === null || field.weight > best)) {
      best = field.weight;
    }
  }
  return best;
}

/**
 * Does any group match, and how strongly?
 *
 * `null` is "no match". The score is the summed weight of the positive terms of the best-scoring
 * group. Under the relevance sort `listImages` orders by a name match first, so the score decides
 * only ties under it.
 */
function scoreSearch(groups: readonly QueryItem[][], fields: readonly Field[]): number | null {
  let best: number | null = null;
  for (const group of groups) {
    let score = 0;
    let matched = true;
    for (const item of group) {
      const weight = itemWeight(fields, item);
      if (item.negated ? weight !== null : weight === null) {
        matched = false;
        break;
      }
      score += weight ?? 0;
    }
    if (matched && (best === null || score > best)) best = score;
  }
  return best;
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

/**
 * The image library's list: search, label filter, ordering and one page.
 *
 * **It reads every row and filters in JavaScript.** The bytes live in `media_image_data`, so what is
 * read here is metadata only.
 *
 * **The name ordering is JavaScript's collator:** SQLite ships `BINARY`, `NOCASE` and `RTRIM` and
 * nothing accent-aware.
 */
export async function listImages(
  tx: Transaction,
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
  const config = await readContentLanguages(tx, options.fallbackLanguage ?? FALLBACK_LOCALE);
  const requestedLanguage = contentLanguageCode(options.language ?? config.defaultLanguage);
  const language = config.languages.includes(requestedLanguage)
    ? requestedLanguage
    : config.defaultLanguage;
  // Relevance ranking is meaningless without a search term — every row would score the same — so an
  // empty search falls back to the date ordering, which is the ordering an absent `sort` already
  // resolves to. The library's first load sends `sort=relevance` with no query.
  const effectiveSort = sort === "relevance" && !query ? "date" : sort;
  const groups = query ? parseSearch(query) : [];

  const rows = await tx
    .select({
      id: mediaImages.id,
      filename: mediaImages.filename,
      names: mediaImages.names,
      altText: mediaImages.altText,
      labels: mediaImages.labels,
      createdAt: mediaImages.createdAt,
      updatedAt: mediaImages.updatedAt,
    })
    .from(mediaImages);

  const matched: { row: (typeof rows)[number]; nameMatch: boolean; score: number }[] = [];
  for (const row of rows) {
    if (label !== "" && !row.labels.some((value) => value.toLowerCase() === label)) continue;
    if (!query) {
      matched.push({ row, nameMatch: false, score: 0 });
      continue;
    }
    const names: Field[] = Object.values(row.names).map((value) => ({
      tokens: searchTokens(value),
      weight: 1,
    }));
    const fields: Field[] = [
      ...names,
      ...row.labels.map((value) => ({ tokens: searchTokens(value), weight: 0.4 })),
      ...Object.values(row.altText).map((value) => ({ tokens: searchTokens(value), weight: 0.2 })),
    ];
    const score = scoreSearch(groups, fields);
    if (score === null) continue;
    matched.push({ row, nameMatch: scoreSearch(groups, names) !== null, score });
  }

  // An empty or whitespace-only translation is not a name: it falls through to the site default.
  const collator = new Intl.Collator();
  const displayName = (names: Record<string, string>): string =>
    (names[language]?.trim() !== undefined && names[language]!.trim() !== ""
      ? names[language]!.trim()
      : (names[config.defaultLanguage] ?? "")
    ).toLowerCase();
  const sign = direction === "asc" ? 1 : -1;
  matched.sort((left, right) => {
    if (effectiveSort === "relevance") {
      // The name match is the FIRST term, not a tiebreak: a photo whose NAME matches outranks one
      // that only repeats the word in its alt text, however many times.
      if (left.nameMatch !== right.nameMatch) return left.nameMatch ? -1 : 1;
      if (left.score !== right.score) return right.score - left.score;
    } else if (effectiveSort === "name") {
      const order = collator.compare(displayName(left.row.names), displayName(right.row.names));
      if (order !== 0) return sign * order;
    } else {
      const order = left.row.createdAt.getTime() - right.row.createdAt.getTime();
      if (order !== 0) return sign * order;
    }
    // The id breaks every tie ASCENDING whichever way the page is ordered, so two rows that compare
    // equal keep one order across pages.
    return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
  });

  const page = matched.slice(offset, offset + limit);
  const usage = await countUsages(
    tx,
    page.map((entry) => entry.row.filename),
  );
  return {
    images: page.map((entry) => ({ ...entry.row, usageCount: usage.get(entry.row.filename) ?? 0 })),
    total: matched.length,
  };
}

/**
 * How many products (variants among them) and categories name each of `filenames`.
 *
 * The two reads are the same two `listImageUsages` scans, and a source added there is added
 * here too — or the library shows a free photo that then refuses to delete. They are separate
 * statements on one transaction and are awaited in turn, never `Promise.all` (`CLAUDE.md` §3).
 */
async function countUsages(
  tx: Transaction,
  filenames: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (filenames.length === 0) return counts;
  const wanted = [...filenames];
  const tally = (image: string | null): void => {
    if (image !== null) counts.set(image, (counts.get(image) ?? 0) + 1);
  };
  for (const row of await tx
    .select({ image: products.image })
    .from(products)
    .where(inArray(products.image, wanted))) {
    tally(row.image);
  }
  for (const row of await tx
    .select({ image: categoryDetails.image })
    .from(categoryDetails)
    .where(inArray(categoryDetails.image, wanted))) {
    tally(row.image);
  }
  return counts;
}

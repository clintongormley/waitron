import {
  menuPublications,
  menuScheduledPublications,
  menuVersionImages,
  menuVersions,
  parentJoin,
  parentProducts,
  readContentLanguages,
  sectionMembers,
  sections,
  staffPresentationName,
  validateContentTranslations,
} from "@waitron/catalogue";
import { catalogues, products, tenantReceipts, type Transaction } from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  FALLBACK_LOCALE,
  resolveContentText,
} from "@waitron/shared";
import { and, count, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { mediaImageData, mediaImages } from "./schema/images.js";
import { IMAGE_LIST_COLUMNS, datedImagePageQuery } from "./image-page-query.js";
import type { PreparedImage } from "./prepare.js";
import "./errors.js";

export interface ImageMetadataInput {
  names: Record<string, string>;
}
export interface ImageRecord extends ImageMetadataInput {
  id: string;
  filename: string;
  createdAt: Date;
  updatedAt: Date;
  /** How many products (variants among them), sections, include folders, live or queued menu
   * versions and receipt logos reference this photo. `readImage` uses `listImageUsagesForFilename`
   * and `listImages` uses `countUsages`; the counters must stay in step or the library shows a free
   * photo that then refuses to delete. */
  usageCount: number;
}
export type ImageUsage =
  /** Any section, a list a menu owns included; `internalName` is the staff-facing name. */
  | { kind: "section"; id: string; internalName: string; ownerMenuId: string }
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
      /** The product and relative variant staff names. */
      name: string;
      /** The variant AND its product are Active. */
      active: boolean;
    }
  /**
   * An include's folder photo, held whether or not the include shows as a folder. `id` is the
   * member; `menuId` owns the list it sits in; `includedMenuName` is the included root's staff name,
   * or the member's missing name when it includes no section.
   */
  | {
      kind: "menu_include";
      id: string;
      menuId: string;
      menuName: string;
      includedMenuName: string;
    }
  /** A menu's LIVE version; a version another has replaced holds no use. */
  | { kind: "menu_version"; id: string; menuId: string; menuName: string; number: number }
  /**
   * A menu edition whose schedule row is still queued to go live at `activatesAt`; it may already
   * be due, until `settleDue` marks it activated.
   */
  | {
      kind: "scheduled_menu_version";
      id: string;
      menuId: string;
      menuName: string;
      number: number;
      activatesAt: string;
    }
  /** The receipt prints it as its logo. */
  | { kind: "receipt" };
const receiptLogo = sql<string | null>`json_extract(${tenantReceipts.receipt}, '$.logo')`;
// The expression `section_members_folder_image_idx` indexes.
const folderImage = sql<string | null>`${sectionMembers.folderOverrides} ->> '$.image'`;
const includedRoots = alias(sections, "included_roots");

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

export function normalizeImageMetadata(input: ImageMetadataInput): ImageMetadataInput {
  return { names: normalizeTranslations(input.names, 200) };
}

async function metadata(
  tx: Transaction,
  input: ImageMetadataInput,
  fallbackLanguage: string,
): Promise<ImageMetadataInput> {
  const value = normalizeImageMetadata(input);
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
  return value;
}

export async function listImageUsages(tx: Transaction, imageId: string): Promise<ImageUsage[]> {
  const image = await tx
    .select({ filename: mediaImages.filename })
    .from(mediaImages)
    .where(eq(mediaImages.id, imageId));
  if (!image[0]) throw new AppError("image.not_found", { imageId });
  return listImageUsagesForFilename(tx, image[0].filename);
}

async function listImageUsagesForFilename(
  tx: Transaction,
  filename: string,
): Promise<ImageUsage[]> {
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
    .where(eq(products.image, filename))
    // Products before variants, each in id order.
    .orderBy(isNotNull(products.parentId), products.id);
  const sectionRows = await tx
    .select({
      id: sections.id,
      internalName: sections.internalName,
      ownerMenuId: sections.ownerMenuId,
    })
    .from(sections)
    .where(eq(sections.image, filename))
    .orderBy(sections.id);
  const includeRows = await tx
    .select({
      id: sectionMembers.id,
      menuId: sections.ownerMenuId,
      menuName: catalogues.name,
      // Left-joined so a member that names no section is still listed, as `countUsages` and the
      // delete trigger still see it, under its own missing name.
      includedMenuName: sql<string>`coalesce(${includedRoots.internalName}, ${sectionMembers.missingName}, '')`,
    })
    .from(sectionMembers)
    .innerJoin(sections, eq(sections.id, sectionMembers.sectionId))
    .innerJoin(catalogues, eq(catalogues.id, sections.ownerMenuId))
    .leftJoin(includedRoots, eq(includedRoots.id, sectionMembers.childSectionId))
    .where(eq(folderImage, filename))
    .orderBy(catalogues.name, sectionMembers.id);
  const versionRows = await tx
    .select({
      id: menuVersions.id,
      menuId: menuVersions.menuId,
      menuName: catalogues.name,
      number: menuVersions.number,
      livePointer: menuPublications.versionId,
      activatesAt: menuScheduledPublications.activatesAt,
    })
    .from(menuVersionImages)
    .innerJoin(menuVersions, eq(menuVersions.id, menuVersionImages.versionId))
    .innerJoin(catalogues, eq(catalogues.id, menuVersions.menuId))
    .leftJoin(menuPublications, eq(menuPublications.versionId, menuVersionImages.versionId))
    .leftJoin(
      menuScheduledPublications,
      and(
        eq(menuScheduledPublications.versionId, menuVersionImages.versionId),
        eq(menuScheduledPublications.state, "queued"),
      ),
    )
    .where(
      and(
        eq(menuVersionImages.filename, filename),
        or(isNotNull(menuPublications.versionId), isNotNull(menuScheduledPublications.versionId)),
      ),
    )
    .orderBy(catalogues.name, menuVersions.menuId, menuVersions.number);
  const receiptRows = await tx
    .select({ id: tenantReceipts.id })
    .from(tenantReceipts)
    .where(eq(receiptLogo, filename));
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
    ...sectionRows.map((row): ImageUsage => ({ kind: "section", ...row })),
    ...includeRows.map((row): ImageUsage => ({ kind: "menu_include", ...row })),
    ...versionRows.flatMap(({ livePointer, activatesAt, ...row }): ImageUsage[] => [
      ...(livePointer === null ? [] : [{ kind: "menu_version" as const, ...row }]),
      ...(activatesAt === null
        ? []
        : [
            {
              kind: "scheduled_menu_version" as const,
              ...row,
              activatesAt: activatesAt.toISOString(),
            },
          ]),
    ]),
    ...receiptRows.map((): ImageUsage => ({ kind: "receipt" })),
  ];
}

export async function readImage(tx: Transaction, imageId: string): Promise<ImageRecord> {
  const [row] = await tx.select().from(mediaImages).where(eq(mediaImages.id, imageId));
  if (!row) throw new AppError("image.not_found", { imageId });
  return {
    id: row.id,
    filename: row.filename,
    names: row.names,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usageCount: (await listImageUsagesForFilename(tx, row.filename)).length,
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

export async function imageExists(tx: Transaction, filename: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: mediaImages.id })
    .from(mediaImages)
    .where(eq(mediaImages.filename, filename));
  return row !== undefined;
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

export async function listImageTranslationGaps(
  tx: Transaction,
  language: string,
): Promise<{ kind: "image"; id: string }[]> {
  const code = contentLanguageCode(language);
  const rows = await tx.select({ id: mediaImages.id, names: mediaImages.names }).from(mediaImages);
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
  // The triggers in `packages/media/drizzle/` refuse the delete at the database as well for a
  // product, section, include folder or live or queued menu version, but not for the receipt's
  // logo, so for that use this check is the only refusal. It returns the uses, which is what the
  // library screen shows.
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

/**
 * One term of a parsed query: a single word, or a phrase whose words must appear together and in
 * order.
 */
interface QueryItem {
  readonly negated: boolean;
  readonly tokens: readonly string[];
  /** The last token may match the start of a longer word: it is still being typed. */
  readonly prefix: boolean;
}

/**
 * Words, lowercased, with everything that is not a letter or a digit treated as a separator.
 *
 * Nothing stems. FTS5's `porter` tokenizer is deliberately not taken: it would need an FTS5
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
 * The query's last word is a prefix while it is still being typed: when the query ends in a letter
 * or digit and that word is not excluded. A last word `or` is still the operator, not a prefix. A
 * quote left open runs to the end of the query, so a phrase being typed stays one phrase.
 *
 * A non-empty query that yields no groups matches NOTHING. An EMPTY query never reaches here; its
 * caller skips the filter entirely.
 */
function parseSearch(query: string): QueryItem[][] {
  const groups: QueryItem[][] = [];
  let current: QueryItem[] = [];
  const typing = /[\p{L}\p{N}]$/u.test(query);
  for (const match of query.matchAll(/-?"[^"]*"?|[^\s"]+/gu)) {
    const raw = match[0];
    if (/^or$/iu.test(raw)) {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    const negated = raw.startsWith("-");
    const tokens = searchTokens(negated ? raw.slice(1) : raw);
    const prefix = typing && !negated && match.index + raw.length === query.length;
    if (tokens.length > 0) current.push({ negated, tokens, prefix });
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Does `tokens` appear intact and in order inside `field`? With `prefix`, the last may be the start
 * of a longer word. A single word is the length-1 case.
 */
function fieldHolds(field: readonly string[], tokens: readonly string[], prefix: boolean): boolean {
  const last = tokens.length - 1;
  for (let start = 0; start + tokens.length <= field.length; start += 1) {
    if (
      tokens.every((token, offset) =>
        prefix && offset === last
          ? field[start + offset]!.startsWith(token)
          : field[start + offset] === token,
      )
    )
      return true;
  }
  return false;
}

/**
 * Does any group match, and how strongly?
 *
 * `null` is "no match". The score is the number of positive terms in the best-scoring group, less
 * a half for a term found only as the start of a longer word, so among photos matching the same
 * number of terms a whole word ranks first. A phrase is matched WITHIN one translation of the name,
 * so it cannot straddle two.
 */
function scoreSearch(
  groups: readonly QueryItem[][],
  names: readonly (readonly string[])[],
): number | null {
  let best: number | null = null;
  for (const group of groups) {
    let score = 0;
    let matched = true;
    for (const item of group) {
      const whole = names.some((name) => fieldHolds(name, item.tokens, false));
      const found =
        whole || (item.prefix && names.some((name) => fieldHolds(name, item.tokens, true)));
      if (item.negated === found) {
        matched = false;
        break;
      }
      if (!item.negated) score += whole ? 1 : 0.5;
    }
    if (matched && (best === null || score > best)) best = score;
  }
  return best;
}

export interface ListImagesOptions {
  query?: string;
  sort?: "relevance" | "date" | "name";
  direction?: "asc" | "desc";
  offset?: number;
  limit?: number;
  language?: string;
  fallbackLanguage?: string;
}

/**
 * The image library's list: search, ordering and one page.
 *
 * **The name ordering is JavaScript's collator:** SQLite ships `BINARY`, `NOCASE` and `RTRIM` and
 * nothing accent-aware.
 */
export async function listImages(
  tx: Transaction,
  options: ListImagesOptions = {},
): Promise<{ images: ImageRecord[]; total: number }> {
  const typed = options.query ?? "";
  const query = typed.trim();
  const sort = options.sort ?? (query ? "relevance" : "date");
  const direction = options.direction ?? (sort === "name" ? "asc" : "desc");
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 40;
  if (
    typed.length > 500 ||
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
  // Untrimmed, so a trailing space still finishes the last word.
  const groups = query ? parseSearch(typed) : [];

  if (!query && effectiveSort === "date") {
    const [{ total }] = await tx.select({ total: count() }).from(mediaImages);
    const page = await datedImagePageQuery(tx, direction, offset, limit);
    const usage = await countUsages(
      tx,
      page.map((row) => row.filename),
    );
    return {
      images: page.map((row) => ({ ...row, usageCount: usage.get(row.filename) ?? 0 })),
      total,
    };
  }

  const rows = await tx.select(IMAGE_LIST_COLUMNS).from(mediaImages);

  const matched: { row: (typeof rows)[number]; score: number }[] = [];
  for (const row of rows) {
    if (!query) {
      matched.push({ row, score: 0 });
      continue;
    }
    const score = scoreSearch(
      groups,
      Object.values(row.names).map((name) => searchTokens(name)),
    );
    if (score !== null) matched.push({ row, score });
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
 * How many products (variants among them), sections, include folders, live or queued menu versions
 * and receipt logos name each of `filenames`.
 *
 * The reads count the sources `listImageUsages` lists, and a source added there is added here too
 * — or the library shows a free photo that then refuses to delete. They are separate statements on
 * one transaction and are awaited in turn, never `Promise.all` (`CLAUDE.md` §3).
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
    .select({ image: sections.image })
    .from(sections)
    .where(inArray(sections.image, wanted))) {
    tally(row.image);
  }
  for (const row of await tx
    .select({ image: folderImage })
    .from(sectionMembers)
    .where(inArray(folderImage, wanted))) {
    tally(row.image);
  }
  for (const row of await tx
    .select({ image: menuVersionImages.filename })
    .from(menuVersionImages)
    .innerJoin(menuPublications, eq(menuPublications.versionId, menuVersionImages.versionId))
    .where(inArray(menuVersionImages.filename, wanted))) {
    tally(row.image);
  }
  for (const row of await tx
    .select({ image: menuVersionImages.filename })
    .from(menuVersionImages)
    .innerJoin(
      menuScheduledPublications,
      eq(menuScheduledPublications.versionId, menuVersionImages.versionId),
    )
    .where(
      and(
        inArray(menuVersionImages.filename, wanted),
        eq(menuScheduledPublications.state, "queued"),
      ),
    )) {
    tally(row.image);
  }
  for (const row of await tx
    .select({ image: receiptLogo })
    .from(tenantReceipts)
    .where(inArray(receiptLogo, wanted))) {
    tally(row.image);
  }
  return counts;
}

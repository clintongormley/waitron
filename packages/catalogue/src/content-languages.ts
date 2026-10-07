import type { Transaction } from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  FALLBACK_LOCALE,
  resolveContentText,
  type ContentLanguages,
} from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { contentLanguages } from "./schema/menu.js";
import "./errors.js";

/**
 * Validate several translated maps against the venue's content languages in one pass, reading the
 * configuration ONCE however many maps are handed in. Returns the INDEX of the first map with no
 * text in the default language, with that language, or null when every map is satisfied — so a
 * caller with several fields can name which one is missing. A key that is not a language code, or a
 * value that is not text, is still refused outright.
 *
 * The single read is safe because nothing else can write the configuration while this transaction
 * runs: `withTransaction` (`packages/db/src/tenancy.ts`) opens its body inside the venue file's
 * write queue, which admits one write transaction at a time
 * (`packages/store/src/write-queue.ts`).
 */
export async function findContentTranslationGap(
  tx: Transaction,
  maps: readonly Readonly<Record<string, string>>[],
  fallbackLanguage: string,
): Promise<{ index: number; language: string } | null> {
  return contentTranslationGap(maps, await readContentLanguages(tx, fallbackLanguage));
}

/** {@link findContentTranslationGap} over a setting the caller has already read. */
export function contentTranslationGap(
  maps: readonly Readonly<Record<string, string>>[],
  config: ContentLanguages,
): { index: number; language: string } | null {
  for (const map of maps)
    for (const [language, value] of Object.entries(map)) {
      contentLanguageCode(language);
      if (typeof value !== "string") throw new AppError("content.translation_invalid", {});
    }
  const index = maps.findIndex(
    (map) => resolveContentText(map, config.defaultLanguage, config.defaultLanguage) === "",
  );
  return index === -1 ? null : { index, language: config.defaultLanguage };
}

/** {@link contentTranslationGap}, with the gap thrown rather than reported. */
export function assertContentTranslations(
  maps: readonly Readonly<Record<string, string>>[],
  config: ContentLanguages,
): void {
  const gap = contentTranslationGap(maps, config);
  if (gap) throw new AppError("content.translation_required", { language: gap.language });
}

/** The single-map form: the gap is thrown rather than reported. */
export async function validateContentTranslations(
  tx: Transaction,
  translations: Readonly<Record<string, string>>,
  fallbackLanguage: string,
): Promise<void> {
  assertContentTranslations([translations], await readContentLanguages(tx, fallbackLanguage));
}

/** A variant's gap names the product it belongs to, whose editor holds it. */
export async function listContentTranslationGaps(
  tx: Transaction,
  language: string,
): Promise<{ kind: string; id: string; productId?: string }[]> {
  const code = contentLanguageCode(language);
  return contentTranslationGapsIn(await readContentTranslationCandidates(tx), code);
}

export type ContentTranslationCandidate = {
  kind: string;
  id: string;
  product_id: string | null;
  translations: string;
};

/** Every row {@link listContentTranslationGaps} checks, with the map it checks, whatever the language. */
export async function readContentTranslationCandidates(
  tx: Transaction,
): Promise<ContentTranslationCandidate[]> {
  // `product`, `variant`, `option_list`, `option_label`, `extra_list` and `menu_section` are the
  // kinds whose customer-facing name is optional, so the query filters a wholly-absent one (null or {}) out of
  // them: absent is not a gap, only a partly filled map is. The unfiltered `unit` kind
  // has no optional customer name; its name stays required.
  // `translations` arrives as the JSON TEXT the column stores: this is a raw statement, so no
  // drizzle column mapping runs over the result.
  // A variant is a `products` row with a `parent_id`, so the product branch keeps to top-level
  // rows and the variant branch to the rest; otherwise each variant would be counted twice. A
  // disabled variant is on no menu offer, so a language it lacks reaches no diner and must
  // not block a change of default.
  // A `menu_include` is the folder an include shows: the included menu's names with the ones the
  // include fixes in their place. It counts while the include shows its sections directly too,
  // because switching the folder back on restores the fixed names. An include fixing no name
  // patches with null, which `json_patch` answers with null, so it is left to the included menu's
  // own row. A map that is blank throughout shows no customer name, so like an absent one it is no
  // gap.
  const result = await tx.execute<ContentTranslationCandidate>(sql`
    select 'product' as kind, id, null as product_id, customer_name as translations from products
      where parent_id is null and customer_name is not null and customer_name <> '{}'
    union all select 'unit' as kind, id, null, name as translations from units
    union all select 'variant' as kind, id, parent_id, customer_name as translations from products
      where parent_id is not null and active = 1
        and customer_name is not null and customer_name <> '{}'
    union all select 'option_list' as kind, id, null, customer_name as translations
      from option_lists where customer_name is not null and customer_name <> '{}'
    union all select 'option_label' as kind, id, null, customer_name as translations
      from option_labels where customer_name is not null and customer_name <> '{}'
    union all select 'extra_list' as kind, id, null, customer_name as translations
      from extra_lists where customer_name is not null and customer_name <> '{}'
    union all select 'menu_section' as kind, id, null, names as translations
      from sections where role in ('section', 'menu_root') and names <> '{}'
    union all select 'menu_include' as kind, m.id, null,
        json_patch(s.names, json_extract(m.folder_overrides, '$.names')) as translations
      from section_members m join sections s on s.id = m.child_section_id
      where s.role = 'menu_root'
        and exists (
          select 1 from json_each(json_patch(s.names, json_extract(m.folder_overrides, '$.names')))
          where trim(value) <> ''
        )
  `);
  return result.rows;
}

/** The candidates with no text in `code`, in the order they were read. */
export function contentTranslationGapsIn(
  candidates: readonly ContentTranslationCandidate[],
  code: string,
): { kind: string; id: string; productId?: string }[] {
  return candidates
    .filter(
      (row) =>
        resolveContentText(JSON.parse(row.translations) as Record<string, string>, code, code) ===
        "",
    )
    .map(({ kind, id, product_id }) =>
      product_id === null ? { kind, id } : { kind, id, productId: product_id },
    );
}

export async function readContentLanguages(
  tx: Transaction,
  fallbackLanguage: string,
): Promise<ContentLanguages> {
  return contentLanguagesOr(await readSavedContentLanguages(tx), fallbackLanguage);
}

/** The saved content-language setting, or `undefined` when none is saved. */
export async function readSavedContentLanguages(
  tx: Transaction,
): Promise<ContentLanguages | undefined> {
  const [row] = await tx
    .select({
      defaultLanguage: contentLanguages.defaultLanguage,
      languages: contentLanguages.languages,
    })
    .from(contentLanguages)
    .where(eq(contentLanguages.id, 1));
  return row;
}

/** `saved`, or, when none is saved, `fallbackLanguage`'s language alone. */
export function contentLanguagesOr(
  saved: ContentLanguages | undefined,
  fallbackLanguage: string,
): ContentLanguages {
  if (saved) return saved;
  let defaultLanguage: string;
  try {
    defaultLanguage = contentLanguageCode(fallbackLanguage);
  } catch {
    // A missing setting must not turn a malformed display preference into a sale failure.
    defaultLanguage = contentLanguageCode(FALLBACK_LOCALE);
  }
  return { defaultLanguage, languages: [defaultLanguage] };
}

export async function writeContentLanguages(
  tx: Transaction,
  config: ContentLanguages,
  fallbackLanguage = config.defaultLanguage,
  additionalGaps?: (tx: Transaction, language: string) => Promise<{ kind: string; id: string }[]>,
  requiredLanguages: readonly string[] = [],
): Promise<void> {
  const defaultLanguage = contentLanguageCode(config.defaultLanguage);
  const languages = config.languages.map(contentLanguageCode);
  if (
    !languages.includes(defaultLanguage) ||
    languages.length > 200 ||
    new Set(languages).size !== languages.length
  ) {
    throw new AppError("content.languages_invalid", {});
  }
  const missing = requiredLanguages.find((language) => !languages.includes(language));
  if (missing !== undefined) throw new AppError("content.language_required", { language: missing });
  const previous = await readContentLanguages(tx, fallbackLanguage);
  if (previous.defaultLanguage !== defaultLanguage) {
    const gaps = [
      ...(await listContentTranslationGaps(tx, defaultLanguage)),
      ...((await additionalGaps?.(tx, defaultLanguage)) ?? []),
    ];
    if (gaps.length > 0)
      throw new AppError("content.default_missing", {
        language: defaultLanguage,
        count: gaps.length,
      });
  }
  const values = {
    defaultLanguage,
    languages: [defaultLanguage, ...languages.filter((language) => language !== defaultLanguage)],
  };
  await tx
    .insert(contentLanguages)
    .values(values)
    .onConflictDoUpdate({ target: contentLanguages.id, set: values });
}

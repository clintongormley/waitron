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
 * Validate several translated maps against the venue's content languages in one pass, taking the
 * advisory lock and reading the configuration ONCE however many maps are handed in — the lock is
 * what makes every later read redundant, because the configuration cannot change while it is held.
 * Returns the INDEX of the first map with no text in the default language, with that language, or
 * null when every map is satisfied — so a caller with several fields can name which one is missing.
 * A key that is not a language code, or a value that is not text, is still refused outright.
 */
export async function findContentTranslationGap(
  tx: Transaction,
  maps: readonly Readonly<Record<string, string>>[],
  fallbackLanguage: string,
): Promise<{ index: number; language: string } | null> {
  await lockContentLanguages(tx);
  for (const map of maps)
    for (const [language, value] of Object.entries(map)) {
      contentLanguageCode(language);
      if (typeof value !== "string") throw new AppError("content.translation_invalid", {});
    }
  const config = await readContentLanguages(tx, fallbackLanguage);
  const index = maps.findIndex(
    (map) => resolveContentText(map, config.defaultLanguage, config.defaultLanguage) === "",
  );
  return index === -1 ? null : { index, language: config.defaultLanguage };
}

/** The single-map form: the gap is thrown rather than reported. */
export async function validateContentTranslations(
  tx: Transaction,
  translations: Readonly<Record<string, string>>,
  fallbackLanguage: string,
): Promise<void> {
  const gap = await findContentTranslationGap(tx, [translations], fallbackLanguage);
  if (gap) throw new AppError("content.translation_required", { language: gap.language });
}

/** Configuration edits and content validation serialize so a new default cannot invalidate a save. */
async function lockContentLanguages(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"content-languages"}, 0))`);
}

export async function listContentTranslationGaps(
  tx: Transaction,
  language: string,
): Promise<{ kind: string; id: string }[]> {
  const code = contentLanguageCode(language);
  // `product`, `variant`, `option_list`, `option_label` and `extra_list` are the kinds whose
  // customer-facing name is optional, so the query filters a wholly-absent one (null or {}) out of
  // them: absent is not a gap, only a partly filled map is. The kinds it emits unfiltered —
  // `category`, `unit` and `section` — have no optional customer name;
  // their name is the only text they have and stays required. `extra_list_items` is in neither
  // group because it holds no name at all: its columns are id, list_id, product_id, sort,
  // max_quantity, preselected and price (drizzle/0000_catalogue_baseline.sql), so there is no map here for
  // this report to read.
  const result = await tx.execute<{
    kind: string;
    id: string;
    translations: Record<string, string>;
  }>(sql`
    select 'product' as kind, id, customer_name as translations from products
      where customer_name is not null and customer_name <> '{}'::jsonb
    union all select 'category' as kind, id, name as translations from categories
    union all select 'unit' as kind, id, name as translations from units
    union all select 'variant' as kind, id, customer_name as translations from product_variants
      where customer_name is not null and customer_name <> '{}'::jsonb
    union all select 'section' as kind, id, name as translations from menu_sections
    union all select 'option_list' as kind, id, customer_name as translations from option_lists
      where customer_name is not null and customer_name <> '{}'::jsonb
    union all select 'option_label' as kind, id, customer_name as translations from option_labels
      where customer_name is not null and customer_name <> '{}'::jsonb
    union all select 'extra_list' as kind, id, customer_name as translations from extra_lists
      where customer_name is not null and customer_name <> '{}'::jsonb
  `);
  return result.rows
    .filter((row) => resolveContentText(row.translations, code, code) === "")
    .map(({ kind, id }) => ({ kind, id }));
}

export async function readContentLanguages(
  tx: Transaction,
  fallbackLanguage: string,
): Promise<ContentLanguages> {
  const [row] = await tx
    .select({
      defaultLanguage: contentLanguages.defaultLanguage,
      languages: contentLanguages.languages,
    })
    .from(contentLanguages)
    .where(eq(contentLanguages.id, 1));
  if (row) return row;
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
  await lockContentLanguages(tx);
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

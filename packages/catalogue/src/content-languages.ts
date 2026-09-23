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
 * (`packages/store/src/write-queue.ts`). That is what an advisory lock taken here used to arrange.
 */
export async function findContentTranslationGap(
  tx: Transaction,
  maps: readonly Readonly<Record<string, string>>[],
  fallbackLanguage: string,
): Promise<{ index: number; language: string } | null> {
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

/** A variant's gap names the product it belongs to, whose editor holds it. */
export async function listContentTranslationGaps(
  tx: Transaction,
  language: string,
): Promise<{ kind: string; id: string; productId?: string }[]> {
  const code = contentLanguageCode(language);
  // `product`, `variant`, `option_list`, `option_label` and `extra_list` are the kinds whose
  // customer-facing name is optional, so the query filters a wholly-absent one (null or {}) out of
  // them: absent is not a gap, only a partly filled map is. The kinds it emits unfiltered —
  // `category`, `unit` and `section` — have no optional customer name;
  // their name is the only text they have and stays required. `extra_list_items` is in neither
  // group because it holds no name at all: its columns are id, list_id, product_id, sort,
  // max_quantity, preselected and price (drizzle/0000_catalogue_baseline.sql), so there is no map
  // here for this report to read.
  // `translations` arrives as the JSON TEXT the column stores: this is a raw statement, so no
  // drizzle column mapping runs over the result, and `json()` columns are plain `text` here
  // (`packages/db/src/schema/columns.ts`). It is parsed below rather than compared as text.
  // A variant is a `products` row with a `parent_id`, so the product branch keeps to top-level
  // rows and the variant branch to the rest; otherwise each variant would be counted twice. An
  // Inactive (removed) variant is on no menu offer (`readOfferVariants`, operations.ts), so a
  // language it lacks reaches no diner and must not block a change of default.
  const result = await tx.execute<{
    kind: string;
    id: string;
    product_id: string | null;
    translations: string;
  }>(sql`
    select 'product' as kind, id, null as product_id, customer_name as translations from products
      where parent_id is null and customer_name is not null and customer_name <> '{}'
    union all select 'category' as kind, id, null, name as translations from categories
    union all select 'unit' as kind, id, null, name as translations from units
    union all select 'variant' as kind, id, parent_id, customer_name as translations from products
      where parent_id is not null and active = 1
        and customer_name is not null and customer_name <> '{}'
    union all select 'section' as kind, id, null, name as translations from menu_sections
    union all select 'option_list' as kind, id, null, customer_name as translations
      from option_lists where customer_name is not null and customer_name <> '{}'
    union all select 'option_label' as kind, id, null, customer_name as translations
      from option_labels where customer_name is not null and customer_name <> '{}'
    union all select 'extra_list' as kind, id, null, customer_name as translations
      from extra_lists where customer_name is not null and customer_name <> '{}'
  `);
  return result.rows
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

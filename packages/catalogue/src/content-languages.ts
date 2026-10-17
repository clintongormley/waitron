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
import { liveTranslationRows } from "./content-translation-candidates.js";
import { TRANSLATION_GAP_KINDS } from "./content-translation-kinds.js";
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
  abbreviations: string | null;
};

/** Every row {@link listContentTranslationGaps} checks, with the map it checks, whatever the language. */
export async function readContentTranslationCandidates(
  tx: Transaction,
): Promise<ContentTranslationCandidate[]> {
  const result = await tx.execute<ContentTranslationCandidate>(sql`
    select case when kind in ('menu', 'section') then 'menu_section'
      when kind = 'included_menu' then 'menu_include' else kind end as kind,
      id, case when kind = 'variant' then owner else null end as product_id,
      coalesce(case when kind = 'included_menu' then json_patch(inherited, names)
        else names end, '{}') as translations, abbreviations
    from (${liveTranslationRows(TRANSLATION_GAP_KINDS)})
    where kind <> 'included_menu' or exists (select 1 from json_each(names))
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
          "" ||
        (row.kind === "unit" &&
          resolveContentText(
            JSON.parse(row.abbreviations ?? "{}") as Record<string, string>,
            code,
            code,
          ) === ""),
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
  const values = {
    defaultLanguage,
    languages: [defaultLanguage, ...languages.filter((language) => language !== defaultLanguage)],
  };
  await tx
    .insert(contentLanguages)
    .values(values)
    .onConflictDoUpdate({ target: contentLanguages.id, set: values });
}

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

export async function validateContentTranslations(
  tx: Transaction,
  tenantId: string,
  translations: Readonly<Record<string, string>>,
  fallbackLanguage: string,
): Promise<void> {
  await lockContentLanguages(tx, tenantId);
  for (const [language, value] of Object.entries(translations)) {
    contentLanguageCode(language);
    if (typeof value !== "string") throw new AppError("content.translation_invalid", {});
  }
  const config = await readContentLanguages(tx, tenantId, fallbackLanguage);
  if (resolveContentText(translations, config.defaultLanguage, config.defaultLanguage) === "") {
    throw new AppError("content.translation_required", { language: config.defaultLanguage });
  }
}

/** Configuration edits and content validation serialize so a new default cannot invalidate a save. */
async function lockContentLanguages(tx: Transaction, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`content-languages:${tenantId}`}, 0))`,
  );
}

export async function listContentTranslationGaps(
  tx: Transaction,
  tenantId: string,
  language: string,
): Promise<{ kind: string; id: string }[]> {
  const code = contentLanguageCode(language);
  const result = await tx.execute<{
    kind: string;
    id: string;
    translations: Record<string, string>;
  }>(sql`
    select 'product' as kind, id, descriptions as translations from products where tenant_id = ${tenantId}
    union all select 'section' as kind, id, name as translations from menu_sections where tenant_id = ${tenantId}
    union all select 'option_group' as kind, id, name as translations from option_groups where tenant_id = ${tenantId}
    union all select 'option' as kind, id, name as translations from option_group_items where tenant_id = ${tenantId}
  `);
  return result.rows
    .filter((row) => resolveContentText(row.translations, code, code) === "")
    .map(({ kind, id }) => ({ kind, id }));
}

export async function readContentLanguages(
  tx: Transaction,
  tenantId: string,
  fallbackLanguage: string,
): Promise<ContentLanguages> {
  const [row] = await tx
    .select({
      defaultLanguage: contentLanguages.defaultLanguage,
      languages: contentLanguages.languages,
    })
    .from(contentLanguages)
    .where(eq(contentLanguages.tenantId, tenantId));
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
  tenantId: string,
  config: ContentLanguages,
  fallbackLanguage = config.defaultLanguage,
  additionalGaps?: (
    tx: Transaction,
    tenantId: string,
    language: string,
  ) => Promise<{ kind: string; id: string }[]>,
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
  await lockContentLanguages(tx, tenantId);
  const previous = await readContentLanguages(tx, tenantId, fallbackLanguage);
  if (previous.defaultLanguage !== defaultLanguage) {
    const gaps = [
      ...(await listContentTranslationGaps(tx, tenantId, defaultLanguage)),
      ...((await additionalGaps?.(tx, tenantId, defaultLanguage)) ?? []),
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
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: contentLanguages.tenantId, set: values });
}

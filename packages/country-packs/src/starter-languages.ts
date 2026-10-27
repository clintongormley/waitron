import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import {
  resolveInstalledCountryLocale,
  resolveInstalledStartingContentLanguages,
} from "./registry.js";

/** Every language other than English that a new venue can start with in an installed pack's area. */
export const STARTER_CONTENT_LANGUAGES = ["es", "ca", "ca-ES-valencia", "gl"] as const;
export type StarterContentLanguage = (typeof STARTER_CONTENT_LANGUAGES)[number];
/** The staff screens' languages (`SUPPORTED_LOCALES`), as language subtags. */
export type StarterStaffLanguage = "es" | "en";
/** A starter's words in other languages, keyed by its English text. */
export type StarterTranslations<L extends string> = Readonly<
  Record<string, Readonly<Record<L, string>>>
>;
export interface StarterLanguages {
  /** The venue's starting content languages, English included. */
  readonly languages: readonly string[];
  readonly staffLanguage: StarterStaffLanguage;
}

export function resolveInstalledStarterLanguages(input: {
  readonly country?: string | null;
  readonly area?: string | null;
  readonly receiptLocale?: string | null;
}): StarterLanguages {
  const { country, area, receiptLocale } = input;
  const locale = resolveInstalledCountryLocale(SUPPORTED_LOCALE_CODES, {
    override: receiptLocale,
    country,
    area,
    fallback: FALLBACK_LOCALE,
  });
  return {
    languages: resolveInstalledStartingContentLanguages({ country, area }).languages,
    staffLanguage: locale.split("-")[0] as StarterStaffLanguage,
  };
}

/** `english` under `en`, and its text in each of `languages` its entry has; nothing else. */
export function starterNames(
  file: StarterTranslations<string>,
  english: string,
  languages: readonly string[],
): Record<string, string> {
  const entry = file[english];
  const names: Record<string, string> = { en: english };
  for (const language of languages) {
    const text = entry?.[language];
    if (text !== undefined) names[language] = text;
  }
  return names;
}

/** Its text in the staff language; `english` for `en` or a starter with no entry. */
export function starterName(
  file: StarterTranslations<string>,
  english: string,
  staffLanguage: StarterStaffLanguage,
): string {
  if (staffLanguage === "en") return english;
  return file[english]?.[staffLanguage] ?? english;
}

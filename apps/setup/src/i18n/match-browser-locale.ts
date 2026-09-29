import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES, type SupportedLocale } from "@waitron/shared";

const language = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/**
 * The first of the browser's languages the wizard speaks, in any region. `navigator.languages` is
 * the list the browser builds its `Accept-Language` header from.
 */
export function matchBrowserLocale(languages: readonly string[]): SupportedLocale {
  for (const tag of languages) {
    const match = SUPPORTED_LOCALE_CODES.find((code) => language(code) === language(tag));
    if (match !== undefined) return match;
  }
  return FALLBACK_LOCALE;
}

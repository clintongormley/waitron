import { readTaxpayer, type Transaction } from "@waitron/db";
import { readContentLanguages } from "@waitron/menu";
import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import { kitchenLanguageFor } from "./i18n/kitchen-ticket.js";

export function kitchenLocaleFor(
  language: string,
  country: string | null,
  supported: readonly string[],
): string {
  const matches = supported.filter((locale) => new Intl.Locale(locale).language === language);
  return (
    matches.find((locale) => new Intl.Locale(locale).region === country) ??
    matches[0] ??
    FALLBACK_LOCALE
  );
}

export async function readKitchenLanguage(tx: Transaction): Promise<string> {
  const language = kitchenLanguageFor(
    (await readContentLanguages(tx, FALLBACK_LOCALE)).defaultLanguage,
  );
  const country = (await readTaxpayer(tx))?.country ?? null;
  return kitchenLocaleFor(language, country, SUPPORTED_LOCALE_CODES);
}

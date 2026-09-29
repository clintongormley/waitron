import { FALLBACK_LOCALE, type SupportedLocale } from "@waitron/shared";

/** The wizard is not translated, so it uses the locale the other apps fall back to. */
export const WIZARD_LOCALE: SupportedLocale = FALLBACK_LOCALE;

const regionNames = new Map<string, Intl.DisplayNames>();

/**
 * A configuration import can put any value in the draft's country, so a value the browser cannot
 * name is shown as stored.
 */
export function countryName(code: string, locale: string): string {
  try {
    let names = regionNames.get(locale);
    if (names === undefined) {
      names = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
      regionNames.set(locale, names);
    }
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

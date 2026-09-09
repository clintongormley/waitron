import { AppError } from "./errors.js";

/**
 * The languages the apps can actually render (a catalogue exists for each).
 * `label` is the language's own endonym, shown in the picker. Adding a locale
 * is: a catalogue in each app's strings.ts + one entry here — no migration.
 */
export const SUPPORTED_LOCALES = [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

export const SUPPORTED_LOCALE_CODES: readonly string[] = SUPPORTED_LOCALES.map((l) => l.code);

/** The absolute floor — reached only when neither province nor country yields
 * an available language. */
export const FALLBACK_LOCALE: SupportedLocale = "en-GB";

export function isSupportedLocale(code: string | null | undefined): code is SupportedLocale {
  return code != null && SUPPORTED_LOCALE_CODES.includes(code);
}

/** Validate a locale being written. Throws rather than falls back — a write of
 * an unknown locale is a bug, not a preference. */
export function assertSupportedLocale(code: string): SupportedLocale {
  if (!isSupportedLocale(code)) throw new AppError("locale.unsupported", { locale: code });
  return code;
}

/**
 * The active UI language for a person: their supported choice, else the venue
 * default (itself already supported), else the English floor. Never returns an
 * unsupported code.
 */
export function resolveActiveLocale(
  personLocale: string | null | undefined,
  venueLocale: string,
): SupportedLocale {
  if (isSupportedLocale(personLocale)) return personLocale;
  if (isSupportedLocale(venueLocale)) return venueLocale;
  return FALLBACK_LOCALE;
}

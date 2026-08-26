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

/** country → its default UI language. One meaningful entry today; a country
 * absent here falls through to FALLBACK_LOCALE. */
export const COUNTRY_DEFAULT_LOCALE: Record<string, string> = { ES: "es-ES" };

/** province → its regional language. DEFERRED: empty until a regional catalogue
 * (e.g. Catalan) ships, so every province falls through to the country step. */
export const PROVINCE_DEFAULT_LOCALE: Record<string, string> = {};

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
 * The venue's default UI language: the first AVAILABLE of
 * override → province language (deferred) → country language → English floor.
 * Always returns a supported code, so the apps never receive `ca-ES`.
 */
export function resolveVenueLocale(input: {
  override?: string | null;
  province?: string | null;
  country?: string | null;
}): SupportedLocale {
  const candidates = [
    input.override ?? undefined,
    input.province != null ? PROVINCE_DEFAULT_LOCALE[input.province] : undefined,
    input.country != null ? COUNTRY_DEFAULT_LOCALE[input.country] : undefined,
  ];
  for (const candidate of candidates) {
    if (isSupportedLocale(candidate)) return candidate;
  }
  return FALLBACK_LOCALE;
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

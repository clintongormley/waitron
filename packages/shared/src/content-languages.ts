import { AppError } from "./errors.js";

export interface ContentLanguages {
  defaultLanguage: string;
  languages: string[];
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

const choicesByLocale = new Map<string, readonly { code: string; name: string }[]>();

/** The picker uses the runtime's named canonical language codes, including three-letter codes. */
export function contentLanguageChoices(displayLocale: string): { code: string; name: string }[] {
  const cached = choicesByLocale.get(displayLocale);
  if (cached) return cached.map((choice) => ({ ...choice }));
  const names = new Intl.DisplayNames([displayLocale], { type: "language", fallback: "none" });
  const choices: { code: string; name: string }[] = [];
  const add = (code: string): void => {
    if (["und", "mul", "zxx"].includes(code)) return;
    const name = names.of(code);
    if (name !== undefined && new Intl.Locale(code).language === code) choices.push({ code, name });
  };
  for (let first = 97; first <= 122; first++) {
    for (let second = 97; second <= 122; second++) {
      const prefix = String.fromCharCode(first, second);
      add(prefix);
      for (let third = 97; third <= 122; third++) add(prefix + String.fromCharCode(third));
    }
  }
  choices.sort((a, b) => a.name.localeCompare(b.name, displayLocale));
  choicesByLocale.set(displayLocale, choices);
  return choices.map((choice) => ({ ...choice }));
}

/** Catalogue translations use language codes; receipt and browser tags can include a region. */
export function contentLanguageCode(value: string): string {
  let language: string;
  try {
    language = new Intl.Locale(value).language;
  } catch {
    throw new AppError("content.language_invalid", {});
  }
  if (["und", "mul", "zxx"].includes(language) || languageNames.of(language) === undefined) {
    throw new AppError("content.language_invalid", {});
  }
  return language;
}

/** Empty translations fall back to the configured default without manufacturing a translation. */
export function resolveContentText(
  translations: Readonly<Record<string, string>>,
  requestedLanguage: string,
  defaultLanguage: string,
): string {
  for (const locale of [requestedLanguage, defaultLanguage]) {
    const language = locale.split("-")[0]!;
    const keys = [
      locale,
      language,
      ...Object.keys(translations)
        .filter((key) => key.startsWith(`${language}-`))
        .sort(),
    ];
    for (const key of keys) {
      if (Object.hasOwn(translations, key) && translations[key]!.trim() !== "") {
        return translations[key]!;
      }
    }
  }
  return "";
}

/** Disabled translations remain stored, but display uses only enabled languages. */
export function resolveEnabledContentText(
  translations: Readonly<Record<string, string>>,
  requestedLanguage: string,
  config: ContentLanguages,
): string {
  let requested = config.defaultLanguage;
  try {
    const locale = new Intl.Locale(requestedLanguage);
    if (config.languages.includes(locale.language)) requested = locale.toString();
  } catch {
    // A malformed display preference uses the same fallback as an unavailable language.
  }
  return resolveContentText(translations, requested, config.defaultLanguage);
}

/** Receipt snapshots retain their stored languages independently of current content settings. */
export function resolveSnapshotText(
  translations: Readonly<Record<string, string>>,
  requestedLanguage: string,
  defaultLanguage: string,
): string {
  let requested = defaultLanguage;
  try {
    requested = new Intl.Locale(requestedLanguage).toString();
  } catch {
    // A malformed interface preference cannot hide a stored receipt name.
  }
  return (
    resolveContentText(translations, requested, defaultLanguage) ||
    Object.keys(translations)
      .sort()
      .map((key) => translations[key]!)
      .find((value) => value.trim() !== "") ||
    ""
  );
}

import { capitaliseFirst } from "./capitalise.js";
import { AppError } from "./errors.js";

export interface ContentLanguages {
  defaultLanguage: string;
  languages: string[];
}

/** The content-language rules for a venue's area, as language codes. */
export interface ContentLanguageRules {
  /** The content-languages route refuses a save that leaves one out. */
  readonly required: readonly string[];
  /** The country's official languages, offered first when adding a language. */
  readonly official: readonly string[];
  /** Shown, never enforced, while fewer than `minimumForeign` enabled languages are outside
   * `official`. `text` is keyed by the dashboard's language code. */
  readonly foreignLanguageNotice?: {
    readonly minimumForeign: number;
    readonly text: Readonly<Record<string, string>>;
  };
}

const VALENCIAN = "ca-ES-valencia";

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

const displayNamesByLocale = new Map<string, Intl.DisplayNames>();

function languageNamesFor(locale: string): Intl.DisplayNames {
  let names = displayNamesByLocale.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: "language", fallback: "none" });
    displayNamesByLocale.set(locale, names);
  }
  return names;
}

const choicesByLocale = new Map<string, readonly { code: string; name: string }[]>();

/** The picker uses the runtime's named canonical language codes, including three-letter codes. */
export function contentLanguageChoices(displayLocale: string): { code: string; name: string }[] {
  const cached = choicesByLocale.get(displayLocale);
  if (cached) return cached.map((choice) => ({ ...choice }));
  const names = languageNamesFor(displayLocale);
  const choices: { code: string; name: string }[] = [];
  const add = (code: string): void => {
    if (["und", "mul", "zxx"].includes(code)) return;
    const name = names.of(code);
    if (name !== undefined && new Intl.Locale(code).language === code)
      choices.push({ code, name: capitaliseFirst(name, displayLocale) });
  };
  for (let first = 97; first <= 122; first++) {
    for (let second = 97; second <= 122; second++) {
      const prefix = String.fromCharCode(first, second);
      add(prefix);
      for (let third = 97; third <= 122; third++) add(prefix + String.fromCharCode(third));
    }
  }
  choices.push({ code: VALENCIAN, name: languageDisplayName(VALENCIAN, displayLocale) });
  choices.sort((a, b) => a.name.localeCompare(b.name, displayLocale));
  choicesByLocale.set(displayLocale, choices);
  return choices.map((choice) => ({ ...choice }));
}

export function contentLanguageCode(value: string): string {
  let language: string;
  try {
    const locale = new Intl.Locale(value);
    if (locale.language === "ca" && locale.baseName.split("-").includes("valencia"))
      return VALENCIAN;
    language = locale.language;
  } catch {
    throw new AppError("content.language_invalid", {});
  }
  if (["und", "mul", "zxx"].includes(language) || languageNames.of(language) === undefined) {
    throw new AppError("content.language_invalid", {});
  }
  return language;
}

/** A tag's language named in `locale`, capitalised when it stands alone rather than inside a
 * sentence. A tag that is not a language, or that `locale` has no name for, comes back as it is. */
export function languageDisplayName(tag: string, locale: string, standalone = true): string {
  let code: string;
  try {
    code = contentLanguageCode(tag);
  } catch {
    return tag;
  }
  const displayLanguage = new Intl.Locale(locale).language;
  const name =
    code === VALENCIAN && (displayLanguage === "en" || displayLanguage === "es")
      ? displayLanguage === "en"
        ? "Valencian"
        : "valenciano"
      : languageNamesFor(locale).of(code);
  if (name === undefined) return tag;
  return standalone ? capitaliseFirst(name, locale) : name;
}

/** Empty translations fall back to the configured default without manufacturing a translation. */
export function resolveContentText(
  translations: Readonly<Record<string, string>>,
  requestedLanguage: string,
  defaultLanguage: string,
): string {
  for (const locale of [requestedLanguage, defaultLanguage]) {
    let language: string;
    try {
      language = contentLanguageCode(locale);
    } catch {
      language = locale.split("-")[0]!;
    }
    const keys = [
      locale,
      language,
      ...Object.keys(translations)
        .filter((key) => {
          try {
            return contentLanguageCode(key) === language;
          } catch {
            return key.startsWith(`${language}-`);
          }
        })
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
    if (config.languages.includes(contentLanguageCode(requestedLanguage)))
      requested = locale.toString();
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

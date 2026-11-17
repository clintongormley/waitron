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

export interface ContentLanguagePresentation {
  readonly officialLocales: readonly string[];
  readonly names: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

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

export function contentLanguageChoices(
  displayLocale: string,
  presentation?: ContentLanguagePresentation,
): { code: string; name: string }[] {
  let cached = choicesByLocale.get(displayLocale);
  if (!cached) {
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
    choices.sort((a, b) => a.name.localeCompare(b.name, displayLocale));
    choicesByLocale.set(displayLocale, choices);
    cached = choices;
  }
  const choices = cached.map((choice) => ({ ...choice }));
  for (const tag of presentation?.officialLocales ?? []) {
    const code = contentLanguageCode(tag);
    if (code !== new Intl.Locale(tag).language && !choices.some((choice) => choice.code === code))
      choices.push({ code, name: contentLanguageDisplayName(code, displayLocale, presentation) });
  }
  if (presentation) choices.sort((a, b) => a.name.localeCompare(b.name, displayLocale));
  return choices;
}

function tagWithoutExtensions(locale: Intl.Locale): string {
  // Runtime aliases can leave extensions in baseName.
  return locale.toString().split(/-[a-z0-9]-/i, 1)[0]!;
}

export function contentLanguageCode(value: string): string {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(value);
  } catch {
    throw new AppError("content.language_invalid", {});
  }
  if (
    ["und", "mul", "zxx"].includes(locale.language) ||
    languageNames.of(locale.language) === undefined
  ) {
    throw new AppError("content.language_invalid", {});
  }
  const tag = tagWithoutExtensions(locale);
  const variant = tag
    .split("-")
    .slice(1)
    .some((part) => /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/i.test(part));
  return variant ? tag : locale.language;
}

export function isRegionalContentLanguage(tag: string): boolean {
  try {
    return contentLanguageTag(tag) !== contentLanguageCode(tag);
  } catch {
    return false;
  }
}

export function mainContentLanguages(languages: readonly string[]): string[] {
  return languages.filter((language) => !isRegionalContentLanguage(language));
}

export function contentLanguageTag(value: string): string {
  contentLanguageCode(value);
  return tagWithoutExtensions(new Intl.Locale(value));
}

/** A tag's language named in `locale`, capitalised when it stands alone rather than inside a
 * sentence. A tag that is not a language, or that `locale` has no name for, comes back as it is. */
export function languageDisplayName(
  tag: string,
  locale: string,
  standalone = true,
  presentation?: ContentLanguagePresentation,
): string {
  let code: string;
  try {
    code = contentLanguageCode(tag);
  } catch {
    return tag;
  }
  const displayLanguage = new Intl.Locale(locale).language;
  const name = presentation?.names[code]?.[displayLanguage] ?? languageNamesFor(locale).of(code);
  if (name === undefined) return tag;
  return standalone ? capitaliseFirst(name, locale) : name;
}

export function contentLanguageDisplayName(
  tag: string,
  locale: string,
  presentation?: ContentLanguagePresentation,
): string {
  const name = languageDisplayName(tag, locale, true, presentation);
  if (!isRegionalContentLanguage(tag)) return name;
  const region = new Intl.Locale(tag).region;
  if (region === undefined) return name;
  return `${name} (${new Intl.DisplayNames([locale], { type: "region" }).of(region)})`;
}

/**
 * Empty translations fall back to the configured default without manufacturing a translation.
 * A tag with no region also takes any region of its language, since receipt snapshots are keyed
 * by full tags (`ca` reaches `ca-ES`).
 */
export function resolveContentText(
  translations: Readonly<Record<string, string>>,
  requestedLanguage: string,
  defaultLanguage: string,
): string {
  for (const locale of [requestedLanguage, defaultLanguage]) {
    let language: string;
    let bare: boolean;
    try {
      language = contentLanguageCode(locale);
      bare = new Intl.Locale(locale).toString() === language;
    } catch {
      language = locale.split("-")[0]!;
      bare = !locale.includes("-");
    }
    const keys = [
      locale,
      language,
      ...Object.keys(bare ? translations : {})
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
    const tag = contentLanguageTag(requestedLanguage);
    const main = contentLanguageCode(tag);
    if (config.languages.includes(tag)) requested = tag;
    else if (config.languages.includes(main)) requested = main;
  } catch {
    // A malformed display preference uses the same fallback as an unavailable language.
  }
  for (const key of [requested, contentLanguageCode(requested), config.defaultLanguage]) {
    if (Object.hasOwn(translations, key) && translations[key]!.trim() !== "")
      return translations[key]!;
  }
  return "";
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

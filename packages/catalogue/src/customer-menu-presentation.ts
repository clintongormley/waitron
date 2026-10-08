import {
  compareDecimal,
  contentLanguageCode,
  decimal,
  resolveContentText,
  type ContentLanguages,
} from "@waitron/shared";
import type { FrozenOffer } from "./menu-document-types.js";

export type MenuView = { kind: "internal" } | { kind: "customer"; language: string };
export interface MenuText {
  text: string;
  origin: "requested" | "default" | "staff" | "missing";
  language: string | null;
  missingRequested: boolean;
}

function textInLanguage(
  map: Readonly<Record<string, string>>,
  locale: string,
): { text: string; language: string } | null {
  const language = contentLanguageCode(locale);
  const keys = [
    locale,
    language,
    ...Object.keys(map)
      .filter((key) => key.startsWith(`${language}-`))
      .sort(),
  ];
  for (const key of keys) {
    if (!Object.hasOwn(map, key)) continue;
    const text = resolveContentText({ [key]: map[key]! }, locale, locale);
    if (text !== "") return { text, language: key };
  }
  return null;
}

export function resolveMenuText(
  map: Readonly<Record<string, string>> | null,
  staffName: string | null,
  view: MenuView,
  config: ContentLanguages,
): MenuText {
  if (view.kind === "internal" && staffName !== null)
    return { text: staffName, origin: "staff", language: null, missingRequested: false };
  let requested: string | null = config.defaultLanguage;
  if (view.kind === "customer") {
    try {
      const locale = new Intl.Locale(view.language);
      requested = config.languages.includes(contentLanguageCode(view.language))
        ? locale.toString()
        : null;
    } catch {
      requested = null;
    }
  }
  const translations = map ?? {};
  const selected = requested === null ? null : textInLanguage(translations, requested);
  if (selected !== null) return { ...selected, origin: "requested", missingRequested: false };
  const fallback = textInLanguage(translations, config.defaultLanguage);
  if (fallback !== null) return { ...fallback, origin: "default", missingRequested: true };
  if (staffName !== null)
    return { text: staffName, origin: "staff", language: null, missingRequested: true };
  return { text: "", origin: "missing", language: null, missingRequested: true };
}

export function menuPriceRange(offer: FrozenOffer): { min: string; max: string } {
  const prices =
    offer.variants.length === 0
      ? [offer.unitPrice]
      : offer.variants.map((variant) => variant.unitPrice);
  let min = prices[0]!,
    max = prices[0]!;
  for (const price of prices) {
    if (compareDecimal(decimal(price), decimal(min)) < 0) min = price;
    if (compareDecimal(decimal(price), decimal(max)) > 0) max = price;
  }
  return { min, max };
}

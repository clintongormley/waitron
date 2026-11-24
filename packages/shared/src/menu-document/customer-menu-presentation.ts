import {
  contentLanguageCode,
  contentLanguageTag,
  type ContentLanguages,
} from "../content-languages.js";
import { formatMoney } from "../money-format.js";
import { compareDecimal, decimal } from "../money.js";
import type { FrozenOfferVariant } from "./menu-document-types.js";

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
  for (const key of [locale, language]) {
    if (Object.hasOwn(map, key) && map[key]!.trim() !== "")
      return { text: map[key]!, language: key };
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
      const tag = contentLanguageTag(view.language);
      const main = contentLanguageCode(tag);
      requested = config.languages.includes(tag)
        ? tag
        : config.languages.includes(main)
          ? main
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

export function menuPriceRange(offer: {
  unitPrice: string;
  variants: readonly Pick<FrozenOfferVariant, "unitPrice">[];
}): { min: string; max: string } {
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

export function tilePrice(
  unitPrice: string,
  variants: readonly Pick<FrozenOfferVariant, "unitPrice">[],
  unit: string,
  locale: string,
): string {
  const { min, max } = menuPriceRange({ unitPrice, variants });
  const low = formatMoney(min, locale);
  const price = min === max ? low : `${low}–${formatMoney(max, locale)}`;
  return unit === "" ? price : `${price}/${unit}`;
}

import { resolveSnapshotText } from "@waitron/shared";

export interface ProductPresentation {
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  variantName: string | null;
  variantCustomerName: Record<string, string> | null;
  variantKitchenName: string | null;
}

// A variant is named in full, so a line naming one is shown under the VARIANT's names
// alone, and a blank one falls back to the variant's own staff name, never to the parent's. A line
// naming no variant is shown under the product's names.

export function staffPresentationName(
  p: Pick<ProductPresentation, "name" | "variantName">,
): string {
  return p.variantName || p.name;
}

/**
 * The ONE customer-facing label for a sold line — the printed receipt's line, where the goods are
 * identified for the diner. It is NOT what AEAT is sent. It takes the two SNAPSHOT maps a sold line
 * froze (`descriptions` and `variant_descriptions`) and the variant's frozen staff name, not a live
 * catalogue row, because the caller is rendering something already sold.
 *
 * For a line naming a variant, each locale is the variant's text: a locale missing from its map
 * resolves through `resolveSnapshotText`, which takes any stored language, then falls back to the
 * variant's staff name. The product's text is used only when neither exists.
 *
 * `variant` is `null` for a line that names no variant, and the result is then the product map
 * unchanged.
 */
export function joinCustomerPresentationText(
  product: Readonly<Record<string, string>>,
  variant: Readonly<Record<string, string>> | null,
  variantName: string | null,
): Record<string, string> {
  if (variant === null) return { ...product };
  const locales = new Set([...Object.keys(product), ...Object.keys(variant)]);
  return Object.fromEntries(
    [...locales].map((locale) => [
      locale,
      resolveSnapshotText(variant, locale, locale) ||
        variantName ||
        resolveSnapshotText(product, locale, locale),
    ]),
  );
}

/**
 * A locale->text map that holds no non-blank text anywhere means the same as no map at all, so it
 * folds to `null` here — every caller shares this one fold, which is what stops them disagreeing
 * about whether `{ es: " " }` counts as a value. What the fold's `null` then MEANS is the caller's
 * own concern.
 */
export function nonBlankTranslations<T extends Record<string, string>>(
  map: T | null | undefined,
): T | null {
  return map && Object.values(map).some((text) => text.trim() !== "") ? map : null;
}

/** Each locale of `text` left blank takes `staffName`; every other locale keeps its own text. */
export function fillBlankLocalesWithStaffName(
  text: Readonly<Record<string, string>>,
  staffName: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(text).map(([locale, value]) => [
      locale,
      value.trim() === "" ? staffName : value,
    ]),
  );
}

export function customerPresentationText(
  p: ProductPresentation,
  defaultLanguage: string,
): { product: Record<string, string>; variant: Record<string, string> | null } {
  return {
    product: nonBlankTranslations(p.customerName) ?? { [defaultLanguage]: p.name },
    variant:
      p.variantName === null
        ? null
        : (nonBlankTranslations(p.variantCustomerName) ?? { [defaultLanguage]: p.variantName }),
  };
}

export function kitchenPresentationName(
  p: Pick<ProductPresentation, "name" | "kitchenName" | "variantName" | "variantKitchenName">,
): string {
  if (p.variantName) return p.variantKitchenName?.trim() || p.variantName;
  return p.kitchenName?.trim() || p.name;
}

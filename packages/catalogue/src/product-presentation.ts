import { resolveSnapshotText } from "@waitron/shared";

export interface ProductPresentation {
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  variantName: string | null;
  variantCustomerName: Record<string, string> | null;
  variantKitchenName: string | null;
}

export function staffPresentationName(
  p: Pick<ProductPresentation, "name" | "variantName">,
): string {
  return p.variantName ? `${p.name} (${p.variantName})` : p.name;
}

// Receipt names come from the separate frozen maps, so a live rename cannot alter a reprint.
export function joinCustomerPresentationText(
  product: Readonly<Record<string, string>>,
  variant: Readonly<Record<string, string>> | null,
  variantName: string | null,
): Record<string, string> {
  if (variant === null) return { ...product };
  const locales = new Set([...Object.keys(product), ...Object.keys(variant)]);
  return Object.fromEntries(
    [...locales].map((locale) => {
      const parentText = resolveSnapshotText(product, locale, locale);
      const variantText = resolveSnapshotText(variant, locale, locale) || variantName;
      return [locale, variantText ? `${parentText} (${variantText})` : parentText];
    }),
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
  const parentName = p.kitchenName?.trim() || p.name;
  return p.variantName
    ? `${parentName} (${p.variantKitchenName?.trim() || p.variantName})`
    : parentName;
}

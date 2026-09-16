import { resolveSnapshotText } from "@waitron/shared";

export interface ProductPresentation {
  name: string;
  customerName: Record<string, string> | null;
  kitchenName: string | null;
  variantName: string | null;
  variantCustomerName: Record<string, string> | null;
  variantKitchenName: string | null;
}

// The middot join is the one place "product" and "variant" become one displayed name.
function join(product: string, variant: string | null): string {
  return variant ? `${product} · ${variant}` : product;
}

// Takes only the two staff names, not a whole `ProductPresentation`, so a caller holding a row with
// nothing else on it — a top-sellers row, an image-usage row, a tab line — reaches the one join
// without inventing four empty fields.
export function staffPresentationName(
  p: Pick<ProductPresentation, "name" | "variantName">,
): string {
  return join(p.name, p.variantName);
}

/**
 * The ONE customer-facing label for a line and its variant, joined per locale — the receipt line and
 * the goods description filed with AEAT. It takes the two SNAPSHOT maps a sold line froze
 * (`descriptions` and `variant_descriptions`), not a live catalogue row, because the caller is
 * rendering something already sold.
 *
 * Each side has already had its own fallback applied by {@link customerPresentationText} before
 * being frozen, so nothing falls back again here. A locale missing from one of the maps resolves
 * through `resolveSnapshotText`, which takes any stored language rather than printing a blank half
 * of a name; a variant map that resolves to nothing at all leaves the product's text alone.
 *
 * `variant` is `null` for a line that names no variant, and the result is then the product map
 * unchanged — so a no-variant line renders byte-identically to a line that never had a variant
 * column.
 */
export function joinCustomerPresentationText(
  product: Readonly<Record<string, string>>,
  variant: Readonly<Record<string, string>> | null,
): Record<string, string> {
  if (variant === null) return { ...product };
  const locales = new Set([...Object.keys(product), ...Object.keys(variant)]);
  return Object.fromEntries(
    [...locales].map((locale) => [
      locale,
      join(
        resolveSnapshotText(product, locale, locale),
        resolveSnapshotText(variant, locale, locale) || null,
      ),
    ]),
  );
}

/**
 * A locale->text map that holds no non-blank text anywhere means the same as no map at all, so it
 * folds to `null` here — every caller shares this one fold, which is what stops them disagreeing
 * about whether `{ es: " " }` counts as a value. What the fold's `null` then MEANS is the caller's
 * own concern: a customer-name caller reads it as "fall back to the staff name"; a description
 * caller reads it as "no description stored". This function guarantees only the map-to-`null` fold,
 * not any particular meaning for the result.
 */
export function nonBlankTranslations<T extends Record<string, string>>(
  map: T | null | undefined,
): T | null {
  return map && Object.values(map).some((text) => text.trim() !== "") ? map : null;
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

// Takes only the four names it reads, like {@link staffPresentationName}: a kitchen name carries no
// per-language text, so there is no locale to resolve against and no customer-facing text to fall
// back to. A caller holding a frozen order line passes the row itself.
export function kitchenPresentationName(
  p: Pick<ProductPresentation, "name" | "kitchenName" | "variantName" | "variantKitchenName">,
): string {
  const product = p.kitchenName?.trim() || p.name;
  if (p.variantName === null) return product;
  const variant = p.variantKitchenName?.trim() || p.variantName;
  return join(product, variant);
}

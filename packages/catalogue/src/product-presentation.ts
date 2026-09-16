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

// Takes only the two staff names, not a whole `ProductPresentation`, so a caller holding a row that
// has nothing else on it can reach the one join without inventing four empty fields —
// `listImageUsages` (packages/media/src/images.ts) reads a product name and a variant name out of
// one query and had been passing four `null`s to satisfy the wider signature.
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

export function customerPresentationText(
  p: ProductPresentation,
  defaultLanguage: string,
): { product: Record<string, string>; variant: Record<string, string> | null } {
  const nonEmpty = (m: Record<string, string> | null) =>
    m && Object.values(m).some((t) => t.trim()) ? m : null;
  return {
    product: nonEmpty(p.customerName) ?? { [defaultLanguage]: p.name },
    variant:
      p.variantName === null
        ? null
        : (nonEmpty(p.variantCustomerName) ?? { [defaultLanguage]: p.variantName }),
  };
}

// `locale`/`fallback` are part of the contract shared with the other resolvers, but the kitchen
// name carries no per-language text so this resolver never reads them.
export function kitchenPresentationName(
  p: ProductPresentation,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the interface, see comment above
  _locale: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the interface, see comment above
  _fallback: string,
): string {
  const product = p.kitchenName?.trim() || p.name;
  if (p.variantName === null) return product;
  const variant = p.variantKitchenName?.trim() || p.variantName;
  return join(product, variant);
}

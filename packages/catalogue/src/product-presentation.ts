import { resolveSnapshotText } from "@waitron/shared";

export interface ProductPresentation {
  productName: Record<string, string>;
  variantName: Record<string, string> | null;
  kitchenName: string | null;
}

export function productPresentationName(
  presentation: ProductPresentation,
  locale: string,
  fallback: string,
): string {
  const name = resolveSnapshotText(presentation.productName, locale, fallback);
  return withVariant(name, presentation.variantName, locale, fallback);
}

export function kitchenPresentationName(
  presentation: ProductPresentation,
  locale: string,
  fallback: string,
): string {
  const name =
    presentation.kitchenName?.trim() ||
    resolveSnapshotText(presentation.productName, locale, fallback);
  return withVariant(name, presentation.variantName, locale, fallback);
}

function withVariant(
  name: string,
  variantName: Record<string, string> | null,
  locale: string,
  fallback: string,
): string {
  if (variantName === null) return name;
  const variant = resolveSnapshotText(variantName, locale, fallback);
  return [name, variant].filter(Boolean).join(" · ");
}

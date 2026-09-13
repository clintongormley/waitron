import { currentLocale } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import type { TillProduct } from "../api/client.js";

/** Resolve the operator's translation, then the site's default, then the product id. */
export function productName(product: TillProduct, locale: string = currentLocale()): string {
  return descriptionFor(product.descriptions, product.id, locale);
}

/** Resolve the selected unit through the same content-language fallback as product text. */
export function unitName(product: TillProduct, locale: string = currentLocale()): string {
  const unit = productUnit(product);
  return descriptionFor(unit.name, unit.id, locale);
}

export function productUnit(product: TillProduct): NonNullable<TillProduct["unit"]> {
  return (
    product.unit ??
    (product.pricingUnit === "weight"
      ? {
          id: "00000000-0000-0000-0000-000000000002",
          name: { en: "kg" },
          precision: 3,
          hardwareUnit: "kg" as const,
        }
      : {
          id: "00000000-0000-0000-0000-000000000001",
          name: { en: "each" },
          precision: 0,
          hardwareUnit: null,
        })
  );
}

import { currentLocale } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import type { TillProduct } from "../api/client.js";

/** Resolve the operator's translation, then the site's default, then the product id. */
export function productName(product: TillProduct, locale: string = currentLocale()): string {
  return descriptionFor(product.descriptions, product.id, locale);
}

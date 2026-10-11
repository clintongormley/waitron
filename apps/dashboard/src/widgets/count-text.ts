import { t } from "../i18n/t.js";

export function countOf(
  key:
    | "folders.count"
    | "folders.product_count"
    | "menus.section_count"
    | "product.variant_count"
    | "modifiers.delete_warning_products"
    | "kitchen.delete_course_products",
  count: number,
): string {
  return t(count === 1 ? `${key}_one` : key).replace("{count}", String(count));
}

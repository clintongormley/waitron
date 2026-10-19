import { t } from "../i18n/t.js";

export function countOf(
  key:
    | "folders.count"
    | "folders.product_count"
    | "folders.route_count"
    | "folders.move_heading"
    | "folders.delete_heading"
    | "folders.archive_products_heading"
    | "folders.routes_warning"
    | "folders.selected"
    | "menus.section_count"
    | "menus.delete_sections_heading"
    | "menus.delete_sections_note"
    | "product.variant_count"
    | "modifiers.delete_warning_products"
    | "kitchen.delete_course_products"
    | "kitchen.delete_course_service_steps"
    | "kitchen.delete_course_seated_steps",
  count: number,
): string {
  return t(count === 1 ? `${key}_one` : key).replace("{count}", String(count));
}

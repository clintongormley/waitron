import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in core's set, which classifies them. */
export const MENU_TABLES = [
  "customer_menu_styles",
  "units",
  "menu_items",
  "menu_item_variant_overrides",
  "set_menu_lines",
  "set_menu_line_courses",
  "set_menu_variant_exclusions",
  "option_lists",
  "option_labels",
  "extra_lists",
  "extra_list_items",
  "product_modifiers",
  "sections",
  "section_members",
  "menu_versions",
  "menu_version_images",
  "menu_releases",
  "content_suggestion_jobs",
  "content_suggestions",
] as const;

export const MENU_CHANGE_SOURCES: readonly ChangeSource[] = MENU_TABLES.map((table) => ({
  table,
  type: table,
}));

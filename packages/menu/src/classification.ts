import type { ChangeSource } from "@waitron/shared";

/** The tables this module's code owns. They live in core's set, which classifies them. */
export const CATALOGUE_TABLES = [
  "category_details",
  "catalogue_settings",
  "unit_seed_states",
  "units",
  "product_units",
  "menu_items",
  "menu_item_variant_overrides",
  "option_lists",
  "option_labels",
  "extra_lists",
  "extra_list_items",
  "product_modifiers",
  "sections",
  "section_members",
  "menu_details",
  "menu_versions",
  "menu_version_images",
  "menu_publications",
  "menu_scheduled_publications",
  "content_suggestion_jobs",
  "content_suggestions",
] as const;

export const CATALOGUE_CHANGE_SOURCES: readonly ChangeSource[] = CATALOGUE_TABLES.map((table) => ({
  table,
  type: table,
}));

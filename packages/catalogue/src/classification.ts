import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const STATE = "menu configuration; copied to a standby, never drained back";

export const CATALOGUE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("category_details", "state", STATE),
  classify("product_categories", "state", STATE),
  classify("content_languages", "state", STATE),
  classify("unit_seed_states", "state", STATE),
  classify("units", "state", STATE),
  classify("product_units", "state", STATE),
  classify("product_variants", "state", STATE),
  classify("menu_item_variants", "state", STATE),
  classify("menu_sections", "state", STATE),
  classify("menu_items", "state", STATE),
  classify("menu_item_option_groups", "state", STATE),
  classify("menu_item_options", "state", STATE),
  classify("option_lists", "state", STATE),
  classify("option_labels", "state", STATE),
  classify("extra_lists", "state", STATE),
  classify("extra_list_items", "state", STATE),
];

export const CATALOGUE_CHANGE_SOURCES: readonly ChangeSource[] = CATALOGUE_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);

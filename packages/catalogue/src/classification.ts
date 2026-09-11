import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";
import type { ChangeSource } from "@waitron/shared";

const STATE = "menu configuration; copied to a standby, never drained back";

export const CATALOGUE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("menu_sections", "state", STATE),
  classify("menu_items", "state", STATE),
  classify("menu_item_option_groups", "state", STATE),
  classify("menu_item_options", "state", STATE),
];

export const CATALOGUE_CHANGE_SOURCES: readonly ChangeSource[] = CATALOGUE_CLASSIFICATION.map(
  ({ table }) => ({ table, type: table }),
);

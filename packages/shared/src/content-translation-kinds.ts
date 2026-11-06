import type { TranslationGapKind } from "./content-translation-report-types.js";

/** The translatable kinds, in the order the translations dialog and the report list them. */
export const TRANSLATION_GAP_KINDS = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
] as const satisfies readonly TranslationGapKind[];

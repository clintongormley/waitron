/**
 * The missing-translations report's wire shape, for the dashboard to import. A browser-safe LEAF:
 * type definitions only (`scripts/dashboard-browser-purity.test.ts`).
 */

export type TranslationGapKind =
  | "product"
  | "variant"
  | "option_list"
  | "option_label"
  | "extra_list"
  | "menu"
  | "section"
  | "unit";

/**
 * `partial`: the customer-facing name has text, but none in this language. `absent`: there is no
 * customer-facing name at all, so the staff name is shown in its place. Only `partial` stops a
 * language becoming the default.
 */
export type TranslationGapReason = "partial" | "absent";

export interface TranslationGap {
  kind: TranslationGapKind;
  id: string;
  /** The staff name; a unit has none, so its name in the default language. */
  name: string;
  reason: TranslationGapReason;
  /** Whose editor holds it: a variant's product, an option's list, a section's or root's menu. */
  parent?: { id: string; name: string };
}

export interface LanguageTranslationGaps {
  language: string;
  gaps: TranslationGap[];
}

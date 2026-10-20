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
  | "included_menu"
  | "unit";

export type TranslationGapReason = "partial" | "absent";

export interface TranslationGap {
  kind: TranslationGapKind;
  id: string;
  name: string;
  reason: TranslationGapReason;
  /** Whose editor holds it: a variant's product, an option's list, a section's or root's menu, an
   * included menu's folder's including menu. */
  parent?: { id: string; name: string };
}

export interface LanguageTranslationGaps {
  language: string;
  gaps: TranslationGap[];
}

export interface LanguageTranslationGapCount {
  language: string;
  count: number;
}

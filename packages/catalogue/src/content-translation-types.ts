import type { ContentLanguages } from "@waitron/shared";
import type { TranslationGapKind } from "./content-translation-report-types.js";

/** The most UTF-8 bytes the save route takes in one name. */
export const TRANSLATION_NAME_BYTES = 4096;

export interface TranslationRef {
  kind: TranslationGapKind;
  id: string;
}
export type TranslationField = "name" | "abbreviation";
export interface TranslationCellRef extends TranslationRef {
  language: string;
  field: TranslationField;
}
export type TranslationCellKey = string;
export function translationCellKey(cell: TranslationCellRef): TranslationCellKey {
  return JSON.stringify([cell.kind, cell.id, cell.language, cell.field]);
}
export interface TranslationCell extends TranslationCellRef {
  owners: TranslationOwners | null;
  text: string | null;
  inheritedText: string | null;
  effectiveText: string | null;
  defaultText: string | null;
  inheritedDefaultText: string | null;
  effectiveDefaultText: string | null;
  expected: string;
  staffText: string | null;
  eligible: boolean;
  unavailableReason: "missing" | "inactive" | "ownership" | "role" | "language_disabled" | null;
}
export interface TranslationItem extends TranslationRef {
  name: string;
  parent?: { id: string; name: string };
  owners: TranslationOwners | null;
  cells: TranslationCell[];
}
export type MissingIn = { mode: "any" } | { mode: "language"; language: string } | { mode: "all" };
export type TranslationQuery =
  | { languages: string[]; targets: TranslationRef[] }
  | {
      languages: string[];
      missing: MissingIn;
      kind?: TranslationGapKind;
      search?: string;
      after?: string;
      waitingFixes?: true;
    };
export interface TranslationCellPage {
  config: ContentLanguages;
  required: string[];
  configuration: string;
  cells: TranslationCell[];
}
export interface TranslationItemPage {
  config: ContentLanguages;
  required: string[];
  configuration: string;
  rows: TranslationItem[];
  total: number;
  next: string | null;
}
export type TranslationOwners =
  | { kind: "product"; parentId: null }
  | { kind: "variant"; parentId: string }
  | { kind: "option_list" | "extra_list" | "unit" }
  | { kind: "option_label"; listId: string }
  | { kind: "menu"; menuId: string; rootId: string }
  | { kind: "section"; menuId: string }
  | {
      kind: "included_menu";
      menuId: string;
      sectionId: string;
      includedMenuId: string;
      includedRootId: string;
    };
export interface TranslationCellEdit extends TranslationCellRef {
  expected: string;
  text: string | null;
}
export interface TranslationBatch {
  edits: TranslationCellEdit[];
}

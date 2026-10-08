import type { ContentLanguages } from "@waitron/shared";
import type {
  TranslationGapKind,
  TranslationGapReason,
} from "./content-translation-report-types.js";

export interface TranslationRef {
  kind: TranslationGapKind;
  id: string;
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
export interface TranslationTarget extends TranslationRef {
  name: string;
  parent?: { id: string; name: string };
  reason: TranslationGapReason;
  selectedText: string | null;
  defaultText: string | null;
  effectiveSelectedText: string | null;
  effectiveDefaultText: string | null;
  defaultRequired: boolean;
  eligible: boolean;
  unavailableReason: "missing" | "inactive" | "ownership" | "role" | null;
  owners: TranslationOwners | null;
  expected: string;
}
export interface TranslationPage {
  language: string;
  config: ContentLanguages;
  required: string[];
  rows: TranslationTarget[];
  next: string | null;
  total: number;
}
export interface TranslationEdit extends TranslationRef {
  expected: string;
  text: string;
  defaultText?: string;
}
export interface TranslationBatch {
  edits: TranslationEdit[];
}

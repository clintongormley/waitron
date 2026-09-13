export type LocalizedText = Record<string, string>;
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
export type { DietaryLabel };
export interface EditorVariant {
  id?: string;
  name: LocalizedText;
  unitPrice: string;
  available: boolean;
}
export interface ProductEditorDraft {
  id?: string;
  name: LocalizedText;
  description: LocalizedText | null;
  kitchenName: string | null;
  image: string | null;
  unitId: string;
  unitPrice: string;
  available: boolean;
  vatClass: "general" | "reduced" | "super_reduced" | "zero";
  variants: EditorVariant[];
  categoryIds: string[];
  primaryCategoryId: string | null;
  modifierIds: string[];
  allergens: Record<string, { presence: "contains" | "may_contain" }> | null;
  dietaryDeclarations: DietaryLabel[];
  stationId?: string | null;
  courseId?: string | null;
}
export interface EditorChoice {
  id: string;
  name: LocalizedText;
}
export interface ProductRoutingChoice {
  id: string;
  name: string;
}

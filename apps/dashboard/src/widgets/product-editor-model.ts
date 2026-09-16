export type LocalizedText = Record<string, string>;
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
export type { DietaryLabel };
/**
 * One variant as the product editor's draft holds it. The three names fall back INDEPENDENTLY —
 * `name` is the plain staff-facing text, `customerName` the translated text a guest reads and
 * `kitchenName` what a kitchen ticket prints — and the fallback itself belongs to
 * `packages/catalogue/src/product-presentation.ts`, never to a screen.
 */
export interface EditorVariant {
  id?: string;
  name: string;
  customerName: LocalizedText | null;
  kitchenName: string | null;
  image: string | null;
  unitPrice: string;
  available: boolean;
}
export interface ProductEditorDraft {
  id?: string;
  name: string;
  customerName: LocalizedText | null;
  description: LocalizedText | null;
  kitchenName: string | null;
  image: string | null;
  unitId: string | null;
  unitPrice: string;
  available: boolean;
  vatClass: "general" | "reduced" | "super_reduced" | "zero";
  variants: EditorVariant[];
  categoryIds: string[];
  primaryCategoryId: string | null;
  modifierIds: string[];
  allergens: Record<string, { presence: "contains" | "may_contain" }> | null;
  dietaryDeclarations: DietaryLabel[];
  /** The product's kitchen routing. Both travel in the product's own save, so neither is optional:
   * an absent key and a cleared one would otherwise be the same submitted body. */
  stationId: string | null;
  courseId: string | null;
}
export interface EditorChoice {
  id: string;
  name: LocalizedText;
}
export interface UnitChoice extends EditorChoice {
  abbreviation: LocalizedText;
}
export interface ProductRoutingChoice {
  id: string;
  name: string;
}

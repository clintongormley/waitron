export type LocalizedText = Record<string, string>;
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
export type { DietaryLabel };
import type {
  ProductEditorBody,
  ProductVariantInput,
} from "@waitron/catalogue/src/product-types.js";

/** One variant as the product editor's draft holds it — catalogue's own `ProductVariantInput` (a new
 * variant omits `id`, an edited one carries it). The three names fall back INDEPENDENTLY and the
 * fallback belongs to `packages/catalogue/src/product-presentation.ts`, never to a screen. */
export type EditorVariant = ProductVariantInput;

/** The product editor's DRAFT: the wire body the editor sends (`ProductEditorBody`), plus an optional
 * `id` for an existing product. `stationId`/`courseId` are re-required here even though the wire body's
 * `ProductRouting` allows omission — both travel in the product's own save, and the form always carries
 * an explicit value, so an absent key and a cleared one must not collapse to the same submitted body. */
export type ProductEditorDraft = ProductEditorBody & {
  id?: string;
  stationId: string | null;
  courseId: string | null;
};
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

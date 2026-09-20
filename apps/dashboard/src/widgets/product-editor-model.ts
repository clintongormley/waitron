export type LocalizedText = Record<string, string>;
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
export type { DietaryLabel };
import type {
  ProductEditorBody,
  ProductModifierRef,
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
/** A modifier list as the product editor's Modifiers section reads one: its id and its plain STAFF
 * name. `ExtraList` and `OptionList` (packages/catalogue/src/modifier-list-types.ts) both satisfy
 * this; their customer-facing and kitchen names are left out because this surface shows the staff
 * name and nothing else (docs/developers/products.md). */
export interface ModifierListChoice {
  id: string;
  name: string;
}

/**
 * The plain STAFF name of the list an attachment points at, or null when neither loaded set holds
 * it. The ref's `kind` is what chooses the set — an `extras` ref is never resolved against the
 * options lists — so that mapping lives here once, shared by the product editor's Modifiers section
 * and the products list's Modifiers column. The caller supplies its own wording for null, because
 * the two surfaces show it differently.
 */
export function modifierListName(
  ref: ProductModifierRef,
  extraLists: readonly ModifierListChoice[],
  optionLists: readonly ModifierListChoice[],
): string | null {
  const lists = ref.kind === "extras" ? extraLists : optionLists;
  return lists.find((list) => list.id === ref.id)?.name ?? null;
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

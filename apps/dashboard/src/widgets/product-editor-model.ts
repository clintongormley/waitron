export type LocalizedText = Record<string, string>;
import { t } from "../i18n/t.js";
import type { DietaryLabel } from "@waitron/catalogue/src/dietary-declarations.js";
export type { DietaryLabel };
import type {
  InheritedValues,
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
 * an explicit value, so an absent key and a cleared one must not collapse to the same submitted body.
 * `inherited` is what the editor READ carries for a variant — its parent's values, shown as hints —
 * and is never sent back. */
export type ProductEditorDraft = ProductEditorBody & {
  id?: string;
  stationId: string | null;
  courseId: string | null;
  inherited?: InheritedValues | null;
};
/** A modifier list as the product editor's Modifiers section reads one: its id and its plain STAFF
 * name. `ExtraList` and `OptionList` (packages/catalogue/src/modifier-list-types.ts) both satisfy
 * this; their customer-facing and kitchen names are left out because this surface shows the staff
 * name and nothing else (docs/developers/products.md). */
export interface ModifierListChoice {
  id: string;
  name: string;
}

/** An attachment's identity, unique ACROSS the two kinds. The kinds are separate tables with their
 * own ids, so one uuid can name an extras list AND an options list; keyed on the bare id, a lookup
 * or a reorder would take whichever of the two came first. */
export function modifierKey(ref: ProductModifierRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Every loaded list's plain STAFF name, by {@link modifierKey}. Built once when the loaded sets
 * change rather than searched per attachment, because both surfaces resolve a name per attachment
 * per row and do it again on every keystroke near them: the editor's form re-renders on each one
 * (`wt-input` reports on `input`), and the products table re-reads every row's search text.
 */
export function modifierListNames(
  extraLists: readonly ModifierListChoice[],
  optionLists: readonly ModifierListChoice[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const list of extraLists) names.set(modifierKey({ kind: "extras", id: list.id }), list.name);
  for (const list of optionLists)
    names.set(modifierKey({ kind: "options", id: list.id }), list.name);
  return names;
}

/**
 * The plain STAFF name of the list an attachment points at, read from {@link modifierListNames}.
 * The ref's `kind` is part of the key — an `extras` ref never resolves to an options list — so that
 * mapping lives here once, shared by the product editor's Modifiers section and the products list's
 * Modifiers column. A list neither loaded set holds reads as the missing-choice placeholder, in the
 * one wording both surfaces use: a blank cell there says the product carries nothing.
 */
export function modifierListName(
  ref: ProductModifierRef,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(modifierKey(ref)) ?? t("editor.missing_choice");
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

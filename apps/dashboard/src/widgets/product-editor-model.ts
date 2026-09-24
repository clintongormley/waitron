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

/** A new variant omits `id`; an edited one carries it. */
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
/** A modifier list's id and plain STAFF name: the product editor and the products list show that
 * name and no other (docs/developers/products.md). */
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
 * per row and do it again on every keystroke near them: the editor's form re-renders on each one,
 * and the products table re-reads every row's search text.
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
 * A list neither loaded set holds reads as the missing-choice placeholder: a blank cell in the
 * products list's Modifiers column would say the product carries nothing.
 */
export function modifierListName(
  ref: ProductModifierRef,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(modifierKey(ref)) ?? t("editor.missing_choice");
}

/**
 * Whether two draft values hold the same data, whatever order their keys are in: a variant edited in
 * its window comes back as a new object with its keys in that window's order. A key holding
 * `undefined` counts as absent, as it does on the wire. Array order counts — it is the variant order
 * and the modifier order the product saves.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = (value: Record<string, unknown>) =>
    Object.keys(value).filter((key) => value[key] !== undefined);
  const leftKeys = keys(left);
  return (
    leftKeys.length === keys(right).length &&
    leftKeys.every((key) => sameValue(left[key], right[key]))
  );
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

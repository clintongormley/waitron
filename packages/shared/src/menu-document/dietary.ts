import { AppError } from "../errors.js";

export const CONTAINS_TAGS = ["meat", "fish"] as const;
export type ContainsTag = (typeof CONTAINS_TAGS)[number];

export type DietLabel = "yes" | "no" | "unknown";

export interface DietOverride {
  vegan?: "yes" | "no";
  vegetarian?: "yes" | "no";
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
  addContains?: ContainsTag[];
  removeContains?: ContainsTag[];
}
export interface DietProfile {
  vegan: DietLabel;
  vegetarian: DietLabel;
  contains: ContainsTag[];
  halal?: "yes" | "no";
  kosher?: "yes" | "no";
}
const CONTAINS = new Set<string>(CONTAINS_TAGS);
export function validateContainsTag(value: unknown): ContainsTag {
  if (typeof value !== "string" || !CONTAINS.has(value)) {
    throw new AppError("diet.invalid_origin", { origin: String(value) });
  }
  return value as ContainsTag;
}

const DIET_LABEL_FIELDS = ["vegan", "vegetarian", "halal", "kosher"] as const;

/** Validate a caller/JSON-supplied product diet OVERRIDE (untrusted at the write boundary): each
 * label field (`vegan`/`vegetarian`/`halal`/`kosher`) present must be `"yes"`|`"no"`
 * (`diet.invalid_label`, naming the field + echoing the value); `addContains`/`removeContains` must be
 * arrays of contains-tags ({@link validateContainsTag}); and the two contains sides must be disjoint
 * ({@link assertDietOverrideDisjoint} → `diet.add_remove_conflict`). `null` is a no-op (no override).
 * Returns the narrowed override. */
export function validateDietOverride(value: DietOverride | null): DietOverride | null {
  if (value == null) return null;
  for (const field of DIET_LABEL_FIELDS) {
    const label = value[field];
    if (label !== undefined && label !== "yes" && label !== "no") {
      throw new AppError("diet.invalid_label", { field, value: String(label) });
    }
  }
  if (value.addContains !== undefined) validateContainsList(value.addContains);
  if (value.removeContains !== undefined) validateContainsList(value.removeContains);
  assertDietOverrideDisjoint(value);
  return value;
}

function validateContainsList(value: unknown): void {
  if (!Array.isArray(value)) throw new AppError("diet.invalid_origin", { origin: String(value) });
  for (const tag of value) validateContainsTag(tag);
}

export const UNDECLARED_DIET: DietProfile = {
  vegan: "unknown",
  vegetarian: "unknown",
  contains: [],
};

/** Fold a staff override over a derived profile. Override wins; halal/kosher appear only when set. */
export function overlayDietProfile(
  derived: DietProfile,
  override: DietOverride | null,
): DietProfile {
  if (!override) return { ...derived, contains: [...derived.contains].sort() };
  const contains = new Set<ContainsTag>(derived.contains);
  for (const t of override.addContains ?? []) contains.add(t);
  for (const t of override.removeContains ?? []) contains.delete(t);
  const out: DietProfile = {
    vegan: override.vegan ?? derived.vegan,
    vegetarian: override.vegetarian ?? derived.vegetarian,
    contains: [...contains].sort(),
  };
  if (override.halal !== undefined) out.halal = override.halal;
  if (override.kosher !== undefined) out.kosher = override.kosher;
  return out;
}

/** Reject an override that both adds and removes the same contains-tag. */
export function assertDietOverrideDisjoint(override: DietOverride | null): void {
  if (!override?.addContains || !override.removeContains) return;
  const removing = new Set<string>(override.removeContains);
  for (const t of override.addContains) {
    if (removing.has(t)) throw new AppError("diet.add_remove_conflict", { tag: t });
  }
}

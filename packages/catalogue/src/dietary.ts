import { AppError } from "@waitron/shared";
import "./errors.js"; // load the code registry for the throws below

export const DIETARY_ORIGINS = [
  "plant",
  "meat",
  "fish",
  "shellfish",
  "dairy",
  "egg",
  "honey",
  "other_animal",
] as const;
export type DietaryOrigin = (typeof DIETARY_ORIGINS)[number];

export const CONTAINS_TAGS = ["meat", "fish"] as const;
export type ContainsTag = (typeof CONTAINS_TAGS)[number];

export type DietLabel = "yes" | "no" | "unknown";

export interface DietDerivation {
  origins: DietaryOrigin[];
  pending: boolean;
}
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
export interface OptionOriginOverlay {
  add: DietaryOrigin[] | null;
  remove: DietaryOrigin[] | null;
}

const ORIGINS = new Set<string>(DIETARY_ORIGINS);
const CONTAINS = new Set<string>(CONTAINS_TAGS);
// The origins compatible with each diet. vegan = plant only; vegetarian also allows the non-slaughter
// animal products. Anything not listed excludes the diet.
const VEGAN_OK = new Set<DietaryOrigin>(["plant"]);
const VEGETARIAN_OK = new Set<DietaryOrigin>(["plant", "dairy", "egg", "honey"]);

export function validateOrigin(value: unknown): DietaryOrigin {
  if (typeof value !== "string" || !ORIGINS.has(value)) {
    throw new AppError("diet.invalid_origin", { origin: String(value) });
  }
  return value as DietaryOrigin;
}

/** Validate a caller/JSON-supplied origin LIST (an option's add/remove overlay). Mirrors
 * `validateRemoveAllergens`: a non-array is `diet.invalid_origin` (`origin` echoes the value), and
 * every entry passes `validateOrigin`. Returns the narrowed list. */
export function validateOrigins(value: unknown): DietaryOrigin[] {
  if (!Array.isArray(value)) throw new AppError("diet.invalid_origin", { origin: String(value) });
  return value.map(validateOrigin);
}

/** Validate a single contains-tag against `CONTAINS_TAGS` (meat/fish ONLY) — the override's
 * `addContains`/`removeContains` entries. The parallel of {@link validateOrigin} but over the
 * strictly smaller contains set, so an otherwise-valid origin like `"plant"` is rejected here. A bad
 * value is `diet.invalid_origin` (`origin` echoes it), the same code the full-origin check uses. */
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
 * Returns the narrowed override. Defence-in-depth at the core (CLAUDE.md §3) — the twin of
 * `validateAllergens`, so diet writes are as guarded as allergen writes regardless of caller. */
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

/** Derived-only profile (no halal/kosher — those come from the override). Cautious: any pending
 * withholds vegan/vegetarian as "unknown"; contains-tags assert from KNOWN presence regardless. */
export function deriveDietProfile(d: DietDerivation): DietProfile {
  const present = new Set(d.origins);
  const label = (ok: Set<DietaryOrigin>): DietLabel =>
    d.pending ? "unknown" : [...present].every((o) => ok.has(o)) ? "yes" : "no";
  const contains = [...CONTAINS_TAGS].filter((t) => present.has(t));
  return { vegan: label(VEGAN_OK), vegetarian: label(VEGETARIAN_OK), contains };
}

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

/** As-served: recompute the DERIVED profile from (base origins − removed) ∪ added, carry base
 * `pending`, then re-apply the product override (override wins, same as product level).
 *
 * SAFETY (inverted from allergens): for allergens the safe direction is over-declaring (add wins); for
 * diet SUITABILITY the danger is a remove that manufactures a false "vegan". That is impossible here
 * because base.pending carries through untouched — a remove over a pending base leaves labels
 * "unknown". Adds that downgrade (add meat ⇒ not-veg) always apply. Removal is coarse (set-level),
 * identical to the allergen remove. */
export function deriveAsServedDiet(
  d: DietDerivation,
  override: DietOverride | null,
  overlays: readonly OptionOriginOverlay[],
): DietProfile {
  const origins = new Set<DietaryOrigin>(d.origins);
  for (const o of overlays) for (const code of o.remove ?? []) origins.delete(code);
  for (const o of overlays) for (const code of o.add ?? []) origins.add(code);
  const derived = deriveDietProfile({ origins: [...origins].sort(), pending: d.pending });
  return overlayDietProfile(derived, override);
}

/** Reject an override that both adds and removes the same contains-tag (mirrors
 * assertAllergenOverlayDisjoint). Defence-in-depth at the core (CLAUDE.md §3). */
export function assertDietOverrideDisjoint(override: DietOverride | null): void {
  if (!override?.addContains || !override.removeContains) return;
  const removing = new Set<string>(override.removeContains);
  for (const t of override.addContains) {
    if (removing.has(t)) throw new AppError("diet.add_remove_conflict", { tag: t });
  }
}

// `CONTAINS` is re-exported for the validation task (Task 4), which validates contains-tags against it.
export { CONTAINS };

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

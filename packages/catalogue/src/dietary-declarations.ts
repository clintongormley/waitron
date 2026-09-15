import { AppError } from "@waitron/shared";
import "./errors.js";

export const DIETARY_LABELS = [
  "vegan",
  "vegetarian",
  "halal",
  "kosher",
  "no_meat",
  "no_fish",
] as const;
export type DietaryLabel = (typeof DIETARY_LABELS)[number];

const LABELS = new Set<string>(DIETARY_LABELS);

export function validateDietaryDeclarations(value: unknown): DietaryLabel[] {
  if (
    !Array.isArray(value) ||
    value.some((label) => typeof label !== "string" || !LABELS.has(label)) ||
    new Set(value).size !== value.length
  ) {
    throw new AppError("diet.declaration_invalid", {});
  }
  return [...value] as DietaryLabel[];
}

export function expandDietaryDeclarations(declarations: readonly DietaryLabel[]): DietaryLabel[] {
  const labels = new Set(declarations);
  if (labels.has("vegan")) labels.add("vegetarian");
  if (labels.has("vegetarian")) {
    labels.add("no_meat");
    labels.add("no_fish");
  }
  return DIETARY_LABELS.filter((label) => labels.has(label));
}

/** The POSITIVE per-choice dietary set: the four labels a modifier choice may declare itself "suitable
 * for". Deliberately smaller than {@link DIETARY_LABELS} (the product-recipe set, which also carries
 * `no_meat`/`no_fish`) — a choice states suitability, not a recipe-derived preference filter. */
export const DIETARY_SUITABILITY = ["vegan", "vegetarian", "halal", "kosher"] as const;
export type DietarySuitability = (typeof DIETARY_SUITABILITY)[number];
const SUITABILITY = new Set<string>(DIETARY_SUITABILITY);

/** Validate a choice's positive suitability list against the four allowed labels; a duplicate, an
 * unknown label (including the retired `no_meat`/`no_fish`), or a non-array throws the shared
 * `diet.declaration_invalid` code (reused, never renamed — repo rule). */
export function validateDietarySuitability(value: unknown): DietarySuitability[] {
  if (
    !Array.isArray(value) ||
    value.some((label) => typeof label !== "string" || !SUITABILITY.has(label)) ||
    new Set(value).size !== value.length
  ) {
    throw new AppError("diet.declaration_invalid", {});
  }
  return [...value] as DietarySuitability[];
}

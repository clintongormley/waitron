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

/** Null is an unreviewed food-changing effect; an empty invalidation list is explicitly neutral. */
export interface DietaryEffect {
  invalidates: readonly DietaryLabel[];
}
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

/** Effects only withhold suitability. Removing something cannot establish a new positive claim. */
export function applyDietaryEffects(
  declarations: readonly DietaryLabel[],
  effects: readonly (DietaryEffect | null)[],
): DietaryLabel[] {
  if (effects.some((effect) => effect === null)) return [];
  const invalid = new Set(effects.flatMap((effect) => effect?.invalidates ?? []));
  if (invalid.has("no_meat") || invalid.has("no_fish")) invalid.add("vegetarian");
  if (invalid.has("vegetarian")) invalid.add("vegan");
  return expandDietaryDeclarations(declarations).filter((label) => !invalid.has(label));
}

import { expandDietaryDeclarations, type DietaryLabel } from "@waitron/shared";
import type { DietProfile } from "./api/client.js";

export function nutritionDietLabels(
  diet?: DietProfile | null,
  declarations?: readonly string[],
): DietaryLabel[] {
  if (declarations !== undefined) return expandDietaryDeclarations(declarations as DietaryLabel[]);
  return (["vegan", "vegetarian", "halal", "kosher"] as const).filter(
    (label) => diet?.[label] === "yes",
  );
}

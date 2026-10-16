import type { AllergenDeclaration } from "../api/client.js";
import { validateAllergens } from "@waitron/catalogue/src/allergens.js";
import {
  expandDietaryDeclarations,
  type DietaryLabel,
} from "@waitron/catalogue/src/dietary-declarations.js";
import { allergenRefusalText, codeOf } from "../i18n/codes.js";

export interface NutritionValue {
  allergens: AllergenDeclaration;
  dietaryDeclarations: DietaryLabel[] | null;
}
export type NutritionChange =
  | { field: "allergens"; value: AllergenDeclaration }
  | { field: "dietaryDeclarations"; value: DietaryLabel[] | null };

export function applyNutritionChange(
  draft: NutritionValue,
  change: NutritionChange,
): NutritionValue {
  return { ...draft, [change.field]: structuredClone(change.value) };
}

export function nutritionAllergensForComparison(value: AllergenDeclaration): AllergenDeclaration {
  return value === null
    ? null
    : Object.fromEntries(
        Object.entries(value).map(([code, entry]) => [
          code,
          {
            ...entry,
            ...(entry.kinds === undefined ? {} : { kinds: [...new Set(entry.kinds)].sort() }),
          },
        ]),
      );
}

export function nutritionErrors(value: AllergenDeclaration): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [code, entry] of Object.entries(value ?? {})) {
    try {
      validateAllergens({ [code]: entry });
    } catch (error) {
      const field = codeOf(error) === "allergen.kinds_required" ? `allergens-${code}` : "allergens";
      errors[field] = allergenRefusalText(error);
    }
  }
  return errors;
}

export function dietaryPresentation(
  own: DietaryLabel[] | null,
  parent: readonly DietaryLabel[],
): {
  chosen: DietaryLabel[];
  implied: { label: DietaryLabel; from: DietaryLabel }[];
  inherited: boolean;
} {
  const chosen = [...(own ?? parent)];
  return {
    chosen,
    inherited: own === null,
    implied: expandDietaryDeclarations(chosen)
      .filter((label) => !chosen.includes(label))
      .map((label) => ({ label, from: chosen.includes("vegan") ? "vegan" : "vegetarian" })),
  };
}

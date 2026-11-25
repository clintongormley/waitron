import {
  UNDECLARED_DIET,
  overlayDietProfile,
  validateDietaryDeclarations,
  expandDietaryDeclarations,
  type ProductAllergens,
  type DietOverride,
} from "@waitron/shared";

/** A browser-safe LEAF: the dashboard's patch form loads it. */

interface DeclarationRow {
  allergens: ProductAllergens | null;
  dietOverride: unknown;
  dietaryDeclarations: unknown;
}

export type DeclarationValues = ReturnType<typeof productDeclarationValues>;

export function productDeclarationValues(row?: DeclarationRow) {
  const dietOverride = (row?.dietOverride ?? null) as DietOverride | null;
  return {
    allergens: row?.allergens ?? null,
    dietOverride,
    diet: overlayDietProfile(UNDECLARED_DIET, dietOverride),
    dietaryDeclarations: validateDietaryDeclarations(row?.dietaryDeclarations ?? []),
  };
}

export function extraDeclarationValues(
  row?: Pick<DeclarationRow, "allergens" | "dietaryDeclarations">,
) {
  return {
    addAllergens: row?.allergens ?? null,
    suitableFor: expandDietaryDeclarations(
      validateDietaryDeclarations(row?.dietaryDeclarations ?? []),
    ),
  };
}

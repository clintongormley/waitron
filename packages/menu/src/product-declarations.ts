import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import {
  UNDECLARED_DIET,
  overlayDietProfile,
  validateDietaryDeclarations,
  expandDietaryDeclarations,
  type ProductAllergens,
  type DietOverride,
} from "@waitron/shared";
import { batches } from "./batches.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";

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

/** The products' values now, a variant's blank ones taken from its parent. */
export async function readProductDeclarationValues(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, DeclarationValues>> {
  const result = new Map<string, DeclarationValues>();
  for (const batch of batches([...new Set(productIds)])) {
    const rows = await tx
      .select({
        id: products.id,
        allergens: effectiveProductColumns.allergens,
        dietOverride: effectiveProductColumns.dietOverride,
        dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(inArray(products.id, batch));
    for (const row of rows) result.set(row.id, productDeclarationValues(row));
  }
  return result;
}

import { inArray, eq } from "drizzle-orm";
import { workingOrderLines, products, type Transaction } from "@waitron/db";
import {
  effectiveProductColumns,
  parentJoin,
  parentProducts,
  type ProductAllergens,
} from "@waitron/catalogue";

export interface LineNutrition {
  allergens: ProductAllergens | null;
  dietaryDeclarations: string[];
}

/** Like the kitchen queue, persisted table rows read the dish's effective live nutrition. */
export async function readLineNutrition(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, LineNutrition>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({
      lineId: workingOrderLines.id,
      allergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(workingOrderLines.id, [...lineIds]));
  return new Map(
    rows.flatMap((row) => {
      const allergens = row.allergens as ProductAllergens | null;
      const dietaryDeclarations = row.dietaryDeclarations as string[];
      return allergens === null ||
        (Object.keys(allergens).length === 0 && dietaryDeclarations.length === 0)
        ? []
        : [[row.lineId, { allergens, dietaryDeclarations }]];
    }),
  );
}

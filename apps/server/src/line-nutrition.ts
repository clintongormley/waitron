import { VENUE_SERVICE } from "./modules.js";
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
  const declarations = await currentLineDeclarations(tx, lineIds);
  return new Map(
    [...declarations].filter(
      ([, row]) =>
        row.allergens !== null &&
        (Object.keys(row.allergens).length > 0 || row.dietaryDeclarations.length > 0),
    ),
  );
}

export async function captureSentLineNutrition(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<void> {
  const declarations = await currentLineDeclarations(tx, lineIds);
  await VENUE_SERVICE.recordSentLineNutrition(
    tx,
    [...declarations].map(([lineId, nutrition]) => ({ lineId, nutrition })),
  );
}

async function currentLineDeclarations(
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
    rows.map((row) => [
      row.lineId,
      {
        allergens: row.allergens as ProductAllergens | null,
        dietaryDeclarations: (row.dietaryDeclarations as string[] | null) ?? [],
      },
    ]),
  );
}

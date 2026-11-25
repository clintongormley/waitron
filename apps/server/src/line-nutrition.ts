import { VENUE_SERVICE } from "./modules.js";
import { inArray } from "drizzle-orm";
import { workingOrderLines, type Transaction } from "@waitron/db";
import {
  productDeclarationValues,
  readPublishedDeclarations,
  type ProductAllergens,
  type PublishedLine,
} from "@waitron/menu";

/** What {@link readPublishedDeclarations} reads of a stored line. */
export const publishedLineColumns = {
  id: workingOrderLines.id,
  menuVersionId: workingOrderLines.menuVersionId,
  menuItemId: workingOrderLines.menuItemId,
  productId: workingOrderLines.productId,
  extraListId: workingOrderLines.extraListId,
} satisfies Record<keyof PublishedLine, unknown>;

export interface LineNutrition {
  allergens: ProductAllergens | null;
  dietaryDeclarations: string[];
}

export async function readLineNutrition(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, LineNutrition>> {
  const declarations = await publishedLineDeclarations(tx, lineIds);
  return new Map(
    [...declarations].filter(
      ([, row]) =>
        row.allergens !== null &&
        (Object.keys(row.allergens).length > 0 || row.dietaryDeclarations.length > 0),
    ),
  );
}

export async function readDisplayLineNutrition(
  tx: Transaction,
  lines: readonly { id: string; sentAt: string | null }[],
): Promise<Map<string, LineNutrition>> {
  const unsent = await readLineNutrition(
    tx,
    lines.filter((line) => line.sentAt === null).map((line) => line.id),
  );
  const saved = await VENUE_SERVICE.readSentLineNutrition(
    tx,
    lines.filter((line) => line.sentAt !== null).map((line) => line.id),
  );
  return new Map([...unsent, ...saved]);
}

export async function captureSentLineNutrition(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<void> {
  const declarations = await publishedLineDeclarations(tx, lineIds);
  await VENUE_SERVICE.recordSentLineNutrition(
    tx,
    [...declarations].map(([lineId, nutrition]) => ({ lineId, nutrition })),
  );
}

/** The published declarations of each line; a line no menu version holds is not reviewed. */
async function publishedLineDeclarations(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, LineNutrition>> {
  if (lineIds.length === 0) return new Map();
  const lines = await tx
    .select(publishedLineColumns)
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, [...lineIds]));
  const published = await readPublishedDeclarations(tx, lines);
  return new Map(
    lines.map(({ id }) => {
      const { allergens, dietaryDeclarations } = productDeclarationValues(published.get(id));
      return [id, { allergens, dietaryDeclarations }];
    }),
  );
}

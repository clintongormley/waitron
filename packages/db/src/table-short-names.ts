import { eq, isNotNull } from "drizzle-orm";
import { shortNameKey } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { diningTables } from "./schema/dining-tables.js";

/** The key is the folded copy the venue's unique index is on. */
export function shortNameColumns(shortName: string | null): {
  shortName: string | null;
  shortNameKey: string | null;
} {
  return { shortName, shortNameKey: shortName === null ? null : shortNameKey(shortName) };
}

/** Sets every live table's `short_name_key` from its stored short name. */
export async function storeTableShortNameKeys(tx: Transaction): Promise<void> {
  const rows = await tx
    .select({ id: diningTables.id, shortName: diningTables.shortName })
    .from(diningTables)
    .where(isNotNull(diningTables.shortName));
  // Folded here rather than in SQL: this engine's `lower()` folds ASCII letters only.
  for (const row of rows)
    await tx
      .update(diningTables)
      .set(shortNameColumns(row.shortName))
      .where(eq(diningTables.id, row.id));
}

import { inArray, isNotNull, sql } from "drizzle-orm";
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

/** Tables one statement of {@link storeTableShortNameKeys} sets. The store passes each bound value
 * as its own function argument, and one statement over every table an import admits overflows the
 * call stack. */
export const SHORT_NAME_KEY_BATCH = 1000;

/** Sets every live table's `short_name_key` from its stored short name. */
export async function storeTableShortNameKeys(tx: Transaction): Promise<void> {
  const rows = await tx
    .select({ id: diningTables.id, shortName: diningTables.shortName })
    .from(diningTables)
    .where(isNotNull(diningTables.shortName));
  // Folded here rather than in SQL: this engine's `lower()` folds ASCII letters only.
  for (let start = 0; start < rows.length; start += SHORT_NAME_KEY_BATCH) {
    const batch = rows.slice(start, start + SHORT_NAME_KEY_BATCH);
    await tx
      .update(diningTables)
      .set({
        shortNameKey: sql`case ${diningTables.id} ${sql.join(
          batch.map(
            (row) => sql`when ${row.id} then ${shortNameColumns(row.shortName).shortNameKey}`,
          ),
          sql` `,
        )} end`,
      })
      .where(
        inArray(
          diningTables.id,
          batch.map((row) => row.id),
        ),
      );
  }
}

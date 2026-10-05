import { inArray } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Transaction } from "@waitron/db";

/** A column of `table` holding another row's id. */
export interface Reference {
  table: SQLiteTable;
  column: SQLiteColumn;
}

/** Which of `ids` any of `references` names: one query per reference, however many ids. */
export async function idsInUse(
  tx: Transaction,
  references: readonly Reference[],
  ids: readonly string[],
): Promise<Set<string>> {
  const used = new Set<string>();
  if (!ids.length) return used;
  for (const { table, column } of references) {
    const rows = await tx
      .selectDistinct({ id: column })
      .from(table)
      .where(inArray(column, [...ids]));
    for (const row of rows) used.add(row.id as string);
  }
  return used;
}

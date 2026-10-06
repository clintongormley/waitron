import { inArray } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Transaction } from "@waitron/db";

/** A column of `table` holding another row's id. */
export interface Reference {
  table: SQLiteTable;
  column: SQLiteColumn;
}

/** Which of `ids` any of `references` names: at most one query per reference, however many ids. */
export async function idsInUse(
  tx: Transaction,
  references: readonly Reference[],
  ids: readonly string[],
): Promise<Set<string>> {
  const wanted = [...new Set(ids)];
  const used = new Set<string>();
  for (const { table, column } of references) {
    if (used.size === wanted.length) break;
    const rows = await tx.selectDistinct({ id: column }).from(table).where(inArray(column, wanted));
    for (const row of rows) used.add(row.id as string);
  }
  return used;
}

/** Each row with whether any of `references` names it. */
export async function withInUse<T extends { id: string }>(
  tx: Transaction,
  references: readonly Reference[],
  rows: readonly T[],
): Promise<(T & { inUse: boolean })[]> {
  const used = await idsInUse(
    tx,
    references,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, inUse: used.has(row.id) }));
}

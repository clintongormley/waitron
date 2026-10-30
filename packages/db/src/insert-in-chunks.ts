import { getTableColumns } from "drizzle-orm";
import type { SQLiteInsertValue, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Transaction } from "./client.js";

/**
 * The most values one statement may bind: SQLite's default `SQLITE_MAX_VARIABLE_NUMBER`, which
 * Node's own build keeps (`limits.variableNumber` read 32766 on the official Node v26.13.0 for
 * macOS). A Node linked to Homebrew's SQLite read 250000, so a statement over this limit can pass
 * on a developer's machine and be refused in CI and on the box.
 */
export const SQL_VARIABLE_LIMIT = 32766;

/** How many rows of `columns` columns one statement binding at most `limit` values can take. */
export function rowsPerStatement(columns: number, limit: number): number {
  const rows = Math.floor(limit / columns);
  if (rows < 1)
    throw new Error(
      `rowsPerStatement: a row of ${columns} columns does not fit in ${limit} bound values`,
    );
  return rows;
}

/**
 * Insert `rows` into `table` in as few statements as keep each within `limit` bound values,
 * counting one per column per row: a row of plain values binds no more. No rows, no statement.
 */
export async function insertInChunks<T extends SQLiteTable>(
  tx: Transaction,
  table: T,
  rows: readonly SQLiteInsertValue<T>[],
  limit: number = SQL_VARIABLE_LIMIT,
): Promise<void> {
  const size = rowsPerStatement(Object.keys(getTableColumns(table)).length, limit);
  for (let start = 0; start < rows.length; start += size)
    await tx.insert(table).values(rows.slice(start, start + size));
}

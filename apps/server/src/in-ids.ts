import { type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * `column` is one of `ids`, which bind as one JSON value however many there are, where `inArray`
 * binds one value each and a statement may bind at most `SQL_VARIABLE_LIMIT` (`@waitron/store`).
 */
export function inIds(column: SQLiteColumn, ids: readonly string[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify([...new Set(ids)])}))`;
}

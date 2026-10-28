import { lstat } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Database } from "@waitron/db";

export type ImmutableOpen =
  | { readonly kind: "open"; readonly connection: DatabaseSync }
  | { readonly kind: "wal" }
  | { readonly kind: "failed"; readonly stage: "wal" | "open"; readonly error: unknown };

/**
 * Opens the database at `path` read-only and immutable, which leaves no side file behind, unless
 * its `-wal` holds pages (`wal`): an immutable open reads the main file only and would read past
 * them. Never throws.
 */
export async function openImmutableWhenWalEmpty(path: string): Promise<ImmutableOpen> {
  try {
    if ((await lstat(`${path}-wal`)).size !== 0) return { kind: "wal" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return { kind: "failed", stage: "wal", error };
  }
  const url = pathToFileURL(path);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  try {
    return { kind: "open", connection: new DatabaseSync(url, { readOnly: true }) };
  } catch (error) {
    return { kind: "failed", stage: "open", error };
  }
}

/** A plain `execute` target over `connection`, for module seats that read with plain statements. */
export function executeTarget(connection: DatabaseSync): Pick<Database, "execute"> {
  const dialect = new SQLiteSyncDialect();
  return {
    execute<Row extends Record<string, unknown>>(query: SQLWrapper | string) {
      const compiled =
        typeof query === "string" ? { sql: query, params: [] } : dialect.sqlToQuery(query.getSQL());
      return {
        rows: connection
          .prepare(compiled.sql)
          .all(...(compiled.params as SQLInputValue[])) as Row[],
      };
    },
  };
}

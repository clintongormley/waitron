import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

/** One declared edge: the table holding the constraint, its columns, and the table pointed at. */
export interface DeclaredForeignKey {
  readonly table: string;
  readonly columns: readonly string[];
  readonly references: string;
}

/**
 * The foreign keys a schema module DECLARES, read off the Drizzle table objects it exports.
 *
 * Both declaration forms are reported: the table-level `foreignKey({…})` builder and the inline
 * `.references(() => …)` on a column — Drizzle folds them into the same list, which is why one
 * reader covers both (pinned by a test per form in `foreign-keys.test.ts`).
 *
 * It reads the SCHEMA, not the database: a foreign key written by hand in a migration and never
 * declared in TypeScript is invisible here.
 */
export function declaredForeignKeys(schemaModule: Record<string, unknown>): DeclaredForeignKey[] {
  const edges: DeclaredForeignKey[] = [];
  for (const exported of Object.values(schemaModule)) {
    if (!is(exported, PgTable)) continue;
    const config = getTableConfig(exported);
    for (const fk of config.foreignKeys) {
      const reference = fk.reference();
      edges.push({
        table: config.name,
        columns: reference.columns.map((column) => column.name),
        references: getTableConfig(reference.foreignTable).name,
      });
    }
  }
  return edges;
}

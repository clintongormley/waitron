/**
 * `ledger` — what happened, keyed by the node that wrote it. `state` — what means the same on every
 * node. `local` — a row that belongs to one node and means nothing to another; the table's reason
 * says what ties a row to its node: a `node_id` column every read and write names, a seal only that
 * node's key opens, or rows the transaction that wrote them deletes.
 *
 * No foreign key joins a `local` table to a `ledger`/`state` one — guard:
 * `scripts/two-file-foreign-keys.test.ts`, which reads drizzle's GENERATED snapshots, so a key only
 * in hand-written migration SQL is outside it.
 *
 * Some per-module reason strings and file docstrings still describe the deleted PostgreSQL
 * replication's copy-and-drain directions; nothing copies a table between nodes today.
 */
export type TableClass = "ledger" | "state" | "local";

export interface ClassifiedTable {
  table: string;
  class: TableClass;
  reason: string;
  /**
   * Orthogonal to the class, in both directions: some `ledger` tables are updated by ordinary
   * product code (`payments`, the chain heads), and `order_amendments` is `state` and IS
   * append-only.
   */
  appendOnly?: true;
}

/** Takes the physical name as a string, so the root completeness guard, not the type, is what
 * stops a typo. */
export function classify(table: string, cls: TableClass, reason: string): ClassifiedTable {
  return { table, class: cls, reason };
}

/**
 * {@link classify}, plus: nothing may ever change or remove a row of this table. `applyMigrations`
 * turns each declaration into a `RAISE(ABORT)` trigger pair, and that is the whole of what protects
 * the table at runtime. Guard: `scripts/append-only-triggers.test.ts`.
 */
export function appendOnly(table: string, cls: TableClass, reason: string): ClassifiedTable {
  return { table, class: cls, reason, appendOnly: true };
}

/**
 * The one derivation of this list; a second `filter`/`map` written by hand is how readers drift.
 * Guard: `scripts/append-only-migration-sets.test.ts`.
 */
export function appendOnlyTablesIn(classifications: readonly ClassifiedTable[]): string[] {
  return classifications.filter((c) => c.appendOnly === true).map((c) => c.table);
}

/** No production consumer. The `Publication` in the name is left over from the deleted PostgreSQL
 * replication. */
export function tablesForPublication(
  classifications: readonly ClassifiedTable[],
  cls: "ledger" | "state",
): string[] {
  return classifications.filter((c) => c.class === cls).map((c) => c.table);
}

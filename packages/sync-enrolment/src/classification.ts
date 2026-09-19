/**
 * A table's CLASS (swap spec §2.1). Every database table is exactly one of these: `ledger` — what
 * happened (sales, payments, fiscal records, closes, clock-ins), keyed by the node that wrote it.
 * `state` — what a manager configures plus live service in flight. `local` — this node's own record
 * of what it is.
 *
 * What the class decides TODAY is which DATABASE FILE a table lives in after the storage switch
 * (`local` in `node.db`, the rest in `venue.db`), which is why a foreign key must not join a `local`
 * table to a `ledger`/`state` one — guard: `scripts/two-file-foreign-keys.test.ts`, which reads
 * drizzle's GENERATED snapshots, so a key only in hand-written migration SQL is outside it. The
 * copy-and-drain directions the three names were coined for belonged to the deleted PostgreSQL
 * replication; the per-module reason strings still describe them, as does every module
 * `classification.ts` whose file docstring names the mechanism ("classified for native
 * replication") — not all of them have a file docstring at all — and no mechanism in the tree copies
 * a table to a standby or drains one back today.
 */
export type TableClass = "ledger" | "state" | "local";

/** One table's classification: the physical table name, its class, and the stated reason (§1's
 * "no unstated claims" rule — a bare class is not auditable). Declared by the OWNING module and
 * assembled by the composition root (`ALL_CLASSIFICATIONS` in `apps/server/src/modules.ts`). */
export interface ClassifiedTable {
  table: string;
  class: TableClass;
  reason: string;
}

/** Declare one table's class. Takes the physical name as a string (not a Drizzle table): some
 * tables live only in hand-written SQL and have no schema object, and the root completeness guard —
 * not the type — is what stops a typo. */
export function classify(table: string, cls: TableClass, reason: string): ClassifiedTable {
  return { table, class: cls, reason };
}

/** The physical table names in one class. No production consumer: the package barrel exports it and
 * this package's own test calls it, and nothing else in the tree does. Held because the split it
 * computes is live in the CLASS itself — the class decides which database FILE a table lives in
 * (`scripts/two-file-foreign-keys.test.ts`). The `Publication` in the name is left over from the
 * deleted PostgreSQL replication, not a mechanism that still exists. */
export function tablesForPublication(
  classifications: readonly ClassifiedTable[],
  cls: "ledger" | "state",
): string[] {
  return classifications.filter((c) => c.class === cls).map((c) => c.table);
}

/**
 * A table's replication CLASS (swap spec §2.1). Every database table is exactly one of these:
 * `ledger` — what happened (sales, payments, fiscal records, closes, clock-ins): copied to a
 * standby AND drained back from a returned box. `state` — what a manager configures plus live
 * service in flight: copied to a standby, never drained back. `local` — this node's own record of
 * what it is: not copied, not drained.
 */
export type TableClass = "ledger" | "state" | "local";

/** One table's classification: the physical table name, its class, and the stated reason (§1's
 * "no unstated claims" rule — a bare class is not auditable). Declared by the OWNING module,
 * assembled by the composition root, consumed by `@waitron/sync`'s publication derivation. */
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

/** The physical table names on one publication. `ledger`/`state` map to the two publications a node
 * holds (`waitron_<env>_ledger` / `…_state`, spec §2.1); `local` tables are in neither. */
export function tablesForPublication(
  classifications: readonly ClassifiedTable[],
  cls: "ledger" | "state",
): string[] {
  return classifications.filter((c) => c.class === cls).map((c) => c.table);
}

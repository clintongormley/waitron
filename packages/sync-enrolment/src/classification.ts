/**
 * A table's CLASS. Every table lives in `venue.db`, the file slice 2 will stream (slice-2 spec §2).
 * `ledger` — what happened (sales, payments, fiscal records, closes, clock-ins), keyed by the node
 * that wrote it. `state` — what a manager configures, live service in flight, and anything else
 * that means the same on every node. `local` — a row that belongs to one node and means nothing to
 * another; the table's reason says what ties a row to its node: a `node_id` column every read and
 * write names, a seal only that node's key opens, or rows the transaction that wrote them deletes.
 *
 * No foreign key joins a `local` table to a `ledger`/`state` one — guard:
 * `scripts/two-file-foreign-keys.test.ts`, which reads drizzle's GENERATED snapshots, so a key only
 * in hand-written migration SQL is outside it. `node.db` is created empty and reserved for a later
 * slice (spec §2); a slice that moves `local` tables into it then has no key to cut first.
 *
 * The copy-and-drain directions the three names were coined for belonged to the deleted
 * PostgreSQL replication; the per-module reason strings still describe them, as does every module
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
  /**
   * Set by {@link appendOnly}: this table refuses an UPDATE and a DELETE once the row is written.
   *
   * **Orthogonal to the class, in both directions, and that is why it is its own marker.** A
   * `ledger` table is not append-only by default — `payments` records a card payment's progress and
   * `cadenas` and `workforce_chains` each hold a chain HEAD the next record moves, so nine
   * `ledger`-classified tables are updated or deleted by ordinary product code. And
   * `order_amendments` is `state` and IS append-only. Deriving the trigger set from the class
   * instead would refuse a card capture and let an amendment be rewritten, both silently.
   */
  appendOnly?: true;
}

/** Declare one table's class. Takes the physical name as a string (not a Drizzle table): some
 * tables live only in hand-written SQL and have no schema object, and the root completeness guard —
 * not the type — is what stops a typo. */
export function classify(table: string, cls: TableClass, reason: string): ClassifiedTable {
  return { table, class: cls, reason };
}

/**
 * {@link classify}, plus: nothing may ever change or remove a row of this table.
 *
 * `applyMigrations` turns every table declared this way into a `RAISE(ABORT)` trigger pair
 * (`installAppendOnlyTriggers`, `packages/store/src/append-only.ts`) after the owning set has
 * migrated, so a declaration here is the whole of what protects the table at runtime — there is no
 * second step to remember, and no way to derive it from something else the table already says.
 *
 * The set this marks is the set PostgreSQL's hand-written `reject_mutation()` triggers protected,
 * table for table: read out of `origin/main`'s six trigger-carrying baselines with
 * `grep -oiE "BEFORE (UPDATE OR DELETE|DELETE OR UPDATE) ON ..."`, ten tables across `db`,
 * `fiscal-verifactu` and `workforce`. Guard: `scripts/append-only-triggers.test.ts`, which pins the
 * names and then proves the refusal against a database migrated by the product's own entry point.
 */
export function appendOnly(table: string, cls: TableClass, reason: string): ClassifiedTable {
  return { table, class: cls, reason, appendOnly: true };
}

/**
 * The tables {@link appendOnly} marked, in declaration order.
 *
 * One derivation, three readers, because the same list is needed in three unconnected places and a
 * second `filter`/`map` written by hand is how two of them drift: `orderedMigrationSets`
 * (`packages/module/src/module.ts`) builds the product's boot-path sets, each owning package's own
 * migration descriptor carries it for a caller that migrates that set alone (a test helper does
 * exactly that), and `installAppendOnlyTriggers` turns whichever list it is handed into triggers.
 *
 * Guard: `scripts/append-only-migration-sets.test.ts`, which compares a package's descriptor with
 * this function's result over the package's own classification list.
 */
export function appendOnlyTablesIn(classifications: readonly ClassifiedTable[]): string[] {
  return classifications.filter((c) => c.appendOnly === true).map((c) => c.table);
}

/** The physical table names in one class. No production consumer: the package barrel exports it and
 * this package's own test calls it, and nothing else in the tree does. Held because the split it
 * computes is live in the CLASS itself — the class decides which tables no key may cross
 * (`scripts/two-file-foreign-keys.test.ts`). The `Publication` in the name is left over from the
 * deleted PostgreSQL replication, not a mechanism that still exists. */
export function tablesForPublication(
  classifications: readonly ClassifiedTable[],
  cls: "ledger" | "state",
): string[] {
  return classifications.filter((c) => c.class === cls).map((c) => c.table);
}

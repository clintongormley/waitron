import { sql } from "drizzle-orm";
import type { ResourceChange } from "@waitron/shared";
import type { Transaction } from "./client.js";

/**
 * What changed, handed to this process's own listeners.
 *
 * The change trigger writes a row into `change_log` inside whatever transaction caused the change
 * (`change-feed.ts`); `withTransaction` takes those rows out again and hands them over once the
 * commit has returned. The two halves are separate functions on purpose: the ordering that matters
 * — read inside, deliver outside — is then written in `withTransaction`'s body where a reader can
 * see it, rather than promised in a comment here.
 *
 * The listener set is module-level rather than an object a caller constructs, because
 * `withTransaction` takes a database and a callback and has nowhere to receive one. It is therefore
 * process-global: a drain on ANY database in this process delivers to EVERY subscriber, not only to
 * the ones interested in that database. One database per process today, and `@waitron/identity`'s
 * `registerModulePermissions` keeps its registry the same way.
 */
const listeners = new Set<(change: ResourceChange) => void>();

/** Registers a listener. Returns the function that removes it again. */
export function subscribeToChanges(fn: (change: ResourceChange) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Takes every pending change row out of the log, inside the caller's transaction.
 *
 * One statement, so the read and the removal cannot come apart, and so a rollback puts the rows
 * back along with the change that wrote them — which is what the rollback case in
 * `change-log.test.ts` pins.
 *
 * **Two transactions cannot drain at the same moment on this engine**, so the question the
 * PostgreSQL measurements here answered — what happens when they do — no longer arises. SQLite
 * admits one writer per file and `withTransaction` goes through the write queue, so a second drain
 * does not begin until the first has committed or rolled back. Those readings (two clients on
 * PostgreSQL 18.6, one blocking in `pg_locks` on the other's `transactionid`) are retired with the
 * engine; the commit that replaced them carries them if anyone needs the history.
 *
 * What survives is the rollback property, which is a statement about one transaction and is pinned
 * by `change-log.test.ts`'s rollback case.
 */
export async function drainChangeLog(tx: Transaction): Promise<ResourceChange[]> {
  const drained = tx.execute<{ payload: string }>(sql`delete from change_log returning payload`);
  // `payload` is a TEXT column holding JSON, and a statement written as raw SQL is handed back as
  // the engine stored it — Drizzle applies a column's `fromDriver` only to a query it built from
  // the table object. So the parse happens here. On PostgreSQL the driver did it, which is why
  // this line is new rather than moved.
  return drained.rows.map((row) => JSON.parse(row.payload) as ResourceChange);
}

/**
 * Hands the drained changes to every listener. Called only once the commit has returned: before
 * that the rows may still be rolled away, and a listener would be reporting a change that never
 * happened.
 */
export function deliverChanges(changes: readonly ResourceChange[]): void {
  for (const change of changes) for (const fn of listeners) fn(change);
}

import { sql } from "drizzle-orm";
import type { ResourceChange } from "@waitron/shared";
import type { Transaction } from "./client.js";

/**
 * What changed, handed to this process's own listeners.
 *
 * The listener set is module-level rather than an object a caller constructs, because
 * `withTransaction` takes a database and a callback and has nowhere to receive one. It is therefore
 * process-global: a drain on ANY database in this process delivers to EVERY subscriber, not only to
 * the ones interested in that database.
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
 */
export async function drainChangeLog(tx: Transaction): Promise<ResourceChange[]> {
  const drained = tx.execute<{ payload: string }>(sql`delete from change_log returning payload`);
  // `payload` is a TEXT column holding JSON, and a statement written as raw SQL is handed back as
  // the engine stored it — Drizzle applies a column's `fromDriver` only to a query it built from
  // the table object.
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

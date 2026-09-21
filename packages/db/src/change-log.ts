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
 * No test here pins two transactions draining at the same moment — PGlite runs one backend, so that
 * interleaving cannot be produced on it (CLAUDE.md §4) — but it was measured, two clients against
 * one `change_log`, on PostgreSQL 18.6 (`postgres:18-alpine`, 2026-09-21). Overlapping writers:
 * each drain returned exactly its own row and nothing came out twice, because a `delete` sees only
 * COMMITTED rows. Two drains over the same committed backlog row: the first took it; the second had
 * still not returned seconds later and stood in `pg_locks` as one ungranted `transactionid`
 * `ShareLock`; when the first rolled back, the second received exactly that one row.
 *
 * That second result is the consequence worth knowing: two transactions draining the same committed
 * row block on each other, so an undrained backlog turns the tail of every transaction into a
 * serialisation point. Ordinarily there is no backlog — a transaction's own rows are invisible to
 * everyone else until it commits, and it drains them itself — so creating one takes a writer that
 * did not go through `withTransaction`.
 */
export async function drainChangeLog(tx: Transaction): Promise<ResourceChange[]> {
  const drained = await tx.execute<{ payload: ResourceChange }>(
    sql`delete from change_log returning payload`,
  );
  return drained.rows.map((row) => row.payload);
}

/**
 * Hands the drained changes to every listener. Called only once the commit has returned: before
 * that the rows may still be rolled away, and a listener would be reporting a change that never
 * happened.
 */
export function deliverChanges(changes: readonly ResourceChange[]): void {
  for (const change of changes) for (const fn of listeners) fn(change);
}

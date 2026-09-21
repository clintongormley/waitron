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
 * `withTransaction` takes a database and a callback and has nowhere to receive one.
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
 * What no test here pins is two transactions draining at the same moment: PGlite runs one backend,
 * so that interleaving cannot be produced on it (CLAUDE.md §4). Reasoned about rather than
 * measured: a `delete` sees only COMMITTED rows, so the worst case is one transaction delivering a
 * change another transaction wrote, and the other delivering nothing.
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

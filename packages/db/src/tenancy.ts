import type { ResourceChange } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { deliverChanges, drainChangeLog } from "./change-log.js";

/**
 * Runs the caller's work in one transaction. One tenant per database, so there is no tenant to bind:
 * a write path takes the `tx` this opens and never opens its own (CLAUDE.md §3).
 *
 * It also carries this process's change feed. The change trigger writes a row per affected resource
 * into `change_log`; those rows are taken out INSIDE the transaction, so a rollback takes them with
 * it, and handed to listeners only AFTER the commit has returned, so nothing hears about a change
 * that may still be undone. The drain is unconditional — a read-only transaction pays one `delete`
 * that matches nothing rather than this function guessing what the caller wrote.
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let pending: readonly ResourceChange[] = [];
  const result = await db.transaction(async (tx) => {
    const value = await fn(tx);
    pending = await drainChangeLog(tx);
    return value;
  });
  deliverChanges(pending);
  return result;
}

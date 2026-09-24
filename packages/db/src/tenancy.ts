import type { ResourceChange } from "@waitron/shared";
import type { Database, Transaction } from "./client.js";
import { deliverChanges, drainChangeLog } from "./change-log.js";

/**
 * Runs the caller's work in one transaction. A write path takes the `tx` this opens and never opens
 * its own (CLAUDE.md §3).
 *
 * It also carries this process's change feed. The change trigger writes a row per affected resource
 * into `change_log`; those rows are taken out INSIDE the transaction, so a rollback takes them with
 * it, and handed to listeners only AFTER the commit has returned, so nothing hears about a change
 * that may still be undone.
 *
 * The drain runs on every transaction because this function cannot know what the caller wrote. So a
 * read-only caller's drain is NOT always empty: a `delete` sees committed rows, so it takes — and
 * delivers — any row a writer outside this function left behind. That is the mechanism, not a leak:
 * the change it reports did commit, and whoever wrote it was never going to deliver it.
 *
 * The transaction is the write lock. SQLite admits one writer per file, so `withWriteLock` is both
 * the serialisation and the `begin`/`commit` pair (`packages/store/src/write-queue.ts`).
 *
 * The body may return its value directly instead of a promise of it, because this engine is
 * synchronous: `execute` hands back its rows rather than a promise of them
 * (`packages/store/src/node-sqlite-adapter.ts` → `RawResult`).
 *
 * A database handed to this function must carry the core migration set's `change_log` table —
 * without it the drain is refused `no such table: change_log`, from a statement the caller never
 * wrote.
 */
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T> | T,
): Promise<T> {
  let pending: readonly ResourceChange[] = [];
  const result = await db.withWriteLock(async () => {
    const value = await fn(db);
    pending = await drainChangeLog(db);
    return value;
  });
  deliverChanges(pending);
  return result;
}

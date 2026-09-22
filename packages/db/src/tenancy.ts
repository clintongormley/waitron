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
 * that may still be undone.
 *
 * The drain runs on every transaction because this function cannot know what the caller wrote, and
 * asking the database would cost the same round trip the `delete` costs. So a read-only caller's
 * drain is NOT always empty: a `delete` sees committed rows, so it takes — and delivers — any row a
 * writer outside this function left behind. That is the mechanism, not a leak: the change it reports
 * did commit, and whoever wrote it was never going to deliver it.
 *
 * The transaction is the write lock. SQLite admits one writer per file, so `withWriteLock` is both
 * the serialisation and the `begin`/`commit` pair (`packages/store/src/write-queue.ts`) — there is
 * no second session to open, and the handle the body receives is the one it was given.
 *
 * The body may return its value directly instead of a promise of it. That is not a convenience:
 * this engine is synchronous, so `execute` hands back its rows rather than a promise of them
 * (`packages/store/src/node-sqlite-adapter.ts` → `RawResult`), and a body that is just one
 * statement therefore returns a `RawResult` — which the old `Promise<T>` parameter refused, taking
 * `T` as `unknown` and turning every `.rows` read in the caller into a second error. Measured over
 * the branch with `npx tsc --noEmit` per package: widening this one parameter took
 * `packages/fiscal-verifactu` from 142 errors to 7, `packages/db` from 35 to 28 and
 * `packages/identity` from 19 to 17. Nothing changes at runtime — `await` on a non-promise was
 * already what these call sites did.
 *
 * A database handed to this function must carry the core migration set's `change_log` table —
 * without it the drain is refused `no such table: change_log`, from a statement the caller never
 * wrote. Nothing but this line declares that dependency, and no suite has hit it: the ones that
 * migrate an empty set call nothing that reaches here.
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

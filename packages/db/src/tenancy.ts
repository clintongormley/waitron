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
 * Two consequences. The drain is a WRITE, so a session the database has put in READ ONLY mode would
 * refuse it with `25006`; nothing in this repository sets that mode today (`grep -rn
 * "default_transaction_read_only\|transaction read only" --include='*.ts' --include='*.sql' packages
 * apps deploy` matches nothing). And a database handed to this function must carry the core
 * migration set's `change_log` table — without it the drain fails `42P01`, from a statement the
 * caller never wrote. Nothing but this line declares that dependency, and no suite has hit it: the
 * ones that migrate an empty set call nothing that reaches here.
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

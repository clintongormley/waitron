import type { ResourceChange } from "@waitron/shared";
import { id, json, newId, table } from "./columns.js";

/**
 * What changed, written by the change trigger and taken out again by the transaction that caused
 * it (`../change-log.ts`).
 *
 * Two columns and no more — which holds while every writer reaches this table through
 * `withTransaction`. On that path a row is inserted, delivered and deleted inside one transaction,
 * so nothing needs a sequence, a written-at time or a copy of the resource name: the dashboard's
 * live API collects a batch's identities into a Map keyed by the identity itself before flushing
 * them together (`apps/server/src/live-api.ts`, the `pending` map), so two changes arriving in
 * either order reach the client the same way. Off that path the sentence stops holding — a row a
 * direct writer left behind sits until some later transaction sweeps it, and with no timestamp an
 * orphan looks exactly like a row written a second ago. Accepted rather than fixed: the sweep makes
 * an orphan short-lived, and a timestamp column would be read by nothing.
 *
 * `local`: this node's own signal to its own dashboard, never venue data, and the INTENTION is that
 * it travels in neither a backup nor a replication stream — a standby inheriting a half-drained log
 * would deliver changes for work it did not do. Nothing holds the backup half today: a backup is
 * `VACUUM INTO` over the whole venue file (`packages/store/src/archive.ts`), which excludes no
 * table, so an archive carries whatever was in this one. The replication half is a property of
 * whatever stream is declared, and no product code replicates yet (CLAUDE.md §3).
 *
 * OPEN for the storage switch, and NOT settled here: after the flip the class also picks the
 * database FILE, and `local` would put this table on the far side of the split from the triggers
 * that write it. The question, the reason `local` is still right for replication, and what to check
 * first are in `docs/backlog.md` under Task P3.
 *
 * It is deliberately NOT one of its own change sources — see `CORE_CHANGE_SOURCES` in
 * `../classification.ts`.
 */
export const changeLog = table("change_log", {
  // Nothing reads this column. The grep that discriminates is on the TABLE name, not the drizzle
  // identifier — every real use of this table is raw SQL, so `changeLog` appears in this file alone:
  // `grep -rn change_log --include='*.ts' --include='*.sql' --include='*.mjs' packages apps scripts`
  // returns hits that name `payload` and never `id`. Kept so the table carries an identity of its
  // own, the way most of this schema's tables do; no behaviour depends on its value.
  id: id("id").primaryKey().$defaultFn(newId),
  payload: json<ResourceChange>("payload").notNull(),
});

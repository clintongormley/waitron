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
 * `local`: one node's signal to its own dashboard. It is in `venue.db` like every table, the file
 * slice 2 will stream (slice-2 spec §2). A row a direct writer left behind is delivered by the next
 * `withTransaction` on whichever node then holds the file; once a rebuild from that stream lands,
 * that can be a rebuilt box, where the row is a notice to re-read one resource.
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

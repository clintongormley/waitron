import type { ResourceChange } from "@waitron/shared";
import { id, json, newId, table } from "./columns.js";

/**
 * What changed, written by the change trigger and taken out again by the transaction that caused
 * it (`../change-log.ts`).
 *
 * Two columns and no more — which holds while every writer reaches this table through
 * `withTransaction`. On that path a row is inserted, delivered and deleted inside one transaction,
 * so nothing needs a sequence, a written-at time or a copy of the resource name. Off that path a
 * row a direct writer left behind sits until some later transaction sweeps it, and with no
 * timestamp an orphan looks exactly like a row written a second ago. Accepted rather than fixed:
 * the sweep makes an orphan short-lived, and a timestamp column would be read by nothing.
 *
 * `local`: one node's signal to its own dashboard. A row a direct writer left behind is delivered
 * by the next `withTransaction` on whichever node then holds the file, where it is a notice to
 * re-read one resource.
 *
 * It is deliberately NOT one of its own change sources — see `CORE_CHANGE_SOURCES` in
 * `../classification.ts`.
 */
export const changeLog = table("change_log", {
  // Nothing reads this column; no behaviour depends on its value.
  id: id("id").primaryKey().$defaultFn(newId),
  payload: json<ResourceChange>("payload").notNull(),
});

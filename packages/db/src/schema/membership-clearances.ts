import { bigCount, id, newId, now, table, ts } from "./columns.js";

/**
 * One row per removed machine an admin cleared from the venue's membership chart, written in the
 * same transaction as the chart that moves it from `nodes` to `revoked`
 * (`apps/server/src/membership-removal.ts`).
 *
 * `cleared_node_id` and `person_id` are plain ids with no FK; `persons` is in @waitron/identity's
 * migration set, not the core one.
 */
export const membershipClearances = table("membership_clearances", {
  id: id("id").primaryKey().$defaultFn(newId),
  clearedNodeId: id("cleared_node_id").notNull(),
  personId: id("person_id").notNull(),
  term: bigCount("term").notNull(),
  clearedAt: ts("cleared_at").notNull().$defaultFn(now),
});

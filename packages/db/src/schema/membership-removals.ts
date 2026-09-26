import { bigCount, id, label, newId, now, table, ts } from "./columns.js";

/**
 * One row per machine an admin removed from the venue's membership chart, written in the same
 * transaction as the chart that marks it `evicted` (`apps/server/src/membership-removal.ts`).
 *
 * `node_id` and `person_id` are plain ids with no FK: the removed node has no `nodes` row here by
 * the rule that allows its removal, and `persons` is in @waitron/identity's migration set, not the
 * core one.
 */
export const membershipRemovals = table("membership_removals", {
  id: id("id").primaryKey().$defaultFn(newId),
  nodeId: id("node_id").notNull(),
  contactUrl: label("contact_url").notNull(),
  personId: id("person_id").notNull(),
  term: bigCount("term").notNull(),
  removedAt: ts("removed_at").notNull().$defaultFn(now),
});

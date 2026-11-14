import { count, id, table, ts } from "@waitron/db";

/**
 * Takes of the followed copy at the emergency switch that failed after stopping the follower,
 * whether the sign-in or the copy was refused. Each restarts the box, which empties the in-memory
 * password throttle, so the count that bounds them has to outlive the process.
 */
export const nodeTakeFailures = table("node_take_failures", {
  nodeId: id("node_id").primaryKey(),
  failures: count("failures").notNull(),
  lastFailedAt: ts("last_failed_at").notNull(),
});

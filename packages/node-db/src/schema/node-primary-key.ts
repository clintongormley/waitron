import { id, label, now, table, ts } from "@waitron/db";

/** The main box's public key, as pinned by this box. */
export const nodePrimaryKey = table("node_primary_key", {
  // The box that pinned the key.
  nodeId: id("node_id").primaryKey(),
  // A venue `nodes` row. Nothing in node.db establishes that the row exists: node.db holds no
  // venue table, and no foreign key crosses the two files.
  primaryNodeId: id("primary_node_id").notNull(),
  publicKey: label("public_key").notNull(),
  pinnedAt: ts("pinned_at").notNull().$defaultFn(now),
});

import { id, label, now, table, ts } from "@waitron/db";

/** A mirror's link to the box it was adopted from. Non-secret parts only. */
export const nodeMirrorLink = table("node_mirror_link", {
  nodeId: id("node_id").primaryKey(),
  relayUrl: label("relay_url").notNull(),
  boxHostname: label("box_hostname").notNull(),
  boxCaPem: label("box_ca_pem").notNull(),
  // The primary this mirror was adopted from, a venue `nodes` row. Nothing in node.db establishes
  // that the row exists: node.db holds no venue table, and no foreign key crosses the two files.
  originNodeId: id("origin_node_id").notNull(),
  adoptedAt: ts("adopted_at").notNull().$defaultFn(now),
});

import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { count, id, table } from "./columns.js";
import { nodes } from "./nodes.js";

/**
 * Keyed by (node_id), no surrogate id: there is exactly one counter per node and the
 * key is the identity. The (node_id) → nodes FK below keeps it
 * referential, mirroring `working_orders_node_fk`/`sales_node_fk`.
 */
export const workingOrderCounters = table(
  "working_order_counters",
  {
    nodeId: id("node_id").notNull(),
    nextNumber: count("next_number").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId], name: "working_order_counters_pk" }),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "working_order_counters_node_fk",
    }),
  ],
);

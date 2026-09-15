import { foreignKey, integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";

/**
 * Keyed by (node_id), no surrogate id: there is exactly one counter per node and the
 * key is the identity. The composite (node_id) → nodes FK below keeps it
 * referential, mirroring `working_orders_node_fk`/`sales_node_fk`.
 */
export const workingOrderCounters = pgTable(
  "working_order_counters",
  {
    nodeId: uuid("node_id").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
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

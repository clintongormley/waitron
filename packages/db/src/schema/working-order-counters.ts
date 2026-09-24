import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { count, id, table } from "./columns.js";
import { nodes } from "./nodes.js";

/** One counter per node, keyed by node_id; read and advanced by `allocateOrderNumber`. */
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

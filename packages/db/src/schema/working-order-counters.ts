import { foreignKey, integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";

/**
 * Keyed by (tenant_id, node_id), no surrogate id: there is exactly one counter per node and the
 * key is the identity. The composite (tenant_id, node_id) → nodes FK below keeps it
 * tenant-consistent — a counter cannot name a node of another tenant — mirroring
 * `working_orders_node_fk`/`sales_node_fk`, which the composite `nodes_tenant_id_key` UNIQUE
 * exists to target.
 */
export const workingOrderCounters = pgTable(
  "working_order_counters",
  {
    tenantId: uuid("tenant_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.nodeId], name: "working_order_counters_pk" }),
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "working_order_counters_node_fk",
    }),
  ],
);

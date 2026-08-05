import { foreignKey, integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";

/**
 * The per-node allocator for `working_orders.order_number` (park & retrieve, sub-project 7b). One
 * row per (tenant, node): `next_number` is the number the next parked order on that node will take,
 * bumped as part of allocating it. A counter, not a sequence — it is tenant-scoped, replicates as
 * ordinary row data (memory: replication is shared infra), and is read/incremented under the same
 * RLS as everything else the till writes, rather than living outside the tenant model as a
 * Postgres SEQUENCE would.
 *
 * Keyed by (tenant_id, node_id), no surrogate id: there is exactly one counter per node and the
 * key is the identity. The composite (tenant_id, node_id) → nodes FK below keeps it
 * tenant-consistent — a counter cannot name a node of another tenant — mirroring
 * `working_orders_node_fk`/`sales_node_fk`, which the composite `nodes_tenant_id_key` UNIQUE
 * exists to target.
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY. The FORCE ROW LEVEL SECURITY, the
 * `working_order_counters_tenant_isolation` policy and the SELECT/INSERT/UPDATE grant to `app_user`
 * (no DELETE — a counter is never removed) are hand-written in the custom migration, exactly as
 * 0027 does for the catalogue tables and 0004 for working_orders. The `inmutabilidad` guard in
 * packages/fiscal-verifactu scans every tenant_id-bearing table for both flags, so a missing FORCE
 * here fails that suite, not this package's.
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
).enableRLS();

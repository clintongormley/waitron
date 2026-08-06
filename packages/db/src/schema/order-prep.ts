import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { nodes } from "./nodes.js";
import { workingOrders } from "./orders.js";

/**
 * The prep lifecycle (design §5). `send-to-prep` (= placing) enqueues at `queued`; the cook advances
 * queued → preparing → ready → collected. A faithful reading of the spec's "send-to-prep →
 * preparing → ready → collected": send-to-prep is the ENQUEUE (creating the row at `queued`), the
 * three named states are what follow (flagged interpretation, design §5).
 */
export const prepState = pgEnum("prep_state", ["queued", "preparing", "ready", "collected"]);

/**
 * Operational prep progress for a working order — MUTABLE, node-scoped, ephemeral. A SEPARATE table
 * (not a `working_orders.prep_state` column) because prep advances even after the order is fiscally
 * FROZEN: in Mode P (prepay) the order is already `settled` when prep runs, and the
 * `working_orders_enforce_transition` guard rightly rejects any update of a settled row. So prep
 * lives here and advances freely regardless of the order's fiscal status (design §5). One row per
 * working order (PK is the order), so a placed/settled order has exactly one prep record.
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY. The FORCE ROW LEVEL SECURITY, the
 * `order_prep_tenant_isolation` policy and the SELECT/INSERT/UPDATE grant to `app_user` (no DELETE —
 * a cancelled order's prep row is cascaded by the order FK, never deleted directly) are hand-written
 * in the custom migration (0030), exactly as 0029 does for `working_order_counters`. MUTABLE, so no
 * immutability triggers. The `inmutabilidad` guard in packages/fiscal-verifactu scans every
 * tenant_id-bearing table for both RLS flags, so a missing FORCE here fails that suite.
 */
export const orderPrep = pgTable(
  "order_prep",
  {
    tenantId: uuid("tenant_id").notNull(),
    workingOrderId: uuid("working_order_id").notNull(),
    // The node the prep happens on — the queue is node-scoped, like the held list (design §5).
    nodeId: uuid("node_id").notNull(),
    state: prepState("state").notNull().default("queued"),
    queuedAt: timestamp("queued_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    preparingAt: timestamp("preparing_at", { withTimezone: true, mode: "string" }),
    readyAt: timestamp("ready_at", { withTimezone: true, mode: "string" }),
    collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    // The order IS the key: one prep record per working order. Composite (tenant_id,
    // working_order_id), matching working_order_counters — the PK is declared here (name pinned so
    // the generated SQL and snapshot agree with the migration's CONSTRAINT "order_prep_pk").
    primaryKey({ columns: [t.tenantId, t.workingOrderId], name: "order_prep_pk" }),
    // The order IS the key: one prep record per working order.
    foreignKey({
      columns: [t.tenantId, t.workingOrderId],
      foreignColumns: [workingOrders.tenantId, workingOrders.id],
      name: "order_prep_order_fk",
    }).onDelete("cascade"),
    // Tenant-consistent node FK (mirrors working_orders_node_fk): a prep row cannot point at
    // another tenant's node.
    foreignKey({
      columns: [t.tenantId, t.nodeId],
      foreignColumns: [nodes.tenantId, nodes.id],
      name: "order_prep_node_fk",
    }),
    index("order_prep_queue_idx").on(t.tenantId, t.nodeId, t.state),
  ],
).enableRLS();

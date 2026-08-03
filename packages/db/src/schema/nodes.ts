import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * A compute node that runs a venue's POS and operates as its SIF (#33 — the "server" of that
 * design; called `node` here because in US restaurant English "server" means a waiter, and this
 * is a machine, not a person). One node per venue today; active-active/failover (a `role` column,
 * a second node) are later specs. Deliberately regime-neutral, like `tills`: the Veri*Factu SIF
 * identity (NúmeroInstalación, IdSistemaInformatico) lives in the module-owned `registro_sif`
 * table, which the node rekey re-keys from till to node (the SIF is the node — #33).
 */
export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Composite target so fiscal/commercial tables can carry a tenant-consistent (tenant_id,
    // node_id) FK — the same role invoice_series_tenant_id_key plays for `sales`.
    unique("nodes_tenant_id_key").on(t.tenantId, t.id),
    index("nodes_tenant_id_idx").on(t.tenantId),
  ],
).enableRLS();

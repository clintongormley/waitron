import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * A compute node that runs a venue's POS and operates as its SIF (#33 — the "server" of that
 * design; called `node` here because in US restaurant English "server" means a waiter, and this
 * is a machine, not a person). One node per venue today; active-active/failover (a `role` column,
 * a second node) are later specs. Deliberately regime-neutral, like `tills`: the Veri*Factu SIF
 * identity (NúmeroInstalación, IdSistemaInformatico) lives in the module-owned `registro_sif`
 * table, which the node rekey re-keys from till to node (the SIF is the node — #33).
 *
 * `filing_module`/`tax_module` are nullable and stamped at provision time from the location's
 * territory (Task D1); the authoritative per-sale value stays `sales.fiscal_backend` — these are
 * the node's recorded modules, so the running SIF knows its backend without re-resolving. Nullable
 * to keep the reshape off every existing bare-node fixture (`seedNode`, `seedNodesForSifContention`,
 * `drain-fixtures`); pre-production, so a later NOT NULL tightening is free.
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
    filingModule: text("filing_module"),
    taxModule: text("tax_module"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    // Composite target so fiscal/commercial tables can carry a tenant-consistent (tenant_id,
    // node_id) FK — the same role invoice_series_tenant_id_key plays for `sales`.
    unique("nodes_tenant_id_key").on(t.tenantId, t.id),
    index("nodes_tenant_id_idx").on(t.tenantId),
  ],
).enableRLS();

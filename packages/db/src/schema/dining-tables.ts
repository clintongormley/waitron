import {
  boolean,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tableServiceStatuses } from "./table-service-statuses.js";
import { locations, tenants } from "./tenants.js";

/**
 * A dining table — tenant + location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
 * `node` (working orders, the held list, the order-number counter and the prep queue are all
 * node-scoped, but a table must not fragment when a venue runs a second node — design §2a).
 *
 * `tab_id` is the BACK-POINTER to the open tab covering this table (design §2b): set ⇒ this table is
 * covered by that open working order; a single nullable FK gives one-open-tab-per-table automatically
 * (no partial-unique, no CHECK). Several tables pointing at the SAME tab is a join (TS-3); TS-1 only
 * ever sets one table's tab_id per tab. It is a BARE column here — its FK to working_orders is
 * hand-written in the mutual-FK migration (Task 2), because the reverse FK
 * (working_orders.delivery_table_id → dining_tables) would otherwise close a load-time import cycle.
 *
 * Deactivate, never hard-delete (`active`), because a table has order history. `.enableRLS()` emits only
 * ENABLE ROW LEVEL SECURITY; the FORCE ROW LEVEL SECURITY, the `dining_tables_tenant_isolation` policy
 * and the SELECT/INSERT/UPDATE grant (no DELETE — deactivate) are hand-written in the custom migration,
 * exactly as 0039 does for `ingredients`. The `inmutabilidad` guard in packages/fiscal-verifactu scans
 * every tenant_id-bearing table for both RLS flags, so a missing FORCE here fails that suite.
 */
export const diningTables = pgTable(
  "dining_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, location_id) →
    // locations(tenant_id, id) declared below (mirroring working_orders_node_fk).
    locationId: uuid("location_id").notNull(),
    // The human id shown on the floor ("12", "Terraza 3"). Unique within a venue (see below).
    label: text("label").notNull(),
    // Optional grouping ("terrace" / "bar" / "inside") — a data value, not an identifier.
    zone: text("zone"),
    // Covers. Nullable.
    capacity: integer("capacity"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // The open tab covering this table (design §2b). Nullable back-pointer; a set value points at an
    // `open` working order. BARE column — its (tenant_id, tab_id) → working_orders(tenant_id, id) FK is
    // hand-written in Task 2's custom migration (the mutual-FK cycle note above).
    tabId: uuid("tab_id"),
    // The table's single current MANUAL status (design §2b), or NULL for none. Shown ALWAYS — a
    // just-vacated `free` table may still carry a "needs-cleaning" status. Additive nullable column;
    // dining_tables' TS-1 FORCE-RLS policy + app_user grants already cover it (grants table-wide, RLS
    // row-level). The FK is the tenant-consistent COMPOSITE in extraConfig below.
    statusId: uuid("status_id"),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for working_orders' tenant-consistent
    // (tenant_id, delivery_table_id) FK (Task 2), the same role nodes_tenant_id_key plays for
    // working_orders_node_fk.
    unique("dining_tables_tenant_id_key").on(t.tenantId, t.id),
    // No duplicate labels within a venue.
    unique("dining_tables_location_label_key").on(t.tenantId, t.locationId, t.label),
    // Tenant-consistent composite FK to the owning location: a table cannot point at a location of
    // another tenant, independently of whether RLS is in force on this connection.
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "dining_tables_location_fk",
    }),
    // Tenant-consistent composite FK to the venue's configured status set (design §2b): a table cannot
    // point at a status of another tenant, independently of RLS. MATCH SIMPLE satisfies it while the
    // column is NULL, so it stays nullable. `table_service_statuses` deactivates rather than deletes,
    // so this FK never dangles (no ON DELETE path is exercised).
    foreignKey({
      columns: [t.tenantId, t.statusId],
      foreignColumns: [tableServiceStatuses.tenantId, tableServiceStatuses.id],
      name: "dining_tables_status_fk",
    }),
  ],
).enableRLS();

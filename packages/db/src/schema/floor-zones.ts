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
import { locations, tenants } from "./tenants.js";

/**
 * A venue-configured floor-plan ZONE (FP-1) — "Comedor", "Terraza", "Barra". A grouping the live
 * floor renders tables under; the successor to the free-text `dining_tables.zone` string this task
 * drops, so a zone is now an authorable ROW (rename once, reorder, deactivate) rather than a value
 * re-typed onto every table. `dining_tables.zone_id` points at one of these (a single nullable
 * composite FK, added in the paired --custom migration).
 *
 * Location-scoped, unlike TS-2's tenant-wide `table_service_statuses`: a floor plan belongs to one
 * venue, so the composite (tenant_id, location_id) → locations(tenant_id, id) FK ties a zone to its
 * venue, and `floor_zones_name_key` makes a name unique within that venue rather than tenant-wide.
 */
export const floorZones = pgTable(
  "floor_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason orders.ts / layouts.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the FK is the tenant-consistent COMPOSITE (tenant_id, location_id) →
    // locations(tenant_id, id) declared below (mirroring dining_tables_location_fk).
    locationId: uuid("location_id").notNull(),
    // The human label the floor plan groups tables under ("Comedor", "Terraza"). Unique within a venue.
    name: text("name").notNull(),
    // Author-controlled ordering in the editor + the floor-plan layout.
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target for dining_tables' tenant-consistent
    // (tenant_id, zone_id) FK (hand-written custom migration), the same role
    // table_service_statuses_tenant_id_key plays for dining_tables_status_fk.
    unique("floor_zones_tenant_id_key").on(t.tenantId, t.id),
    // No two zones share a name within a venue.
    unique("floor_zones_name_key").on(t.tenantId, t.locationId, t.name),
    foreignKey({
      columns: [t.tenantId, t.locationId],
      foreignColumns: [locations.tenantId, locations.id],
      name: "floor_zones_location_fk",
    }),
  ],
);

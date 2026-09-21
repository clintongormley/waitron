import { foreignKey, unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A venue-configured floor-plan ZONE (FP-1) — "Comedor", "Terraza", "Barra". A grouping the live
 * floor renders tables under; the successor to the free-text `dining_tables.zone` string this task
 * drops, so a zone is now an authorable ROW (rename once, reorder, deactivate) rather than a value
 * re-typed onto every table. `dining_tables.zone_id` points at one of these (a single nullable
 * FK, added in the paired --custom migration).
 *
 * Location-scoped, unlike the venue-wide `table_service_statuses`: a floor plan belongs to one
 * venue, so the (location_id) → locations(id) FK ties a zone to its
 * venue, and `floor_zones_name_key` makes a name unique within that venue.
 */
export const floorZones = table(
  "floor_zones",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Bare column: the FK is the (location_id) →
    // locations(id) declared below (mirroring dining_tables_location_fk).
    locationId: id("location_id").notNull(),
    // The human label the floor plan groups tables under ("Comedor", "Terraza"). Unique within a venue.
    name: label("name").notNull(),
    // Author-controlled ordering in the editor + the floor-plan layout.
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // No two zones share a name within a venue.
    unique("floor_zones_name_key").on(t.locationId, t.name),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "floor_zones_location_fk",
    }),
  ],
);

import { foreignKey, unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A venue-configured floor-plan ZONE — "Comedor", "Terraza", "Barra". A grouping the live floor
 * renders tables under: an authorable ROW (rename once, reorder, deactivate) rather than a value
 * re-typed onto every table. `dining_tables.zone_id` points at one of these.
 *
 * Location-scoped, unlike the venue-wide `table_service_statuses`: a floor plan belongs to one
 * venue.
 */
export const floorZones = table(
  "floor_zones",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    // Author-controlled ordering in the editor + the floor-plan layout.
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("floor_zones_name_key").on(t.locationId, t.name),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "floor_zones_location_fk",
    }),
  ],
);

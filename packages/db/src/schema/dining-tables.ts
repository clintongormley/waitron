import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { foreignKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "./columns.js";
import { floorPlanTables } from "./floor-plans.js";
import { floorZones } from "./floor-zones.js";
import { locations } from "./tenants.js";

/**
 * A dining table — location scoped, long-lived. Anchored to the venue-wide `location`, NOT to
 * `node` (working orders, the held list, the order-number counter and the prep queue are all
 * node-scoped, but a table must not fragment when a venue runs a second node).
 */
export const diningTables = table(
  "dining_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    label: label("label").notNull(),
    shortName: label("short_name"),
    // Written only through `shortNameColumns`; nothing in the database ties it to `short_name`.
    shortNameKey: label("short_name_key"),
    zoneId: id("zone_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    needsClearingSince: tsString("needs_clearing_since"),
    // The master table this live table follows.
    planTableId: id("plan_table_id").references((): AnySQLiteColumn => floorPlanTables.id),
  },
  (t) => [
    unique("dining_tables_location_label_key").on(t.locationId, t.label),
    uniqueIndex("dining_tables_location_short_name_key_uq").on(t.locationId, t.shortNameKey),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "dining_tables_location_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "dining_tables_zone_fk",
    }),
  ],
);

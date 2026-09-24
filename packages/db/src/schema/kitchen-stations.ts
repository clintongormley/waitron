import { sql } from "drizzle-orm";
import { check, foreignKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A kitchen station: the routing target a fired line resolves to. The `is_default` station is the
 * fallback for a line whose product and category name none; `kitchen_stations_default_key` allows at
 * most one per venue.
 */
export const kitchenStations = table(
  "kitchen_stations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    displayOrder: count("display_order").notNull().default(0),
    warmAfterMinutes: count("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: count("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: count("forgotten_after_minutes").notNull().default(15),
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("kitchen_stations_name_key").on(t.locationId, t.name),
    uniqueIndex("kitchen_stations_default_key")
      .on(t.locationId)
      .where(sql`${t.isDefault}`),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_stations_location_fk",
    }),
    check(
      "kitchen_stations_thresholds_ordered",
      sql`${t.warmAfterMinutes} < ${t.overdueAfterMinutes} and ${t.overdueAfterMinutes} < ${t.forgottenAfterMinutes}`,
    ),
  ],
);

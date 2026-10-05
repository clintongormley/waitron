import { sql } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { count, id, table } from "./columns.js";
import { kitchenStations } from "./kitchen-stations.js";
import { locations } from "./tenants.js";

export const kitchenTimingDefaults = table(
  "kitchen_timing_defaults",
  {
    locationId: id("location_id").primaryKey(),
    warmAfterMinutes: count("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: count("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: count("forgotten_after_minutes").notNull().default(15),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "kitchen_timing_defaults_location_fk",
    }),
    check(
      "kitchen_timing_defaults_ordered",
      sql`${t.warmAfterMinutes} >= 1 and ${t.warmAfterMinutes} < ${t.overdueAfterMinutes} and ${t.overdueAfterMinutes} < ${t.forgottenAfterMinutes}`,
    ),
  ],
);

// The nullable overrides live beside stations so changing inheritance does not rebuild a parent
// referenced by retained tickets and routing rows.
export const kitchenStationTiming = table(
  "kitchen_station_timing",
  {
    stationId: id("station_id").primaryKey(),
    warmAfterMinutes: count("warm_after_minutes"),
    overdueAfterMinutes: count("overdue_after_minutes"),
    forgottenAfterMinutes: count("forgotten_after_minutes"),
  },
  (t) => [
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "kitchen_station_timing_station_fk",
    }),
  ],
);

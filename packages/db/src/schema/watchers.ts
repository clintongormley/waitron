import { sql } from "drizzle-orm";
import { foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { floorZones } from "./floor-zones.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { locations } from "./tenants.js";

/** A kitchen view following stations and zones. Disable it rather than deleting a device's binding. */
export const watchers = table(
  "watchers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    everyStation: flag("every_station").notNull().default(false),
    everyZone: flag("every_zone").notNull().default(false),
    runsPass: flag("runs_pass").notNull().default(false),
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("watchers_name_key")
      .on(t.locationId, t.name)
      .where(sql`${t.active}`),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "watchers_location_fk",
    }),
  ],
);

export const watcherStations = table(
  "watcher_stations",
  { watcherId: id("watcher_id").notNull(), stationId: id("station_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.watcherId, t.stationId], name: "watcher_stations_pk" }),
    foreignKey({
      columns: [t.watcherId],
      foreignColumns: [watchers.id],
      name: "watcher_stations_watcher_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "watcher_stations_station_fk",
    }),
  ],
);

export const watcherZones = table(
  "watcher_zones",
  { watcherId: id("watcher_id").notNull(), zoneId: id("zone_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.watcherId, t.zoneId], name: "watcher_zones_pk" }),
    foreignKey({
      columns: [t.watcherId],
      foreignColumns: [watchers.id],
      name: "watcher_zones_watcher_fk",
    }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "watcher_zones_zone_fk",
    }),
  ],
);

/** A printer serves one watcher's copies. */
export const watcherPrinters = table(
  "watcher_printers",
  { printerId: id("printer_id").primaryKey(), watcherId: id("watcher_id").notNull() },
  (t) => [
    foreignKey({
      columns: [t.printerId],
      foreignColumns: [printers.id],
      name: "watcher_printers_printer_fk",
    }),
    foreignKey({
      columns: [t.watcherId],
      foreignColumns: [watchers.id],
      name: "watcher_printers_watcher_fk",
    }),
  ],
);

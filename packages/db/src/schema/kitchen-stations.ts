import type { StationColour, TicketGrouping } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * A kitchen station: the routing target a fired line resolves to. The `is_default` station is the
 * fallback when no routing cell decides a line's station; `kitchen_stations_default_key` allows at most
 * one per venue.
 */
export const kitchenStations = table(
  "kitchen_stations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    // The CHECK orders the three; the station routes and the import refuse a minute below 1, because adding that to the CHECK would rebuild this table.
    warmAfterMinutes: count("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: count("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: count("forgotten_after_minutes").notNull().default(15),
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    showsRestOfOrder: flag("shows_rest_of_order").notNull().default(false),
    // Null prints MOVED slips; the station routes write a boolean.
    printMovedSlips: flag("print_moved_slips"),
    // The station routes and the import refuse a value outside `isStationColour`; a CHECK would rebuild this table.
    colour: label("colour").$type<StationColour>().notNull().default("red"),
    // The station routes and the import refuse a value outside `isTicketGrouping`; a CHECK would rebuild this table.
    ticketGrouping: label("ticket_grouping").$type<TicketGrouping>().notNull().default("combined"),
    printHeldWork: flag("print_held_work").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("kitchen_stations_name_key")
      .on(t.locationId, t.name)
      .where(sql`${t.active} = 1`),
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

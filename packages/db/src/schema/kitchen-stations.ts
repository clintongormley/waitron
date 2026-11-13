import {
  STATION_COLOURS,
  TICKET_GROUPINGS,
  BUMP_MODES,
  CHANGES_AFTER_SENDING,
  quoteLiteral,
} from "@waitron/shared";
import type { BumpMode, ChangesAfterSending, StationColour, TicketGrouping } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  flag,
  id,
  json,
  jsonShapeCheck,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";

/**
 * A kitchen station: the routing target a fired line resolves to. The `is_default` station is the
 * fallback when no routing cell decides a line's station; `kitchen_stations_default_key` allows at most
 * one per venue.
 */
export const kitchenStations = table(
  "kitchen_stations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    warmAfterMinutes: count("warm_after_minutes").notNull().default(5),
    overdueAfterMinutes: count("overdue_after_minutes").notNull().default(10),
    forgottenAfterMinutes: count("forgotten_after_minutes").notNull().default(15),
    readyWarningAfterMinutes: count("ready_warning_after_minutes").notNull().default(3),
    isDefault: flag("is_default").notNull().default(false),
    active: flag("active").notNull().default(true),
    showsRestOfOrder: flag("shows_rest_of_order").notNull().default(false),
    // Null prints MOVED slips; the station routes write a boolean.
    printMovedSlips: flag("print_moved_slips"),
    colour: label("colour").$type<StationColour>().notNull().default("red"),
    ticketGrouping: label("ticket_grouping").$type<TicketGrouping>().notNull().default("combined"),
    printHeldWork: flag("print_held_work").notNull().default(false),
    bumpMode: label("bump_mode").$type<BumpMode>().notNull().default("line"),
    changesAfterSending: label("changes_after_sending")
      .$type<ChangesAfterSending>()
      .notNull()
      .default("held-or-waiting"),
    waitsForPass: flag("waits_for_pass").notNull().default(false),
    // station-printers.ts checks printer existence; withPrinter deduplicates; deletePrinter clears IDs.
    printerIds: json<string[]>("printer_ids").notNull().default([]),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    closedOnDay: day("closed_on_day"),
    closedSendsToStationId: id("closed_sends_to_station_id").references(
      (): AnySQLiteColumn => kitchenStations.id,
    ),
    whenClosedSendsToStationId: id("when_closed_sends_to_station_id").references(
      (): AnySQLiteColumn => kitchenStations.id,
    ),
  },
  (t) => [
    check("kitchen_stations_printer_ids_ck", jsonShapeCheck(t.printerIds, "array")),
    check(
      "kitchen_stations_closed_sends_to_ck",
      sql`${t.closedSendsToStationId} is null or ${t.closedOnDay} is not null`,
    ),
    check(
      "kitchen_stations_closed_sends_to_not_self_ck",
      sql`${t.closedSendsToStationId} <> ${t.id}`,
    ),
    check(
      "kitchen_stations_when_closed_sends_to_not_self_ck",
      sql`${t.whenClosedSendsToStationId} <> ${t.id}`,
    ),
    check("kitchen_stations_warm_after_ck", sql`${t.warmAfterMinutes} >= 1`),
    check("kitchen_stations_ready_warning_after_ck", sql`${t.readyWarningAfterMinutes} >= 1`),
    check(
      "kitchen_stations_colour_ck",
      sql`${t.colour} in (${sql.raw(STATION_COLOURS.map(quoteLiteral).join(", "))})`,
    ),
    check(
      "kitchen_stations_ticket_grouping_ck",
      sql`${t.ticketGrouping} in (${sql.raw(TICKET_GROUPINGS.map(quoteLiteral).join(", "))})`,
    ),
    check(
      "kitchen_stations_bump_mode_ck",
      sql`${t.bumpMode} in (${sql.raw(BUMP_MODES.map(quoteLiteral).join(", "))})`,
    ),
    check(
      "kitchen_stations_changes_after_sending_ck",
      sql`${t.changesAfterSending} in (${sql.raw(CHANGES_AFTER_SENDING.map(quoteLiteral).join(", "))})`,
    ),
    uniqueIndex("kitchen_stations_name_key")
      .on(t.name)
      .where(sql`${t.active} = 1`),
    uniqueIndex("kitchen_stations_default_key")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
    check(
      "kitchen_stations_thresholds_ordered",
      sql`${t.warmAfterMinutes} < ${t.overdueAfterMinutes} and ${t.overdueAfterMinutes} < ${t.forgottenAfterMinutes}`,
    ),
  ],
);

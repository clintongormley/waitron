import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, flag, id, kitchenStations, newId, table } from "@waitron/db";

export const stationDayStates = table(
  "station_day_states",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    stationId: id("station_id").notNull(),
    businessDay: day("business_day").notNull(),
    open: flag("open").notNull(),
    sendsToStationId: id("sends_to_station_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "station_day_states_station_fk",
    }),
    foreignKey({
      columns: [t.sendsToStationId],
      foreignColumns: [kitchenStations.id],
      name: "station_day_states_sends_to_fk",
    }),
    uniqueIndex("station_day_states_day_key").on(t.stationId, t.businessDay),
    check("station_day_states_sends_to_not_self_ck", sql`${t.sendsToStationId} <> ${t.stationId}`),
  ],
);

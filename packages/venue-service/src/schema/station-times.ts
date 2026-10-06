import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, flag, id, kitchenStations, newId, table } from "@waitron/db";

export const stationFallbacks = table(
  "station_fallbacks",
  {
    stationId: id("station_id").primaryKey(),
    fallbackStationId: id("fallback_station_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "station_fallbacks_station_fk",
    }),
    foreignKey({
      columns: [t.fallbackStationId],
      foreignColumns: [kitchenStations.id],
      name: "station_fallbacks_fallback_fk",
    }),
    check("station_fallbacks_not_self_ck", sql`${t.stationId} <> ${t.fallbackStationId}`),
  ],
);

export const stationDayStates = table(
  "station_day_states",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    stationId: id("station_id").notNull(),
    businessDay: day("business_day").notNull(),
    open: flag("open").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "station_day_states_station_fk",
    }),
    uniqueIndex("station_day_states_day_key").on(t.stationId, t.businessDay),
  ],
);

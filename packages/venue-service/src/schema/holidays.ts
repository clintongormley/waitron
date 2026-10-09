import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, id, label, locations, newId, table } from "@waitron/db";

export const holidayGeographies = table(
  "holiday_geographies",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    country: label("country").notNull(),
    provinceCode: label("province_code").notNull(),
    city: label("city").notNull(),
    cityKey: label("city_key").notNull(),
    areaKey: label("area_key"),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "holiday_geographies_location_fk",
    }),
    uniqueIndex("holiday_geographies_location_place_key").on(
      t.locationId,
      t.country,
      t.provinceCode,
      t.cityKey,
    ),
    check("holiday_geographies_city_ck", sql`trim(${t.city}) <> '' and ${t.cityKey} <> ''`),
  ],
);

export const localHolidays = table(
  "local_holidays",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    geographyId: id("geography_id").notNull(),
    date: day("date").notNull(),
    name: label("name").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.geographyId],
      foreignColumns: [holidayGeographies.id],
      name: "local_holidays_geography_fk",
    }).onDelete("cascade"),
    uniqueIndex("local_holidays_geography_date_key").on(t.geographyId, t.date),
    check(
      "local_holidays_date_ck",
      sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check("local_holidays_name_ck", sql`trim(${t.name}) <> ''`),
  ],
);

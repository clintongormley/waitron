import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, locations, newId, table } from "@waitron/db";

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

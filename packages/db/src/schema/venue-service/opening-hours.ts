import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, id, newId, table, timeOfDay } from "../columns.js";
import { floorZones } from "../floor-zones.js";
import { menuPeriods } from "./menus.js";
import { seasons, specialDayDates } from "./seasons.js";
import { departments } from "./service.js";

export const openingHours = table(
  "opening_hours",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id"),
    zoneId: id("zone_id"),
    seasonId: id("season_id"),
    weekday: count("weekday"),
    specialDayDateId: id("special_day_date_id"),
    kind: enumType(["period", "closed", "open"])("kind").notNull(),
    periodId: id("period_id"),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "opening_hours_department_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "opening_hours_zone_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.seasonId],
      foreignColumns: [seasons.id],
      name: "opening_hours_season_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.specialDayDateId],
      foreignColumns: [specialDayDates.id],
      name: "opening_hours_date_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "opening_hours_period_fk",
    }),
    check("opening_hours_one_owner_ck", sql`(${t.departmentId} is null) <> (${t.zoneId} is null)`),
    check(
      "opening_hours_one_day_ck",
      sql`(${t.seasonId} is null) <> (${t.specialDayDateId} is null) and (${t.seasonId} is null) = (${t.weekday} is null)`,
    ),
    check("opening_hours_weekday_ck", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    check("opening_hours_kind_ck", enumCheck(t.kind)),
    check(
      "opening_hours_kind_by_owner_ck",
      sql`(${t.departmentId} is not null and ((${t.kind} = 'period' and ${t.periodId} is not null) or (${t.kind} = 'closed' and ${t.periodId} is null and ${t.specialDayDateId} is not null))) or (${t.zoneId} is not null and ${t.periodId} is null and (${t.kind} = 'closed' or (${t.kind} = 'open' and ${t.specialDayDateId} is not null)))`,
    ),
    index("opening_hours_department_day_idx")
      .on(t.departmentId, t.seasonId, t.weekday, t.startsAt)
      .where(sql`${t.departmentId} is not null`),
    index("opening_hours_zone_day_idx")
      .on(t.zoneId, t.seasonId, t.weekday, t.startsAt)
      .where(sql`${t.zoneId} is not null`),
    index("opening_hours_special_day_date_idx").on(t.specialDayDateId),
    index("opening_hours_season_idx").on(t.seasonId),
  ],
);

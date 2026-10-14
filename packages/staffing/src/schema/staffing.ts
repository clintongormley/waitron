import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  kitchenStations,
  label,
  locations,
  newId,
  table,
  timeOfDay,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { departments, seasons, specialDayDates } from "@waitron/venue-service";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import { shifts } from "@waitron/workforce";

const calendarColour = enumType(CALENDAR_COLOURS);
const STEP = (column: unknown) => sql`substr(${column}, 4, 2) in ('00', '15', '30', '45')`;

export const staffRoles = table(
  "staff_roles",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    colour: calendarColour("colour").notNull().default("grey"),
    position: count("position").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "staff_roles_location_fk",
    }),
    uniqueIndex("staff_roles_location_name_key").on(t.locationId, t.name),
    check("staff_roles_name_ck", sql`trim(${t.name}) <> ''`),
    check("staff_roles_colour_ck", enumCheck(t.colour)),
  ],
);

export const personStaffRoles = table(
  "person_staff_roles",
  { personId: id("person_id").notNull(), staffRoleId: id("staff_role_id").notNull() },
  (t) => [
    primaryKey({ columns: [t.personId, t.staffRoleId], name: "person_staff_roles_pk" }),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "person_staff_roles_person_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.staffRoleId],
      foreignColumns: [staffRoles.id],
      name: "person_staff_roles_role_fk",
    }).onDelete("cascade"),
  ],
);

// Generated in a second migration: scripts/migration-upgrade.test.ts applies every set's first migration together, before venue-service creates seasons and special_day_dates.
/** One area's painted day: a department OR a prep station, on a season's weekday OR a special day's date. */
export const staffingDays = table(
  "staffing_days",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    seasonId: id("season_id"),
    weekday: count("weekday"), // 0 = Sunday, as weekdayOf
    specialDayDateId: id("special_day_date_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "staffing_days_department_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "staffing_days_station_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.seasonId],
      foreignColumns: [seasons.id],
      name: "staffing_days_season_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.specialDayDateId],
      foreignColumns: [specialDayDates.id],
      name: "staffing_days_date_fk",
    }).onDelete("cascade"),
    check(
      "staffing_days_one_area_ck",
      sql`(${t.departmentId} is null) <> (${t.stationId} is null)`,
    ),
    check(
      "staffing_days_one_day_ck",
      sql`(${t.seasonId} is null) <> (${t.specialDayDateId} is null) and (${t.seasonId} is null) = (${t.weekday} is null)`,
    ),
    check("staffing_days_weekday_ck", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    // SQLite treats NULLs in a unique index as distinct, so each area kind × day kind has its own.
    uniqueIndex("staffing_days_department_season_key")
      .on(t.departmentId, t.seasonId, t.weekday)
      .where(sql`${t.departmentId} is not null and ${t.seasonId} is not null`),
    uniqueIndex("staffing_days_department_date_key")
      .on(t.departmentId, t.specialDayDateId)
      .where(sql`${t.departmentId} is not null and ${t.specialDayDateId} is not null`),
    uniqueIndex("staffing_days_station_season_key")
      .on(t.stationId, t.seasonId, t.weekday)
      .where(sql`${t.stationId} is not null and ${t.seasonId} is not null`),
    uniqueIndex("staffing_days_station_date_key")
      .on(t.stationId, t.specialDayDateId)
      .where(sql`${t.stationId} is not null and ${t.specialDayDateId} is not null`),
  ],
);

export const staffingBlocks = table(
  "staffing_blocks",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    dayId: id("day_id").notNull(),
    staffRoleId: id("staff_role_id").notNull(),
    headcount: count("headcount").notNull(),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.dayId],
      foreignColumns: [staffingDays.id],
      name: "staffing_blocks_day_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.staffRoleId],
      foreignColumns: [staffRoles.id],
      name: "staffing_blocks_role_fk",
    }).onDelete("cascade"),
    check("staffing_blocks_headcount_ck", sql`${t.headcount} between 1 and 50`),
    check("staffing_blocks_step_ck", sql`${STEP(t.startsAt)} and ${STEP(t.endsAt)}`),
    index("staffing_blocks_day_idx").on(t.dayId, t.startsAt),
  ],
);

/** Which area and staff role a shift fills. No row: the shift is "not in a slot". */
export const shiftAssignments = table(
  "shift_assignments",
  {
    shiftId: id("shift_id").primaryKey(),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    staffRoleId: id("staff_role_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shiftId],
      foreignColumns: [shifts.id],
      name: "shift_assignments_shift_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "shift_assignments_department_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "shift_assignments_station_fk",
    }).onDelete("cascade"),
    // restrict: a staff role a shift uses cannot be deleted (staff_role.in_use is checked first).
    foreignKey({
      columns: [t.staffRoleId],
      foreignColumns: [staffRoles.id],
      name: "shift_assignments_role_fk",
    }).onDelete("restrict"),
    check(
      "shift_assignments_one_area_ck",
      sql`(${t.departmentId} is null) <> (${t.stationId} is null)`,
    ),
  ],
);

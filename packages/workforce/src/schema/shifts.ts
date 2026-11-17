import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  count,
  departments,
  id,
  kitchenStations,
  newId,
  nowIso,
  staffRoles,
  table,
  tsString,
} from "@waitron/db";
import { persons } from "@waitron/identity";
import { rosterVersions } from "./roster-versions.js";

/**
 * A planned shift — what a person is intended to work; planning data, so ordinary mutable rows. It is
 * joined to what was actually worked by person and local date (`comparePlannedVsActual`), not by a
 * foreign key: a worked session may have no planned shift, and a planned shift may be a no-show.
 */
export const shifts = table(
  "shifts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    startsAt: tsString("starts_at").notNull(),
    startsOffsetMinutes: count("starts_offset_minutes").notNull(),
    endsAt: tsString("ends_at").notNull(),
    endsOffsetMinutes: count("ends_offset_minutes").notNull(),
    rosterVersionId: id("roster_version_id").notNull(),
    staffRoleId: id("staff_role_id"),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "shifts_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.rosterVersionId],
      foreignColumns: [rosterVersions.id],
      name: "shifts_roster_version_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.staffRoleId],
      foreignColumns: [staffRoles.id],
      name: "shifts_role_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "shifts_department_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "shifts_station_fk",
    }).onDelete("restrict"),
    check(
      "shifts_one_area_ck",
      sql`(${t.staffRoleId} is null and ${t.departmentId} is null and ${t.stationId} is null) or
        (${t.staffRoleId} is not null and (${t.departmentId} is null) <> (${t.stationId} is null))`,
    ),
    index("shifts_person_starts_idx").on(t.personId, t.startsAt),
    index("shifts_roster_version_idx").on(t.rosterVersionId),
    // ±14h, the wall-offset domain `sales` and `time_entries` use.
    check("shifts_starts_offset_ck", sql`${t.startsOffsetMinutes} between -840 and 840`),
    check("shifts_ends_offset_ck", sql`${t.endsOffsetMinutes} between -840 and 840`),
    // Compares text, so it is right only for the one spelling `shiftInterval` (../clocking.ts) writes.
    check("shifts_interval_ck", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

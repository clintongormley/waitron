import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  day,
  enumCheck,
  enumType,
  id,
  locations,
  newId,
  nowIso,
  table,
  tsString,
} from "@waitron/db";
import { persons } from "@waitron/identity";

/**
 * `superseded` is written when a newer version is published for the same (location, exact period);
 * it keeps its `published_at` stamp, because it was published.
 */
export const rosterVersionStatus = enumType(["draft", "published", "superseded"]);

/**
 * A snapshot of a location's schedule for a date period — planning data, so ordinary mutable rows. The
 * tamper-evidence obligation (art. 34.9) is on the record of hours worked, which is `time_entries`.
 */
export const rosterVersions = table(
  "roster_versions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    /** Inclusive, as is `period_end`. */
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    publishedAt: tsString("published_at"),
    /** Null when the caller does not supply it; unlike `published_at`, no check ties it to `status`. */
    publishedByPersonId: id("published_by_person_id"),
    status: rosterVersionStatus("status").notNull().default("draft"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "roster_versions_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.publishedByPersonId],
      foreignColumns: [persons.id],
      name: "roster_versions_published_by_person_fk",
    }).onDelete("restrict"),
    index("roster_versions_location_idx").on(t.locationId),
    // The whole guarantee of at most one published version per (location, exact period);
    // `publishRoster` translates its refusal to `roster.period_already_published`.
    uniqueIndex("roster_versions_published_period_uq")
      .on(t.locationId, t.periodStart, t.periodEnd)
      .where(sql`${t.status} = 'published'`),
    check("roster_versions_period_ck", sql`${t.periodEnd} >= ${t.periodStart}`),
    check(
      "roster_versions_publish_shape_ck",
      sql`(${t.status} = 'draft') = (${t.publishedAt} is null)`,
    ),
    check("roster_versions_status_ck", enumCheck(t.status)),
  ],
);

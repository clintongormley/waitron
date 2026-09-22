import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, id, label, locations, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";
import { rosterVersions } from "./roster-versions.js";

/**
 * A planned shift — what a person is INTENDED to work, at a location, over an interval. PLANNING
 * data, the inverse of `time_entries` (what ACTUALLY happened): ordinary mutable rows, so the app
 * role holds SELECT, INSERT, UPDATE and DELETE (drizzle/0001_workforce_baseline_sql.sql) — a shift is moved,
 * re-roled, or discarded freely, with no append-only trigger and no hash chain. The planned↔actual
 * link is a READ MODEL by person + local date (design 2026-07-22 §4 "the planned-vs-actual seam",
 * plan §2.1), not an FK: a
 * worked session may have no planned shift and a planned shift may be a no-show.
 *
 * `starts_at`/`ends_at` are the absolute instants; `starts_offset_minutes`/`ends_offset_minutes` are
 * the wall offsets that ride alongside — the same `time_entries.event_at`/`event_offset_minutes`
 * pattern, so the LOCAL wall date is recovered by `shiftLocalDate` (../shift-local-date.ts), which
 * is what `publishRoster` matches against a roster version's period.
 *
 * `roster_version_id` is null while the shift is an unpublished draft and is set on publish
 * (`publishRoster` attaches every in-period draft shift at the version's location). Deleting the
 * version SET NULLs it — the shift survives as a draft again, because planning data is discardable.
 */
export const shifts = table(
  "shifts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** The workplace the shift is scheduled at. */
    locationId: id("location_id").notNull(),
    startsAt: tsString("starts_at").notNull(),
    startsOffsetMinutes: count("starts_offset_minutes").notNull(),
    endsAt: tsString("ends_at").notNull(),
    endsOffsetMinutes: count("ends_offset_minutes").notNull(),
    /** The role the person is rostered in (bar, kitchen, …), free text at the floor. Null when
     * unspecified. Full role taxonomy is the identity sub-project's (#5), not the schedule's. */
    role: label("role"),
    /** The published roster version this shift belongs to; null while an unpublished draft. */
    rosterVersionId: id("roster_version_id"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason
    // employments.ts documents. restrict for the referents a shift must never orphan (person,
    // location); SET NULL for the roster version, so discarding a version detaches its
    // shifts rather than blocking the delete or cascading them away — planning data is discardable.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "shifts_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "shifts_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.rosterVersionId],
      foreignColumns: [rosterVersions.id],
      name: "shifts_roster_version_fk",
    }).onDelete("set null"),
    index("shifts_person_starts_idx").on(t.personId, t.startsAt),
    index("shifts_roster_version_idx").on(t.rosterVersionId),
    // Same wall-offset domain sales/time_entries use (±14h) — a stored offset outside it is a bug.
    check("shifts_starts_offset_ck", sql`${t.startsOffsetMinutes} between -840 and 840`),
    check("shifts_ends_offset_ck", sql`${t.endsOffsetMinutes} between -840 and 840`),
    // A shift ends after it starts — a zero- or negative-length planned interval is malformed.
    // WEAKER THAN IT READS on this engine: both columns are TEXT, so this compares SPELLINGS, and
    // a pair whose two endpoints are spelled differently is judged wrongly in BOTH directions. The
    // measurement and the fix are recorded once, on `assertShiftInterval` in ../clocking.ts.
    check("shifts_interval_ck", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

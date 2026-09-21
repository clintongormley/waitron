import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import {
  count,
  id,
  label,
  locations,
  newId,
  nowIso,
  smallCount,
  table,
  tsString,
} from "@waitron/db";

/**
 * A reusable shift SHAPE at a location — "Monday bar, 18:00–02:00" — from which concrete `shifts` are
 * generated. PLANNING data, ordinary mutable rows: the app role holds SELECT, INSERT, UPDATE and
 * DELETE (drizzle/0001_workforce_baseline_sql.sql), no append-only trigger and no chain (design
 * 2026-07-22 §2.1 / plan §2.1). A template names no person — it is a slot on a weekday, not a rostered
 * shift.
 *
 * `weekday` is 0–6; `starts_minute`/`ends_minute` are minutes past local midnight in [0, 1440]. Unlike
 * `shifts`, a template carries NO interval CHECK: a template may legitimately wrap past midnight
 * (`starts_minute > ends_minute`, an overnight bar shift), whose interpretation is the generator's,
 * not the row's.
 */
export const shiftTemplates = table(
  "shift_templates",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    /** The workplace the template's shifts are scheduled at. */
    locationId: id("location_id").notNull(),
    /** A human label for the slot (e.g. "Evening bar"). */
    label: label("label").notNull(),
    /** Day of week, 0–6. */
    weekday: smallCount("weekday").notNull(),
    /** Start of the slot, minutes past local midnight, [0, 1440]. */
    startsMinute: count("starts_minute").notNull(),
    /** End of the slot, minutes past local midnight, [0, 1440]. */
    endsMinute: count("ends_minute").notNull(),
    /** The role the slot is for (bar, kitchen, …), free text; null when unspecified. */
    role: label("role"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason the
    // sibling schema files document. restrict: a template must not be orphaned by a location
    // delete.
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "shift_templates_location_fk",
    }).onDelete("restrict"),
    index("shift_templates_location_idx").on(t.locationId),
    check("shift_templates_label_ck", sql`length(${t.label}) > 0`),
    check("shift_templates_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("shift_templates_starts_minute_ck", sql`${t.startsMinute} between 0 and 1440`),
    check("shift_templates_ends_minute_ck", sql`${t.endsMinute} between 0 and 1440`),
  ],
);

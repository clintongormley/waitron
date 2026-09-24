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
 * A reusable shift slot at a location — "Monday bar, 18:00–02:00" — naming no person. Minutes are past
 * local midnight. No interval check, unlike `shifts`: a template may wrap past midnight
 * (`starts_minute > ends_minute`).
 */
export const shiftTemplates = table(
  "shift_templates",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    label: label("label").notNull(),
    weekday: smallCount("weekday").notNull(),
    startsMinute: count("starts_minute").notNull(),
    endsMinute: count("ends_minute").notNull(),
    role: label("role"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
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

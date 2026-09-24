import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, day, id, newId, nowIso, smallCount, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";

/**
 * A person's stated availability window on a weekday — "available Mondays 09:00–17:00 from 1 March".
 * Which day `weekday` 0 is, is a rendering choice not fixed here. Minutes are past local midnight.
 */
export const availability = table(
  "availability",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    weekday: smallCount("weekday").notNull(),
    availableFromMinute: count("available_from_minute").notNull(),
    availableToMinute: count("available_to_minute").notNull(),
    effectiveFrom: day("effective_from").notNull(),
    /** Inclusive; null while open-ended. */
    effectiveTo: day("effective_to"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "availability_person_fk",
    }).onDelete("restrict"),
    index("availability_person_idx").on(t.personId),
    check("availability_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("availability_from_minute_ck", sql`${t.availableFromMinute} between 0 and 1440`),
    check("availability_to_minute_ck", sql`${t.availableToMinute} between 0 and 1440`),
    check("availability_window_ck", sql`${t.availableToMinute} > ${t.availableFromMinute}`),
    check(
      "availability_effective_ck",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

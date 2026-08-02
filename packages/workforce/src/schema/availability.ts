import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A person's STATED availability window on a given weekday — "available Mondays 09:00–17:00 from 1
 * March". PLANNING data, ordinary mutable rows: the app role holds SELECT, INSERT, UPDATE and DELETE
 * (drizzle/0010_scheduling_planning_rls.sql), no append-only trigger and no chain — a person's stated
 * availability changes freely (design 2026-07-22 §2.1 / plan §2.1).
 *
 * `weekday` is 0–6 (Monday..Sunday is a rendering choice, not fixed here — only the 0–6 domain is).
 * `available_from_minute`/`available_to_minute` are minutes past local midnight in [0, 1440], from <
 * to. `effective_from`/`effective_to` bound the date range the window applies over; `effective_to`
 * null means open-ended.
 */
export const availability = pgTable(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    /** Day of week, 0–6. */
    weekday: smallint("weekday").notNull(),
    /** Start of the window, minutes past local midnight, [0, 1440]. */
    availableFromMinute: integer("available_from_minute").notNull(),
    /** End of the window, minutes past local midnight, [0, 1440], strictly after the start. */
    availableToMinute: integer("available_to_minute").notNull(),
    /** First day the window applies, inclusive. */
    effectiveFrom: date("effective_from").notNull(),
    /** Last day the window applies, inclusive; null while open-ended. */
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason the
    // sibling schema files document. restrict: an availability window must not be orphaned by a
    // tenant/person delete.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "availability_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "availability_person_fk",
    }).onDelete("restrict"),
    index("availability_tenant_id_idx").on(t.tenantId),
    index("availability_tenant_person_idx").on(t.tenantId, t.personId),
    check("availability_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("availability_from_minute_ck", sql`${t.availableFromMinute} between 0 and 1440`),
    check("availability_to_minute_ck", sql`${t.availableToMinute} between 0 and 1440`),
    // A window has positive length — a zero- or negative-length window is malformed.
    check("availability_window_ck", sql`${t.availableToMinute} > ${t.availableFromMinute}`),
    // effective_to, when set, is on or after effective_from.
    check(
      "availability_effective_ck",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
).enableRLS();

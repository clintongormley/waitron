import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "@waitron/db";

/**
 * A reusable shift SHAPE at a location — "Monday bar, 18:00–02:00" — from which concrete `shifts` are
 * generated. PLANNING data, ordinary mutable rows: the app role holds SELECT, INSERT, UPDATE and
 * DELETE (drizzle/0008_scheduling_planning_rls.sql), no append-only trigger and no chain (design
 * 2026-07-22 §2.1 / plan §2.1). A template names no person — it is a slot on a weekday, not a rostered
 * shift.
 *
 * `weekday` is 0–6; `starts_minute`/`ends_minute` are minutes past local midnight in [0, 1440]. Unlike
 * `shifts`, a template carries NO interval CHECK: a template may legitimately wrap past midnight
 * (`starts_minute > ends_minute`, an overnight bar shift), whose interpretation is the generator's,
 * not the row's.
 */
export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** The centro de trabajo the template's shifts are scheduled at. */
    locationId: uuid("location_id").notNull(),
    /** A human label for the slot (e.g. "Evening bar"). */
    label: text("label").notNull(),
    /** Day of week, 0–6. */
    weekday: smallint("weekday").notNull(),
    /** Start of the slot, minutes past local midnight, [0, 1440]. */
    startsMinute: integer("starts_minute").notNull(),
    /** End of the slot, minutes past local midnight, [0, 1440]. */
    endsMinute: integer("ends_minute").notNull(),
    /** The role the slot is for (bar, kitchen, …), free text; null when unspecified. */
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason the
    // sibling schema files document. restrict: a template must not be orphaned by a tenant/location
    // delete.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "shift_templates_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "shift_templates_location_fk",
    }).onDelete("restrict"),
    index("shift_templates_tenant_id_idx").on(t.tenantId),
    index("shift_templates_tenant_location_idx").on(t.tenantId, t.locationId),
    check("shift_templates_label_ck", sql`length(${t.label}) > 0`),
    check("shift_templates_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check("shift_templates_starts_minute_ck", sql`${t.startsMinute} between 0 and 1440`),
    check("shift_templates_ends_minute_ck", sql`${t.endsMinute} between 0 and 1440`),
  ],
).enableRLS();

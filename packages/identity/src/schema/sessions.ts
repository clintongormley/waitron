import { foreignKey, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants, tills } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A shift login: a person active at a physical till. Keyed to the TILL (the station where a cashier
 * stands and where cash-up is grouped), not the node (the SIF machine, one per venue, shared across
 * tills). MUTABLE: `ended_at` is stamped on logout, so app_user holds SELECT, INSERT, UPDATE (no
 * DELETE), tenant-isolation RLS only (no immutability triggers) — see drizzle/0003_sessions_rls.sql.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    tillId: uuid("till_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process), the same reason persons.ts uses this form. restrict, not cascade: removing a tenant,
    // person or till must never silently discard the shift-login history that references it.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "sessions_tenant_fk",
    }).onDelete("restrict"),
    // Plain single-column FK to persons.id, the same shape sales.till_id uses for tills: RLS gives
    // the tenant-consistency, and persons carries no (tenant_id, id) composite unique to target.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "sessions_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tillId],
      foreignColumns: [tills.id],
      name: "sessions_till_fk",
    }).onDelete("restrict"),
    index("sessions_tenant_id_idx").on(t.tenantId),
    // The "open session at a till" lookup filters on (tenant_id, till_id) then ended_at IS NULL; this
    // composite covers the equality predicate. Kept plain (not a partial `WHERE ended_at IS NULL`
    // index) so drizzle-kit round-trips it and db:generate stays a no-op; the open-rows filter is
    // applied at query time.
    index("sessions_open_idx").on(t.tenantId, t.tillId),
  ],
).enableRLS();

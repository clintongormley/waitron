import { foreignKey, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A browser "management session": a person signed into the management dashboard from a browser,
 * distinct from a till's PIN shift-login (`sessions`), which is keyed to a physical till. MUTABLE:
 * `last_seen_at` is refreshed on activity and `ended_at` is stamped on sign-out, so app_user will
 * hold SELECT, INSERT, UPDATE (no DELETE) — the FORCE-RLS policy and grants land in the next
 * migration (Task 6), the way sessions splits its table (0002) from its RLS (0003).
 */
export const managementSessions = pgTable(
  "management_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process), the same reason persons.ts and sessions.ts use this form. restrict, not cascade:
    // removing a tenant or person must never silently discard the management-session history.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "management_sessions_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "management_sessions_person_fk",
    }).onDelete("restrict"),
    index("management_sessions_tenant_id_idx").on(t.tenantId),
    // Forward-looking for slice 1b's "open management session for a person" lookup — filtering on
    // (tenant_id, person_id) then ended_at IS NULL — whose equality predicate this composite would
    // cover. No consumer does that lookup in this slice: `resolveManagementSession` and
    // `endManagementSession` key on the PK `id`. Mirrors sessions.ts's `sessions_open_idx` on
    // (tenant_id, till_id). Kept plain (not a partial `WHERE ended_at IS NULL` index) so drizzle-kit
    // round-trips it and db:generate stays a no-op.
    index("management_sessions_open_idx").on(t.tenantId, t.personId),
  ],
).enableRLS();

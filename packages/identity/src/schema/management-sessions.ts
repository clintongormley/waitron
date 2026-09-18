import { foreignKey, index } from "drizzle-orm/pg-core";
import { id, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A browser "management session": a person signed into the management dashboard from a browser,
 * distinct from a till's PIN shift-login (`sessions`), which is keyed to a physical till. MUTABLE:
 * `last_seen_at` is refreshed on activity and `ended_at` is stamped on sign-out, so app_user
 * holds SELECT, INSERT, UPDATE (no DELETE).
 */
export const managementSessions = table(
  "management_sessions",
  {
    id: id("id").primaryKey().defaultRandom(),
    personId: id("person_id").notNull(),
    createdAt: tsString("created_at").notNull().defaultNow(),
    lastSeenAt: tsString("last_seen_at").notNull().defaultNow(),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process), the same reason persons.ts and sessions.ts use this form. restrict, not cascade:
    // removing a person must never silently discard the management-session history.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "management_sessions_person_fk",
    }).onDelete("restrict"),
    // Forward-looking for slice 1b's "open management session for a person" lookup — filtering on
    // person_id then ended_at IS NULL — whose equality predicate this index would cover. No consumer
    // does that lookup in this slice: `resolveManagementSession` and `endManagementSession` key on
    // the PK `id`. Mirrors sessions.ts's `sessions_open_idx` on (till_id). Kept plain (not a partial
    // `WHERE ended_at IS NULL` index) so drizzle-kit round-trips it and db:generate stays a no-op.
    index("management_sessions_open_idx").on(t.personId),
  ],
);

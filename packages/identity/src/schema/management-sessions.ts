import { index } from "drizzle-orm/pg-core";
import { id, table, tsString } from "@waitron/db";

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
    // `person_id` names a row in the VENUE's `persons` and carries NO foreign key: this table is
    // classified `local` and persons is `state`, so the storage switch puts them in different files
    // and a key across the two would stop either being restored on its own (topology design §2.1).
    // Guard: `scripts/two-file-foreign-keys.test.ts`. The caller has already authenticated the
    // person it passes (`management-session.ts`, `startManagementSession`).
    // Forward-looking for slice 1b's "open management session for a person" lookup — filtering on
    // person_id then ended_at IS NULL — whose equality predicate this index would cover. No consumer
    // does that lookup in this slice: `resolveManagementSession` and `endManagementSession` key on
    // the PK `id`. Mirrors sessions.ts's `sessions_open_idx` on (till_id). Kept plain (not a partial
    // `WHERE ended_at IS NULL` index) so drizzle-kit round-trips it and db:generate stays a no-op.
    index("management_sessions_open_idx").on(t.personId),
  ],
);

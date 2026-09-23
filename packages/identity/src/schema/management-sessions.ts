import { index } from "drizzle-orm/sqlite-core";
import { id, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A browser "management session": a person signed into the management dashboard from a browser,
 * distinct from a till's PIN shift-login (`sessions`), which is keyed to a physical till. MUTABLE,
 * with no append-only trigger: `last_seen_at` is refreshed on activity and `ended_at` is stamped on
 * sign-out. A session is ENDED by stamping `ended_at` rather than deleted, but that is now the
 * callers' rule alone — the grant that withheld DELETE went with PostgreSQL and nothing replaced it.
 */
export const managementSessions = table(
  "management_sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Names a row in the VENUE's `persons` and carries no foreign key: `local` -> `state` would
    // cross the two database files (guard: `scripts/two-file-foreign-keys.test.ts`). The caller has
    // already authenticated the person it passes to `startManagementSession`.
    personId: id("person_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    lastSeenAt: tsString("last_seen_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    // Forward-looking for slice 1b's "open management session for a person" lookup — filtering on
    // person_id then ended_at IS NULL — whose equality predicate this index would cover. No consumer
    // does that lookup in this slice: `resolveManagementSession` and `endManagementSession` key on
    // the PK `id`. Mirrors sessions.ts's `sessions_open_idx` on (till_id). Kept plain (not a partial
    // `WHERE ended_at IS NULL` index) so drizzle-kit round-trips it and db:generate stays a no-op.
    index("management_sessions_open_idx").on(t.personId),
  ],
);

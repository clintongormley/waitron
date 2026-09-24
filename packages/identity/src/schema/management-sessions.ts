import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A browser "management session": a person signed into the management dashboard from a browser,
 * distinct from a till's PIN shift-login (`sessions`), which is keyed to a physical till. MUTABLE,
 * with no append-only trigger: `last_seen_at` is refreshed on activity and `ended_at` is stamped on
 * sign-out. A session is ENDED by stamping `ended_at` rather than deleted, but that is now the
 * callers' rule alone — the grant that withheld DELETE went with PostgreSQL and nothing replaced it.
 * The dashboard cookie carries a random token; this row stores only its hash
 * (`../session-token.ts`).
 */
export const managementSessions = table(
  "management_sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    // No key to `persons`: none was restored when the table became `state` (docs/backlog.md,
    // slice-2 Task 1b). `resolveManagementSession`'s inner join refuses a session whose person is
    // gone.
    personId: id("person_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    lastSeenAt: tsString("last_seen_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    // Covers the equality predicate of the writes that end a person's open sessions — filtering on
    // person_id then ended_at IS NULL. `resolveManagementSession` and
    // `endManagementSession` key on `token_hash`. Mirrors sessions.ts's `sessions_open_idx` on
    // (till_id). Kept plain (not a partial `WHERE ended_at IS NULL` index) so drizzle-kit
    // round-trips it and db:generate stays a no-op.
    index("management_sessions_open_idx").on(t.personId),
    uniqueIndex("management_sessions_token_hash_uq").on(t.tokenHash),
    check("management_sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
  ],
);

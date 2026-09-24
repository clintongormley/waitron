import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A person signed into the management dashboard from a browser, distinct from a till's PIN
 * shift-login (`sessions`). A session is ENDED by stamping `ended_at` rather than deleted — the
 * callers' rule alone; nothing in the database refuses a DELETE. The row stores only the cookie
 * token's hash (`../session-token.ts`).
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
    // For the writes that end a person's open sessions. Kept plain (not a partial `WHERE ended_at IS
    // NULL` index) so drizzle-kit round-trips it and db:generate stays a no-op.
    index("management_sessions_open_idx").on(t.personId),
    uniqueIndex("management_sessions_token_hash_uq").on(t.tokenHash),
    check("management_sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
  ],
);

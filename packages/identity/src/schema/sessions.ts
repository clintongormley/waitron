import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A shift login: a person active at a physical till, keyed to the TILL. MUTABLE, with no
 * append-only trigger: `ended_at` is stamped on logout, and the callers end a session that way
 * rather than deleting it. The till's cookie carries a random token; this row stores only its hash
 * (`../session-token.ts`), so neither the row id nor the stored hash read from a copy of the
 * database signs anybody in. `id` is the row's identity, never the cookie — `authorize` takes it.
 */
export const sessions = table(
  "sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    // No key to `persons` or `tills`: none was restored when the table became `state`
    // (docs/backlog.md, slice-2 Task 1b). `loginWithPin` inserts only a person
    // `verifyPersonCredential` found. `authorize`'s inner join reads a session whose person is gone
    // as `session.not_open`, but `requireSession` (apps/server/src/till-session.ts) does not join
    // `persons`, so it returns such a session as open; any other refusal comes from the route's own
    // work, such as another table's key to `persons` on a write. Nothing on this table
    // checks the till: the till login route takes it from the signed-in device's row, whose
    // `till_id` key to `tills` refuses deleting a till a device names.
    personId: id("person_id").notNull(),
    tillId: id("till_id").notNull(),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    // The "open session at a till" lookup filters on till_id then ended_at IS NULL; this index
    // covers the equality predicate. Kept plain (not partial) so drizzle-kit round-trips it.
    index("sessions_open_idx").on(t.tillId),
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    check("sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
  ],
);

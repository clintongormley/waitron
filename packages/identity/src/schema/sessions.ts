import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A shift login at a till. Ended by stamping `ended_at`, not by deleting the row. The till's cookie
 * carries a random token and this row stores only its hash (`../session-token.ts`), so neither the
 * row id nor the stored hash, read from a copy of the database, signs anybody in.
 */
export const sessions = table(
  "sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    // No key to `persons` or `tills`: none was restored when the table became `state`
    // (docs/backlog.md, slice-2 Task 1b). `loginWithPin` inserts only a person
    // `verifyPersonCredential` found. `authorize`'s inner join reads a session whose person is
    // gone as `session.not_open`, but `requireSession` (apps/server/src/till-session.ts) does not
    // join `persons`, so it returns such a session as open. The till login route takes the till
    // from the signed-in device's row, whose `till_id` key to `tills` refuses deleting a till a
    // device names.
    personId: id("person_id").notNull(),
    tillId: id("till_id").notNull(),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    index("sessions_open_idx").on(t.tillId),
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    check("sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
  ],
);

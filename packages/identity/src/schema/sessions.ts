import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A shift login: a person active at a physical till, keyed to the TILL. MUTABLE, with no
 * append-only trigger: `ended_at` is stamped on logout, and the callers end a session that way
 * rather than deleting it. The till's cookie carries a random token; this row stores only its hash
 * (`../session-token.ts`), so a copy of the database signs nobody in. `id` is the row's identity,
 * never the cookie — `authorize` takes it.
 */
export const sessions = table(
  "sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    // No foreign keys. The person comes back from `verifyPersonCredential` and the till from the
    // authenticated device's own registration (`apps/server/src/till-api.ts`, `device.tillId`); a
    // session whose person row is gone resolves as no session (`authorize.ts`, the inner join).
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

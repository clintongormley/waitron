import { index } from "drizzle-orm/pg-core";
import { id, table, tsString } from "@waitron/db";

/**
 * A shift login: a person active at a physical till. Keyed to the TILL (the station where a cashier
 * stands and where cash-up is grouped), not the node (the SIF machine, one per venue, shared across
 * tills). MUTABLE: `ended_at` is stamped on logout, so app_user holds SELECT, INSERT, UPDATE (no
 * DELETE), with no immutability triggers.
 */
export const sessions = table(
  "sessions",
  {
    id: id("id").primaryKey().defaultRandom(),
    // Both name rows in the VENUE's tables and carry no foreign key: `local` -> `state` would cross
    // the two database files (guard: `scripts/two-file-foreign-keys.test.ts`). The person comes back
    // from `verifyPersonCredential` and the till from the authenticated device's registration.
    personId: id("person_id").notNull(),
    tillId: id("till_id").notNull(),
    openedAt: tsString("opened_at").notNull().defaultNow(),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    // The "open session at a till" lookup filters on till_id then ended_at IS NULL; this index
    // covers the equality predicate. Kept plain (not a partial `WHERE ended_at IS NULL` index) so
    // drizzle-kit round-trips it and db:generate stays a no-op; the open-rows filter is applied at
    // query time.
    index("sessions_open_idx").on(t.tillId),
  ],
);

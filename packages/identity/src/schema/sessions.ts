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
    personId: id("person_id").notNull(),
    tillId: id("till_id").notNull(),
    openedAt: tsString("opened_at").notNull().defaultNow(),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    // `person_id` and `till_id` name rows in the VENUE's tables and carry NO foreign key. This
    // table is classified `local`, so the storage switch keeps it in `node.db` while persons and
    // tills live in `venue.db`, and a key across the two files would stop either being restored on
    // its own (topology design §2.1). Guard: `scripts/two-file-foreign-keys.test.ts`. What now
    // establishes that both ids name real rows is the request path: the person comes back from
    // `verifyPersonCredential` (`login.ts`) and the till from the authenticated device's own
    // registration (`apps/server/src/till-api.ts`, `device.tillId`).

    // The "open session at a till" lookup filters on till_id then ended_at IS NULL; this index
    // covers the equality predicate. Kept plain (not a partial `WHERE ended_at IS NULL` index) so
    // drizzle-kit round-trips it and db:generate stays a no-op; the open-rows filter is applied at
    // query time.
    index("sessions_open_idx").on(t.tillId),
  ],
);

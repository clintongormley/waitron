import { foreignKey, index } from "drizzle-orm/pg-core";
import { id, table, tills, tsString } from "@waitron/db";
import { persons } from "./persons.js";

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
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process), the same reason persons.ts uses this form. restrict, not cascade: removing a person
    // or till must never silently discard the shift-login history that references it.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "sessions_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tillId],
      foreignColumns: [tills.id],
      name: "sessions_till_fk",
    }).onDelete("restrict"),
    // The "open session at a till" lookup filters on till_id then ended_at IS NULL; this index
    // covers the equality predicate. Kept plain (not a partial `WHERE ended_at IS NULL` index) so
    // drizzle-kit round-trips it and db:generate stays a no-op; the open-rows filter is applied at
    // query time.
    index("sessions_open_idx").on(t.tillId),
  ],
);

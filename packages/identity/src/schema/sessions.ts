import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { devices, id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A shift login on a device. Ended by stamping `ended_at`, not by deleting the row. The shift cookie
 * carries a random token and this row stores only its hash (`../session-token.ts`), so neither the
 * row id nor the stored hash, read from a copy of the database, signs anybody in.
 */
export const sessions = table(
  "sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    // No key to `persons`: none was restored when the table became `state` (docs/backlog.md, slice-2
    // Task 1b), and `loginWithPin` inserts only a person `verifyPersonCredential` found.
    personId: id("person_id").notNull(),
    deviceId: id("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    index("sessions_open_idx").on(t.deviceId),
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    check("sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
  ],
);

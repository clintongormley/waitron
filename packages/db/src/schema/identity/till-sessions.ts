import { persons } from "./persons.js";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "../columns.js";
import { devices } from "../devices.js";

/**
 * A shift login on a device. Ended by stamping `ended_at`, not by deleting the row. The shift
 * cookie carries a random token and this row stores only its hash
 * (`packages/identity/src/session-token.ts`), so neither the row id nor the stored hash, read from
 * a copy of the database, signs anybody in.
 */
export const tillSessions = table(
  "till_sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    personId: id("person_id").notNull(),
    deviceId: id("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "till_sessions_person_fk",
    }).onDelete("restrict"),
    index("till_sessions_opened_at_idx").on(t.openedAt),
    index("till_sessions_open_idx").on(t.deviceId),
    uniqueIndex("till_sessions_token_hash_uq").on(t.tokenHash),
    check("till_sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
  ],
);

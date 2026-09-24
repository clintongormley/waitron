import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";

export const totpEnrollments = table(
  "totp_enrollments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // No key to `persons`: none was restored when the table became `state` (docs/backlog.md,
    // slice-2 Task 1b). Only `profile.ts` inserts or reads a row, and only for the person
    // `ownPerson` found.
    personId: id("person_id").notNull(),
    encryptedSecret: label("encrypted_secret").notNull(),
    expiresAt: tsString("expires_at").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  /* v8 ignore start */
  (t) => [
    index("totp_enrollments_person_idx").on(t.personId),
    check("totp_enrollments_secret_ck", sql`length(${t.encryptedSecret}) > 0`),
  ],
  /* v8 ignore stop */
);

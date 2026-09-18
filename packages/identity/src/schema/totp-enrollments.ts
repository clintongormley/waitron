import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "@waitron/db";

export const totpEnrollments = table(
  "totp_enrollments",
  {
    id: id("id").primaryKey().defaultRandom(),
    // Names a row in the VENUE's `persons` and carries no foreign key: `local` -> `state` would
    // cross the two database files (guard: `scripts/two-file-foreign-keys.test.ts`). The id comes
    // from the person row `ownPerson` read in `profile.ts`.
    personId: id("person_id").notNull(),
    encryptedSecret: label("encrypted_secret").notNull(),
    expiresAt: tsString("expires_at").notNull(),
    createdAt: tsString("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("totp_enrollments_person_idx").on(t.personId),
    check("totp_enrollments_secret_ck", sql`length(${t.encryptedSecret}) > 0`),
  ],
);

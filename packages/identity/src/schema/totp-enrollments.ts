import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "@waitron/db";

export const totpEnrollments = table(
  "totp_enrollments",
  {
    id: id("id").primaryKey().defaultRandom(),
    personId: id("person_id").notNull(),
    encryptedSecret: label("encrypted_secret").notNull(),
    expiresAt: tsString("expires_at").notNull(),
    createdAt: tsString("created_at").notNull().defaultNow(),
  },
  (t) => [
    // `person_id` names a row in the VENUE's `persons` and carries NO foreign key: this table is
    // classified `local` and persons is `state`, so the storage switch puts them in different files
    // and a key across the two would stop either being restored on its own (topology design §2.1).
    // Guard: `scripts/two-file-foreign-keys.test.ts`. The id comes from a person row the enrolment
    // path has already read (`profile.ts`, `ownPerson`).
    index("totp_enrollments_person_idx").on(t.personId),
    check("totp_enrollments_secret_ck", sql`length(${t.encryptedSecret}) > 0`),
  ],
);

import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

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
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "totp_enrollments_person_fk",
    }).onDelete("restrict"),
    index("totp_enrollments_person_idx").on(t.personId),
    check("totp_enrollments_secret_ck", sql`length(${t.encryptedSecret}) > 0`),
  ],
);

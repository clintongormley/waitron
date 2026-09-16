import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons.js";

export const totpEnrollments = pgTable(
  "totp_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
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

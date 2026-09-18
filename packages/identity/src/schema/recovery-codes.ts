import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

export const recoveryCodes = table(
  "recovery_codes",
  {
    id: id("id").primaryKey().defaultRandom(),
    personId: id("person_id").notNull(),
    codeHash: label("code_hash").notNull(),
    createdAt: tsString("created_at").notNull().defaultNow(),
    usedAt: tsString("used_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "recovery_codes_person_fk",
    }).onDelete("restrict"),
    index("recovery_codes_person_idx").on(t.personId),
    check("recovery_codes_hash_ck", sql`length(${t.codeHash}) = 64`),
  ],
);

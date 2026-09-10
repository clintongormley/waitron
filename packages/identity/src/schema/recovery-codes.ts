import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    codeHash: text("code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "recovery_codes_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "recovery_codes_person_fk",
    }).onDelete("restrict"),
    index("recovery_codes_person_idx").on(t.tenantId, t.personId),
    check("recovery_codes_hash_ck", sql`length(${t.codeHash}) = 64`),
  ],
);

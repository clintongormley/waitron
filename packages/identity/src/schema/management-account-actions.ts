import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A short-lived, single-use proof delivered to a person's email address. This is mutable
 * account state: a newer action invalidates an older one and completion stamps `used_at`.
 * `token_hash` is SHA-256 of the random URL token; the bearer token itself is never stored.
 */
export const managementAccountActions = pgTable(
  "management_account_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    codeHash: text("code_hash"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true, mode: "string" }),
    codeAttempts: integer("code_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "management_account_actions_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "management_account_actions_person_fk",
    }).onDelete("restrict"),
    uniqueIndex("management_account_actions_token_hash_uq").on(t.tokenHash),
    index("management_account_actions_person_idx").on(t.tenantId, t.personId, t.purpose),
    check(
      "management_account_actions_purpose_ck",
      sql`${t.purpose} in ('invitation', 'password_reset')`,
    ),
    check("management_account_actions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
    check(
      "management_account_actions_code_hash_ck",
      sql`${t.codeHash} is null or length(${t.codeHash}) = 64`,
    ),
    check("management_account_actions_code_attempts_ck", sql`${t.codeAttempts} >= 0`),
    check("management_account_actions_expiry_ck", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, label, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A short-lived, single-use proof delivered to a person's email address. `token_hash` is SHA-256 of
 * the random URL token; the bearer token itself is never stored.
 */
export const managementAccountActions = table(
  "management_account_actions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    purpose: label("purpose").notNull(),
    /** The replacement login address for an email-change proof. Null for invitations and resets. */
    targetEmail: label("target_email"),
    tokenHash: label("token_hash").notNull(),
    codeHash: label("code_hash"),
    codeExpiresAt: tsString("code_expires_at"),
    codeAttempts: count("code_attempts").notNull().default(0),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    expiresAt: tsString("expires_at").notNull(),
    usedAt: tsString("used_at"),
  },
  /* v8 ignore start */
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "management_account_actions_person_fk",
    }).onDelete("restrict"),
    uniqueIndex("management_account_actions_token_hash_uq").on(t.tokenHash),
    index("management_account_actions_person_idx").on(t.personId, t.purpose),
    check(
      "management_account_actions_purpose_ck",
      sql`${t.purpose} in ('invitation', 'password_reset', 'email_change')`,
    ),
    check(
      "management_account_actions_target_email_ck",
      sql`(${t.purpose} = 'email_change') = (${t.targetEmail} is not null)`,
    ),
    check("management_account_actions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
    check(
      "management_account_actions_code_hash_ck",
      sql`${t.codeHash} is null or length(${t.codeHash}) = 64`,
    ),
    check("management_account_actions_code_attempts_ck", sql`${t.codeAttempts} >= 0`),
    check("management_account_actions_expiry_ck", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
  /* v8 ignore stop */
);

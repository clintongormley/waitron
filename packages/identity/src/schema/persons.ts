import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * A person's role. A single `role` column is this slice's permission-assignment mechanism (design
 * decision 3): call sites gate on a permission, and packages/identity/src/permissions.ts maps each
 * role to its permission set. A pgEnum, not a text CHECK: the four values are settled, and one
 * declaration yields both the TypeScript union and the database constraint.
 */
export const personRole = pgEnum("person_role", ["staff", "supervisor", "manager", "admin"]);

/** A person's account status. `suspended` keeps the row (and any history that references it) while
 * refusing login — the reason a status enum exists rather than a hard delete. */
export const personStatus = pgEnum("person_status", ["pending", "active", "suspended"]);

/**
 * A member of staff who can log in, ring sales, and (by role) authorize privileged actions.
 * Deliberately MUTABLE, unlike the fiscal tables: a PIN is reset, a role changes, an account is
 * suspended — so the app role holds SELECT, INSERT, UPDATE (drizzle/0001_identity_baseline_sql.sql), never a
 * DELETE and never an append-only trigger.
 */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    displayName: text("display_name").notNull(),
    firstNames: text("first_names"),
    lastNames: text("last_names"),
    telephone: text("telephone"),
    /** Hashed by ./verify-pin.ts (scrypt, salted) — never plaintext. The check below refuses an
     * empty value; the hash format is the caller's responsibility. */
    pinHash: text("pin_hash"),
    passwordHash: text("password_hash"),
    /** AES-256-GCM ciphertext containing the recoverable TOTP secret. The server decrypts it with
     * the venue account key shared with mirrors so authenticator verification works after failover. */
    totpSecret: text("totp_secret"),
    /** The person's preferred UI language (a SUPPORTED_LOCALES code). Null = no
     * preference; the app falls back to the venue default. Validated at the
     * write boundary (setPersonLocale), not by a DB enum, so a new locale is a
     * catalogue + constant change with no migration. */
    locale: text("locale"),
    /** The person's login email — required at every human-account boundary and used for dashboard
     * sign-in, activation, and recovery. The column stays nullable for internal principals and
     * low-level fixtures. Unique per tenant, case-insensitively, through the custom migration's
     * functional partial index. */
    email: text("email"),
    /** A requested replacement address. It does not become a login identifier until the person
     * proves they control it. */
    pendingEmail: text("pending_email"),
    /** Records when the person completed a bearer link delivered to this address. Changing the
     * address clears the record. */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "string" }),
    /** Google's stable OpenID Connect subject identifier. Email is deliberately not used as the
     * provider identity because a Google account can change addresses. */
    googleSubject: text("google_subject"),
    role: personRole("role").notNull().default("staff"),
    status: personStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => tenants.id)`: the thunk form makes
    // v8 count a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate
    // CLI process). restrict, not cascade: deleting a tenant must not silently discard its people.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "persons_tenant_fk",
    }).onDelete("restrict"),
    index("persons_tenant_id_idx").on(t.tenantId),
    uniqueIndex("persons_tenant_google_subject_uq")
      .on(t.tenantId, t.googleSubject)
      .where(sql`${t.googleSubject} is not null`),
    uniqueIndex("persons_tenant_pending_email_uq")
      .on(t.tenantId, sql`lower(${t.pendingEmail})`)
      .where(sql`${t.pendingEmail} is not null`),
    check("persons_display_name_ck", sql`length(${t.displayName}) > 0`),
    check("persons_first_names_ck", sql`${t.firstNames} is null or length(${t.firstNames}) > 0`),
    check("persons_last_names_ck", sql`${t.lastNames} is null or length(${t.lastNames}) > 0`),
    check("persons_telephone_ck", sql`${t.telephone} is null or length(${t.telephone}) > 0`),
    check("persons_pin_hash_ck", sql`${t.pinHash} is null or length(${t.pinHash}) > 0`),
    check(
      "persons_password_hash_ck",
      sql`${t.passwordHash} is null or length(${t.passwordHash}) > 0`,
    ),
    check("persons_totp_secret_ck", sql`${t.totpSecret} is null or length(${t.totpSecret}) > 0`),
    check("persons_locale_ck", sql`${t.locale} is null or length(${t.locale}) > 0`),
    check(
      "persons_pending_email_ck",
      sql`${t.pendingEmail} is null or length(${t.pendingEmail}) > 0`,
    ),
  ],
);

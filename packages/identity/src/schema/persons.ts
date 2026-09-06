import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
export const personStatus = pgEnum("person_status", ["active", "suspended"]);

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
    /** Hashed by ./verify-pin.ts (scrypt, salted) — never plaintext. The check below refuses an
     * empty value; the hash format is the caller's responsibility. */
    pinHash: text("pin_hash").notNull(),
    passwordHash: text("password_hash"),
    /** Stored plaintext base32 — a TOTP secret must be RECOVERABLE to verify a rolling code, so it
     * cannot be hashed the way `pinHash`/`passwordHash` are. `app_user` holds SELECT on persons
     * (drizzle/0001_identity_baseline_sql.sql), so a table or app-role leak exposes every enrolled second
     * factor. Latent in this slice: nothing writes it yet (TOTP enrollment is a later slice; only
     * tests set it via raw SQL). DEFERRED — the enrollment slice MUST encrypt `totp_secret` at rest
     * via the credentials vault (AES-256-GCM, the house pattern also cited in ./secret-hash.ts),
     * decrypting on the box before `verifyTotp` — which keeps the "lives on the box /
     * offline-verifiable" property. */
    totpSecret: text("totp_secret"),
    /** The person's preferred UI language (a SUPPORTED_LOCALES code). Null = no
     * preference; the app falls back to the venue default. Validated at the
     * write boundary (setPersonLocale), not by a DB enum, so a new locale is a
     * catalogue + constant change with no migration. */
    locale: text("locale"),
    /** The person's login email — the identifier for dashboard (management) sign-in. Nullable:
     * till-only staff who authenticate with a PIN need none. Unique per tenant, case-insensitively,
     * enforced by the functional partial index persons_tenant_email_uq (custom migration), not a
     * column constraint. Validated/normalized at the write boundary (setEmail/createPerson), so no
     * DB format check here. */
    email: text("email"),
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
    check("persons_display_name_ck", sql`length(${t.displayName}) > 0`),
    check("persons_pin_hash_ck", sql`length(${t.pinHash}) > 0`),
    check(
      "persons_password_hash_ck",
      sql`${t.passwordHash} is null or length(${t.passwordHash}) > 0`,
    ),
    check("persons_totp_secret_ck", sql`${t.totpSecret} is null or length(${t.totpSecret}) > 0`),
    check("persons_locale_ck", sql`${t.locale} is null or length(${t.locale}) > 0`),
  ],
);

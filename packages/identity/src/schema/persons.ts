import { sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, newId, nowIso, table, tsString } from "@waitron/db";

/** Call sites gate on a permission; `../permissions.ts` maps each role to its permission set. */
export const personRole = enumType(["staff", "supervisor", "manager", "admin"]);

/** `suspended` keeps the row, and any history that references it, while refusing login. */
export const personStatus = enumType(["pending", "active", "suspended"]);

/**
 * The value a uniqueness index and the query that pre-checks it both read. Shared by the index
 * declarations and the exported keys below because the two MUST agree: if they differ, a pre-check
 * reports a name free and the write behind it is refused, or the other way round.
 *
 * `case when … end`, not `coalesce(…)`: drizzle-kit splits an index expression on its commas and
 * treats each piece as a column name, which generates SQL SQLite will not accept.
 */
function foldedKey(folded: AnySQLiteColumn, raw: AnySQLiteColumn | SQL): SQL {
  return sql`case when ${folded} is null then lower(${raw}) else ${folded} end`;
}

/**
 * Mutable, with no append-only trigger. What keeps a person with history from being deleted is the
 * `restrict` foreign keys pointing at the row; suspending rather than deleting is the callers' rule.
 */
export const persons = table(
  "persons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    displayName: label("display_name").notNull(),
    /** `foldForUniqueness(display_name)` (`../fold.ts`), set by every write path in this package in
     * the statement that sets `display_name`. Nullable because code outside this package writes
     * `persons` rows straight through the table definition. */
    displayNameFolded: label("display_name_folded"),
    firstNames: label("first_names"),
    lastNames: label("last_names"),
    telephone: label("telephone"),
    /** Hashed by ./verify-pin.ts (scrypt, salted) — never plaintext. */
    pinHash: label("pin_hash"),
    passwordHash: label("password_hash"),
    /** AES-256-GCM ciphertext of the TOTP secret (`../mfa.ts`). */
    totpSecret: label("totp_secret"),
    /** A SUPPORTED_LOCALES code, or null for no preference (the venue default applies). Validated
     * by the writers, not by a DB enum, so a new locale needs no migration; the only constraint
     * here is non-empty. */
    locale: label("locale"),
    /** Null = never offered a passkey at sign-in (`../passkey-offer.ts`). */
    passkeyOfferedAt: tsString("passkey_offered_at"),
    /** Required at every human-account boundary; nullable for internal principals and low-level
     * fixtures. */
    email: label("email"),
    /** As `displayNameFolded`, for `email`. */
    emailFolded: label("email_folded"),
    /** A requested replacement address; not a login identifier until the person proves they
     * control it. */
    pendingEmail: label("pending_email"),
    /** As `displayNameFolded`, for `pending_email`. */
    pendingEmailFolded: label("pending_email_folded"),
    /** When the person completed a bearer link delivered to this address. Changing the address
     * clears it. */
    emailVerifiedAt: tsString("email_verified_at"),
    /** Google's OpenID Connect subject. Not the email: a Google account can change addresses. */
    googleSubject: label("google_subject"),
    role: personRole("role").notNull().default("staff"),
    status: personStatus("status").notNull().default("active"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // A row without a folded value (written by code outside this package) falls back to `lower()`,
    // which on this engine folds ASCII only: the fallback keeps such a row in the index rather than
    // closing the accented-letter gap for it. The migration that added the folded columns leaves
    // existing rows NULL: with a backfill, its `CREATE UNIQUE INDEX` fails on a database already
    // holding a pair the old index allowed (`José García` beside `JOSÉ GARCÍA`).
    uniqueIndex("persons_tenant_email_uq")
      .on(foldedKey(t.emailFolded, t.email))
      .where(sql`${t.email} is not null`),
    // A suspended person keeps their row and name outside this index, so the name is free for
    // someone else.
    uniqueIndex("persons_tenant_live_display_name_uq")
      .on(foldedKey(t.displayNameFolded, sql`trim(${t.displayName})`))
      .where(sql`${t.status} <> 'suspended'`),
    uniqueIndex("persons_tenant_google_subject_uq")
      .on(t.googleSubject)
      .where(sql`${t.googleSubject} is not null`),
    uniqueIndex("persons_tenant_pending_email_uq")
      .on(foldedKey(t.pendingEmailFolded, t.pendingEmail))
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
    check("persons_role_ck", enumCheck(t.role)),
    check("persons_status_ck", enumCheck(t.status)),
  ],
);

/** What `persons_tenant_live_display_name_uq` is over — for the query that pre-checks it. */
export const liveDisplayNameKey = (): SQL =>
  foldedKey(persons.displayNameFolded, sql`trim(${persons.displayName})`);

/** What `persons_tenant_email_uq` is over — for the queries that pre-check it and for login. */
export const loginEmailKey = (): SQL => foldedKey(persons.emailFolded, persons.email);

/** What `persons_tenant_pending_email_uq` is over — for the query that pre-checks it. */
export const pendingEmailKey = (): SQL =>
  foldedKey(persons.pendingEmailFolded, persons.pendingEmail);

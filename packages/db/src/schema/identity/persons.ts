import { sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, newId, nowIso, table, tsString } from "../columns.js";

/** `suspended` keeps the row, and any history that references it, while refusing login. */
export const personStatus = enumType(["pending", "active", "suspended"]);

/**
 * Mutable, with no append-only trigger. What keeps a person with history from being deleted is the
 * `restrict` foreign keys pointing at the row; suspending rather than deleting is the callers' rule.
 */
export const persons = table(
  "persons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    displayName: label("display_name").notNull(),
    displayNameFolded: label("display_name_folded").notNull(),
    firstNames: label("first_names"),
    lastNames: label("last_names"),
    telephone: label("telephone"),
    /** Hashed by `packages/identity/src/verify-pin.ts` (scrypt, salted) — never plaintext. */
    pinHash: label("pin_hash"),
    passwordHash: label("password_hash"),
    /** AES-256-GCM ciphertext of the TOTP secret (`packages/identity/src/mfa.ts`). */
    totpSecret: label("totp_secret"),
    /** A SUPPORTED_LOCALES code, or null for no preference (the venue default applies). Validated
     * by the writers, not by a DB enum, so a new locale needs no migration; the only constraint
     * here is non-empty. */
    locale: label("locale"),
    /** Null = never offered a passkey at sign-in (`packages/identity/src/passkey-offer.ts`). */
    passkeyOfferedAt: tsString("passkey_offered_at"),
    /** Required at every human-account boundary; nullable for internal principals and low-level
     * fixtures. */
    email: label("email"),
    emailFolded: label("email_folded"),
    /** A requested replacement address; not a login identifier until the person proves they
     * control it. */
    pendingEmail: label("pending_email"),
    pendingEmailFolded: label("pending_email_folded"),
    /** When the person completed a bearer link delivered to this address. Changing the address
     * clears it. */
    emailVerifiedAt: tsString("email_verified_at"),
    /** Google's OpenID Connect subject. Not the email: a Google account can change addresses. */
    googleSubject: label("google_subject"),
    status: personStatus("status").notNull().default("active"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("persons_email_uq")
      .on(t.emailFolded)
      .where(sql`${t.emailFolded} is not null`),
    // A suspended person keeps their row and name outside this index, so the name is free for
    // someone else.
    uniqueIndex("persons_live_display_name_uq")
      .on(t.displayNameFolded)
      .where(sql`${t.status} <> 'suspended'`),
    uniqueIndex("persons_google_subject_uq")
      .on(t.googleSubject)
      .where(sql`${t.googleSubject} is not null`),
    uniqueIndex("persons_pending_email_uq")
      .on(t.pendingEmailFolded)
      .where(sql`${t.pendingEmailFolded} is not null`),
    check("persons_email_folded_ck", sql`(${t.email} is null) = (${t.emailFolded} is null)`),
    check(
      "persons_pending_email_folded_ck",
      sql`(${t.pendingEmail} is null) = (${t.pendingEmailFolded} is null)`,
    ),
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
    check("persons_status_ck", enumCheck(t.status)),
  ],
);

/** What `persons_live_display_name_uq` is over — for the query that pre-checks it. */
export const liveDisplayNameKey = (): SQL => sql`${persons.displayNameFolded}`;

/** What `persons_email_uq` is over — for the queries that pre-check it and for login. */
export const loginEmailKey = (): SQL => sql`${persons.emailFolded}`;

/** What `persons_pending_email_uq` is over — for the query that pre-checks it. */
export const pendingEmailKey = (): SQL => sql`${persons.pendingEmailFolded}`;

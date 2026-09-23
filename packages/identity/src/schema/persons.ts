import { sql, type SQL } from "drizzle-orm";
import { check, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, newId, nowIso, table, tsString } from "@waitron/db";

/**
 * A person's role. A single `role` column is this slice's permission-assignment mechanism (design
 * decision 3): call sites gate on a permission, and packages/identity/src/permissions.ts maps each
 * role to its permission set. An enumType, not a hand-written text CHECK: the four values are
 * settled, and one declaration yields both the TypeScript union and the `persons_role_ck`
 * constraint below.
 */
export const personRole = enumType(["staff", "supervisor", "manager", "admin"]);

/** A person's account status. `suspended` keeps the row (and any history that references it) while
 * refusing login — the reason a status enum exists rather than a hard delete. */
export const personStatus = enumType(["pending", "active", "suspended"]);

/**
 * The value a uniqueness index and the query that pre-checks it both read: the folded column when
 * the row that wrote it supplied one, and `lower(raw)` when it did not.
 *
 * Written once, here, because the index and the pre-check MUST agree — the moment they differ, a
 * pre-check reports a name free and the write behind it is refused, or the other way round. The
 * three exported expressions below are what the query sites use, and the index declarations call
 * this same function, so neither can be changed without the other.
 *
 * **`case when … end` rather than the `coalesce(…)` that says the same thing**, because drizzle-kit
 * splits an index expression on its COMMAS and treats each piece as a column name. Run on
 * 2026-09-23 with `coalesce`, it generated ``ON `persons` (`coalesce("email_folded"`,`
 * lower("email"))`)`` — two backtick-quoted fragments — which SQLite will not accept. The `case`
 * form contains no comma and came out verbatim. Nothing guards it: rewriting one of these back to
 * `coalesce` is valid TypeScript, and the damage shows up only in generated SQL.
 */
function foldedKey(folded: AnySQLiteColumn, raw: AnySQLiteColumn | SQL): SQL {
  return sql`case when ${folded} is null then lower(${raw}) else ${folded} end`;
}

/**
 * A member of staff who can log in, ring sales, and (by role) authorize privileged actions.
 * Deliberately MUTABLE, unlike the fiscal tables: a PIN is reset, a role changes, an account is
 * suspended — and this table carries no append-only trigger. The grant that used to permit those
 * updates while withholding DELETE went with PostgreSQL; what holds a person in place once they have
 * history is the `restrict` foreign keys pointing at the row (`employments`, `time_entries`,
 * `webauthn_credentials` and the rest), and the suspend-rather-than-delete rule itself is the
 * callers'.
 */
export const persons = table(
  "persons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    displayName: label("display_name").notNull(),
    /** The same name, case-folded in JavaScript by `foldForUniqueness` (`../fold.ts`) — which is
     * what makes the live-display-name index below fold an accented letter at all. Every write
     * path in this package sets it in the statement that sets `display_name`. It is nullable
     * because code outside this package writes `persons` rows straight through the table
     * definition and cannot be asked for it; the index below says what such a row falls back to. */
    displayNameFolded: label("display_name_folded"),
    firstNames: label("first_names"),
    lastNames: label("last_names"),
    telephone: label("telephone"),
    /** Hashed by ./verify-pin.ts (scrypt, salted) — never plaintext. The check below refuses an
     * empty value; the hash format is the caller's responsibility. */
    pinHash: label("pin_hash"),
    passwordHash: label("password_hash"),
    /** AES-256-GCM ciphertext containing the recoverable TOTP secret. The server decrypts it with
     * the venue account key shared with mirrors so authenticator verification works after failover. */
    totpSecret: label("totp_secret"),
    /** The person's preferred UI language (a SUPPORTED_LOCALES code). Null = no
     * preference; the app falls back to the venue default. Validated at each
     * write boundary — setPersonLocale for a person changing their own, planVenue
     * for the admin a venue is provisioned with — not by a DB enum, so a new
     * locale is a catalogue + constant change with no migration. Nothing stops a
     * writer that skips both: the only constraint here is non-empty. */
    locale: label("locale"),
    /** When this person was offered a passkey at sign-in. Null = never offered, which is what
     * makes the offer appear exactly once: it is stamped when they resolve it, by adding one or by
     * skipping, so a browser that dies mid-offer asks again. Nullable and unstamped for everyone who
     * existed before the offer did, so each of them is offered once too. */
    passkeyOfferedAt: tsString("passkey_offered_at"),
    /** The person's login email — required at every human-account boundary and used for dashboard
     * sign-in, activation, and recovery. The column stays nullable for internal principals and
     * low-level fixtures. Unique case-insensitively among the rows that have one, through
     * `persons_tenant_email_uq` below. */
    email: label("email"),
    /** The same address, case-folded by `foldForUniqueness` (`../fold.ts`). Written by every path
     * in this package that writes `email`. Nullable for the reason `display_name_folded` is. */
    emailFolded: label("email_folded"),
    /** A requested replacement address. It does not become a login identifier until the person
     * proves they control it. */
    pendingEmail: label("pending_email"),
    /** The same requested address, case-folded by `foldForUniqueness` (`../fold.ts`). Written by
     * every path in this package that writes `pending_email`, including the ones that clear it. */
    pendingEmailFolded: label("pending_email_folded"),
    /** Records when the person completed a bearer link delivered to this address. Changing the
     * address clears the record. */
    emailVerifiedAt: tsString("email_verified_at"),
    /** Google's stable OpenID Connect subject identifier. Email is deliberately not used as the
     * provider identity because a Google account can change addresses. */
    googleSubject: label("google_subject"),
    role: personRole("role").notNull().default("staff"),
    status: personStatus("status").notNull().default("active"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // One login address across the venue, case-insensitively, among the people who have one. The
    // predicate holds every person without an email out of the index.
    //
    // **The fold each of the three indexes below reads is the COLUMN when there is one, and
    // `lower()` when there is not**, which is the whole of what the `case` expression does. A row
    // this package wrote carries `email_folded`, folded across the whole of Unicode by
    // `foldForUniqueness` (`../fold.ts`), and that is what the index is over. A row written
    // straight through the table definition by code elsewhere in the repository carries no folded
    // value, and falls back to `lower()` — which on this engine folds ASCII only, the behaviour
    // those rows had before the column existed. Measured 2026-09-23 on Node v26.7.0 against this
    // exact index shape, with both directions driven: with the folded value supplied, `JOSÉ GARCÍA`
    // is refused beside `José García`; without it, the same pair is accepted and only the ASCII
    // pair `ANA LOPEZ` / `Ana Lopez` is refused. So the fallback CLOSES NOTHING — it keeps the old
    // guarantee for writers this package cannot reach, instead of dropping them out of the index
    // altogether, which is what indexing the bare column would have done. The reason it is a
    // fallback and not a migration of every writer: `persons` is written from far outside this
    // package — `grep -rn "insert(persons)\|update(persons)" apps packages` is the sweep — so
    // making the column mandatory is a change this package cannot land on its own.
    // `docs/backlog.md` is where that follow-up belongs.
    //
    // **The migration that added these columns leaves them NULL, and does not fill them in for the
    // rows it finds.** Two reasons, the second measured. A migration is plain SQL and the fold is a
    // JavaScript function, so the only fold a `.sql` file can reach is `lower()` — the broken one.
    // And a backfill would make the migration REFUSABLE: driven on 2026-09-23, Node v26.7.0,
    // against a database already holding `José García` beside `JOSÉ GARCÍA` (a pair the old index
    // allowed, so a real database can hold it), a JavaScript backfill followed by these three
    // `CREATE UNIQUE INDEX` statements failed with
    // `UNIQUE constraint failed: index 'persons_tenant_email_uq'`. Without the backfill the same
    // migration applied cleanly to the same database. Nothing is lost by leaving them NULL: the
    // fallback gives those rows the key they already had, and the next write through this package
    // fills the column in.
    uniqueIndex("persons_tenant_email_uq")
      .on(foldedKey(t.emailFolded, t.email))
      .where(sql`${t.email} is not null`),
    // One live display name, case- and whitespace-insensitively, among the people who can still
    // log in. A suspended person keeps their row and their name, outside this index, so the name
    // is free for someone else. SQLite has no `btrim` (`no such function`) and spells it `trim`.
    // Run on BOTH engines rather than reasoned about — node:sqlite (Node v26.7.0),
    // /tmp/f1-ddl-probe/trim.mjs, and PostgreSQL through PGlite, /tmp/f1-ddl-probe/btrim-pg.mjs:
    // each strips SPACES from both ends and leaves a tab in place, so the pair agree on the one
    // argument form this index uses.
    // `foldForUniqueness` trims too, so the folded column and the fallback agree about the spaces
    // as well as about the letters.
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

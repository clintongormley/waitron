import "./errors.js";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { indexViolated, isUniqueViolation, nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, assertSupportedLocale, isValidTelephone } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { managementSessions } from "./schema/management-sessions.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { sessions } from "./schema/sessions.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { recoveryCodes } from "./schema/recovery-codes.js";
import { totpEnrollments } from "./schema/totp-enrollments.js";
import { normalizeEmail, isValidEmail } from "./email.js";
import { authorizeManager } from "./manager-login.js";
import { assertPinLength, hashPin } from "./verify-pin.js";
import { assertPasswordLength, hashPassword } from "./verify-password.js";
import { roleHasPermission, type Permission, type PersonRoleValue } from "./permissions.js";
import {
  PERSONS_EMAIL,
  PERSONS_LIVE_DISPLAY_NAME,
  PERSONS_PENDING_EMAIL,
} from "./person-constraints.js";

export { MIN_PIN_LENGTH } from "./verify-pin.js";

/**
 * A person id may arrive in either case, and settling it is this file's job rather than the
 * column's.
 *
 * It USED to be the column's: `persons.id` was a PostgreSQL `uuid`, which compares either case in
 * SQL. It is a plain `text` column now (`packages/db/src/schema/columns.ts`) and text compares byte
 * for byte, so an id a caller sent in upper case finds no row. Measured against the migrated
 * identity database on 2026-09-22 with a control in the other direction: one seeded row, the id
 * bound upper-case returns `[]` and the id bound as stored returns that row, with the emitted SQL
 * (`.toSQL()`) a plain `select "id" from "persons" where "persons"."id" = ?` either way — so it is
 * the comparison, not the statement, that changed.
 *
 * The shape that made this worth fixing rather than leaving to fail loudly: three functions here
 * ALREADY folded the id for their `authorizedBy` comparison and left the query unfolded. Given an
 * upper-case id, {@link suspendPerson} refused a self-suspension correctly and updated NOTHING for
 * anybody else — no rows, no error. One value now serves both uses.
 *
 * `packages/catalogue/src/product-modifiers.ts` settles its caller's ids at the same kind of
 * boundary, for the same reason and with the same one-line body. A refusal still echoes the
 * caller's own bytes rather than the folded value, which is the rule `normaliseUuid`
 * (`packages/shared/src/ids.ts`) states: the message exists to show them what they sent.
 */
const settleId = (value: string) => value.toLowerCase();

/**
 * Translate the ONE driver error the email write paths care about — a collision on the login-email
 * index — into the domain `person.email_taken`, and re-throw anything else untouched.
 *
 * `indexViolated` asks which INDEX refused, by name, which is what keeps a unique violation on a
 * different `persons` key — the `id` PK, the google-subject index, the pending-email index, or any
 * index added later — re-thrown untouched rather than mislabelled `person.email_taken` (which would
 * also break the `{ email }` param contract when `email` is null). The name is the only thing the
 * engine reports for an index over an expression; `person-constraints.ts` says why, and the
 * google-subject case in `person-constraints.db.test.ts` is the control that this question
 * discriminates rather than matching every unique violation on the table. `email` is normalized
 * before it reaches here, so the error carries the value that actually collided. Exported for the
 * crafted-error unit test in staff.test.ts, NOT from the package barrel.
 */
export function asEmailTaken(err: unknown, email: string): never {
  if (indexViolated(err, PERSONS_EMAIL)) {
    throw new AppError("person.email_taken", { email });
  }
  throw err;
}

/**
 * Translate a collision on one of the three `persons` indexes a person edit carries a domain code
 * for — the live display name, the login email, the pending email — and re-throw every other
 * refusal untouched, a collision on any other key included. The email code is thrown only when the
 * caller supplied an email, so `{ email }` never carries undefined.
 */
export function asPersonUniqueViolation(
  err: unknown,
  input: { email?: string; displayName: string },
): never {
  if (indexViolated(err, PERSONS_LIVE_DISPLAY_NAME)) {
    throw new AppError("person.display_name_taken", { displayName: input.displayName });
  }
  if (
    (indexViolated(err, PERSONS_EMAIL) || indexViolated(err, PERSONS_PENDING_EMAIL)) &&
    input.email !== undefined
  ) {
    throw new AppError("person.email_taken", { email: input.email });
  }
  throw err;
}

/** Normalize a required email and validate it, throwing `person.email_invalid` on a malformed value
 * before any write. This is the single email write-boundary rule used by account creation, editing,
 * and setup onboarding. */
export function normalizeAndValidateEmail(raw: string): string {
  if (typeof raw !== "string") throw new AppError("person.email_invalid", {});
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw new AppError("person.email_invalid", {});
  return email;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new AppError("profile.invalid", { field });
  return normalized;
}

/** The predicate must spell the trim the way `persons_tenant_live_display_name_uq` does
 * (`./schema/persons.ts:83`), or this pre-check and the index disagree about which names collide.
 * SQLite has no `btrim`: `select btrim('  Ada  ')` throws `no such function: btrim` where
 * `trim('  Ada  ')` returns `Ada`, driven on node:sqlite (Node v26.7.0). */
export async function assertDisplayNameAvailable(
  tx: Transaction,
  displayName: string,
  excludedPersonId?: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(sql`lower(trim(${persons.displayName}))`, displayName.toLocaleLowerCase()),
        ne(persons.status, "suspended"),
        excludedPersonId === undefined ? undefined : ne(persons.id, excludedPersonId),
      ),
    );
  if (existing !== undefined) throw new AppError("person.display_name_taken", { displayName });
}

export async function assertEmailAvailable(
  tx: Transaction,
  email: string,
  excludedPersonId?: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        or(eq(sql`lower(${persons.email})`, email), eq(sql`lower(${persons.pendingEmail})`, email)),
        excludedPersonId === undefined ? undefined : ne(persons.id, excludedPersonId),
      ),
    );
  if (existing !== undefined) throw new AppError("person.email_taken", { email });
}

async function revokePersonAccess(tx: Transaction, personId: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(sessions.personId, personId), isNull(sessions.endedAt)));
  await tx
    .update(managementSessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(managementSessions.personId, personId), isNull(managementSessions.endedAt)));
  await tx
    .update(managementAccountActions)
    .set({ usedAt: nowIso() })
    .where(
      and(eq(managementAccountActions.personId, personId), isNull(managementAccountActions.usedAt)),
    );
}

/**
 * Saves one complete administrative edit.
 *
 * The last-admin refusal below counts the active admins and then writes, and on PostgreSQL both
 * reads took `for update` so that a second edit could not land between the count and the write and
 * leave the venue with no admin at all. One write transaction runs on the venue file at a time, so
 * the count is still true when the update runs — the pattern is stated once, with its measurement
 * and its control, on `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`). The same
 * applies to {@link deactivatePerson}, {@link resetPersonLogin} and
 * {@link reactivatePersonForInvitation}, which each dropped the same clauses.
 */
export async function updatePersonDetails(
  tx: Transaction,
  input: {
    managementSessionId: string;
    personId: string;
    displayName: string;
    firstNames: string;
    lastNames: string;
    telephone: string | null;
    email: string;
    role: PersonRoleValue;
    status: "pending" | "active" | "suspended";
  },
): Promise<void> {
  const { authorizedBy, role: actorRole } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const activeAdmins = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.role, "admin"), eq(persons.status, "active")))
    .orderBy(persons.id);
  const [person] = await tx
    .select()
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (input.status === "suspended" && authorizedBy === settleId(input.personId)) {
    throw new AppError("person.self_deactivation", {});
  }
  if (input.status !== person.status && input.status !== "suspended") {
    throw new AppError("person.transition_invalid", {});
  }
  if (input.role !== person.role && (input.role === "admin" || person.role === "admin")) {
    if (!roleHasPermission(actorRole, "person.admin")) {
      throw new AppError("authorization.not_permitted", { permission: "person.admin" });
    }
  }
  if (
    person.role === "admin" &&
    person.status === "active" &&
    (input.role !== "admin" || input.status !== "active") &&
    activeAdmins.length === 1
  ) {
    throw new AppError("person.last_admin", {});
  }

  const displayName = requiredText(input.displayName, "displayName");
  const firstNames = requiredText(input.firstNames, "firstNames");
  const lastNames = requiredText(input.lastNames, "lastNames");
  const telephone = input.telephone?.trim() || null;
  if (telephone !== null && !isValidTelephone(telephone))
    throw new AppError("person.telephone_invalid", {});
  const email = normalizeAndValidateEmail(input.email);
  await assertDisplayNameAvailable(tx, displayName, person.id);
  await assertEmailAvailable(tx, email, person.id);
  try {
    await tx
      .update(persons)
      .set({
        displayName,
        firstNames,
        lastNames,
        telephone,
        email,
        emailVerifiedAt: email === person.email ? person.emailVerifiedAt : null,
        role: input.role,
        status: input.status,
      })
      .where(eq(persons.id, person.id));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName, email });
  }
  if (email !== person.email || input.status !== person.status)
    await revokePersonAccess(tx, person.id);
}

/** Marks a person inactive without rewriting their identity fields. */
export async function deactivatePerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { authorizedBy } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const activeAdmins = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.role, "admin"), eq(persons.status, "active")))
    .orderBy(persons.id);
  const [person] = await tx
    .select({ id: persons.id, role: persons.role, status: persons.status })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (authorizedBy === settleId(input.personId)) {
    throw new AppError("person.self_deactivation", {});
  }
  if (person.role === "admin" && person.status === "active" && activeAdmins.length === 1) {
    throw new AppError("person.last_admin", {});
  }
  if (person.status === "suspended") return;
  await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, person.id));
  await revokePersonAccess(tx, person.id);
}

/** Invalidates a person's device PIN so only that person can choose its replacement. */
export async function clearPersonPin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const updated = await tx
    .update(persons)
    .set({ pinHash: null })
    .where(eq(persons.id, settleId(input.personId)))
    .returning({ id: persons.id });
  if (updated.length !== 1) throw new AppError("person.not_found", { personId: input.personId });
  await tx
    .update(sessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(sessions.personId, settleId(input.personId)), isNull(sessions.endedAt)));
}

/** Clears every login method and returns an account to Pending before issuing a new invitation. */
export async function resetPersonLogin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const activeAdmins = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.role, "admin"), eq(persons.status, "active")))
    .orderBy(persons.id);
  const [person] = await tx
    .select({
      id: persons.id,
      displayName: persons.displayName,
      role: persons.role,
      status: persons.status,
    })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status === "suspended") throw new AppError("person.transition_invalid", {});
  if (person.role === "admin" && person.status === "active" && activeAdmins.length === 1) {
    throw new AppError("person.last_admin", {});
  }
  await tx
    .update(persons)
    .set({
      pinHash: null,
      passwordHash: null,
      totpSecret: null,
      googleSubject: null,
      emailVerifiedAt: null,
      status: "pending",
    })
    .where(eq(persons.id, person.id));
  await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.personId, person.id));
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.personId, settleId(input.personId)));
  await tx.delete(totpEnrollments).where(eq(totpEnrollments.personId, settleId(input.personId)));
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.personId, person.id));
  await revokePersonAccess(tx, person.id);
}

/** Moves an inactive account to Pending and clears credentials before a fresh invitation is issued. */
export async function reactivatePersonForInvitation(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const [person] = await tx
    .select({ id: persons.id, displayName: persons.displayName, status: persons.status })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status !== "suspended") throw new AppError("person.transition_invalid", {});
  await assertDisplayNameAvailable(tx, person.displayName, person.id);
  try {
    await tx
      .update(persons)
      .set({
        status: "pending",
        pinHash: null,
        passwordHash: null,
        totpSecret: null,
        googleSubject: null,
        emailVerifiedAt: null,
      })
      .where(eq(persons.id, person.id));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName: person.displayName });
  }
  await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.personId, person.id));
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.personId, person.id));
  await tx.delete(totpEnrollments).where(eq(totpEnrollments.personId, person.id));
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.personId, person.id));
  await revokePersonAccess(tx, person.id);
}

/** Creates the pending account an administrator has invited. Credentials are chosen by its owner. */
export async function invitePerson(
  tx: Transaction,
  input: {
    managementSessionId: string;
    displayName: string;
    firstNames: string;
    lastNames: string;
    telephone: string | null;
    role: PersonRoleValue;
    email: string;
  },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const displayName = requiredText(input.displayName, "displayName");
  const firstNames = requiredText(input.firstNames, "firstNames");
  const lastNames = requiredText(input.lastNames, "lastNames");
  const telephone = input.telephone?.trim() || null;
  if (telephone !== null && !isValidTelephone(telephone))
    throw new AppError("person.telephone_invalid", {});
  const email = normalizeAndValidateEmail(input.email);
  await assertDisplayNameAvailable(tx, displayName);
  await assertEmailAvailable(tx, email);
  try {
    const [row] = await tx
      .insert(persons)
      .values({
        displayName,
        firstNames,
        lastNames,
        telephone,
        pinHash: null,
        passwordHash: null,
        role: input.role,
        status: "pending",
        email,
      })
      .returning({ id: persons.id });
    return { id: row!.id };
  } catch (error) {
    // The NEGATION, which `indexViolated` cannot express, so this stays on the primitives. A unique
    // violation this cannot identify takes this branch deliberately: the insert leaves
    // `pending_email` and `google_subject` null and lets `id` default, so the live display-name
    // index is the only other key it can collide on.
    if (isUniqueViolation(error) && !indexViolated(error, PERSONS_EMAIL)) {
      throw new AppError("person.display_name_taken", { displayName });
    }
    asEmailTaken(error, email);
  }
}

/**
 * Creates a staff member. Gated on `person.manage`: `authorizeManager` runs FIRST, so a caller
 * without the permission is rejected before any write. The PIN is length-checked, then stored
 * hashed — never plaintext. Bootstrapping the FIRST admin is provisioning's job, not this gated path.
 */
export async function createPerson(
  tx: Transaction,
  input: {
    managementSessionId: string;
    displayName: string;
    role: PersonRoleValue;
    pin: string;
    email: string;
  },
): Promise<{ id: string }> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  const email = normalizeAndValidateEmail(input.email);
  const displayName = requiredText(input.displayName, "displayName");
  await assertDisplayNameAvailable(tx, displayName);
  await assertEmailAvailable(tx, email);
  try {
    const [row] = await tx
      .insert(persons)
      .values({
        displayName,
        pinHash: hashPin(input.pin),
        role: input.role,
        email,
      })
      .returning({ id: persons.id });
    return { id: row!.id };
  } catch (err) {
    // The NEGATION, which `indexViolated` cannot express, so this stays on the primitives. A unique
    // violation this cannot identify takes this branch deliberately: the insert leaves
    // `pending_email` and `google_subject` null and lets `id` default, so the live display-name
    // index is the only other key it can collide on.
    if (isUniqueViolation(err) && !indexViolated(err, PERSONS_EMAIL)) {
      throw new AppError("person.display_name_taken", { displayName });
    }
    asEmailTaken(err, email);
  }
}

/** Changes a person's role. Gated on `person.manage`. authorizeManager reads a role live (via
 * resolveManagementSession), so an open management session sees the change on its next call. */
export async function setRole(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; role: PersonRoleValue },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx
    .update(persons)
    .set({ role: input.role })
    .where(eq(persons.id, settleId(input.personId)));
}

/** Resets a person's PIN. Gated on `person.manage`; the new PIN is length-checked, then stored
 * hashed. */
export async function resetPin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; pin: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  await tx
    .update(persons)
    .set({ pinHash: hashPin(input.pin) })
    .where(eq(persons.id, settleId(input.personId)));
}

/** Grants (or replaces) a person's dashboard password. Gated on `person.manage`:
 * `authorizeManager` runs FIRST, so a caller without the permission is rejected before any write.
 * The password is length-checked, then stored hashed — never plaintext. This is the general
 * admin-sets-password path; bootstrapping the FIRST admin's password is provisioning's job. */
export async function setPassword(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; password: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPasswordLength(input.password);
  await tx
    .update(persons)
    .set({ passwordHash: hashPassword(input.password) })
    .where(eq(persons.id, settleId(input.personId)));
}

/** Sets (or replaces) a person's login email — the identifier for dashboard sign-in. Gated on
 * `person.manage`, mirroring `setPassword`: `authorizeManager` runs FIRST, so a caller without the
 * permission is rejected before any write. The email is normalized then screened (malformed →
 * `person.email_invalid`) before the UPDATE; a collision with any other person's email surfaces as
 * `person.email_taken` — `persons_tenant_email_uq` is `UNIQUE (lower(email)) WHERE email IS NOT
 * NULL`, so one address across the whole database, case-insensitively. (The index NAME still reads
 * `tenant`; renaming it is its own slice, `docs/backlog.md`.) */
export async function setEmail(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; email: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const email = normalizeAndValidateEmail(input.email);
  try {
    await tx
      .update(persons)
      .set({ email, emailVerifiedAt: null })
      .where(eq(persons.id, settleId(input.personId)));
  } catch (err) {
    asEmailTaken(err, email);
  }
}

/**
 * Sets a person's preferred UI language. Validates against the supported set (throws
 * `locale.unsupported`) so a bad code never reaches the row. Unlike every other mutator in this file
 * there is NO `authorizeManager` gate: a person sets their OWN locale, so the server routes pass the
 * SESSION's `personId` (never a body value). The UPDATE matches the person's id.
 */
export async function setPersonLocale(
  tx: Transaction,
  input: { personId: string; locale: string },
): Promise<void> {
  const locale = assertSupportedLocale(input.locale);
  await tx
    .update(persons)
    .set({ locale })
    .where(eq(persons.id, settleId(input.personId)));
}

/** Suspends a person: keeps the row (and its history) while refusing login. Gated on
 * `person.manage`. */
export async function suspendPerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { authorizedBy } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  if (authorizedBy === settleId(input.personId)) throw new AppError("person.self_deactivation", {});
  await tx
    .update(persons)
    .set({ status: "suspended" })
    .where(eq(persons.id, settleId(input.personId)));
}

/** Reactivates a suspended person, restoring login. Gated on `person.manage`. */
export async function reactivatePerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx
    .update(persons)
    .set({ status: "active" })
    .where(eq(persons.id, settleId(input.personId)));
}

/** One entry in the pre-login roster: the id the lock screen logs in with, and the name it shows. */
export interface StaffListEntry {
  personId: string;
  displayName: string;
}

/**
 * Pre-login roster for the till lock screen. Unlike the rest of this file it is NOT gated on
 * `authorize` — it
 * runs before any session exists — and returns only `{ personId, displayName }` for `active`
 * persons. No PIN material, no role, no status: nothing that is unsafe to show before anyone has
 * logged in. Suspended persons are excluded — a `status = 'active'` filter, which the suite
 * checks.
 */
export async function listActiveStaff(tx: Transaction): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows.map((r) => ({ personId: r.personId, displayName: r.displayName }));
}

/**
 * The active persons whose ROLE holds `permission`, in the same `{ personId, displayName }` shape
 * `listActiveStaff` returns. This is the roster a till surfaces when an operator must pick an
 * authorizing supervisor for a privileged action under a gated policy (the cash-drawer override —
 * cash-drawer-authorization §5): the eligible authorizers are exactly the active persons whose
 * role holds the action's permission.
 *
 * Like `listActiveStaff` it returns ONLY `{ personId, displayName }` — no PIN material, role or status: the
 * caller shows the picker before the authorizing supervisor has entered a credential, so nothing
 * unsafe to show may travel. The role→permission map stays authoritative in permissions.ts: this
 * fetches every active person + their role and keeps those `roleHasPermission(role, permission)`
 * accepts, so which roles hold a permission is decided in one place, never hardcoded here.
 */
export async function listActivePersonsWithPermission(
  tx: Transaction,
  permission: Permission,
): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName, role: persons.role })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows
    .filter((r) => roleHasPermission(r.role as PersonRoleValue, permission))
    .map((r) => ({ personId: r.personId, displayName: r.displayName }));
}

/** One row of the admin roster (Task 10). Carries the person's role and status plus credential
 * BOOLEANS — never the hash or secret behind them. */
export interface PersonSummary {
  personId: string;
  displayName: string;
  firstNames: string | null;
  lastNames: string | null;
  telephone: string | null;
  /** The person's login email. Null is reserved for internal principals and low-level fixtures. */
  email: string | null;
  role: PersonRoleValue;
  status: "pending" | "active" | "suspended";
  hasPassword: boolean;
  hasTotp: boolean;
}

/**
 * Admin roster for the dashboard staff screen. Gated on `person.manage`: `authorizeManager` runs
 * FIRST, so a caller without the permission is rejected before anything is selected. Returns EVERY
 * person (suspended included, unlike the pre-login `listActiveStaff`), ordered by name.
 *
 * `password_hash`/`totp_secret` are selected only to derive `hasPassword`/`hasTotp`; the returned
 * `PersonSummary` carries the booleans and never the hash, the secret, or the PIN — a leak the suite
 * pins by asserting `JSON.stringify` of the roster contains no `scrypt$` (the credential-hash prefix).
 */
export async function listPersons(
  tx: Transaction,
  args: { managementSessionId: string },
): Promise<PersonSummary[]> {
  await authorizeManager(tx, {
    managementSessionId: args.managementSessionId,
    permission: "person.manage",
  });
  const rows = await tx
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      firstNames: persons.firstNames,
      lastNames: persons.lastNames,
      telephone: persons.telephone,
      email: persons.email,
      role: persons.role,
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .orderBy(persons.displayName);
  return rows.map((r) => ({
    personId: r.personId,
    displayName: r.displayName,
    firstNames: r.firstNames,
    lastNames: r.lastNames,
    telephone: r.telephone,
    email: r.email,
    role: r.role as PersonRoleValue,
    status: r.status as "pending" | "active" | "suspended",
    hasPassword: r.passwordHash !== null,
    hasTotp: r.totpSecret !== null,
  }));
}

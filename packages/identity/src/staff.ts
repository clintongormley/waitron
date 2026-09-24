import "./errors.js";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { indexViolated, isUniqueViolation, nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, assertSupportedLocale, isValidTelephone } from "@waitron/shared";
import { liveDisplayNameKey, loginEmailKey, pendingEmailKey, persons } from "./schema/persons.js";
import { managementSessions } from "./schema/management-sessions.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { sessions } from "./schema/sessions.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { recoveryCodes } from "./schema/recovery-codes.js";
import { totpEnrollments } from "./schema/totp-enrollments.js";
import { normalizeEmail, isValidEmail } from "./email.js";
import { foldForUniqueness } from "./fold.js";
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
 * A person id may arrive in either case, and `persons.id` is a `text` column compared byte for
 * byte, so an id a caller sent in upper case would find no row. A refusal still echoes the caller's
 * own bytes rather than the folded value, the rule `normaliseUuid` (`packages/shared/src/ids.ts`)
 * states.
 */
const settleId = (value: string) => value.toLowerCase();

/**
 * Translate a collision on the login-email index into `person.email_taken`, and re-throw anything
 * else untouched, a unique violation on another `persons` key included. The index is asked for by
 * name because that is all the engine reports for an index over an expression
 * (`person-constraints.ts`). Exported for staff.test.ts, not from the package barrel.
 */
export function asEmailTaken(err: unknown, email: string): never {
  if (indexViolated(err, PERSONS_EMAIL)) {
    throw new AppError("person.email_taken", { email });
  }
  throw err;
}

/**
 * Translate a collision on the live display name, login email or pending email index into its
 * domain code, and re-throw every other refusal untouched. The email code is thrown only when the
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

/** The predicate reads `liveDisplayNameKey()`, the expression `persons_tenant_live_display_name_uq`
 * is declared over (`./schema/persons.ts`), so this pre-check and the index cannot disagree about
 * which names collide. */
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
        eq(liveDisplayNameKey(), foldForUniqueness(displayName)),
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
        // The expressions the two email indexes are declared over, as in
        // {@link assertDisplayNameAvailable}.
        or(
          eq(loginEmailKey(), foldForUniqueness(email)),
          eq(pendingEmailKey(), foldForUniqueness(email)),
        ),
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
 * The last-admin refusal counts the active admins and then writes. The count still holds at the
 * write only because a caller inside `withTransaction` holds the venue's write lock; the same goes
 * for {@link deactivatePerson} and {@link resetPersonLogin}.
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
        displayNameFolded: foldForUniqueness(displayName),
        firstNames,
        lastNames,
        telephone,
        email,
        emailFolded: foldForUniqueness(email),
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
        displayNameFolded: foldForUniqueness(displayName),
        firstNames,
        lastNames,
        telephone,
        pinHash: null,
        passwordHash: null,
        role: input.role,
        status: "pending",
        email,
        emailFolded: foldForUniqueness(email),
      })
      .returning({ id: persons.id });
    return { id: row!.id };
  } catch (error) {
    // Any unique violation off the email index is read as the display name: the insert leaves
    // `pending_email` and `google_subject` null and lets `id` default, so the live display-name
    // index is the only other key it can collide on.
    if (isUniqueViolation(error) && !indexViolated(error, PERSONS_EMAIL)) {
      throw new AppError("person.display_name_taken", { displayName });
    }
    asEmailTaken(error, email);
  }
}

/** Bootstrapping the FIRST admin is provisioning's job, not this gated path. */
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
        displayNameFolded: foldForUniqueness(displayName),
        pinHash: hashPin(input.pin),
        role: input.role,
        email,
        emailFolded: foldForUniqueness(email),
      })
      .returning({ id: persons.id });
    return { id: row!.id };
  } catch (err) {
    // Any unique violation off the email index is read as the display name: the insert leaves
    // `pending_email` and `google_subject` null and lets `id` default, so the live display-name
    // index is the only other key it can collide on.
    if (isUniqueViolation(err) && !indexViolated(err, PERSONS_EMAIL)) {
      throw new AppError("person.display_name_taken", { displayName });
    }
    asEmailTaken(err, email);
  }
}

/** authorizeManager reads a role live (via resolveManagementSession), so an open management
 * session sees the change on its next call. */
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

/** `email_folded` is written beside `email` because it is what `persons_tenant_email_uq` reads. */
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
      .set({ email, emailFolded: foldForUniqueness(email), emailVerifiedAt: null })
      .where(eq(persons.id, settleId(input.personId)));
  } catch (err) {
    asEmailTaken(err, email);
  }
}

/**
 * Unlike every other mutator in this file there is NO `authorizeManager` gate: a person sets their
 * OWN locale, so the server routes pass the SESSION's `personId` (never a body value).
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

export interface StaffListEntry {
  personId: string;
  displayName: string;
}

/**
 * Pre-login roster for the till lock screen. It runs before any session exists, so it is NOT gated
 * and returns only `{ personId, displayName }`: nothing unsafe to show before anyone has logged in.
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
 * The authorizing-supervisor picker a till shows (cash-drawer-authorization §5). The picker is shown
 * before the supervisor has entered a credential, so like `listActiveStaff` it returns ONLY
 * `{ personId, displayName }`.
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

/** Carries credential BOOLEANS, never the hash or secret behind them. */
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

/** `password_hash`/`totp_secret` are selected only to derive `hasPassword`/`hasTotp`. */
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

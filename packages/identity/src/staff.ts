import "./errors.js";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { isUniqueViolation, uniqueViolationConstraint } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, assertSupportedLocale } from "@waitron/shared";
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

export { MIN_PIN_LENGTH } from "./verify-pin.js";

/**
 * Translate the ONE driver error the email write paths care about — a `persons_tenant_email_uq`
 * collision — into the domain `person.email_taken`, and re-throw anything else untouched. The
 * duplicate surfaces as SQLSTATE 23505 wrapped in Drizzle's `DrizzleQueryError`, so detection goes
 * through `@waitron/db`'s `isUniqueViolation` (a cause-chain walk), not a top-level `.code` read.
 *
 * It matches on the CONSTRAINT NAME, not merely on 23505: a different unique violation on `persons`
 * — the `id` PK, or any unique constraint added later — is re-thrown untouched, never mislabelled
 * `person.email_taken` (which would also break the `{ email }` param contract when `email` is null).
 * `email` is normalized before it reaches here, so the error carries the value that actually
 * collided. Exported for the crafted-error unit test in staff.test.ts, NOT from the package barrel.
 */
export function asEmailTaken(err: unknown, email: string): never {
  if (isUniqueViolation(err)) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint === "persons_tenant_email_uq") {
      throw new AppError("person.email_taken", { email });
    }
  }
  throw err;
}

export function asPersonUniqueViolation(
  err: unknown,
  input: { email?: string; displayName: string },
): never {
  const constraint = isUniqueViolation(err) ? uniqueViolationConstraint(err) : undefined;
  if (constraint === "persons_tenant_live_display_name_uq") {
    throw new AppError("person.display_name_taken", { displayName: input.displayName });
  }
  if (
    (constraint === "persons_tenant_email_uq" ||
      constraint === "persons_tenant_pending_email_uq") &&
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

export async function assertDisplayNameAvailable(
  tx: Transaction,
  tenantId: string,
  displayName: string,
  excludedPersonId?: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.tenantId, tenantId),
        eq(sql`lower(btrim(${persons.displayName}))`, displayName.toLocaleLowerCase()),
        ne(persons.status, "suspended"),
        excludedPersonId === undefined ? undefined : ne(persons.id, excludedPersonId),
      ),
    );
  if (existing !== undefined) throw new AppError("person.display_name_taken", { displayName });
}

export async function assertEmailAvailable(
  tx: Transaction,
  tenantId: string,
  email: string,
  excludedPersonId?: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.tenantId, tenantId),
        or(eq(sql`lower(${persons.email})`, email), eq(sql`lower(${persons.pendingEmail})`, email)),
        excludedPersonId === undefined ? undefined : ne(persons.id, excludedPersonId),
      ),
    );
  if (existing !== undefined) throw new AppError("person.email_taken", { email });
}

async function revokePersonAccess(
  tx: Transaction,
  tenantId: string,
  personId: string,
): Promise<void> {
  await tx
    .update(sessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        eq(sessions.personId, personId),
        isNull(sessions.endedAt),
      ),
    );
  await tx
    .update(managementSessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(managementSessions.tenantId, tenantId),
        eq(managementSessions.personId, personId),
        isNull(managementSessions.endedAt),
      ),
    );
  await tx
    .update(managementAccountActions)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(managementAccountActions.tenantId, tenantId),
        eq(managementAccountActions.personId, personId),
        isNull(managementAccountActions.usedAt),
      ),
    );
}

/** Saves one complete administrative edit after serializing the active-admin invariant. */
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
  const {
    authorizedBy,
    tenantId,
    role: actorRole,
  } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const activeAdmins = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(eq(persons.tenantId, tenantId), eq(persons.role, "admin"), eq(persons.status, "active")),
    )
    .orderBy(persons.id)
    .for("update");
  const [person] = await tx
    .select()
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)))
    .for("update");
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (input.status === "suspended" && authorizedBy === input.personId.toLowerCase()) {
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
  const email = normalizeAndValidateEmail(input.email);
  await assertDisplayNameAvailable(tx, tenantId, displayName, person.id);
  await assertEmailAvailable(tx, tenantId, email, person.id);
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
      .where(and(eq(persons.tenantId, tenantId), eq(persons.id, person.id)));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName, email });
  }
  if (email !== person.email || input.status !== person.status)
    await revokePersonAccess(tx, tenantId, person.id);
}

/** Marks a person inactive without rewriting their identity fields. */
export async function deactivatePerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { authorizedBy, tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const activeAdmins = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(eq(persons.tenantId, tenantId), eq(persons.role, "admin"), eq(persons.status, "active")),
    )
    .orderBy(persons.id)
    .for("update");
  const [person] = await tx
    .select({ id: persons.id, role: persons.role, status: persons.status })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)))
    .for("update");
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (authorizedBy === input.personId.toLowerCase()) {
    throw new AppError("person.self_deactivation", {});
  }
  if (person.role === "admin" && person.status === "active" && activeAdmins.length === 1) {
    throw new AppError("person.last_admin", {});
  }
  if (person.status === "suspended") return;
  await tx
    .update(persons)
    .set({ status: "suspended" })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, person.id)));
  await revokePersonAccess(tx, tenantId, person.id);
}

/** Invalidates a person's device PIN so only that person can choose its replacement. */
export async function clearPersonPin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const updated = await tx
    .update(persons)
    .set({ pinHash: null })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)))
    .returning({ id: persons.id });
  if (updated.length !== 1) throw new AppError("person.not_found", { personId: input.personId });
  await tx
    .update(sessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        eq(sessions.personId, input.personId),
        isNull(sessions.endedAt),
      ),
    );
}

/** Clears every login method and returns an account to Pending before issuing a new invitation. */
export async function resetPersonLogin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const activeAdmins = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(eq(persons.tenantId, tenantId), eq(persons.role, "admin"), eq(persons.status, "active")),
    )
    .orderBy(persons.id)
    .for("update");
  const [person] = await tx
    .select({
      id: persons.id,
      displayName: persons.displayName,
      role: persons.role,
      status: persons.status,
    })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)))
    .for("update");
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
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, person.id)));
  await tx
    .delete(webauthnCredentials)
    .where(
      and(eq(webauthnCredentials.tenantId, tenantId), eq(webauthnCredentials.personId, person.id)),
    );
  await tx
    .delete(recoveryCodes)
    .where(and(eq(recoveryCodes.tenantId, tenantId), eq(recoveryCodes.personId, input.personId)));
  await tx
    .delete(totpEnrollments)
    .where(
      and(eq(totpEnrollments.tenantId, tenantId), eq(totpEnrollments.personId, input.personId)),
    );
  await tx
    .delete(webauthnChallenges)
    .where(
      and(eq(webauthnChallenges.tenantId, tenantId), eq(webauthnChallenges.personId, person.id)),
    );
  await revokePersonAccess(tx, tenantId, person.id);
}

/** Moves an inactive account to Pending and clears credentials before a fresh invitation is issued. */
export async function reactivatePersonForInvitation(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const [person] = await tx
    .select({ id: persons.id, displayName: persons.displayName, status: persons.status })
    .from(persons)
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)))
    .for("update");
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status !== "suspended") throw new AppError("person.transition_invalid", {});
  await assertDisplayNameAvailable(tx, tenantId, person.displayName, person.id);
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
      .where(and(eq(persons.tenantId, tenantId), eq(persons.id, person.id)));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName: person.displayName });
  }
  await tx
    .delete(webauthnCredentials)
    .where(
      and(eq(webauthnCredentials.tenantId, tenantId), eq(webauthnCredentials.personId, person.id)),
    );
  await tx
    .delete(recoveryCodes)
    .where(and(eq(recoveryCodes.tenantId, tenantId), eq(recoveryCodes.personId, person.id)));
  await tx
    .delete(totpEnrollments)
    .where(and(eq(totpEnrollments.tenantId, tenantId), eq(totpEnrollments.personId, person.id)));
  await tx
    .delete(webauthnChallenges)
    .where(
      and(eq(webauthnChallenges.tenantId, tenantId), eq(webauthnChallenges.personId, person.id)),
    );
  await revokePersonAccess(tx, tenantId, person.id);
}

/** Creates the pending account an administrator has invited. Credentials are chosen by its owner. */
export async function invitePerson(
  tx: Transaction,
  input: {
    tenantId: string;
    managementSessionId: string;
    displayName: string;
    firstNames: string;
    lastNames: string;
    telephone: string | null;
    role: PersonRoleValue;
    email: string;
  },
): Promise<{ id: string }> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const displayName = requiredText(input.displayName, "displayName");
  const firstNames = requiredText(input.firstNames, "firstNames");
  const lastNames = requiredText(input.lastNames, "lastNames");
  const telephone = input.telephone?.trim() || null;
  const email = normalizeAndValidateEmail(input.email);
  await assertDisplayNameAvailable(tx, tenantId, displayName);
  await assertEmailAvailable(tx, tenantId, email);
  try {
    const [row] = await tx
      .insert(persons)
      .values({
        tenantId,
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
    if (
      isUniqueViolation(error) &&
      uniqueViolationConstraint(error) !== "persons_tenant_email_uq"
    ) {
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
    tenantId: string;
    managementSessionId: string;
    displayName: string;
    role: PersonRoleValue;
    pin: string;
    email: string;
  },
): Promise<{ id: string }> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  const email = normalizeAndValidateEmail(input.email);
  const displayName = requiredText(input.displayName, "displayName");
  await assertDisplayNameAvailable(tx, tenantId, displayName);
  await assertEmailAvailable(tx, tenantId, email);
  try {
    const [row] = await tx
      .insert(persons)
      .values({
        tenantId,
        displayName,
        pinHash: hashPin(input.pin),
        role: input.role,
        email,
      })
      .returning({ id: persons.id });
    return { id: row!.id };
  } catch (err) {
    if (isUniqueViolation(err) && uniqueViolationConstraint(err) !== "persons_tenant_email_uq") {
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
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx
    .update(persons)
    .set({ role: input.role })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)));
}

/** Resets a person's PIN. Gated on `person.manage`; the new PIN is length-checked, then stored
 * hashed. */
export async function resetPin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; pin: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPinLength(input.pin);
  await tx
    .update(persons)
    .set({ pinHash: hashPin(input.pin) })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)));
}

/** Grants (or replaces) a person's dashboard password. Gated on `person.manage`:
 * `authorizeManager` runs FIRST, so a caller without the permission is rejected before any write.
 * The password is length-checked, then stored hashed — never plaintext. This is the general
 * admin-sets-password path; bootstrapping the FIRST admin's password is provisioning's job. */
export async function setPassword(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; password: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  assertPasswordLength(input.password);
  await tx
    .update(persons)
    .set({ passwordHash: hashPassword(input.password) })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)));
}

/** Sets (or replaces) a person's login email — the identifier for dashboard sign-in. Gated on
 * `person.manage`, mirroring `setPassword`: `authorizeManager` runs FIRST, so a caller without the
 * permission is rejected before any write. The email is normalized then screened (malformed →
 * `person.email_invalid`) before the UPDATE; a collision with another person's email in the same
 * tenant (the `persons_tenant_email_uq` index) surfaces as `person.email_taken`. */
export async function setEmail(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; email: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const email = normalizeAndValidateEmail(input.email);
  try {
    await tx
      .update(persons)
      .set({ email, emailVerifiedAt: null })
      .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)));
  } catch (err) {
    asEmailTaken(err, email);
  }
}

/**
 * Sets a person's preferred UI language. Validates against the supported set (throws
 * `locale.unsupported`) so a bad code never reaches the row. Unlike every other mutator in this file
 * there is NO `authorizeManager` gate: a person sets their OWN locale, so the server routes pass the
 * SESSION's `personId` (never a body value). `tenantId` is retained for signature parity; the
 * UPDATE matches the person's id.
 */
export async function setPersonLocale(
  tx: Transaction,
  input: { tenantId: string; personId: string; locale: string },
): Promise<void> {
  const locale = assertSupportedLocale(input.locale);
  await tx
    .update(persons)
    .set({ locale })
    .where(and(eq(persons.tenantId, input.tenantId), eq(persons.id, input.personId)));
}

/** Suspends a person: keeps the row (and its history) while refusing login. Gated on
 * `person.manage`. */
export async function suspendPerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { authorizedBy, tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  if (authorizedBy === input.personId.toLowerCase())
    throw new AppError("person.self_deactivation", {});
  await tx
    .update(persons)
    .set({ status: "suspended" })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)));
}

/** Reactivates a suspended person, restoring login. Gated on `person.manage`. */
export async function reactivatePerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { tenantId } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  await tx
    .update(persons)
    .set({ status: "active" })
    .where(and(eq(persons.tenantId, tenantId), eq(persons.id, input.personId)));
}

/** One entry in the pre-login roster: the id the lock screen logs in with, and the name it shows. */
export interface StaffListEntry {
  personId: string;
  displayName: string;
}

/**
 * Pre-login roster for the till lock screen. This read has no tenant predicate. The deployment
 * holds one tenant per database. Unlike the rest of this file it is NOT gated on `authorize` — it
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
 * role holds the action's permission. The active-person read has no tenant predicate. The
 * deployment holds one tenant per database.
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
 * person of the tenant (suspended included, unlike the pre-login `listActiveStaff`), ordered by name.
 *
 * `password_hash`/`totp_secret` are selected only to derive `hasPassword`/`hasTotp`; the returned
 * `PersonSummary` carries the booleans and never the hash, the secret, or the PIN — a leak the suite
 * pins by asserting `JSON.stringify` of the roster contains no `scrypt$` (the credential-hash prefix).
 */
export async function listPersons(
  tx: Transaction,
  args: { managementSessionId: string },
): Promise<PersonSummary[]> {
  const { tenantId } = await authorizeManager(tx, {
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
    .where(eq(persons.tenantId, tenantId))
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

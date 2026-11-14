import "./errors.js";
import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
  recordActivity,
  indexViolated,
  isUniqueViolation,
  nowIso,
  liveDisplayNameKey,
  loginEmailKey,
  pendingEmailKey,
  personRoles,
  roles,
  persons,
  managementSessions,
  managementAccountActions,
  sessions,
  webauthnChallenges,
  webauthnCredentials,
  recoveryCodes,
  totpEnrollments,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, assertSupportedLocale, isValidTelephone } from "@waitron/shared";
import { normalizeEmail, isValidEmail } from "./email.js";
import { foldForUniqueness } from "./fold.js";
import { authorizeManager } from "./manager-login.js";
import { requireFreshManagementSignIn } from "./fresh-sign-in.js";
import type { Permission } from "./permissions.js";
import { queueEmailChangedNotice } from "./email-change-mail.js";
import { assertActorCovers, assertUsableAdminRemains } from "./admin-anchor.js";
import {
  holds,
  readPersonAuthority,
  authorityForRoles,
  type PersonAuthority,
} from "./authority.js";
import { setPersonAccessRoles } from "./roles.js";
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
 * is declared over (`packages/db/src/schema/identity/persons.ts`), so this pre-check and the index
 * cannot disagree about which names collide. */
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

function requireAdminAuthority(authority: PersonAuthority): void {
  if (!holds(authority, "person.admin")) {
    throw new AppError("authorization.not_permitted", { permission: "person.admin" });
  }
}

export async function authorizePersonLoginChange(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
) {
  const actor = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const [person] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person !== undefined && actor.authorizedBy !== person.id) {
    requireAdminAuthority(actor.authority);
    assertActorCovers(actor.authority, await readPersonAuthority(tx, person.id));
  }
  return actor;
}

async function invalidatePersonAccountActions(tx: Transaction, personId: string): Promise<void> {
  await tx
    .update(managementAccountActions)
    .set({ usedAt: nowIso() })
    .where(
      and(eq(managementAccountActions.personId, personId), isNull(managementAccountActions.usedAt)),
    );
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
  await invalidatePersonAccountActions(tx, personId);
}

/** Spread into the caller's own `persons` update; {@link deleteSignInRows} removes the rest. */
const NO_SIGN_IN_SECRETS = {
  pinHash: null,
  passwordHash: null,
  totpSecret: null,
  googleSubject: null,
} as const;

async function deleteSignInRows(tx: Transaction, personId: string): Promise<void> {
  await tx.delete(webauthnCredentials).where(eq(webauthnCredentials.personId, personId));
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.personId, personId));
  await tx.delete(totpEnrollments).where(eq(totpEnrollments.personId, personId));
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.personId, personId));
}

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
    status: "pending" | "active" | "suspended";
  },
): Promise<void> {
  const { authorizedBy, authority } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
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
  const displayName = requiredText(input.displayName, "displayName");
  const firstNames = requiredText(input.firstNames, "firstNames");
  const lastNames = requiredText(input.lastNames, "lastNames");
  const telephone = input.telephone?.trim() || null;
  if (telephone !== null && !isValidTelephone(telephone))
    throw new AppError("person.telephone_invalid", {});
  const email = normalizeAndValidateEmail(input.email);
  if ((email !== person.email && authorizedBy !== person.id) || input.status !== person.status) {
    requireAdminAuthority(authority);
    if (authorizedBy !== person.id) {
      assertActorCovers(authority, await readPersonAuthority(tx, person.id));
      if (email !== person.email && !holds(authority, "person.email"))
        throw new AppError("authorization.not_permitted", { permission: "person.email" });
    }
  }
  if (email !== person.email || input.status !== person.status)
    await requireFreshManagementSignIn(tx, input.managementSessionId);
  await assertDisplayNameAvailable(tx, displayName, person.id);
  await assertEmailAvailable(tx, email, person.id);
  const becomesSuspended = input.status === "suspended" && person.status !== "suspended";
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
        status: input.status,
        ...(becomesSuspended ? NO_SIGN_IN_SECRETS : {}),
      })
      .where(eq(persons.id, person.id));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName, email });
  }
  if (becomesSuspended) await deleteSignInRows(tx, person.id);
  if (email !== person.email || input.status !== person.status)
    await revokePersonAccess(tx, person.id);
  if (email !== person.email && authorizedBy !== person.id) {
    const activity = await recordActivity(tx, {
      kind: "person.email_changed",
      subjectId: person.id,
      personId: authorizedBy,
      data: {},
    });
    if (person.email !== null) {
      const [editor] = await tx
        .select({ displayName: persons.displayName })
        .from(persons)
        .where(eq(persons.id, authorizedBy));
      await queueEmailChangedNotice(tx, {
        activityId: activity.id,
        personId: person.id,
        actorId: authorizedBy,
        oldEmail: person.email,
        editorName: editor!.displayName,
        at: activity.at,
      });
    }
  }
  await assertUsableAdminRemains(tx);
}

export async function deactivatePerson(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { authorizedBy, authority } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const [person] = await tx
    .select({ id: persons.id, status: persons.status })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (authorizedBy === settleId(input.personId)) {
    throw new AppError("person.self_deactivation", {});
  }
  requireAdminAuthority(authority);
  assertActorCovers(authority, await readPersonAuthority(tx, person.id));
  const alreadySuspended = person.status === "suspended";
  await tx
    .update(persons)
    .set(alreadySuspended ? NO_SIGN_IN_SECRETS : { status: "suspended", ...NO_SIGN_IN_SECRETS })
    .where(eq(persons.id, person.id));
  await deleteSignInRows(tx, person.id);
  if (!alreadySuspended) await revokePersonAccess(tx, person.id);
  await assertUsableAdminRemains(tx);
}

export async function clearPersonPin(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  await authorizePersonLoginChange(tx, input);
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
  await authorizePersonLoginChange(tx, input);
  const [person] = await tx
    .select({
      id: persons.id,
      displayName: persons.displayName,
      status: persons.status,
    })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status === "suspended") throw new AppError("person.transition_invalid", {});
  await tx
    .update(persons)
    .set({ emailVerifiedAt: null, status: "pending", ...NO_SIGN_IN_SECRETS })
    .where(eq(persons.id, person.id));
  await deleteSignInRows(tx, person.id);
  await revokePersonAccess(tx, person.id);
  await assertUsableAdminRemains(tx);
}

export async function reactivatePersonForInvitation(
  tx: Transaction,
  input: { managementSessionId: string; personId: string },
): Promise<void> {
  const { authorizedBy, authority } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  const [person] = await tx
    .select({
      id: persons.id,
      displayName: persons.displayName,
      status: persons.status,
    })
    .from(persons)
    .where(eq(persons.id, settleId(input.personId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status !== "suspended") throw new AppError("person.transition_invalid", {});
  requireAdminAuthority(authority);
  if (authorizedBy !== person.id)
    assertActorCovers(authority, await readPersonAuthority(tx, person.id));
  await assertDisplayNameAvailable(tx, person.displayName, person.id);
  try {
    await tx
      .update(persons)
      .set({ status: "pending", emailVerifiedAt: null, ...NO_SIGN_IN_SECRETS })
      .where(eq(persons.id, person.id));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName: person.displayName });
  }
  await deleteSignInRows(tx, person.id);
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
    roleIds: string[];
    email: string;
  },
): Promise<{ id: string }> {
  const { authority } = await authorizeManager(tx, {
    managementSessionId: input.managementSessionId,
    permission: "person.manage",
  });
  requireAdminAuthority(authority);
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
        status: "pending",
        email,
        emailFolded: foldForUniqueness(email),
      })
      .returning({ id: persons.id });

    await setPersonAccessRoles(tx, { managementSessionId: input.managementSessionId, personId: row!.id, roleIds: input.roleIds, expectedRoleIds: [] });
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
  permission: Permission | (string & {}),
): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName, role: roles })
    .from(persons)
    .leftJoin(personRoles, eq(personRoles.personId, persons.id))
    .leftJoin(roles, eq(roles.id, personRoles.roleId))
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  const people = new Map<string, { displayName: string; roles: (typeof roles.$inferSelect)[] }>();
  for (const row of rows) {
    const person = people.get(row.personId) ?? { displayName: row.displayName, roles: [] };
    if (row.role !== null) person.roles.push(row.role);
    people.set(row.personId, person);
  }
  return [...people]
    .filter(([id, person]) => holds(authorityForRoles(id, person.roles), permission))
    .map(([personId, person]) => ({ personId, displayName: person.displayName }));
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
  roleIds: string[];
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
      status: persons.status,
      passwordHash: persons.passwordHash,
      totpSecret: persons.totpSecret,
    })
    .from(persons)
    .orderBy(persons.displayName);
  const memberships = await tx.select().from(personRoles);
  const roleIds = new Map<string, string[]>();
  for (const membership of memberships) {
    const held = roleIds.get(membership.personId) ?? [];
    held.push(membership.roleId);
    roleIds.set(membership.personId, held);
  }
  const result: PersonSummary[] = [];
  for (const r of rows)
    result.push({
      personId: r.personId,
      displayName: r.displayName,
      firstNames: r.firstNames,
      lastNames: r.lastNames,
      telephone: r.telephone,
      email: r.email,
      roleIds: roleIds.get(r.personId) ?? [],
      status: r.status as "pending" | "active" | "suspended",
      hasPassword: r.passwordHash !== null,
      hasTotp: r.totpSecret !== null,
    });
  return result;
}

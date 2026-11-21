import { openText, sealText, type KeyRing } from "@waitron/credentials";
import { insertSignInChallenge } from "./sign-in-challenges.js";
import { queueSecurityChangeMail } from "./security-change-mail.js";
import "./errors.js";
import {
  nowIso,
  persons,
  dashboardSessions,
  recordActivity,
  accountActions,
  webauthnCredentials,
  tillSessions,
  signInChallenges,
  recoveryCodes,
  withFoldedPersonChanges,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { and, eq, gt, isNull, lte, ne } from "drizzle-orm";
import { AppError, assertSupportedLocale } from "@waitron/shared";
import { checkedPersonTelephone } from "./person-telephone.js";
import { foldForUniqueness } from "./fold.js";
import { confirmEmailChangeByCode, queueAccountMail } from "./account-action.js";
import { passkeyProviderName } from "./passkey-providers.js";
import { requireFreshManagementSignIn } from "./fresh-sign-in.js";
import { resolveManagementSession } from "./management-session.js";
import {
  asPersonUniqueViolation,
  assertDisplayNameAvailable,
  assertEmailAvailable,
  normalizeAndValidateEmail,
} from "./staff.js";
import { assertPasswordLength, hashPasswordAsync, verifyPassword } from "./verify-password.js";
import { assertPinLength, hashPinAsync } from "./verify-pin.js";
import { verifyTotp } from "./totp.js";
import { generateTotpSecret, totpAuthUri } from "./totp.js";
import { consumeRecoveryCode, replaceRecoveryCodes } from "./mfa.js";
import { DUMMY, issueCheck, trustedVerdict, type SecretCheck } from "./secret-check.js";

import { assertUsableAdminRemains } from "./admin-anchor.js";

interface Owner {
  /** The dashboard cookie's value — the session's token, which this package hashes. */
  managementSessionId: string;
}
interface Credentials {
  totp?: string;
  keyRing: KeyRing;
}

/**
 * Checks `personId`'s current password. Opens no transaction, so a caller holding none leaves the
 * write lock free while the key is derived, and writes nothing. Pass the result to the change inside
 * the transaction, which trusts it only for the person its own session names; any code the person's
 * authenticator setup needs is checked there.
 */
export async function checkOwnPassword(
  db: Database,
  input: { personId: string; currentPassword?: string },
): Promise<SecretCheck> {
  const { personId } = input;
  const [person] = await db
    .select({ passwordHash: persons.passwordHash })
    .from(persons)
    .where(eq(persons.id, personId));
  const secret = input.currentPassword ?? "";
  const passwordHash = person?.passwordHash ?? null;
  if (passwordHash === null) {
    return issueCheck({ personId, secret, derivedAgainst: DUMMY, matches: false });
  }
  const matches = await verifyPassword(secret, passwordHash);
  return issueCheck({ personId, secret, derivedAgainst: passwordHash, matches });
}

async function ownSession(tx: Transaction, input: Owner) {
  const { sessionRowId, personId } = await resolveManagementSession(tx, input.managementSessionId);
  const [person] = await tx.select().from(persons).where(eq(persons.id, personId));
  if (person === undefined) throw new AppError("management_session.required", {});
  return { person, sessionRowId };
}

async function ownPerson(tx: Transaction, input: Owner) {
  return (await ownSession(tx, input)).person;
}

async function checkCurrentPassword(
  person: typeof persons.$inferSelect,
  input: { currentPassword?: string; checked?: SecretCheck },
): Promise<void> {
  if (person.passwordHash === null) throw new AppError("password.invalid", {});
  const secret = input.currentPassword ?? "";
  const matches =
    trustedVerdict(input.checked, person.id, secret, person.passwordHash) ??
    (await verifyPassword(secret, person.passwordHash));
  if (!matches) throw new AppError("password.invalid", {});
}

/**
 * Asks nothing of a person with no authenticator. Otherwise accepts their authenticator code, or
 * else consumes one of their recovery codes, in the order sign-in tries them.
 */
export async function requireEnrolledCode(
  tx: Transaction,
  person: Pick<typeof persons.$inferSelect, "id" | "totpSecret">,
  codes: { totp?: string; recoveryCode?: string },
  keyRing: KeyRing,
): Promise<void> {
  if (person.totpSecret === null) return;
  const secret = openText(keyRing, "totp", person.totpSecret);
  if (codes.totp !== undefined && secret !== null && verifyTotp(codes.totp, secret.value)) return;
  if (
    codes.recoveryCode !== undefined &&
    (await consumeRecoveryCode(tx, person.id, codes.recoveryCode))
  )
    return;
  throw new AppError("totp.invalid", {});
}

async function verifyCurrent(
  tx: Transaction,
  person: typeof persons.$inferSelect,
  credentials: Owner & Credentials,
): Promise<void> {
  await requireFreshManagementSignIn(tx, credentials.managementSessionId);
  // No recovery code here: these changes need the authenticator itself.
  await requireEnrolledCode(tx, person, { totp: credentials.totp }, credentials.keyRing);
}

/**
 * The signed-in person's password, and their authenticator or a recovery code when one is set up,
 * checked afresh for an action that needs a recent sign-in. Starts no session.
 */
export async function verifyOwnFreshSignIn(
  tx: Transaction,
  input: Owner &
    Credentials & { currentPassword?: string; recoveryCode?: string; checked?: SecretCheck },
): Promise<typeof persons.$inferSelect> {
  const person = await ownPerson(tx, input);
  await checkCurrentPassword(person, input);
  await requireEnrolledCode(
    tx,
    person,
    { totp: input.totp, recoveryCode: input.recoveryCode },
    input.keyRing,
  );
  return person;
}

/** Require the session’s confirmation window and, when enrolled, the authenticator code. */
export async function verifyOwnCredentials(
  tx: Transaction,
  input: Owner & Credentials,
): Promise<typeof persons.$inferSelect> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  return person;
}

const TOTP_ENROLLMENT_TTL_MS = 10 * 60 * 1000;

export async function beginOwnTotpEnrollment(
  tx: Transaction,
  input: Owner & Credentials,
): Promise<{ enrollmentId: string; secret: string; uri: string; expiresAt: string }> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  const secret = generateTotpSecret();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOTP_ENROLLMENT_TTL_MS).toISOString();
  await tx
    .delete(signInChallenges)
    .where(
      and(eq(signInChallenges.personId, person.id), eq(signInChallenges.kind, "totp_enrolment")),
    );
  const enrollmentId = await insertSignInChallenge(tx, {
    kind: "totp_enrolment",
    personId: person.id,
    encryptedSecret: sealText(input.keyRing, "totp", secret),
    lifetimeMs: TOTP_ENROLLMENT_TTL_MS,
    now,
  });
  return {
    enrollmentId,
    secret,
    uri: totpAuthUri(secret, person.email ?? person.displayName),
    expiresAt,
  };
}

export async function finishOwnTotpEnrollment(
  tx: Transaction,
  input: Owner & { enrollmentId: string; code: string; keyRing: KeyRing },
): Promise<{ codes: string[] }> {
  const person = await ownPerson(tx, input);
  const [enrollment] = await tx
    .select({ encryptedSecret: signInChallenges.encryptedSecret })
    .from(signInChallenges)
    .where(
      and(
        eq(signInChallenges.id, input.enrollmentId),
        eq(signInChallenges.kind, "totp_enrolment"),
        eq(signInChallenges.personId, person.id),
        gt(signInChallenges.expiresAt, new Date().toISOString()),
        // A later expiry was stamped before a backward clock step, and counts as passed.
        lte(
          signInChallenges.expiresAt,
          new Date(Date.now() + TOTP_ENROLLMENT_TTL_MS).toISOString(),
        ),
      ),
    );
  const secret =
    enrollment === undefined ? null : openText(input.keyRing, "totp", enrollment.encryptedSecret!);
  if (secret === null || !verifyTotp(input.code, secret.value))
    throw new AppError("totp.invalid", {});
  await tx
    .update(persons)
    .set(withFoldedPersonChanges({ totpSecret: enrollment!.encryptedSecret }))
    .where(eq(persons.id, person.id));
  await tx
    .delete(signInChallenges)
    .where(
      and(eq(signInChallenges.id, input.enrollmentId), eq(signInChallenges.kind, "totp_enrolment")),
    );
  const codes = await replaceRecoveryCodes(tx, person.id);
  await queueSecurityChangeMail(tx, { personId: person.id, change: "authenticator_set_up" });
  return { codes };
}

export async function regenerateOwnRecoveryCodes(
  tx: Transaction,
  input: Owner & Credentials,
): Promise<{ codes: string[] }> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  const codes = await replaceRecoveryCodes(tx, person.id);
  await queueSecurityChangeMail(tx, { personId: person.id, change: "recovery_codes_regenerated" });
  return { codes };
}

export async function disableOwnTotp(tx: Transaction, input: Owner & Credentials): Promise<void> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  await tx
    .update(persons)
    .set(withFoldedPersonChanges({ totpSecret: null }))
    .where(eq(persons.id, person.id));
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.personId, person.id));
  await tx
    .delete(signInChallenges)
    .where(
      and(eq(signInChallenges.personId, person.id), eq(signInChallenges.kind, "totp_enrolment")),
    );
  if (person.totpSecret !== null)
    await queueSecurityChangeMail(tx, { personId: person.id, change: "authenticator_removed" });
}

export async function unlinkOwnGoogle(tx: Transaction, input: Owner & Credentials): Promise<void> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  await tx
    .update(persons)
    .set(withFoldedPersonChanges({ googleSubject: null }))
    .where(eq(persons.id, person.id));
  await assertUsableAdminRemains(tx);
  if (person.googleSubject !== null)
    await queueSecurityChangeMail(tx, { personId: person.id, change: "google_disconnected" });
}

async function invalidateLinks(tx: Transaction, personId: string): Promise<void> {
  await tx
    .update(accountActions)
    .set({ usedAt: nowIso() })
    .where(and(eq(accountActions.personId, personId), isNull(accountActions.usedAt)));
}

export async function readPasskeys(tx: Transaction, personId: string) {
  const rows = await tx
    .select({
      id: webauthnCredentials.id,
      createdAt: webauthnCredentials.createdAt,
      lastUsedAt: webauthnCredentials.lastUsedAt,
      aaguid: webauthnCredentials.aaguid,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, personId))
    .orderBy(webauthnCredentials.createdAt, webauthnCredentials.id);
  return rows.map(({ aaguid, ...passkey }) => ({
    ...passkey,
    provider: passkeyProviderName(aaguid),
  }));
}

export async function readOwnProfile(tx: Transaction, input: Owner) {
  const person = await ownPerson(tx, input);
  const passkeys = await readPasskeys(tx, person.id);
  return {
    displayName: person.displayName,
    firstNames: person.firstNames,
    lastNames: person.lastNames,
    telephone: person.telephone,
    email: person.email,
    pendingEmail: person.pendingEmail,
    locale: person.locale,
    hasPassword: person.passwordHash !== null,
    hasTotp: person.totpSecret !== null,
    hasGoogle: person.googleSubject !== null,
    passkeys,
  };
}

export async function saveOwnProfile(
  tx: Transaction,
  input: Owner &
    Credentials & {
      displayName: string;
      firstNames?: string;
      lastNames?: string;
      telephone?: string | null;
      email: string;
      locale: string;
      queueEmailChange: boolean;
    },
): Promise<{ queued: boolean } | null> {
  const person = await ownPerson(tx, input);
  const displayName = input.displayName.trim();
  if (displayName === "") throw new AppError("profile.invalid", { field: "displayName" });
  const firstNames = input.firstNames?.trim() ?? person.firstNames;
  if (input.firstNames !== undefined && firstNames === "")
    throw new AppError("profile.invalid", { field: "firstNames" });
  const lastNames = input.lastNames?.trim() ?? person.lastNames;
  if (input.lastNames !== undefined && lastNames === "")
    throw new AppError("profile.invalid", { field: "lastNames" });
  const telephone = await checkedPersonTelephone(tx, input.telephone, person.telephone);
  const email = normalizeAndValidateEmail(input.email);
  const locale = assertSupportedLocale(input.locale);
  const changedEmail = email !== person.email;
  if (changedEmail) await verifyCurrent(tx, person, input);
  await assertDisplayNameAvailable(tx, displayName, person.id);
  await assertEmailAvailable(tx, email, person.id);
  try {
    await tx
      .update(persons)
      .set(
        withFoldedPersonChanges({
          displayName,
          displayNameFolded: foldForUniqueness(displayName),
          firstNames,
          lastNames,
          telephone,
          // Cleared together, always: a `pending_email` left with a stale folded value beside it
          // would be read by the index as a request nobody made.
          pendingEmail: changedEmail ? email : null,
          pendingEmailFolded: changedEmail ? foldForUniqueness(email) : null,
          locale,
        }),
      )
      .where(eq(persons.id, person.id));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName, email });
  }
  if (!changedEmail) {
    if (person.pendingEmail !== null) await invalidateLinks(tx, person.id);
    return null;
  }
  await invalidateLinks(tx, person.id);
  if (input.queueEmailChange)
    await queueAccountMail(tx, { personId: person.id, purpose: "email_change" });
  return { queued: input.queueEmailChange };
}

export async function confirmOwnEmailChange(
  tx: Transaction,
  input: Owner & { code: string; keyRing: KeyRing },
): Promise<string | null> {
  const person = await ownPerson(tx, input);
  const email = await confirmEmailChangeByCode(tx, {
    personId: person.id,
    code: input.code,
    keyRing: input.keyRing,
  });
  if (email !== null)
    await queueSecurityChangeMail(tx, { personId: person.id, change: "email_changed" });
  return email;
}

export async function changeOwnPin(
  tx: Transaction,
  input: Owner & Credentials & { pin: string },
): Promise<void> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  assertPinLength(input.pin);
  await tx
    .update(persons)
    .set(withFoldedPersonChanges({ pinHash: await hashPinAsync(input.pin) }))
    .where(eq(persons.id, person.id));
  await tx
    .update(tillSessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(tillSessions.personId, person.id), isNull(tillSessions.endedAt)));
}

export async function changeOwnPassword(
  tx: Transaction,
  input: Owner & Credentials & { password: string },
): Promise<void> {
  const { person, sessionRowId } = await ownSession(tx, input);
  await verifyCurrent(tx, person, input);
  assertPasswordLength(input.password);
  await tx
    .update(persons)
    .set(withFoldedPersonChanges({ passwordHash: await hashPasswordAsync(input.password) }))
    .where(eq(persons.id, person.id));
  await invalidateLinks(tx, person.id);
  const ended = await tx
    .delete(dashboardSessions)
    .where(
      and(
        eq(dashboardSessions.personId, person.id),
        ne(dashboardSessions.id, sessionRowId),
        isNull(dashboardSessions.endedAt),
      ),
    )
    .returning({ personId: dashboardSessions.personId });
  for (const row of ended)
    await recordActivity(tx, {
      kind: "dashboard.signed_out",
      subjectId: row.personId,
      personId: row.personId,
      data: { reason: "password_changed" },
    });
  await queueSecurityChangeMail(tx, { personId: person.id, change: "password_changed" });
}

export async function removeOwnPasskey(
  tx: Transaction,
  input: Owner & Credentials & { id: string },
): Promise<void> {
  const person = await ownPerson(tx, input);
  await verifyCurrent(tx, person, input);
  const removed = await tx
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, input.id), eq(webauthnCredentials.personId, person.id)))
    .returning({ id: webauthnCredentials.id });
  if (removed.length === 0) throw new AppError("passkey.not_registered", {});
  await assertUsableAdminRemains(tx);
  await queueSecurityChangeMail(tx, { personId: person.id, change: "passkey_removed" });
}

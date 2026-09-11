import "./errors.js";
import type { Transaction } from "@waitron/db";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { AppError, assertSupportedLocale } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { managementSessions } from "./schema/management-sessions.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import {
  confirmEmailChangeByCode,
  issueAccountAction,
  type IssuedAccountAction,
} from "./account-action.js";
import { webauthnCredentials } from "./schema/webauthn.js";
import { sessions } from "./schema/sessions.js";
import { resolveManagementSession } from "./management-session.js";
import {
  asPersonUniqueViolation,
  assertDisplayNameAvailable,
  assertEmailAvailable,
  normalizeAndValidateEmail,
} from "./staff.js";
import { assertPasswordLength, hashPassword, verifyPassword } from "./verify-password.js";
import { assertPinLength, hashPin } from "./verify-pin.js";
import { verifyTotp } from "./totp.js";
import { generateTotpSecret, totpAuthUri } from "./totp.js";
import { totpEnrollments } from "./schema/totp-enrollments.js";
import { recoveryCodes } from "./schema/recovery-codes.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  replaceRecoveryCodes,
  type TotpKeyRing,
} from "./mfa.js";

interface Owner {
  tenantId: string;
  managementSessionId: string;
}
interface Credentials {
  currentPassword?: string;
  totp?: string;
  keyRing?: TotpKeyRing;
}

async function ownPerson(tx: Transaction, input: Owner) {
  const [session] = await tx
    .select({ personId: managementSessions.personId })
    .from(managementSessions)
    .where(
      and(
        eq(managementSessions.id, input.managementSessionId),
        eq(managementSessions.tenantId, input.tenantId),
      ),
    );
  if (session === undefined) throw new AppError("management_session.required", {});
  // Serialize profile changes before touching session rows: a password change also ends other sessions.
  const [person] = await tx
    .select()
    .from(persons)
    .where(and(eq(persons.id, session.personId), eq(persons.tenantId, input.tenantId)))
    .for("update");
  if (person === undefined) throw new AppError("management_session.required", {});
  await resolveManagementSession(tx, input.managementSessionId);
  return person;
}

function verifyCurrent(person: typeof persons.$inferSelect, credentials: Credentials): void {
  if (
    person.passwordHash === null ||
    !verifyPassword(credentials.currentPassword ?? "", person.passwordHash)
  ) {
    throw new AppError("password.invalid", {});
  }
  if (
    person.totpSecret !== null &&
    (credentials.totp === undefined ||
      !verifyTotp(
        credentials.totp,
        decryptTotpSecret(person.totpSecret, credentials.keyRing)?.secret ?? "",
      ))
  ) {
    throw new AppError("totp.invalid", {});
  }
}

/** Resolve the signed-in person and require their current login factors before a sensitive change. */
export async function verifyOwnCredentials(
  tx: Transaction,
  input: Owner & Credentials,
): Promise<typeof persons.$inferSelect> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  return person;
}

export async function beginOwnTotpEnrollment(
  tx: Transaction,
  input: Owner & Credentials & { keyRing: TotpKeyRing },
): Promise<{ enrollmentId: string; secret: string; uri: string; expiresAt: string }> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  const secret = generateTotpSecret();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await tx
    .delete(totpEnrollments)
    .where(
      and(eq(totpEnrollments.tenantId, input.tenantId), eq(totpEnrollments.personId, person.id)),
    );
  const [row] = await tx
    .insert(totpEnrollments)
    .values({
      tenantId: input.tenantId,
      personId: person.id,
      encryptedSecret: encryptTotpSecret(secret, input.keyRing.current),
      expiresAt,
    })
    .returning({ id: totpEnrollments.id });
  return {
    enrollmentId: row!.id,
    secret,
    uri: totpAuthUri(secret, person.email ?? person.displayName),
    expiresAt,
  };
}

export async function finishOwnTotpEnrollment(
  tx: Transaction,
  input: Owner & { enrollmentId: string; code: string; keyRing: TotpKeyRing },
): Promise<{ codes: string[] }> {
  const person = await ownPerson(tx, input);
  const [enrollment] = await tx
    .select({ encryptedSecret: totpEnrollments.encryptedSecret })
    .from(totpEnrollments)
    .where(
      and(
        eq(totpEnrollments.id, input.enrollmentId),
        eq(totpEnrollments.tenantId, input.tenantId),
        eq(totpEnrollments.personId, person.id),
        gt(totpEnrollments.expiresAt, new Date().toISOString()),
      ),
    )
    .for("update");
  const secret =
    enrollment === undefined ? null : decryptTotpSecret(enrollment.encryptedSecret, input.keyRing);
  if (secret === null || !verifyTotp(input.code, secret.secret))
    throw new AppError("totp.invalid", {});
  await tx
    .update(persons)
    .set({ totpSecret: enrollment!.encryptedSecret })
    .where(and(eq(persons.id, person.id), eq(persons.tenantId, input.tenantId)));
  await tx
    .delete(totpEnrollments)
    .where(
      and(eq(totpEnrollments.tenantId, input.tenantId), eq(totpEnrollments.id, input.enrollmentId)),
    );
  return { codes: await replaceRecoveryCodes(tx, input.tenantId, person.id) };
}

export async function regenerateOwnRecoveryCodes(
  tx: Transaction,
  input: Owner & Credentials & { keyRing: TotpKeyRing },
): Promise<{ codes: string[] }> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  return { codes: await replaceRecoveryCodes(tx, input.tenantId, person.id) };
}

export async function disableOwnTotp(
  tx: Transaction,
  input: Owner & Credentials & { keyRing: TotpKeyRing },
): Promise<void> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  await tx
    .update(persons)
    .set({ totpSecret: null })
    .where(and(eq(persons.id, person.id), eq(persons.tenantId, input.tenantId)));
  await tx
    .delete(recoveryCodes)
    .where(and(eq(recoveryCodes.tenantId, input.tenantId), eq(recoveryCodes.personId, person.id)));
  await tx
    .delete(totpEnrollments)
    .where(
      and(eq(totpEnrollments.tenantId, input.tenantId), eq(totpEnrollments.personId, person.id)),
    );
}

export async function unlinkOwnGoogle(tx: Transaction, input: Owner & Credentials): Promise<void> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  await tx
    .update(persons)
    .set({ googleSubject: null })
    .where(and(eq(persons.id, person.id), eq(persons.tenantId, input.tenantId)));
}

async function invalidateLinks(tx: Transaction, tenantId: string, personId: string): Promise<void> {
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

export async function readOwnProfile(tx: Transaction, input: Owner) {
  const person = await ownPerson(tx, input);
  const passkeys = await tx
    .select({
      id: webauthnCredentials.id,
      name: webauthnCredentials.name,
      createdAt: webauthnCredentials.createdAt,
    })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.tenantId, input.tenantId),
        eq(webauthnCredentials.personId, person.id),
      ),
    )
    .orderBy(webauthnCredentials.createdAt, webauthnCredentials.id);
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
      emailCodeKey?: Buffer;
    },
): Promise<IssuedAccountAction | null> {
  const person = await ownPerson(tx, input);
  const displayName = input.displayName.trim();
  if (displayName === "") throw new AppError("profile.invalid", { field: "displayName" });
  const firstNames = input.firstNames?.trim() ?? person.firstNames;
  if (input.firstNames !== undefined && firstNames === "")
    throw new AppError("profile.invalid", { field: "firstNames" });
  const lastNames = input.lastNames?.trim() ?? person.lastNames;
  if (input.lastNames !== undefined && lastNames === "")
    throw new AppError("profile.invalid", { field: "lastNames" });
  const telephone =
    input.telephone === undefined ? person.telephone : input.telephone?.trim() || null;
  const email = normalizeAndValidateEmail(input.email);
  const locale = assertSupportedLocale(input.locale);
  const changedEmail = email !== person.email;
  if (changedEmail) verifyCurrent(person, input);
  await assertDisplayNameAvailable(tx, input.tenantId, displayName, person.id);
  await assertEmailAvailable(tx, input.tenantId, email, person.id);
  try {
    await tx
      .update(persons)
      .set({
        displayName,
        firstNames,
        lastNames,
        telephone,
        pendingEmail: changedEmail ? email : null,
        locale,
      })
      .where(and(eq(persons.id, person.id), eq(persons.tenantId, input.tenantId)));
  } catch (error) {
    asPersonUniqueViolation(error, { displayName, email });
  }
  if (!changedEmail) {
    if (person.pendingEmail !== null) await invalidateLinks(tx, input.tenantId, person.id);
    return null;
  }
  await invalidateLinks(tx, input.tenantId, person.id);
  return issueAccountAction(tx, {
    tenantId: input.tenantId,
    personId: person.id,
    purpose: "email_change",
    targetEmail: email,
    codeKey: input.emailCodeKey,
  });
}

export async function confirmOwnEmailChange(
  tx: Transaction,
  input: Owner & { code: string; codeKey: Buffer },
): Promise<string | null> {
  const person = await ownPerson(tx, input);
  const email = await confirmEmailChangeByCode(tx, {
    tenantId: input.tenantId,
    personId: person.id,
    code: input.code,
    codeKey: input.codeKey,
  });
  return email;
}

export async function changeOwnPin(
  tx: Transaction,
  input: Owner & Credentials & { pin: string },
): Promise<void> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  assertPinLength(input.pin);
  await tx
    .update(persons)
    .set({ pinHash: hashPin(input.pin) })
    .where(and(eq(persons.id, person.id), eq(persons.tenantId, input.tenantId)));
  await tx
    .update(sessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(sessions.tenantId, input.tenantId),
        eq(sessions.personId, person.id),
        isNull(sessions.endedAt),
      ),
    );
}

export async function changeOwnPassword(
  tx: Transaction,
  input: Owner & Credentials & { password: string },
): Promise<void> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  assertPasswordLength(input.password);
  await tx
    .update(persons)
    .set({ passwordHash: hashPassword(input.password) })
    .where(and(eq(persons.id, person.id), eq(persons.tenantId, input.tenantId)));
  await invalidateLinks(tx, input.tenantId, person.id);
  await tx
    .update(managementSessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(managementSessions.tenantId, input.tenantId),
        eq(managementSessions.personId, person.id),
        ne(managementSessions.id, input.managementSessionId),
        isNull(managementSessions.endedAt),
      ),
    );
}

export async function removeOwnPasskey(
  tx: Transaction,
  input: Owner & Credentials & { id: string },
): Promise<void> {
  const person = await ownPerson(tx, input);
  verifyCurrent(person, input);
  const removed = await tx
    .delete(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.id, input.id),
        eq(webauthnCredentials.tenantId, input.tenantId),
        eq(webauthnCredentials.personId, person.id),
      ),
    )
    .returning({ id: webauthnCredentials.id });
  if (removed.length === 0) throw new AppError("passkey.not_registered", {});
}

import "./errors.js";
import { deviceProfiles, devices } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { ModulePersonalData, PersonalDataFile } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { and, asc, eq, sql, type AnyColumn } from "drizzle-orm";
import { googleOidcStates } from "./schema/google-oidc-states.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";
import { deviceProfileAdmissionPersons } from "./schema/profile-admission.js";
import { recoveryCodes } from "./schema/recovery-codes.js";
import { sessions } from "./schema/sessions.js";
import { totpEnrollments } from "./schema/totp-enrollments.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { passkeyProviderName } from "./passkey-providers.js";
import { SECRET_HASH_PREFIX } from "./secret-hash.js";

/** True when the column holds a value; a secret's existence is tested in SQL so the secret itself
 * is never read. */
const isSet = (column: AnyColumn) =>
  sql<boolean>`${column} is not null`.mapWith((v: number) => v === 1);

/** The start of the `pin_hash` the configuration import writes for an imported person: a value no
 * PIN matches. */
export const DISABLED_IMPORT_PIN_PREFIX = "disabled-import:";

const jsonFile = (name: string, value: unknown): PersonalDataFile => ({
  name,
  content: `${JSON.stringify(value, null, 2)}\n`,
});

export const IDENTITY_PERSONAL_DATA: ModulePersonalData = {
  files: ["profile.json", "sign-in.json"],

  async prepare(tx: Transaction, { personId }) {
    const [person] = await tx
      .select({
        id: persons.id,
        displayName: persons.displayName,
        firstNames: persons.firstNames,
        lastNames: persons.lastNames,
        email: persons.email,
        pendingEmail: persons.pendingEmail,
        emailVerifiedAt: persons.emailVerifiedAt,
        telephone: persons.telephone,
        locale: persons.locale,
        role: persons.role,
        status: persons.status,
        createdAt: persons.createdAt,
        passkeyOfferedAt: persons.passkeyOfferedAt,
        // Only a value `hashSecret` wrote can match a PIN; placeholders such as the import's or the
        // mirror viewer's cannot.
        pinSet:
          sql<boolean>`${persons.pinHash} is not null and substr(${persons.pinHash}, 1, ${SECRET_HASH_PREFIX.length}) = ${SECRET_HASH_PREFIX}`.mapWith(
            (v: number) => v === 1,
          ),
        passwordSet: isSet(persons.passwordHash),
        twoFactorOn: isSet(persons.totpSecret),
        googleLinked: isSet(persons.googleSubject),
      })
      .from(persons)
      .where(eq(persons.id, personId));
    if (person === undefined) throw new AppError("person.not_found", { personId });

    const exceptions = await tx
      .select({
        deviceProfile: deviceProfiles.name,
        admitted: deviceProfileAdmissionPersons.admitted,
      })
      .from(deviceProfileAdmissionPersons)
      .innerJoin(
        deviceProfiles,
        eq(deviceProfiles.id, deviceProfileAdmissionPersons.deviceProfileId),
      )
      .where(eq(deviceProfileAdmissionPersons.personId, personId))
      .orderBy(asc(deviceProfiles.name), asc(deviceProfiles.id));

    const passkeys = await tx
      .select({
        name: webauthnCredentials.name,
        aaguid: webauthnCredentials.aaguid,
        createdAt: webauthnCredentials.createdAt,
        lastUsedAt: webauthnCredentials.lastUsedAt,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.personId, personId))
      .orderBy(asc(webauthnCredentials.createdAt), asc(webauthnCredentials.id));

    const [codes] = await tx
      .select({
        unused: sql<number>`count(*) - count(${recoveryCodes.usedAt})`.mapWith(Number),
        used: sql<number>`count(${recoveryCodes.usedAt})`.mapWith(Number),
      })
      .from(recoveryCodes)
      .where(eq(recoveryCodes.personId, personId));

    const dashboardSessions = await tx
      .select({
        openedAt: managementSessions.createdAt,
        lastSeenAt: managementSessions.lastSeenAt,
        endedAt: managementSessions.endedAt,
      })
      .from(managementSessions)
      .where(eq(managementSessions.personId, personId))
      .orderBy(asc(managementSessions.createdAt), asc(managementSessions.id));

    const deviceSessions = await tx
      .select({ device: devices.label, openedAt: sessions.openedAt, endedAt: sessions.endedAt })
      .from(sessions)
      .innerJoin(devices, eq(devices.id, sessions.deviceId))
      .where(eq(sessions.personId, personId))
      .orderBy(asc(sessions.openedAt), asc(sessions.id));

    const accountEmails = await tx
      .select({
        purpose: managementAccountActions.purpose,
        newEmail: managementAccountActions.targetEmail,
        createdAt: managementAccountActions.createdAt,
        expiresAt: managementAccountActions.expiresAt,
        usedAt: managementAccountActions.usedAt,
        codeExpiresAt: managementAccountActions.codeExpiresAt,
        codeAttempts: managementAccountActions.codeAttempts,
      })
      .from(managementAccountActions)
      .where(eq(managementAccountActions.personId, personId))
      .orderBy(asc(managementAccountActions.createdAt), asc(managementAccountActions.id));

    const twoFactorSetups = await tx
      .select({ startedAt: totpEnrollments.createdAt, expiresAt: totpEnrollments.expiresAt })
      .from(totpEnrollments)
      .where(eq(totpEnrollments.personId, personId))
      .orderBy(asc(totpEnrollments.createdAt), asc(totpEnrollments.id));

    const passkeySetups = await tx
      .select({ startedAt: webauthnChallenges.createdAt })
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.personId, personId))
      .orderBy(asc(webauthnChallenges.createdAt), asc(webauthnChallenges.id));

    const googleLinkSetups = await tx
      .select({ expiresAt: googleOidcStates.expiresAt })
      .from(googleOidcStates)
      .where(and(eq(googleOidcStates.personId, personId), eq(googleOidcStates.mode, "link")))
      .orderBy(asc(googleOidcStates.expiresAt), asc(googleOidcStates.id));

    return async () => [
      jsonFile("profile.json", {
        id: person.id,
        displayName: person.displayName,
        firstNames: person.firstNames,
        lastNames: person.lastNames,
        email: person.email,
        pendingEmail: person.pendingEmail,
        emailVerifiedAt: person.emailVerifiedAt,
        telephone: person.telephone,
        locale: person.locale,
        role: person.role,
        status: person.status,
        createdAt: person.createdAt,
        deviceProfileExceptions: exceptions,
      }),
      jsonFile("sign-in.json", {
        pinSet: person.pinSet,
        passwordSet: person.passwordSet,
        twoFactorOn: person.twoFactorOn,
        googleLinked: person.googleLinked,
        passkeyOfferedAt: person.passkeyOfferedAt,
        passkeys: passkeys.map(({ name, aaguid, createdAt, lastUsedAt }) => ({
          name,
          provider: passkeyProviderName(aaguid),
          createdAt,
          lastUsedAt,
        })),
        recoveryCodes: { unused: codes!.unused, used: codes!.used },
        dashboardSessions,
        deviceSessions,
        accountEmails,
        unfinishedSetups: [
          ...twoFactorSetups.map((s) => ({ kind: "two-factor", ...s })),
          ...passkeySetups.map((s) => ({ kind: "passkey", ...s, expiresAt: null })),
          ...googleLinkSetups.map((s) => ({ kind: "google-link", startedAt: null, ...s })),
        ],
      }),
    ];
  },
};

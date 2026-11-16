import "./errors.js";
import {
  devices,
  googleOidcStates,
  accountActions,
  dashboardSessions,
  persons,
  roles,
  personRoles,
  recoveryCodes,
  tillSessions,
  totpEnrollments,
  webauthnChallenges,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { jsonFile, type ModulePersonalData } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { and, asc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { readPasskeys } from "./profile.js";
import { SECRET_HASH_PREFIX } from "./secret-hash.js";

/** The engine answers a condition as 1 or 0. */
const truth = (condition: SQL) => sql<boolean>`${condition}`.mapWith((v: number) => v === 1);

/** True when the column holds a value; a secret's existence is tested in SQL so the secret itself
 * is never read. */
const isSet = (column: AnyColumn) => truth(sql`${column} is not null`);

export const IDENTITY_PERSONAL_DATA: ModulePersonalData = {
  files: ["profile.json", "sign-in.json"],

  async prepare(tx: Transaction, { personId }) {
    const [person] = await tx
      .select({
        profile: {
          id: persons.id,
          displayName: persons.displayName,
          firstNames: persons.firstNames,
          lastNames: persons.lastNames,
          email: persons.email,
          pendingEmail: persons.pendingEmail,
          emailVerifiedAt: persons.emailVerifiedAt,
          telephone: persons.telephone,
          locale: persons.locale,
          status: persons.status,
          createdAt: persons.createdAt,
        },
        signIn: {
          pinSet: truth(
            sql`${persons.pinHash} is not null and substr(${persons.pinHash}, 1, ${SECRET_HASH_PREFIX.length}) = ${SECRET_HASH_PREFIX}`,
          ),
          passwordSet: isSet(persons.passwordHash),
          twoFactorOn: isSet(persons.totpSecret),
          googleLinked: isSet(persons.googleSubject),
          passkeyOfferedAt: persons.passkeyOfferedAt,
        },
      })
      .from(persons)
      .where(eq(persons.id, personId));
    if (person === undefined) throw new AppError("person.not_found", { personId });

    const accessRoles = await tx
      .select({ builtInKey: roles.builtInKey, name: roles.name })
      .from(personRoles)
      .innerJoin(roles, eq(roles.id, personRoles.roleId))
      .where(eq(personRoles.personId, personId))
      .orderBy(roles.builtInKey, roles.name);
    const passkeys = await readPasskeys(tx, personId);

    const [codes] = await tx
      .select({
        unused: sql<number>`count(*) - count(${recoveryCodes.usedAt})`.mapWith(Number),
        used: sql<number>`count(${recoveryCodes.usedAt})`.mapWith(Number),
      })
      .from(recoveryCodes)
      .where(eq(recoveryCodes.personId, personId));

    const dashboardSessionRows = await tx
      .select({
        openedAt: dashboardSessions.createdAt,
        lastSeenAt: dashboardSessions.lastSeenAt,
        endedAt: dashboardSessions.endedAt,
        provedAt: dashboardSessions.provedAt,
        proofMethod: dashboardSessions.proofMethod,
      })
      .from(dashboardSessions)
      .where(eq(dashboardSessions.personId, personId))
      .orderBy(asc(dashboardSessions.createdAt), asc(dashboardSessions.id));

    const deviceSessions = await tx
      .select({ device: devices.label, openedAt: tillSessions.openedAt, endedAt: tillSessions.endedAt })
      .from(tillSessions)
      .innerJoin(devices, eq(devices.id, tillSessions.deviceId))
      .where(eq(tillSessions.personId, personId))
      .orderBy(asc(tillSessions.openedAt), asc(tillSessions.id));

    const accountEmails = await tx
      .select({
        purpose: accountActions.purpose,
        newEmail: accountActions.targetEmail,
        createdAt: accountActions.createdAt,
        expiresAt: accountActions.expiresAt,
        usedAt: accountActions.usedAt,
        codeExpiresAt: accountActions.codeExpiresAt,
        codeAttempts: accountActions.codeAttempts,
      })
      .from(accountActions)
      .where(eq(accountActions.personId, personId))
      .orderBy(asc(accountActions.createdAt), asc(accountActions.id));

    const twoFactorSetups = await tx
      .select({ startedAt: totpEnrollments.createdAt, expiresAt: totpEnrollments.expiresAt })
      .from(totpEnrollments)
      .where(eq(totpEnrollments.personId, personId))
      .orderBy(asc(totpEnrollments.createdAt), asc(totpEnrollments.id));

    const passkeySetups = await tx
      .select({ startedAt: webauthnChallenges.createdAt })
      .from(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.personId, personId),
          eq(webauthnChallenges.purpose, "registration"),
        ),
      )
      .orderBy(asc(webauthnChallenges.createdAt), asc(webauthnChallenges.id));

    const googleLinkSetups = await tx
      .select({ expiresAt: googleOidcStates.expiresAt })
      .from(googleOidcStates)
      .where(and(eq(googleOidcStates.personId, personId), eq(googleOidcStates.mode, "link")))
      .orderBy(asc(googleOidcStates.expiresAt), asc(googleOidcStates.id));

    return async () => [
      jsonFile("profile.json", {
        ...person.profile,
        accessRoles: accessRoles.map((role) => role.builtInKey ?? role.name!),
      }),
      jsonFile("sign-in.json", {
        ...person.signIn,
        passkeys: passkeys.map(({ name, provider, createdAt, lastUsedAt }) => ({
          name,
          provider,
          createdAt,
          lastUsedAt,
        })),
        recoveryCodes: codes,
        dashboardSessions: dashboardSessionRows,
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

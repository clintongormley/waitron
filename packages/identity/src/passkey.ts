import "./errors.js";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AppError } from "@waitron/shared";
import { isUniqueViolation, nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { and, eq, sql } from "drizzle-orm";
import type { TotpKeyRing } from "./mfa.js";
import { requireEnrolledCode } from "./profile.js";
import { passkeyProviderName } from "./passkey-providers.js";
import { persons } from "./schema/persons.js";
import {
  webauthnChallenges,
  webauthnCredentials,
  type challengePurpose,
} from "./schema/webauthn.js";
import {
  resolveManagementSession,
  startManagementSession,
  type ManagementSession,
} from "./management-session.js";

/**
 * Passkey (WebAuthn) registration, discoverable login, and the signed-in person's check of their own
 * passkey. A challenge is accepted only by the ceremony that issued it. A passkey is always enrolled
 * against the person behind the management session, never a client-supplied id. The server only ever
 * holds the credential's public key, so there is no secret to hash. At login, a credential id with
 * no row answers `passkey.not_registered`, so the browser can be told to forget it; that says only
 * whether that credential id has a row. A row whose owner is not active answers
 * `passkey.verification_failed`, so the public login does not expose an account's state.
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type ChallengePurpose = (typeof challengePurpose.enumValues)[number];

/**
 * EdDSA (-8), ES256 (-7), RS256 (-257), given to both halves of registration so what the
 * authenticator is offered and what the server accepts are the same set. Stated rather than left to
 * @simplewebauthn/server 14, whose default is decided by the RUNNING runtime (it prepends ML-DSA-44
 * where the runtime supports it). Receipt: docs/developers/testing-guide.md, "A default you did not
 * state is not a value you tested".
 */
const SUPPORTED_ALGORITHM_IDS = [-8, -7, -257];

/** Returns `Uint8Array<ArrayBuffer>` to match the library's `userID` type — a bare `Uint8Array`
 * annotation widens to `ArrayBufferLike` and no longer assigns. */
function textToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * `verifyRegistrationResponse` copies `transports` verbatim from the client-supplied response, so at
 * runtime the value is whatever the client sent despite its `string[]` type. Store only a genuine
 * array, coercing any other runtime shape to null.
 */
function serializeTransports(transports: string[] | undefined): string | null {
  return Array.isArray(transports) ? JSON.stringify(transports) : null;
}

/** Every non-null value was written by `serializeTransports`, so it is a JSON array. */
function parseTransports(stored: string | null): string[] | undefined {
  return stored === null ? undefined : (JSON.parse(stored) as string[]);
}

/**
 * DELETE the challenge and return it in one statement, so once a finish has committed, another on the
 * same handle matches zero rows. A throw later in the finish rolls the caller's transaction back and
 * undoes this DELETE, so a failed or expired ceremony leaves the challenge to lapse by its TTL.
 *
 * Only a challenge issued for `purpose`, and to `personId` when one is given, matches; any other
 * answers as an unknown handle does.
 */
async function consumeChallenge(
  tx: Transaction,
  challengeHandle: string,
  expected: { purpose: ChallengePurpose; personId?: string },
): Promise<string> {
  const [challenge] = await tx
    .delete(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.id, challengeHandle),
        eq(webauthnChallenges.purpose, expected.purpose),
        expected.personId === undefined
          ? undefined
          : eq(webauthnChallenges.personId, expected.personId),
      ),
    )
    .returning({
      challenge: webauthnChallenges.challenge,
      createdAt: webauthnChallenges.createdAt,
    });
  if (challenge === undefined) throw new AppError("passkey.verification_failed", {});
  if (Date.now() - Date.parse(challenge.createdAt) > CHALLENGE_TTL_MS) {
    throw new AppError("passkey.challenge_expired", {});
  }
  return challenge.challenge;
}

/** WebAuthn's `user.name` is what a password manager lists the passkey under; the dashboard signs
 * in by email. */
function passkeyUser(person: { email: string | null; displayName: string }): {
  name: string;
  displayName: string;
} {
  return { name: person.email ?? person.displayName, displayName: person.displayName };
}

/**
 * The signed-in person's user handle as registration gave it, the id of every passkey they hold, and
 * the names registration would give a new passkey today.
 */
export async function readPasskeySignals(
  tx: Transaction,
  input: { managementSessionId: string },
): Promise<{ userId: string; credentialIds: string[]; name: string; displayName: string }> {
  const session = await resolveManagementSession(tx, input.managementSessionId, { touch: false });
  const { personId } = session;
  const rows = await tx
    .select({ credentialId: webauthnCredentials.credentialId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, personId));
  return {
    userId: b64url(textToBytes(personId)),
    credentialIds: rows.map((r) => r.credentialId),
    ...passkeyUser(session),
  };
}

export async function beginPasskeyRegistration(
  tx: Transaction,
  input: { managementSessionId: string; rpId: string; rpName: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const session = await resolveManagementSession(tx, input.managementSessionId);
  const { personId } = session;
  const user = passkeyUser(session);
  // Exclude the person's existing passkeys so the authenticator refuses to enroll a duplicate.
  const existing = await tx
    .select({
      credentialId: webauthnCredentials.credentialId,
      transports: webauthnCredentials.transports,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, personId));
  const options = await generateRegistrationOptions({
    rpID: input.rpId,
    rpName: input.rpName,
    userID: textToBytes(personId),
    userName: user.name,
    userDisplayName: user.displayName,
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    // The verify side requires the UV flag, so the authenticator must be told UV is required, not
    // 'preferred'. Supplying `authenticatorSelection` at all drops the library's `residentKey:
    // 'preferred'` default, so it is restated: this login is discoverable.
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    // What the authenticator is offered; `finishPasskeyRegistration` accepts the same list.
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
  });
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ personId, challenge: options.challenge, purpose: "registration" })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

export async function finishPasskeyRegistration(
  tx: Transaction,
  input: {
    managementSessionId: string;
    challengeHandle: string;
    response: RegistrationResponseJSON;
    name?: unknown;
    rpId: string;
    origin: string;
  },
): Promise<{ credentialId: string }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  if (
    input.name !== undefined &&
    (typeof input.name !== "string" || input.name.trim().length > 80)
  ) {
    throw new AppError("profile.invalid", { field: "passkeyName" });
  }
  const name = typeof input.name === "string" ? input.name.trim() || null : null;
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle, {
    purpose: "registration",
    personId,
  });
  // The library throws a GENERIC `Error` on a malformed or mismatched response, which would otherwise
  // become an opaque `server.internal` 500.
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      // Pinned rather than left to the library default, so a default flip cannot weaken enrolment.
      requireUserVerification: true,
      // Must be what beginPasskeyRegistration offered. Unpinned, the library uses its runtime-decided
      // list, and a credential whose key declares an algorithm the options excluded verifies here.
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
  } catch {
    throw new AppError("passkey.verification_failed", {});
  }
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});
  const { credential: cred, aaguid } = verification.registrationInfo;
  try {
    await tx.insert(webauthnCredentials).values({
      personId,
      credentialId: cred.id,
      name: name ?? passkeyProviderName(aaguid),
      aaguid,
      publicKey: b64url(cred.publicKey),
      counter: cred.counter,
      transports: serializeTransports(cred.transports),
    });
  } catch (error) {
    // The only unique key this INSERT can violate is `credential_id` — `id` is a random-uuid PK — so
    // `isUniqueViolation` alone identifies an already-enrolled credential.
    if (isUniqueViolation(error)) throw new AppError("passkey.already_registered", {});
    throw error;
  }
  return { credentialId: cred.id };
}

/**
 * A DISCOVERABLE (usernameless) login — no `allowCredentials`, so the person is resolved from the
 * returned credential on finish, and the stored challenge carries a null `personId`.
 */
export async function beginPasskeyAuthentication(
  tx: Transaction,
  input: { rpId: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  // The library default 'preferred' would let a device assert without UV and then fail verify.
  const options = await generateAuthenticationOptions({
    rpID: input.rpId,
    userVerification: "required",
  });
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ challenge: options.challenge, purpose: "login" })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

export async function finishPasskeyAuthentication(
  tx: Transaction,
  input: {
    challengeHandle: string;
    response: AuthenticationResponseJSON;
    rpId: string;
    origin: string;
  },
): Promise<ManagementSession> {
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle, { purpose: "login" });
  // The credential id is untrusted request input: typed `string`, but at runtime it may be missing or
  // non-string. A non-string names no credential.
  if (typeof input.response?.id !== "string") throw new AppError("passkey.not_registered", {});

  // The inner join cannot drop a matched credential: `person_id` is a FK to `persons`.
  const [cred] = await tx
    .select({
      id: webauthnCredentials.id,
      personId: webauthnCredentials.personId,
      credentialId: webauthnCredentials.credentialId,
      publicKey: webauthnCredentials.publicKey,
      counter: webauthnCredentials.counter,
      status: persons.status,
    })
    .from(webauthnCredentials)
    .innerJoin(persons, eq(persons.id, webauthnCredentials.personId))
    .where(eq(webauthnCredentials.credentialId, input.response.id));
  if (cred === undefined) throw new AppError("passkey.not_registered", {});
  // This public endpoint must not reveal that the returned credential belongs to a suspended or
  // pending account. No session is minted for any non-active owner.
  if (cred.status !== "active") throw new AppError("passkey.verification_failed", {});

  // The library throws a GENERIC `Error` on a malformed or mismatched assertion, which would otherwise
  // become an opaque `server.internal` 500.
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      // Pinned rather than left to the library default, so a default flip cannot weaken this login.
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
      },
    });
  } catch {
    throw new AppError("passkey.verification_failed", {});
  }
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});

  // Never LOWER the counter: a regressed counter would blind the cloned-authenticator check on later
  // assertions. The sign-in time is recorded whether or not the counter moves: an authenticator
  // without a signature counter reports 0 every time.
  const { newCounter } = verification.authenticationInfo;
  await tx
    .update(webauthnCredentials)
    .set({ counter: sql`max(${webauthnCredentials.counter}, ${newCounter})`, lastUsedAt: nowIso() })
    .where(eq(webauthnCredentials.id, cred.id));
  return startManagementSession(tx, { personId: cred.personId });
}

/**
 * A check of the signed-in person's own passkey, for an action that needs a recent sign-in. The
 * challenge is bound to that person and offers only their passkeys.
 */
export async function beginOwnPasskeyCheck(
  tx: Transaction,
  input: { managementSessionId: string; rpId: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const owned = await tx
    .select({
      credentialId: webauthnCredentials.credentialId,
      transports: webauthnCredentials.transports,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, personId));
  if (owned.length === 0) throw new AppError("passkey.not_registered", {});
  const options = await generateAuthenticationOptions({
    rpID: input.rpId,
    userVerification: "required",
    allowCredentials: owned.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
  });
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ personId, challenge: options.challenge, purpose: "check" })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

/**
 * Verifies an assertion from one of the signed-in person's own passkeys against a challenge bound
 * to that person, then their authenticator or recovery code when one is set up. Starts no session.
 */
export async function verifyOwnPasskey(
  tx: Transaction,
  input: {
    managementSessionId: string;
    challengeHandle: string;
    response: AuthenticationResponseJSON;
    rpId: string;
    origin: string;
    totp?: string;
    recoveryCode?: string;
    keyRing: TotpKeyRing;
  },
): Promise<void> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle, {
    purpose: "check",
    personId,
  });
  if (input.response == null) throw new AppError("passkey.verification_failed", {});

  const [cred] = await tx
    .select({
      id: webauthnCredentials.id,
      credentialId: webauthnCredentials.credentialId,
      publicKey: webauthnCredentials.publicKey,
      counter: webauthnCredentials.counter,
    })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.credentialId, input.response.id),
        eq(webauthnCredentials.personId, personId),
      ),
    );
  if (cred === undefined) throw new AppError("passkey.verification_failed", {});

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      requireUserVerification: true,
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
      },
    });
  } catch {
    throw new AppError("passkey.verification_failed", {});
  }
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});

  const { newCounter } = verification.authenticationInfo;
  await tx
    .update(webauthnCredentials)
    .set({ counter: sql`max(${webauthnCredentials.counter}, ${newCounter})`, lastUsedAt: nowIso() })
    .where(eq(webauthnCredentials.id, cred.id));

  const [person] = await tx
    .select({ id: persons.id, totpSecret: persons.totpSecret })
    .from(persons)
    .where(eq(persons.id, personId));
  await requireEnrolledCode(
    tx,
    person!,
    { totp: input.totp, recoveryCode: input.recoveryCode },
    input.keyRing,
  );
}

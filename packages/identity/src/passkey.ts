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
import { isUniqueViolation } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { and, eq, lt } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import {
  resolveManagementSession,
  startManagementSession,
  type ManagementSession,
} from "./management-session.js";

/**
 * Passkey (WebAuthn) registration and discoverable login. A passkey is always enrolled against the
 * person behind the management session, never a client-supplied id. The server only ever holds the
 * credential's public key, so there is no secret to hash. Unknown credentials and non-active owners
 * both return `passkey.verification_failed`, so this public endpoint does not expose whether the
 * credential exists or its owner's account state.
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

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
 */
async function consumeChallenge(tx: Transaction, challengeHandle: string): Promise<string> {
  const [challenge] = await tx
    .delete(webauthnChallenges)
    .where(eq(webauthnChallenges.id, challengeHandle))
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

export async function beginPasskeyRegistration(
  tx: Transaction,
  input: { managementSessionId: string; rpId: string; rpName: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const [person] = await tx
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId));
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
    userName: person!.displayName,
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
    .values({ personId, challenge: options.challenge })
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
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle);
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
  const cred = verification.registrationInfo.credential;
  try {
    await tx.insert(webauthnCredentials).values({
      personId,
      credentialId: cred.id,
      name,
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
    .values({ challenge: options.challenge })
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
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle);
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
  if (cred === undefined) throw new AppError("passkey.verification_failed", {});
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
  // assertions.
  const { newCounter } = verification.authenticationInfo;
  await tx
    .update(webauthnCredentials)
    .set({ counter: newCounter })
    .where(and(eq(webauthnCredentials.id, cred.id), lt(webauthnCredentials.counter, newCounter)));
  return startManagementSession(tx, { personId: cred.personId });
}

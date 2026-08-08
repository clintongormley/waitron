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
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import {
  resolveManagementSession,
  startManagementSession,
  type ManagementSession,
} from "./management-session.js";

/**
 * The passkey (WebAuthn) REGISTRATION ceremony, in two halves the browser drives in turn:
 * `beginPasskeyRegistration` issues the options the authenticator signs, and stores the challenge;
 * `finishPasskeyRegistration` verifies the signed response against that stored challenge and persists
 * the resulting credential. The person is resolved from the management session (slice 1a) on both
 * calls, so a passkey is always enrolled against the signed-in operator, never a client-supplied id.
 *
 * WebAuthn hands the server only the PUBLIC key and a signature counter — never a private key, which
 * never leaves the authenticator. So there is no secret to hash or vault here (unlike a PIN or
 * password): `public_key` is stored base64url and `counter` is stored to detect a cloned
 * authenticator on later assertions.
 *
 * The authentication half — `beginPasskeyAuthentication` / `finishPasskeyAuthentication` — is the
 * passkey branch of the verifier seam: a discoverable (usernameless) login whose signed assertion,
 * once verified, resolves the person from the returned credential and ends in a management session,
 * as `loginManager` does for password (+ TOTP). Like `loginManager` it ALSO gates on suspension:
 * `finishPasskeyAuthentication` reads `persons.status` alongside the credential and throws
 * `person.suspended` BEFORE minting the session, so a person suspended AFTER enrolling a passkey
 * cannot sign back in. Unlike `loginManager` it never throws `person.not_found` — the person is
 * resolved FROM the credential, so a returned id matching no credential is `passkey.not_registered`,
 * not a missing person. All three `passkey.*` codes are thrown across the two halves;
 * `passkey.not_registered` is the one the authentication half adds.
 */

/** How long a challenge issued by `beginPasskeyRegistration` stays valid. WebAuthn ceremonies are
 * interactive and brief; a stored challenge older than this is discarded rather than honoured. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** The WebAuthn spec keys `userID` on an opaque byte string; we use the person's uuid as its text.
 * Returns `Uint8Array<ArrayBuffer>` (what `TextEncoder.encode` produces) to match v13's `userID`
 * type — a bare `Uint8Array` annotation widens to `ArrayBufferLike` and no longer assigns. */
function textToBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

/** The COSE public key the authenticator returns is raw bytes; the `public_key` column is text. */
function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Begin registering a passkey for the person behind `managementSessionId`. Issues the creation
 * options the browser passes to `navigator.credentials.create(...)`, and stores the ceremony's
 * challenge so `finishPasskeyRegistration` can verify the signed response against it. Returns the
 * stored challenge's id as an opaque handle the browser echoes back on finish.
 */
export async function beginPasskeyRegistration(
  tx: Transaction,
  input: { managementSessionId: string; tenantId: string; rpId: string; rpName: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const [person] = await tx
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId));
  // Exclude the person's existing passkeys so the authenticator refuses to enroll a duplicate.
  const existing = await tx
    .select({ credentialId: webauthnCredentials.credentialId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, personId));
  const options = await generateRegistrationOptions({
    rpID: input.rpId,
    rpName: input.rpName,
    userID: textToBytes(personId), // Uint8Array (v10+)
    userName: person!.displayName,
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
  });
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ tenantId: input.tenantId, personId, challenge: options.challenge })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

/**
 * Finish registering a passkey: look up the stored challenge, reject it if unknown or older than
 * `CHALLENGE_TTL_MS`, verify the signed response with `@simplewebauthn/server`, and — only on success
 * — consume the challenge and persist the credential in the SAME transaction, so the two commit
 * together or not at all. That atomic delete is the single-use guarantee: a challenge can produce at
 * most one credential.
 *
 * A failed or expired ceremony throws, which rolls the caller's transaction (`withTenant`) back, so a
 * challenge is NOT deleted eagerly on those paths — a delete on a throwing path would roll back with
 * it, achieving nothing. The challenge instead survives until its TTL lapses (a later finish then
 * returns `passkey.challenge_expired`); bounding stale challenges by time rather than sweeping them
 * here is a deliberate consequence of finish running inside the caller's transaction.
 */
export async function finishPasskeyRegistration(
  tx: Transaction,
  input: {
    managementSessionId: string;
    tenantId: string;
    challengeHandle: string;
    response: RegistrationResponseJSON;
    rpId: string;
    origin: string;
  },
): Promise<{ credentialId: string }> {
  const { personId } = await resolveManagementSession(tx, input.managementSessionId);
  const [challenge] = await tx
    .select({
      challenge: webauthnChallenges.challenge,
      createdAt: webauthnChallenges.createdAt,
    })
    .from(webauthnChallenges)
    .where(eq(webauthnChallenges.id, input.challengeHandle));
  if (challenge === undefined) throw new AppError("passkey.verification_failed", {});
  if (Date.now() - Date.parse(challenge.createdAt) > CHALLENGE_TTL_MS) {
    throw new AppError("passkey.challenge_expired", {});
  }
  // `@simplewebauthn/server` throws a GENERIC `Error` on a malformed/mismatched response (a
  // missing/non-base64url credential id, wrong origin/RPID, a bad attestation) — never a mapped
  // `passkey.*` code — so a bare call would reach `run` as a non-AppError and become an opaque
  // `server.internal` 500. Wrap it: any throw becomes `passkey.verification_failed`, a clean 401. A
  // `verified:false` RETURN is the other failure shape and is handled just below.
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
    });
  } catch {
    throw new AppError("passkey.verification_failed", {});
  }
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});
  const cred = verification.registrationInfo.credential; // { id, publicKey, counter } — v13 WebAuthnCredential
  // Single-use: consume the challenge atomically with the credential insert (both commit or neither).
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle));
  await tx.insert(webauthnCredentials).values({
    tenantId: input.tenantId,
    personId,
    credentialId: cred.id,
    publicKey: b64url(cred.publicKey),
    counter: cred.counter,
  });
  return { credentialId: cred.id };
}

/**
 * Begin authenticating with a passkey. Issues the request options the browser passes to
 * `navigator.credentials.get(...)` and stores the ceremony's challenge so
 * `finishPasskeyAuthentication` can verify the returned assertion against it. This is a DISCOVERABLE
 * (usernameless) login — no `allowCredentials`, so the authenticator offers whichever passkey the
 * user picks and the person is resolved from the returned credential on finish, not known now. The
 * stored challenge therefore carries a null `personId`.
 */
export async function beginPasskeyAuthentication(
  tx: Transaction,
  input: { tenantId: string; rpId: string },
): Promise<{ challengeHandle: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const options = await generateAuthenticationOptions({ rpID: input.rpId }); // discoverable: no allowCredentials
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ tenantId: input.tenantId, challenge: options.challenge }) // personId null: person unknown until finish
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

/**
 * Finish authenticating with a passkey — the passkey branch of the verifier seam. Look up the stored
 * challenge (reject it if unknown or older than `CHALLENGE_TTL_MS`), resolve the credential by the id
 * the authenticator returned, verify the signed assertion with `@simplewebauthn/server`, and — only
 * on success — consume the challenge, bump the stored signature counter, and open a management session
 * for the credential's owner. Like `loginManager`, a successful ceremony ends in
 * `startManagementSession`; the challenge delete, the counter bump and the session insert all run in
 * the caller's SINGLE transaction, so they commit together or not at all.
 *
 * A failed or expired ceremony throws, which rolls that transaction back — so nothing is deleted
 * eagerly on those paths (a delete on a throwing path would roll back with the throw, achieving
 * nothing, exactly as in `finishPasskeyRegistration`; a challenge is bounded by its TTL instead). An
 * unknown challenge and an unrecognised credential both short-circuit before the verifier is reached.
 * The counter is advanced to the library's `newCounter` to detect a cloned authenticator replaying an
 * old assertion.
 */
export async function finishPasskeyAuthentication(
  tx: Transaction,
  input: {
    tenantId: string;
    challengeHandle: string;
    response: AuthenticationResponseJSON;
    rpId: string;
    origin: string;
  },
): Promise<ManagementSession> {
  const [challenge] = await tx
    .select({
      challenge: webauthnChallenges.challenge,
      createdAt: webauthnChallenges.createdAt,
    })
    .from(webauthnChallenges)
    .where(eq(webauthnChallenges.id, input.challengeHandle));
  if (challenge === undefined) throw new AppError("passkey.verification_failed", {});
  if (Date.now() - Date.parse(challenge.createdAt) > CHALLENGE_TTL_MS) {
    throw new AppError("passkey.challenge_expired", {});
  }
  // The credential id the authenticator returned is untrusted request input: typed `string`, but the
  // route hands `response` through as `never`, so at runtime it may be missing or non-string — a value
  // that would reach the `credential_id` text column and could 500 in the driver. Screen it first; a
  // non-string names no credential, so it is `passkey.not_registered`, never a driver fault.
  if (typeof input.response?.id !== "string") throw new AppError("passkey.not_registered", {});

  // Resolve the credential the authenticator returned, joining the owning person for their status.
  // Tenant scoping is by RLS (withTenant), the same as the challenge lookup above; (tenant_id,
  // credential_id) is unique, so at most one matches. The inner join cannot drop a matched credential:
  // `person_id` is a FK to `persons`, so the owner always exists.
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
  // Refuse a person suspended AFTER enrolling this passkey, BEFORE minting a session — the same gate
  // `loginManager` applies to a password login, and the same `persons.status` re-read
  // `resolveManagementSession` runs on every authenticated request. Placed before the verifier,
  // mirroring `loginManager`, which checks suspension before verifying the password.
  if (cred.status === "suspended") {
    throw new AppError("person.suspended", { personId: cred.personId });
  }

  // `@simplewebauthn/server` throws a GENERIC `Error` on a malformed/mismatched assertion (a bad
  // signature, wrong origin/RPID, UV not performed) — never a mapped `passkey.*` code — so a bare call
  // would reach `run` as a non-AppError and become an opaque `server.internal` 500. Wrap it: any throw
  // becomes `passkey.verification_failed`, a clean 401. A `verified:false` RETURN is handled after the
  // challenge delete below.
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      // WebAuthnCredential: the stored public key is base64url text, decoded back to bytes here.
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
      },
    });
  } catch {
    throw new AppError("passkey.verification_failed", {});
  }
  // Single-use: consume the challenge atomically with the counter bump and the session insert below
  // (all commit or none). On a failed assertion the throw rolls this delete back with them.
  await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, input.challengeHandle));
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});

  await tx
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(webauthnCredentials.id, cred.id));
  // Verifier seam: like loginManager, a successful passkey ends in a management session.
  return startManagementSession(tx, { tenantId: input.tenantId, personId: cred.personId });
}

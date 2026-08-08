import "./errors.js";
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { persons } from "./schema/persons.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { resolveManagementSession } from "./management-session.js";

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
 * The authentication half (verifying a passkey at login) is a later task; `passkey.not_registered`
 * is declared for it now, alongside the two codes this file throws.
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
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: input.origin,
    expectedRPID: input.rpId,
  });
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

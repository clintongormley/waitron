import "./errors.js";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
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
 * The authenticator's `transports` hint (an optional array like `["internal", "usb"]`) is stored as a
 * JSON array string in the nullable `transports` column and read back to seed a later ceremony's
 * `excludeCredentials`, so the authenticator can match an already-registered credential across its
 * transports. `verifyRegistrationResponse` copies `transports` VERBATIM from the client-supplied
 * response (`verifyRegistrationResponse.js:202`), so at runtime the value is whatever the client sent
 * and may not be the `AuthenticatorTransportFuture[]` its type claims — store only a genuine array,
 * coercing any other runtime shape to null.
 */
function serializeTransports(
  transports: AuthenticatorTransportFuture[] | undefined,
): string | null {
  return Array.isArray(transports) ? JSON.stringify(transports) : null;
}

/**
 * Parse a `transports` column back to the array `generateRegistrationOptions` expects on an
 * `excludeCredentials` descriptor. null — the authenticator reported none, or the row predates this
 * population — yields undefined; every non-null value was written by `serializeTransports`, so it is a
 * JSON array.
 */
function parseTransports(stored: string | null): AuthenticatorTransportFuture[] | undefined {
  return stored === null ? undefined : (JSON.parse(stored) as AuthenticatorTransportFuture[]);
}

/**
 * CONSUME a stored challenge by its handle: DELETE it and RETURN its challenge string in one
 * statement, enforcing single-use — under concurrency, not just sequentially. Returns the challenge
 * STRING both finish ceremonies pass to the verifier as `expectedChallenge`.
 *
 * The DELETE row-locks the challenge, so two finishes racing on the SAME handle serialise: the second
 * blocks on the first's lock, then — once the first commits — matches ZERO rows. Zero rows (already
 * consumed, or a handle that never existed) → `passkey.verification_failed`; a row older than
 * `CHALLENGE_TTL_MS` → `passkey.challenge_expired`. A plain read-then-delete let both racers read the
 * live challenge and proceed, which is the single-use hole this closes.
 *
 * Consume-on-SUCCESS is preserved by the enclosing `withTenant` transaction: on a verify failure, a
 * `verified:false` return, or a TTL throw, the WHOLE transaction rolls back and this DELETE is undone,
 * so the challenge survives to lapse by its TTL rather than being eagerly swept — the semantics both
 * finish functions and `passkey.challenge_expired`'s own doc describe.
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
  // Exclude the person's existing passkeys so the authenticator refuses to enroll a duplicate, each
  // carrying its stored transports (see `serializeTransports`) so the match holds across any transport.
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
    userID: textToBytes(personId), // Uint8Array (v10+)
    userName: person!.displayName,
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
    // A management passkey is a PHISHING-RESISTANT PRIMARY login, so user verification is MANDATORY, not
    // merely encouraged. The library default is `{ residentKey: 'preferred', userVerification:
    // 'preferred' }` (generateRegistrationOptions.js:39-40, @simplewebauthn/server@13.3.2); 'preferred'
    // lets a device skip UV yet the verify side rejects a response without the UV flag
    // (requireUserVerification defaults true), so the two must agree. `residentKey` is kept at the
    // library default 'preferred' — supplying `authenticatorSelection` at all drops that default
    // (it applies only when the whole object is absent), and this login is discoverable.
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ tenantId: input.tenantId, personId, challenge: options.challenge })
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

/**
 * Finish registering a passkey: CONSUME the stored challenge (a locking DELETE that rejects it if
 * unknown or older than `CHALLENGE_TTL_MS`), verify the signed response with `@simplewebauthn/server`,
 * and persist the credential — all in the SAME transaction, so consume + insert commit together or not
 * at all. Consuming BEFORE verify is the single-use guarantee: the DELETE row-locks the handle, so a
 * concurrent finish on the same handle blocks then finds zero rows, and a challenge produces at most
 * one credential even under contention.
 *
 * A failed or expired ceremony throws, which rolls the caller's transaction (`withTenant`) back —
 * undoing the consume-DELETE with it, so the challenge is NOT lost on those paths. It instead survives
 * until its TTL lapses (a later finish then returns `passkey.challenge_expired`); bounding stale
 * challenges by time rather than sweeping them here is a deliberate consequence of finish running
 * inside the caller's transaction. Consume-on-SUCCESS therefore still holds: only a committing
 * ceremony keeps the DELETE.
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
  // Consume the challenge up front: a locking DELETE that also enforces single-use (see
  // `consumeChallenge`). A verify failure below rolls the whole transaction back, undoing this delete.
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle);
  // `@simplewebauthn/server` throws a GENERIC `Error` on a malformed/mismatched response (a
  // missing/non-base64url credential id, wrong origin/RPID, a bad attestation) — never a mapped
  // `passkey.*` code — so a bare call would reach `run` as a non-AppError and become an opaque
  // `server.internal` 500. Wrap it: any throw becomes `passkey.verification_failed`, a clean 401. A
  // `verified:false` RETURN is the other failure shape and is handled just below.
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      // Pin UV explicitly rather than lean on the library default (true, verifyRegistrationResponse.js:35),
      // so a future default flip cannot silently weaken this primary-login enrollment. Matches the
      // `userVerification: "required"` asked of the authenticator in beginPasskeyRegistration.
      requireUserVerification: true,
    });
  } catch {
    throw new AppError("passkey.verification_failed", {});
  }
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});
  const cred = verification.registrationInfo.credential; // { id, publicKey, counter, transports? } — v13 WebAuthnCredential
  // The challenge was already consumed above (consumeChallenge); the insert commits alongside it. The
  // authenticator's transports are stored here (see `serializeTransports`) for a later ceremony.
  try {
    await tx.insert(webauthnCredentials).values({
      tenantId: input.tenantId,
      personId,
      credentialId: cred.id,
      publicKey: b64url(cred.publicKey),
      counter: cred.counter,
      transports: serializeTransports(cred.transports),
    });
  } catch (error) {
    // This credential is already enrolled for the tenant: the `(tenant_id, credential_id)` unique
    // constraint raises 23505. The only unique key this INSERT can violate is that composite one —
    // `id` is a random-uuid PK — so `isUniqueViolation` alone identifies it without a constraint-name
    // check. Translate it into a domain code (the register route maps → 409); a raw driver error would
    // otherwise reach `run` as an opaque `server.internal` 500. Anything else is a genuine failure:
    // rethrow so it is not masked.
    if (isUniqueViolation(error)) throw new AppError("passkey.already_registered", {});
    throw error;
  }
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
  // Discoverable (no allowCredentials) AND user-verifying: 'required' makes the authenticator perform UV
  // on this primary login, matching the verify side (requireUserVerification true). The library default
  // is 'preferred' (generateAuthenticationOptions.js:16, @simplewebauthn/server@13.3.2), which would let
  // a device assert without UV and then fail verify — so it is pinned here.
  const options = await generateAuthenticationOptions({
    rpID: input.rpId,
    userVerification: "required",
  });
  const [row] = await tx
    .insert(webauthnChallenges)
    .values({ tenantId: input.tenantId, challenge: options.challenge }) // personId null: person unknown until finish
    .returning({ id: webauthnChallenges.id });
  return { challengeHandle: row!.id, options };
}

/**
 * Finish authenticating with a passkey — the passkey branch of the verifier seam. CONSUME the stored
 * challenge (a locking DELETE that rejects it if unknown or older than `CHALLENGE_TTL_MS`), resolve
 * the credential by the id the authenticator returned, verify the signed assertion with
 * `@simplewebauthn/server`, bump the stored signature counter, and open a management session for the
 * credential's owner. Like `loginManager`, a successful ceremony ends in `startManagementSession`; the
 * consume-DELETE, the counter bump and the session insert all run in the caller's SINGLE transaction,
 * so they commit together or not at all.
 *
 * Consuming BEFORE verify is the single-use guarantee under concurrency: the DELETE row-locks the
 * handle, so two finishes racing on the same handle serialise and only one proceeds — the other blocks,
 * then finds zero rows → `passkey.verification_failed`. A failed or expired ceremony throws, rolling
 * the transaction back and undoing the consume-DELETE, so the challenge survives to lapse by its TTL
 * instead (consume-on-success, exactly as in `finishPasskeyRegistration`). An unknown challenge and an
 * unrecognised credential both short-circuit before the verifier is reached.
 *
 * The counter is advanced with a MONOTONIC guard (`counter < newCounter`) so a concurrent assertion
 * can never LOWER it, which would blind the cloned-authenticator defence: the library already rejects a
 * genuine replay (`newCounter <= stored`, stored > 0) before this point, and the guard is the second
 * belt for the concurrent case where two logins both read the old counter. A counter-0 authenticator
 * (no counter) stays at 0 — `0 < 0` is false, so the guard simply skips the no-op write.
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
  // Consume the challenge up front: a locking DELETE that also enforces single-use (see
  // `consumeChallenge`). Any throw below rolls the whole transaction back, undoing this delete.
  const expectedChallenge = await consumeChallenge(tx, input.challengeHandle);
  // The credential id the authenticator returned is untrusted request input: typed `string`, but the
  // route hands `response` through as `never`, so at runtime it may be missing or non-string — a value
  // that would reach the `credential_id` text column and could 500 in the driver. Screen it first; a
  // non-string names no credential, so it is `passkey.not_registered`, never a driver fault.
  if (typeof input.response?.id !== "string") throw new AppError("passkey.not_registered", {});

  // Resolve the credential the authenticator returned, joining the owning person for their status.
  // The database holds one tenant and (tenant_id, credential_id) is unique.
  // The inner join cannot drop a matched credential:
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
  // becomes `passkey.verification_failed`, a clean 401. A `verified:false` RETURN is the other failure
  // shape and is handled just below; both roll back the consume-DELETE, so the challenge survives.
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: input.origin,
      expectedRPID: input.rpId,
      // Pin UV explicitly rather than lean on the library default (true, verifyAuthenticationResponse.js:24),
      // matching the `userVerification: "required"` asked of the authenticator in beginPasskeyAuthentication.
      requireUserVerification: true,
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
  // The challenge was already consumed up front (consumeChallenge); a `verified:false` return here
  // rolls the whole transaction back, undoing that delete along with everything below.
  if (!verification.verified) throw new AppError("passkey.verification_failed", {});

  // Advance the signature counter, but NEVER lower it: the `counter < newCounter` guard makes a
  // concurrent assertion that read the old value unable to regress it, which would blind the
  // cloned-authenticator defence for later assertions. A counter-0 authenticator sends newCounter 0
  // and `0 < 0` is false, so the guard skips the no-op write and leaves the counter at 0 — correct.
  const { newCounter } = verification.authenticationInfo;
  await tx
    .update(webauthnCredentials)
    .set({ counter: newCounter })
    .where(and(eq(webauthnCredentials.id, cred.id), lt(webauthnCredentials.counter, newCounter)));
  // Verifier seam: like loginManager, a successful passkey ends in a management session.
  return startManagementSession(tx, { tenantId: input.tenantId, personId: cred.personId });
}

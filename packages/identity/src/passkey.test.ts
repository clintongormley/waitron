import {
  captureError,
  CORE_MIGRATIONS,
  NOT_NULL_VIOLATION,
  refusalOn,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { codeOf, openManagementSession, seedPerson } from "../test/fixtures.js";

// This suite tests the registration AND authentication LOGIC — options issued, challenge stored
// then consumed, credential persisted, counter bumped, person resolved.
//
// `generateRegistrationOptions` and `generateAuthenticationOptions` run FOR REAL (they just mint a
// random challenge); only the two VERIFY calls are mocked, because a genuine authenticator response
// cannot be synthesised in a unit test — so this suite asserts OUR wiring around them, not the crypto.
vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  CHALLENGE_TTL_MS,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
} from "./passkey.js";

const mockVerify = vi.mocked(verifyRegistrationResponse);
const mockVerifyAuth = vi.mocked(verifyAuthenticationResponse);

/** A fully-typed `verified: true` result — our code reads only `credential`, but the discriminated
 * union requires the rest, so building it in full keeps the mock honest against the library's shape.
 * The authenticator's `transports` hint is optional (an authenticator may omit it), so it is a
 * parameter: `undefined` mirrors an authenticator that reports none. */
function verified(
  id: string,
  transports?: string[],
): Awaited<ReturnType<typeof verifyRegistrationResponse>> {
  return {
    verified: true,
    registrationInfo: {
      fmt: "none",
      aaguid: "00000000-0000-0000-0000-000000000000",
      credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports },
      credentialType: "public-key",
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost",
    },
  };
}

/** A fully-typed `verified: true` auth result. Our code reads only `verified` and
 * `authenticationInfo.newCounter`, but `VerifiedAuthenticationResponse` is NOT a discriminated
 * union — `authenticationInfo` is required even when `verified` is false — so building it in full
 * keeps the mock honest against the real shape (and the failed case spreads this with `verified:
 * false`). */
function authVerified(
  newCounter: number,
): Awaited<ReturnType<typeof verifyAuthenticationResponse>> {
  return {
    verified: true,
    authenticationInfo: {
      credentialID: "cred-abc",
      newCounter,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost",
      rpID: "localhost",
    },
  };
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

const begin = (token: string) =>
  run((tx) =>
    beginPasskeyRegistration(tx, {
      managementSessionId: token,
      rpId: "localhost",
      rpName: "Waitron",
    }),
  );

const finish = (token: string, challengeHandle: string, name?: unknown) =>
  run((tx) =>
    finishPasskeyRegistration(tx, {
      managementSessionId: token,
      challengeHandle,
      response: {} as never,
      name,
      rpId: "localhost",
      origin: "http://localhost",
    }),
  );

/** Insert a webauthn_credentials row directly (mirrors finishPasskeyRegistration's insert), for the
 * authentication suite which needs a credential on file WITHOUT running the registration ceremony.
 * Returns the row's uuid so a test can read the stored counter back. */
const seedCredential = (personId: string, credentialId: string, counter = 0) =>
  run(async (tx) => {
    const [row] = await tx
      .insert(webauthnCredentials)
      .values({ personId, credentialId, publicKey: "AQID", counter })
      .returning({ id: webauthnCredentials.id });
    return row!.id;
  });

beforeEach(() => {
  mockVerify.mockReset();
  mockVerifyAuth.mockReset();
});

// One database is shared across the suite (useVenueDb registers beforeAll, not beforeEach),
// so clear the passkey rows between tests to keep them order-independent (CLAUDE.md §4). The credential
// id the mock returns is fixed, and `credential_id` is unique — without this a second test
// registering the same id would hit the unique constraint rather than exercise its own path.
afterEach(async () => {
  await run((tx) => tx.delete(webauthnCredentials));
  await run((tx) => tx.delete(webauthnChallenges));
});

describe("passkey registration", () => {
  it("issues options, stores a challenge, then persists the credential and consumes the challenge", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-abc"));

    const begun = await begin(token);
    expect(begun.challengeHandle).toBeTruthy();
    expect(begun.options.challenge).toBeTruthy();

    // The challenge is on file between begin and finish, scoped to this person.
    const stored = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.personId).toBe(personId);

    const done = await finish(token, begun.challengeHandle);
    expect(done.credentialId).toBe("cred-abc");

    // Credential row landed, with the public key base64url-encoded and the counter persisted.
    const creds = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.personId, personId)),
    );
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({
      credentialId: "cred-abc",
      publicKey: "AQID", // base64url of Uint8Array([1, 2, 3])
      counter: 0,
      // This ceremony's authenticator reported no transports (verified() with none), so the column
      // stays null rather than storing "[]" — the false branch of the transports population.
      transports: null,
    });

    // The challenge was single-use: finish deleted it.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(0);
  });

  it("pins userVerification to 'required' in the registration options (phishing-resistant primary login)", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await begin(token);
    // Tell the authenticator user verification is MANDATORY up front, matching the verify side which
    // rejects a response lacking the UV flag. The library default is 'preferred'
    // (generateRegistrationOptions.js:14-15 in @simplewebauthn/server@14.0.2), which lets a device skip
    // UV and yet still fail verify — so it is pinned explicitly. Drop the userVerification pin and this
    // reads 'preferred'. residentKey is asserted alongside because supplying `authenticatorSelection` at
    // all drops the library's `residentKey: 'preferred'` default (it merges nothing) — so dropping the
    // explicit re-spec would silently lose the discoverable-credential hint that the usernameless login
    // depends on, and without this assertion the suite would stay green through that regression.
    expect(begun.options.authenticatorSelection).toMatchObject({
      residentKey: "preferred",
      userVerification: "required",
    });
  });

  it("offers exactly the three signature algorithms the server pins, in that order", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await begin(token);
    // EdDSA (-8), ES256 (-7), RS256 (-257) — pinned by `supportedAlgorithmIDs` rather than left to
    // @simplewebauthn/server@14, which asks the running runtime what to offer and prepends ML-DSA-44
    // where Web Crypto reports it (generateRegistrationOptions.js:23-29). Delete the pin and this
    // assertion fails on Node 26.7.0 with a leading -48 — watched, that is how the pin was arrived at.
    // What the pin buys is that the answer no longer depends on which runtime served the request.
    expect(begun.options.pubKeyCredParams.map((p) => p.alg)).toEqual([-8, -7, -257]);
  });

  it.each([
    ["  Work laptop  ", "Work laptop"],
    ["   ", null],
    [undefined, null],
    ["x".repeat(80), "x".repeat(80)],
  ])("stores the optional passkey name %j", async (name, expected) => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-named"));
    const begun = await begin(token);
    await finish(token, begun.challengeHandle, name);
    const [credential] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.personId, personId)),
    );
    expect(credential).toHaveProperty("name", expected);
  });

  it.each(["x".repeat(81), 123, null])(
    "refuses an invalid passkey name %j before registering",
    async (name) => {
      const { token } = await openManagementSession(suite.db, "admin");
      mockVerify.mockResolvedValue(verified("cred-invalid-name"));
      const begun = await begin(token);
      await expect(finish(token, begun.challengeHandle, name)).rejects.toMatchObject({
        code: "profile.invalid",
        params: { field: "passkeyName" },
      });
      expect(mockVerify).not.toHaveBeenCalled();
    },
  );

  it("requires user verification on the registration verify (requireUserVerification: true)", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-abc"));
    const begun = await begin(token);
    await finish(token, begun.challengeHandle);
    // Pinned explicitly rather than leaning on the library default (true, verifyRegistrationResponse.js:36),
    // so a future default flip cannot silently drop the UV requirement on a primary login.
    expect(mockVerify.mock.calls[0]![0]).toMatchObject({ requireUserVerification: true });
  });

  it("passes its pinned algorithm list to the registration verifier", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-abc"));
    const begun = await begin(token);
    await finish(token, begun.challengeHandle);
    // The verify side has its own algorithm list and the library defaults it to the SAME
    // runtime-decided list the options side uses (verifyRegistrationResponse.js:36 defaults to the
    // `defaultSupportedAlgorithmIDs` that generateRegistrationOptions.js:28-29 puts ML-DSA-44 into).
    // Unpinned here, a response whose credential public key DECLARES an algorithm the options never
    // offered verifies — demonstrated against the real verifier, which checks that declared alg
    // against this list (verifyRegistrationResponse.js:137). Offer and accept must be the same set,
    // so the same list goes to both calls. The library is mocked in this suite, so what this asserts
    // is the argument; what it would catch is the pin being dropped.
    expect(mockVerify.mock.calls[0]![0]).toMatchObject({
      supportedAlgorithmIDs: [-8, -7, -257],
    });
  });

  it("excludes already-registered credentials from a second ceremony", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-existing"));

    const first = await begin(token);
    await finish(token, first.challengeHandle);

    const second = await begin(token);
    expect(second.options.excludeCredentials?.map((c) => c.id)).toContain("cred-existing");
  });

  it("persists the authenticator's transports as a JSON array string", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    // The authenticator reports its transports on registration; they are stored so a later ceremony
    // can hand them back as an excludeCredentials/allowCredentials hint (schema: webauthn.ts).
    mockVerify.mockResolvedValue(verified("cred-abc", ["internal", "usb"]));

    const begun = await begin(token);
    await finish(token, begun.challengeHandle);

    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.personId, personId)),
    );
    expect(cred!.transports).toBe(JSON.stringify(["internal", "usb"]));
  });

  it("stores null for a non-array transports value the untrusted client could forge", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    // `verifyRegistrationResponse` copies transports verbatim from the client, so at runtime it may be
    // a non-array despite its declared type. serializeTransports coerces anything but an array to null
    // (Array.isArray guard); drop that guard and this value would be stored as the string '"usb"'.
    mockVerify.mockResolvedValue(verified("cred-forged", "usb" as unknown as string[]));

    const begun = await begin(token);
    await finish(token, begun.challengeHandle);

    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.personId, personId)),
    );
    expect(cred!.transports).toBeNull();
  });

  it("hands an excluded credential's stored transports back as an excludeCredentials hint", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-hybrid", ["hybrid", "internal"]));

    // Register a credential whose transports are recorded, then begin a second ceremony: the stored
    // transports ride along on the excludeCredentials descriptor so the authenticator can match the
    // already-registered credential across its transports and refuse the duplicate.
    const first = await begin(token);
    await finish(token, first.challengeHandle);

    const second = await begin(token);
    const descriptor = second.options.excludeCredentials?.find((c) => c.id === "cred-hybrid");
    expect(descriptor?.transports).toEqual(["hybrid", "internal"]);
  });

  it("throws passkey.verification_failed when the ceremony does not verify", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue({ verified: false });

    const begun = await begin(token);
    expect(await codeOf(() => finish(token, begun.challengeHandle))).toBe(
      "passkey.verification_failed",
    );

    // No credential was persisted by the failed ceremony.
    const creds = await run((tx) => tx.select().from(webauthnCredentials));
    expect(creds).toHaveLength(0);
    // The throw rolls finish's transaction back, so the challenge (committed by begin) survives and
    // the user may retry within its TTL — it is consumed only on success.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
  });

  it("throws passkey.verification_failed when no challenge is on file for the handle", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    // A well-formed but unknown handle: nothing was ever stored under it.
    const code = await codeOf(() => finish(token, "00000000-0000-4000-8000-000000000000"));
    expect(code).toBe("passkey.verification_failed");
    // verify is never reached — the missing challenge short-circuits before it.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("throws passkey.challenge_expired once the challenge is older than CHALLENGE_TTL_MS", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await begin(token);
    // Age the challenge past the TTL via a raw update — deterministic, no clock injection, exactly as
    // management-session.test.ts ages last_seen_at.
    await run((tx) =>
      tx
        .update(webauthnChallenges)
        .set({ createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 60_000).toISOString() })
        .where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );

    expect(await codeOf(() => finish(token, begun.challengeHandle))).toBe(
      "passkey.challenge_expired",
    );
    // The TTL check short-circuits before the verifier is ever reached.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("maps a THROW from the library to passkey.verification_failed (not an opaque 500)", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    // `@simplewebauthn/server` throws a GENERIC Error on a malformed/mismatched response — not a mapped
    // `passkey.*` code. Unwrapped it would reach `run` as a non-AppError → opaque server.internal 500;
    // finishPasskeyRegistration must turn it into a clean passkey.verification_failed.
    mockVerify.mockRejectedValue(new Error("Unexpected authenticator response"));

    const begun = await begin(token);
    expect(await codeOf(() => finish(token, begun.challengeHandle))).toBe(
      "passkey.verification_failed",
    );

    // The throw rolled finish's transaction back: no credential landed, and the challenge survives for
    // a retry within its TTL — exactly the {verified:false} path's semantics.
    const creds = await run((tx) => tx.select().from(webauthnCredentials));
    expect(creds).toHaveLength(0);
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
  });

  it("rejects re-registering a credential already on file as passkey.already_registered (not an opaque 500)", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-dup"));

    // First ceremony persists the credential.
    const first = await begin(token);
    expect((await finish(token, first.challengeHandle)).credentialId).toBe("cred-dup");

    // A SECOND ceremony returning the SAME credential id collides on the `credential_id` unique
    // constraint: the insert raises 23505. Unwrapped it reaches
    // `run` as a non-AppError → opaque server.internal 500; finishPasskeyRegistration must translate
    // it into a clean passkey.already_registered (the register route maps that → 409).
    const second = await begin(token);
    expect(await codeOf(() => finish(token, second.challengeHandle))).toBe(
      "passkey.already_registered",
    );

    // The collision rolled the second finish's transaction back: still exactly one credential row —
    // the original survives and no partial second row landed.
    const creds = await run((tx) => tx.select().from(webauthnCredentials));
    expect(creds).toHaveLength(1);
    expect(creds[0]!.credentialId).toBe("cred-dup");
  });

  it("rethrows a non-unique insert failure untranslated, never masked as passkey.already_registered", async () => {
    // The negative control for the isUniqueViolation catch: a NON-unique insert failure must propagate
    // untranslated. A forged verifier result with no credential id violates the NOT NULL constraint,
    // so `isUniqueViolation` is false and the raw error is rethrown.
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified(null as never));
    const begun = await begin(token);

    const error = await captureError(() => finish(token, begun.challengeHandle));
    // `refusalOn` reads the engine's result code and the key it named off the RAW driver error; an
    // AppError carries neither, so this both proves the refusal is the NOT NULL on
    // `credential_id` AND that nothing translated it into an AppError.
    expect(
      refusalOn(error, NOT_NULL_VIOLATION, {
        table: "webauthn_credentials",
        columns: ["credential_id"],
      }),
    ).toBe(true);
  });
});

describe("passkey authentication", () => {
  const beginAuth = () => run((tx) => beginPasskeyAuthentication(tx, { rpId: "localhost" }));

  const authenticate = (challengeHandle: string, credentialId: string) =>
    run((tx) =>
      finishPasskeyAuthentication(tx, {
        challengeHandle,
        response: { id: credentialId } as never,
        rpId: "localhost",
        origin: "http://localhost",
      }),
    );

  it("authenticates a registered passkey into a management session, bumping the counter", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const credRowId = await seedCredential(personId, "cred-abc", 0);
    mockVerifyAuth.mockResolvedValue(authVerified(1));

    const begun = await beginAuth();
    expect(begun.challengeHandle).toBeTruthy();
    expect(begun.options.challenge).toBeTruthy();

    // A login (discoverable) challenge is minted BEFORE the credential is known, so it is not tied to
    // a person: person_id is null.
    const [chalRow] = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chalRow!.personId).toBeNull();

    const session = await authenticate(begun.challengeHandle, "cred-abc");
    // The verifier seam: a passkey resolves to its owner's management session, like loginManager.
    expect(session.personId).toBe(personId);
    expect(session.token).toBeTruthy();

    // The stored counter advanced to the verifier's newCounter (replay defence).
    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(1);

    // Single-use: the challenge was consumed on success, in the same committed transaction as the
    // counter bump and the session insert.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(0);

    // The verifier was handed the stored credential's material and this ceremony's challenge.
    expect(mockVerifyAuth).toHaveBeenCalledTimes(1);
    expect(mockVerifyAuth.mock.calls[0]![0]).toMatchObject({
      expectedChallenge: begun.options.challenge,
      expectedOrigin: "http://localhost",
      expectedRPID: "localhost",
      credential: { id: "cred-abc", counter: 0 },
    });
  });

  it("pins userVerification to 'required' in the authentication options", async () => {
    const begun = await beginAuth();
    // Default is 'preferred' (generateAuthenticationOptions.js:16 in @simplewebauthn/server@14.0.2);
    // pinned to 'required' so the authenticator performs UV on the primary login, matching the verify
    // side. Drop the pin and this reads 'preferred'.
    expect(begun.options.userVerification).toBe("required");
  });

  it("requires user verification on the authentication verify (requireUserVerification: true)", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    mockVerifyAuth.mockResolvedValue(authVerified(1));
    const begun = await beginAuth();
    await authenticate(begun.challengeHandle, "cred-abc");
    // Pinned explicitly rather than leaning on the library default (true, verifyAuthenticationResponse.js:28).
    expect(mockVerifyAuth.mock.calls[0]![0]).toMatchObject({ requireUserVerification: true });
  });

  it("never lowers the stored counter — a lower newCounter cannot regress it (concurrency clone-defence)", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const credRowId = await seedCredential(personId, "cred-abc", 10);
    // `verifyAuthenticationResponse` rejects a genuine REPLAY (newCounter <= stored, stored > 0) before
    // the counter update is reached; this guards the CONCURRENT case instead — two logins both read
    // counter=10 and the later-committing tx tries to write a SMALLER newCounter, silently regressing
    // the clone-detection baseline. Mock a verify that "succeeds" with a LOWER counter to isolate the
    // monotonic guard: without `lt(counter, newCounter)` in the update's WHERE, the UPDATE sets it to 5.
    mockVerifyAuth.mockResolvedValue(authVerified(5));

    const begun = await beginAuth();
    // The ceremony still succeeds and mints a session — the guard only refuses to LOWER the counter,
    // it never blocks the login.
    const session = await authenticate(begun.challengeHandle, "cred-abc");
    expect(session.personId).toBe(personId);

    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(10); // stayed at 10; the WHERE guard matched no row, so no write
  });

  it("consumes the challenge on the first finish: a second finish with the SAME handle is rejected", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    mockVerifyAuth.mockResolvedValue(authVerified(1));

    const begun = await beginAuth();
    await authenticate(begun.challengeHandle, "cred-abc"); // first finish consumes the challenge

    // The SAME handle a second time: the consume DELETE matches zero rows (already consumed) →
    // passkey.verification_failed. This is the single-use guarantee exercised through the 0-rows path;
    // removing the `challenge === undefined` throw in consumeChallenge stops it being a clean AppError.
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );
  });

  it("uses the generic verification failure when no credential matches the returned id", async () => {
    const begun = await beginAuth();
    // No credential was seeded for this id.
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-unknown"))).toBe(
      "passkey.verification_failed",
    );
    // The unrecognised credential short-circuits before the verifier is reached.
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("throws passkey.verification_failed when the assertion does not verify, leaving counter and challenge intact", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const credRowId = await seedCredential(personId, "cred-abc", 7);
    mockVerifyAuth.mockResolvedValue({ ...authVerified(9), verified: false });

    const begun = await beginAuth();
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );

    // The throw rolls finish's transaction back: the counter is unchanged (no bump to 9 leaked).
    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(7);
    // The challenge (committed by begin) survives, so the user may retry within its TTL — it is
    // consumed only on success, never on a failed assertion.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
    // No management session was minted for this person by the failed assertion.
    const opened = await run((tx) =>
      tx.select().from(managementSessions).where(eq(managementSessions.personId, personId)),
    );
    expect(opened).toHaveLength(0);
  });

  it("throws passkey.verification_failed when no challenge is on file for the handle", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    // A well-formed but unknown handle: nothing was ever stored under it.
    expect(
      await codeOf(() => authenticate("00000000-0000-4000-8000-000000000000", "cred-abc")),
    ).toBe("passkey.verification_failed");
    // The missing challenge short-circuits before the credential lookup and the verifier.
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("throws passkey.challenge_expired once the challenge is older than CHALLENGE_TTL_MS", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    const begun = await beginAuth();
    // Age the challenge past the TTL via a raw update — deterministic, no clock injection, exactly as
    // the registration suite ages its challenge.
    await run((tx) =>
      tx
        .update(webauthnChallenges)
        .set({ createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 60_000).toISOString() })
        .where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );

    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.challenge_expired",
    );
    // The TTL check short-circuits before the verifier is ever reached.
    expect(mockVerifyAuth).not.toHaveBeenCalled();
    // The expired challenge survives its throw (finish's transaction rolls back) — consumed only by
    // its TTL lapsing, the registration ceremony's exact single-use semantics: no delete-before-throw.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
  });

  it("refuses a person suspended AFTER enrolling a passkey, minting no session", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    // Suspend the owner AFTER the passkey is on file — the scenario the password sibling (loginManager)
    // already guards, and the one this gate closes for the passkey branch.
    await run((tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId)),
    );
    // Verify is mocked to SUCCEED: the gate must refuse the suspended owner even on a ceremony that
    // WOULD otherwise verify — which is what makes the deletion-proof meaningful (drop the gate and this
    // exact setup mints a session).
    mockVerifyAuth.mockResolvedValue(authVerified(1));

    const begun = await beginAuth();
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );

    // No management session was minted for the suspended person.
    const opened = await run((tx) =>
      tx.select().from(managementSessions).where(eq(managementSessions.personId, personId)),
    );
    expect(opened).toHaveLength(0);
  });

  it("maps a THROW from the library to passkey.verification_failed (not an opaque 500)", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const credRowId = await seedCredential(personId, "cred-abc", 4);
    // A generic library throw (bad signature, origin/RPID mismatch, malformed attestation) must become
    // a clean passkey.verification_failed, not reach `run` as a non-AppError → opaque 500.
    mockVerifyAuth.mockRejectedValue(new Error("Unexpected authenticator response"));

    const begun = await beginAuth();
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );

    // The throw rolled finish's transaction back: the counter is unchanged and no session was minted.
    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(4);
    const opened = await run((tx) =>
      tx.select().from(managementSessions).where(eq(managementSessions.personId, personId)),
    );
    expect(opened).toHaveLength(0);
  });

  it("refuses a non-string or missing returned credential id as passkey.not_registered", async () => {
    const begun = await beginAuth();
    const call = (response: unknown) =>
      codeOf(() =>
        run((tx) =>
          finishPasskeyAuthentication(tx, {
            challengeHandle: begun.challengeHandle,
            response: response as never,
            rpId: "localhost",
            origin: "http://localhost",
          }),
        ),
      );
    // The route hands `response` through as `never`, so the returned id may be non-string or absent at
    // runtime; either names no credential and must be refused before the driver or the verifier, never
    // a 500. Both the challenge (rolled back each throw) and the guard survive for the second call.
    expect(await call({ id: 123 })).toBe("passkey.not_registered");
    expect(await call(undefined)).toBe("passkey.not_registered");
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });
});

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

// Only the two VERIFY calls are mocked, because a genuine authenticator response cannot be
// synthesised in a unit test — so this suite asserts OUR wiring around them, not the crypto.
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

/** `VerifiedAuthenticationResponse` requires `authenticationInfo` even when `verified` is false, so
 * the failed case spreads this with `verified: false`. */
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

// One database is shared across the suite and the mocked credential ids repeat, while
// `credential_id` is unique — so clear the passkey rows between tests.
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

    const stored = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.personId).toBe(personId);

    const done = await finish(token, begun.challengeHandle);
    expect(done.credentialId).toBe("cred-abc");

    const creds = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.personId, personId)),
    );
    expect(creds).toHaveLength(1);
    expect(creds[0]).toMatchObject({
      credentialId: "cred-abc",
      publicKey: "AQID", // base64url of Uint8Array([1, 2, 3])
      counter: 0,
      // No transports were reported, so null rather than "[]".
      transports: null,
    });

    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(0);
  });

  it("pins userVerification to 'required' in the registration options (phishing-resistant primary login)", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await begin(token);
    // residentKey is asserted too: supplying `authenticatorSelection` at all drops the library's
    // `residentKey: 'preferred'` default, which the usernameless login depends on.
    expect(begun.options.authenticatorSelection).toMatchObject({
      residentKey: "preferred",
      userVerification: "required",
    });
  });

  it("offers exactly the three signature algorithms the server pins, in that order", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await begin(token);
    // Pinned rather than left to @simplewebauthn/server@14, which asks the running runtime what to
    // offer and prepends ML-DSA-44 where it is supported.
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
    expect(mockVerify.mock.calls[0]![0]).toMatchObject({ requireUserVerification: true });
  });

  it("passes its pinned algorithm list to the registration verifier", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified("cred-abc"));
    const begun = await begin(token);
    await finish(token, begun.challengeHandle);
    // Unpinned, the verifier defaults to the runtime-decided list, which may accept an algorithm the
    // options never offered. The library is mocked here, so this asserts the argument.
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
    // a non-array despite its declared type.
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

    const creds = await run((tx) => tx.select().from(webauthnCredentials));
    expect(creds).toHaveLength(0);
    // The throw rolls finish's transaction back, so the challenge survives for a retry.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
  });

  it("throws passkey.verification_failed when no challenge is on file for the handle", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const code = await codeOf(() => finish(token, "00000000-0000-4000-8000-000000000000"));
    expect(code).toBe("passkey.verification_failed");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("throws passkey.challenge_expired once the challenge is older than CHALLENGE_TTL_MS", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const begun = await begin(token);
    await run((tx) =>
      tx
        .update(webauthnChallenges)
        .set({ createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 60_000).toISOString() })
        .where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );

    expect(await codeOf(() => finish(token, begun.challengeHandle))).toBe(
      "passkey.challenge_expired",
    );
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("maps a THROW from the library to passkey.verification_failed (not an opaque 500)", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockRejectedValue(new Error("Unexpected authenticator response"));

    const begun = await begin(token);
    expect(await codeOf(() => finish(token, begun.challengeHandle))).toBe(
      "passkey.verification_failed",
    );

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

    const first = await begin(token);
    expect((await finish(token, first.challengeHandle)).credentialId).toBe("cred-dup");

    const second = await begin(token);
    expect(await codeOf(() => finish(token, second.challengeHandle))).toBe(
      "passkey.already_registered",
    );

    const creds = await run((tx) => tx.select().from(webauthnCredentials));
    expect(creds).toHaveLength(1);
    expect(creds[0]!.credentialId).toBe("cred-dup");
  });

  it("rethrows a non-unique insert failure untranslated, never masked as passkey.already_registered", async () => {
    // A forged verifier result with no credential id violates the NOT NULL constraint, not the unique
    // one.
    const { token } = await openManagementSession(suite.db, "admin");
    mockVerify.mockResolvedValue(verified(null as never));
    const begun = await begin(token);

    const error = await captureError(() => finish(token, begun.challengeHandle));
    // `refusalOn` reads the engine's result code off the RAW driver error, which an AppError does not
    // carry, so this also shows nothing translated the refusal.
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

    const [chalRow] = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chalRow!.personId).toBeNull();

    const session = await authenticate(begun.challengeHandle, "cred-abc");
    expect(session.personId).toBe(personId);
    expect(session.token).toBeTruthy();

    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(1);

    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(0);

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
    expect(begun.options.userVerification).toBe("required");
  });

  it("requires user verification on the authentication verify (requireUserVerification: true)", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    mockVerifyAuth.mockResolvedValue(authVerified(1));
    const begun = await beginAuth();
    await authenticate(begun.challengeHandle, "cred-abc");
    expect(mockVerifyAuth.mock.calls[0]![0]).toMatchObject({ requireUserVerification: true });
  });

  it("never lowers the stored counter — a lower newCounter cannot regress it (concurrency clone-defence)", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const credRowId = await seedCredential(personId, "cred-abc", 10);
    // The real verifier rejects a lower counter itself, so mock one that "succeeds" with a LOWER
    // counter to isolate the monotonic guard in the update.
    mockVerifyAuth.mockResolvedValue(authVerified(5));

    const begun = await beginAuth();
    const session = await authenticate(begun.challengeHandle, "cred-abc");
    expect(session.personId).toBe(personId);

    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(10);
  });

  it("consumes the challenge on the first finish: a second finish with the SAME handle is rejected", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    mockVerifyAuth.mockResolvedValue(authVerified(1));

    const begun = await beginAuth();
    await authenticate(begun.challengeHandle, "cred-abc");

    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );
  });

  it("uses the generic verification failure when no credential matches the returned id", async () => {
    const begun = await beginAuth();
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-unknown"))).toBe(
      "passkey.verification_failed",
    );
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

    const [cred] = await run((tx) =>
      tx.select().from(webauthnCredentials).where(eq(webauthnCredentials.id, credRowId)),
    );
    expect(cred!.counter).toBe(7);
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
    const opened = await run((tx) =>
      tx.select().from(managementSessions).where(eq(managementSessions.personId, personId)),
    );
    expect(opened).toHaveLength(0);
  });

  it("throws passkey.verification_failed when no challenge is on file for the handle", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    expect(
      await codeOf(() => authenticate("00000000-0000-4000-8000-000000000000", "cred-abc")),
    ).toBe("passkey.verification_failed");
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("throws passkey.challenge_expired once the challenge is older than CHALLENGE_TTL_MS", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    const begun = await beginAuth();
    await run((tx) =>
      tx
        .update(webauthnChallenges)
        .set({ createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 60_000).toISOString() })
        .where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );

    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.challenge_expired",
    );
    expect(mockVerifyAuth).not.toHaveBeenCalled();
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(1);
  });

  it("refuses a person suspended AFTER enrolling a passkey, minting no session", async () => {
    const personId = await seedPerson(suite.db, "admin");
    await seedCredential(personId, "cred-abc", 0);
    await run((tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId)),
    );
    // Verify is mocked to SUCCEED, so only the status gate stands between this ceremony and a session.
    mockVerifyAuth.mockResolvedValue(authVerified(1));

    const begun = await beginAuth();
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );

    const opened = await run((tx) =>
      tx.select().from(managementSessions).where(eq(managementSessions.personId, personId)),
    );
    expect(opened).toHaveLength(0);
  });

  it("maps a THROW from the library to passkey.verification_failed (not an opaque 500)", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const credRowId = await seedCredential(personId, "cred-abc", 4);
    mockVerifyAuth.mockRejectedValue(new Error("Unexpected authenticator response"));

    const begun = await beginAuth();
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-abc"))).toBe(
      "passkey.verification_failed",
    );

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
    // Each throw rolls back, so the challenge survives for the second call.
    expect(await call({ id: 123 })).toBe("passkey.not_registered");
    expect(await call(undefined)).toBe("passkey.not_registered");
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });
});

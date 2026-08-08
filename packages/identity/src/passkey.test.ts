import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { codeOf, openManagementSession, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: this suite tests the registration AND authentication LOGIC — options
// issued, challenge stored then consumed, credential persisted, counter bumped, person resolved. A
// PGlite connection is superuser, so RLS is a false pass here (CLAUDE.md §4); tenant-isolation and
// FORCE RLS on the webauthn tables are proven as the app role in webauthn.rls.test.ts (Task 1) and
// not re-proven here.
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
 * union requires the rest, so building it in full keeps the mock honest against v13's shape. */
function verified(id: string): Awaited<ReturnType<typeof verifyRegistrationResponse>> {
  return {
    verified: true,
    registrationInfo: {
      fmt: "none",
      aaguid: "00000000-0000-0000-0000-000000000000",
      credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
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
 * `authenticationInfo.newCounter`, but v13's `VerifiedAuthenticationResponse` is NOT a discriminated
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

let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

const run = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
  withTenant(suite.db, tenantId, fn);

const begin = (sessionId: string) =>
  run((tx) =>
    beginPasskeyRegistration(tx, {
      managementSessionId: sessionId,
      tenantId,
      rpId: "localhost",
      rpName: "Waitron",
    }),
  );

const finish = (sessionId: string, challengeHandle: string) =>
  run((tx) =>
    finishPasskeyRegistration(tx, {
      managementSessionId: sessionId,
      tenantId,
      challengeHandle,
      response: {} as never,
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
      .values({ tenantId, personId, credentialId, publicKey: "AQID", counter })
      .returning({ id: webauthnCredentials.id });
    return row!.id;
  });

beforeEach(() => {
  mockVerify.mockReset();
  mockVerifyAuth.mockReset();
});

// One PGlite database is shared across the suite (usePgliteDb registers beforeAll, not beforeEach),
// so clear the passkey rows between tests to keep them order-independent (CLAUDE.md §4). The credential
// id the mock returns is fixed, and (tenant_id, credential_id) is unique — without this a second test
// registering the same id would hit the unique constraint rather than exercise its own path.
afterEach(async () => {
  await run((tx) => tx.delete(webauthnCredentials));
  await run((tx) => tx.delete(webauthnChallenges));
});

describe("passkey registration", () => {
  it("issues options, stores a challenge, then persists the credential and consumes the challenge", async () => {
    const { personId, sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    mockVerify.mockResolvedValue(verified("cred-abc"));

    const begun = await begin(sessionId);
    expect(begun.challengeHandle).toBeTruthy();
    expect(begun.options.challenge).toBeTruthy();

    // The challenge is on file between begin and finish, scoped to this person.
    const stored = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.personId).toBe(personId);

    const done = await finish(sessionId, begun.challengeHandle);
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
    });

    // The challenge was single-use: finish deleted it.
    const chal = await run((tx) =>
      tx.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );
    expect(chal).toHaveLength(0);
  });

  it("excludes already-registered credentials from a second ceremony", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    mockVerify.mockResolvedValue(verified("cred-existing"));

    const first = await begin(sessionId);
    await finish(sessionId, first.challengeHandle);

    const second = await begin(sessionId);
    expect(second.options.excludeCredentials?.map((c) => c.id)).toContain("cred-existing");
  });

  it("throws passkey.verification_failed when the ceremony does not verify", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    mockVerify.mockResolvedValue({ verified: false });

    const begun = await begin(sessionId);
    expect(await codeOf(() => finish(sessionId, begun.challengeHandle))).toBe(
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
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    // A well-formed but unknown handle: nothing was ever stored under it.
    const code = await codeOf(() => finish(sessionId, "00000000-0000-4000-8000-000000000000"));
    expect(code).toBe("passkey.verification_failed");
    // verify is never reached — the missing challenge short-circuits before it.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("throws passkey.challenge_expired once the challenge is older than CHALLENGE_TTL_MS", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const begun = await begin(sessionId);
    // Age the challenge past the TTL via a raw update — deterministic, no clock injection, exactly as
    // management-session.test.ts ages last_seen_at.
    await run((tx) =>
      tx
        .update(webauthnChallenges)
        .set({ createdAt: new Date(Date.now() - CHALLENGE_TTL_MS - 60_000).toISOString() })
        .where(eq(webauthnChallenges.id, begun.challengeHandle)),
    );

    expect(await codeOf(() => finish(sessionId, begun.challengeHandle))).toBe(
      "passkey.challenge_expired",
    );
    // The TTL check short-circuits before the verifier is ever reached.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("maps a THROW from the library to passkey.verification_failed (not an opaque 500)", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    // `@simplewebauthn/server` throws a GENERIC Error on a malformed/mismatched response — not a mapped
    // `passkey.*` code. Unwrapped it would reach `run` as a non-AppError → opaque server.internal 500;
    // finishPasskeyRegistration must turn it into a clean passkey.verification_failed.
    mockVerify.mockRejectedValue(new Error("Unexpected authenticator response"));

    const begun = await begin(sessionId);
    expect(await codeOf(() => finish(sessionId, begun.challengeHandle))).toBe(
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
});

describe("passkey authentication", () => {
  const beginAuth = () =>
    run((tx) => beginPasskeyAuthentication(tx, { tenantId, rpId: "localhost" }));

  const authenticate = (challengeHandle: string, credentialId: string) =>
    run((tx) =>
      finishPasskeyAuthentication(tx, {
        tenantId,
        challengeHandle,
        response: { id: credentialId } as never,
        rpId: "localhost",
        origin: "http://localhost",
      }),
    );

  it("authenticates a registered passkey into a management session, bumping the counter", async () => {
    const personId = await seedPerson(suite.db, tenantId, "admin");
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
    expect(session.tenantId).toBe(tenantId);
    expect(session.id).toBeTruthy();

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

  it("never lowers the stored counter — a lower newCounter cannot regress it (concurrency clone-defence)", async () => {
    const personId = await seedPerson(suite.db, tenantId, "admin");
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
    const personId = await seedPerson(suite.db, tenantId, "admin");
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

  it("throws passkey.not_registered when no credential matches the returned id", async () => {
    const begun = await beginAuth();
    // No credential was seeded for this id.
    expect(await codeOf(() => authenticate(begun.challengeHandle, "cred-unknown"))).toBe(
      "passkey.not_registered",
    );
    // The unrecognised credential short-circuits before the verifier is reached.
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("throws passkey.verification_failed when the assertion does not verify, leaving counter and challenge intact", async () => {
    const personId = await seedPerson(suite.db, tenantId, "admin");
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
    const personId = await seedPerson(suite.db, tenantId, "admin");
    await seedCredential(personId, "cred-abc", 0);
    // A well-formed but unknown handle: nothing was ever stored under it.
    expect(
      await codeOf(() => authenticate("00000000-0000-4000-8000-000000000000", "cred-abc")),
    ).toBe("passkey.verification_failed");
    // The missing challenge short-circuits before the credential lookup and the verifier.
    expect(mockVerifyAuth).not.toHaveBeenCalled();
  });

  it("throws passkey.challenge_expired once the challenge is older than CHALLENGE_TTL_MS", async () => {
    const personId = await seedPerson(suite.db, tenantId, "admin");
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
    const personId = await seedPerson(suite.db, tenantId, "admin");
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
      "person.suspended",
    );

    // No management session was minted for the suspended person.
    const opened = await run((tx) =>
      tx.select().from(managementSessions).where(eq(managementSessions.personId, personId)),
    );
    expect(opened).toHaveLength(0);
  });

  it("maps a THROW from the library to passkey.verification_failed (not an opaque 500)", async () => {
    const personId = await seedPerson(suite.db, tenantId, "admin");
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
            tenantId,
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

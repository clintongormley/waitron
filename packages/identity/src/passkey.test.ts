import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { codeOf, openManagementSession } from "../test/fixtures.js";

// PGlite, not real Postgres: this suite tests the registration LOGIC — options issued, challenge
// stored then consumed, credential persisted, person resolved from the session. A PGlite connection
// is superuser, so RLS is a false pass here (CLAUDE.md §4); tenant-isolation and FORCE RLS on the
// webauthn tables are proven as the app role in webauthn.rls.test.ts (Task 1) and not re-proven here.
//
// `generateRegistrationOptions` runs FOR REAL (it just mints a random challenge); only
// `verifyRegistrationResponse` is mocked, because a genuine authenticator attestation cannot be
// synthesised in a unit test — so this suite asserts OUR wiring around it, not the crypto.
vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
}));

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import {
  beginPasskeyRegistration,
  CHALLENGE_TTL_MS,
  finishPasskeyRegistration,
} from "./passkey.js";

const mockVerify = vi.mocked(verifyRegistrationResponse);

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

beforeEach(() => {
  mockVerify.mockReset();
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
});

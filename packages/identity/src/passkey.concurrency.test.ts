/**
 * One challenge handle yields at most ONE session, however many finishes arrive for it.
 *
 * Weaker than its name: `withTransaction` runs the two finishes one after the other, so this suite
 * passes whether `consumeChallenge` deletes and returns in one statement or reads and then deletes.
 * It fails if the consume stops deleting.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { managementSessions } from "./schema/management-sessions.js";
import { webauthnChallenges, webauthnCredentials } from "./schema/webauthn.js";
import { codeOf, seedPerson } from "../test/fixtures.js";

vi.mock("@simplewebauthn/server", async (orig) => ({
  ...(await orig<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { finishPasskeyAuthentication } from "./passkey.js";

const mockVerifyAuth = vi.mocked(verifyAuthenticationResponse);

const CREDENTIAL_ID = "cred-abc";
const PUBLIC_KEY = "AQID"; // base64url of Uint8Array([1, 2, 3])

function authVerified(
  newCounter: number,
): Awaited<ReturnType<typeof verifyAuthenticationResponse>> {
  return {
    verified: true,
    authenticationInfo: {
      credentialID: CREDENTIAL_ID,
      newCounter,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost",
      rpID: "localhost",
    },
  };
}

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

beforeEach(async () => {
  mockVerifyAuth.mockReset();
  await seedTenant(suite.db);
});

async function seedFixture(db: Database): Promise<{ personId: string; handle: string }> {
  const personId = await seedPerson(db);
  await db
    .insert(webauthnCredentials)
    .values({ personId, credentialId: CREDENTIAL_ID, publicKey: PUBLIC_KEY, counter: 0 });
  const [challenge] = await db
    .insert(webauthnChallenges)
    .values({ personId: null, challenge: "chal-concurrency" })
    .returning({ id: webauthnChallenges.id });
  return { personId, handle: challenge!.id };
}

const finishAuth = (handle: string): Promise<{ personId: string }> =>
  withTransaction(suite.db, (tx) =>
    finishPasskeyAuthentication(tx, {
      challengeHandle: handle,
      response: { id: CREDENTIAL_ID } as never,
      rpId: "localhost",
      origin: "http://localhost",
    }),
  );

describe("finishPasskeyAuthentication under concurrent finishes", () => {
  it("consumes the challenge once, so a concurrent finish on the same handle is refused — one session only", async () => {
    const { personId, handle } = await seedFixture(suite.db);
    mockVerifyAuth.mockImplementation(() => Promise.resolve(authVerified(1)));

    const [winner, loser] = await Promise.allSettled([finishAuth(handle), finishAuth(handle)]);

    const settled = [winner, loser];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<{ personId: string }>).value.personId).toBe(
      personId,
    );

    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
    // Re-run through the same path so the refusal is read as a domain CODE rather than as whatever
    // object the settled result carries.
    expect(await codeOf(() => finishAuth(handle))).toBe("passkey.verification_failed");

    const sessions = await suite.db
      .select({ id: managementSessions.id })
      .from(managementSessions)
      .where(eq(managementSessions.personId, personId));
    expect(sessions).toHaveLength(1);
  });
});

/**
 * One challenge handle yields at most ONE session, however many finishes arrive for it.
 *
 * ## What this suite was, and what converting it cost
 *
 * No clause was deleted from `passkey.ts` for this one: `consumeChallenge` is a DELETE-and-return
 * and still is, and that single statement is what enforces single use. What was deleted is this
 * SUITE's own staging. It took two backends, parked one real ceremony inside a mocked `verify` —
 * after its consume-DELETE, before its commit — and then asked, from the other backend, whether
 * the challenge row was LOCKED: `select 1 … for update` with a `lock_timeout`, expecting SQLSTATE
 * `55P03`. SQLite has no row locks, no `for update` and no `lock_timeout`, and a venue file has one
 * write connection.
 *
 * **What stopped being checked:** that the consume takes a LOCK. The `55P03` probe was this file's
 * proof by deletion — it discriminated a locking DELETE from a non-locking SELECT — and there is no
 * counterpart, because the property it distinguished is not a property this engine has. What
 * serialises two finishes now is the venue file's write queue: `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, so the second finish's
 * `begin` does not run until the first has committed and the challenge row is gone. The mechanism,
 * its measurement and its control in the other direction are recorded once on `racePair`
 * (`packages/catalogue/test/fixtures.ts`).
 *
 * The verify gate goes with it: there is no longer a moment to park a ceremony in, because a parked
 * ceremony holds the write lock and the second finish cannot reach the database at all. `verify` is
 * still mocked — a genuine authenticator response cannot be synthesised in a test — but it now
 * simply returns.
 *
 * What remains is the subject: two finishes for one handle, started together, leave exactly one
 * management session, and the loser is refused `passkey.verification_failed`.
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

/** A minimal `verified: true` auth result — finish reads only `verified` and `newCounter`. */
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

/**
 * One active person, one registered credential, and one login challenge on file.
 *
 * Written through the table definitions, not as raw inserts: `id` and `created_at` on both tables
 * are Drizzle `$defaultFn` generators that only the insert BUILDER runs, so the raw inserts this
 * fixture used on PostgreSQL — where both had server-side defaults — are refused
 * `NOT NULL constraint failed` here.
 */
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

    // Both started without awaiting each other; nothing but the write queue keeps the second out.
    const [winner, loser] = await Promise.allSettled([finishAuth(handle), finishAuth(handle)]);

    // One ceremony completes and returns a session for the credential's owner.
    const settled = [winner, loser];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<{ personId: string }>).value.personId).toBe(
      personId,
    );

    // The losing side finds zero rows at consume — the challenge was deleted and committed by the
    // winner — and that is reported as a failed ceremony, never as a second session.
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
    // Re-run through the same path so the refusal is read as a domain CODE rather than as whatever
    // object the settled result carries.
    expect(await codeOf(() => finishAuth(handle))).toBe("passkey.verification_failed");

    // Exactly ONE management session was minted for the person across every attempt.
    const sessions = await suite.db
      .select({ id: managementSessions.id })
      .from(managementSessions)
      .where(eq(managementSessions.personId, personId));
    expect(sessions).toHaveLength(1);
  });
});

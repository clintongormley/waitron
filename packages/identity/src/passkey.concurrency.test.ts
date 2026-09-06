import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureError, pgErrorCode, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { codeOf, seedPerson } from "../test/fixtures.js";

// Real PostgreSQL — deliberately NOT skippable. PGlite serialises every query onto ONE backend
// (CLAUDE.md §4), so two "concurrent" finishes never actually overlap there and the single-use race
// this file exists to prove cannot occur — a PGlite run of this suite would be a false pass. The
// shared container this clones is booted in the package globalSetup, whose `dockerRequired` throws
// with guidance rather than degrading to a skip when Docker is absent (see src/testing/global-setup.ts).
//
// Only the VERIFY call is mocked (a genuine authenticator response cannot be synthesised in a test);
// the mock is made to BLOCK on a gate this suite controls, so one real `finishPasskeyAuthentication`
// can be parked mid-ceremony — after it has consumed the challenge, before its transaction commits —
// while a second connection probes whether the challenge row is locked. That gate is the deterministic
// hook that turns the race into a fixed outcome rather than a flaky `Promise.all`.
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

const suite = useTemplateDb({ template: "core_identity" });

beforeEach(() => {
  mockVerifyAuth.mockReset();
});

/** A fresh tenant with one active person, one registered credential, and one login challenge on file.
 * Seeded as the owner — the property under test is row-locking, proven on distinct backends. */
async function seedFixture(): Promise<{ tenant: string; personId: string; handle: string }> {
  const tenant = await seedTenant(suite.admin);
  const personId = await seedPerson(suite.admin, tenant);
  await suite.admin.execute(sql`
    insert into webauthn_credentials (tenant_id, person_id, credential_id, public_key, counter)
    values (${tenant}, ${personId}, ${CREDENTIAL_ID}, ${PUBLIC_KEY}, 0)`);
  const chal = await suite.admin.execute<{ id: string }>(sql`
    insert into webauthn_challenges (tenant_id, person_id, challenge)
    values (${tenant}, null, 'chal-concurrency') returning id`);
  return { tenant, personId, handle: chal.rows[0]!.id };
}

const finishAuth = (
  db: Parameters<typeof withTenant>[0],
  tenant: string,
  handle: string,
): Promise<{ personId: string }> =>
  withTenant(db, tenant, (tx) =>
    finishPasskeyAuthentication(tx, {
      tenantId: tenant,
      challengeHandle: handle,
      response: { id: CREDENTIAL_ID } as never,
      rpId: "localhost",
      origin: "http://localhost",
    }),
  );

describe("finishPasskeyAuthentication under real concurrency", () => {
  it("consume-first row-locks the challenge, so a concurrent finish on the same handle is rejected — one session only", async () => {
    const { tenant, personId, handle } = await seedFixture();

    // Park the first ceremony inside verify — AFTER its consume-DELETE has run (and row-locked the
    // challenge), BEFORE its transaction commits — by making the mocked verify await a gate we hold.
    let releaseVerify: () => void = () => {};
    const verifyGate = new Promise<void>((resolve) => (releaseVerify = resolve));
    mockVerifyAuth.mockImplementation(async () => {
      await verifyGate;
      return authVerified(1);
    });

    const c1 = await suite.pg.connect();
    const c2 = await suite.pg.connect();
    let c1Done: Promise<unknown> | undefined;
    try {
      // C1: a real finish. Its consume-DELETE row-locks the challenge, then it parks in verify. Launch,
      // do NOT await — its transaction stays open, holding the lock.
      c1Done = finishAuth(c1, tenant, handle);
      // Deterministic: proceed only once C1 has actually reached verify — i.e. it is PAST its consume
      // step. True on BOTH the fixed and the unfixed code (both reach verify), so this wait never hangs.
      await vi.waitFor(() => expect(mockVerifyAuth).toHaveBeenCalledTimes(1));

      // Probe, on a distinct backend, whether the challenge row is locked while C1 sits mid-ceremony.
      // The fixed code consumed it with a locking DELETE, so this FOR UPDATE blocks and lock_timeout
      // fires → 55P03. The UNFIXED code loaded it with a non-locking SELECT, so this acquires the lock
      // at once and returns without error — captureError then throws "expected ... rejected" and fails
      // the test. That contrast IS the single-use-under-concurrency guarantee, proven by deletion.
      const probeErr = await captureError(() =>
        c2.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '250ms'`);
          return tx.execute(sql`select 1 from webauthn_challenges where id = ${handle} for update`);
        }),
      );
      expect(pgErrorCode(probeErr)).toBe("55P03");

      // Let C1 finish: verify resolves, the counter bumps, the session mints, the tx commits — so the
      // challenge DELETE is now durable and the row is gone.
      releaseVerify();
      const session = await c1Done;
      expect((session as { personId: string }).personId).toBe(personId);

      // The losing side, played out on a real finish: the SAME handle now finds zero rows at consume →
      // passkey.verification_failed. Under live contention this is the path C2 takes the instant C1
      // commits and releases the lock.
      expect(await codeOf(() => finishAuth(c2, tenant, handle))).toBe(
        "passkey.verification_failed",
      );

      // Exactly ONE management session was minted for the person across both attempts.
      const sessions = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from management_sessions where person_id = ${personId}`,
      );
      expect(sessions.rows[0]!.count).toBe("1");
    } finally {
      // Always release the gate and settle C1's transaction BEFORE closing — a failed assertion above
      // must never leave the parked ceremony open, or close() hangs on it.
      releaseVerify();
      if (c1Done) await c1Done.catch(() => {});
      await c1.close();
      await c2.close();
    }
  });
});

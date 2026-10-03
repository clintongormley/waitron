import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createPinThrottle,
  endSession,
  IDENTITY_MIGRATIONS,
  loginWithPin,
  PIN_THROTTLE_FREE_ATTEMPTS,
} from "@waitron/identity";
import { seedPerson, seedTill } from "@waitron/identity/test/fixtures.js";
import { describe, expect, it, vi } from "vitest";
import { keysInTurn } from "./attempt-turns.js";
import { overrideToCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { failingDerivationsOf } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

/** A shift session for an operator of `role`. */
async function sessionOf(role: "staff" | "supervisor"): Promise<{ id: string; token: string }> {
  const tillId = await seedTill(suite.db);
  const personId = await seedPerson(suite.db, role);
  return withTransaction(suite.db, (tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));
}

describe("overrideToCheck", () => {
  it("names the override of an operator who lacks the permission", async () => {
    const session = await sessionOf("staff");
    const override = { personId: await seedPerson(suite.db, "supervisor"), pin: "1234" };

    expect(
      await overrideToCheck(
        suite.db,
        { sessionId: session.id, permission: "cash.drawer" },
        override,
      ),
    ).toBe(override);
  });

  it("names none for an operator who holds the permission, unless it is checked anyway", async () => {
    const session = await sessionOf("supervisor");
    const override = { personId: await seedPerson(suite.db, "supervisor"), pin: "1234" };
    const authz = { sessionId: session.id, permission: "cash.drawer" as const };

    expect(await overrideToCheck(suite.db, authz, override)).toBeUndefined();
    expect(await overrideToCheck(suite.db, authz, override, true)).toBe(override);
  });

  it("names none on a session that has ended, which authorize refuses", async () => {
    const session = await sessionOf("staff");
    await withTransaction(suite.db, (tx) => endSession(tx, session.token));

    const toCheck = await overrideToCheck(
      suite.db,
      { sessionId: session.id, permission: "cash.drawer" },
      { personId: await seedPerson(suite.db, "supervisor"), pin: "1234" },
    );

    expect(toCheck).toBeUndefined();
  });
});

describe("withPinCheckAhead", () => {
  it("hands the transaction an issued check of the credential", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const attempts = { throttle: createPinThrottle(), slot: "override:till" };

    const checked = await withPinCheckAhead(
      suite.db,
      { personId, pin: "1234" },
      attempts,
      async (check) => check,
    );

    expect(checked).toEqual({ personId, matches: true });
    expect(keysInTurn(attempts.throttle)).toBe(0);
  });

  it("hands the transaction no check, still in turn, when the check fails", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const attempts = { throttle: createPinThrottle(), slot: "override:till" };
    const seen: { check: unknown; turns: number }[] = [];

    const result = await failingDerivationsOf("4040", () =>
      withPinCheckAhead(suite.db, { personId, pin: "4040" }, attempts, async (check) => {
        seen.push({ check, turns: keysInTurn(attempts.throttle) });
        return "answered";
      }),
    );

    expect({ result, seen }).toEqual({
      result: "answered",
      seen: [{ check: undefined, turns: 1 }],
    });
    expect(keysInTurn(attempts.throttle)).toBe(0);
  });

  it("checks nothing, and takes no turn, without a credential or while the limit would refuse", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const attempts = { throttle: createPinThrottle(), slot: "override:till" };
    for (let i = 0; i <= PIN_THROTTLE_FREE_ATTEMPTS; i++) {
      attempts.throttle.recordFailure(attempts.slot, personId);
    }
    const turnsSeen: number[] = [];
    const run = (credential: { personId: string; pin: string } | undefined) =>
      withPinCheckAhead(suite.db, credential, attempts, async (check) => {
        turnsSeen.push(keysInTurn(attempts.throttle));
        return check;
      });

    expect(await run(undefined)).toBeUndefined();
    expect(await run({ personId, pin: "1234" })).toBeUndefined();
    expect(turnsSeen).toEqual([0, 0]);
  });

  it("checks an attempt queued behind one the limit then refuses no further", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const attempts = { throttle: createPinThrottle({ now: () => 1_000 }), slot: "override:till" };
    for (let i = 0; i < PIN_THROTTLE_FREE_ATTEMPTS; i++) {
      attempts.throttle.recordFailure(attempts.slot, personId);
    }
    const credential = { personId, pin: "9999" };

    const [first, second] = await Promise.all([
      withPinCheckAhead(suite.db, credential, attempts, async (check) => {
        attempts.throttle.recordFailure(attempts.slot, personId);
        return check;
      }),
      withPinCheckAhead(suite.db, credential, attempts, async (check) => check),
    ]);

    expect(first).toEqual({ personId, matches: false });
    expect(second).toBeUndefined();
    expect(keysInTurn(attempts.throttle)).toBe(0);
  });
});

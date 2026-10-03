import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createPinThrottle,
  endSession,
  IDENTITY_MIGRATIONS,
  loginWithPin,
} from "@waitron/identity";
import { seedPerson, seedTill } from "@waitron/identity/test/fixtures.js";
import { describe, expect, it } from "vitest";
import { checkOverrideAhead } from "./pin-check-ahead.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

const attempts = () => ({ throttle: createPinThrottle(), slot: "override:till" });

/** A shift session for a staff operator, who lacks `cash.drawer`. */
async function staffSession(): Promise<{ id: string; token: string }> {
  const tillId = await seedTill(suite.db);
  const personId = await seedPerson(suite.db, "staff");
  return withTransaction(suite.db, (tx) => loginWithPin(tx, { tillId, personId, pin: "1234" }));
}

describe("checkOverrideAhead", () => {
  it("checks the override of an operator who lacks the permission", async () => {
    const session = await staffSession();
    const supervisorId = await seedPerson(suite.db, "supervisor");

    const checked = await checkOverrideAhead(
      suite.db,
      { sessionId: session.id, permission: "cash.drawer" },
      { personId: supervisorId, pin: "1234" },
      attempts(),
    );

    expect(checked).toEqual({ personId: supervisorId, matches: true });
  });

  it("checks nothing on a session that has ended, which authorize refuses", async () => {
    const session = await staffSession();
    const supervisorId = await seedPerson(suite.db, "supervisor");
    await withTransaction(suite.db, (tx) => endSession(tx, session.token));

    const checked = await checkOverrideAhead(
      suite.db,
      { sessionId: session.id, permission: "cash.drawer" },
      { personId: supervisorId, pin: "1234" },
      attempts(),
    );

    expect(checked).toBeUndefined();
  });
});

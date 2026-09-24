import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { authorize } from "./authorize.js";
import { endSession, loginWithPin } from "./login.js";
import { codeOf, openSession, seedPerson, seedTill } from "../test/fixtures.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

describe("authorize", () => {
  it("authorizes on the operator's own role when it holds the permission (no override)", async () => {
    const tillId = await seedTill(suite.db);
    const managerId = await seedPerson(suite.db, "manager");
    const sessionId = await openSession(suite.db, tillId, managerId);

    const result = await run((tx) => authorize(tx, { sessionId, permission: "sale.void" }));

    // toEqual, not toMatchObject: an unlisted extra key fails rather than being silently ignored.
    expect(result).toEqual({
      authorizedBy: managerId,
      permission: "sale.void",
      viaOverride: false,
    });
  });

  it("authorizes via a supervisor override when the operator lacks the permission", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const supervisorId = await seedPerson(suite.db, "supervisor");
    const sessionId = await openSession(suite.db, tillId, staffId);

    const result = await run((tx) =>
      authorize(tx, {
        sessionId,
        permission: "sale.void",
        override: { personId: supervisorId, pin: "1234" },
      }),
    );

    expect(result).toEqual({
      authorizedBy: supervisorId,
      permission: "sale.void",
      viaOverride: true,
    });
  });

  it("throws authorization.not_permitted when the operator lacks it and no override is supplied", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const sessionId = await openSession(suite.db, tillId, staffId);

    const code = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId, permission: "sale.void" })),
    );
    expect(code).toBe("authorization.not_permitted");
  });

  it("throws pin.invalid when the override PIN does not verify", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const supervisorId = await seedPerson(suite.db, "supervisor");
    const sessionId = await openSession(suite.db, tillId, staffId);

    const code = await codeOf(() =>
      run((tx) =>
        authorize(tx, {
          sessionId,
          permission: "sale.void",
          override: { personId: supervisorId, pin: "9999" },
        }),
      ),
    );
    expect(code).toBe("pin.invalid");
  });

  it("throws person.not_found when the override personId is unknown", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const sessionId = await openSession(suite.db, tillId, staffId);

    const code = await codeOf(() =>
      run((tx) =>
        authorize(tx, {
          sessionId,
          permission: "sale.void",
          override: { personId: crypto.randomUUID(), pin: "1234" },
        }),
      ),
    );
    expect(code).toBe("person.not_found");
  });

  it("throws authorization.not_permitted when the override person also lacks the permission", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    const otherStaffId = await seedPerson(suite.db, "staff");
    const sessionId = await openSession(suite.db, tillId, staffId);

    const code = await codeOf(() =>
      run((tx) =>
        authorize(tx, {
          sessionId,
          permission: "sale.void",
          override: { personId: otherStaffId, pin: "1234" },
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
  });

  it("throws session.not_open for a session that has been ended", async () => {
    const tillId = await seedTill(suite.db);
    const managerId = await seedPerson(suite.db, "manager");
    // The row id feeds `authorize` and the token feeds `endSession`, so this case holds both.
    const session = await run((tx) =>
      loginWithPin(tx, { tillId, personId: managerId, pin: "1234" }),
    );
    const sessionId = session.id;
    await run((tx) => endSession(tx, session.token));

    // The manager holds sale.void, so only the ended-session guard can be the cause here.
    const code = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId, permission: "sale.void" })),
    );
    expect(code).toBe("session.not_open");
  });

  it("throws session.not_open when the session's person row has been deleted", async () => {
    const tillId = await seedTill(suite.db);
    const managerId = await seedPerson(suite.db, "manager");
    const sessionId = await openSession(suite.db, tillId, managerId);
    // Reachable because `sessions` declares no key to `persons`.
    await suite.db.execute(sql`delete from persons where id = ${managerId}`);

    // The session is still open, so what refuses here is the inner join finding no person row.
    const code = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId, permission: "sale.void" })),
    );
    expect(code).toBe("session.not_open");
  });

  it("throws person.suspended when the override targets a suspended person", async () => {
    const tillId = await seedTill(suite.db);
    const staffId = await seedPerson(suite.db, "staff");
    // A suspended SUPERVISOR with the right PIN: the person would both hold sale.void and pass the
    // PIN check, so only the suspended gate — checked before both — can be the cause.
    const suspendedSupervisorId = await seedPerson(suite.db, "supervisor", "suspended");
    const sessionId = await openSession(suite.db, tillId, staffId);

    const code = await codeOf(() =>
      run((tx) =>
        authorize(tx, {
          sessionId,
          permission: "sale.void",
          override: { personId: suspendedSupervisorId, pin: "1234" },
        }),
      ),
    );
    expect(code).toBe("person.suspended");
  });
});

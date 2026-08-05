import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { authorize } from "./authorize.js";
import { endSession } from "./login.js";
import { codeOf, openSession, seedPerson, seedTill } from "../test/fixtures.js";

// PGlite, not real Postgres: authorize() is pure LOGIC — the operator-holds path, the override
// path's not-found / suspended / bad-PIN / lacks-permission gates, and the open-session guard.
// Nothing here depends on the privilege set or on RLS enforcement (a PGlite connection is superuser,
// so RLS is a false pass, CLAUDE.md §4); tenant-isolation of persons/sessions is proven as the app
// role in persons.rls.test.ts / sessions.rls.test.ts and is not re-proven here.
let tenantId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

describe("authorize", () => {
  it("authorizes on the operator's own role when it holds the permission (no override)", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const managerId = await seedPerson(suite.db, tenantId, "manager");
    const sessionId = await openSession(suite.db, tenantId, tillId, managerId);

    const result = await run((tx) => authorize(tx, { sessionId, permission: "sale.void" }));

    // toEqual, not toMatchObject: all three fields are pinned, so an unlisted extra key fails rather
    // than being silently ignored (CLAUDE.md §4). authorizedBy is the operator; no override was used.
    expect(result).toEqual({
      authorizedBy: managerId,
      permission: "sale.void",
      viaOverride: false,
    });
  });

  it("authorizes via a supervisor override when the operator lacks the permission", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const staffId = await seedPerson(suite.db, tenantId, "staff");
    const supervisorId = await seedPerson(suite.db, tenantId, "supervisor");
    const sessionId = await openSession(suite.db, tenantId, tillId, staffId);

    const result = await run((tx) =>
      authorize(tx, {
        sessionId,
        permission: "sale.void",
        override: { personId: supervisorId, pin: "1234" },
      }),
    );

    // Authorized by the OVERRIDE person, flagged viaOverride so the caller records who approved it.
    expect(result).toEqual({
      authorizedBy: supervisorId,
      permission: "sale.void",
      viaOverride: true,
    });
  });

  it("throws authorization.not_permitted when the operator lacks it and no override is supplied", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const staffId = await seedPerson(suite.db, tenantId, "staff");
    const sessionId = await openSession(suite.db, tenantId, tillId, staffId);

    const code = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId, permission: "sale.void" })),
    );
    expect(code).toBe("authorization.not_permitted");
  });

  it("throws pin.invalid when the override PIN does not verify", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const staffId = await seedPerson(suite.db, tenantId, "staff");
    const supervisorId = await seedPerson(suite.db, tenantId, "supervisor");
    const sessionId = await openSession(suite.db, tenantId, tillId, staffId);

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

  it("throws person.not_found when the override personId is unknown (or another tenant's, RLS-hidden)", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const staffId = await seedPerson(suite.db, tenantId, "staff");
    const sessionId = await openSession(suite.db, tenantId, tillId, staffId);

    // The override names a personId that resolves to no row in this tenant — the override lookup
    // returns nothing before status/PIN/permission are ever consulted.
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
    const tillId = await seedTill(suite.db, tenantId);
    const staffId = await seedPerson(suite.db, tenantId, "staff");
    const otherStaffId = await seedPerson(suite.db, tenantId, "staff");
    const sessionId = await openSession(suite.db, tenantId, tillId, staffId);

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
    const tillId = await seedTill(suite.db, tenantId);
    const managerId = await seedPerson(suite.db, tenantId, "manager");
    const sessionId = await openSession(suite.db, tenantId, tillId, managerId);
    await run((tx) => endSession(tx, sessionId));

    // The manager holds sale.void, so only the ended-session guard — checked first, before any role
    // lookup — can be the cause here.
    const code = await codeOf(() =>
      run((tx) => authorize(tx, { sessionId, permission: "sale.void" })),
    );
    expect(code).toBe("session.not_open");
  });

  it("throws person.suspended when the override targets a suspended person", async () => {
    const tillId = await seedTill(suite.db, tenantId);
    const staffId = await seedPerson(suite.db, tenantId, "staff");
    // A suspended SUPERVISOR with the right PIN: the person would both hold sale.void and pass the
    // PIN check, so only the suspended gate — checked before both — can be the cause.
    const suspendedSupervisorId = await seedPerson(suite.db, tenantId, "supervisor", "suspended");
    const sessionId = await openSession(suite.db, tenantId, tillId, staffId);

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

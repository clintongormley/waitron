import { CORE_MIGRATIONS, asAppUser, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createStatus, deactivateStatus, listStatuses, updateStatus } from "./tables.js";
import "./errors.js";

// Core plus identity, because the CRUD both authorizes (`authorizeManager` reads `persons` and
// `management_sessions`) and writes `table_service_statuses`. `resetPerTest: false`: the manager
// session seeded once in `beforeAll` is read by every case below.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  resetPerTest: false,
  timeoutMs: 60_000,
});

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session; returns the session id. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  // Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are
  // `$defaultFn` generators (`packages/identity/src/schema/persons.ts:26,:67`) that an insert
  // statement never reaches, and both columns are NOT NULL.
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: `${role} operator`, pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `NON-APP-ERROR: ${String(error)}`;
}

describe("service-status config CRUD (venue.configure)", () => {
  let managerSession: string;
  beforeAll(async () => {
    await seedTenant(suite.db);
    managerSession = await seedSession("manager");
  });

  it("creates, lists (by display_order then label), updates, and deactivates a status", async () => {
    const { id } = await asApp((tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        label: "Bill requested",
        color: "#ef4444",
        displayOrder: 1,
      }),
    );
    await asApp((tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        label: "Needs cleaning",
        color: "amber",
        displayOrder: 0,
      }),
    );
    const list = await asApp((tx) => listStatuses(tx, { managementSessionId: managerSession }));
    expect(list.map((s) => s.label)).toEqual(["Needs cleaning", "Bill requested"]); // display_order 0, 1

    await asApp((tx) =>
      updateStatus(tx, {
        managementSessionId: managerSession,
        id,
        color: "#22c55e",
        displayOrder: 5,
      }),
    );
    await asApp((tx) => deactivateStatus(tx, { managementSessionId: managerSession, id }));
    const after = await asApp((tx) => listStatuses(tx, { managementSessionId: managerSession }));
    expect(after.find((s) => s.id === id)).toMatchObject({
      color: "#22c55e",
      displayOrder: 5,
      active: false,
    });
  });

  it("refuses a duplicate label (status.label_taken) on create and on update", async () => {
    await asApp((tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        label: "Reserved",
        color: "#3b82f6",
      }),
    );
    expect(
      await codeOf(() =>
        asApp((tx) =>
          createStatus(tx, {
            managementSessionId: managerSession,
            label: "Reserved",
            color: "#000",
          }),
        ),
      ),
    ).toBe("status.label_taken");

    // ...and on update: a second status renamed onto the taken label trips the same unique, so
    // updateStatus maps its 23505 to status.label_taken too (the catch branch the create case cannot
    // reach). The test's title promises both directions; this is the update half.
    const { id } = await asApp((tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        label: "Occupied",
        color: "#f97316",
      }),
    );
    expect(
      await codeOf(() =>
        asApp((tx) =>
          updateStatus(tx, {
            managementSessionId: managerSession,
            id,
            label: "Reserved",
          }),
        ),
      ),
    ).toBe("status.label_taken");
  });

  it("throws status.not_found for update/deactivate of an unknown id", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(
      await codeOf(() =>
        asApp((tx) =>
          updateStatus(tx, {
            managementSessionId: managerSession,
            id: missing,
            label: "X",
          }),
        ),
      ),
    ).toBe("status.not_found");
    expect(
      await codeOf(() =>
        asApp((tx) => deactivateStatus(tx, { managementSessionId: managerSession, id: missing })),
      ),
    ).toBe("status.not_found");
  });

  it("rejects a malformed color (management.request_invalid, naming the field)", async () => {
    expect(
      await codeOf(() =>
        asApp((tx) =>
          createStatus(tx, {
            managementSessionId: managerSession,
            label: "Bad",
            color: "red; drop table x",
          }),
        ),
      ),
    ).toBe("management.request_invalid");
  });

  it("gates every verb on venue.configure — a staff-role session is refused (authorization.not_permitted)", async () => {
    const staffSession = await seedSession("staff");
    expect(
      await codeOf(() =>
        asApp((tx) =>
          createStatus(tx, {
            managementSessionId: staffSession,
            label: "Nope",
            color: "#000",
          }),
        ),
      ),
    ).toBe("authorization.not_permitted");
    expect(
      await codeOf(() => asApp((tx) => listStatuses(tx, { managementSessionId: staffSession }))),
    ).toBe("authorization.not_permitted");
  });
});

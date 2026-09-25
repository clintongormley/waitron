import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStatus, deactivateStatus, listStatuses, updateStatus } from "./tables.js";
import "./errors.js";

// `resetPerTest: false`: the manager session seeded once in `beforeAll` is read by every case below.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  resetPerTest: false,
  timeoutMs: 60_000,
});

function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, async (tx) => {
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session; returns the session id. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  // Through the table definition so each column's `$defaultFn` runs.
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: `${role} operator`, pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
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

    // ...and on update: a second status renamed onto the taken label maps to status.label_taken too.
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

  it("reactivates a deactivated status through updateStatus's active patch", async () => {
    const { id } = await asApp((tx) =>
      createStatus(tx, { managementSessionId: managerSession, label: "Waiting", color: "#6b7280" }),
    );
    await asApp((tx) => deactivateStatus(tx, { managementSessionId: managerSession, id }));
    await asApp((tx) =>
      updateStatus(tx, { managementSessionId: managerSession, id, active: true }),
    );
    const list = await asApp((tx) => listStatuses(tx, { managementSessionId: managerSession }));
    expect(list.find((status) => status.id === id)).toMatchObject({
      label: "Waiting",
      active: true,
    });
  });

  it("rethrows a refusal that is not the label unique raw, on create and on update", async () => {
    const { id } = await asApp((tx) =>
      createStatus(tx, { managementSessionId: managerSession, label: "Dessert", color: "#a855f7" }),
    );
    // `table_service_statuses` declares no CHECK, so temporary triggers supply the refusal.
    await suite.db.execute(sql`
      create trigger statuses_refuse_insert before insert on table_service_statuses
      begin select raise(abort, 'status insert refused'); end`);
    await suite.db.execute(sql`
      create trigger statuses_refuse_update before update on table_service_statuses
      begin select raise(abort, 'status update refused'); end`);
    try {
      expect(
        await codeOf(() =>
          asApp((tx) =>
            createStatus(tx, {
              managementSessionId: managerSession,
              label: "Coffee",
              color: "#000",
            }),
          ),
        ),
      ).toMatch(/^NON-APP-ERROR: .*status insert refused/);
      expect(
        await codeOf(() =>
          asApp((tx) =>
            updateStatus(tx, { managementSessionId: managerSession, id, label: "Postre" }),
          ),
        ),
      ).toMatch(/^NON-APP-ERROR: .*status update refused/);
    } finally {
      await suite.db.execute(sql`drop trigger statuses_refuse_insert`);
      await suite.db.execute(sql`drop trigger statuses_refuse_update`);
    }
  });
});

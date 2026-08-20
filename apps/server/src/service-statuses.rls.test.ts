import { asAppUser, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createStatus, deactivateStatus, listStatuses, updateStatus } from "./tables.js";
import "./errors.js";

// A clone of the CORE+IDENTITY template. The CRUD both AUTHORIZES (authorizeManager reads persons +
// management_sessions under the app role's RLS) and upserts table_service_statuses under FORCE ROW
// LEVEL SECURITY — both false passes on PGlite (superuser) — so it needs the real cluster the shared
// container provides; a Docker-absent run fails at the package globalSetup, not here.
const suite = useTemplateDb({ template: "core_identity" });

function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Seed a person of `role` and an open management session; returns the session id. */
async function seedSession(tenantId: string, role: PersonRoleValue): Promise<string> {
  const person = await suite.admin.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Operator', 'seed-pin-hash', ${role}) returning id`);
  const session = await withTenant(suite.admin, tenantId, (tx) =>
    startManagementSession(tx, { tenantId, personId: person.rows[0]!.id }),
  );
  return session.id;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `NON-APP-ERROR: ${String(error)}`;
}

describe("service-status config CRUD (till.configure)", () => {
  let tenantId: string;
  let managerSession: string;
  beforeAll(async () => {
    tenantId = await seedTenant(suite.admin);
    managerSession = await seedSession(tenantId, "manager");
  });

  it("creates, lists (by display_order then label), updates, and deactivates a status", async () => {
    const { id } = await asApp(tenantId, (tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        tenantId,
        label: "Bill requested",
        color: "#ef4444",
        displayOrder: 1,
      }),
    );
    await asApp(tenantId, (tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        tenantId,
        label: "Needs cleaning",
        color: "amber",
        displayOrder: 0,
      }),
    );
    const list = await asApp(tenantId, (tx) =>
      listStatuses(tx, { managementSessionId: managerSession, tenantId }),
    );
    expect(list.map((s) => s.label)).toEqual(["Needs cleaning", "Bill requested"]); // display_order 0, 1

    await asApp(tenantId, (tx) =>
      updateStatus(tx, {
        managementSessionId: managerSession,
        tenantId,
        id,
        color: "#22c55e",
        displayOrder: 5,
      }),
    );
    await asApp(tenantId, (tx) =>
      deactivateStatus(tx, { managementSessionId: managerSession, tenantId, id }),
    );
    const after = await asApp(tenantId, (tx) =>
      listStatuses(tx, { managementSessionId: managerSession, tenantId }),
    );
    expect(after.find((s) => s.id === id)).toMatchObject({
      color: "#22c55e",
      displayOrder: 5,
      active: false,
    });
  });

  it("refuses a duplicate label (status.label_taken) on create and on update", async () => {
    await asApp(tenantId, (tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        tenantId,
        label: "Reserved",
        color: "#3b82f6",
      }),
    );
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) =>
          createStatus(tx, {
            managementSessionId: managerSession,
            tenantId,
            label: "Reserved",
            color: "#000",
          }),
        ),
      ),
    ).toBe("status.label_taken");

    // ...and on update: a second status renamed onto the taken label trips the same unique, so
    // updateStatus maps its 23505 to status.label_taken too (the catch branch the create case cannot
    // reach). The test's title promises both directions; this is the update half.
    const { id } = await asApp(tenantId, (tx) =>
      createStatus(tx, {
        managementSessionId: managerSession,
        tenantId,
        label: "Occupied",
        color: "#f97316",
      }),
    );
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) =>
          updateStatus(tx, {
            managementSessionId: managerSession,
            tenantId,
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
        asApp(tenantId, (tx) =>
          updateStatus(tx, {
            managementSessionId: managerSession,
            tenantId,
            id: missing,
            label: "X",
          }),
        ),
      ),
    ).toBe("status.not_found");
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) =>
          deactivateStatus(tx, { managementSessionId: managerSession, tenantId, id: missing }),
        ),
      ),
    ).toBe("status.not_found");
  });

  it("rejects a malformed color (management.request_invalid, naming the field)", async () => {
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) =>
          createStatus(tx, {
            managementSessionId: managerSession,
            tenantId,
            label: "Bad",
            color: "red; drop table x",
          }),
        ),
      ),
    ).toBe("management.request_invalid");
  });

  it("gates every verb on till.configure — a staff-role session is refused (authorization.not_permitted)", async () => {
    const staffSession = await seedSession(tenantId, "staff");
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) =>
          createStatus(tx, {
            managementSessionId: staffSession,
            tenantId,
            label: "Nope",
            color: "#000",
          }),
        ),
      ),
    ).toBe("authorization.not_permitted");
    expect(
      await codeOf(() =>
        asApp(tenantId, (tx) => listStatuses(tx, { managementSessionId: staffSession, tenantId })),
      ),
    ).toBe("authorization.not_permitted");
  });
});

import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { afterEach, describe, expect, it } from "vitest";
import { createPerson, setEmail } from "./staff.js";
import { openManagementSession, seedPerson } from "../test/fixtures.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

afterEach(async () => {
  await suite.db.execute(sql`delete from management_sessions`);
  await suite.db.execute(sql`delete from persons`);
  await suite.db.execute(sql`delete from tenants`);
});

function run<T>(db: Database, tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, tenantId, fn);
}

describe("createPerson / setEmail email_taken on a real unique index", () => {
  it("createPerson rejects a second person with the same email in one tenant", async () => {
    const tenantId = await seedTenant(suite.db);
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");

    await run(suite.db, tenantId, (tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "A",
        role: "staff",
        pin: "5678",
        email: "owner@x.com",
      }),
    );

    // Different case, same address (lower(email) collides) — the translator maps 23505 → email_taken.
    await expect(
      run(suite.db, tenantId, (tx) =>
        createPerson(tx, {
          tenantId,
          managementSessionId: sessionId,
          displayName: "B",
          role: "staff",
          pin: "5678",
          email: "Owner@X.com",
        }),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "owner@x.com" } });
  });

  it("setEmail rejects a duplicate within a tenant", async () => {
    const tenantId = await seedTenant(suite.db);
    const { sessionId } = await openManagementSession(suite.db, tenantId, "manager");

    await run(suite.db, tenantId, (tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "A",
        role: "staff",
        pin: "5678",
        email: "owner@x.com",
      }),
    );
    const target = await seedPerson(suite.db, tenantId, "staff"); // email null

    await expect(
      run(suite.db, tenantId, (tx) =>
        setEmail(tx, { managementSessionId: sessionId, personId: target, email: "owner@x.com" }),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "owner@x.com" } });
  });
});

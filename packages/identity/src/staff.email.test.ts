import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { describe, expect, it } from "vitest";
import { createPerson, setEmail } from "./staff.js";
import { openManagementSession, seedPerson } from "../test/fixtures.js";

// Real Postgres, unlike the PGlite staff.test.ts. The `person.email_taken` path depends on the DB's
// functional partial unique index (persons_tenant_email_uq) firing SQLSTATE 23505, which the
// production translator (`isUniqueViolation`, a Drizzle-cause-chain walk) then maps to the domain
// error. PGlite is a superuser that serialises every query and need not reproduce that constraint
// faithfully, so the duplicate must be proven against a real server — the same reason
// persons.email.test.ts uses a real backend. The connection here is the template's OWNER: the
// unique INDEX fires for any role, so this drives
// the gated createPerson/setEmail API exactly as the PGlite logic suite does, just on a backend that
// enforces the index.
const suite = useTemplateDb({ template: "core_identity" });

function run<T>(db: Database, tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, tenantId, fn);
}

describe("createPerson / setEmail email_taken on a real unique index", () => {
  it("createPerson rejects a second person with the same email in one tenant", async () => {
    const tenantId = await seedTenant(suite.admin);
    const { sessionId } = await openManagementSession(suite.admin, tenantId, "manager");

    await run(suite.admin, tenantId, (tx) =>
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
      run(suite.admin, tenantId, (tx) =>
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
    const tenantId = await seedTenant(suite.admin);
    const { sessionId } = await openManagementSession(suite.admin, tenantId, "manager");

    await run(suite.admin, tenantId, (tx) =>
      createPerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "A",
        role: "staff",
        pin: "5678",
        email: "owner@x.com",
      }),
    );
    const target = await seedPerson(suite.admin, tenantId, "staff"); // email null

    await expect(
      run(suite.admin, tenantId, (tx) =>
        setEmail(tx, { managementSessionId: sessionId, personId: target, email: "owner@x.com" }),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "owner@x.com" } });
  });
});

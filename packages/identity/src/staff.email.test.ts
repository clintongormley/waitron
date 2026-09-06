import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { describe, expect, it } from "vitest";
import { createPerson, setEmail } from "./staff.js";
import { openManagementSession, seedPerson } from "../test/fixtures.js";

// The `person.email_taken` path depends on the functional partial unique index
// (persons_tenant_email_uq) firing SQLSTATE 23505, which the production translator
// (`isUniqueViolation`, a Drizzle-cause-chain walk) then maps to the domain error. This runs on the
// real-PG tier's template, over the template's OWNER connection, so no privilege or role is under
// test — and PGlite 0.5.4 does enforce that index (measured), so this file is a candidate for the
// PGlite tier once the suites are re-tagged. Until then it drives the gated createPerson/setEmail
// API exactly as the PGlite logic suite does, one tier over.
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

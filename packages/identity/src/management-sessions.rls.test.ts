import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pgErrorCode, withTenant } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedPerson } from "../test/fixtures.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses row-level security outright, which is why PGlite cannot prove
// any of this. management_sessions grants app_user exactly SELECT, INSERT, UPDATE
// (drizzle/0006_superb_mojo.sql): a missing grant, or a DELETE grant that should not be there, is
// invisible under PGlite.
const PROBE_ROLE = "identity_mgmt_sessions_probe";
const PROBE_PASSWORD = "probe";

// A clone of the `core_identity` template (CORE + IDENTITY); the probe connections below authenticate
// as `identity_mgmt_sessions_probe`, a cluster-wide role the package globalSetup creates in place of
// the per-file `probeRole` this suite passed before the shared container.
const suite = useTemplateDb({ template: "core_identity" });

describe("management_sessions under real row-level security", () => {
  it("isolates a session by tenant: another tenant sees none, the owning tenant sees its one", async () => {
    const tenantA = await seedTenant(suite.admin);
    const tenantB = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantA);

    // Open a management session for tenant A as the superuser (RLS bypassed), so there IS a row to
    // hide.
    await suite.admin.execute(sql`
      insert into management_sessions (tenant_id, person_id)
      values (${tenantA}, ${personId})`);

    // Read back as the superuser (bypasses RLS): a write that silently landed nothing would make the
    // scoped read below report 0 for the wrong reason — hiding nothing is not hiding something.
    const seen = await suite.admin.execute<{ count: string }>(
      sql`select count(*) as count from management_sessions where tenant_id = ${tenantA}`,
    );
    expect(seen.rows[0]!.count).toBe("1");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // The other tenant sees nothing — the USING predicate filters tenant A's row out. Weakening
      // management_sessions_tenant_isolation's USING to `true` leaks tenant A's row here.
      const cross = await withTenant(probe, tenantB, (tx) =>
        tx.execute<{ id: string }>(sql`select id from management_sessions`),
      );
      expect(cross.rows).toEqual([]);

      // The owning tenant sees exactly its one row. Removing the policy entirely (ENABLE with no
      // policy denies a non-owner everything) empties this and fails the assertion.
      const own = await withTenant(probe, tenantA, (tx) =>
        tx.execute<{ person_id: string; ended_at: string | null }>(
          sql`select person_id, ended_at from management_sessions`,
        ),
      );
      expect(own.rows).toEqual([{ person_id: personId, ended_at: null }]);
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    // The isolation policy fails closed: current_tenant_id() is NULL outside withTenant, so a bare
    // select sees zero rows however many exist. Proven by writing a REAL row first (so there is
    // something to hide) and then reading through a connection with no GUC — a plain empty table
    // would pass this assertion vacuously, for the wrong reason.
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into management_sessions (tenant_id, person_id)
          values (${tenant}, ${personId})`),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from management_sessions`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("lets app_user stamp ended_at on its own tenant's session — management_sessions is MUTABLE", async () => {
    // The mutable half of the grant. A management session is closed by stamping ended_at on sign-out,
    // not by deleting the row, so UPDATE must succeed as the probe role. Removing UPDATE from
    // 0006_superb_mojo.sql's GRANT fails this with 42501 (permission denied for table
    // management_sessions).
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into management_sessions (tenant_id, person_id)
          values (${tenant}, ${personId})`),
      );
      await withTenant(probe, tenant, (tx) =>
        tx.execute(
          sql`update management_sessions set ended_at = now() where tenant_id = ${tenant}`,
        ),
      );
      const rows = await withTenant(probe, tenant, (tx) =>
        tx.execute<{ ended: boolean }>(
          sql`select ended_at is not null as ended from management_sessions where tenant_id = ${tenant}`,
        ),
      );
      expect(rows.rows).toEqual([{ ended: true }]);
    } finally {
      await probe.close();
    }
  });

  it("refuses to delete a management session — DELETE was never granted to the app role", async () => {
    // management_sessions is mutable but never deleted: a session is ended by stamping ended_at, never
    // removed. The grant is exactly SELECT, INSERT, UPDATE, so a DELETE fails with 42501. Adding
    // DELETE to 0006_superb_mojo.sql's GRANT turns this green — this is the test that would catch that.
    const tenant = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenant);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenant, (tx) =>
        tx.execute(sql`
          insert into management_sessions (tenant_id, person_id)
          values (${tenant}, ${personId})`),
      );
      const error = await withTenant(probe, tenant, (tx) =>
        tx
          .execute(sql`delete from management_sessions where tenant_id = ${tenant}`)
          .then(() => undefined)
          .catch((e: unknown) => e),
      );
      expect(pgErrorCode(error)).toBe("42501"); // insufficient_privilege
    } finally {
      await probe.close();
    }
  });
});

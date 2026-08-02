import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { pgErrorCode } from "@waitron/db";
import { hashPin } from "./verify-pin.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove any
// of this. persons grants app_user exactly SELECT, INSERT, UPDATE (drizzle/0001_workforce_rls.sql):
// a missing SELECT/INSERT/UPDATE grant, or a DELETE grant that should not be there, is invisible
// under PGlite.
const PROBE_ROLE = "workforce_rls_probe";
const PROBE_PASSWORD = "probe";

const PIN = hashPin("1234");

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

describe("persons under real row-level security", () => {
  it("writes and reads its own tenant's person as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          insert into persons (tenant_id, display_name, pin_hash)
          values (${tenantId}, 'Ana', ${PIN})`),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ display_name: string; role: string }>(sql`
          select display_name, role from persons where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ display_name: "Ana", role: "staff" }]);
    } finally {
      await probe.close();
    }
  });

  it("updates its own tenant's person as a non-superuser app_user member", async () => {
    // The mutable half of the grant. persons carries no append-only trigger — a person is retired by
    // flipping status, not deleted — so UPDATE must succeed as the probe role. Removing UPDATE from
    // 0001_workforce_rls.sql's GRANT fails this with 42501 (permission denied for table persons).
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          insert into persons (tenant_id, display_name, pin_hash)
          values (${tenantId}, 'Ben', ${PIN})`),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          update persons set status = 'suspended' where tenant_id = ${tenantId}`),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ status: string }>(sql`
          select status from persons where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ status: "suspended" }]);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's person", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        tx.execute(sql`
          insert into persons (tenant_id, display_name, pin_hash)
          values (${theirs}, 'Theirs', ${PIN})`),
      );

      // Read back as the superuser, which bypasses RLS: without this, a put that silently wrote
      // nothing would leave the table empty and the scoped read below would report 0 for the wrong
      // reason — hiding nothing is not the same as hiding something.
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from persons where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from persons`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    // The isolation policy fails closed: current_tenant_id() is NULL outside withTenant, so a bare
    // select sees zero rows however many exist. Proven by writing a REAL row first (so there is
    // something to hide) and then reading through a connection with no GUC set — a plain empty table
    // would pass this assertion vacuously, for the wrong reason.
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          insert into persons (tenant_id, display_name, pin_hash)
          values (${tenantId}, 'Cleo', ${PIN})`),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from persons`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("refuses to delete a person — DELETE was never granted to the app role", async () => {
    // persons is mutable but never deleted: a person is retired via status, and the time history
    // Slice 2 will hang off this row must not lose its referent. The grant is exactly
    // SELECT, INSERT, UPDATE, so a DELETE fails with 42501. Adding DELETE to 0001_workforce_rls.sql's
    // GRANT turns this green — this is the test that would catch that.
    const tenantId = await seedTenant(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          insert into persons (tenant_id, display_name, pin_hash)
          values (${tenantId}, 'Dora', ${PIN})`),
      );
      const error = await withTenant(probe, tenantId, (tx) =>
        tx
          .execute(sql`delete from persons where tenant_id = ${tenantId}`)
          .then(() => undefined)
          .catch((e: unknown) => e),
      );
      expect(pgErrorCode(error)).toBe("42501"); // insufficient_privilege
    } finally {
      await probe.close();
    }
  });
});

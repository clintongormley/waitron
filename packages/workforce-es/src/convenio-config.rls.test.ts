import { pgErrorCode, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { startRealPostgres } from "./testing/postgres.js";
import { seedLocation } from "../test/fixtures.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove any
// of this. convenio_config grants SELECT, INSERT, UPDATE (drizzle/0001_convenio_config_rls.sql).
const PROBE_ROLE = "convenio_es_rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

/** Inserts a convenio_config row for (tenant, location) via SQL, under whatever tx it is handed. */
function insertConfig(tx: Transaction, tenantId: string, locationId: string) {
  return tx.execute(sql`
    insert into convenio_config (tenant_id, location_id) values (${tenantId}, ${locationId})`);
}

describe("convenio_config under real row-level security", () => {
  it("writes and reads its own tenant's convenio_config as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) => insertConfig(tx, tenantId, locationId));
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ w: number }>(sql`
          select working_days_per_week as w from convenio_config where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ w: 5 }]);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's convenio_config", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirLocation = await seedLocation(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) => insertConfig(tx, theirs, theirLocation));
      // Read back as the superuser (bypasses RLS): hiding nothing is not the same as hiding something.
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from convenio_config where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from convenio_config`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    const tenantId = await seedTenant(suite.admin);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) => insertConfig(tx, tenantId, locationId));
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from convenio_config`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("lets the app role UPDATE a convenio_config row — it is mutable configuration, not the record", async () => {
    // The inverse of the time_entries immutability proof: convenio_config is config an admin edits, so
    // UPDATE is granted and succeeds. Removing UPDATE from 0001's GRANT is what this would catch.
    const tenantId = await seedTenant(suite.admin);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) => insertConfig(tx, tenantId, locationId));
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`
          update convenio_config set overtime_model = 'period_net' where tenant_id = ${tenantId}`),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ m: string }>(sql`
          select overtime_model as m from convenio_config where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ m: "period_net" }]);
    } finally {
      await probe.close();
    }
  });

  it("refuses to DELETE a convenio_config row — DELETE was never granted to the app role", async () => {
    // The grant shape from the app role's side: exactly SELECT, INSERT, UPDATE, so a DELETE fails with
    // 42501. Adding DELETE to 0001_convenio_config_rls.sql's GRANT is what this would catch.
    const tenantId = await seedTenant(suite.admin);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) => insertConfig(tx, tenantId, locationId));
      const error = await withTenant(probe, tenantId, (tx) =>
        tx
          .execute(sql`delete from convenio_config where tenant_id = ${tenantId}`)
          .then(() => undefined)
          .catch((e: unknown) => e),
      );
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await probe.close();
    }
  });
});

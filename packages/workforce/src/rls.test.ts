import { pgErrorCode, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { startRealPostgres } from "./testing/postgres.js";
import { insertTimeEntry, seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove any
// of this. employments grants SELECT, INSERT, UPDATE; time_entries grants only SELECT, INSERT
// (drizzle/0001_workforce_d1a_rls.sql).
const PROBE_ROLE = "workforce_rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

describe("employments under real row-level security", () => {
  it("writes and reads its own tenant's employment as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) => seedEmployment(tx, { tenantId, personId }));
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ c: number }>(sql`
          select contracted_minutes_per_week as c from employments where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ c: 2400 }]);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's employment", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirPerson = await seedPerson(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        seedEmployment(tx, { tenantId: theirs, personId: theirPerson }),
      );
      // Read back as the superuser (bypasses RLS): without this, a write that silently wrote nothing
      // would leave the scoped read below reporting 0 for the wrong reason — hiding nothing is not
      // the same as hiding something.
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from employments where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from employments`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) => seedEmployment(tx, { tenantId, personId }));
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from employments`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("time_entries under real row-level security", () => {
  it("appends and reads its own tenant's clock event as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        insertTimeEntry(tx, { tenantId, personId, locationId }),
      );
      const rows = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ entry_kind: string }>(sql`
          select entry_kind from time_entries where tenant_id = ${tenantId}`),
      );
      expect(rows.rows).toEqual([{ entry_kind: "in" }]);
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's clock event", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirPerson = await seedPerson(suite.admin, theirs);
    const theirLocation = await seedLocation(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertTimeEntry(tx, {
          tenantId: theirs,
          personId: theirPerson,
          locationId: theirLocation,
        }),
      );
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from time_entries where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from time_entries`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("returns nothing at all with no tenant GUC set", async () => {
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        insertTimeEntry(tx, { tenantId, personId, locationId }),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from time_entries`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's chain head — workforce_chains is tenant-isolated too (Slice 4)", async () => {
    // The chain head is written by appendToChain (through insertTimeEntry here) and carries the same
    // FORCE RLS + tenant policy as the entries it tracks (0006). A tenant must not see another's head
    // row, or a cross-tenant reader could infer another venue's clock volume.
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirPerson = await seedPerson(suite.admin, theirs);
    const theirLocation = await seedLocation(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertTimeEntry(tx, { tenantId: theirs, personId: theirPerson, locationId: theirLocation }),
      );
      // Confirmed present as the superuser (bypasses RLS) — hiding nothing is not hiding something.
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from workforce_chains where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from workforce_chains`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("refuses to delete a clock event — DELETE was never granted to the app role", async () => {
    // The append-only floor from the app role's side, complementing immutability.test.ts's owner-side
    // proof: the grant is exactly SELECT, INSERT, so a DELETE fails with 42501. Adding DELETE to
    // 0001_workforce_d1a_rls.sql's GRANT is what this would catch.
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantId, (tx) =>
        insertTimeEntry(tx, { tenantId, personId, locationId }),
      );
      const error = await withTenant(probe, tenantId, (tx) =>
        tx
          .execute(sql`delete from time_entries where tenant_id = ${tenantId}`)
          .then(() => undefined)
          .catch((e: unknown) => e),
      );
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await probe.close();
    }
  });
});

import { withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { startRealPostgres } from "./testing/postgres.js";
import {
  insertAbsence,
  insertAvailability,
  insertDraftShift,
  insertShiftSwap,
  insertShiftTemplate,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove any
// of this. absences/availability/shift_templates/shift_swaps grant SELECT, INSERT, UPDATE, DELETE
// (drizzle 0010): they are PLANNING data, discardable, the inverse of time_entries' append-only floor.
const PROBE_ROLE = "workforce_planning_rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
});

describe("absences under real row-level security (planning data, fully mutable)", () => {
  it("writes, reads, updates and DELETES its own tenant's absence as a non-superuser app_user member", async () => {
    // The whole mutability grant in one test: SELECT, INSERT, UPDATE and DELETE. Removing DELETE (or
    // UPDATE) from 0010's GRANT fails the corresponding step here with 42501 — the inverse of
    // time_entries' append-only floor.
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const absenceId = await withTenant(probe, tenantId, (tx) =>
        insertAbsence(tx, { tenantId, personId }),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update absences set status = 'approved' where id = ${absenceId}`),
      );
      const afterUpdate = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ status: string }>(sql`select status from absences where id = ${absenceId}`),
      );
      expect(afterUpdate.rows).toEqual([{ status: "approved" }]);

      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from absences where id = ${absenceId}`),
      );
      const afterDelete = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from absences`),
      );
      expect(afterDelete.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's absence", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirPerson = await seedPerson(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertAbsence(tx, { tenantId: theirs, personId: theirPerson }),
      );
      // Read back as the superuser (bypasses RLS): a write that silently wrote nothing would leave
      // the scoped read below reporting 0 for the wrong reason.
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from absences where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from absences`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("availability under real row-level security (planning data, fully mutable)", () => {
  it("writes, reads, updates and DELETES its own tenant's availability window", async () => {
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = await withTenant(probe, tenantId, (tx) =>
        insertAvailability(tx, { tenantId, personId }),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update availability set available_to_minute = 1080 where id = ${id}`),
      );
      const afterUpdate = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ available_to_minute: number }>(
          sql`select available_to_minute from availability where id = ${id}`,
        ),
      );
      expect(afterUpdate.rows).toEqual([{ available_to_minute: 1080 }]);

      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from availability where id = ${id}`),
      );
      const afterDelete = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from availability`),
      );
      expect(afterDelete.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's availability window", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirPerson = await seedPerson(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertAvailability(tx, { tenantId: theirs, personId: theirPerson }),
      );
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from availability where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from availability`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("shift_templates under real row-level security (planning data, fully mutable)", () => {
  it("writes, reads, updates and DELETES its own tenant's template", async () => {
    const tenantId = await seedTenant(suite.admin);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = await withTenant(probe, tenantId, (tx) =>
        insertShiftTemplate(tx, { tenantId, locationId }),
      );
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update shift_templates set role = 'kitchen' where id = ${id}`),
      );
      const afterUpdate = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ role: string }>(sql`select role from shift_templates where id = ${id}`),
      );
      expect(afterUpdate.rows).toEqual([{ role: "kitchen" }]);

      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from shift_templates where id = ${id}`),
      );
      const afterDelete = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from shift_templates`),
      );
      expect(afterDelete.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's template", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirLocation = await seedLocation(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertShiftTemplate(tx, { tenantId: theirs, locationId: theirLocation }),
      );
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from shift_templates where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from shift_templates`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("shift_swaps under real row-level security (planning data, fully mutable)", () => {
  it("writes, reads, updates and DELETES its own tenant's swap", async () => {
    const tenantId = await seedTenant(suite.admin);
    const requester = await seedPerson(suite.admin, tenantId, "Ana");
    const toPerson = await seedPerson(suite.admin, tenantId, "Beto");
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = await withTenant(probe, tenantId, async (tx) => {
        const fromShiftId = await insertDraftShift(tx, {
          tenantId,
          personId: requester,
          locationId,
        });
        return insertShiftSwap(tx, {
          tenantId,
          requestedByPersonId: requester,
          fromShiftId,
          toPersonId: toPerson,
        });
      });
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update shift_swaps set status = 'accepted' where id = ${id}`),
      );
      const afterUpdate = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ status: string }>(sql`select status from shift_swaps where id = ${id}`),
      );
      expect(afterUpdate.rows).toEqual([{ status: "accepted" }]);

      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from shift_swaps where id = ${id}`),
      );
      const afterDelete = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from shift_swaps`),
      );
      expect(afterDelete.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's swap", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const requester = await seedPerson(suite.admin, theirs, "Ana");
    const toPerson = await seedPerson(suite.admin, theirs, "Beto");
    const theirLocation = await seedLocation(suite.admin, theirs);
    const fromShiftId = await insertDraftShift(suite.admin, {
      tenantId: theirs,
      personId: requester,
      locationId: theirLocation,
    });
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertShiftSwap(tx, {
          tenantId: theirs,
          requestedByPersonId: requester,
          fromShiftId,
          toPersonId: toPerson,
        }),
      );
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from shift_swaps where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from shift_swaps`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("row-level security is enabled AND forced on the D2.2 planning tables", () => {
  it("has relrowsecurity and relforcerowsecurity on all four", async () => {
    // ENABLE alone (drizzle's .enableRLS(), migration 0009) leaves the owner and every superuser
    // exempt; FORCE (the hand-written 0010) is what binds the deployment role. Deleting any FORCE
    // line drops that table's relforcerowsecurity to false and fails this.
    const result = await suite.admin.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in ('absences', 'availability', 'shift_templates', 'shift_swaps')
      order by relname`);
    expect(result.rows).toEqual([
      { relname: "absences", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "availability", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "shift_swaps", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "shift_templates", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});

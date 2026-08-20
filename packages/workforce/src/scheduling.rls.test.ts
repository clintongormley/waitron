import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  insertDraftShift,
  insertRosterVersion,
  insertTimeEntry,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

// A non-superuser LOGIN role inheriting app_user's grants. Being non-superuser is what makes RLS
// apply at all — a superuser bypasses FORCE ROW LEVEL SECURITY, which is why PGlite cannot prove any
// of this. shifts and roster_versions grant SELECT, INSERT, UPDATE, DELETE (drizzle 0006): they are
// PLANNING data, discardable, the inverse of time_entries' append-only floor.
const PROBE_ROLE = "workforce_rls_probe";
const PROBE_PASSWORD = "probe";

// A clone of the `core_identity_workforce` template (CORE + IDENTITY + WORKFORCE); the probe
// connections below authenticate as `workforce_rls_probe`, a cluster-wide role the package
// globalSetup creates in place of the per-file `probeRole` this suite passed before the shared
// container. That role is SHARED with rls.test.ts — both connectAs it — so it is created once for
// the whole cluster rather than per file.
const suite = useTemplateDb({ template: "core_identity_workforce" });

class RollbackSignal extends Error {}

describe("shifts under real row-level security (planning data, fully mutable)", () => {
  it("writes, reads, updates and DELETES its own tenant's draft shift as a non-superuser app_user member", async () => {
    // The whole mutability grant in one test: SELECT, INSERT, UPDATE and — unlike persons/employments
    // — DELETE. A draft shift is discardable planning data, so removing DELETE from 0006's GRANT would
    // fail the delete step here with 42501. This is the positive half of the mutability boundary.
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const shiftId = await withTenant(probe, tenantId, (tx) =>
        insertDraftShift(tx, { tenantId, personId, locationId }),
      );

      // UPDATE — a shift is moved / re-roled freely (planning data). Removing UPDATE from 0006 fails
      // this with 42501.
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`update shifts set role = 'kitchen' where id = ${shiftId}`),
      );
      const afterUpdate = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ role: string }>(sql`select role from shifts where id = ${shiftId}`),
      );
      expect(afterUpdate.rows).toEqual([{ role: "kitchen" }]);

      // DELETE — a draft roster is thrown away. Removing DELETE from 0006 fails this with 42501.
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from shifts where id = ${shiftId}`),
      );
      const afterDelete = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from shifts`),
      );
      expect(afterDelete.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's shift", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirPerson = await seedPerson(suite.admin, theirs);
    const theirLocation = await seedLocation(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertDraftShift(tx, {
          tenantId: theirs,
          personId: theirPerson,
          locationId: theirLocation,
        }),
      );
      // Read back as the superuser (bypasses RLS): without this, a write that silently wrote nothing
      // would leave the scoped read below reporting 0 for the wrong reason — hiding nothing is not
      // the same as hiding something.
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from shifts where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from shifts`),
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
        insertDraftShift(tx, { tenantId, personId, locationId }),
      );
      const rows = await probe.execute<{ count: string }>(
        sql`select count(*) as count from shifts`,
      );
      expect(rows.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("roster_versions under real row-level security (planning data, fully mutable)", () => {
  it("writes, reads, updates and DELETES its own tenant's roster version as a non-superuser app_user member", async () => {
    const tenantId = await seedTenant(suite.admin);
    const locationId = await seedLocation(suite.admin, tenantId);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const versionId = await withTenant(probe, tenantId, (tx) =>
        insertRosterVersion(tx, { tenantId, locationId }),
      );
      // A plain mutable field on a still-draft version — extend the period. (Not `status`: flipping
      // it without stamping `published_at` trips roster_versions_publish_shape_ck; that invariant is
      // exercised in scheduling.test.ts.) Removing UPDATE from 0006 fails this with 42501.
      await withTenant(probe, tenantId, (tx) =>
        tx.execute(
          sql`update roster_versions set period_end = '2026-01-12' where id = ${versionId}`,
        ),
      );
      const afterUpdate = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ period_end: string }>(
          sql`select period_end from roster_versions where id = ${versionId}`,
        ),
      );
      expect(afterUpdate.rows).toEqual([{ period_end: "2026-01-12" }]);

      await withTenant(probe, tenantId, (tx) =>
        tx.execute(sql`delete from roster_versions where id = ${versionId}`),
      );
      const afterDelete = await withTenant(probe, tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from roster_versions`),
      );
      expect(afterDelete.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });

  it("hides another tenant's roster version", async () => {
    const mine = await seedTenant(suite.admin);
    const theirs = await seedTenant(suite.admin);
    const theirLocation = await seedLocation(suite.admin, theirs);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, theirs, (tx) =>
        insertRosterVersion(tx, { tenantId: theirs, locationId: theirLocation }),
      );
      const seen = await suite.admin.execute<{ count: string }>(
        sql`select count(*) as count from roster_versions where tenant_id = ${theirs}`,
      );
      expect(seen.rows[0]!.count).toBe("1");

      const visible = await withTenant(probe, mine, (tx) =>
        tx.execute<{ count: string }>(sql`select count(*) as count from roster_versions`),
      );
      expect(visible.rows[0]!.count).toBe("0");
    } finally {
      await probe.close();
    }
  });
});

describe("row-level security is enabled AND forced on the scheduling tables", () => {
  it("has relrowsecurity and relforcerowsecurity on shifts and roster_versions", async () => {
    // ENABLE alone (drizzle's .enableRLS(), migration 0005) leaves the owner and every superuser
    // exempt; FORCE (the hand-written 0006) is what binds the deployment role. Deleting either FORCE
    // line drops relforcerowsecurity to false and fails this.
    const result = await suite.admin.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in ('shifts', 'roster_versions')
      order by relname`);
    expect(result.rows).toEqual([
      { relname: "roster_versions", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "shifts", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});

/**
 * The point of the slice: shifts (planning) and time_entries (the legal registro) live under
 * OPPOSITE mutability regimes, and this asserts both in the same suite so the difference is visible.
 * Planning data can be rewritten; the immutable record cannot, even when the privilege is granted.
 */
describe("the mutability boundary: planning data is mutable, the legal record is not", () => {
  async function asApp<T>(tenantId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  it("lets the app role UPDATE and DELETE a shift, but rejects a time_entries UPDATE with WT001", async () => {
    const tenantId = await seedTenant(suite.admin);
    const personId = await seedPerson(suite.admin, tenantId);
    const locationId = await seedLocation(suite.admin, tenantId);

    // Planning side — a shift is ordinary mutable data: UPDATE then DELETE both succeed as app_user.
    await asApp(tenantId, async (tx) => {
      const shiftId = await insertDraftShift(tx, { tenantId, personId, locationId });
      await tx.execute(sql`update shifts set role = 'bar' where id = ${shiftId}`);
      await tx.execute(sql`delete from shifts where id = ${shiftId}`);
    });

    // Legal side — the immutable registro. Grant UPDATE inside a rolled-back transaction (so the two
    // REVOKE-based tests elsewhere never reach the trigger) and watch the append-only trigger reject
    // the mutation with WT001. Same layered proof as immutability.test.ts. If shifts and time_entries
    // shared a regime, this would not throw — that they diverge is the whole slice.
    await withTenant(suite.admin, tenantId, async (tx) => {
      await tx.execute(sql`grant update on time_entries to app_user`);
      await tx.execute(sql`set local role app_user`);
      await insertTimeEntry(tx, { tenantId, personId, locationId });
      const error = await captureError(() =>
        tx.execute(sql`update time_entries set event_offset_minutes = 0`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      throw new RollbackSignal();
    }).catch((e: unknown) => {
      if (!(e instanceof RollbackSignal)) throw e;
    });
  });
});

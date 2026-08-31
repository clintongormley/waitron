import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { kitchenStations } from "./kitchen-stations.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: RLS as the non-owner app role is a false pass on
// PGlite, which connects as superuser and bypasses FORCE (CLAUDE.md §4). Scaffolding ported from
// floor-zones.rls.test.ts — useTemplateDb + withTenant + asAppUser (the current shared-container
// tier; `useRealPostgres`'s per-file container is what it superseded, same { pg, admin } shape).
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";

class RollbackSignal extends Error {}
async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("kitchen_stations schema (RLS + grants + partial unique)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location per tenant (plus a second for A): kitchen_stations carries a tenant-consistent
    // (tenant_id, location_id) FK, so every station insert needs a real owning location. Seeded as
    // the superuser admin (bypasses RLS). operation_description is Spanish test DATA, not a schema
    // identifier, exactly as the sibling floor-zones test uses 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_A2}, ${TENANT_A}, 'Loc A2', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedStation(
    tenant: string,
    location: string,
    name: string,
    isDefault = false,
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into kitchen_stations (tenant_id, location_id, name, is_default)
            values (${tenant}, ${location}, ${name}, ${isDefault}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits SELECT/INSERT/UPDATE as the non-owner app role (the control)", async () => {
    const id = await seedStation(TENANT_A, LOCATION_A, "Cocina");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update kitchen_stations set display_order = 5 where id = ${id}`),
    );
    // Read back through the Drizzle `kitchenStations` export (not raw SQL) — exercises the produced
    // table export and its column mapping under the app role, incl. the new is_default column.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(kitchenStations)
        .where(sql`id = ${id}`),
    );
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Cocina");
    expect(row!.isDefault).toBe(false);
    expect(row!.active).toBe(true);
  });

  it("carries ordered timing thresholds with sane defaults (KDS order-timing alerts)", async () => {
    // The three per-station bands (warm/overdue/forgotten) default 5/10/15 minutes, and the
    // kitchen_stations_thresholds_ordered CHECK rejects an out-of-order UPDATE. Read back via raw SQL
    // (the columns are new); the ordering guard is the deletion-proof target — dropping the CHECK lets
    // warm=20 (>= overdue=10) through instead of raising 23514.
    const id = await seedStation(TENANT_A, LOCATION_A, "Timing station");
    const row = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ w: number; o: number; f: number }>(
          sql`select warm_after_minutes as w, overdue_after_minutes as o, forgotten_after_minutes as f
              from kitchen_stations where id = ${id}`,
        )
        .then((r) => r.rows[0]),
    );
    expect(row).toMatchObject({ w: 5, o: 10, f: 15 });
    // An out-of-order update (warm=20 >= overdue=10) violates the CHECK.
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update kitchen_stations set warm_after_minutes = 20 where id = ${id}`),
      ),
    );
    expect(pgErrorCode(e)).toBe("23514"); // check_violation
    expect(pgErrorMessage(e)).toMatch(/kitchen_stations_thresholds_ordered/);
  });

  it("app_user has no DELETE on kitchen_stations (deactivate, never delete)", async () => {
    const id = await seedStation(TENANT_A, LOCATION_A, "Plancha");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) => tx.execute(sql`delete from kitchen_stations where id = ${id}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    // The WITH-CHECK deletion-proof target: weakening WITH CHECK to (true) makes this foreign-tenant_id
    // INSERT succeed instead of raising 42501, flipping this test red.
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into kitchen_stations (tenant_id, location_id, name)
              values (${TENANT_A}, ${LOCATION_A}, 'Foreign')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's row is committed before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it. A full DROP POLICY is the
    // WRONG deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the opposite
    // reason. Mirrors floor-zones.rls.test.ts.
    const id = await seedStation(TENANT_A, LOCATION_A, "Leak-probe");
    expect(id).toBeDefined();
    // Control in the other direction (§4): under the REAL policy tenant B sees ZERO of A's rows, so the
    // `> 0` after weakening is attributable to the weakening rather than to B having read A all along.
    const foreignUnderRealPolicy = await asApp(TENANT_B, (tx) =>
      tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from kitchen_stations`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(foreignUnderRealPolicy).toBe(0);
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy kitchen_stations_tenant_isolation on kitchen_stations using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from kitchen_stations`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });

  it("rejects a SECOND default station per location (the WHERE is_default partial unique)", async () => {
    // Exactly one default per location: the first is_default row is accepted, a second at the SAME
    // location is a unique_violation (23505). A non-default second row is fine (only is_default rows
    // are indexed), and a default at a DIFFERENT location is fine (the index keys on location too) —
    // both asserted so the failure is the partial predicate, not a plain (tenant, location) unique.
    await seedStation(TENANT_A, LOCATION_A, "Default one", true);
    // A non-default sibling at the same location — permitted (not covered by the partial index).
    await seedStation(TENANT_A, LOCATION_A, "Non-default sibling", false);
    // A default at a DIFFERENT location — permitted (per-location, not per-tenant).
    await seedStation(TENANT_A, LOCATION_A2, "Default elsewhere", true);
    // A SECOND default at the same location — rejected.
    const e = await captureError(() => seedStation(TENANT_A, LOCATION_A, "Default two", true));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation
  });

  it("the partial unique index is what blocks the second default (proof by deletion of the index)", async () => {
    // Drop the index inside a ROLLED-BACK tx and the second default at the same location now succeeds —
    // proving the CREATE UNIQUE INDEX … WHERE is_default is the guard, not some other constraint. The
    // rollback keeps the real index for every other test. A dedicated location so this proof is immune
    // to whatever the test above committed.
    const probeLocation = "aaaaaaaa-0000-4000-8000-000000000003";
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${probeLocation}, ${TENANT_A}, 'Loc A3', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    await seedStation(TENANT_A, probeLocation, "Probe default", true);
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`drop index kitchen_stations_default_key`);
      await tx.execute(sql`set local role app_user`);
      // With the index gone, a second default at the same location goes through — no 23505.
      await tx.execute(
        sql`insert into kitchen_stations (tenant_id, location_id, name, is_default)
            values (${TENANT_A}, ${probeLocation}, 'Probe default two', true)`,
      );
      const n = await tx
        .execute<{ n: number }>(
          sql`select count(*)::int as n from kitchen_stations
              where location_id = ${probeLocation} and is_default`,
        )
        .then((r) => r.rows[0]!.n);
      expect(n).toBe(2); // two defaults coexist once the partial unique is dropped.
    });
  });
});

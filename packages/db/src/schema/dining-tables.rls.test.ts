import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { locations, tenants } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
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

describe("dining_tables schema (RLS + grants)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Loc A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      {
        id: LOCATION_B,
        tenantId: TENANT_B,
        name: "Loc B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedTable(tenant: string, location: string, label: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into dining_tables (tenant_id, location_id, label) values (${tenant}, ${location}, ${label}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits SELECT/INSERT/UPDATE as the non-owner app role (the control)", async () => {
    const id = await seedTable(TENANT_A, LOCATION_A, "T-control");
    // `capacity` (a plain nullable integer) since the former free-text `zone` column was dropped by
    // FP-1 in favour of the `zone_id` FK to floor_zones — this control only needs a writable column.
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update dining_tables set capacity = 4 where id = ${id}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ capacity: number }>(sql`select capacity from dining_tables where id = ${id}`)
        .then((r) => r.rows),
    );
    expect(row!.capacity).toBe(4);
  });

  it("exposes placement columns to app_user under the tenant policy", async () => {
    // FP-2 adds four nullable placement columns (pos_x, pos_y, shape, rotation) to dining_tables.
    // Being additive columns on an existing FORCE-RLS table, they inherit the table-wide UPDATE/SELECT
    // grant and the row-level tenant policy with no new migration — this asserts that inheritance:
    // app_user, scoped to its own tenant, can write and read them back. The drizzle query builder
    // (rather than raw SQL) also exercises the schema mapping posX→"pos_x" and the enum/smallint
    // decoding. This test does NOT re-prove tenant ISOLATION and does not need to: RLS is row-level,
    // so these additive columns are covered automatically by the table-wide policy — which IS proven
    // by deletion in the `tenant isolation is the policy PREDICATE's doing` case below (it weakens the
    // predicate in a rolled-back tx and shows TENANT_B then leaks A's row; a plain asAppUser drop would
    // NOT prove it, as `suite.admin` is a superuser that bypasses FORCE RLS). Here we only confirm the
    // four new columns are reachable under the REAL policy: a write + read-back within TENANT_A.
    const id = await seedTable(TENANT_A, LOCATION_A, "T-placement");
    await asApp(TENANT_A, (tx) =>
      tx
        .update(diningTables)
        .set({ posX: 500, posY: 250, shape: "square", rotation: 15 })
        .where(eq(diningTables.id, id)),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx.select().from(diningTables).where(eq(diningTables.id, id)),
    );
    expect(row).toMatchObject({ posX: 500, posY: 250, shape: "square", rotation: 15 });
  });

  it("app_user has no DELETE on dining_tables (deactivate, never delete)", async () => {
    const id = await seedTable(TENANT_A, LOCATION_A, "T-nodelete");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) => tx.execute(sql`delete from dining_tables where id = ${id}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    // Tenant B tries to insert a row tagged tenant A — RLS WITH CHECK rejects it (42501), the write
    // path isolation PGlite's superuser could not show.
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, 'T-foreign')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's row is committed before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it — so `tenant_id =
    // current_tenant_id()`, not mere table access, is the guard. A full DROP POLICY is the WRONG
    // deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the opposite reason.
    const id = await seedTable(TENANT_A, LOCATION_A, "T-leak");
    expect(id).toBeDefined();
    // Control in the other direction (§4): under the REAL policy tenant B sees ZERO of A's rows. This
    // is what makes the `> 0` after weakening attributable to the weakening — without it, a mutation
    // that left B able to read A's rows all along would still satisfy the leak assertion below.
    const foreignUnderRealPolicy = await asApp(TENANT_B, (tx) =>
      tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from dining_tables`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(foreignUnderRealPolicy).toBe(0);
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy dining_tables_tenant_isolation on dining_tables using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from dining_tables`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });
});

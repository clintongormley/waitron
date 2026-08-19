import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

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

describe("table_service_statuses schema (RLS + grants)", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The table_service_statuses RLS suite requires a running Docker daemon. It cannot be " +
          "skipped: PGlite runs every connection as a superuser, bypassing the FORCE ROW LEVEL " +
          "SECURITY and the grant shape (SELECT/INSERT/UPDATE, no DELETE) this suite exists to prove.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    timeoutMs: 120_000,
  });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedStatus(tenant: string, label: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into table_service_statuses (tenant_id, label, color) values (${tenant}, ${label}, '#ef4444') returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits SELECT/INSERT/UPDATE as the non-owner app role (the control)", async () => {
    const id = await seedStatus(TENANT_A, "Bill requested");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update table_service_statuses set color = '#22c55e' where id = ${id}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ color: string }>(sql`select color from table_service_statuses where id = ${id}`)
        .then((r) => r.rows),
    );
    expect(row!.color).toBe("#22c55e");
  });

  it("app_user has no DELETE on table_service_statuses (deactivate, never delete)", async () => {
    const id = await seedStatus(TENANT_A, "Needs cleaning");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) => tx.execute(sql`delete from table_service_statuses where id = ${id}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into table_service_statuses (tenant_id, label, color) values (${TENANT_A}, 'Foreign', '#000')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's row is committed before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it. A full DROP POLICY is the
    // WRONG deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the opposite
    // reason.
    const id = await seedStatus(TENANT_A, "Leak-probe");
    expect(id).toBeDefined();
    // Control in the other direction (§4): under the REAL policy tenant B sees ZERO of A's rows. This is
    // what makes the `> 0` after weakening attributable to the weakening — without it, a mutation that left
    // B able to read A's rows all along would still satisfy the leak assertion below (the USING/read side
    // would go untested). Mirrors dining-tables.rls.test.ts.
    const foreignUnderRealPolicy = await asApp(TENANT_B, (tx) =>
      tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from table_service_statuses`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(foreignUnderRealPolicy).toBe(0);
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy table_service_statuses_tenant_isolation on table_service_statuses using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from table_service_statuses`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });

  it("dining_tables.status_id is writable/readable by the non-owner app_user and enforces the tenant-consistent FK", async () => {
    // Seed a location + a dining table (TS-1) as the owner, then set + read status_id as app_user.
    const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    const tableId = await asApp(TENANT_A, async (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into dining_tables (tenant_id, location_id, label) values (${TENANT_A}, ${LOCATION_A}, 'T-status') returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    const statusId = await seedStatus(TENANT_A, "Bill requested TS2");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update dining_tables set status_id = ${statusId} where id = ${tableId}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ status_id: string | null }>(
          sql`select status_id from dining_tables where id = ${tableId}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.status_id).toBe(statusId);

    // The FK rejects a status_id that names no row at all (a random uuid) — 23503. This case proves FK
    // EXISTENCE; a plain single-column FK would reject it identically, so it does not on its own
    // distinguish the composite (tenant_id, status_id) FK from a single-column one.
    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update dining_tables set status_id = '99999999-9999-4999-8999-999999999999' where id = ${tableId}`,
        ),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503"); // foreign_key_violation

    // The case a SINGLE-COLUMN FK would let through: a status that genuinely EXISTS, but belongs to
    // another tenant. B seeds a real status (committed — `asApp` does not roll back), then A points its
    // dining_table at B's status id. A single-column FK on status_id alone would find B's row and PASS;
    // the composite FK requires a `table_service_statuses` row with (tenant_id = TENANT_A, id = B's id),
    // which does not exist (B's row carries tenant_id = TENANT_B), so it is a 23503. The FK check fires
    // on the raw id at write time regardless of A's RLS read-visibility of B's row. This is what makes
    // the test title ("tenant-consistent FK") honest — it now distinguishes composite from single-column.
    const foreignStatusId = await seedStatus(TENANT_B, "B's status");
    const eForeign = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update dining_tables set status_id = ${foreignStatusId} where id = ${tableId}`,
        ),
      ),
    );
    expect(pgErrorCode(eForeign)).toBe("23503"); // foreign_key_violation — (TENANT_A, B's id) has no match
  });
});

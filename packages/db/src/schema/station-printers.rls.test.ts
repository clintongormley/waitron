import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { stationPrinters } from "./station-printers.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: RLS as the non-owner app role is a false pass on
// PGlite, which connects as superuser and bypasses FORCE (CLAUDE.md §4). Scaffolding ported from
// printing.rls.test.ts / kitchen-stations.rls.test.ts — useTemplateDb + withTenant + asAppUser.
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

describe("station_printers schema (KDS-4 mapping — RLS + grants + FORCE + composite FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location per tenant — the owning location the station + printer each reference. Seeded as the
    // superuser admin (bypasses RLS). operation_description is Spanish test DATA, not a schema
    // identifier, exactly as the sibling printing/kitchen-stations tests use 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  function locationOf(tenant: string): string {
    return tenant === TENANT_A ? LOCATION_A : LOCATION_B;
  }

  async function seedStation(tenant: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into kitchen_stations (tenant_id, location_id, name)
            values (${tenant}, ${locationOf(tenant)}, ${name}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // A cloud_poll printer (needs only poll_id — no agent, so no print_agents fixture) satisfies the
  // printers transport CHECK, keeping this suite to the two tables the mapping actually references.
  async function seedPrinter(tenant: string, name: string, pollId: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into printers (tenant_id, location_id, name, transport, poll_id)
            values (${tenant}, ${locationOf(tenant)}, ${name}, 'cloud_poll', ${pollId}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedMapping(tenant: string, station: string, printer: string): Promise<void> {
    await asApp(tenant, (tx) =>
      tx.execute(
        sql`insert into station_printers (tenant_id, station_id, printer_id)
            values (${tenant}, ${station}, ${printer})`,
      ),
    );
  }

  async function forceFlag(target: Database, relname: string): Promise<boolean> {
    const r = await target.execute<{ f: boolean }>(
      sql`select relforcerowsecurity as f from pg_class
          where relname = ${relname} and relnamespace = 'public'::regnamespace`,
    );
    return r.rows[0]!.f;
  }

  it("permits SELECT/INSERT/DELETE as the non-owner app role (the control)", async () => {
    const station = await seedStation(TENANT_A, "Cocina");
    const printer = await seedPrinter(TENANT_A, "Impresora Cocina", "poll-control");
    await seedMapping(TENANT_A, station, printer);
    // Read back through the Drizzle `stationPrinters` export (not raw SQL) — exercises the produced
    // table export and its column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(stationPrinters)
        .where(sql`station_id = ${station}`),
    );
    expect(row!.tenantId).toBe(TENANT_A);
    expect(row!.stationId).toBe(station);
    expect(row!.printerId).toBe(printer);
    // A mapping row is REMOVED via DELETE (app_user holds DELETE — detach in §3a).
    const deleted = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ printer_id: string }>(
          sql`delete from station_printers where station_id = ${station} and printer_id = ${printer}
              returning printer_id`,
        )
        .then((r) => r.rows),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.printer_id).toBe(printer);
  });

  it("app_user has NO UPDATE (a mapping is added/removed, never edited)", async () => {
    const station = await seedStation(TENANT_A, "Plancha");
    const printer = await seedPrinter(TENANT_A, "Impresora Plancha", "poll-noupdate");
    await seedMapping(TENANT_A, station, printer);
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update station_printers set printer_id = printer_id where station_id = ${station}`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501"); // insufficient_privilege — no UPDATE granted
  });

  it("the primary key rejects a duplicate (tenant_id, station_id, printer_id) mapping (23505)", async () => {
    const station = await seedStation(TENANT_A, "Barra");
    const printer = await seedPrinter(TENANT_A, "Impresora Barra", "poll-dup");
    await seedMapping(TENANT_A, station, printer);
    const e = await captureError(() => seedMapping(TENANT_A, station, printer));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation on the composite PK
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    // The WITH-CHECK deletion-proof target: weakening WITH CHECK to (true) makes this foreign-tenant_id
    // INSERT succeed instead of raising 42501. The (A, stationA)/(A, printerA) composite FKs are
    // SATISFIED (both rows exist), so the ONLY violated constraint is the RLS WITH CHECK.
    const stationA = await seedStation(TENANT_A, "Pase");
    const printerA = await seedPrinter(TENANT_A, "Impresora Pase", "poll-check");
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into station_printers (tenant_id, station_id, printer_id)
              values (${TENANT_A}, ${stationA}, ${printerA})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("the station binding is tenant-consistent (composite FK to kitchen_stations)", async () => {
    // Tenant A cannot map its own printer to tenant B's station: the (tenant_id, station_id) composite
    // FK has no (A, stationB) row → foreign_key_violation, independently of RLS. The insert is A's own
    // tenant_id (so WITH CHECK passes) and (A, printerA) exists, isolating the station FK.
    const printerA = await seedPrinter(TENANT_A, "Impresora FK station", "poll-fk-station");
    const stationB = await seedStation(TENANT_B, "Estación B");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into station_printers (tenant_id, station_id, printer_id)
              values (${TENANT_A}, ${stationB}, ${printerA})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, station_id)
  });

  it("the printer binding is tenant-consistent (composite FK to printers)", async () => {
    // Symmetric to the station FK: A's own station cannot map to tenant B's printer — no (A, printerB)
    // row → foreign_key_violation. A's tenant_id + (A, stationA) isolate the printer FK.
    const stationA = await seedStation(TENANT_A, "Estación A FK printer");
    const printerB = await seedPrinter(TENANT_B, "Impresora B", "poll-fk-printer");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into station_printers (tenant_id, station_id, printer_id)
              values (${TENANT_A}, ${stationA}, ${printerB})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, printer_id)
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's mapping is committed before the policy is weakened, so it is genuinely there to leak.
    // Weakening the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it. A full DROP POLICY
    // is the WRONG deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the
    // opposite reason. Mirrors printing.rls.test.ts.
    const station = await seedStation(TENANT_A, "Leak-probe station");
    const printer = await seedPrinter(TENANT_A, "Leak-probe printer", "poll-leak");
    await seedMapping(TENANT_A, station, printer);
    // Control in the other direction (§4): under the REAL policy tenant B sees ZERO of A's rows, so the
    // `> 0` after weakening is attributable to the weakening rather than to B having read A all along.
    const foreignUnderRealPolicy = await asApp(TENANT_B, (tx) =>
      tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from station_printers`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(foreignUnderRealPolicy).toBe(0);
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy station_printers_tenant_isolation on station_printers using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from station_printers`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });

  it("station_printers has FORCE row level security (proof by deletion of the FORCE flag)", async () => {
    // The flag the inmutabilidad guard keys on. Under the migration station_printers reports true.
    // NOTE: FORCE is what binds the table OWNER; the app_user cross-tenant SELECT above would still
    // isolate under ENABLE alone (a non-owner), so this flag assertion — not that SELECT — is the test
    // that removing FORCE from the migration turns red.
    expect(await forceFlag(suite.admin, "station_printers")).toBe(true);
    // Proof by deletion: NO FORCE inside a ROLLED-BACK tx flips the flag to false, so the assertion
    // above is attributable to the migration's FORCE line, not to a default. The rollback restores
    // FORCE for the shared template clone.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`alter table station_printers no force row level security`);
      const after = await tx.execute<{ f: boolean }>(
        sql`select relforcerowsecurity as f from pg_class
            where relname = 'station_printers' and relnamespace = 'public'::regnamespace`,
      );
      expect(after.rows[0]!.f).toBe(false);
    });
    // Back to true after the rollback — the deletion did not leak.
    expect(await forceFlag(suite.admin, "station_printers")).toBe(true);
  });
});

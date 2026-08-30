import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { locationCatalogues } from "./location-catalogues.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: RLS as the non-owner app role is a false pass on
// PGlite, which connects as superuser and bypasses FORCE (CLAUDE.md §4). Scaffolding ported from
// station-printers.rls.test.ts — useTemplateDb + withTenant + asAppUser, the same tenant-scoped m2m
// join shape.
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

describe("location_catalogues schema (multi-menu accessibility map — RLS + grants + FORCE + composite FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location per tenant — the owning location a membership references. Seeded as the superuser
    // admin (bypasses RLS). operation_description is Spanish test DATA, not a schema identifier,
    // exactly as the sibling station-printers/printing tests use 'Hostelería'.
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

  // Seed a catalogue under the app role, scoped to `tenant` — exercises catalogues' own grant + WITH
  // CHECK (0027). The catalogue is the OTHER menu a location may sell, beyond its default.
  async function seedCatalogue(tenant: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into catalogues (tenant_id, name) values (${tenant}, ${name}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedMembership(
    tenant: string,
    location: string,
    catalogue: string,
  ): Promise<void> {
    await asApp(tenant, (tx) =>
      tx.execute(
        sql`insert into location_catalogues (tenant_id, location_id, catalogue_id)
            values (${tenant}, ${location}, ${catalogue})`,
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
    const catalogue = await seedCatalogue(TENANT_A, "Menú de tarde");
    await seedMembership(TENANT_A, LOCATION_A, catalogue);
    // Read back through the Drizzle `locationCatalogues` export (not raw SQL) — exercises the produced
    // table export and its column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(locationCatalogues)
        .where(sql`catalogue_id = ${catalogue}`),
    );
    expect(row!.tenantId).toBe(TENANT_A);
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.catalogueId).toBe(catalogue);
    // A membership row is REMOVED via DELETE (app_user holds DELETE — detach).
    const deleted = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ catalogue_id: string }>(
          sql`delete from location_catalogues
              where location_id = ${LOCATION_A} and catalogue_id = ${catalogue}
              returning catalogue_id`,
        )
        .then((r) => r.rows),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.catalogue_id).toBe(catalogue);
  });

  it("app_user has NO UPDATE (a membership is added/removed, never edited)", async () => {
    const catalogue = await seedCatalogue(TENANT_A, "Menú de mediodía");
    await seedMembership(TENANT_A, LOCATION_A, catalogue);
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`update location_catalogues set catalogue_id = catalogue_id
              where location_id = ${LOCATION_A} and catalogue_id = ${catalogue}`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501"); // insufficient_privilege — no UPDATE granted
  });

  it("the primary key rejects a duplicate (tenant_id, location_id, catalogue_id) membership (23505)", async () => {
    const catalogue = await seedCatalogue(TENANT_A, "Carta de vinos");
    await seedMembership(TENANT_A, LOCATION_A, catalogue);
    const e = await captureError(() => seedMembership(TENANT_A, LOCATION_A, catalogue));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation on the composite PK
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    // The WITH-CHECK deletion-proof target: weakening WITH CHECK to (true) makes this foreign-tenant_id
    // INSERT succeed instead of raising 42501. The (A, LOCATION_A)/(A, catalogueA) composite FKs are
    // SATISFIED (both rows exist), so the ONLY violated constraint is the RLS WITH CHECK.
    const catalogueA = await seedCatalogue(TENANT_A, "Menú aislamiento");
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into location_catalogues (tenant_id, location_id, catalogue_id)
              values (${TENANT_A}, ${LOCATION_A}, ${catalogueA})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("the location binding is tenant-consistent (composite FK to locations)", async () => {
    // Tenant A cannot map its own catalogue to tenant B's location: the (tenant_id, location_id)
    // composite FK has no (A, LOCATION_B) row → foreign_key_violation, independently of RLS. The insert
    // is A's own tenant_id (so WITH CHECK passes) and (A, catalogueA) exists, isolating the location FK.
    const catalogueA = await seedCatalogue(TENANT_A, "Menú FK ubicación");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into location_catalogues (tenant_id, location_id, catalogue_id)
              values (${TENANT_A}, ${LOCATION_B}, ${catalogueA})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, location_id)
  });

  it("the catalogue binding is tenant-consistent (composite FK to catalogues)", async () => {
    // Symmetric to the location FK: A's own location cannot map to tenant B's catalogue — no
    // (A, catalogueB) row → foreign_key_violation. A's tenant_id + (A, LOCATION_A) isolate the
    // catalogue FK. catalogueB is seeded under B and A never holds a (A, catalogueB) parent row.
    const catalogueB = await seedCatalogue(TENANT_B, "Menú de otro inquilino");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into location_catalogues (tenant_id, location_id, catalogue_id)
              values (${TENANT_A}, ${LOCATION_A}, ${catalogueB})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, catalogue_id)
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's membership is committed before the policy is weakened, so it is genuinely there to leak.
    // Weakening the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it. A full DROP POLICY
    // is the WRONG deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the
    // opposite reason. Mirrors station-printers.rls.test.ts.
    const catalogue = await seedCatalogue(TENANT_A, "Menú fuga");
    await seedMembership(TENANT_A, LOCATION_A, catalogue);
    // Control in the other direction (§4): under the REAL policy tenant B sees ZERO of A's rows, so the
    // `> 0` after weakening is attributable to the weakening rather than to B having read A all along.
    const foreignUnderRealPolicy = await asApp(TENANT_B, (tx) =>
      tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from location_catalogues`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(foreignUnderRealPolicy).toBe(0);
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy location_catalogues_tenant_isolation on location_catalogues using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from location_catalogues`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });

  it("location_catalogues has FORCE row level security (proof by deletion of the FORCE flag)", async () => {
    // The flag the inmutabilidad guard keys on. Under the migration location_catalogues reports true.
    // NOTE: FORCE is what binds the table OWNER; the app_user cross-tenant SELECT above would still
    // isolate under ENABLE alone (a non-owner), so this flag assertion — not that SELECT — is the test
    // that removing FORCE from the migration turns red.
    expect(await forceFlag(suite.admin, "location_catalogues")).toBe(true);
    // Proof by deletion: NO FORCE inside a ROLLED-BACK tx flips the flag to false, so the assertion
    // above is attributable to the migration's FORCE line, not to a default. The rollback restores
    // FORCE for the shared template clone.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`alter table location_catalogues no force row level security`);
      const after = await tx.execute<{ f: boolean }>(
        sql`select relforcerowsecurity as f from pg_class
            where relname = 'location_catalogues' and relnamespace = 'public'::regnamespace`,
      );
      expect(after.rows[0]!.f).toBe(false);
    });
    // Back to true after the rollback — the deletion did not leak.
    expect(await forceFlag(suite.admin, "location_catalogues")).toBe(true);
  });
});

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { locationCatalogues } from "./location-catalogues.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// constraints themselves would fire on either target — a candidate for the PGlite tier once the
// suites are re-tagged.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";

describe("location_catalogues schema (multi-menu accessibility map — PK + composite FKs)", () => {
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

  it("maps every column through the Drizzle export and detaches by DELETE … RETURNING", async () => {
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

  it("the primary key rejects a duplicate (tenant_id, location_id, catalogue_id) membership (23505)", async () => {
    const catalogue = await seedCatalogue(TENANT_A, "Carta de vinos");
    await seedMembership(TENANT_A, LOCATION_A, catalogue);
    const e = await captureError(() => seedMembership(TENANT_A, LOCATION_A, catalogue));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation on the composite PK
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
});

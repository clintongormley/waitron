import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { locationCatalogues } from "./location-catalogues.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("location_catalogues schema (multi-menu accessibility map — PK + composite FKs)", () => {
  const suite = useTemplateDb({ template: "core", resetPerTest: false });

  beforeAll(async () => {
    await suite.admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    void tenant;
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  // Seed under the app role to exercise catalogues' INSERT grant. This is an additional menu
  // the location may sell, beyond its default.
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
});

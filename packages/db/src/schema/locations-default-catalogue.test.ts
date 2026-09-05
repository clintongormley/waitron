import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: the app role that performs the UPDATE only exists
// under real Postgres (PGlite is a superuser). The composite FK itself would fire on either target —
// a candidate for the PGlite tier once the suites are re-tagged. `locations.catalogue_id` (a location's
// DEFAULT menu) originally carried a single-column FK to catalogues(id) — global, not tenant-scoped —
// so a cross-tenant catalogue could be set as a location's default (the app-layer guard in
// catalogue-api.ts caught it at the route, but the DB accepted it). This suite pins the tenant-consistent
// composite FK that closes it at the data layer.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("locations.catalogue_id (a location's default menu) — tenant-consistent composite FK", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedCatalogue(tenant: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into catalogues (tenant_id, name) values (${tenant}, ${name}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits a SAME-tenant catalogue as the location's default (the control)", async () => {
    const catalogueA = await seedCatalogue(TENANT_A, "Carta propia");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update locations set catalogue_id = ${catalogueA} where id = ${LOCATION_A}`),
    );
    const [row] = (
      await asApp(TENANT_A, (tx) =>
        tx.execute<{ catalogue_id: string }>(
          sql`select catalogue_id from locations where id = ${LOCATION_A}`,
        ),
      )
    ).rows;
    expect(row!.catalogue_id).toBe(catalogueA);
  });

  it("rejects a CROSS-tenant catalogue as the location's default (composite FK, 23503)", async () => {
    // A's own location cannot take tenant B's catalogue as its default — no (A, catalogueB) row in
    // catalogues → foreign_key_violation, independently of RLS (a FK check bypasses RLS). Before the
    // composite FK this UPDATE SUCCEEDED (the single-column FK to catalogues(id) accepts any catalogue).
    const catalogueB = await seedCatalogue(TENANT_B, "Menú de otro inquilino");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update locations set catalogue_id = ${catalogueB} where id = ${LOCATION_A}`),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, catalogue_id)
  });

  it("permits clearing the default to NULL (a location may sell no menu; MATCH SIMPLE skips the FK)", async () => {
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update locations set catalogue_id = null where id = ${LOCATION_A}`),
    );
    const [row] = (
      await asApp(TENANT_A, (tx) =>
        tx.execute<{ catalogue_id: string | null }>(
          sql`select catalogue_id from locations where id = ${LOCATION_A}`,
        ),
      )
    ).rows;
    expect(row!.catalogue_id).toBeNull();
  });
});

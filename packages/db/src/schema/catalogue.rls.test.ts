import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { catalogues } from "./catalogue.js";
import { tenants } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: this suite proves the RLS-needs-nothing
// receipt for the new products.image column (design §5a). It writes and reads image as the
// NON-OWNER app role, under withTenant + asAppUser, so the INSERT exercises the table-level
// SELECT/INSERT/UPDATE grant (0027) and the WITH CHECK half of products_tenant_isolation, and the
// SELECT exercises the USING half. A table-level GRANT (no column list) and a row policy (which
// filters rows, not columns) both extend to a column added later — this proves it rather than
// asserting it from reading. PGlite connects as a superuser that bypasses FORCE ROW LEVEL SECURITY,
// so the same assertions there would be a false pass (CLAUDE.md §4). Mirrors daily-closes.rls.test.ts.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
// A content-addressed filename shape (<64hex>.webp) — the value the upload route will store. Its
// content does not matter to this suite; only that a non-null image survives the app role's
// INSERT + SELECT and is invisible from another tenant's GUC.
const IMAGE = `${"a".repeat(64)}.webp`;

describe("products.image under real row-level security", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The products.image RLS suite requires a running Docker daemon. It cannot be skipped: " +
          "PGlite runs every connection as a superuser, which bypasses the FORCE ROW LEVEL " +
          "SECURITY and the tenant-isolation policy this suite exists to prove cover products.image.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    // Restates this package's own vitest hookTimeout (120s), covering the image pull on a cold
    // runner, which the helper's 60s default would otherwise narrow.
    timeoutMs: 120_000,
  });

  let catalogueId = "";

  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // The catalogue is scaffolding, seeded as the owner (RLS bypassed — pure setup). The PRODUCT
    // below is written as the app role, so it — not this — exercises the grant + policy for the new
    // column.
    const [catalogue] = await admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli A" })
      .returning({ id: catalogues.id });
    catalogueId = catalogue!.id;
  });

  it("lets the app role write and read back a product's image (grant + WITH CHECK + USING)", async () => {
    // The design §5a receipt, proven not asserted: insert a non-null image as app_user under A's
    // GUC (the table-level grant + the policy's WITH CHECK), then read it back (the grant + the
    // policy's USING). Raw SQL so the RED phase fails on `column "image" ... does not exist` — the
    // real cause — rather than a drizzle-schema mismatch.
    const image = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into products
          (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class, image)
        values
          (${TENANT_A}, ${catalogueId}, '{"en":"water"}'::jsonb, 'each', '1.50', 'general', ${IMAGE})`);
      const result = await tx.execute<{ image: string | null }>(
        sql`select image from products where catalogue_id = ${catalogueId}`,
      );
      return result.rows[0]?.image;
    });
    expect(image).toBe(IMAGE);
  });

  it("hides another tenant's product image under the isolation policy", async () => {
    // The differential half of the receipt: the SAME app role, holding the SAME SELECT grant,
    // scoped to tenant B, sees NONE of tenant A's products — the image included. The positive read
    // above is load-bearing: without it, B's empty result could equally mean the app role has no
    // access at all. Drops to a false read if asAppUser is removed — a superuser bypasses the policy
    // and would see A's row from B's GUC.
    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ image: string | null }>(
        sql`select image from products where image = ${IMAGE}`,
      );
    });
    expect(seenByB.rows).toEqual([]);
  });
});

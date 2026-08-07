import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, captureError, pgErrorCode, pgErrorMessage, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createProduct,
  listAvailableProducts,
  listCatalogues,
  listProducts,
} from "./operations.js";
import { startRealPostgres } from "./testing/postgres.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants, so it is a genuine RLS subject: the
// container's default user is a superuser and bypasses FORCE ROW LEVEL SECURITY, so a policy/grant
// assertion has to run under a role like this. The app_user membership is what grants it
// SELECT/INSERT/UPDATE on the catalogue tables (0027); NO DELETE is granted, which the second test
// proves (SQLSTATE 42501). current_tenant_id() reads `app.tenant_id`, so a query under tenant B's
// GUC matches none of tenant A's rows. This suite runs on REAL Postgres: PGlite connects as a
// superuser and so bypasses FORCE ROW LEVEL SECURITY, which would make an RLS/grant assertion a
// false pass — CLAUDE.md §4 requires real Postgres for anything about privileges or RLS as the
// deployment role. Mirrors packages/payments-stripe/src/stripe.rls.test.ts.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

// `timeoutMs` restates a 180s beforeAll for the container start (image pull on a cold runner); this
// package's vitest hookTimeout is 60s, which the useRealPostgres default would otherwise leave in
// force for the expensive start hook.
const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: 180_000,
});

describe("catalogue operations under real row-level security", () => {
  let tenantA: SeededVenue;
  let tenantB: SeededVenue;
  let catalogueId: string;

  beforeAll(async () => {
    // Seed both tenants as the superuser (admin) — RLS is bypassed for seeding, which is fine: the
    // tenants themselves aren't the thing under test. The catalogue + product below are written as
    // the RLS-subject probe role, scoped to tenant A, so the INSERT exercises the grant and the
    // WITH CHECK half of the isolation policy.
    tenantA = await seedVenue(suite.admin);
    tenantB = await seedVenue(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        const catalogue = await createCatalogue(tx, { name: "Deli A" });
        catalogueId = catalogue.id;
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: null,
          descriptions: { en: "water" },
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
          allergens: { gluten: { presence: "contains", source: "wheat" } },
        });
      });
    } finally {
      await probe.close();
    }
  });

  it("isolates one tenant's catalogue and products from another", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Positive control — tenant A, the owner, sees its own rows. Proves the SELECT grant and the
      // USING half of the policy, and that the seed landed. This is the read prove-by-deletion flips.
      const ownCatalogues = await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        return listCatalogues(tx);
      });
      expect(ownCatalogues.map((c) => c.name)).toEqual(["Deli A"]);
      const ownProducts = await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        return listProducts(tx, catalogueId);
      });
      expect(ownProducts.map((p) => p.descriptions.en)).toEqual(["water"]);

      // The isolation guarantee: the SAME probe role, holding the SAME SELECT grant, sees NONE of
      // tenant A's rows when scoped to tenant B. The only thing standing between these queries and
      // A's rows is the isolation policy's USING clause (tenant_id = current_tenant_id()) evaluated
      // against B's GUC. `listCatalogues` reads only `catalogues` and `listProducts` reads only
      // `products`, so the two reads are independent: weakening the catalogues policy's USING to
      // `true` leaks only the catalogues read, and weakening the products policy's USING to `true`
      // leaks only the products read. The two assertions below check each independently.
      const seenByB = await withTenant(probe, tenantB.tenantId, async (tx) => {
        await asAppUser(tx);
        return {
          catalogues: await listCatalogues(tx),
          products: await listProducts(tx, catalogueId),
        };
      });
      expect(seenByB.catalogues).toEqual([]);
      expect(seenByB.products).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("round-trips a product's allergens through the app role's INSERT and SELECT", async () => {
    // The allergens jsonb survives a create→listAvailableProducts entirely under the non-superuser
    // probe role: the INSERT in beforeAll wrote them under the app_user grant + WITH CHECK, and this
    // reads them back through the location→catalogue→product join under the USING half of the policy.
    // `assignCatalogueToLocation` UPDATEs `locations`, for which app_user holds UPDATE (0001).
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const available = await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        await assignCatalogueToLocation(tx, tenantA.locationId, catalogueId);
        return listAvailableProducts(tx, tenantA.locationId);
      });
      expect(available.map((p) => p.allergens)).toEqual([
        { gluten: { presence: "contains", source: "wheat" } },
      ]);
    } finally {
      await probe.close();
    }
  });

  it("denies DELETE to app_user (grant is SELECT/INSERT/UPDATE only)", async () => {
    // **Deviation from the brief.** The brief's `.rejects.toThrow(/permission denied/i)` inspects
    // only `Error.message`, and drizzle-orm@0.45.2 wraps every failed query in a `DrizzleQueryError`
    // whose own `.message` is `Failed query: <sql>` — the real Postgres text (`permission denied for
    // table products`, SQLSTATE 42501) lives on `.cause`. `captureError`/`pgErrorMessage`/`pgErrorCode`
    // read that instead, the same convention packages/core/src/incidents.test.ts documents for the
    // identical wrapped permission-denied assertion.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const error = await captureError(() =>
        withTenant(probe, tenantA.tenantId, async (tx) => {
          await asAppUser(tx);
          await tx.execute(sql`delete from products where tenant_id = ${tenantA.tenantId}`);
        }),
      );
      expect(pgErrorMessage(error)).toMatch(/permission denied for table products/);
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await probe.close();
    }
  });
});

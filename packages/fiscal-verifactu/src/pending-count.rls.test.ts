import { describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { envios } from "./schema/envios.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants. Being non-superuser is what makes RLS
// apply to it (a superuser bypasses FORCE ROW LEVEL SECURITY); the app_user membership is what lets
// it SELECT envios/registros_facturacion at all. current_tenant_id() then reads app.tenant_id, so
// with no GUC set the tenant-isolation policy matches zero rows.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: CONTAINER_SETUP_TIMEOUT_MS,
});

describe("pendingCount under real row-level security", () => {
  it("counts the tenant's pending records when run as an RLS-subject role", async () => {
    const till: SeededTill = await seedTill(suite.admin, "A");
    // Seed one pending envios row for this tenant, all as the superuser (which bypasses RLS).
    // seedTill returns { tenantId, tillId, seriesId, sifId } — no saleId, so seedSale mints one.
    const saleId = await seedSale(suite.admin, till, 1);
    const appended = await suite.admin.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
    );
    await suite.admin.insert(envios).values({ registroId: appended.id, tenantId: till.tenantId });

    // Run pendingCount as rls_probe: a non-superuser, so the tenant-isolation policy is enforced.
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: steadyClock,
        db: probe,
        resolveClient: staticResolver(fakeClient),
      });
      // Fix under test: withTenant sets app.tenant_id, so current_tenant_id() matches this tenant's
      // rows. Without it the policy sees NULL and returns 0 — the bug this test exists to catch.
      expect(await backend.pendingCount(till.tenantId, till.tillId)).toBe(1);
    } finally {
      await probe.close();
    }
  });
});

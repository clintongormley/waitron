import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { envios } from "./schema/envios.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { altaFor, seedSale, seedTill, type SeededTill } from "./testing/seed.js";
import { fakeClient, steadyClock } from "../test/write-path-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants. Being non-superuser is what makes RLS
// apply to it (a superuser bypasses FORCE ROW LEVEL SECURITY); the app_user membership is what lets
// it SELECT envios/registros_facturacion at all. current_tenant_id() then reads app.tenant_id, so
// with no GUC set the tenant-isolation policy matches zero rows.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}' in role app_user`),
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

describe("pendingCount under real row-level security", () => {
  it("counts the tenant's pending records when run as an RLS-subject role", async () => {
    const till: SeededTill = await seedTill(admin, "A");
    // Seed one pending envios row for this tenant, all as the superuser (which bypasses RLS).
    // seedTill returns { tenantId, tillId, seriesId, sifId } — no saleId, so seedSale mints one.
    const saleId = await seedSale(admin, till, 1);
    const appended = await admin.transaction((tx) =>
      appendToChain(tx, till.tenantId, till.tillId, altaFor(saleId, 1, 1)),
    );
    await admin.insert(envios).values({ registroId: appended.id, tenantId: till.tenantId });

    // Run pendingCount as rls_probe: a non-superuser, so the tenant-isolation policy is enforced.
    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({ clock: steadyClock, db: probe, client: fakeClient });
      // Fix under test: withTenant sets app.tenant_id, so current_tenant_id() matches this tenant's
      // rows. Without it the policy sees NULL and returns 0 — the bug this test exists to catch.
      expect(await backend.pendingCount(till.tenantId, till.tillId)).toBe(1);
    } finally {
      await probe.close();
    }
  });
});

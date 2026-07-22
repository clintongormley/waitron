import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import type { Database } from "@waitron/db";
import { VerifactuBackend } from "./backend.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { steadyClock } from "../test/write-path-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants — the same probe pending-count.rls.
// test.ts uses. Being non-superuser is what makes RLS apply (a superuser bypasses FORCE ROW LEVEL
// SECURITY); the app_user membership is what lets it SELECT envios/registros_facturacion and
// SELECT/INSERT incidents at all. current_tenant_id() then reads app.tenant_id, so with no GUC set
// the tenant-isolation policies on both envios and incidents match/permit zero rows.
const PROBE_ROLE = "reconcile_rls_probe";
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

/**
 * `reconcile` under real row-level security. PGlite's default connection is a superuser and
 * bypasses RLS, so it cannot exercise either of the two `withTenant` scopes `reconcile` opens: the
 * period-rows SELECT (like `pendingCount`, it counts zero if `app.tenant_id` is unset) AND the
 * incident INSERT (incidents carries `WITH CHECK (tenant_id = current_tenant_id())` under FORCE
 * RLS, so the write is rejected outright without the GUC). This proves both hold under a
 * non-superuser member of `app_user`, mirroring pending-count.rls.test.ts for the read side and
 * extending it to the incident-write side reconciliation adds.
 */
describe("reconcile under real row-level security", () => {
  it("reads the period's accepted record and writes its noTrace incident as an RLS-subject role", async () => {
    // Seed one accepted record for a fresh tenant, all as the superuser (which bypasses RLS). Its
    // fecha_expedicion_factura is 2026-07-20 (drain-fixtures' PAST_FECHA), so it falls in 2026-07.
    const seeded = await seedPendingEnvios(admin, { count: 1 });
    await admin.execute(
      sql`update envios set estado = 'aceptado' where tenant_id = ${seeded.tenantId}`,
    );

    // A fresh fake AEAT with an empty store: it holds no trace of the accepted record, so the
    // record must surface as noTrace and raise an error incident.
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    const probe = await pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({
        clock: steadyClock,
        db: probe,
        client: aeat.client(),
      });
      // Fix under test: `withTenant` sets app.tenant_id, so current_tenant_id() both matches this
      // tenant's rows for the period read AND satisfies incidents' WITH CHECK for the write.
      // Without it the read returns 0 rows (checked 0, no incident) — the bug this test catches.
      const result = await backend.reconcile(seeded.tenantId, { year: "2026", month: "07" });

      expect(result.checked).toBe(1);
      expect(result.noTrace.map((m) => m.recordId)).toEqual([seeded.registroIds[0]]);
      expect(result.incidentsRaised).toBe(1);
    } finally {
      await probe.close();
    }

    // The incident was genuinely committed under RLS — read it back as the superuser.
    const inc = await admin.execute<{ code: string; severity: string }>(
      sql`select code, severity from incidents where tenant_id = ${seeded.tenantId}`,
    );
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.code).toBe("fiscal.reconcile_no_trace");
    expect(inc.rows[0]?.severity).toBe("error");
  });
});

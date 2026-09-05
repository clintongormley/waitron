import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { VerifactuBackend } from "./backend.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants — the same probe pending-count.rls.
// test.ts uses. Being non-superuser is what makes RLS apply (a superuser bypasses FORCE ROW LEVEL
// SECURITY); the app_user membership is what lets it SELECT envios/registros_facturacion and
// SELECT/INSERT incidents at all. current_tenant_id() then reads app.tenant_id, so with no GUC set
// the tenant-isolation policies on both envios and incidents match/permit zero rows.
const PROBE_ROLE = "reconcile_rls_probe";
const PROBE_PASSWORD = "probe";

// A clone of the `manifest` template (the full migration manifest); the probe connections below authenticate as
// `reconcile_rls_probe`, a cluster-wide role the package globalSetup creates in place of the
// per-file `probeRole` this suite passed before the shared container.
const suite = useTemplateDb({ template: "manifest" });

/**
 * `reconcile` under real row-level security. PGlite's default connection is a superuser and
 * bypasses RLS, so it cannot exercise either of the two `withTenant` scopes `reconcile` opens: the
 * period-rows SELECT (like `pendingCount`, it counts zero if `app.tenant_id` is unset) AND the
 * incident INSERT (incidents carries `WITH CHECK (tenant_id = current_tenant_id())` under FORCE
 * RLS, so the write is rejected outright without the GUC). This proves both hold under a
 * non-superuser member of `app_user`, mirroring pending-count.rls.test.ts for the read side and
 * extending it to the incident-write side reconciliation adds.
 *
 * Task 4 (reconcile-resolution, noTrace auto-remediation): a FIRST noTrace no longer raises an
 * incident — it silently remediates (reset to `pendiente` + `deleteAck`), so this record is seeded
 * with `reconciled_resubmit_at` ALREADY set (as if a prior sweep already remediated it once), which
 * is what makes THIS sweep take the escalate-to-incident branch — preserving the scenario this test
 * exists to prove: the incident INSERT commits under a non-superuser, RLS-subject role. The
 * remediation branch's own writes (an UPDATE on envios, a DELETE on acks) are ordinary tenant-scoped
 * mutations no different in kind from ones already proven under RLS elsewhere in this suite
 * (acks.rls.test.ts, pending-count.rls.test.ts) — this test's own reason to exist is specifically
 * the incident WITH CHECK, so it targets the escalation path that still hits it.
 */
describe("reconcile under real row-level security", () => {
  it("reads the period's accepted record and writes its noTrace incident as an RLS-subject role", async () => {
    // Seed one accepted record for a fresh tenant, all as the superuser (which bypasses RLS). Its
    // fecha_expedicion_factura is 2026-07-20 (drain-fixtures' PAST_FECHA), so it falls in 2026-07.
    const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
    await suite.admin.execute(
      sql`update envios set estado = 'aceptado', reconciled_resubmit_at = now()
          where tenant_id = ${seeded.tenantId}`,
    );

    // A fresh fake AEAT with an empty store: it holds no trace of the accepted record. Combined
    // with the marker seeded above (a prior remediation that did not self-heal), this sweep must
    // escalate rather than reset again — raising the error incident under RLS.
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: steadyClock,
        db: probe,
        resolveClient: staticResolver(aeat.client()),
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
    const inc = await suite.admin.execute<{ code: string; severity: string }>(
      sql`select code, severity from incidents where tenant_id = ${seeded.tenantId}`,
    );
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.code).toBe("fiscal.reconcile_no_trace");
    expect(inc.rows[0]?.severity).toBe("error");
  });

  /**
   * The OTHER half of the noTrace lifecycle, and the reason this suite exists at real Postgres
   * rather than PGlite alone: `remediateNoTrace`'s `deleteAck` is a DELETE against `acks`, and
   * PGlite's default connection is a superuser that bypasses table privileges entirely — it cannot
   * catch a missing GRANT the way a real, privilege-checked role can. This test caught exactly that
   * live while writing this task: 0006_acks_rls.sql granted app_user only SELECT/INSERT/UPDATE on
   * acks, so the very first `deleteAck` call under this probe role failed
   * `permission denied for table acks`, rolling back the whole T2 transaction (the estado reset
   * included). 0008_acks_delete_grant.sql adds the missing GRANT DELETE; this test is what would
   * catch a regression of it.
   */
  it("first-detection noTrace remediates (reset + ack delete) as an RLS-subject role", async () => {
    const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    // Seed via the real drain path (superuser, bypasses RLS) so the record carries a genuine
    // `accepted` ack — the row `deleteAck` must remove.
    const seedBackend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.admin,
      resolveClient: staticResolver(aeat.client()),
    });
    // Fixed instant past `seedPendingEnvios`'s stamped `proximo_intento_en` (it seeds July dates —
    // the same reason reconcile.test.ts drains at a fixed 2026-07-21T00:01:00Z), so the drain is
    // deterministic rather than wall-clock-relative (a Copilot review point; clock skew / slow CI
    // could otherwise flake a `Date.now()`-based due time).
    await seedBackend.drain(new Date("2026-07-21T00:01:00Z"));
    aeat.forget(seeded.facturaKeys[0]!); // AEAT now has no trace of it — a first noTrace detection

    const before = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from acks where tenant_id = ${seeded.tenantId}`,
    );
    expect(before.rows[0]?.n).toBe("1");

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: steadyClock,
        db: probe,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.reconcile(seeded.tenantId, { year: "2026", month: "07" });

      expect(result.checked).toBe(1);
      expect(result.noTrace.map((m) => m.recordId)).toEqual([seeded.registroIds[0]]);
      // First detection: no incident, the remediation self-heals silently.
      expect(result.incidentsRaised).toBe(0);
    } finally {
      await probe.close();
    }

    // Committed under RLS as the non-superuser probe role: reset to pendiente, marker stamped, no
    // incident, and — the grant this test exists to guard — the stale ack genuinely deleted.
    const env = await suite.admin.execute<{
      estado: string;
      reconciled_resubmit_at: string | null;
    }>(
      sql`select estado, reconciled_resubmit_at from envios where registro_id = ${seeded.registroIds[0]}`,
    );
    expect(env.rows[0]?.estado).toBe("pendiente");
    expect(env.rows[0]?.reconciled_resubmit_at).not.toBeNull();

    const acks = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from acks where tenant_id = ${seeded.tenantId}`,
    );
    expect(acks.rows[0]?.n).toBe("0");

    const inc = await suite.admin.execute<{ n: string }>(
      sql`select count(*)::text as n from incidents where tenant_id = ${seeded.tenantId}`,
    );
    expect(inc.rows[0]?.n).toBe("0");
  });
});

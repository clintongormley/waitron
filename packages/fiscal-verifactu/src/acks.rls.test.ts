import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { markDelivered, pendingAcks, writeAck } from "./acks.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants — the same probe shape
// reconcile.rls.test.ts / pending-count.rls.test.ts use. Being non-superuser is what makes RLS
// apply (a superuser bypasses FORCE ROW LEVEL SECURITY); the app_user membership is what carries
// the SELECT on envios and the SELECT/INSERT/UPDATE on acks (migration 0006). current_tenant_id()
// then reads app.tenant_id, so with no GUC set the acks tenant-isolation policy matches zero rows.
const PROBE_ROLE = "acks_rls_probe";
const PROBE_PASSWORD = "probe";
const NOW = new Date("2026-07-21T00:01:00Z");

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: CONTAINER_SETUP_TIMEOUT_MS,
});

/**
 * The acks read/write path under real row-level security. PGlite's default connection is a
 * superuser and bypasses RLS, so it cannot exercise the acks tenant-isolation policy at all: the
 * INSERT carries `WITH CHECK (tenant_id = current_tenant_id())` under FORCE RLS, and SELECT/UPDATE
 * are USING-filtered by it. This proves `writeAck` (SELECT envios + INSERT acks), `pendingAcks`
 * (SELECT) and `markDelivered` (UPDATE) all hold as a non-superuser member of app_user under
 * `withTenant`, mirroring reconcile.rls.test.ts / pending-count.rls.test.ts.
 */
describe("acks under real row-level security", () => {
  it("writes, reads, and delivers an ack as an RLS-subject member of app_user", async () => {
    // Seed one record as the superuser (bypasses RLS) and mark it aceptado so ackStateOf →
    // accepted. Stamp `enviado_en` so submitted_at is the claim instant, not the coalesce fallback.
    const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
    await suite.admin.execute(
      sql`update envios set estado = 'aceptado', enviado_en = ${NOW.toISOString()} where tenant_id = ${seeded.tenantId}`,
    );

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // writeAck reads envios and inserts into acks — both inside `withTenant`, so
      // current_tenant_id() matches this tenant and satisfies acks' WITH CHECK. Without the GUC the
      // INSERT is rejected outright — the bug this exercise catches.
      await withTenant(probe, seeded.tenantId, (tx) => writeAck(tx, seeded.registroIds[0]!, NOW));

      const pend = await pendingAcks(probe, seeded.tenantId);
      expect(pend.map((a) => a.recordId)).toEqual([seeded.registroIds[0]]);
      expect(pend[0]!.state).toBe("accepted");
      expect(pend[0]!.submittedAt.getTime()).toBe(NOW.getTime());

      await markDelivered(probe, seeded.tenantId, seeded.registroIds[0]!);
      expect(await pendingAcks(probe, seeded.tenantId)).toHaveLength(0);
    } finally {
      await probe.close();
    }

    // The ack was genuinely committed under RLS — read it back as the superuser.
    const { rows } = await suite.admin.execute<{ state: string; delivered_at: string | null }>(
      sql`select state, delivered_at from acks where tenant_id = ${seeded.tenantId}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("accepted");
    expect(rows[0]!.delivered_at).not.toBeNull();
  });
});

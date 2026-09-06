import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { VerifactuBackend } from "./backend.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants (including EXECUTE on
// envios_tenants_with_work). Being non-superuser is what subjects EVERY query a drain issues on
// this connection to the app role's real privilege set — crucially including tenantsWithWork's
// top-level enumeration, which runs OUTSIDE any withTenant transaction and therefore cannot be
// covered by a per-transaction `asAppUser` SET LOCAL ROLE.
const DRAIN_PROBE_ROLE = "drain_probe";
const DRAIN_PROBE_PASSWORD = "probe";

/**
 * Real PostgreSQL via a clone of the shared container's `manifest` template — deliberately NOT
 * `describe.skipIf(!dockerAvailable)` anywhere in this file, for the same reason
 * `chain.concurrency.test.ts` gives: a concurrency suite that silently vanishes when Docker is absent
 * reports a green run that proves nothing about the ONE property this file exists to establish — that
 * `claimBatch`'s `FOR UPDATE SKIP LOCKED` prevents two concurrent drainers from ever submitting the
 * same record twice. PGlite cannot substitute for this: it serialises every "concurrent" query onto
 * one backend process (`chain.pglite-cannot-test-contention.test.ts`), which would make this suite
 * pass vacuously whether or not the locking clause is even present. Docker-absence now fails loudly at
 * the package globalSetup (`src/testing/global-setup.ts`'s `dockerRequired`), which precedes every
 * worker, rather than at a per-file container start.
 *
 * The probe connections below authenticate as `drain_probe`, a cluster-wide role the globalSetup
 * creates in place of the per-file `probeRole` this suite passed before the shared container.
 */
const suite = useTemplateDb({ template: "manifest" });

// More than one row, but well within one envío (MAX_REGISTROS_POR_ENVIO = 1000) — this suite is
// not about batching (drain.test.ts's own "1001-split" describe covers that), it is about whether
// two drainers claiming from the SAME due backlog ever pick up the SAME row.
const PENDING_COUNT = 12;

describe("drain — claim concurrency (real Postgres)", () => {
  it("two concurrent drains over the same tenant never submit a record twice (SKIP LOCKED)", async () => {
    const seeded = await seedPendingEnvios(suite.admin, { count: PENDING_COUNT });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    // Separate connections, not one shared `db` — `testing/postgres.ts`'s own doc comment on
    // `connect()`: two callers must land on two distinct backend processes for `FOR UPDATE` to
    // have anything to block/skip against, mirroring `chain.concurrency.test.ts`'s identical
    // convention. `createPostgresDb`'s pool (default size 10) could in principle multiplex two
    // callers onto two of its own connections even if shared, but a dedicated connection per
    // drainer removes any doubt and matches this package's one other concurrency suite.
    const dbA = await suite.pg.connect();
    const dbB = await suite.pg.connect();
    try {
      const a = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: seeded.clock,
        db: dbA,
        resolveClient: staticResolver(aeat.client()),
      });
      const b = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: seeded.clock,
        db: dbB,
        resolveClient: staticResolver(aeat.client()),
      });
      const now = new Date("2026-07-21T00:01:00Z");

      const [ra, rb] = await Promise.all([a.drain(now), b.drain(now)]);

      // The submitted count detects duplicate claims. Without `FOR UPDATE ... SKIP LOCKED` in `claimBatch`, a plain
      // `SELECT` (no row locking at all) lets two concurrent transactions each see the SAME
      // `pendiente` rows before either commits its own claim — both would then submit the SAME
      // batch to AEAT, and BOTH `drain()` calls would count those rows in their own
      // `recordsSubmitted`. Summed across both drainers, that means the total would exceed
      // PENDING_COUNT. With the lock in place, a row claimed (and therefore counted) by one
      // drainer is invisible to the other's claim query, so the sum is exactly the seeded count —
      // every row claimed by exactly one drainer. (Confirmed live: reverting `claimBatch` to the
      // pre-Task-8 unlocked SELECT makes this assertion fail — see this task's report.)
      expect(ra.recordsSubmitted + rb.recordsSubmitted).toBe(PENDING_COUNT);
      // No duplicate identity stored: AEAT's fake store is keyed by invoice identity, and a
      // resubmit of an identity it already holds is answered as `RegistroDuplicado` (3000)
      // rather than overwriting the stored entry — so this alone would not distinguish "claimed
      // once" from "claimed twice, second one rejected as a duplicate". Kept as a sanity check
      // that every DISTINCT seeded row genuinely reached AEAT and landed, alongside (not instead
      // of) the `recordsSubmitted` sum above, which is what actually catches a double claim.
      expect(aeat.stored()).toHaveLength(PENDING_COUNT);

      // Independent, DB-side proof: every row was attempted exactly once. If a row had been
      // claimed by BOTH transactions, its `intentos` (incremented by claimBatch's own UPDATE)
      // would read 2, not 1 — this is untouched by anything AEAT's fake does or does not dedupe.
      const rows = await withTenant(suite.admin, seeded.tenantId, (tx) =>
        tx.execute<{ estado: string; intentos: number; csv: string | null }>(sql`
          select estado, intentos, csv from envios where tenant_id = ${seeded.tenantId}
        `),
      );
      expect(rows.rows).toHaveLength(PENDING_COUNT);
      expect(rows.rows.every((r) => r.estado === "aceptado")).toBe(true);
      expect(rows.rows.every((r) => r.intentos === 1)).toBe(true);
      expect(rows.rows.every((r) => r.csv !== null)).toBe(true);
    } finally {
      await dbA.close();
      await dbB.close();
    }
  }, 30_000);

  /** Read pending counts as app_user before and after the drain commits. */
  it("pendingCount reflects drained rows under the app_user role, not just the suite.admin connection", async () => {
    const seeded = await seedPendingEnvios(suite.admin, { count: 3 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: suite.admin,
      resolveClient: staticResolver(aeat.client()),
    });

    const pendingAsApp = () =>
      withTenant(suite.admin, seeded.tenantId, async (tx) => {
        await asAppUser(tx);
        const rows = await tx.execute<{ count: string }>(sql`
          select count(*)::text as count
          from envios e
          join registros_facturacion r on r.id = e.registro_id
          where r.node_id = ${seeded.nodeId} and e.tenant_id = ${seeded.tenantId} and e.estado = 'pendiente'
        `);
        return Number(rows.rows[0]!.count);
      });

    expect(await pendingAsApp()).toBe(3);

    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));
    expect(result.recordsAccepted).toBe(3);

    expect(await pendingAsApp()).toBe(0);
  }, 30_000);
});

/** Exercise enumeration and the subsequent drain on a LOGIN role inheriting app_user. */
describe("drain — enumeration as app_user (real Postgres)", () => {
  const pendingAsApp = (tenantId: string) =>
    withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const rows = await tx.execute<{ count: string }>(sql`
        select count(*)::text as count from envios where tenant_id = ${tenantId} and estado = 'pendiente'
      `);
      return Number(rows.rows[0]!.count);
    });

  it("enumerates and drains due backlogs as app_user", async () => {
    // Seed two independent due backlogs and require both to drain.
    const t1 = await seedPendingEnvios(suite.admin, { count: 2 });
    const t2 = await seedPendingEnvios(suite.admin, { count: 3 });
    const total = 5;
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const now = new Date("2026-07-21T00:01:00Z");

    expect(await pendingAsApp(t1.tenantId)).toBe(2);
    expect(await pendingAsApp(t2.tenantId)).toBe(3);

    // The LOGIN fixture inherits app_user grants for every query, including enumeration.
    const appUserDb = await suite.pg.connectAs(DRAIN_PROBE_ROLE, DRAIN_PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: t1.clock,
        db: appUserDb,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.drain(now);

      // Every seeded record must reach the fake transport.
      expect(result.recordsAccepted).toBe(total);
      expect(aeat.stored()).toHaveLength(total);
    } finally {
      await appUserDb.close();
    }

    // Both backlogs must be empty when read through the application role.
    expect(await pendingAsApp(t1.tenantId)).toBe(0);
    expect(await pendingAsApp(t2.tenantId)).toBe(0);
  }, 30_000);

  it("returns the due-tenant UUID list to app_user", async () => {
    const t1 = await seedPendingEnvios(suite.admin, { count: 1 });
    const now = new Date("2026-07-21T00:01:00Z");
    const appUserDb = await suite.pg.connectAs(DRAIN_PROBE_ROLE, DRAIN_PROBE_PASSWORD);
    try {
      // What the seam DOES expose is exactly the due-tenant id set — bare uuids (setof uuid),
      // carrying no other envío column at all.
      const enumerated = await appUserDb.execute<{ tenant_id: string }>(sql`
        select tenant_id from envios_tenants_with_work(${now.toISOString()}::timestamptz) as t(tenant_id)
      `);
      const ids = enumerated.rows.map((r) => r.tenant_id);
      expect(ids).toContain(t1.tenantId);
      expect(
        ids.every((id) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
        ),
      ).toBe(true);
    } finally {
      await appUserDb.close();
    }
  }, 30_000);
});

afterEach(async () => {
  await suite.admin.execute(sql`delete from envios`);
});

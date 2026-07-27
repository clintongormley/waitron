import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { VerifactuBackend } from "./backend.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";

let pg: RealPostgres;
let admin: Database;

// A non-superuser LOGIN role that inherits app_user's grants (including EXECUTE on
// envios_tenants_with_work). Being non-superuser is what subjects EVERY query a drain issues on
// this connection to FORCE ROW LEVEL SECURITY — crucially including tenantsWithWork's top-level
// cross-tenant enumeration, which runs OUTSIDE any withTenant transaction and therefore cannot be
// covered by a per-transaction `asAppUser` SET LOCAL ROLE. Mirrors pending-count.rls.test.ts's
// rls_probe: current_tenant_id() reads app.tenant_id, so with no GUC set the tenant-isolation
// policy matches zero rows.
const DRAIN_PROBE_ROLE = "drain_probe";
const DRAIN_PROBE_PASSWORD = "probe";

/**
 * Real PostgreSQL via Testcontainers — deliberately NOT `describe.skipIf(!dockerAvailable)`
 * anywhere in this file, for the same reason `chain.concurrency.test.ts` gives (see that file's
 * own doc comment and `startRealPostgres`'s): a concurrency suite that silently vanishes when
 * Docker is absent reports a green run that proves nothing about the ONE property this file
 * exists to establish — that `claimBatch`'s `FOR UPDATE SKIP LOCKED` prevents two concurrent
 * drainers from ever submitting the same record twice. PGlite cannot substitute for this: it
 * serialises every "concurrent" query onto one backend process
 * (`chain.pglite-cannot-test-contention.test.ts`), which would make this suite pass vacuously
 * whether or not the locking clause is even present.
 */
beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
  await admin.execute(
    sql.raw(
      `create role ${DRAIN_PROBE_ROLE} login password '${DRAIN_PROBE_PASSWORD}' in role app_user`,
    ),
  );
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

// More than one row, but well within one envío (MAX_REGISTROS_POR_ENVIO = 1000) — this suite is
// not about batching (drain.test.ts's own "1001-split" describe covers that), it is about whether
// two drainers claiming from the SAME due backlog ever pick up the SAME row.
const PENDING_COUNT = 12;

describe("drain — claim concurrency (real Postgres)", () => {
  it("two concurrent drains over the same tenant never submit a record twice (SKIP LOCKED)", async () => {
    const seeded = await seedPendingEnvios(admin, { count: PENDING_COUNT });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    // Separate connections, not one shared `db` — `testing/postgres.ts`'s own doc comment on
    // `connect()`: two callers must land on two distinct backend processes for `FOR UPDATE` to
    // have anything to block/skip against, mirroring `chain.concurrency.test.ts`'s identical
    // convention. `createPostgresDb`'s pool (default size 10) could in principle multiplex two
    // callers onto two of its own connections even if shared, but a dedicated connection per
    // drainer removes any doubt and matches this package's one other concurrency suite.
    const dbA = await pg.connect();
    const dbB = await pg.connect();
    try {
      const a = new VerifactuBackend({
        clock: seeded.clock,
        db: dbA,
        resolveClient: staticResolver(aeat.client()),
      });
      const b = new VerifactuBackend({
        clock: seeded.clock,
        db: dbB,
        resolveClient: staticResolver(aeat.client()),
      });
      const now = new Date("2026-07-21T00:01:00Z");

      const [ra, rb] = await Promise.all([a.drain(now), b.drain(now)]);

      // THE LOAD-BEARING ASSERTION. Without `FOR UPDATE ... SKIP LOCKED` in `claimBatch`, a plain
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
      const rows = await withTenant(admin, seeded.tenantId, (tx) =>
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

  /**
   * `pendingCount`'s own dedicated RLS proof already lives in `pending-count.rls.test.ts` (a
   * genuinely non-superuser LOGIN role via `pg.connectAs`, exercising the class method's own
   * internal `withTenant` call end to end). This test is narrower and complements it: it proves
   * that AFTER a `drain()` pass — which itself always runs on the admin/owner connection, since
   * `tenantsWithWork`'s cross-tenant enumeration is RLS-deferred by design (spec §7.1, `drain.ts`'s
   * own doc comment) — the pending count under a genuinely RLS-subject role (`asAppUser`, `SET
   * LOCAL ROLE app_user`) reflects the drained state, not a stale or unscoped one. `asAppUser`
   * changes the EFFECTIVE role for the rest of that one transaction (current_user, not
   * session_user, is what Postgres checks for RLS bypass), so this holds even though `admin`
   * itself is the Testcontainers superuser login — the same pattern this package's other suites
   * use on PGlite (`asAppUser`'s own doc comment), now proven on real Postgres too.
   */
  it("pendingCount reflects drained rows under the app_user role (RLS), not just the admin connection", async () => {
    const seeded = await seedPendingEnvios(admin, { count: 3 });
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const backend = new VerifactuBackend({
      clock: seeded.clock,
      db: admin,
      resolveClient: staticResolver(aeat.client()),
    });

    const pendingUnderRls = () =>
      withTenant(admin, seeded.tenantId, async (tx) => {
        await asAppUser(tx);
        const rows = await tx.execute<{ count: string }>(sql`
          select count(*)::text as count
          from envios e
          join registros_facturacion r on r.id = e.registro_id
          where r.till_id = ${seeded.tillId} and e.tenant_id = ${seeded.tenantId} and e.estado = 'pendiente'
        `);
        return Number(rows.rows[0]!.count);
      });

    expect(await pendingUnderRls()).toBe(3);

    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));
    expect(result.recordsAccepted).toBe(3);

    expect(await pendingUnderRls()).toBe(0);
  }, 30_000);
});

/**
 * The §7.1/§11 property this file previously deferred. `tenantsWithWork` must enumerate EVERY
 * tenant's due work to decide which to drain, but `envios` carries FORCE ROW LEVEL SECURITY and its
 * tenant-isolation policy fails closed (`current_tenant_id()` is NULL with no `app.tenant_id`). So
 * under a real non-superuser deployment role, the old raw `select distinct tenant_id from envios`
 * saw ZERO rows and the drainer was a silent no-op — the gap the concurrency suite's own
 * `pendingCount` test used to acknowledge as "RLS-deferred by design". The `envios_tenants_with_work`
 * SECURITY DEFINER function (drizzle/0004, owned by the `envios_drainer` role, which alone carries a
 * permissive `USING (true)` SELECT policy on `envios`) is the seam that closes it. Proven here on
 * the ONE role RLS actually applies to — never the superuser `admin` connection the rest of this
 * package seeds on — exactly as §11 required and this plan delivers.
 */
describe("drain — cross-tenant enumeration seam under RLS (real Postgres, as app_user)", () => {
  const pendingUnderRls = (tenantId: string) =>
    withTenant(admin, tenantId, async (tx) => {
      await asAppUser(tx);
      const rows = await tx.execute<{ count: string }>(sql`
        select count(*)::text as count from envios where tenant_id = ${tenantId} and estado = 'pendiente'
      `);
      return Number(rows.rows[0]!.count);
    });

  it("enumerates and drains due tenants across the tenant boundary as app_user (no tenant GUC)", async () => {
    // Two DISTINCT tenants (distinct NIFs via seedTenantWithSif), each with due pending work — so
    // the enumeration is a genuine cross-tenant sweep, not a single-tenant read a tenant-scoped
    // policy would also satisfy.
    const t1 = await seedPendingEnvios(admin, { count: 2 });
    const t2 = await seedPendingEnvios(admin, { count: 3 });
    const total = 5;
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const now = new Date("2026-07-21T00:01:00Z");

    expect(await pendingUnderRls(t1.tenantId)).toBe(2);
    expect(await pendingUnderRls(t2.tenantId)).toBe(3);

    // The WHOLE drain runs on a genuinely RLS-subject connection: drain_probe is a non-superuser
    // member of app_user, so FORCE ROW LEVEL SECURITY applies to every query drain issues —
    // including tenantsWithWork's top-level enumeration, which runs outside any withTenant tx.
    const appUserDb = await pg.connectAs(DRAIN_PROBE_ROLE, DRAIN_PROBE_PASSWORD);
    try {
      const backend = new VerifactuBackend({
        clock: t1.clock,
        db: appUserDb,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.drain(now);

      // RED before the seam: tenantsWithWork's raw enumeration saw zero rows under app_user, drain
      // was a silent no-op — recordsAccepted 0, both tenants still fully pending. GREEN after:
      // envios_tenants_with_work crosses the tenant boundary and both tenants are drained.
      expect(result.recordsAccepted).toBe(total);
      expect(aeat.stored()).toHaveLength(total);
    } finally {
      await appUserDb.close();
    }

    // Definitive proof the seam reached BOTH tenants: each tenant's pending backlog is now empty,
    // read back under the same RLS-subject role.
    expect(await pendingUnderRls(t1.tenantId)).toBe(0);
    expect(await pendingUnderRls(t2.tenantId)).toBe(0);
  }, 30_000);

  it("hands app_user only the due-tenant id list, never cross-tenant envío rows", async () => {
    const t1 = await seedPendingEnvios(admin, { count: 1 });
    const now = new Date("2026-07-21T00:01:00Z");
    const appUserDb = await pg.connectAs(DRAIN_PROBE_ROLE, DRAIN_PROBE_PASSWORD);
    try {
      // The permissive USING(true) policy is scoped to envios_drainer, which only the function's
      // SECURITY DEFINER context ever runs as — so a DIRECT read of envios on this same app_user
      // connection (no tenant GUC) still sees zero rows. The seam opens no general cross-tenant read.
      const direct = await appUserDb.execute<{ count: string }>(
        sql`select count(*)::text as count from envios`,
      );
      expect(Number(direct.rows[0]!.count)).toBe(0);

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

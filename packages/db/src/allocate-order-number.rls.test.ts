import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { allocateOrderNumber } from "./allocate-order-number.js";
import type { Database } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { locations } from "./schema/tenants.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { useRealPostgres } from "./testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "./testing/postgres.js";
import { asAppUser } from "./testing/roles.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { withTenant } from "./tenancy.js";

// The number of concurrent allocators. Distinct backends (see the concurrency
// test's own load-bearing pid assertion), so this is also the connection count.
const WRITERS = 20;

// Real PostgreSQL only. Two properties are being proven here that PGlite CANNOT
// reproduce, and each would report a vacuous green there:
//   1. Tenant isolation of the WRITE path, under FORCE ROW LEVEL SECURITY — a
//      superuser (every PGlite connection) bypasses RLS unconditionally.
//   2. That concurrent allocators receive DISTINCT numbers — PGlite serialises
//      every query onto one backend, so a race never happens.
// startMigratedPostgres throws rather than degrading to a skip when Docker is
// absent, so an environment without Docker fails loudly rather than silently
// dropping the only coverage these properties have.
const suite = useRealPostgres({
  start: () =>
    startMigratedPostgres({
      dockerRequired:
        "The allocateOrderNumber RLS/concurrency suite requires a running Docker daemon. It " +
        "cannot be skipped: PGlite runs every connection as a superuser (bypassing the counter's " +
        "FORCE ROW LEVEL SECURITY) and serialises all queries onto one backend, so it can prove " +
        "neither the tenant isolation of the counter's write path nor that concurrent allocators " +
        "receive distinct numbers.",
      migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    }),
  // Restates this package's own 120s hookTimeout (vitest.config.ts), which the helper's absent
  // default would otherwise leave to vitest's — the figure covers pulling the Postgres image on a
  // cold runner.
  timeoutMs: 120_000,
});

// The suite shares ONE migrated database across every test (useRealPostgres does not reset between
// them), and working_order_counters cannot be truncated back — its FK chain to `tenants` cascades
// into append-only fiscal tables whose BEFORE TRUNCATE trigger blocks the wipe. So each test mints a
// FRESH tenant + node instead (seedTenant uses a fresh NIF and a fresh uuid), leaving its rows
// simply new and independent of any earlier test's — the same approach chain.concurrency.test.ts
// takes for the same reason.
async function freshTenantNode(admin: Database): Promise<{ tenantId: string; nodeId: string }> {
  const tenantId = await seedTenant(admin);
  const [location] = await admin
    .insert(locations)
    .values({
      tenantId,
      name: "Fixture Location",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    })
    .returning({ id: locations.id });
  const nodeId = await seedNode(admin, tenantId, brandLocationId(location!.id));
  return { tenantId, nodeId };
}

it("allocates 1 then 2 as the non-owner app role", async () => {
  // Closes Task 1's deferred Minor: the allocator is the first thing to WRITE this table as
  // app_user. The first call exercises the INSERT grant + the policy's WITH CHECK; the second
  // exercises the UPDATE grant + the policy's USING and WITH CHECK. A missing grant or a wrong
  // policy fails only here, never in a superuser (PGlite) run.
  const { tenantId, nodeId } = await freshTenantNode(suite.admin);
  const first = await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return allocateOrderNumber(tx, tenantId, nodeId);
  });
  const second = await withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    return allocateOrderNumber(tx, tenantId, nodeId);
  });
  expect([first, second]).toEqual([1, 2]);
});

it("isolates the counter's write path between tenants", async () => {
  const a = await freshTenantNode(suite.admin);
  const b = await freshTenantNode(suite.admin);

  // Tenant A advances its own counter to 2, as the app role.
  for (let i = 0; i < 2; i += 1) {
    await withTenant(suite.admin, a.tenantId, async (tx) => {
      await asAppUser(tx);
      return allocateOrderNumber(tx, a.tenantId, a.nodeId);
    });
  }

  // Tenant B (app role) tries to allocate against A's (tenant, node). RLS makes A's row invisible
  // to B and rejects the write — captureError throws if it does NOT reject, so a silent success (a
  // policy that failed to isolate) fails this test rather than passing it vacuously.
  const error = await captureError(() =>
    withTenant(suite.admin, b.tenantId, async (tx) => {
      await asAppUser(tx);
      return allocateOrderNumber(tx, a.tenantId, a.nodeId);
    }),
  );
  // 42501, and specifically the RLS refusal — not a bare grant denial, which is ALSO 42501 (the
  // trap provisioner-role.rls.test.ts documents). Asserting the message pins it to the policy:
  // the counter's WITH CHECK rejects the write because the proposed row's tenant_id (A) is not
  // current_tenant_id() (B). Verified live to fire identically whether or not A's row already
  // exists — the message reads "new row violates row-level security policy" for both paths.
  expect(pgErrorCode(error)).toBe("42501");
  expect(pgErrorMessage(error)).toMatch(/row-level security policy/);

  // A's counter is untouched by B's attempt. Read as the superuser owner (bypasses RLS), so this
  // sees the real stored value regardless of tenant scope.
  const stored = await suite.admin.execute<{ next: number }>(sql`
    select next_number as next from working_order_counters
    where tenant_id = ${a.tenantId} and node_id = ${a.nodeId}
  `);
  expect(stored.rows[0]?.next).toBe(2);

  // B's OWN node is a separate counter and starts fresh at 1 — B never inherits A's value.
  const bFirst = await withTenant(suite.admin, b.tenantId, async (tx) => {
    await asAppUser(tx);
    return allocateOrderNumber(tx, b.tenantId, b.nodeId);
  });
  expect(bFirst).toBe(1);
});

it("hands out distinct numbers to concurrent allocators on distinct backends", async () => {
  const { tenantId, nodeId } = await freshTenantNode(suite.admin);
  const dbs = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
  try {
    // Load-bearing: distinct backend PROCESSES. On PGlite these collapse onto one and every
    // assertion below is theatre — this is the guard that the concurrency is real, mirroring
    // chain.concurrency.test.ts's own distinct-pid check.
    const pids = await Promise.all(
      dbs.map(async (db) => {
        const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        return rows[0]?.pid;
      }),
    );
    expect(new Set(pids).size).toBe(WRITERS);

    // All WRITERS allocate the same (tenant, node) at once, each on its own backend, each as the
    // app role. A read-then-write allocator would hand the same number out twice here.
    const results = await Promise.all(
      dbs.map((db) =>
        withTenant(db, tenantId, async (tx) => {
          await asAppUser(tx);
          return allocateOrderNumber(tx, tenantId, nodeId);
        }),
      ),
    );
    expect(new Set(results).size).toBe(WRITERS);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(WRITERS);
  } finally {
    await Promise.all(dbs.map((db) => db.close()));
  }
});

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database, Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useRealPostgres } from "../testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "../testing/postgres.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants, tills } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: the headline property this suite proves —
// prep advancing on an already-settled order WITHOUT touching the frozen working_orders row — is a
// FORCE-RLS + grant story (order_prep's UPDATE grant, its tenant-isolation policy, and the ABSENCE
// of a DELETE grant), all of which PGlite's superuser connection bypasses unconditionally (CLAUDE.md
// §4, mirroring park-retrieve.rls.test.ts / orders.transition.rls.test.ts's identical justification).
// The working_orders_enforce_transition control (settled is terminal) is behavioural DDL that would
// fire on PGlite too, but it rides along on the one container this suite already needs.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Captured at seed time — tenant A's node id, which every test but the node-scoped-queue one
// attributes its order/prep fixtures to (that test seeds its own dedicated nodes — see there).
let nodeA = "";
// A fresh order number per seeded working order, so no two collide (orders.transition/
// append-order-amendment idiom — working_orders carries no UNIQUE on order_number in this slice, but
// keeping each fixture's number distinct keeps it independent of the others regardless).
let orderNumberSeq = 0;

/** A signal thrown to roll back a deliberately-destructive proof transaction (the inmutabilidad
 * layered-proof idiom, mirrored in append-order-amendment.rls.test.ts): grant a privilege / weaken a
 * policy, observe the effect, then unwind so nothing here outlives its own test. */
class RollbackSignal extends Error {}

async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("order_prep schema", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The order_prep schema suite requires a running Docker daemon. It cannot be skipped: " +
          "PGlite runs every connection as a superuser, which bypasses the FORCE ROW LEVEL " +
          "SECURITY and the grant shape (UPDATE, no DELETE) this suite exists to prove on " +
          "order_prep.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    // Restates this package's own vitest hookTimeout (120s), which the helper's 60s default would
    // otherwise narrow — the figure covers pulling the Postgres image on a cold runner.
    timeoutMs: 120_000,
  });

  // Common scaffolding seeded once as the owner (superuser bypasses RLS — pure setup). Registered
  // after the helper's own hook, which vitest runs first; if it throws this one never runs, so
  // `suite.admin` is never read unstarted (verified pattern, park-retrieve.rls.test.ts).
  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Fixture Location A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      {
        id: LOCATION_B,
        tenantId: TENANT_B,
        name: "Fixture Location B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    await admin.insert(tills).values([
      { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
      { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
    ]);
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  });

  /** Runs `fn` inside tenant A's transaction, wearing the app role (the only role RLS/grants
   * constrain — matches append-order-amendment.rls.test.ts / orders.transition.rls.test.ts). */
  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  function asAppB<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  /** Opens one fresh `open` working order as the owner (superuser bypasses RLS — pure setup),
   * mirroring park-retrieve's / append-order-amendment's openOrder. */
  async function openOrder(tenant: string, till: string, node: string): Promise<string> {
    orderNumberSeq += 1;
    const result = await suite.admin.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, node_id, order_number, status, opened_at)
          values (${tenant}, ${till}, ${node}, ${orderNumberSeq}, 'open', ${AT}) returning id`,
    );
    return result.rows[0]!.id;
  }

  /** Inserts one `order_prep` row as tenant A's app_user. */
  function seedPrep(tenant: string, order: string, node: string, state: string): Promise<unknown> {
    return asApp((tx) =>
      tx.execute(
        sql`insert into order_prep (tenant_id, working_order_id, node_id, state)
            values (${tenant}, ${order}, ${node}, ${state})`,
      ),
    );
  }

  /** Same, as tenant B's app_user. */
  function seedPrepB(tenant: string, order: string, node: string, state: string): Promise<unknown> {
    return asAppB((tx) =>
      tx.execute(
        sql`insert into order_prep (tenant_id, working_order_id, node_id, state)
            values (${tenant}, ${order}, ${node}, ${state})`,
      ),
    );
  }

  it("advances prep on an already-settled order without touching the frozen working_orders row", async () => {
    const orderA = await openOrder(TENANT_A, TILL_A1, nodeA);
    // Mode-P walk-up: open → settled directly, never entering placed (design §3, §5) — the exact
    // shape orders.transition.rls.test.ts's "permits open → settled directly" proves at the
    // working_orders level; here it is the SETUP for the conflict this suite exists to disprove.
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${orderA}`,
      ),
    );

    // Insert its prep row and advance it as app_user — on the separate, mutable order_prep table.
    await asApp((tx) =>
      tx.execute(sql`insert into order_prep (tenant_id, working_order_id, node_id, state)
        values (${TENANT_A}, ${orderA}, ${nodeA}, 'queued')`),
    );
    await asApp((tx) =>
      tx.execute(sql`update order_prep set state = 'preparing', preparing_at = now()
        where tenant_id = ${TENANT_A} and working_order_id = ${orderA}`),
    );
    await asApp((tx) =>
      tx.execute(sql`update order_prep set state = 'ready', ready_at = now()
        where tenant_id = ${TENANT_A} and working_order_id = ${orderA}`),
    );
    const [prep] = await asApp((tx) =>
      tx
        .execute<{ state: string }>(
          sql`select state from order_prep where working_order_id = ${orderA}`,
        )
        .then((r) => r.rows),
    );
    expect(prep!.state).toBe("ready");

    // The working_orders row was NEVER updated by any of the three prep advances above — still
    // settled, working_orders_enforce_transition never fired for them.
    const [wo] = await asApp((tx) =>
      tx
        .execute<{ status: string }>(sql`select status from working_orders where id = ${orderA}`)
        .then((r) => r.rows),
    );
    expect(wo!.status).toBe("settled");

    // Control: this is not "the trigger happens to allow it" — attempting the SAME kind of write
    // directly against working_orders (not order_prep) on this settled row IS rejected. This is the
    // exact Mode-P conflict a single working_orders.prep_state column would have hit, and it is why
    // order_prep is a separate table (design §5, orders.transition.rls.test.ts's "rejects every
    // transition out of settled/abandoned").
    const e = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update working_orders set status = 'abandoned' where id = ${orderA}`),
      ),
    );
    expect(pgErrorCode(e)).toBe("P0001");
  });

  it("the node-scoped queue returns only this tenant's node rows; tenant B sees none of A's", async () => {
    // Nodes scoped to just this test, not the shared nodeA/nodeB fixture: order_prep is mutable but
    // nothing truncates it between tests, so counting by the SHARED node would pick up rows other
    // tests in this file already inserted on it. A dedicated node per tenant here keeps the exact
    // count below immune to run order or to what earlier tests seeded (append-order-amendment's
    // tenant-wide-total-drift comment, same shape, a different fix: exact count via isolation
    // instead of a filtered total).
    const queueNodeA = await seedNode(
      suite.admin,
      brandTenantId(TENANT_A),
      brandLocationId(LOCATION_A),
    );
    const queueNodeB = await seedNode(
      suite.admin,
      brandTenantId(TENANT_B),
      brandLocationId(LOCATION_B),
    );
    const orderA = await openOrder(TENANT_A, TILL_A1, queueNodeA);
    const orderB = await openOrder(TENANT_B, TILL_B1, queueNodeB);
    await seedPrep(TENANT_A, orderA, queueNodeA, "queued");
    await seedPrepB(TENANT_B, orderB, queueNodeB, "queued");

    const aSeen = await asApp((tx) =>
      tx
        .execute<{ n: number }>(
          sql`select count(*)::int as n from order_prep where node_id = ${queueNodeA}`,
        )
        .then((r) => r.rows[0]!.n),
    );
    // RLS hides A's prep from B even querying by A's own node id — not merely "B has no rows of its
    // own for that node", but "B cannot see A's row at all", the tenant predicate rather than the
    // node filter doing the work.
    const bSeesA = await asAppB((tx) =>
      tx
        .execute<{ n: number }>(
          sql`select count(*)::int as n from order_prep where node_id = ${queueNodeA}`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(aSeen).toBe(1);
    expect(bSeesA).toBe(0);
  });

  it("app_user has UPDATE on order_prep but NOT DELETE", async () => {
    const orderA = await openOrder(TENANT_A, TILL_A1, nodeA);
    await seedPrep(TENANT_A, orderA, nodeA, "queued");
    const e = await captureError(() =>
      asApp((tx) => tx.execute(sql`delete from order_prep where working_order_id = ${orderA}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // Mirrors append-order-amendment.rls.test.ts's identical proof. A's row is committed (asApp
    // commits normally) before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` inside a ROLLED-BACK transaction makes tenant B suddenly see it — so
    // the `tenant_id = current_tenant_id()` predicate, not mere table access, is what hid it. A full
    // DROP POLICY would be the WRONG deletion here too: FORCE RLS with no policy denies ALL rows, so
    // B would see zero for the opposite reason (access lost, not isolation lost).
    const orderA = await openOrder(TENANT_A, TILL_A1, nodeA);
    await seedPrep(TENANT_A, orderA, nodeA, "queued");
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy order_prep_tenant_isolation on order_prep using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ foreign: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as foreign
              from order_prep`,
        )
        .then((r) => r.rows[0]!.foreign);
      expect(foreign).toBeGreaterThan(0); // A's row now leaks through to B — the predicate was the guard.
    });
  });

  it("the missing DELETE grant is what blocks the delete above (proof by addition of the grant)", async () => {
    // The layered-proof idiom (inmutabilidad.test.ts, append-order-amendment.rls.test.ts), read in
    // the OTHER direction: order_prep carries no immutability trigger to fall back on (it is
    // mutable, by design), so once DELETE is granted there is nothing left to stop it — the 42501
    // above disappears entirely and the row is actually removed. Granting inside a transaction that
    // rolls back keeps the table's real grants (SELECT, INSERT, UPDATE — no DELETE) untouched for
    // every other test in this file.
    const orderA = await openOrder(TENANT_A, TILL_A1, nodeA);
    await seedPrep(TENANT_A, orderA, nodeA, "queued");
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`grant delete on order_prep to app_user`);
      await tx.execute(sql`set local role app_user`);
      await tx.execute(
        sql`delete from order_prep where tenant_id = ${TENANT_A} and working_order_id = ${orderA}`,
      );
      const remaining = await tx
        .execute<{ n: number }>(
          sql`select count(*)::int as n from order_prep where working_order_id = ${orderA}`,
        )
        .then((r) => r.rows[0]!.n);
      expect(remaining).toBe(0); // no 42501 raised above — the delete actually went through.
    });
  });
});

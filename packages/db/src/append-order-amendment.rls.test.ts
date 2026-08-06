import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { appendOrderAmendment, type AppendAmendmentInput } from "./append-order-amendment.js";
import type { Database, Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { verifyAmendmentChain, type VerifiableAmendment } from "./order-amendment-hash.js";
import { captureError, pgErrorCode } from "./testing/errors.js";
import { useRealPostgres } from "./testing/lifecycle.js";
import { runMigrationSets, startMigratedPostgres } from "./testing/postgres.js";
import { seedNode } from "./testing/seed.js";
import { withTenant } from "./tenancy.js";
import { locations, tenants, tills } from "./schema/tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: this suite proves append-only immutability
// and tenant isolation on `order_amendments`, both of which PGlite cannot show — every PGlite
// connection is a superuser that bypasses FORCE ROW LEVEL SECURITY and every REVOKE, so a PGlite
// pass would be a FALSE pass (CLAUDE.md §4). The happy-path append and the hash re-verification
// would pass on either target; they ride along on the one container this suite already needs.
//
// `order_amendments` is append-only for EVERY role, the owner included (reject_mutation blocks
// UPDATE/DELETE/TRUNCATE), so nothing can clean it up between tests — the table only grows. Each
// test therefore seeds its OWN working order and scopes its per-chain reads to that order's id, and
// the isolation assertions count FOREIGN-tenant rows (which RLS must keep at zero) rather than a
// tenant-wide total that would drift as earlier tests accumulate rows.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const OPERATOR_A = "aaaaaaaa-2222-4000-8000-000000000001";
const OPERATOR_B = "bbbbbbbb-2222-4000-8000-000000000001";
const OTHER_ACTOR = "cccccccc-2222-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Captured at seed time — the tenant-scoped node ids the amendments attribute to.
let nodeA = "";
let nodeB = "";
// A fresh order number per seeded working order, so no two collide on the counter's uniqueness.
let orderNumberSeq = 0;

/** A signal thrown to roll back a deliberately-destructive proof transaction (the inmutabilidad
 * layered-proof idiom): grant a privilege / weaken a policy, observe the backstop, then unwind. */
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

describe("order_amendments append helper", () => {
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "The order_amendments append suite requires a running Docker daemon. It cannot be " +
          "skipped: PGlite runs every connection as a superuser, which bypasses the FORCE ROW " +
          "LEVEL SECURITY and the REVOKE this suite exists to prove on order_amendments.",
        migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      }),
    // Restates this package's own vitest hookTimeout (120s), which the helper's absent default would
    // otherwise leave at vitest's — covers pulling the Postgres image on a cold runner.
    timeoutMs: 120_000,
  });

  // As the connection owner (superuser bypasses RLS — pure setup): two tenants, each with a
  // location, a till and a node. Working orders are seeded per-test (see openOrder).
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
    nodeB = await seedNode(admin, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
  });

  /** Seeds one fresh open working order as the owner and returns its id. A fresh chain per test so
   * sequence numbers are predictable and one test's rows never interleave with another's. */
  async function openOrder(tenant: string, till: string, node: string): Promise<string> {
    orderNumberSeq += 1;
    const result = await suite.admin.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, node_id, order_number, status, opened_at)
          values (${tenant}, ${till}, ${node}, ${orderNumberSeq}, 'open', ${AT}) returning id`,
    );
    return result.rows[0]!.id;
  }

  /** Runs `fn` inside tenant A's transaction, wearing the app role (the only role RLS constrains). */
  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return fn(tx);
    });
  }

  function asAppB<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return fn(tx);
    });
  }

  /** Tenant A's genesis `order_placed` input for an order. Reason null (a placement has no contest). */
  function genesisA(order: string): AppendAmendmentInput {
    return {
      tenantId: TENANT_A,
      workingOrderId: order,
      kind: "order_placed",
      actorId: OPERATOR_A,
      reason: null,
      capturedByTillId: TILL_A1,
      capturedByNodeId: nodeA,
      eventAt: new Date("2026-08-06T10:00:00.500Z"),
      eventOffsetMinutes: 120,
    };
  }

  function genesisB(order: string): AppendAmendmentInput {
    return {
      tenantId: TENANT_B,
      workingOrderId: order,
      kind: "order_placed",
      actorId: OPERATOR_B,
      reason: null,
      capturedByTillId: TILL_B1,
      capturedByNodeId: nodeB,
      eventAt: new Date("2026-08-06T10:00:00.500Z"),
      eventOffsetMinutes: 120,
    };
  }

  /** Reads one order's whole chain back as verifiable rows, ordered by chain position. `event_at`
   * is projected to a UTC ISO instant with a millisecond field (always `.000`, since the stored
   * value is whole-second-truncated) so `verifyAmendmentChain`'s `Date.parse` sees exactly the
   * instant the stored hash committed. Read as the owner — this is a read-back for verification, not
   * the isolation assertion. */
  async function readAmendments(order: string): Promise<VerifiableAmendment[]> {
    // An inline row TYPE LITERAL, not `execute<VerifiableAmendment>`: `execute`'s generic is
    // constrained to `Record<string, unknown>`, which an INTERFACE (VerifiableAmendment) does not
    // satisfy while a structurally-identical type literal does. The literal's fields mirror
    // VerifiableAmendment exactly, so `rows` is assignable to the return type.
    const { rows } = await suite.admin.execute<{
      sequenceNo: number;
      workingOrderId: string;
      kind: "order_placed" | "order_cancelled";
      actorId: string;
      reason: string | null;
      capturedByTillId: string;
      capturedByNodeId: string;
      eventAt: string;
      eventOffsetMinutes: number;
      entryHash: string;
      prevEntryHash: string | null;
      isFirstEntry: boolean;
    }>(sql`
      select
        sequence_no as "sequenceNo",
        working_order_id as "workingOrderId",
        kind,
        actor_id as "actorId",
        reason,
        captured_by_till_id as "capturedByTillId",
        captured_by_node_id as "capturedByNodeId",
        to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "eventAt",
        event_offset_minutes as "eventOffsetMinutes",
        entry_hash as "entryHash",
        prev_entry_hash as "prevEntryHash",
        is_first_entry as "isFirstEntry"
      from order_amendments
      where working_order_id = ${order}
      order by sequence_no
    `);
    return rows;
  }

  it("appends a hashed per-order sequence, genesis first then linked", async () => {
    const order = await openOrder(TENANT_A, TILL_A1, nodeA);
    const first = await asApp((tx) => appendOrderAmendment(tx, genesisA(order)));
    expect(first.sequenceNo).toBe(1);
    const second = await asApp((tx) =>
      appendOrderAmendment(tx, {
        tenantId: TENANT_A,
        workingOrderId: order,
        kind: "order_cancelled",
        actorId: OPERATOR_A,
        reason: "customer left",
        capturedByTillId: TILL_A1,
        capturedByNodeId: nodeA,
        eventAt: new Date("2026-08-06T10:05:00.900Z"),
        eventOffsetMinutes: 120,
      }),
    );
    expect(second.sequenceNo).toBe(2);

    const rows = await readAmendments(order);
    expect(rows).toHaveLength(2);
    // The genesis carries no predecessor; the second links to the first's stored hash.
    expect(rows[0]!.isFirstEntry).toBe(true);
    expect(rows[0]!.prevEntryHash).toBeNull();
    expect(rows[1]!.isFirstEntry).toBe(false);
    expect(rows[1]!.prevEntryHash).toBe(rows[0]!.entryHash);
    expect(rows[1]!.entryHash).toBe(second.entryHash);
    // The whole chain re-verifies against the stored hashes end to end.
    expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
    // event_at was truncated to whole seconds at the write choke point (the sub-second .500 / .900
    // is gone), which is what keeps the stored value, the hashed instant and the read-back identical.
    expect(rows[0]!.eventAt).toBe("2026-08-06T10:00:00.000Z");
    expect(rows[1]!.eventAt).toBe("2026-08-06T10:05:00.000Z");
  });

  it("is append-only: app_user is refused UPDATE and DELETE on privilege grounds (42501)", async () => {
    const order = await openOrder(TENANT_A, TILL_A1, nodeA);
    await asApp((tx) => appendOrderAmendment(tx, genesisA(order)));
    // REVOKE fires before any trigger — the role was never granted UPDATE/DELETE, so the statement
    // is refused before a row is examined. This is the control; the trigger backstop is proven below.
    const eU = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update order_amendments set reason = 'x' where working_order_id = ${order}`),
      ),
    );
    expect(pgErrorCode(eU)).toBe("42501");
    const eD = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`delete from order_amendments where working_order_id = ${order}`),
      ),
    );
    expect(pgErrorCode(eD)).toBe("42501");
  });

  it("is append-only at the trigger too: a granted UPDATE/DELETE still raises WT001 (proof by deletion of the REVOKE)", async () => {
    // The layered proof (inmutabilidad.test.ts): revocation fires first, so the two 42501 tests
    // above never reach the trigger — and a trigger nobody has seen fire is a comment, not a
    // backstop. Grant the privilege inside a transaction that rolls back and watch reject_mutation
    // catch it anyway. The trigger fires for every actor, the owner included, so the granted app_user
    // is stopped by the second layer alone.
    const order = await openOrder(TENANT_A, TILL_A1, nodeA);
    await asApp((tx) => appendOrderAmendment(tx, genesisA(order)));
    // UPDATE and DELETE each in their OWN rolled-back transaction: the first WT001 aborts its
    // transaction (a later statement in it would return 25P02, in_failed_sql_transaction, not the
    // trigger's code), so testing both in one transaction would measure the poisoned-transaction
    // state for the second, not the trigger.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`grant update on order_amendments to app_user`);
      await tx.execute(sql`set local role app_user`);
      const eU = await captureError(() =>
        tx.execute(
          sql`update order_amendments set reason = 'forged' where working_order_id = ${order}`,
        ),
      );
      expect(pgErrorCode(eU)).toBe("WT001");
    });
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`grant delete on order_amendments to app_user`);
      await tx.execute(sql`set local role app_user`);
      const eD = await captureError(() =>
        tx.execute(sql`delete from order_amendments where working_order_id = ${order}`),
      );
      expect(pgErrorCode(eD)).toBe("WT001");
    });
  });

  it("is tenant-isolated: neither tenant sees ANY of the other's amendments (both non-empty)", async () => {
    const orderA = await openOrder(TENANT_A, TILL_A1, nodeA);
    const orderB = await openOrder(TENANT_B, TILL_B1, nodeB);
    await asApp((tx) => appendOrderAmendment(tx, genesisA(orderA))); // tenant A
    await asAppB((tx) => appendOrderAmendment(tx, genesisB(orderB))); // tenant B, same state

    // As B: rows are visible (not a blanket denial), and NONE of them belong to tenant A — even
    // A's rows from every other test in this file. `filter (where tenant_id = A)` sees the base
    // relation AFTER the policy has filtered it, so a leak would show up as a non-zero foreign count.
    const bView = await asAppB((tx) =>
      tx
        .execute<{ total: number; foreign: number }>(
          sql`select count(*)::int as total,
                     (count(*) filter (where tenant_id = ${TENANT_A}))::int as foreign
              from order_amendments`,
        )
        .then((r) => r.rows[0]!),
    );
    expect(bView.total).toBeGreaterThan(0); // B genuinely has rows — access is not the thing denied.
    expect(bView.foreign).toBe(0); // B sees NONE of A's — this is the isolation.

    // Symmetric, so the assertion is not one-directional: A sees rows, and none are B's.
    const aView = await asApp((tx) =>
      tx
        .execute<{ total: number; foreign: number }>(
          sql`select count(*)::int as total,
                     (count(*) filter (where tenant_id = ${TENANT_B}))::int as foreign
              from order_amendments`,
        )
        .then((r) => r.rows[0]!),
    );
    expect(aView.total).toBeGreaterThan(0);
    expect(aView.foreign).toBe(0);
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // Rows for both tenants exist by now (committed, and un-deletable). Weakening the policy's
    // predicate to `true` inside a rolled-back transaction makes tenant B suddenly see tenant A's
    // rows — so the `tenant_id = current_tenant_id()` predicate, not mere table access, is what hid
    // them. A full DROP POLICY is the WRONG deletion: FORCE RLS with no policy denies ALL rows, so B
    // would see zero — which also breaks isolation counting, but for the opposite reason (access
    // lost, not isolation lost). Swapping the predicate for `true` isolates the predicate itself.
    const orderA = await openOrder(TENANT_A, TILL_A1, nodeA);
    await asApp((tx) => appendOrderAmendment(tx, genesisA(orderA)));
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy order_amendments_tenant_isolation on order_amendments using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ foreign: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as foreign
              from order_amendments`,
        )
        .then((r) => r.rows[0]!.foreign);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak through to B — the predicate was the guard.
    });
  });

  it("the stored hash commits the reason, actor and capturing node — a tamper of any breaks verification", async () => {
    const order = await openOrder(TENANT_A, TILL_A1, nodeA);
    await asApp((tx) => appendOrderAmendment(tx, genesisA(order)));
    await asApp((tx) =>
      appendOrderAmendment(tx, {
        tenantId: TENANT_A,
        workingOrderId: order,
        kind: "order_cancelled",
        actorId: OPERATOR_A,
        reason: "customer left",
        capturedByTillId: TILL_A1,
        capturedByNodeId: nodeA,
        eventAt: new Date("2026-08-06T10:05:00Z"),
        eventOffsetMinutes: 120,
      }),
    );
    const rows = await readAmendments(order);
    // The genuine, untouched chain verifies against the stored hashes.
    expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
    // Rewriting any hashed field WITHOUT recomputing the stored hash — exactly what a party past the
    // immutability floor would attempt — recomputes a different digest and is caught. The trigger
    // above stops the write reaching the row; this proves that even if it did, the hash names it.
    expect(verifyAmendmentChain([rows[0]!, { ...rows[1]!, reason: "no refund given" }])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 2,
    });
    // The actor and the capturing node are hashed at the genesis (seq 1), so a tamper of either is
    // caught there.
    expect(verifyAmendmentChain([{ ...rows[0]!, actorId: OTHER_ACTOR }, rows[1]!])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 1,
    });
    expect(verifyAmendmentChain([{ ...rows[0]!, capturedByNodeId: nodeB }, rows[1]!])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 1,
    });
  });

  it("serialises concurrent appends to one order into a gap-free, verifiable chain (Decision 2's parent-row lock)", async () => {
    // The core proof of the parent-row lock, on real backends (PGlite serialises every query onto
    // one backend, so it cannot show contention — CLAUDE.md §4). N writers append to ONE fresh
    // order at once. The `SELECT … FOR UPDATE` on the parent row serialises them: each waits for the
    // previous to commit, then reads the advanced max sequence, so all N commit with contiguous
    // positions 1..N and one unbroken hash chain.
    //
    // Proven by deletion: drop `.for("update")` from appendOrderAmendment and the read-then-insert
    // races — the concurrent writers all read the same max and collide on
    // `order_amendments_chain_position_key` (23505), so `Promise.all` rejects and this test fails.
    // (The FK from order_amendments to working_orders takes only a SHARED key-share lock on the
    // parent, which does NOT serialise the writers — the exclusive FOR UPDATE is what does.)
    const WRITERS = 10;
    const order = await openOrder(TENANT_A, TILL_A1, nodeA);
    const conns = await Promise.all(Array.from({ length: WRITERS }, () => suite.pg.connect()));
    try {
      // A distinct instant per writer, so a lost race would also show as a wrong hash, not only a
      // duplicate position.
      const results = await Promise.all(
        conns.map((db, i) =>
          db.transaction((tx) =>
            appendOrderAmendment(tx, {
              tenantId: TENANT_A,
              workingOrderId: order,
              kind: i === 0 ? "order_placed" : "order_cancelled",
              actorId: OPERATOR_A,
              reason: i === 0 ? null : `amend ${String(i)}`,
              capturedByTillId: TILL_A1,
              capturedByNodeId: nodeA,
              eventAt: new Date(Date.parse("2026-08-06T10:00:00Z") + i * 1000),
              eventOffsetMinutes: 120,
            }),
          ),
        ),
      );
      // Every writer committed — none was starved or collided.
      expect(results).toHaveLength(WRITERS);
      const rows = await readAmendments(order);
      // Positions are contiguous 1..N, exactly one genesis, and the whole chain re-verifies.
      expect(rows.map((r) => r.sequenceNo)).toEqual(
        Array.from({ length: WRITERS }, (_, i) => i + 1),
      );
      expect(rows.filter((r) => r.isFirstEntry)).toHaveLength(1);
      expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
    } finally {
      await Promise.all(conns.map((db) => db.close()));
    }
  });
});

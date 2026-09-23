/**
 * `appendOrderAmendment`'s per-order hash chain: the genesis shape, the link, the stored hash's
 * coverage, and that overlapping appends land as one gap-free chain.
 *
 * THREE LOSSES, from the storage swap:
 *  - the `select … for update` on the parent `working_orders` row is DELETED, not translated.
 *    SQLite has no row locks and drizzle's SQLite query builder has no `.for()`. What serialises
 *    writers instead is the venue file's write queue — one write transaction on the file at a time
 *    (`packages/store/src/write-queue.ts`, and `append-order-amendment.ts`'s own header says the
 *    same at the call site). So the last case here no longer shows that a LOCK held under
 *    contention; it shows that the queue serialises overlapping callers. The control that used to
 *    back it — delete `.for("update")` and watch every writer collide on
 *    `order_amendments_chain_position_key` — has nothing left to delete. The receipt for the queue
 *    itself, with a control in the other direction, is `racePair` in
 *    `packages/catalogue/test/fixtures.ts`.
 *  - the append-only case was a LAYERED proof: `app_user` is refused UPDATE and DELETE by the
 *    grant, so the case granted the privilege inside a rolled-back transaction and watched the
 *    trigger refuse anyway. SQLite has no roles and no grants
 *    (`packages/db/src/testing/roles.ts`), so there is one layer and the case is now simply that
 *    the append-only trigger refuses.
 *  - the chain is read back through the Drizzle export rather than raw SQL. A raw `select` of
 *    `is_first_entry` answers 0 or 1, not a boolean, and `verifyAmendmentChain` reads that field.
 *
 * `order_amendments` is append-only for EVERY caller, so nothing can clean it up between tests —
 * the table only grows. Each test therefore seeds its OWN working order and scopes its reads to
 * that order's id rather than reading a table-wide total that would drift.
 *
 * A second LOCATION is seeded only to mint `nodeB`, the foreign node id the hash-tamper case swaps
 * in. There is one taxpayer row: a second `tenants` row cannot be inserted.
 */
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import { appendOrderAmendment, type AppendAmendmentInput } from "./append-order-amendment.js";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { verifyAmendmentChain, type VerifiableAmendment } from "./order-amendment-hash.js";
import { TRIGGER_ABORT } from "./sql-state.js";
import { isPgError } from "./unique-violation.js";
import { captureError, pgErrorMessage } from "./testing/errors.js";
import { seedNode } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";
import { orderAmendments } from "./schema/order-amendments.js";
import { workingOrders } from "./schema/orders.js";
import { locations, tenants, tills } from "./schema/tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const OPERATOR_A = "aaaaaaaa-2222-4000-8000-000000000001";
const OTHER_ACTOR = "cccccccc-2222-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Captured at seed time — the node ids the amendments attribute to.
let nodeA = "";
let nodeB = "";
// A fresh order number per seeded working order, so no two collide on the counter's uniqueness.
let orderNumberSeq = 0;

describe("order_amendments append helper", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  // Pure setup: the one taxpayer row, then two locations, each with a till and a node.
  // Working orders are seeded per-test (see openOrder).
  beforeAll(async () => {
    const admin = suite.db;
    await admin
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Fixture Location A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
      {
        id: LOCATION_B,
        name: "Fixture Location B",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    await admin.insert(tills).values([
      { id: TILL_A1, locationId: LOCATION_A, name: "A1" },
      { id: TILL_B1, locationId: LOCATION_B, name: "B1" },
    ]);
    nodeA = await seedNode(admin, brandLocationId(LOCATION_A));
    nodeB = await seedNode(admin, brandLocationId(LOCATION_B));
  });

  /** Seeds one fresh open working order and returns its id. A fresh chain per test so sequence
   * numbers are predictable and one test's rows never interleave with another's. Through the
   * Drizzle builder, since `id` is a `$defaultFn` column applied CLIENT-side. */
  async function openOrder(till: string, node: string): Promise<string> {
    orderNumberSeq += 1;
    const [row] = await suite.db
      .insert(workingOrders)
      .values({
        tillId: till,
        nodeId: node,
        orderNumber: orderNumberSeq,
        status: "open",
        openedAt: AT,
      })
      .returning({ id: workingOrders.id });
    return row!.id;
  }

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  /** Tenant A's genesis `order_placed` input for an order. Reason null (a placement has no contest). */
  function genesisA(order: string): AppendAmendmentInput {
    return {
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

  /** Reads one order's whole chain back as verifiable rows, ordered by chain position.
   *
   * Through the Drizzle export rather than raw SQL, for two reasons the engine forces: a raw
   * `select` of `is_first_entry` returns 0 or 1 where `verifyAmendmentChain` reads a boolean, and
   * `event_at` needs no projection at all — it is stored as the exact ISO instant
   * `appendOrderAmendment` truncated to whole seconds, where PostgreSQL's `timestamptz` had to be
   * rendered back with `to_char` before `Date.parse` saw the instant the hash committed. */
  async function readAmendments(order: string): Promise<VerifiableAmendment[]> {
    return suite.db
      .select({
        sequenceNo: orderAmendments.sequenceNo,
        workingOrderId: orderAmendments.workingOrderId,
        kind: orderAmendments.kind,
        actorId: orderAmendments.actorId,
        reason: orderAmendments.reason,
        capturedByTillId: orderAmendments.capturedByTillId,
        capturedByNodeId: orderAmendments.capturedByNodeId,
        eventAt: orderAmendments.eventAt,
        eventOffsetMinutes: orderAmendments.eventOffsetMinutes,
        entryHash: orderAmendments.entryHash,
        prevEntryHash: orderAmendments.prevEntryHash,
        isFirstEntry: orderAmendments.isFirstEntry,
      })
      .from(orderAmendments)
      .where(eq(orderAmendments.workingOrderId, order))
      .orderBy(asc(orderAmendments.sequenceNo));
  }

  it("appends a hashed per-order sequence, genesis first then linked", async () => {
    const order = await openOrder(TILL_A1, nodeA);
    const first = await inTx((tx) => appendOrderAmendment(tx, genesisA(order)));
    expect(first.sequenceNo).toBe(1);
    const second = await inTx((tx) =>
      appendOrderAmendment(tx, {
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

  it("is append-only: the trigger refuses an UPDATE and a DELETE", async () => {
    const order = await openOrder(TILL_A1, nodeA);
    await inTx((tx) => appendOrderAmendment(tx, genesisA(order)));
    const eU = await captureError(() =>
      suite.db
        .update(orderAmendments)
        .set({ reason: "forged" })
        .where(eq(orderAmendments.workingOrderId, order)),
    );
    expect(isPgError(eU, TRIGGER_ABORT)).toBe(true);
    expect(pgErrorMessage(eU)).toBe("order_amendments is append-only");
    const eD = await captureError(() =>
      suite.db.delete(orderAmendments).where(eq(orderAmendments.workingOrderId, order)),
    );
    expect(isPgError(eD, TRIGGER_ABORT)).toBe(true);
    expect(pgErrorMessage(eD)).toBe("order_amendments is append-only");
  });

  it("the stored hash commits the reason, actor and capturing node — a tamper of any breaks verification", async () => {
    const order = await openOrder(TILL_A1, nodeA);
    await inTx((tx) => appendOrderAmendment(tx, genesisA(order)));
    await inTx((tx) =>
      appendOrderAmendment(tx, {
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

  it("serialises overlapping appends to one order into a gap-free, verifiable chain", async () => {
    // The subject: N callers append to ONE fresh order at once and all N commit with contiguous
    // positions 1..N and one unbroken hash chain. See this file's header for what arranges that
    // now and what the PostgreSQL version proved instead.
    const WRITERS = 10;
    const order = await openOrder(TILL_A1, nodeA);
    // A distinct instant per writer, so a lost race would also show as a wrong hash, not only a
    // duplicate position.
    const results = await Promise.all(
      Array.from({ length: WRITERS }, (_, i) =>
        inTx((tx) =>
          appendOrderAmendment(tx, {
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
    // Every caller committed — none was starved or collided.
    expect(results).toHaveLength(WRITERS);
    const rows = await readAmendments(order);
    // Positions are contiguous 1..N, exactly one genesis, and the whole chain re-verifies.
    expect(rows.map((r) => r.sequenceNo)).toEqual(Array.from({ length: WRITERS }, (_, i) => i + 1));
    expect(rows.filter((r) => r.isFirstEntry)).toHaveLength(1);
    expect(verifyAmendmentChain(rows)).toEqual({ ok: true });
  });
});

import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { workingOrderCounters } from "./schema/working-order-counters.js";

/**
 * Allocates the next order number for a node's counter, race-free.
 *
 * One statement. On the FIRST allocation for a node the INSERT
 * creates the row at `next_number = 1` and RETURNING yields 1. On every
 * subsequent allocation the row already exists, so the unique index on
 * (node_id) diverts to DO UPDATE, which increments `next_number`
 * and RETURNING yields the NEW, already-incremented value — 2, then 3, and so
 * on. There is no read-then-write window: the increment and the read are the
 * same statement.
 *
 * Concurrency safety is the write queue's, the same as allocate-number.ts's
 * (see its doc comment). On PostgreSQL two allocators racing to CREATE the row
 * settled through the speculative-insert path, and once the row existed they
 * serialised on its row lock. Neither happens here, because there is no overlap
 * to settle: one write transaction runs on the venue file at a time —
 * `withTransaction` runs its body inside `db.withWriteLock`
 * (`packages/db/src/tenancy.ts:44`), and `packages/store/src/write-queue.ts`
 * queues each body behind the previous one's `commit` — so the second
 * allocator's statement does not run until the first's row is committed, and it
 * re-evaluates `next_number + 1` against that committed value. Distinct numbers,
 * never a duplicate. What overlapping callers therefore demonstrate is the queue
 * serialising them, in `allocateOrderNumber under overlapping callers` at the
 * bottom of allocate-order-number.test.ts; the receipt for the queue itself,
 * with a control in the other direction, is `racePair` in
 * `packages/catalogue/test/fixtures.ts`.
 *
 * Unlike allocate-number.ts, this returns `next_number` directly (1 on the
 * first call) rather than the pre-increment value: an order number is a plain
 * per-node counter starting at 1, not a fiscal series that may carry a
 * migrated starting point.
 */
export async function allocateOrderNumber(tx: Transaction, nodeId: string): Promise<number> {
  const [row] = await tx
    .insert(workingOrderCounters)
    .values({ nodeId, nextNumber: 1 })
    .onConflictDoUpdate({
      target: [workingOrderCounters.nodeId],
      set: { nextNumber: sql`${workingOrderCounters.nextNumber} + 1` },
    })
    .returning({ allocated: workingOrderCounters.nextNumber });
  return row!.allocated;
}

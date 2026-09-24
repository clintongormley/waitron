import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { workingOrderCounters } from "./schema/working-order-counters.js";

/**
 * Allocates the next order number for a node's counter, race-free.
 *
 * One statement, so there is no read-then-write window. Concurrency safety is the write queue's:
 * one write transaction runs on the venue file at a time — `withTransaction` runs its body inside
 * `db.withWriteLock` (`packages/db/src/tenancy.ts`) — so the second allocator's statement does not
 * run until the first's row is committed.
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

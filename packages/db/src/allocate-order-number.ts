import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { workingOrderCounters } from "./schema/working-order-counters.js";

/**
 * Allocates the next order number for a (tenant, node) counter, race-free.
 *
 * One statement. On the FIRST allocation for a (tenant, node) the INSERT
 * creates the row at `next_number = 1` and RETURNING yields 1. On every
 * subsequent allocation the row already exists, so the unique index on
 * (tenant_id, node_id) diverts to DO UPDATE, which increments `next_number`
 * and RETURNING yields the NEW, already-incremented value — 2, then 3, and so
 * on. There is no read-then-write window: the increment and the read are the
 * same statement.
 *
 * Concurrency safety is the upsert's, extended from allocate-number.ts's
 * plain-UPDATE guarantee (see its doc comment). Two concurrent allocators for
 * the same (tenant, node) that both race to CREATE the row settle via the
 * speculative-insert path — exactly one insert wins with 1, the other blocks on
 * the winner's uncommitted index tuple, then sees the conflict and takes DO
 * UPDATE to 2; once the row exists, concurrent allocators serialise on its row
 * lock and each re-evaluates `next_number + 1` against the previous committed
 * value. Distinct numbers, never a duplicate. Proven against real PostgreSQL by
 * the "under concurrency" suite at the bottom of allocate-order-number.test.ts —
 * PGlite serialises onto one backend and so cannot observe this at all.
 *
 * Unlike allocate-number.ts, this returns `next_number` directly (1 on the
 * first call) rather than the pre-increment value: an order number is a plain
 * per-node counter starting at 1, not a fiscal series that may carry a
 * migrated starting point.
 */
export async function allocateOrderNumber(
  tx: Transaction,
  tenantId: string,
  nodeId: string,
): Promise<number> {
  const [row] = await tx
    .insert(workingOrderCounters)
    .values({ tenantId, nodeId, nextNumber: 1 })
    .onConflictDoUpdate({
      target: [workingOrderCounters.tenantId, workingOrderCounters.nodeId],
      set: { nextNumber: sql`${workingOrderCounters.nextNumber} + 1` },
    })
    .returning({ allocated: workingOrderCounters.nextNumber });
  return row!.allocated;
}

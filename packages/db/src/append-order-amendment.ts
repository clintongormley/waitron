import { and, desc, eq } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { computeAmendmentHash } from "./order-amendment-hash.js";
import { orderAmendments } from "./schema/order-amendments.js";
import { workingOrders } from "./schema/orders.js";

/**
 * Appends one entry to an order's tamper-evident amendment chain (design §4), in the caller's
 * transaction. The single writer's path for the `order_placed` genesis (written when the order is
 * placed) and every later `order_cancelled` on that order.
 *
 * There is NO chain-head table and NO retry loop (Decision 2), unlike the workforce chain
 * (`packages/workforce/src/chain.ts`) whose head must be CREATED on first use and therefore raced
 * for. Here the parent `working_orders` row always exists before any amendment can be appended (an
 * order is placed before it is amended), so THAT row is the serialisation point: a `SELECT … FOR
 * UPDATE` on it blocks a concurrent appender until this transaction commits, after which the loser
 * reads the advanced max sequence. `order_amendments_chain_position_key`
 * (UNIQUE(tenant, working_order, sequence_no)) is the backstop if two writers ever reach the insert
 * with the same number, but under the row lock they cannot.
 */
export interface AppendAmendmentInput {
  tenantId: string;
  workingOrderId: string;
  kind: "order_placed" | "order_cancelled";
  /** The accountable actor (the operator uuid from the open session). */
  actorId: string;
  /** The contestable reason (art. 29.2.j) — null on the genesis `order_placed`. */
  reason: string | null;
  capturedByTillId: string;
  capturedByNodeId: string;
  /** The trusted event instant. Truncated to whole seconds here, at the single write choke point. */
  eventAt: Date;
  /** The venue's trusted-clock wall offset in minutes — the exact source `recordSale` uses for
   * `issued_offset_minutes` (`clock.now().offsetMinutes`). A REQUIRED input, never derived inside
   * this package: deriving it from the supplied Date would capture the DB host's offset, not the
   * venue's, and the hash and the reprint both need the venue's (#52). */
  eventOffsetMinutes: number;
}

/**
 * Floors a Date to whole-second granularity, preserving the instant, as a UTC `…Z` ISO string.
 * `toISOString` always emits milliseconds, so the fractional second is present but ZERO
 * (`…00.000Z`); the truncation removes any sub-second VALUE, not the field. This single choke point
 * feeds BOTH the hashed instant and the stored column, so the stored value, the committed hash and
 * the whole-second read-back can never diverge into a false `hash_mismatch` — and the DB CHECK
 * `order_amendments_event_at_second_ck` backstops it. Mirrors `chain.ts`'s `truncateToWholeSecond`.
 */
function truncateToWholeSecond(at: Date): string {
  return new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();
}

export async function appendOrderAmendment(
  tx: Transaction,
  input: AppendAmendmentInput,
): Promise<{ id: string; sequenceNo: number; entryHash: string }> {
  await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(
      and(eq(workingOrders.tenantId, input.tenantId), eq(workingOrders.id, input.workingOrderId)),
    )
    .for("update");

  const [prev] = await tx
    .select({ sequenceNo: orderAmendments.sequenceNo, entryHash: orderAmendments.entryHash })
    .from(orderAmendments)
    .where(
      and(
        eq(orderAmendments.tenantId, input.tenantId),
        eq(orderAmendments.workingOrderId, input.workingOrderId),
      ),
    )
    .orderBy(desc(orderAmendments.sequenceNo))
    .limit(1);

  const sequenceNo = (prev?.sequenceNo ?? 0) + 1;
  const isFirstEntry = prev === undefined;
  const prevEntryHash = prev?.entryHash ?? null;
  const eventAt = truncateToWholeSecond(input.eventAt);

  const entryHash = computeAmendmentHash({
    sequenceNo,
    workingOrderId: input.workingOrderId,
    kind: input.kind,
    actorId: input.actorId,
    reason: input.reason,
    capturedByTillId: input.capturedByTillId,
    capturedByNodeId: input.capturedByNodeId,
    eventAt,
    eventOffsetMinutes: input.eventOffsetMinutes,
    prevEntryHash,
  });

  const [inserted] = await tx
    .insert(orderAmendments)
    .values({
      tenantId: input.tenantId,
      workingOrderId: input.workingOrderId,
      sequenceNo,
      kind: input.kind,
      actorId: input.actorId,
      reason: input.reason,
      capturedByTillId: input.capturedByTillId,
      capturedByNodeId: input.capturedByNodeId,
      eventAt,
      eventOffsetMinutes: input.eventOffsetMinutes,
      entryHash,
      prevEntryHash,
      isFirstEntry,
    })
    .returning({ id: orderAmendments.id });
  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("order_amendments: insert returned no row");
  }
  /* v8 ignore stop */
  return { id: inserted.id, sequenceNo, entryHash };
}

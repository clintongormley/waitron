import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  billPartyTableLabels,
  kitchenStations,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { BAND_RANK, classifyBand, partyTablesName, worstBand } from "@waitron/shared";
import type { StationThresholds, TimingBand } from "@waitron/shared";
import type { OverdueOrder, OverdueOrdersInput } from "./types.js";

/**
 * Whole minutes from a stored ISO stamp to `nowMs`, floored. A copy of
 * `apps/server/src/working-order.ts`'s `minutesSince`, which this package cannot import.
 */
function minutesSince(stamp: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(stamp)) / 60_000);
}

/**
 * The manager overview's "orders taking too long" query — THIS node's currently-open kitchen orders
 * whose worst UNSERVED line has crossed into `overdue` or `forgotten`, worst-first. The age model and
 * join shape are `apps/server/src/working-order.ts`'s `listExpoQueue`'s: a line ages from
 * `ticket_items.queued_at` until it is served (`working_order_lines.served_at`) or the order is
 * collected (`working_orders.collected_at`), and an order stays "open" while it is not abandoned and
 * not yet collected — wider than `status = 'open'` (a `settled` walk-up awaiting counter handover
 * still ages). Bands come from the shared `classifyBand`/`worstBand`, never a hand-rolled SQL CASE.
 *
 * Among the lines tied at an order's WORST band, the one with the GREATEST age is named — the most
 * urgent line to show.
 */
export async function computeOverdueOrders(
  tx: Transaction,
  input: OverdueOrdersInput,
): Promise<OverdueOrder[]> {
  // Read ONCE, so every row in this run is aged and classified against the SAME instant.
  const nowMs = Date.now();
  const rows = await tx
    .select({
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      stationName: kitchenStations.name,
      servedAt: workingOrderLines.servedAt,
      queuedAt: ticketItems.queuedAt,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      partyId: workingOrders.partyId,
      label: workingOrders.label,
      // For an order of no party: the table it is delivered to, else its own label; `null` for an
      // unlabelled walk-up. `workingOrders` is JOINed, never this query's `.from()` base, so
      // CLAUDE.md §3's correlated-subquery trap does not apply.
      tableLabel: sql<string | null>`coalesce((
        select dt.label from dining_tables dt
        where dt.id = ${workingOrders.deliveryTableId}), ${workingOrders.label})`,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    .where(
      and(
        eq(ticketItems.nodeId, input.nodeId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    // Lines fired together can share a `queued_at`, so `line_no` breaks the tie; without it, the
    // station named for a tied order could change from one read of the same data to the next.
    .orderBy(ticketItems.queuedAt, workingOrderLines.lineNo);

  interface Line {
    stationName: string;
    ageMinutes: number;
    band: TimingBand;
  }
  interface Candidate {
    orderNumber: number;
    partyId: string | null;
    label: string | null;
    tableLabel: string | null;
    lines: Line[];
  }
  const byOrder = new Map<string, Candidate>();
  for (const row of rows) {
    // A served line has reached the guest and drops off the clock.
    if (row.servedAt !== null) continue;
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    const ageMinutes = minutesSince(row.queuedAt, nowMs);
    const band = classifyBand(nowMs - ageMinutes * 60_000, nowMs, thresholds);
    let order = byOrder.get(row.orderId);
    if (order === undefined) {
      order = {
        orderNumber: row.orderNumber,
        partyId: row.partyId,
        label: row.label,
        tableLabel: row.tableLabel,
        lines: [],
      };
      byOrder.set(row.orderId, order);
    }
    order.lines.push({ stationName: row.stationName, ageMinutes, band });
  }

  const late: { orderId: string; order: Candidate; band: TimingBand; worstLine: Line }[] = [];
  for (const [orderId, order] of byOrder) {
    const band = worstBand(order.lines.map((line) => line.band));
    if (band !== "overdue" && band !== "forgotten") continue;
    // A tie on band AND age keeps the first such line in the query's `queued_at, line_no` order.
    // `band` is computed from `order.lines`, so at least one line matches and `worstLine` is set.
    let worstLine: Line | undefined;
    for (const line of order.lines) {
      if (line.band !== band) continue;
      if (worstLine === undefined || line.ageMinutes > worstLine.ageMinutes) {
        worstLine = line;
      }
    }
    late.push({ orderId, order, band, worstLine: worstLine! });
  }

  const partyLabels = await billPartyTableLabels(tx, [
    ...new Set(late.flatMap(({ order }) => order.partyId ?? [])),
  ]);
  const results: OverdueOrder[] = late.map(({ orderId, order, band, worstLine }) => {
    const tables = order.partyId === null ? null : partyLabels.get(order.partyId)!;
    return {
      orderId,
      orderNumber: order.orderNumber,
      tableLabel:
        tables === null
          ? order.tableLabel
          : tables.length === 0
            ? order.label
            : partyTablesName(tables),
      stationName: worstLine.stationName,
      ageMinutes: worstLine.ageMinutes,
      band,
    };
  });

  // Worst-first: band rank desc, then age desc, then order number for a deterministic tiebreak.
  results.sort(
    (a, b) =>
      BAND_RANK[b.band] - BAND_RANK[a.band] ||
      b.ageMinutes - a.ageMinutes ||
      a.orderNumber - b.orderNumber,
  );
  return results;
}

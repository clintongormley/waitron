import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { kitchenStations, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { BAND_RANK, classifyBand, worstBand } from "@waitron/shared";
import type { StationThresholds, TimingBand } from "@waitron/shared";
import type { OverdueOrder, OverdueOrdersInput } from "./types.js";

/**
 * The manager overview's "orders taking too long" query (design §7.4) — THIS node's currently-open
 * kitchen orders whose worst UNSERVED line has crossed into `overdue` or `forgotten`, worst-first.
 * Reuses Task 4's age model and join shape verbatim (`apps/server/src/working-order.ts`'s
 * `listExpoQueue`): a line ages from `ticket_items.queued_at` until it is served
 * (`working_order_lines.served_at`) or the order is collected (`working_orders.collected_at`), and
 * an order stays "open" for this purpose while it is not abandoned and not yet collected — the SAME
 * definition `listExpoQueue`/`listStationQueue` use, which is wider than `status = 'open'` (a
 * `settled` Mode-P walk-up awaiting counter handover still ages).
 *
 * Classification happens in JS with the SHARED `classifyBand`/`worstBand` (never a hand-rolled SQL
 * CASE, CLAUDE.md §3/§4): `ageMinutes` is computed on the DATABASE clock (`now() - queued_at`), so
 * server and client agree regardless of any app-process/DB clock skew — the same
 * reconstruct-as-an-offset-from-Date.now() idiom `listStationQueue`/`listExpoQueue` use.
 *
 * The per-order reduction picks, among the lines tied at the order's WORST band, the one with the
 * GREATEST age — the most urgent line to name (design says only "table/order, station, age, band";
 * ties within one order are not otherwise specified, and "oldest of the worst" is the least
 * surprising choice for an operator staring at a count tile). An order whose reduced band is
 * `fresh`/`warm` is dropped entirely — only `overdue`/`forgotten` orders are returned.
 *
 * `tableLabel` mirrors `ExpoOrder.tableLabel`'s fan-out-proof scalar subquery (a LEFT JOIN could
 * multiply an order's rows if two tables pointed at it): a seated TAB (`dining_tables.tab_id` back-
 * points at the order) or a counter DELIVERY (`working_orders.delivery_table_id` points at the
 * table), tenant-scoped — `null` for a bare walk-up. Unlike `listExpoQueue` this carries no
 * `locationId` param (this query has none to scope by): a table can only match via one of those two
 * order-specific links, so tenant scoping alone is exact here — never two tables satisfy the OR for
 * the SAME order under the one-tab-per-table / one-delivery-target invariants those columns carry.
 *
 * Runs on the caller's transaction as `app_user`. The query scopes its rows with explicit
 * `tenantId` and `nodeId` WHERE predicates; transaction context does not supply tenant filtering.
 */
export async function computeOverdueOrders(
  tx: Transaction,
  input: OverdueOrdersInput,
): Promise<OverdueOrder[]> {
  // Captured once so every row in this run is classified against the SAME instant — cheaper than
  // calling Date.now() per row, and immune to the classification drifting mid-run on a slow tick.
  const nowMs = Date.now();
  const rows = await tx
    .select({
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      stationName: kitchenStations.name,
      servedAt: workingOrderLines.servedAt,
      // Minutes since this line reached its station, on the DATABASE clock — the same
      // `now() - queued_at` idiom `listStationQueue`/`listExpoQueue` use, so classification is immune
      // to any app-server/DB clock skew.
      ageMinutes: sql<number>`floor(extract(epoch from (now() - ${ticketItems.queuedAt})) / 60)::int`,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      // Fan-out-proof (a LEFT JOIN could multiply rows if two tables pointed at this order): a seated
      // tab (`dt.tab_id` back-points here) or a counter delivery (`working_orders.delivery_table_id`
      // points at `dt`). `${workingOrders...}` interpolations are qualified (workingOrders is JOINed,
      // never this query's `.from()` base), so this is immune to CLAUDE.md §3's bare-column trap.
      tableLabel: sql<string | null>`(
        select dt.label from dining_tables dt
        where dt.tenant_id = ${workingOrders.tenantId}
          and (dt.tab_id = ${workingOrders.id} or ${workingOrders.deliveryTableId} = dt.id)
        order by (dt.tab_id = ${workingOrders.id}) desc nulls last, dt.id
        limit 1)`,
    })
    .from(ticketItems)
    // The owning order — composite (tenant_id too), the tenant-consistent shape ticket_items' FKs
    // carry, mirroring listStationQueue/listExpoQueue.
    .innerJoin(
      workingOrders,
      and(
        eq(ticketItems.workingOrderId, workingOrders.id),
        eq(ticketItems.tenantId, workingOrders.tenantId),
      ),
    )
    // The line this item was fired from — needed for `served_at` (the age-model's "until served").
    .innerJoin(
      workingOrderLines,
      and(
        eq(ticketItems.workingOrderLineId, workingOrderLines.id),
        eq(ticketItems.tenantId, workingOrderLines.tenantId),
      ),
    )
    // The item's OWN station, for its name + order-timing thresholds — a plain INNER JOIN keyed on
    // the tenant-consistent (tenant_id, station_id) FK, never a correlated subquery (CLAUDE.md §3).
    .innerJoin(
      kitchenStations,
      and(
        eq(ticketItems.stationId, kitchenStations.id),
        eq(ticketItems.tenantId, kitchenStations.tenantId),
      ),
    )
    .where(
      and(
        eq(ticketItems.tenantId, input.tenantId),
        eq(ticketItems.nodeId, input.nodeId),
        // "Open" for the age model (design §3/Task 4): not abandoned, not yet collected — the SAME
        // definition listExpoQueue/listStationQueue use, wider than status = 'open'.
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
      ),
    )
    // Primary `queued_at` ranks lines oldest-first, but it is NOT enough on its own: every line of a
    // multi-line/multi-station fire is inserted in ONE statement (`fireLines`, working-order.ts) with
    // the column's shared `defaultNow()`, so lines fired together carry the IDENTICAL `queued_at` —
    // the ordinary case, not an edge case. Without a tiebreak, Postgres may return those rows in
    // EITHER order across calls, and the per-order "oldest of the worst" reduction below would then
    // report a different tied line's `stationName` on different reads of the same data — exactly the
    // field an operator is watching on the live overdue screen. `line_no` breaks the tie
    // deterministically, the same secondary key `listStationQueue` uses for the identical reason
    // (working-order.ts's `listStationQueue`, "fired together with an identical `queued_at`").
    .orderBy(ticketItems.queuedAt, workingOrderLines.lineNo);

  interface Candidate {
    orderNumber: number;
    tableLabel: string | null;
    lines: { stationName: string; ageMinutes: number; band: TimingBand }[];
  }
  const byOrder = new Map<string, Candidate>();
  for (const row of rows) {
    // A served line has reached the guest and drops off the clock (design §3) — never enters the
    // order's band reduction at all.
    if (row.servedAt !== null) continue;
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    // Reconstructed from the DB-computed age (never `Date.parse(queued_at)`), the same clock-skew-
    // immune idiom listStationQueue/listExpoQueue use.
    const ageMinutes = Number(row.ageMinutes);
    const band = classifyBand(nowMs - ageMinutes * 60_000, nowMs, thresholds);
    let order = byOrder.get(row.orderId);
    if (order === undefined) {
      order = { orderNumber: row.orderNumber, tableLabel: row.tableLabel, lines: [] };
      byOrder.set(row.orderId, order);
    }
    order.lines.push({ stationName: row.stationName, ageMinutes, band });
  }

  const results: OverdueOrder[] = [];
  for (const [orderId, order] of byOrder) {
    const band = worstBand(order.lines.map((line) => line.band));
    if (band !== "overdue" && band !== "forgotten") continue;
    // Among the lines tied at the order's worst band, name the OLDEST — the most urgent to show. A
    // residual tie (same band AND same age — the ordinary multi-station-fire case above) keeps the
    // FIRST such line encountered, which is in the query's `queued_at, line_no` order (never
    // insertion-order-of-the-Map or any other incidental order), so which station is reported is
    // deterministic rather than whichever row Postgres happened to return first. Written as an
    // explicit loop rather than `.filter().reduce()`: `band` is computed FROM `order.lines` via
    // `worstBand`, so at least one line always matches and `worstLine` is always assigned below.
    let worstLine: { stationName: string; ageMinutes: number; band: TimingBand } | undefined;
    for (const line of order.lines) {
      if (line.band !== band) continue;
      if (worstLine === undefined || line.ageMinutes > worstLine.ageMinutes) {
        worstLine = line;
      }
    }
    results.push({
      orderId,
      orderNumber: order.orderNumber,
      tableLabel: order.tableLabel,
      stationName: worstLine!.stationName,
      ageMinutes: worstLine!.ageMinutes,
      band,
    });
  }

  // Worst-first: band rank desc, then age desc, then order number for a deterministic tiebreak.
  results.sort(
    (a, b) =>
      BAND_RANK[b.band] - BAND_RANK[a.band] ||
      b.ageMinutes - a.ageMinutes ||
      a.orderNumber - b.orderNumber,
  );
  return results;
}

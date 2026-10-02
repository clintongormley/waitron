import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { ticketItems, workingOrderLines, type Transaction } from "@waitron/db";
import type { TicketState } from "./kitchen-print.js";

/** One kitchen record of a dish's work: the dish's own, or one of its split-off extras'. */
export interface DishKitchenItem {
  ticketItemId: string;
  /** The line the record is on: the dish's, or the extra's. */
  workingOrderLineId: string;
  dishLineId: string;
  extra: boolean;
  workingOrderId: string;
  stationId: string;
  courseId: string | null;
  firedAt: string | null;
  state: TicketState;
  /** Thousandths: what the station was asked for. */
  firedQuantity: number;
  /** Thousandths: the line's own stored quantity. */
  lineQuantity: number;
}

export function dishKitchenItemsQuery(tx: Transaction, dishLineIds: readonly string[]) {
  return tx
    .select({
      ticketItemId: ticketItems.id,
      workingOrderLineId: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      workingOrderId: ticketItems.workingOrderId,
      stationId: ticketItems.stationId,
      courseId: ticketItems.courseId,
      firedAt: ticketItems.firedAt,
      state: ticketItems.state,
      firedQuantity: ticketItems.quantity,
      lineQuantity: workingOrderLines.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(
      or(
        inArray(workingOrderLines.id, dishLineIds),
        inArray(workingOrderLines.parentLineId, dishLineIds),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
}

/** Each dish's own record first, then its split-off extras in line order. Dishes with no records are absent. */
export async function dishKitchenItems(
  tx: Transaction,
  dishLineIds: readonly string[],
): Promise<Map<string, DishKitchenItem[]>> {
  const result = new Map<string, DishKitchenItem[]>();
  if (dishLineIds.length === 0) return result;
  const rows = await dishKitchenItemsQuery(tx, dishLineIds);
  for (const row of rows) {
    const extra = row.parentLineId !== null;
    const dishLineId = row.parentLineId ?? row.workingOrderLineId;
    const items = result.get(dishLineId) ?? [];
    const item: DishKitchenItem = {
      ticketItemId: row.ticketItemId,
      workingOrderLineId: row.workingOrderLineId,
      dishLineId,
      extra,
      workingOrderId: row.workingOrderId,
      stationId: row.stationId,
      courseId: row.courseId,
      firedAt: row.firedAt,
      state: row.state,
      firedQuantity: row.firedQuantity ?? row.lineQuantity,
      lineQuantity: row.lineQuantity,
    };
    if (extra) items.push(item);
    else items.unshift(item);
    result.set(dishLineId, items);
  }
  return result;
}

/** Matches records on these dish lines and records on their extra lines. */
export function onDishesOrTheirExtras(tx: Transaction, lineIds: readonly string[]): SQL {
  if (lineIds.length === 0) return sql`false`;
  return or(
    inArray(ticketItems.workingOrderLineId, lineIds),
    inArray(
      ticketItems.workingOrderLineId,
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(inArray(workingOrderLines.parentLineId, lineIds)),
    ),
  )!;
}

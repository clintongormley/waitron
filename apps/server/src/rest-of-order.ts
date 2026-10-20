import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { kitchenStations, ticketItems, workingOrderLines, type Transaction } from "@waitron/db";
import { kitchenPresentationName } from "@waitron/catalogue";
import { thousandthsToDecimal, compareStationNames } from "@waitron/shared";
import { firedQuantity, type TicketState } from "./kitchen-print.js";

export interface RestOfOrderItem {
  ticketItemId: string;
  orderId: string;
  workingOrderLineId: string;
  stationId: string;
  stationName: string;
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  state: TicketState;
  held: boolean;
}

export function restOfOrderQuery(tx: Transaction, orderIds: readonly string[]) {
  return tx
    .select({
      ticketItemId: ticketItems.id,
      orderId: ticketItems.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      stationName: kitchenStations.name,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      quantity: sql<number>`${firedQuantity} - ${workingOrderLines.servedQuantity}`,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      state: ticketItems.state,
      firedAt: ticketItems.firedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    .where(
      and(
        inArray(ticketItems.workingOrderId, [...orderIds]),
        eq(ticketItems.madeHere, false),
        gt(firedQuantity, workingOrderLines.servedQuantity),
      ),
    )
    .orderBy(kitchenStations.name, workingOrderLines.lineNo, ticketItems.id);
}

export async function readRestOfOrder(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, RestOfOrderItem[]>> {
  if (orderIds.length === 0) return new Map();
  const result = new Map(orderIds.map((id) => [id, [] as RestOfOrderItem[]]));
  const rows = await restOfOrderQuery(tx, orderIds);
  rows.sort((a, b) => compareStationNames(a.stationName, b.stationName));
  for (const row of rows) {
    result.get(row.orderId)!.push({
      ticketItemId: row.ticketItemId,
      orderId: row.orderId,
      workingOrderLineId: row.workingOrderLineId,
      stationId: row.stationId,
      stationName: row.stationName,
      name: kitchenPresentationName(row),
      quantity: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      state: row.state,
      held: row.firedAt === null,
    });
  }
  return result;
}

import { eq, inArray, sql } from "drizzle-orm";
import {
  lineServiceCancellations,
  orderGroups,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { productUnits, unitOwnerJoin, units } from "@waitron/catalogue";
import { isRecalledDish } from "./draft-source.js";

export interface OrderStateCounts {
  ordered: number;
  unsent: number;
  held: number;
  waiting: number;
  ready: number;
}

interface KitchenPart {
  ticket: { madeHere: boolean; firedAt: string | null; state: string } | null;
}

export interface CountedLine extends KitchenPart {
  quantity: number;
  cancelled: number;
  servedQuantity: number;
  servedAt: string | null;
  unitPrecision: number | null;
  unit: { hardwareUnit: string | null; precision: number; measure: boolean } | null;
  recalled: boolean;
  sentAt: string | null;
  groupState: string | null;
}

const ZERO: OrderStateCounts = { ordered: 0, unsent: 0, held: 0, waiting: 0, ready: 0 };

/**
 * One dish's counts. A dish sold by the unit (`takesExtras`'s rule: no hardware unit, no decimal
 * places, not a measure) counts its whole quantity; any other dish, or a fractional quantity,
 * counts as one; extras count nothing. The units left to serve take the first state that matches:
 * not sent, held (any unfired kitchen part, which keeps Requested here once it is stored), waiting,
 * ready. A handed-over order has nothing left to serve.
 */
export function dishCounts(
  dish: CountedLine,
  extras: readonly KitchenPart[],
  collected: boolean,
): OrderStateCounts {
  const active = Math.max(0, dish.quantity - dish.cancelled);
  if (active === 0) return { ...ZERO };
  const served = dish.servedAt !== null ? active : Math.min(dish.servedQuantity, active);
  const left = collected ? 0 : active - served;
  const places = dish.unitPrecision ?? dish.unit?.precision ?? 0;
  const byTheUnit =
    (dish.unit?.hardwareUnit ?? null) === null && places === 0 && dish.unit?.measure !== true;
  const asOne = !byTheUnit || active % 1000 !== 0;
  const ordered = asOne ? 1 : active / 1000;
  const counts = { ...ZERO, ordered };
  if (left === 0) return counts;
  const leftUnits = asOne ? 1 : Math.ceil(left / 1000);
  const parts = [dish, ...extras];
  if (dish.recalled || (dish.ticket === null && dish.groupState === null && dish.sentAt === null))
    counts.unsent = leftUnits;
  else if (
    extras.some((extra) => extra.ticket !== null && extra.ticket.firedAt === null) ||
    (dish.ticket?.madeHere !== true &&
      (dish.groupState === "held" || (dish.ticket !== null && dish.ticket.firedAt === null)))
  )
    counts.held = leftUnits;
  else if (
    parts.some(
      ({ ticket }) =>
        ticket !== null &&
        !ticket.madeHere &&
        ticket.firedAt !== null &&
        (ticket.state === "queued" || ticket.state === "preparing"),
    )
  )
    counts.waiting = leftUnits;
  else counts.ready = leftUnits;
  return counts;
}

function add(into: OrderStateCounts, counts: OrderStateCounts): void {
  into.ordered += counts.ordered;
  into.unsent += counts.unsent;
  into.held += counts.held;
  into.waiting += counts.waiting;
  into.ready += counts.ready;
}

export async function readOrderStateCounts(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, OrderStateCounts>> {
  const result = new Map(orderIds.map((id) => [id, { ...ZERO }]));
  if (orderIds.length === 0) return result;
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      orderId: workingOrderLines.workingOrderId,
      parentLineId: workingOrderLines.parentLineId,
      collectedAt: workingOrders.collectedAt,
      quantity: workingOrderLines.quantity,
      cancelled: sql<number>`coalesce(${lineServiceCancellations.quantity}, 0)`,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      unitPrecision: workingOrderLines.unitPrecision,
      unitId: units.id,
      hardwareUnit: units.hardwareUnit,
      precision: units.precision,
      measure: units.measure,
      recalled: isRecalledDish(tx).mapWith(Boolean),
      sentAt: workingOrderLines.sentAt,
      groupState: orderGroups.state,
      ticketId: ticketItems.id,
      madeHere: ticketItems.madeHere,
      firedAt: ticketItems.firedAt,
      ticketState: ticketItems.state,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(inArray(workingOrderLines.workingOrderId, [...orderIds]));
  const extras = new Map<string, KitchenPart[]>();
  for (const line of lines) {
    if (line.parentLineId === null) continue;
    extras.set(line.parentLineId, [...(extras.get(line.parentLineId) ?? []), kitchenPart(line)]);
  }
  for (const line of lines) {
    if (line.parentLineId !== null) continue;
    const dish: CountedLine = {
      ...kitchenPart(line),
      quantity: line.quantity,
      cancelled: line.cancelled,
      servedQuantity: line.servedQuantity,
      servedAt: line.servedAt,
      unitPrecision: line.unitPrecision,
      unit:
        line.unitId === null
          ? null
          : { hardwareUnit: line.hardwareUnit, precision: line.precision!, measure: line.measure! },
      recalled: line.recalled,
      sentAt: line.sentAt,
      groupState: line.groupState,
    };
    add(
      result.get(line.orderId)!,
      dishCounts(dish, extras.get(line.id) ?? [], line.collectedAt !== null),
    );
  }
  return result;
}

function kitchenPart(line: {
  ticketId: string | null;
  madeHere: boolean | null;
  firedAt: string | null;
  ticketState: string | null;
}): KitchenPart {
  return {
    ticket:
      line.ticketId === null
        ? null
        : { madeHere: line.madeHere === true, firedAt: line.firedAt, state: line.ticketState! },
  };
}

import { eq, inArray } from "drizzle-orm";
import {
  billPartyTableLabels,
  billPartyTables,
  parties,
  tableNames,
  workingOrders,
  type Transaction,
} from "@waitron/db";

/** Where an order is, as its kitchen tickets name it. */
export interface OrderPlaces {
  orderNumber: number;
  /** Its tables, each by its own name, not its group's. */
  tables: { id: string; name: string }[];
  /** The place names its kitchen tickets print, a named group once; empty at the counter. */
  names: string[];
  /** A counter order delivered to no table; the caller words "the counter". */
  counter: boolean;
  /** The order's party's own name, null for none or for an order of no party. */
  partyName: string | null;
}

/**
 * Each order's places, keyed by order; an id that names no order has no entry. A party bill is at
 * the tables {@link billPartyTables} gives its party, named as {@link billPartyTableLabels} names
 * them, else by the order's own label; an order of no party is at the table it is delivered to,
 * named by that table's shown name, else at the counter. No reading filters by location.
 */
export async function readOrderPlaces(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, OrderPlaces>> {
  if (orderIds.length === 0) return new Map();
  const orders = await tx
    .select({
      id: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      label: workingOrders.label,
      partyName: parties.name,
    })
    .from(workingOrders)
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(inArray(workingOrders.id, [...orderIds]));

  const partyIds = [...new Set(orders.flatMap((order) => order.partyId ?? []))];
  const namesByParty = await billPartyTableLabels(tx, partyIds);
  const tablesByParty = await billPartyTables(tx, partyIds);
  const delivered = await tableNames(tx, [
    ...new Set(
      orders.flatMap((order) => (order.partyId === null ? (order.deliveryTableId ?? []) : [])),
    ),
  ]);

  const places = new Map<string, OrderPlaces>();
  for (const order of orders) {
    const base = { orderNumber: order.orderNumber, partyName: order.partyName };
    if (order.partyId !== null) {
      const names = namesByParty.get(order.partyId)!;
      places.set(order.id, {
        ...base,
        counter: false,
        tables: tablesByParty.get(order.partyId)!.map(({ id, name }) => ({ id, name })),
        names: names.length > 0 ? names : order.label === null ? [] : [order.label],
      });
    } else if (order.deliveryTableId === null) {
      places.set(order.id, { ...base, counter: true, tables: [], names: [] });
    } else {
      const table = delivered.get(order.deliveryTableId)!;
      places.set(order.id, {
        ...base,
        counter: false,
        tables: [{ id: table.id, name: table.name }],
        names: [table.shown],
      });
    }
  }
  return places;
}

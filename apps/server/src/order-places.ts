import { eq, inArray } from "drizzle-orm";
import {
  billParties,
  parties,
  partySurvivorNames,
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

/** An order's places, and the parties a MOVED slip names it by. */
export interface PlacedOrder {
  places: OrderPlaces;
  partyId: string | null;
  /**
   * The name of the party at the end of its party's merges, else its own party's; null for none.
   */
  sittingWith: string | null;
}

/**
 * The party name a kitchen paper gives an order: that of the party at the end of its party's merges
 * when there is one, else its own party's; null for none.
 */
export function partyNameOnPaper(
  ownName: string | null,
  survivor: { name: string | null } | undefined,
): string | null {
  return survivor === undefined ? ownName : survivor.name;
}

/**
 * Each order's {@link partyNameOnPaper}, keyed by order; an id that names no order has no entry.
 */
export async function readPartyNames(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (orderIds.length === 0) return new Map();
  const orders = await tx
    .select({ id: workingOrders.id, partyId: workingOrders.partyId, partyName: parties.name })
    .from(workingOrders)
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(inArray(workingOrders.id, [...orderIds]));
  const survivors = await partySurvivorNames(tx, [
    ...new Set(orders.flatMap((order) => order.partyId ?? [])),
  ]);
  return new Map(
    orders.map((order) => [
      order.id,
      partyNameOnPaper(
        order.partyName,
        order.partyId === null ? undefined : survivors.get(order.partyId),
      ),
    ]),
  );
}

/**
 * Each order's places, keyed by order; an id that names no order has no entry. A party bill is at
 * the tables {@link billParties} gives its party, named as it names them, else by the order's own
 * label; an order of no party is at the table it is delivered to, named by that table's shown name,
 * else at the counter. No reading filters by location.
 */
export async function readPlacedOrders(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, PlacedOrder>> {
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

  const byParty = await billParties(tx, [
    ...new Set(orders.flatMap((order) => order.partyId ?? [])),
  ]);
  const delivered = await tableNames(tx, [
    ...new Set(
      orders.flatMap((order) => (order.partyId === null ? (order.deliveryTableId ?? []) : [])),
    ),
  ]);

  const placed = new Map<string, PlacedOrder>();
  for (const order of orders) {
    const base = { orderNumber: order.orderNumber, partyName: order.partyName };
    const party = order.partyId === null ? undefined : byParty.get(order.partyId)!;
    let places: OrderPlaces;
    if (party !== undefined) {
      places = {
        ...base,
        counter: false,
        tables: party.tables.map(({ id, name }) => ({ id, name })),
        names: party.labels.length > 0 ? party.labels : order.label === null ? [] : [order.label],
      };
    } else if (order.deliveryTableId === null) {
      places = { ...base, counter: true, tables: [], names: [] };
    } else {
      const table = delivered.get(order.deliveryTableId)!;
      places = {
        ...base,
        counter: false,
        tables: [{ id: table.id, name: table.name }],
        names: [table.shown],
      };
    }
    placed.set(order.id, {
      places,
      partyId: order.partyId,
      sittingWith: partyNameOnPaper(order.partyName, party?.survivor),
    });
  }
  return placed;
}

/** {@link readPlacedOrders}' places alone. */
export async function readOrderPlaces(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, OrderPlaces>> {
  const placed = await readPlacedOrders(tx, orderIds);
  return new Map([...placed].map(([id, order]) => [id, order.places]));
}

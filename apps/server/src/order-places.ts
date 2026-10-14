import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  billPartyTableLabels,
  orderTableLabels,
  parties,
  partySurvivors,
  partyTables,
  tableOwnNames,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { TillConfig } from "./till-config.js";

/** Where an order is, as its kitchen tickets name it. */
export interface OrderPlaces {
  orderNumber: number;
  /** Its tables, each by its own name ({@link tableOwnNames}), not its group's. */
  tables: { id: string; name: string }[];
  /** The place names its kitchen tickets print, a named group once; empty at the counter. */
  names: string[];
  /** A counter order delivered to no table; the caller words "the counter". */
  counter: boolean;
  /** The order's party's own name, null for none or for an order of no party. */
  partyName: string | null;
}

/**
 * Each order's places, keyed by order. A party bill is at its party's active tables, or, once the
 * party holds none, at those of the party at the end of its merge chain, named as
 * {@link billPartyTableLabels} names them (falling back to the order's own label when there are
 * none); an order of no party is at the table it is delivered to, named as {@link orderTableLabels}
 * names it, else at the counter.
 */
export async function readOrderPlaces(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  orderIds: readonly string[],
): Promise<Map<string, OrderPlaces>> {
  if (orderIds.length === 0) return new Map();
  const orders = await tx
    .select({
      id: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      deliveryTableLabel: workingOrders.deliveryTableLabel,
      label: workingOrders.label,
      partyName: parties.name,
    })
    .from(workingOrders)
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(inArray(workingOrders.id, [...orderIds]));

  const partyIds = [...new Set(orders.flatMap((order) => order.partyId ?? []))];
  const namesByParty = await billPartyTableLabels(tx, partyIds);
  const tableIdsByParty = await activeTableIds(tx, partyIds);
  const seatless = partyIds.filter((id) => tableIdsByParty.get(id)!.length === 0);
  const survivorOf =
    seatless.length === 0 ? new Map<string, string>() : await partySurvivors(tx, seatless);
  const survivorTables = await activeTableIds(
    tx,
    [...new Set(survivorOf.values())].filter((id) => !tableIdsByParty.has(id)),
  );
  const tablesOf = (partyId: string): string[] => {
    const own = tableIdsByParty.get(partyId)!;
    if (own.length > 0) return own;
    const survivor = survivorOf.get(partyId);
    if (survivor === undefined) return [];
    return tableIdsByParty.get(survivor) ?? survivorTables.get(survivor)!;
  };

  const delivered = orders.filter(
    (order) => order.partyId === null && order.deliveryTableId !== null,
  );
  const deliveredNames = await orderTableLabels(tx, cfg.locationId, delivered);
  const ownNames = await tableOwnNames(tx, [
    ...new Set([
      ...partyIds.flatMap(tablesOf),
      ...delivered.map((order) => order.deliveryTableId!),
    ]),
  ]);

  const places = new Map<string, OrderPlaces>();
  for (const order of orders) {
    const base = { orderNumber: order.orderNumber, partyName: order.partyName ?? null };
    if (order.partyId !== null) {
      const names = namesByParty.get(order.partyId)!;
      places.set(order.id, {
        ...base,
        counter: false,
        tables: tablesOf(order.partyId).map((id) => ({ id, name: ownNames.get(id)! })),
        names: names.length > 0 ? names : order.label === null ? [] : [order.label],
      });
      continue;
    }
    const tableId = order.deliveryTableId;
    if (tableId === null) {
      places.set(order.id, { ...base, counter: true, tables: [], names: [] });
      continue;
    }
    const name = deliveredNames.get(order.id)!;
    places.set(order.id, {
      ...base,
      counter: false,
      tables: [{ id: tableId, name: ownNames.get(tableId)! }],
      names: name === null ? [] : [name],
    });
  }
  return places;
}

/** Each party's active table ids, in the order they joined it, keyed by each party asked about. */
async function activeTableIds(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byParty = new Map(partyIds.map((id) => [id, [] as string[]]));
  if (partyIds.length === 0) return byParty;
  const rows = await tx
    .select({ partyId: partyTables.partyId, tableId: partyTables.tableId })
    .from(partyTables)
    .where(and(inArray(partyTables.partyId, [...partyIds]), isNull(partyTables.leftAt)))
    .orderBy(partyTables.joinedAt, sql`${partyTables}.rowid`);
  for (const row of rows) byParty.get(row.partyId)!.push(row.tableId);
  return byParty;
}

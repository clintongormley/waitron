import { and, eq, inArray, isNull } from "drizzle-orm";
import { diningTables, partySurvivors, partyTables } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";

/** What {@link orderWatchZones} reads of an order. */
export interface ZonedOrder {
  id: string;
  partyId: string | null;
  deliveryTableId: string | null;
}

/** The current zone of each order's food, keyed by order. */
export async function orderWatchZones(
  tx: Transaction,
  cfg: TillConfig,
  orders: readonly ZonedOrder[],
): Promise<Map<string, string | null>> {
  if (orders.length === 0) return new Map();
  const partyTablesById = await partyWatchZones(
    tx,
    cfg,
    orders.flatMap((order) => order.partyId ?? []),
  );

  const deliveryIds = [...new Set(orders.flatMap((order) => order.deliveryTableId ?? []))];
  const deliveryRows =
    deliveryIds.length === 0
      ? []
      : await tx
          .select({ id: diningTables.id, zoneId: diningTables.zoneId })
          .from(diningTables)
          .where(
            and(eq(diningTables.locationId, cfg.locationId), inArray(diningTables.id, deliveryIds)),
          );
  const deliveryZones = new Map(deliveryRows.map((row) => [row.id, row.zoneId]));
  const zones = new Map<string, string | null>();
  const unresolved: string[] = [];
  for (const order of orders) {
    const partyZone = order.partyId === null ? null : partyTablesById.get(order.partyId);
    const deliveryZone =
      order.deliveryTableId === null ? null : deliveryZones.get(order.deliveryTableId);
    const zone = partyZone ?? deliveryZone;
    if (zone === null || zone === undefined) unresolved.push(order.id);
    else zones.set(order.id, zone);
  }
  if (unresolved.length > 0) {
    const recorded = await VENUE_SERVICE.findOrderZones(tx, cfg, unresolved);
    for (const id of unresolved) zones.set(id, recorded.get(id) ?? null);
  }
  return zones;
}

/** Each party's zone, read from its first active table, or its survivor's once it has none; a
 *  party absent from the map sits at no table. */
export async function partyWatchZones(
  tx: Transaction,
  cfg: TillConfig,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const partyIds = [...new Set(ids)];
  const partyTablesById = await activePartyZones(tx, cfg, partyIds);
  const seatless = partyIds.filter((id) => !partyTablesById.has(id));
  if (seatless.length > 0) {
    const survivors = await partySurvivors(tx, seatless);
    const unread = [...new Set(survivors.values())].filter((id) => !partyTablesById.has(id));
    const survivorTables = await activePartyZones(tx, cfg, unread);
    for (const id of seatless) {
      const survivor = survivors.get(id);
      if (survivor !== undefined) {
        const zone = partyTablesById.get(survivor) ?? survivorTables.get(survivor);
        if (zone !== undefined) partyTablesById.set(id, zone);
      }
    }
  }
  return partyTablesById;
}

async function activePartyZones(
  tx: Transaction,
  cfg: TillConfig,
  partyIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (partyIds.length === 0) return new Map();
  const rows = await tx
    .select({ partyId: partyTables.partyId, zoneId: diningTables.zoneId })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(
      and(
        inArray(partyTables.partyId, [...partyIds]),
        eq(diningTables.locationId, cfg.locationId),
        isNull(partyTables.leftAt),
      ),
    )
    .orderBy(partyTables.joinedAt, partyTables.id);
  const zones = new Map<string, string | null>();
  for (const row of rows) if (!zones.has(row.partyId)) zones.set(row.partyId, row.zoneId);
  return zones;
}

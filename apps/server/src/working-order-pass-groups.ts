import {
  type Transaction,
  workingOrderLines,
  kitchenStations,
  ticketItems,
  workingOrders,
} from "@waitron/db";
import { compareStationNames } from "@waitron/shared";
import { eq, and, inArray, or } from "drizzle-orm";
import { heldItem } from "./kitchen-phase.js";
import { liveKitchenDish } from "./kitchen-print.js";

/**
 * The names of the stations holding a live dish of each of `groupIds`, across every bill, that the
 * pass controls or that is not yet asked for at a station that waits for the pass now; ordered as the
 * stations list is, a name two stations share appearing once. A group with none is absent.
 */
export async function passStationsByGroup(
  tx: Transaction,
  groupIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  if (groupIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinct({
      groupId: workingOrderLines.groupId,
      stationId: kitchenStations.id,
      name: kitchenStations.name,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(workingOrders, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .innerJoin(kitchenStations, eq(kitchenStations.id, ticketItems.stationId))
    .where(
      and(
        inArray(workingOrderLines.groupId, [...groupIds]),
        liveKitchenDish(),
        or(
          eq(ticketItems.passControlled, true),
          and(heldItem(), eq(kitchenStations.waitsForPass, true)),
        ),
      ),
    );
  rows.sort(
    (a, b) => compareStationNames(a.name, b.name) || a.stationId.localeCompare(b.stationId),
  );
  const names = new Map<string, string[]>();
  for (const row of rows) {
    const list = names.get(row.groupId!) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    names.set(row.groupId!, list);
  }
  return names;
}

import { desc, eq, inArray, sql } from "drizzle-orm";
import { devices, kitchenStations, ticketItemMoves, type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";

export interface StationQueueMove {
  fromStationName: string;
  personName: string | null;
  deviceName: string | null;
  movedAt: string;
}

export async function readStationQueueMoves(
  tx: Transaction,
  lineIds: string[],
): Promise<Map<string, StationQueueMove & { toStationId: string }>> {
  const latest = new Map<string, StationQueueMove & { toStationId: string }>();
  if (lineIds.length === 0) return latest;
  const rows = await tx
    .select({
      lineId: ticketItemMoves.workingOrderLineId,
      toStationId: ticketItemMoves.toStationId,
      fromStationName: kitchenStations.name,
      personName: persons.displayName,
      deviceName: devices.label,
      movedAt: ticketItemMoves.movedAt,
    })
    .from(ticketItemMoves)
    .innerJoin(kitchenStations, eq(kitchenStations.id, ticketItemMoves.fromStationId))
    .leftJoin(persons, eq(persons.id, ticketItemMoves.movedByPersonId))
    .leftJoin(devices, eq(devices.id, ticketItemMoves.movedByDeviceId))
    .where(inArray(ticketItemMoves.workingOrderLineId, lineIds))
    .orderBy(desc(sql`${ticketItemMoves}.rowid`));
  for (const { lineId, ...move } of rows) {
    if (!latest.has(lineId)) latest.set(lineId, move);
  }
  return latest;
}

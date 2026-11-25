import { inArray } from "drizzle-orm";
import { kitchenStations, type Transaction } from "@waitron/db";
import { AppError, allowsChangeAfterSending, type ChangesAfterSending } from "@waitron/shared";

interface StationChanges {
  name: string;
  value: ChangesAfterSending;
}

/** Each named station's choice of changes after sending, an inactive station's included. */
export async function readStationChanges(
  tx: Transaction,
  stationIds: readonly string[],
): Promise<ReadonlyMap<string, StationChanges>> {
  if (stationIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      value: kitchenStations.changesAfterSending,
    })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, [...new Set(stationIds)]));
  return new Map(rows.map(({ id, ...station }) => [id, station]));
}

/**
 * Refuses `ticket.already_fired` unless every kitchen record's own station allows the change: a
 * held record (`firedAt` null) or a waiting one. The started check runs before this.
 */
export function refuseChangesAfterSending(
  workingOrderId: string,
  records: readonly { stationId: string; firedAt: string | null }[],
  stations: ReadonlyMap<string, StationChanges>,
): void {
  for (const record of records) {
    const station = stations.get(record.stationId);
    // Every record names a station row, which deletion keeps, so a miss is a caller's bug.
    if (station === undefined)
      throw new Error(`refuseChangesAfterSending: station ${record.stationId} was not read`);
    if (!allowsChangeAfterSending(station.value, record.firedAt !== null))
      throw new AppError("ticket.already_fired", { workingOrderId, stationName: station.name });
  }
}

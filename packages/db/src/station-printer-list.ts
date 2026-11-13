import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";
import { kitchenStations } from "./schema/kitchen-stations.js";

export const stationPrinterPairs = Object.assign(
  sql`(select ks.id as station_id, je.value as printer_id
    from kitchen_stations ks, json_each(ks.printer_ids) je) as station_printer_pairs`,
  {
    stationId: sql<string>`station_printer_pairs.station_id`,
    printerId: sql<string>`station_printer_pairs.printer_id`,
  },
);

export function readStationPrinterPairs(
  tx: Transaction | Database,
  filter?: { stationIds?: readonly string[]; printerId?: string; activeStationsOnly?: boolean },
): Promise<{ stationId: string; printerId: string }[]> {
  return tx
    .select({ stationId: stationPrinterPairs.stationId, printerId: stationPrinterPairs.printerId })
    .from(stationPrinterPairs)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinterPairs.stationId))
    .where(
      and(
        filter?.stationIds === undefined
          ? undefined
          : inArray(kitchenStations.id, [...filter.stationIds]),
        filter?.printerId === undefined
          ? undefined
          : eq(stationPrinterPairs.printerId, filter.printerId),
        filter?.activeStationsOnly === true ? eq(kitchenStations.active, true) : undefined,
      ),
    )
    .orderBy(stationPrinterPairs.stationId, stationPrinterPairs.printerId);
}

export function withPrinter(list: readonly string[], printerId: string): string[] {
  return [...new Set([...list, printerId])].sort();
}

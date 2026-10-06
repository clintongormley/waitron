import { watcherStations, watchers, type Transaction } from "@waitron/db";
import type { SeedLocale } from "./menu.js";
import type { DemoDataSet } from "./data-set.js";

export interface SeedWatchersInput {
  locationId: string;
  locale: SeedLocale;
  dataSet: DemoDataSet;
  stationIds: {
    kitchen: string;
    deli: string;
  };
}

export async function seedWatchers(
  tx: Transaction,
  { locationId, locale, dataSet, stationIds }: SeedWatchersInput,
): Promise<void> {
  const [watcher] = await tx
    .insert(watchers)
    .values({
      locationId,
      name: dataSet.watcherName[locale],
      everyStation: false,
      everyZone: true,
      runsPass: true,
      displayOrder: 1,
      active: true,
    })
    .returning({ id: watchers.id });
  await tx.insert(watcherStations).values([
    { watcherId: watcher!.id, stationId: stationIds.kitchen },
    { watcherId: watcher!.id, stationId: stationIds.deli },
  ]);
}

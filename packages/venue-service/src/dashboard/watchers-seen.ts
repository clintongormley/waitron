/** The watcher response from GET /management-api/watchers, as Prep Stations reads it. */
export interface WatcherView {
  id: string;
  name: string;
  active: boolean;
  displayOrder: number;
  everyStation: boolean;
  stationIds: readonly string[];
  everyZone: boolean;
  zoneIds: readonly string[];
  runsPass: boolean;
  printerIds: readonly string[];
  /** Something refers to it, so removing it disables it rather than deleting it. */
  inUse: boolean;
}

/** Keep this rule aligned with watcherSees in apps/server/src/watchers.ts. */
export function watchersSeeing(
  watchers: readonly WatcherView[],
  stationId: string,
  zoneId: string | null,
): WatcherView[] {
  return watchers.filter(
    (watcher) =>
      (watcher.everyStation || watcher.stationIds.includes(stationId)) &&
      (watcher.everyZone || (zoneId !== null && watcher.zoneIds.includes(zoneId))),
  );
}

export function watchersOfStation(
  watchers: readonly WatcherView[],
  stationId: string,
): WatcherView[] {
  return watchers.filter(
    (watcher) => watcher.everyStation || watcher.stationIds.includes(stationId),
  );
}

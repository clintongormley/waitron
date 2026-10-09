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

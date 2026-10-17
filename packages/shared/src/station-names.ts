const stationNames = new Intl.Collator("es", { usage: "sort" });

export function compareStationNames(left: string, right: string): number {
  return stationNames.compare(left, right);
}

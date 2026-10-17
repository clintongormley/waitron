export const STATION_COLOURS = [
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
  "brown",
] as const;

export type StationColour = (typeof STATION_COLOURS)[number];

export function firstUnusedStationColour(used: Iterable<StationColour>): StationColour {
  const occupied = new Set(used);
  return STATION_COLOURS.find((colour) => !occupied.has(colour)) ?? "red";
}

export function isStationColour(value: unknown): value is StationColour {
  return (STATION_COLOURS as readonly unknown[]).includes(value);
}

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

export function isStationColour(value: unknown): value is StationColour {
  return (STATION_COLOURS as readonly unknown[]).includes(value);
}

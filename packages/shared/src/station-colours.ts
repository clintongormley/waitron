import { CALENDAR_COLOURS, type CalendarColour } from "./calendar-colours.js";

export const STATION_COLOURS = CALENDAR_COLOURS;
export type StationColour = CalendarColour;

export function firstUnusedStationColour(used: Iterable<StationColour>): StationColour {
  const occupied = new Set(used);
  return STATION_COLOURS.find((colour) => !occupied.has(colour)) ?? "red";
}

export function isStationColour(value: unknown): value is StationColour {
  return (STATION_COLOURS as readonly unknown[]).includes(value);
}

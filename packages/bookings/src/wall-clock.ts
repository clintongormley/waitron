import { DEFAULT_TIME_ZONE } from "@waitron/db";

/** Built once per zone, since every floor poll needs one. An invalid zone throws before the `set`,
 *  so it is never cached. */
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = wallClockFormatters.get(timeZone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    wallClockFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/** `locations.time_zone` is free text, and a zone `Intl` rejects would turn the floor read into a
 *  500, so it falls back to the column's default. */
export function safeTimeZone(timeZone: string): string {
  try {
    // Building the formatter is what validates the zone.
    wallClockFormatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The venue-local date (`YYYY-MM-DD`) and time (`HH:MM`, 24-hour) at `now`. */
export function venueWallClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = wallClockFormatter(timeZone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

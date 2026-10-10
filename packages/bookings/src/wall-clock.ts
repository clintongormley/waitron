import { eq } from "drizzle-orm";
import { DEFAULT_TIME_ZONE, locations } from "@waitron/db";
import type { Transaction } from "@waitron/db";

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

/** `locations.time_zone` is free text, so a zone `Intl` rejects falls back to the column's default
 *  rather than throwing. */
function safeTimeZone(timeZone: string): string {
  try {
    // Building the formatter is what validates the zone.
    wallClockFormatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The venue-local date (`YYYY-MM-DD`) and time (`HH:MM`, 24-hour) at `now`. */
function venueWallClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = wallClockFormatter(timeZone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** The venue-local date and time at `now` for the location, read in the default zone when the
 *  location is missing. */
export async function venueWallClockAt(
  tx: Transaction,
  locationId: string,
  now: Date,
): Promise<{ date: string; time: string }> {
  const [loc] = await tx
    .select({ timeZone: locations.timeZone })
    .from(locations)
    .where(eq(locations.id, locationId));
  return venueWallClock(now, safeTimeZone(loc?.timeZone ?? DEFAULT_TIME_ZONE));
}

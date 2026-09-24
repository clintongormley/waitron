import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { DEFAULT_TIME_ZONE, locations } from "@waitron/db";
import type { FloorAnnotator } from "@waitron/module";
import { bookings } from "./schema/bookings.js";

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

/** How long a `booked` reservation stays on the floor after its time, for a guest running late. */
const RESERVATION_GRACE_MINUTES = 30;

/** Clamped to `"00:00"`: the read scans only today. */
function reservationGraceFloor(venueNow: string): string {
  const [h, m] = venueNow.split(":").map(Number);
  const floorMinutes = Math.max(0, h * 60 + m - RESERVATION_GRACE_MINUTES);
  const hh = String(Math.floor(floorMinutes / 60)).padStart(2, "0");
  const mm = String(floorMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Each table's next `booked` reservation today at or after the grace floor, as `HH:MM`, or `null`.
 *
 * The `gte` below compares text, which is chronological only while both operands keep a two-digit
 * hour: `reservationGraceFloor` pads its own, and `routes.ts`'s `TIME_HHMM` refuses a stored time
 * without one.
 */
export const BOOKINGS_FLOOR_ANNOTATIONS: FloorAnnotator = {
  async annotate(tx, cfg, now, tableIds) {
    const result = new Map<string, { reservedTime: string | null }>();
    for (const id of tableIds) result.set(id, { reservedTime: null });
    if (tableIds.length === 0) return result;

    const [loc] = await tx
      .select({ timeZone: locations.timeZone })
      .from(locations)
      .where(eq(locations.id, cfg.locationId));
    const timeZone = safeTimeZone(loc?.timeZone ?? DEFAULT_TIME_ZONE);
    const { date: venueToday, time: venueNow } = venueWallClock(now, timeZone);
    const graceFloor = reservationGraceFloor(venueNow);

    const rows = await tx
      .select({ tableId: bookings.tableId, bookingTime: bookings.bookingTime })
      .from(bookings)
      .where(
        and(
          eq(bookings.locationId, cfg.locationId),
          inArray(bookings.tableId, tableIds),
          eq(bookings.status, "booked"),
          eq(bookings.bookingDate, venueToday),
          gte(bookings.bookingTime, graceFloor),
        ),
      )
      .orderBy(bookings.tableId, asc(bookings.bookingTime));

    for (const r of rows) {
      if (r.tableId === null) continue;
      // Rows are ordered by time within each table, so the first one seen wins.
      const existing = result.get(r.tableId);
      if (existing !== undefined && existing.reservedTime === null) {
        result.set(r.tableId, { reservedTime: r.bookingTime.slice(0, 5) });
      }
    }
    return result;
  },
};

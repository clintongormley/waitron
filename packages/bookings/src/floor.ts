import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { DEFAULT_TIME_ZONE, locations } from "@waitron/db";
import type { FloorAnnotator } from "@waitron/module";
import { bookings } from "./schema/bookings.js";
import { safeTimeZone, venueWallClock } from "./wall-clock.js";

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

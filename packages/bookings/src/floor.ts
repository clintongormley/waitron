// The reserved-on-floor annotation (design §4): bookings' contribution to core's floor read-model.
// Core's `listTablesWithState` calls this per floor poll and merges the result onto its rows, so the
// timezone read + grace window + the imminent-booking scan live in the module that owns `bookings`,
// not in the till core.
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { DEFAULT_TIME_ZONE, locations } from "@waitron/db";
import type { FloorAnnotator } from "@waitron/module";
import { bookings } from "./schema/bookings.js";

/** Resolve a stored IANA time zone, substituting the schema default for an unrecognised value.
 *  `locations.time_zone` is free-text with NO CHECK constraint (`.notNull().default("Europe/Madrid")`),
 *  so a typo or a legacy value can be anything. `Intl.DateTimeFormat({ timeZone })` throws `RangeError`
 *  on an unknown zone, which would turn the floor read into a 500 — corrupt venue config must not take
 *  out the operational floor. A zone `Intl` rejects falls back to the column's own default. */
function safeTimeZone(timeZone: string): string {
  try {
    // Constructing the formatter is what validates the zone; it throws RangeError for an unknown one.
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Venue-local wall-clock derived from an instant + IANA time zone (design §2b/§4). Computed in JS via
 *  `Intl` — never in SQL — so no offset is stored: a booking is a wall-clock intention, and "today"/"now"
 *  for the imminence check are the venue's local values at read time. Returns the local calendar date
 *  (`YYYY-MM-DD`) and time-of-day (`HH:MM`, 24-hour). */
function venueWallClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** How long a `booked` reservation keeps surfacing on the floor AFTER its time (design §4). The floor
 *  cue is most useful exactly when a guest is due or running late, so the reserved badge lingers for this
 *  window past the booking time rather than vanishing on the minute. A per-venue configurable value is a
 *  later slice. Only ever SUBTRACTED from the venue's local "now", clamped to the start of today. */
const RESERVATION_GRACE_MINUTES = 30;

/** The earliest booking time still surfaced on the floor: the venue-local "now" (`HH:MM`) rolled back by
 *  `RESERVATION_GRACE_MINUTES`, clamped to `"00:00"` so it never crosses to the previous day (the read
 *  only scans today). Pure HH:MM minute-of-day arithmetic — the timezone math already happened in
 *  `venueWallClock`. */
function reservationGraceFloor(venueNow: string): string {
  const [h, m] = venueNow.split(":").map(Number);
  const floorMinutes = Math.max(0, h * 60 + m - RESERVATION_GRACE_MINUTES);
  const hh = String(Math.floor(floorMinutes / 60)).padStart(2, "0");
  const mm = String(floorMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Bookings' floor annotator: the table's NEXT imminent `booked` reservation for the venue's TODAY at or
 * after the grace floor, as `HH:MM`, or `null`. The returned Map carries one entry PER input `tableId`.
 *
 * Scoped by tenant AND location (CLAUDE.md §3 — a by-id/by-location read never trusts a globally-unique
 * UUID or the one-tenant-per-db invariant). A plain per-`tableIds` query (`inArray`), NOT a correlated
 * subquery, so the scalar-subquery trap does not apply. Ordered by `(tableId, bookingTime asc)`: the
 * first row seen per table is its earliest imminent booking. `booking_time` is a `time` (`HH:MM:SS`);
 * normalised to `HH:MM` at the presentation edge, as the floor renders "Reserved HH:MM".
 */
export const BOOKINGS_FLOOR_ANNOTATIONS: FloorAnnotator = {
  async annotate(tx, cfg, now, tableIds) {
    const result = new Map<string, { reservedTime: string | null }>();
    for (const id of tableIds) result.set(id, { reservedTime: null });
    if (tableIds.length === 0) return result;

    // Venue-local "today"/"now" from the location's stored zone (design §2b) — never in SQL. Missing
    // location or an invalid stored zone both fall back to the column's own default.
    const [loc] = await tx
      .select({ timeZone: locations.timeZone })
      .from(locations)
      .where(and(eq(locations.id, cfg.locationId), eq(locations.tenantId, cfg.tenantId)));
    const timeZone = safeTimeZone(loc?.timeZone ?? DEFAULT_TIME_ZONE);
    const { date: venueToday, time: venueNow } = venueWallClock(now, timeZone);
    const graceFloor = reservationGraceFloor(venueNow);

    const rows = await tx
      .select({ tableId: bookings.tableId, bookingTime: bookings.bookingTime })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, cfg.tenantId),
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
      // The map is pre-seeded null for every input table; the first (earliest) booked row per table wins.
      const existing = result.get(r.tableId);
      if (existing !== undefined && existing.reservedTime === null) {
        result.set(r.tableId, { reservedTime: r.bookingTime.slice(0, 5) });
      }
    }
    return result;
  },
};

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { bookings } from "./schema/bookings.js";
import { venueWallClockAt } from "./wall-clock.js";

/** Refuses a table while a `booked` booking from the venue's today on names it, naming the earliest
 *  such booking's date and time; letting go keeps the table's name on every booking that named it.
 *  `booking_date` is `YYYY-MM-DD` and `booking_time` `HH:MM:SS` text, so both sort chronologically. */
export const BOOKINGS_TABLE_REMOVAL: TableRemoval = {
  async refuse(tx, cfg, tableIds, now) {
    const refusals = new Map<string, AppError>();
    if (tableIds.length === 0) return refusals;
    const { date: venueToday } = await venueWallClockAt(tx, cfg.locationId, now);
    const booked = await tx
      .select({
        tableId: bookings.tableId,
        earliest: sql<string>`min(${bookings.bookingDate} || ' ' || ${bookings.bookingTime})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.locationId, cfg.locationId),
          inArray(bookings.tableId, [...tableIds]),
          eq(bookings.status, "booked"),
          gte(bookings.bookingDate, venueToday),
        ),
      )
      .groupBy(bookings.tableId);
    for (const row of booked) {
      const tableId = row.tableId!;
      const [date, time] = row.earliest.split(" ");
      refusals.set(
        tableId,
        new AppError("table.booked", { tableId, date, time: time!.slice(0, 5) }),
      );
    }
    return refusals;
  },

  async release(tx, _cfg, tableId, label) {
    await tx
      .update(bookings)
      .set({ tableLabel: label, tableId: null })
      .where(eq(bookings.tableId, tableId));
  },
};

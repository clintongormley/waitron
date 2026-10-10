import { and, eq, gte, inArray } from "drizzle-orm";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { bookings } from "./schema/bookings.js";
import { venueWallClockAt } from "./wall-clock.js";

/** Refuses a table while a `booked` booking from the venue's today on names it; letting go keeps the
 *  table's name on every booking that named it. `booking_date` is `YYYY-MM-DD` text, so `gte`
 *  compares it chronologically. */
export const BOOKINGS_TABLE_REMOVAL: TableRemoval = {
  async refuse(tx, cfg, tableIds, now) {
    const refusals = new Map<string, AppError>();
    if (tableIds.length === 0) return refusals;
    const { date: venueToday } = await venueWallClockAt(tx, cfg.locationId, now);
    const booked = await tx
      .selectDistinct({ tableId: bookings.tableId })
      .from(bookings)
      .where(
        and(
          eq(bookings.locationId, cfg.locationId),
          inArray(bookings.tableId, [...tableIds]),
          eq(bookings.status, "booked"),
          gte(bookings.bookingDate, venueToday),
        ),
      );
    for (const row of booked) {
      const tableId = row.tableId!;
      refusals.set(tableId, new AppError("table.booked", { tableId }));
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

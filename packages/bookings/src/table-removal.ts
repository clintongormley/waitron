import { and, eq, gte } from "drizzle-orm";
import type { TableRemoval } from "@waitron/module";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { bookings } from "./schema/bookings.js";
import { venueWallClockAt } from "./wall-clock.js";

/** Refuses while a `booked` booking from the venue's today on names the table; letting go keeps the
 *  table's name on every booking that named it. `booking_date` is `YYYY-MM-DD` text, so `gte`
 *  compares it chronologically. */
export const BOOKINGS_TABLE_REMOVAL: TableRemoval = {
  async refuse(tx, cfg, tableId, now) {
    const { date: venueToday } = await venueWallClockAt(tx, cfg.locationId, now);
    const [booked] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.locationId, cfg.locationId),
          eq(bookings.tableId, tableId),
          eq(bookings.status, "booked"),
          gte(bookings.bookingDate, venueToday),
        ),
      )
      .limit(1);
    if (booked !== undefined) throw new AppError("table.booked", { tableId });
  },

  async release(tx, _cfg, tableId, label) {
    await tx
      .update(bookings)
      .set({ tableLabel: label, tableId: null })
      .where(eq(bookings.tableId, tableId));
  },
};

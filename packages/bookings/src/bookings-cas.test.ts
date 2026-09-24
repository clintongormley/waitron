/**
 * `seatBooking`'s compare-and-swap: its terminal UPDATE carries `and status = 'booked'`, so a
 * booking that has left `booked` matches no row and the verb throws `booking.invalid_transition`.
 *
 * No concurrent cancel is staged: `withTransaction` runs one write transaction on the venue file at
 * a time (`packages/store/src/write-queue.ts`), so another `withTransaction` caller's cancel cannot
 * land between a seat's read and its write.
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diningTables, locations, tills, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { bookings } from "./schema/bookings.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import { cancelBooking, createBooking, type BookingConfig } from "./bookings.js";
import "./errors.js";

const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });
const LOCALE = "es-ES";

async function setupVenue(db: Database): Promise<{ cfg: BookingConfig; createdBy: string }> {
  await seedTenant(db);
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  await db.insert(tills).values({ locationId, name: "Caja 1" });
  await seedNode(db, brandLocationId(locationId));
  return { cfg: { locationId: brandLocationId(locationId) }, createdBy: crypto.randomUUID() };
}

/** An ACTIVE dining table for the venue (createTable's raw equivalent — the verb lives in
 * apps/server, which a module cannot import). */
async function seedTable(db: Database, cfg: BookingConfig, label: string): Promise<string> {
  const [row] = await db
    .insert(diningTables)
    .values({ locationId: cfg.locationId, label, active: true })
    .returning({ id: diningTables.id });
  return row!.id;
}

describe("seatBooking compare-and-swap guard", () => {
  it("guard proof by deletion: the CAS's `status = 'booked'` predicate rejects a non-booked row (0 rows)", async () => {
    // This proves the WHERE clause's semantics, not the wiring inside `seatBooking`; the wiring is
    // the `bookings.test.ts` case that cancels the booking inside `openTab`.
    const { cfg, createdBy } = await setupVenue(suite.db);
    const tableId = await seedTable(suite.db, cfg, "CAS-2");
    const { id: bookingId } = await withTransaction(suite.db, (tx: Transaction) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        tableId,
        createdBy,
      }),
    );
    await withTransaction(suite.db, (tx: Transaction) => cancelBooking(tx, cfg, bookingId));

    await withTransaction(suite.db, async (tx: Transaction) => {
      // seatBooking's terminal WHERE verbatim.
      const guarded = await tx
        .update(bookings)
        .set({ status: "seated" })
        .where(and(eq(bookings.id, bookingId), eq(bookings.status, "booked")))
        .returning({ id: bookings.id });
      expect(guarded).toHaveLength(0);

      // The control: the same update without the status predicate matches the cancelled row.
      const unguarded = await tx
        .update(bookings)
        .set({ status: "seated" })
        .where(eq(bookings.id, bookingId))
        .returning({ id: bookings.id });
      expect(unguarded).toHaveLength(1);

      await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    });
  });
});

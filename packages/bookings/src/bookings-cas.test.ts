/**
 * `seatBooking`'s compare-and-swap: its terminal UPDATE carries `and status = 'booked'`, so a
 * booking that has left `booked` matches no row and the verb throws `booking.invalid_transition`.
 *
 * ## The case that was DELETED with the PostgreSQL harness, and why it is not restated
 *
 * This file used to open with a genuine two-backend race: one connection held the booking's dining
 * table `FOR UPDATE`, the real `seatBooking` ran on a second connection and parked on that lock
 * inside `openTab` — precisely between its lock-free `getBooking` read of `booked` and the CAS
 * write — the first connection then cancelled and COMMITTED, and the CAS caught it. That case is
 * gone, and nothing here replaces it. Staging it needs two transactions interleaved mid-flight,
 * and one write transaction runs on the venue file at a time
 * (`packages/store/src/write-queue.ts`): the second `withTransaction` does not begin until the
 * first has committed, so a cancel cannot land between the read and the write of one seat. The
 * `.for("update")` both halves rested on is gone too, in both places it lived — this file's own,
 * and `fakeCore`'s `SELECT … FOR UPDATE` on the dining table (`./testing/fake-core.js`) — because
 * drizzle's SQLite query builder has no `.for()` and each was a compile error
 * (`error TS2339: Property 'for' does not exist`). Recover the deleted case with
 * `git show origin/main:packages/bookings/src/bookings-cas.test.ts`.
 *
 * Rewriting it into something that passes is what CLAUDE.md §4's "treat 'there is a test' as an
 * unfinished sentence" refuses, so it was not rewritten. What the requirement behind it — a
 * concurrent cancel must not be seated — now rests on is the CAS predicate itself: isolated by the
 * case below, and reached through `seatBooking` by the `bookings.test.ts` case that cancels the
 * booking inside `openTab`.
 *
 * ## What the surviving case is, unchanged
 *
 * A timing-free, direct isolation of that predicate, with its own control in the other direction.
 * It was written as insurance against the race regressing to a false pass. `seatBooking` itself
 * reaching the predicate after its earlier check has passed is asserted in `bookings.test.ts`, by
 * the case that cancels the booking inside `openTab`; this file isolates the predicate alone.
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

/** A tenant + location + till + node. Written through the table definitions, not raw SQL: each
 * `id` comes from a `$defaultFn` in JavaScript rather than a column DEFAULT, so a raw insert
 * naming none is refused `NOT NULL constraint failed`, and `invoiceLocales` reaches its column's
 * JSON mapping where `array['es-ES']` used to be SQL this engine does not have. */
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
    // It runs seatBooking's EXACT terminal WHERE against a booking that is already `cancelled` and
    // asserts it matches 0 rows; then it removes ONLY the `status = 'booked'` predicate and asserts
    // the SAME statement now matches 1 row. That is the compare-and-swap's whole job: without the
    // status predicate the write would seat a booking that had left `booked`.
    //
    // This proves the WHERE clause's SEMANTICS, not the wiring inside `seatBooking`; the wiring is
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
      // seatBooking's terminal WHERE verbatim: id AND status = 'booked'. The booking is `cancelled`,
      // so the guarded update matches nothing — the throw path.
      const guarded = await tx
        .update(bookings)
        .set({ status: "seated" })
        .where(and(eq(bookings.id, bookingId), eq(bookings.status, "booked")))
        .returning({ id: bookings.id });
      expect(guarded).toHaveLength(0);

      // The SAME update with the `status = 'booked'` predicate DELETED — the mutation that the guard
      // defends against — matches the cancelled row: 1 row, the wrong write. Undone below.
      const unguarded = await tx
        .update(bookings)
        .set({ status: "seated" })
        .where(eq(bookings.id, bookingId))
        .returning({ id: bookings.id });
      expect(unguarded).toHaveLength(1);

      // Undo the unguarded write so the fixture is not left `seated` (belt-and-braces; the helper
      // empties every table after each test anyway). (`tab_id` was never touched, so no FK to reset.)
      await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    });
  });
});

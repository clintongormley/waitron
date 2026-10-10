import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { newId, nowIso, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { getBooking } from "./bookings.js";
import { BOOKINGS_TABLE_REMOVAL } from "./table-removal.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import "./errors.js";

const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Venue {
  locationId: LocationId;
}

async function setupVenue(timeZone = "Europe/Madrid"): Promise<Venue> {
  await seedTenant(db);
  // Raw SQL names `id` because it has no SQL default: drizzle's `$defaultFn` fills it for builder
  // inserts only.
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (id, name, invoice_locales, operation_description, time_zone)
    values (${newId()}, 'Barra', '["es-ES"]', 'Venta en establecimiento', ${timeZone})
    returning id`);
  return { locationId: brandLocationId(loc.rows[0]!.id) };
}

async function makeTable(v: Venue, label: string): Promise<string> {
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (id, created_at, location_id, label, active)
    values (${newId()}, ${nowIso()}, ${v.locationId}, ${label}, 1)
    returning id`);
  return row.rows[0]!.id;
}

async function insertBooking(
  v: Venue,
  fields: { tableId: string; date: string; status?: string },
): Promise<string> {
  const id = newId();
  await db.execute(sql`
    insert into bookings
      (id, created_at, location_id, table_id, booking_date, booking_time, party_size,
       contact_name, created_by, status)
    values
      (${id}, ${nowIso()}, ${v.locationId}, ${fields.tableId}, ${fields.date}, '20:00:00',
       2, 'Ana', ${randomUUID()}, ${fields.status ?? "booked"})`);
  return id;
}

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

// 2026-09-15T22:30:00Z is 00:30 on 2026-09-16 in Madrid (CEST, UTC+2): the venue's today is the
// 16th while the UTC date is still the 15th.
const AFTER_MADRID_MIDNIGHT = new Date("2026-09-15T22:30:00Z");

describe("BOOKINGS_TABLE_REMOVAL.refuse", () => {
  it("refuses while a booking from the venue's today on is booked at the table", async () => {
    const v = await setupVenue();
    const today = await makeTable(v, "T1");
    const later = await makeTable(v, "T2");
    await insertBooking(v, { tableId: today, date: "2026-09-16" });
    await insertBooking(v, { tableId: later, date: "2026-10-01" });

    for (const tableId of [today, later]) {
      const err = await inTx((tx) =>
        BOOKINGS_TABLE_REMOVAL.refuse(tx, v, tableId, AFTER_MADRID_MIDNIGHT),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: "table.booked", params: { tableId } });
    }
  });

  it("does not refuse for the venue's yesterday, a cancelled or completed booking today, or another table", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "T3");
    const other = await makeTable(v, "T4");
    // The UTC date of `now`, but yesterday on the venue's wall clock.
    await insertBooking(v, { tableId: t, date: "2026-09-15" });
    await insertBooking(v, { tableId: t, date: "2026-09-16", status: "cancelled" });
    await insertBooking(v, { tableId: t, date: "2026-09-16", status: "completed" });
    await insertBooking(v, { tableId: other, date: "2026-09-16" });

    await expect(
      inTx((tx) => BOOKINGS_TABLE_REMOVAL.refuse(tx, v, t, AFTER_MADRID_MIDNIGHT)),
    ).resolves.toBeUndefined();
  });

  it("does not refuse for a seated or no-show booking today", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "T6");
    await insertBooking(v, { tableId: t, date: "2026-09-16", status: "seated" });
    await insertBooking(v, { tableId: t, date: "2026-09-16", status: "no_show" });

    await expect(
      inTx((tx) => BOOKINGS_TABLE_REMOVAL.refuse(tx, v, t, AFTER_MADRID_MIDNIGHT)),
    ).resolves.toBeUndefined();
  });

  it("reads today in the default zone when the venue's zone is one Intl rejects", async () => {
    const v = await setupVenue("Not/AZone");
    const t = await makeTable(v, "T5");
    await insertBooking(v, { tableId: t, date: "2026-09-16" });

    await expect(
      inTx((tx) => BOOKINGS_TABLE_REMOVAL.refuse(tx, v, t, AFTER_MADRID_MIDNIGHT)),
    ).rejects.toMatchObject({ code: "table.booked", params: { tableId: t } });
  });
});

describe("BOOKINGS_TABLE_REMOVAL.release", () => {
  it("keeps the table's name on past bookings when it lets go", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "Terrace 4");
    const other = await makeTable(v, "Terrace 5");
    const past = await insertBooking(v, { tableId: t, date: "2026-09-01", status: "completed" });
    const kept = await insertBooking(v, { tableId: other, date: "2026-09-01" });

    await inTx((tx) => BOOKINGS_TABLE_REMOVAL.release(tx, v, t, "Terrace 4"));

    const released = await inTx((tx) => getBooking(tx, v, past));
    expect(released).toMatchObject({ tableId: null, tableLabel: "Terrace 4" });
    const untouched = await inTx((tx) => getBooking(tx, v, kept));
    expect(untouched).toMatchObject({ tableId: other, tableLabel: null });
  });

  it("lets go of a booking for the table whose location is another venue's", async () => {
    const v = await setupVenue();
    const elsewhere = await setupVenue();
    const t = await makeTable(v, "Terrace 6");
    const stray = await insertBooking(elsewhere, { tableId: t, date: "2026-09-01" });

    await inTx((tx) => BOOKINGS_TABLE_REMOVAL.release(tx, v, t, "Terrace 6"));

    const released = await inTx((tx) => getBooking(tx, elsewhere, stray));
    expect(released).toMatchObject({ tableId: null, tableLabel: "Terrace 6" });
  });
});

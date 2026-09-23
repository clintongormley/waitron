import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_ZONE, newId, nowIso, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { BOOKINGS_FLOOR_ANNOTATIONS } from "./floor.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import "./errors.js";

// The reserved-on-floor annotator is a correlated read, exercised here against a real migrated
// SQLite venue database. The whole manifest, not [core, bookings]: the shared ordered set lands
// bookings on top of its dependencies.
const suite = useVenueDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Venue {
  locationId: LocationId;
}

/** Stand up a fresh tenant + location (optionally with a pinned time zone) and its scoping ids. */
async function setupVenue(opts: { timeZone?: string } = {}): Promise<Venue> {
  await seedTenant(db);
  // The annotator derives venue-local "today"/"now" from this column (design §2b/§4); default the schema
  // default (Europe/Madrid) unless a test pins one.
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  // Two things this raw statement supplies that the PostgreSQL one did not. `id` comes from a
  // JavaScript `$defaultFn` generator now (`newId`, `packages/db/src/schema/columns.ts:270`) and
  // the DDL declares no SQL DEFAULT for it, so a raw insert that omits it is refused
  // `NOT NULL constraint failed: locations.id` (the idiom is
  // `packages/workforce/src/migrations.test.ts:43-50`). And `invoice_locales` is one TEXT column
  // holding a JSON array (`labelList`, `packages/db/src/schema/columns.ts:255`) where it used to be
  // `text[]`; the `array['es-ES']` literal it replaces was refused at PREPARE, which killed every
  // case in this file in setup — running the suite before the change printed
  // `Error: near "['es-ES']": syntax error` from `packages/store/src/node-sqlite-adapter.ts:64`.
  // The JSON text is what the column's own CHECK counts with `json_array_length`
  // (`packages/db/src/schema/tenants.ts:197`).
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (id, name, invoice_locales, operation_description, time_zone)
    values (${newId()}, 'Barra', '["es-ES"]', 'Venta en establecimiento', ${timeZone})
    returning id`);
  return {
    locationId: brandLocationId(loc.rows[0]!.id),
  };
}

/** Insert an ACTIVE dining table for the venue and return its id. */
async function makeTable(v: Venue, label: string): Promise<string> {
  // `id` and `created_at` are `$defaultFn` generators here too — see `setupVenue`. `active` is 1
  // rather than the JavaScript `true` this replaces: `flag` is an INTEGER column now and
  // `node:sqlite` refuses to bind a boolean at all. Measured on node v26.7.0 —
  // `db.prepare("insert into t (id, active) values (?, ?)").run("a", true)` against
  // `create table t (id text primary key, active integer not null)` throws
  // `TypeError: Provided value cannot be bound to SQLite parameter 2`.
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (id, created_at, location_id, label, active)
    values (${newId()}, ${nowIso()}, ${v.locationId}, ${label}, 1)
    returning id`);
  return row.rows[0]!.id;
}

/** Insert a booking row directly (as the app role) — this read test only needs rows in the table.
 *  `booking_time` is a plain venue-local `time` (§2b). */
async function insertBooking(
  v: Venue,
  fields: {
    tableId: string | null;
    date: string;
    time: string;
    status?: string;
    locationId?: LocationId;
  },
): Promise<void> {
  const location = fields.locationId ?? v.locationId;
  await withTransaction(db, async (tx) => {
    // `id` and `created_at` supplied for the same reason as in `setupVenue`: both are `$defaultFn`
    // generators on `bookings` (`./schema/bookings.ts:50` and `:72`), which drizzle runs for a
    // BUILDER insert and never for raw SQL.
    await tx.execute(sql`
      insert into bookings
        (id, created_at, location_id, table_id, booking_date, booking_time, party_size,
         contact_name, created_by, status)
      values
        (${newId()}, ${nowIso()}, ${location}, ${fields.tableId}, ${fields.date}, ${fields.time},
         2, 'Ana', ${randomUUID()}, ${fields.status ?? "booked"})`);
  });
}

/** Run the annotator in one transaction, the shape production uses. The `asAppUser` call inside is
 * an empty body on this engine (`packages/db/src/testing/roles.ts`) and asserts nothing. */
function annotate(
  v: Venue,
  now: Date,
  tableIds: string[],
): Promise<Map<string, { reservedTime: string | null }>> {
  return withTransaction(db, async (tx: Transaction) => {
    return BOOKINGS_FLOOR_ANNOTATIONS.annotate(tx, v, now, tableIds);
  });
}

// 2026-09-15T10:00:00Z → Madrid (CEST, UTC+2 in September) 12:00 on 2026-09-15.
const MADRID_NOON = new Date("2026-09-15T10:00:00Z");

describe("BOOKINGS_FLOOR_ANNOTATIONS.annotate", () => {
  it("returns the table's next booked reservation later today as HH:MM", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "7");
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "14:00" });
    const m = await annotate(v, MADRID_NOON, [t]);
    expect(m.get(t)).toEqual({ reservedTime: "14:00" });
  });

  it("returns reservedTime null when the table has no upcoming booked reservation", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "8");
    const m = await annotate(v, MADRID_NOON, [t]);
    expect(m.get(t)).toEqual({ reservedTime: null });
  });

  it("carries one entry per input tableId (empty set → empty map)", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "8b");
    const m = await annotate(v, MADRID_NOON, [t]);
    expect([...m.keys()]).toEqual([t]);
    expect(await annotate(v, MADRID_NOON, [])).toEqual(new Map());
  });

  it("excludes past-time, non-booked-status, and other-day reservations", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "9");
    // Past-time today (now = 12:00): excluded.
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "09:00" });
    // Future today but not `booked`: each excluded.
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "15:00", status: "seated" });
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "16:00", status: "cancelled" });
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "17:00", status: "no_show" });
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "18:00", status: "completed" });
    // Booked but a different day: excluded.
    await insertBooking(v, { tableId: t, date: "2026-09-16", time: "13:00" });
    const m = await annotate(v, MADRID_NOON, [t]);
    expect(m.get(t)).toEqual({ reservedTime: null });
  });

  it("returns the earliest of two future booked reservations", async () => {
    const v = await setupVenue();
    const t = await makeTable(v, "10");
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "20:00" });
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "13:30" });
    const m = await annotate(v, MADRID_NOON, [t]);
    expect(m.get(t)).toEqual({ reservedTime: "13:30" });
  });

  it("does not crash when locations.time_zone is an invalid IANA zone (falls back to the default)", async () => {
    // `locations.time_zone` is free-text with NO CHECK constraint, so a typo can be stored;
    // `Intl.DateTimeFormat` throws `RangeError` on an unknown zone. The read falls back to the column's
    // own default (Europe/Madrid), so with `MADRID_NOON` the 14:00 booking still surfaces.
    const v = await setupVenue({ timeZone: "Not/AZone" });
    const t = await makeTable(v, "13");
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "14:00" });
    const m = await annotate(v, MADRID_NOON, [t]);
    expect(m.get(t)).toEqual({ reservedTime: "14:00" });
  });

  it("derives venue-local 'today' from locations.time_zone, not UTC (date boundary)", async () => {
    // now = 2026-09-01T23:00:00Z. In Pacific/Kiritimati (UTC+14) that is 2026-09-02 13:00 — a DIFFERENT
    // calendar day than the UTC 2026-09-01.
    const v = await setupVenue({ timeZone: "Pacific/Kiritimati" });
    const clock = new Date("2026-09-01T23:00:00Z");
    const t = await makeTable(v, "11");
    await insertBooking(v, { tableId: t, date: "2026-09-02", time: "15:00" });
    // A booking on the UTC day (2026-09-01) must NOT surface — it is yesterday at the venue.
    await insertBooking(v, { tableId: t, date: "2026-09-01", time: "23:30" });
    const m = await annotate(v, clock, [t]);
    expect(m.get(t)).toEqual({ reservedTime: "15:00" });
  });

  it("derives venue-local 'now' from locations.time_zone (hour boundary)", async () => {
    // Same instant/tz → venue now is 2026-09-02 13:00. 12:00 (before) excluded; 14:00 (after) surfaces.
    const v = await setupVenue({ timeZone: "Pacific/Kiritimati" });
    const clock = new Date("2026-09-01T23:00:00Z");
    const t = await makeTable(v, "12");
    await insertBooking(v, { tableId: t, date: "2026-09-02", time: "12:00" });
    await insertBooking(v, { tableId: t, date: "2026-09-02", time: "14:00" });
    const m = await annotate(v, clock, [t]);
    expect(m.get(t)).toEqual({ reservedTime: "14:00" });
  });

  it("keeps a just-passed reservation within the grace window (inclusive floor), drops it beyond", async () => {
    // now = Madrid 12:00, grace 30 min → grace floor 11:30. 11:45 (within) surfaces; 11:15 (beyond) gone;
    // 11:30 (the exact inclusive floor) STILL surfaces — a `>=`→`>` regression would drop it.
    const v = await setupVenue();
    const within = await makeTable(v, "14");
    const beyond = await makeTable(v, "15");
    const boundary = await makeTable(v, "16");
    await insertBooking(v, { tableId: within, date: "2026-09-15", time: "11:45" });
    await insertBooking(v, { tableId: beyond, date: "2026-09-15", time: "11:15" });
    await insertBooking(v, { tableId: boundary, date: "2026-09-15", time: "11:30" });
    const m = await annotate(v, MADRID_NOON, [within, beyond, boundary]);
    expect(m.get(within)).toEqual({ reservedTime: "11:45" });
    expect(m.get(beyond)).toEqual({ reservedTime: null });
    expect(m.get(boundary)).toEqual({ reservedTime: "11:30" });
  });

  it("builds the Intl.DateTimeFormat once per timezone and reuses it across polls (memoized)", async () => {
    // Constructing `Intl.DateTimeFormat` is expensive and the floor polls every table read; the
    // formatter is memoized per zone so a zone builds once and later polls reuse the same instance.
    // Novel zones (unused by other tests) so the module cache is cold when the spy is installed.
    const tzA = "Asia/Tokyo";
    const tzB = "America/New_York";
    const va = await setupVenue({ timeZone: tzA });
    const vb = await setupVenue({ timeZone: tzB });
    const ta = await makeTable(va, "tz-a");
    const tb = await makeTable(vb, "tz-b");

    // Return a GENUINE instance from the mock (a bare construct-through spy yields an object whose
    // prototype chain is the spy's, so `formatToParts` throws "incompatible receiver"). The
    // implementation must be a `function` expression, not an arrow. Measured on 4.1.11 by switching
    // this one `mockImplementation` to an arrow: the assertion below then reads two constructions
    // instead of one and the test fails. Why the arrow behaves differently here was not established.
    const OriginalDTF = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
    ): Intl.DateTimeFormat {
      return new OriginalDTF(...args);
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      await annotate(va, MADRID_NOON, [ta]); // same zone, twice
      await annotate(va, MADRID_NOON, [ta]);
      await annotate(vb, MADRID_NOON, [tb]); // a different zone

      const builtFor = (tz: string): Intl.DateTimeFormat[] =>
        spy.mock.results
          .filter(
            (_r, i) =>
              (spy.mock.calls[i]![1] as Intl.DateTimeFormatOptions | undefined)?.timeZone === tz,
          )
          .map((r) => r.value as Intl.DateTimeFormat);
      // One construction for tzA despite two polls (non-memoized code builds two per poll → four).
      expect(builtFor(tzA)).toHaveLength(1);
      // A different zone keys a distinct, separately-built formatter.
      expect(builtFor(tzB)).toHaveLength(1);
      expect(builtFor(tzA)[0]).not.toBe(builtFor(tzB)[0]);
    } finally {
      spy.mockRestore();
    }
  });

  it("never caches an invalid timezone as valid — repeated polls still fall back to the default", async () => {
    // A failed formatter construction (invalid zone) must not be memoized as if valid; every poll of
    // an invalid zone re-throws and falls back, so the 14:00 Madrid-default booking keeps surfacing.
    const v = await setupVenue({ timeZone: "Not/AZone" });
    const t = await makeTable(v, "invalid-cache");
    await insertBooking(v, { tableId: t, date: "2026-09-15", time: "14:00" });
    expect((await annotate(v, MADRID_NOON, [t])).get(t)).toEqual({ reservedTime: "14:00" });
    expect((await annotate(v, MADRID_NOON, [t])).get(t)).toEqual({ reservedTime: "14:00" });
  });
});

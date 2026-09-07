import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, DEFAULT_TIME_ZONE, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { LocationId, TenantId } from "@waitron/shared";
import { BOOKINGS_FLOOR_ANNOTATIONS } from "./floor.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import "./errors.js";

// The reserved-on-floor annotator is a correlated read with no privilege/concurrency dimension, so
// PGlite is enough (the moved-from `apps/server/src/tables.test.ts` cases ran on PGlite too). The whole
// manifest, not [core, bookings]: bookings' capture trigger EXECUTEs sync's `sync_capture()`.
const suite = usePgliteDb({ migrations: BOOKINGS_TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Venue {
  tenantId: TenantId;
  locationId: LocationId;
}

/** Stand up a fresh tenant + location (optionally with a pinned time zone) and its scoping ids. */
async function setupVenue(opts: { timeZone?: string } = {}): Promise<Venue> {
  const tenantId = await seedTenant(db);
  // The annotator derives venue-local "today"/"now" from this column (design §2b/§4); default the schema
  // default (Europe/Madrid) unless a test pins one.
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description, time_zone)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento', ${timeZone}) returning id`);
  return {
    tenantId: brandTenantId(tenantId),
    locationId: brandLocationId(loc.rows[0]!.id),
  };
}

/** Insert an ACTIVE dining table for the venue and return its id. */
async function makeTable(v: Venue, label: string): Promise<string> {
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (tenant_id, location_id, label, active)
    values (${v.tenantId}, ${v.locationId}, ${label}, true) returning id`);
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
    tenantId?: TenantId;
    locationId?: LocationId;
  },
): Promise<void> {
  const tenant = fields.tenantId ?? v.tenantId;
  const location = fields.locationId ?? v.locationId;
  await withTenant(db, tenant, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`
      insert into bookings
        (tenant_id, location_id, table_id, booking_date, booking_time, party_size, contact_name, created_by, status)
      values
        (${tenant}, ${location}, ${fields.tableId}, ${fields.date}, ${fields.time},
         2, 'Ana', ${randomUUID()}, ${fields.status ?? "booked"})`);
  });
}

/** Run the annotator inside the venue's tenant scope as `app_user`, exactly as production does. */
function annotate(
  v: Venue,
  now: Date,
  tableIds: string[],
): Promise<Map<string, { reservedTime: string | null }>> {
  return withTenant(db, v.tenantId, async (tx: Transaction) => {
    await asAppUser(tx);
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

  it("scopes to cfg.tenantId — another tenant's booking on its own table is not surfaced (CLAUDE.md §3)", async () => {
    // RLS was dropped (#255), so `withTenant` no longer isolates SELECTs — the annotator MUST filter
    // `tenantId` itself. Scoped as tenant `v` but asked for BOTH tenants' table ids: `v`'s surfaces its
    // booking; the OTHER tenant's table (its own `booked` row today) stays null. Deletion-provable —
    // dropping the `tenantId` filter would leak the other tenant's booking through the shared DB.
    const v = await setupVenue();
    const other = await setupVenue();
    const vt = await makeTable(v, "17");
    const ot = await makeTable(other, "18");
    await insertBooking(v, { tableId: vt, date: "2026-09-15", time: "14:00" });
    await insertBooking(other, { tableId: ot, date: "2026-09-15", time: "15:00" });
    const m = await annotate(v, MADRID_NOON, [vt, ot]);
    expect(m.get(vt)).toEqual({ reservedTime: "14:00" });
    expect(m.get(ot)).toEqual({ reservedTime: null });
  });
});

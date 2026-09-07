import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { CoreServices } from "@waitron/module";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { fakeCore } from "./testing/fake-core.js";
import {
  cancelBooking,
  completeBooking,
  createBooking,
  getBooking,
  listBookings,
  markNoShow,
  seatBooking,
  updateBooking,
  type BookingConfig,
} from "./bookings.js";
import "./errors.js";

// Real PostgreSQL (a shared-container clone of the whole-manifest template), as the non-superuser
// `app_user`, NOT PGlite — the exact shape the till-reroute S3 leak was only caught by (CLAUDE.md §3):
// RLS was dropped (#255), so `withTenant` no longer isolates SELECTs and every by-id read/write must
// scope `tenantId` ITSELF. A booking's id is a globally-unique UUID; a second tenant that learns one
// must not be able to read its private `contact_name` or mutate its row through the booking verbs.
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });
let db: Database;
beforeAll(() => {
  db = suite.admin;
});

function asApp<T>(cfg: BookingConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

interface Venue {
  cfg: BookingConfig;
  core: CoreServices;
  createdBy: string;
}

/** A fresh tenant + location + till + node, each test getting its own two. */
async function setupVenue(): Promise<Venue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  return {
    cfg: { tenantId: brandTenantId(tenantId), locationId: brandLocationId(locationId) },
    core: fakeCore({ tenantId, tillId: till.rows[0]!.id, nodeId }),
    createdBy: randomUUID(),
  };
}

async function seedTable(cfg: BookingConfig, label: string): Promise<string> {
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (tenant_id, location_id, label, active)
    values (${cfg.tenantId}, ${cfg.locationId}, ${label}, true) returning id`);
  return row.rows[0]!.id;
}

/** Read one booking's status/contact as the owner (bypassing the verbs) to prove A's row is untouched. */
async function ownerRead(id: string): Promise<{ status: string; contactName: string } | undefined> {
  const { rows } = await db.execute<{ status: string; contact_name: string }>(
    sql`select status, contact_name from bookings where id = ${id}`,
  );
  const r = rows[0];
  return r === undefined ? undefined : { status: r.status, contactName: r.contact_name };
}

// Every verb below is called by tenant B (its own cfg) against tenant A's booking id.
//   Vulnerable (pre-fix): getBooking RETURNS A's row incl. contactName "García"; cancelBooking
//     COMMITS a cancellation of A's booking (A's status → cancelled); updateBooking mutates A's row;
//     completeBooking reaches advanceStatus's id-only read and throws invalid_transition (not
//     not_found); listBookings by A's locationId returns A's booking.
//   Fixed: every verb scopes `tenantId`, so getBooking → undefined, the mutators → booking.not_found
//     with A's row unchanged (still `booked`, name intact), and listBookings → [].
describe("booking verbs are scoped to cfg.tenantId (real Postgres, two tenants, app_user)", () => {
  it("a second tenant cannot READ or MUTATE another tenant's booking by id", async () => {
    const a = await setupVenue();
    const b = await setupVenue();
    const tableA = await seedTable(a.cfg, "A-1");
    const { id: idA } = await asApp(a.cfg, (tx) =>
      createBooking(tx, a.cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy: a.createdBy,
        tableId: tableA,
      }),
    );

    // READ leak: B must NOT see A's private row.
    expect(await asApp(b.cfg, (tx) => getBooking(tx, b.cfg, idA))).toBeUndefined();

    // MUTATE leaks: each verb refuses with booking.not_found and leaves A's row untouched.
    await expect(
      asApp(b.cfg, (tx) => updateBooking(tx, b.cfg, idA, { contactName: "HACKED", partySize: 9 })),
    ).rejects.toMatchObject({ code: "booking.not_found" });
    await expect(asApp(b.cfg, (tx) => cancelBooking(tx, b.cfg, idA))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(asApp(b.cfg, (tx) => markNoShow(tx, b.cfg, idA))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(asApp(b.cfg, (tx) => completeBooking(tx, b.cfg, idA))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(
      asApp(b.cfg, (tx) => seatBooking(tx, b.cfg, idA, {}, b.core)),
    ).rejects.toMatchObject({ code: "booking.not_found" });

    // A's booking is exactly as created: still `booked`, name intact — no verb reached it.
    expect(await ownerRead(idA)).toEqual({ status: "booked", contactName: "García" });

    // listBookings by A's locationId under B's tenant must not surface A's booking either.
    const cfgBWithALocation: BookingConfig = {
      tenantId: b.cfg.tenantId,
      locationId: a.cfg.locationId,
    };
    expect(
      await asApp(b.cfg, (tx) => listBookings(tx, cfgBWithALocation, { date: "2026-08-20" })),
    ).toEqual([]);

    // Control: A's own tenant still reads and lists its booking.
    expect((await asApp(a.cfg, (tx) => getBooking(tx, a.cfg, idA)))!.contactName).toBe("García");
    expect(
      await asApp(a.cfg, (tx) => listBookings(tx, a.cfg, { date: "2026-08-20" })),
    ).toHaveLength(1);
  });
});

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locations, tills, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import { BOOKINGS_PERMISSIONS, BOOKINGS_ROUTES } from "@waitron/bookings";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { writeClearingWorkflow } from "@waitron/venue-service";
import type { ModuleRouteContext } from "@waitron/module";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { finishTable, seatTable } from "./parties.js";
import "./errors.js";

// The `seatBooking ↔ seatTable` edge with the REAL `apps/server` `seatTable` — the one seam the
// bookings package's own route suite cannot pin, since a module cannot import apps/server and so its
// route tests bind a `fakeCore`. Here the generic mount receives the same `core` closure boot builds,
// and the seat route drives it end to end.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

// booking.manage is not in identity's static catalog: a manager holds it only once the module's
// permissions seat is folded into the ladder, which boot does via registerModulePermissions.
registerModulePermissions(BOOKINGS_PERMISSIONS);

const LOCALE = "es-ES";
const noopLog: Logger = () => {};

interface Venue {
  tillCfg: TillConfig;
  ctx: ModuleRouteContext;
  managerId: string;
  managerCookie: string;
}

async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  // Through the table definitions: `locations.id`, `tills.id` and `tills.created_at` are NOT NULL
  // `$defaultFn` generators a raw insert never reaches.
  const [location] = await db
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: [LOCALE],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const tillCfg: TillConfig = {
    tillId: brandTillId(till!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const manager = await withTransaction(db, async (tx) => {
    // Through the table definition for the same reason as the venue rows above.
    const [p] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: p!.id });
    return { id: p!.id, sid: session.token };
  });
  const ctx: ModuleRouteContext = {
    db,
    cfg: { locationId: tillCfg.locationId },
    // The EXACT closure boot wires (boot.ts): the module reaches the seat verb ONLY through this seat.
    core: { seatTable: (tx, req) => seatTable(tx, tillCfg, req) },
  };
  return {
    tillCfg,
    ctx,
    managerId: manager.id,
    managerCookie: `${MANAGEMENT_COOKIE}=${manager.sid}`,
  };
}

function mountApp(ctx: ModuleRouteContext): Hono {
  const app = new Hono();
  BOOKINGS_ROUTES.mount(app, ctx, noopLog);
  return app;
}

async function post(app: Hono, path: string, cookie: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method: "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("bookings seat route → real seatTable", () => {
  it("opens a real working-order tab and seats the booking with its tab id", async () => {
    const v = await setupVenue();
    const app = mountApp(v.ctx);

    // A table to reserve, and a `booked` reservation on it (the seat reuses the booking's own table).
    const tableId = await withTransaction(db, async (tx: Transaction) => {
      const { id } = await createTable(tx, v.tillCfg, { label: "7" });
      return id;
    });
    const created = await post(app, "/management-api/bookings", v.managerCookie, {
      bookingDate: "2026-08-20",
      bookingTime: "20:00",
      partySize: 4,
      contactName: "García",
      tableId,
    });
    expect(created.status).toBe(201);
    const bookingId = ((await created.json()) as { id: string }).id;

    const res = await post(app, `/management-api/bookings/${bookingId}/seat`, v.managerCookie);
    expect(res.status).toBe(200);
    const { tabId } = (await res.json()) as { tabId: string };
    expect(tabId).toMatch(/^[0-9a-f-]{36}$/);

    // The booking is seated with the REAL tab id, and that id names a real OPEN working_orders row.
    await withTransaction(db, async (tx) => {
      const booking = await tx.execute<{ status: string; tab_id: string | null }>(
        sql`select status, tab_id from bookings where id = ${bookingId}`,
      );
      expect(booking.rows[0]).toEqual({ status: "seated", tab_id: tabId });
      const order = await tx.execute<{ id: string; status: string }>(
        sql`select id, status from working_orders where id = ${tabId}`,
      );
      expect(order.rows[0]).toEqual({ id: tabId, status: "open" });
      // The party is seated as a party, opened by the manager who seated the booking, for its size.
      const party = await tx.execute<{ opened_by: string; guest_count: number; state: string }>(
        sql`select v.opened_by, v.guest_count, v.state from parties v
            join working_orders wo on wo.party_id = v.id where wo.id = ${tabId}`,
      );
      expect(party.rows).toEqual([{ opened_by: v.managerId, guest_count: 4, state: "open" }]);
    });
  });

  it("refuses seating a booking at a table that needs cleaning with 409 table.needs_cleaning", async () => {
    const v = await setupVenue();
    const app = mountApp(v.ctx);
    const tableId = await withTransaction(db, async (tx: Transaction) => {
      await writeClearingWorkflow(tx, true);
      const { id } = await createTable(tx, v.tillCfg, { label: "8" });
      const seated = await seatTable(tx, v.tillCfg, {
        tableId: id,
        guestCount: 2,
        operatorId: v.managerId,
      });
      await finishTable(tx, {
        partyId: seated.partyId,
        expectedPartyRevision: seated.revision,
        operatorId: v.managerId,
      });
      return id;
    });
    const created = await post(app, "/management-api/bookings", v.managerCookie, {
      bookingDate: "2026-08-20",
      bookingTime: "21:00",
      partySize: 2,
      contactName: "López",
      tableId,
    });
    expect(created.status).toBe(201);
    const bookingId = ((await created.json()) as { id: string }).id;

    const res = await post(app, `/management-api/bookings/${bookingId}/seat`, v.managerCookie);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "table.needs_cleaning", params: { tableId } },
    });
    await withTransaction(db, async (tx) => {
      const booking = await tx.execute<{ status: string; tab_id: string | null }>(
        sql`select status, tab_id from bookings where id = ${bookingId}`,
      );
      expect(booking.rows[0]).toEqual({ status: "booked", tab_id: null });
      const open = await tx.execute<{ n: number }>(
        sql`select count(*) as n from parties where state = 'open'`,
      );
      expect(open.rows[0]!.n).toBe(0);
      const table = await tx.execute<{ needs_cleaning_since: string | null }>(
        sql`select needs_cleaning_since from dining_tables where id = ${tableId}`,
      );
      expect(table.rows[0]!.needs_cleaning_since).not.toBeNull();
    });
  });
});

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { BOOKINGS_PERMISSIONS, BOOKINGS_ROUTES } from "@waitron/bookings";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import type { ModuleRouteContext } from "@waitron/module";
import type { TillConfig } from "./till-config.js";
import { createTable } from "./tables.js";
import { openTab } from "./working-order.js";
import "./errors.js";

// The `seatBooking ↔ openTab` edge with the REAL `apps/server` `openTab` — the one seam the bookings
// package's own route suite cannot pin, since a module cannot import apps/server and so its route tests
// bind a `fakeCore`. Here the generic mount receives the EXACT `core` closure boot builds
// (`{ openTab: (tx, req) => openTab(tx, till, req) }`, boot.ts), and the seat route drives it end to end:
// the real verb opens a real `working_orders` row and the booking is marked seated with that tab id.
// PGlite is enough — this pins a wiring edge, not a grant/concurrency property (routes.test.ts covers
// grants against real Postgres).
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

// booking.manage is not in identity's static catalog (SP1 t4): a manager holds it only once the module's
// permissions seat is folded into the ladder, which boot does via registerModulePermissions.
registerModulePermissions(BOOKINGS_PERMISSIONS);

const LOCALE = "es-ES";
const noopLog: Logger = () => {};

interface Venue {
  tillCfg: TillConfig;
  ctx: ModuleRouteContext;
  managerCookie: string;
}

async function setupVenue(): Promise<Venue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  const tillCfg: TillConfig = {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const managerSid = await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const session = await startManagementSession(tx, { tenantId, personId: mgr.rows[0]!.id });
    return session.id;
  });
  const ctx: ModuleRouteContext = {
    db,
    cfg: { tenantId, locationId: brandLocationId(locationId) },
    // The EXACT closure boot wires (boot.ts): the module reaches the tab verb ONLY through this seat.
    core: { openTab: (tx, req) => openTab(tx, tillCfg, req) },
  };
  return { tillCfg, ctx, managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}` };
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

describe("bookings seat route → real openTab", () => {
  it("opens a real working-order tab and seats the booking with its tab id", async () => {
    const v = await setupVenue();
    const app = mountApp(v.ctx);

    // A table to reserve, and a `booked` reservation on it (the seat reuses the booking's own table).
    const tableId = await withTenant(db, v.tillCfg.tenantId, async (tx: Transaction) => {
      await asAppUser(tx);
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

    // The booking is seated with the REAL tab id, and that id names a real OPEN working_orders row —
    // proving the real openTab (not a fake) ran through the seat.
    await withTenant(db, v.tillCfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const booking = await tx.execute<{ status: string; tab_id: string | null }>(
        sql`select status, tab_id from bookings where id = ${bookingId}`,
      );
      expect(booking.rows[0]).toEqual({ status: "seated", tab_id: tabId });
      const order = await tx.execute<{ id: string; status: string }>(
        sql`select id, status from working_orders where id = ${tabId}`,
      );
      expect(order.rows[0]).toEqual({ id: tabId, status: "open" });
    });
  });
});

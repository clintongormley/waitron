import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// PGlite exercises the overdue-orders route, permission gate, status mapping and JSON response.
// Its fixture is separate from the overview suite's current-day sales.
const noopLog: Logger = () => {};

let tillId: string;
let nodeId: string;
let locationId: string;
let managerCookie: string;
let staffCookie: string;

/**
 * Fire one line on a fresh open order and backdate queued_at by ageMinutes.
 */
async function seedFiredOrder(
  db: Database,
  opts: { orderNumber: number; ageMinutes: number; stationId: string; tableLabel?: string },
): Promise<string> {
  const catalogue = await db.execute<{ id: string }>(
    sql`insert into catalogues (name) values ('Test catalogue') returning id`,
  );
  const product = await db.execute<{ id: string }>(sql`
    insert into products (catalogue_id, name, pricing_unit, unit_price, vat_class)
    values (${catalogue.rows[0]!.id}, 'Item', 'each', '1.00', 'general')
    returning id`);
  const order = await db.execute<{ id: string }>(sql`
    insert into working_orders (till_id, node_id, order_number, status)
    values (${tillId}, ${nodeId}, ${opts.orderNumber}, 'open') returning id`);
  const orderId = order.rows[0]!.id;
  const line = await db.execute<{ id: string }>(sql`
    insert into working_order_lines (
      working_order_id, line_no, product_id, name, descriptions, quantity,
      unit_price, unit_price_gross, vat_rate, line_total
    ) values (
      ${orderId}, 1, ${product.rows[0]!.id}, 'Item', '{"es-ES":"Item"}'::jsonb, '1.000',
      '1.00', '1.00', '10.00', '1.00'
    ) returning id`);
  await db.execute(sql`
    insert into ticket_items (node_id, working_order_id, working_order_line_id, station_id, queued_at, fired_at)
    values (
      ${nodeId}, ${orderId}, ${line.rows[0]!.id}, ${opts.stationId},
      now() - (${opts.ageMinutes} * interval '1 minute'), now()
    )`);
  if (opts.tableLabel !== undefined) {
    await db.execute(sql`
      insert into dining_tables (location_id, label, tab_id)
      values (${locationId}, ${opts.tableLabel}, ${orderId})`);
  }
  return orderId;
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (name, invoice_locales, operation_description)
      values ('Sala principal', array['es-ES'], 'Venta en establecimiento') returning id`);
    locationId = loc.rows[0]!.id;
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (location_id, name)
      values (${locationId}, 'Caja 1') returning id`);
    tillId = till.rows[0]!.id;
    const node = await db.execute<{ id: string }>(sql`
      insert into nodes (location_id, name)
      values (${locationId}, 'Nodo 1') returning id`);
    nodeId = node.rows[0]!.id;
    const station = await db.execute<{ id: string }>(sql`
      insert into kitchen_stations (location_id, name, is_default)
      values (${locationId}, 'Cocina', true) returning id`);
    const stationId = station.rows[0]!.id;

    // Default thresholds (5/10/15): 20 minutes is well past forgotten.
    await seedFiredOrder(db, { orderNumber: 1, ageMinutes: 20, stationId, tableLabel: "12" });

    // A MANAGER (role `manager`, holds report.view) and a STAFF person (holds nothing), each with a
    // live management session so the route tests drive the gate through a real cookie.
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values ('The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (display_name, pin_hash, role)
        values ('The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        personId: mgr.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: stf.rows[0]!.id,
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountReportApi(app, { db: suite.db, cfg: { nodeId } }, noopLog);
  return app;
}

async function get(app: Hono, opts: { cookie?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request("/management-api/reports/overdue-orders", { method: "GET", headers });
}

interface OverdueOrdersBody {
  orders: {
    orderId: string;
    orderNumber: number;
    tableLabel: string | null;
    stationName: string;
    ageMinutes: number;
    band: string;
  }[];
}

describe("mountReportApi — /reports/overdue-orders", () => {
  it("200 returns the seeded forgotten order, with station/age/band/tableLabel", async () => {
    const res = await get(mountApp());
    expect(res.status).toBe(200);
    const body = (await res.json()) as OverdueOrdersBody;

    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({
      orderNumber: 1,
      tableLabel: "12",
      stationName: "Cocina",
      band: "forgotten",
    });
    expect(body.orders[0]!.ageMinutes).toBeGreaterThanOrEqual(20);
  });

  it("401 with no session cookie", async () => {
    const res = await get(mountApp(), { cookie: null });
    expect(res.status).toBe(401);
  });

  it("403 for a staff-role session (holds no report.view)", async () => {
    const res = await get(mountApp(), { cookie: staffCookie });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

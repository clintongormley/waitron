import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the `/reports/overdue-orders` ROUTE — the
// request/response boundary, the `report.view` gate + STATUS map, and the JSON shape wrapping
// `computeOverdueOrders` — end to end in-process, the way `report-api.overview.test.ts` proves the
// overview route. Its own file/tenant (not that suite's) so a fired KITCHEN order here never touches
// the overview suite's takings/open-tables fixtures. The differential RLS-isolation proof is the
// real-Postgres suite (report-api.rls.test.ts), which PGlite cannot show (CLAUDE.md §4).
const noopLog: Logger = () => {};

let tenantId: string;
let tillId: string;
let nodeId: string;
let locationId: string;
let managerCookie: string;
let staffCookie: string;

/** Fires one line onto a fresh OPEN working order, its `ticket_items.queued_at` backdated by
 *  `ageMinutes` — the `now() - N minutes` idiom `apps/server/src/working-order.test.ts` uses for its
 *  own band tests. Raw inserts as the connection owner (superuser bypasses RLS) — pure setup,
 *  mirroring `report-api.overview.test.ts`'s `seedDiningTables`/`seedTodaySale`. */
async function seedFiredOrder(
  db: Database,
  opts: { orderNumber: number; ageMinutes: number; stationId: string; tableLabel?: string },
): Promise<string> {
  const catalogue = await db.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Test catalogue') returning id`,
  );
  const product = await db.execute<{ id: string }>(sql`
    insert into products (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
    values (${tenantId}, ${catalogue.rows[0]!.id}, '{"es-ES":"Item"}'::jsonb, 'each', '1.00', 'general')
    returning id`);
  const order = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, node_id, order_number, status)
    values (${tenantId}, ${tillId}, ${nodeId}, ${opts.orderNumber}, 'open') returning id`);
  const orderId = order.rows[0]!.id;
  const line = await db.execute<{ id: string }>(sql`
    insert into working_order_lines (
      tenant_id, working_order_id, line_no, product_id, descriptions, quantity,
      unit_price, unit_price_gross, vat_rate, line_total
    ) values (
      ${tenantId}, ${orderId}, 1, ${product.rows[0]!.id}, '{"es-ES":"Item"}'::jsonb, '1.000',
      '1.00', '1.00', '10.00', '1.00'
    ) returning id`);
  await db.execute(sql`
    insert into ticket_items (tenant_id, node_id, working_order_id, working_order_line_id, station_id, queued_at, fired_at)
    values (
      ${tenantId}, ${nodeId}, ${orderId}, ${line.rows[0]!.id}, ${opts.stationId},
      now() - (${opts.ageMinutes} * interval '1 minute'), now()
    )`);
  if (opts.tableLabel !== undefined) {
    await db.execute(sql`
      insert into dining_tables (tenant_id, location_id, label, tab_id)
      values (${tenantId}, ${locationId}, ${opts.tableLabel}, ${orderId})`);
  }
  return orderId;
}

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Sala principal', array['es-ES'], 'Venta en establecimiento') returning id`);
    locationId = loc.rows[0]!.id;
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
    tillId = till.rows[0]!.id;
    const node = await db.execute<{ id: string }>(sql`
      insert into nodes (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Nodo 1') returning id`);
    nodeId = node.rows[0]!.id;
    const station = await db.execute<{ id: string }>(sql`
      insert into kitchen_stations (tenant_id, location_id, name, is_default)
      values (${tenantId}, ${locationId}, 'Cocina', true) returning id`);
    const stationId = station.rows[0]!.id;

    // Default thresholds (5/10/15): 20 minutes is well past forgotten.
    await seedFiredOrder(db, { orderNumber: 1, ageMinutes: 20, stationId, tableLabel: "12" });

    // A MANAGER (role `manager`, holds report.view) and a STAFF person (holds nothing), each with a
    // live management session so the route tests drive the gate through a real cookie.
    const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        tenantId,
        personId: mgr.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        tenantId,
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
  mountReportApi(app, { db: suite.db, cfg: { tenantId, nodeId } }, noopLog);
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

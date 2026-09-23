import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  catalogues,
  diningTables,
  kitchenStations,
  locations,
  nodes,
  products,
  ticketItems,
  tills,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// What this suite exercises: the overdue-orders route, permission gate, status mapping and JSON
// response.
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
  // Through the table definitions: every id here is a `$defaultFn` generator on this engine, and
  // `descriptions` is encoded by the column's own write mapping — the `::jsonb` cast it replaces is
  // a syntax error here.
  const [catalogue] = await db
    .insert(catalogues)
    .values({ name: "Test catalogue" })
    .returning({ id: catalogues.id });
  const [product] = await db
    .insert(products)
    .values({
      catalogueId: catalogue!.id,
      name: "Item",
      pricingUnit: "each",
      unitPrice: 100,
      vatClass: "general",
    })
    .returning({ id: products.id });
  const [order] = await db
    .insert(workingOrders)
    .values({ tillId, nodeId, orderNumber: opts.orderNumber, status: "open" })
    .returning({ id: workingOrders.id });
  const orderId = order!.id;
  // A quantity is a count of whole thousandths and a rate a count of whole basis points, so this
  // line is one unit at 10 per cent: a bare 1 and a bare 10 would be accepted in silence and mean a
  // thousandth of a unit at a tenth of a percent. The money columns are cents.
  const [line] = await db
    .insert(workingOrderLines)
    .values({
      workingOrderId: orderId,
      lineNo: 1,
      productId: product!.id,
      name: "Item",
      descriptions: { "es-ES": "Item" },
      quantity: 1000,
      unitPrice: 100,
      unitPriceGross: 100,
      vatRate: 1000,
      lineTotal: 100,
    })
    .returning({ id: workingOrderLines.id });
  // ONE clock reading, used twice. `now()` was PostgreSQL's transaction-start time and both stamps
  // in this statement took it, so the backdated `queued_at` was exactly `ageMinutes` before
  // `fired_at`; reading the clock once in JavaScript keeps that exact. There is no interval type
  // here, so the subtraction happens on a `Date` and the ISO string binds.
  const firedAt = new Date();
  const queuedAt = new Date(firedAt.getTime() - opts.ageMinutes * 60_000);
  await db.insert(ticketItems).values({
    nodeId,
    workingOrderId: orderId,
    workingOrderLineId: line!.id,
    stationId: opts.stationId,
    queuedAt: queuedAt.toISOString(),
    firedAt: firedAt.toISOString(),
  });
  if (opts.tableLabel !== undefined) {
    await db.insert(diningTables).values({ locationId, label: opts.tableLabel, tabId: orderId });
  }
  return orderId;
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Sala principal",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [till] = await db
      .insert(tills)
      .values({ locationId, name: "Caja 1" })
      .returning({ id: tills.id });
    tillId = till!.id;
    const [node] = await db
      .insert(nodes)
      .values({ locationId, name: "Nodo 1" })
      .returning({ id: nodes.id });
    nodeId = node!.id;
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId, name: "Cocina", isDefault: true })
      .returning({ id: kitchenStations.id });
    const stationId = station!.id;

    // Default thresholds (5/10/15): 20 minutes is well past forgotten.
    await seedFiredOrder(db, { orderNumber: 1, ageMinutes: 20, stationId, tableLabel: "12" });

    // A MANAGER (role `manager`, holds report.view) and a STAFF person (holds nothing), each with a
    // live management session so the route tests drive the gate through a real cookie.
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      const [mgr] = await tx
        .insert(persons)
        .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const [stf] = await tx
        .insert(persons)
        .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
        .returning({ id: persons.id });
      const managerSession = await startManagementSession(tx, {
        personId: mgr!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: stf!.id,
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

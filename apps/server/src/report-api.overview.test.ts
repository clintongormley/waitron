import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  diningTables,
  invoiceSeries,
  locations,
  nodes,
  nowIso,
  saleLines,
  sales,
  tenders,
  tills,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { stringToBasisPoints, stringToCents, stringToThousandths } from "@waitron/shared";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// What this suite exercises: the overview route and its value mapping from report aggregates.
// Keep current-day sales in this fixture separate from the fixed-period VAT-return fixture.
const noopLog: Logger = () => {};

let tillId: string;
let nodeId: string;
let secondNodeId: string;
let locationId: string;
let seriesId: string;
let managerCookie: string;
let staffCookie: string;

// The seeded "today" figures, chosen DISTINCT so a mis-wired field (tenderTotal↔tipTotal↔grossTotal)
// fails: grossTotal = base+tax = 121.00 (gross revenue incl. VAT), tenderTotal = 130.00, tipTotal =
// 5.00 — all different, and the tender amount is deliberately NOT the sale gross so the two don't alias.
const SEED = {
  base: "100.00",
  tax: "21.00",
  grossTotal: "121.00", // base + tax → takings.grossTotal
  tenderAmount: "130.00", // → takings.tenderTotal
  tipAmount: "5.00", // → takings.tipTotal
  lineQuantity: "2.000", // → topSellers[0].quantity
  lineTotal: "7.00", // → topSellers[0].total
  // Deliberately distinct: the STAFF name → topSellers[0].name; the customer-facing text is seeded
  // too but never read by top-sellers (a sales report shows the staff name, see
  // `docs/developers/products.md`), so a test that reads the customer text instead would fail here.
  name: "Coffee",
  descriptions: { "es-ES": "Café con leche" },
} as const;

/** Seed one sale, its tender and one sale_line on TODAY's business day. */
async function seedTodaySale(db: Database): Promise<void> {
  // The SEED constants are the amounts the response carries; each scaled column (cents,
  // thousandths, basis points) is converted on the way into the row by its own converter. ONE clock
  // reading stamps both the sale and its tender, so they share a business day.
  const stamp = nowIso();
  // Through the table definitions: every id is a `$defaultFn` generator, and the JSON and array
  // columns are encoded by their own write mappings.
  const [sale] = await db
    .insert(sales)
    .values({
      tillId,
      nodeId,
      seriesId,
      invoiceNumber: 1,
      issuedAt: stamp,
      issuedOffsetMinutes: 0,
      total: stringToCents(SEED.grossTotal),
      vatBreakdown: [{ rate: "21.00", base: SEED.base, tax: SEED.tax }],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  const saleId = sale!.id;
  await db.insert(tenders).values({
    saleId,
    method: "cash",
    amount: stringToCents(SEED.tenderAmount),
    tipAmount: stringToCents(SEED.tipAmount),
    settledAt: stamp,
  });
  await db.insert(saleLines).values({
    saleId,
    lineNo: 1,
    name: SEED.name,
    descriptions: SEED.descriptions,
    quantity: stringToThousandths(SEED.lineQuantity),
    unitPrice: stringToCents("3.50"),
    vatRate: stringToBasisPoints("21.00"),
    lineTotal: stringToCents(SEED.lineTotal),
  });
}

/**
 * One ACTIVE + OPEN table, one ACTIVE + FREE, and one INACTIVE that also carries an open tab: the
 * route's openTables must be {open:1, total:2}, because an inactive table counts in neither. The
 * open tables need real working_orders rows because `dining_tables.tab_id` is a foreign key.
 */
async function seedDiningTables(db: Database): Promise<void> {
  const [wo] = await db
    .insert(workingOrders)
    .values({ tillId, nodeId, orderNumber: 1, status: "open" })
    .returning({ id: workingOrders.id });
  const tabId = wo!.id;
  await db.insert(diningTables).values([
    { locationId, label: "Mesa 1", tabId },
    { locationId, label: "Mesa 2", tabId: null },
  ]);
  // An INACTIVE table with an open tab — must be excluded from openTables.total AND .open.
  const [inactiveWo] = await db
    .insert(workingOrders)
    .values({ tillId, nodeId, orderNumber: 2, status: "open" })
    .returning({ id: workingOrders.id });
  await db
    .insert(diningTables)
    .values({ locationId, label: "Mesa 3 (baja)", tabId: inactiveWo!.id, active: false });
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    // Default time_zone (Europe/Madrid) + day_cutover (06:00:00) — resolveVenueClock reads them back
    // and currentBusinessDay anchors the overview on the venue clock.
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
    // A SECOND node at the SAME location — no sales of its own. The venue-wide vs node-scoped test
    // below mounts report-api pointed at THIS node to prove the overview aggregates the other node's
    // sale (venue-wide) while the per-till daily-close scoped to this node stays empty.
    const [node2] = await db
      .insert(nodes)
      .values({ locationId, name: "Nodo 2" })
      .returning({ id: nodes.id });
    secondNodeId = node2!.id;
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "A" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;

    await seedTodaySale(db);
    await seedDiningTables(db);

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
      return { managerSid: managerSession.token, staffSid: staffSession.token };
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
  return app.request("/management-api/reports/overview", { method: "GET", headers });
}

interface OverviewBody {
  businessDay: string;
  takings: { tenderTotal: string; tipTotal: string; grossTotal: string };
  counts: { sales: number; corrections: number; voids: number };
  openTables: { open: number; total: number };
  topSellers: {
    name: string;
    quantity: string;
    total: string;
    variants: { name: string; quantity: string; total: string }[];
  }[];
}

describe("mountReportApi — /reports/overview", () => {
  it("200 returns the overview with the seeded takings, counts, open tables and top sellers", async () => {
    const res = await get(mountApp());
    expect(res.status).toBe(200);
    const body = (await res.json()) as OverviewBody;

    // businessDay is a "YYYY-MM-DD" venue-local date (today, via the DB clock).
    expect(body.businessDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Money crosses the wire as decimal STRINGS (the branded Decimal serialises as-is) — the three
    // distinct seeded figures land on their three distinct fields, so a swap would fail here.
    expect(body.takings).toEqual({
      tenderTotal: SEED.tenderAmount,
      tipTotal: SEED.tipAmount,
      grossTotal: SEED.grossTotal,
    });

    // One non-correcting, non-voided sale on today.
    expect(body.counts).toEqual({ sales: 1, corrections: 0, voids: 0 });

    // Two ACTIVE tables, one with an open tab; the inactive third counts in neither.
    expect(body.openTables).toEqual({ open: 1, total: 2 });

    // The single seeded line, keyed on its frozen STAFF name — never the customer-facing text.
    expect(body.topSellers).toEqual([
      {
        name: SEED.name,
        quantity: SEED.lineQuantity,
        total: SEED.lineTotal,
        variants: [],
      },
    ]);
  });

  it("overview is VENUE-WIDE (aggregates all nodes) while the per-till daily-close stays node-scoped", async () => {
    // Pointed at `secondNodeId`, a node with NO sales: the overview must still return the sale,
    // because it aggregates the whole venue rather than `cfg.nodeId`.
    const app = new Hono();
    mountReportApi(app, { db: suite.db, cfg: { nodeId: secondNodeId } }, noopLog);

    const ov = await app.request("/management-api/reports/overview", {
      method: "GET",
      headers: { cookie: managerCookie },
    });
    expect(ov.status).toBe(200);
    const ovBody = (await ov.json()) as OverviewBody;
    // Venue-wide: the sale under the OTHER node is counted here, and its takings land.
    expect(ovBody.counts).toEqual({ sales: 1, corrections: 0, voids: 0 });
    expect(ovBody.takings).toEqual({
      tenderTotal: SEED.tenderAmount,
      tipTotal: SEED.tipAmount,
      grossTotal: SEED.grossTotal,
    });

    // Contrast: the daily close for the same `cfg.nodeId` is node-scoped, so it is empty.
    const dc = await app.request(
      `/management-api/reports/daily-close?businessDay=${ovBody.businessDay}`,
      { method: "GET", headers: { cookie: managerCookie } },
    );
    expect(dc.status).toBe(200);
    const dcBody = (await dc.json()) as { counts: { sales: number; corrections: number } };
    expect(dcBody.counts.sales).toBe(0);
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

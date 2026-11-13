import { LEFT_MERGE } from "@waitron/db";
import { inArray } from "drizzle-orm";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { OFF_FLOOR } from "@waitron/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  CORE_MIGRATIONS,
  diningTables,
  tableMerges,
  floorZones,
  parties,
  partyTables,
  invoiceSeries,
  nowIso,
  saleLines,
  sales,
  tenders,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { stringToBasisPoints, stringToCents, stringToThousandths } from "@waitron/shared";
import { hashPin, startManagementSession } from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// What this suite exercises: the overview route and its value mapping from report aggregates.
// Keep current-day sales in this fixture separate from the fixed-period VAT-return fixture.
const noopLog: Logger = () => {};

let deviceId: string;
let nodeId: string;
let secondNodeId: string;
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
      source: "device",
      deviceId,
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
 * One ACTIVE table a party holds, one ACTIVE table whose party has left it, and one INACTIVE that a
 * party holds: the route's openTables must be {open:1, total:2}, because a table counts as open only
 * while a party holds it, and an inactive table counts in neither.
 */
async function seedDiningTables(db: Database): Promise<void> {
  const zone = await seedZone(db, { name: "Tables" });
  const [held, left, inactive] = await db
    .insert(diningTables)
    .values([
      { zoneId: zone!.id, label: "Table 1" },
      { zoneId: zone!.id, label: "Table 2" },
      { zoneId: zone!.id, label: "Table 3 (retired)" },
    ])
    .returning({ id: diningTables.id });
  for (const table of [held!, left!])
    await db.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, table.id));
  for (const [table, leftAt] of [
    [held!, null],
    [left!, new Date().toISOString()],
    [inactive!, null],
  ] as const) {
    const [party] = await db
      .insert(parties)
      .values({ openedBy: randomUUID() })
      .returning({ id: parties.id });
    await db.insert(partyTables).values({ partyId: party!.id, tableId: table.id, leftAt });
  }
}

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    // Default time_zone (Europe/Madrid) + day_cutover (06:00:00) — resolveVenueClock reads them back
    // and currentBusinessDay anchors the overview on the venue clock.
    await seedVenue(db, {
      name: "Main dining room",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    });
    ({ deviceId } = await seedDevice(db));
    nodeId = await seedNode(db);
    // A SECOND node at the SAME location — no sales of its own. The venue-wide vs node-scoped test
    // below mounts report-api pointed at THIS node to prove the overview aggregates the other node's
    // sale (venue-wide) while the daily close scoped to this node stays empty.
    secondNodeId = await seedNode(db);
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "A" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;

    await seedTodaySale(db);
    await seedDiningTables(db);

    // A MANAGER (role `manager`, holds report.view) and a STAFF person (holds no report.view), each
    // with a live management session so the route tests drive the gate through a real cookie.
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      const [mgr] = await seedPersons(tx, {
        displayName: "The Manager",
        pinHash: hashPin("1234"),
        role: "manager",
      });
      const [stf] = await seedPersons(tx, {
        displayName: "The Clerk",
        pinHash: hashPin("1234"),
        role: "staff",
      });
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
  mountReportApi(app, { db: suite.db, cfg: { nodeId }, venueLocale: "es-ES" }, noopLog);
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
  it("counts only tables on today's plan in enabled zones", async () => {
    const zone = await seedZone(suite.db, { name: "Closed", active: false });
    const [absent, closed] = await suite.db
      .insert(diningTables)
      .values([
        { zoneId: zone!.id, label: "Not on today" },
        { zoneId: zone!.id, label: "Closed today" },
      ])
      .returning();
    await suite.db
      .update(diningTables)
      .set({ onFloor: true })
      .where(eq(diningTables.id, closed!.id));
    onTestFinished(async () => {
      await suite.db.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, closed!.id));
      await suite.db.delete(diningTables).where(eq(diningTables.id, closed!.id));
      await suite.db.delete(diningTables).where(eq(diningTables.id, absent!.id));
      await suite.db.delete(floorZones).where(eq(floorZones.id, zone!.id));
    });
    const response = await get(mountApp());
    expect(response.status).toBe(200);
    expect(((await response.json()) as OverviewBody).openTables).toEqual({ open: 1, total: 2 });
  });

  it("counts a group's real tables under their own ids", async () => {
    const zone = await seedZone(suite.db, { name: "Counter" });
    const tables = await suite.db
      .insert(diningTables)
      .values(
        [3, 4, 5].map((n) => ({
          zoneId: zone!.id,
          label: `Counter ${n}`,
        })),
      )
      .returning();
    for (const table of tables)
      await suite.db
        .update(diningTables)
        .set({ onFloor: true })
        .where(eq(diningTables.id, table.id));
    const [group] = await suite.db
      .insert(tableMerges)
      .values({ zoneId: zone!.id, name: "Long table", seats: 10 })
      .returning();
    await suite.db
      .update(diningTables)
      .set({ mergeId: group!.id, mergeBeforeX: 0, mergeBeforeY: 0, mergeBeforeRotation: 0 })
      .where(
        inArray(
          diningTables.id,
          tables.map((t) => t.id),
        ),
      );
    onTestFinished(async () => {
      await suite.db
        .update(diningTables)
        .set(LEFT_MERGE)
        .where(eq(diningTables.mergeId, group!.id));
      await suite.db.delete(tableMerges).where(eq(tableMerges.id, group!.id));
      for (const t of tables) {
        await suite.db.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, t.id));
        await suite.db.delete(diningTables).where(eq(diningTables.id, t.id));
      }
      await suite.db.delete(floorZones).where(eq(floorZones.id, zone!.id));
    });
    const response = await get(mountApp());
    expect(response.status).toBe(200);
    expect(((await response.json()) as OverviewBody).openTables).toEqual({ open: 1, total: 5 });
  });

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
    expect((body as unknown as { departmentTakings: unknown }).departmentTakings).toEqual([
      {
        departmentId: null,
        departmentName: null,
        active: null,
        byMethod: [{ method: "cash", amount: "130.00", tip: "5.00" }],
        billsClosed: { count: 0, total: "0.00" },
      },
    ]);

    // Two ACTIVE tables, one held by a party and one its party has left; the inactive third counts
    // in neither.
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

  it("overview is VENUE-WIDE (aggregates all nodes) while the daily close stays node-scoped", async () => {
    // Pointed at `secondNodeId`, a node with NO sales: the overview must still return the sale,
    // because it aggregates the whole venue rather than `cfg.nodeId`.
    const app = new Hono();
    mountReportApi(
      app,
      { db: suite.db, cfg: { nodeId: secondNodeId }, venueLocale: "es-ES" },
      noopLog,
    );

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

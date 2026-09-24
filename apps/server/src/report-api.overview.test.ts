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
  // too but never read by top-sellers (a sales report shows the staff name, CLAUDE.md's three-name
  // table), so a test that reads the customer text instead would fail here.
  name: "Coffee",
  descriptions: { "es-ES": "Café con leche" },
} as const;

/** Seed one sale + its tender + one sale_line ON TODAY's business day (issued/settled at `now()`, so
 * the venue-clock business day the route computes from `now()` always contains them — the insert and
 * the read share the DB clock). Superuser insert (fixture setup). */
async function seedTodaySale(db: Database): Promise<void> {
  // The SEED constants above are the AMOUNTS the route's response carries, and the assertions read
  // them unchanged. `sales.total`, `tenders.amount`, `tenders.tip_amount`, `sale_lines.unit_price`
  // and `sale_lines.line_total` all store a count of whole cents, so each is converted here, on the
  // way into the row. `vat_breakdown` is jsonb, not a scaled-integer column, and keeps its decimal
  // literals; `sale_lines.quantity` and `sale_lines.vat_rate` are whole numbers at their OWN
  // scales — thousandths and basis points — so each is converted by its own function.
  // ONE clock reading, bound to BOTH stamps. `now()` has no equivalent here, and the two statements
  // were separate `execute` calls, so PostgreSQL gave each its own transaction-start time; a single
  // `nowIso()` keeps the sale and its tender on the same business day, which is what the fixture
  // needs. `issued_at`/`settled_at` are text columns and this is their canonical spelling.
  const stamp = nowIso();
  // Through the table definitions: every id is a `$defaultFn` generator here, `vat_breakdown`,
  // `descriptions` and `invoice_locales` are encoded by their own write mappings (the `::jsonb`
  // casts and the `array[...]` constructor they replace are both refused by this engine), and every
  // scaled-integer value above is still converted by the same function it was.
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

/** Seed dining tables at the node's location: one ACTIVE + OPEN (tab_id → a working order), one ACTIVE
 * + FREE (tab_id null), and one INACTIVE (active = false) that ALSO carries an open tab → the route's
 * openTables must be {open:1, total:2} because `countOpenTables`'s `and dt.active = true` predicate
 * excludes the inactive table from BOTH the total and the open count. The open tables need real
 * working_orders rows because dining_tables.tab_id carries a FK (0046_tab_link_fks).
 *
 * Proven by deletion: removing `and dt.active = true` from `countOpenTables` makes the inactive table
 * count, so openTables becomes {open:2, total:3} and the route test's {open:1, total:2} assertion
 * fails on both fields; restore it and the test passes. */
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

    // Two ACTIVE tables at the node's location, one with an open tab. The third seeded table is
    // inactive (active = false) with an open tab and is excluded from BOTH counts — dropping
    // `countOpenTables`'s `and dt.active = true` predicate would make this {open:2, total:3}.
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
    // Mount report-api pointed at `secondNodeId` — a node with NO sales — rather than the seeded sale's
    // node. The overview must STILL return the sale: it ignores `cfg.nodeId` for its money/counts/
    // top-sellers and aggregates the WHOLE venue (membership promotion R3a Part C). The mismatched node
    // here isolates that venue-wide behaviour by construction — it is a STRONGER control than the real
    // mirror case, where `cfg.nodeId` is the origin (the primary's node) and so MATCHES the node the
    // venue's sales carry; if the overview still resolves the sale under a node it is NOT pointed at,
    // it resolves it on a mirror too.
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

    // Contrast: the daily-close for that SAME `cfg.nodeId` (the "data node id", Part B) is NODE-scoped,
    // so a node with no sales returns an empty close — proving the overview's inclusion above is
    // venue-wide, not a coincidence of node scoping. Proven by deletion: make the overview pass
    // `nodeId` again and this test's `counts.sales` drops to 0 (the sale is under the other node).
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

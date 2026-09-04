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

// PGlite, not real Postgres: this suite proves the `/reports/overview` ROUTE — its request/response
// boundary, the `report.view` gate + STATUS map, and the value mapping from `computeDailyClose` /
// `computeTopSellers` / the open-tables count onto the overview JSON — end to end in-process, the way
// `report-api.test.ts` proves the modelo 303 export route. Its own file (not that suite's) because the
// overview anchors on TODAY's business day (`currentBusinessDay`), and today's date falls inside the
// modelo 303 suite's August 2026 período — a today-sale seeded into that suite's tenant would corrupt
// its box-27 fixtures. A fresh tenant here keeps the two independent. The differential RLS-isolation +
// the app-role-can-SELECT-dining_tables proofs are the real-Postgres suite (report-api.rls.test.ts),
// which PGlite cannot show because every PGlite connection is a superuser that bypasses grants + FORCE
// RLS (CLAUDE.md §4).
const noopLog: Logger = () => {};

let tenantId: string;
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
  descriptions: { "es-ES": "Café con leche" }, // → topSellers[0].descriptions
} as const;

/** Seed one sale + its tender + one sale_line ON TODAY's business day (issued/settled at `now()`, so
 * the venue-clock business day the route computes from `now()` always contains them — the insert and
 * the read share the DB clock). Superuser insert (RLS bypassed — pure setup). */
async function seedTodaySale(db: Database): Promise<void> {
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (
      tenant_id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes,
      total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${tenantId}, ${tillId}, ${nodeId}, ${seriesId}, 1, now(), 0,
      '121.00', ${JSON.stringify([{ rate: "21.00", base: SEED.base, tax: SEED.tax }])}::jsonb,
      'es-ES', array['es-ES'], 'fake', 'recorded'
    ) returning id`);
  const saleId = sale.rows[0]!.id;
  await db.execute(sql`
    insert into tenders (tenant_id, sale_id, method, amount, tip_amount, settled_at)
    values (${tenantId}, ${saleId}, 'cash', ${SEED.tenderAmount}, ${SEED.tipAmount}, now())`);
  await db.execute(sql`
    insert into sale_lines (tenant_id, sale_id, line_no, descriptions, quantity, unit_price, vat_rate, line_total)
    values (${tenantId}, ${saleId}, 1, ${JSON.stringify(SEED.descriptions)}::jsonb,
            ${SEED.lineQuantity}, '3.50', '21.00', ${SEED.lineTotal})`);
}

/** Seed dining tables at the node's location: one ACTIVE + OPEN (tab_id → a working order), one ACTIVE
 * + FREE (tab_id null), and one INACTIVE (active = false) that ALSO carries an open tab → the route's
 * openTables must be {open:1, total:2} because `countOpenTables`'s `and dt.active = true` predicate
 * excludes the inactive table from BOTH the total and the open count. The open tables need real
 * working_orders rows because dining_tables.tab_id carries a composite FK (0046_tab_link_fks).
 *
 * Proven by deletion: removing `and dt.active = true` from `countOpenTables` makes the inactive table
 * count, so openTables becomes {open:2, total:3} and the route test's {open:1, total:2} assertion
 * fails on both fields; restore it and the test passes. */
async function seedDiningTables(db: Database): Promise<void> {
  const wo = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, node_id, order_number, status)
    values (${tenantId}, ${tillId}, ${nodeId}, 1, 'open') returning id`);
  const tabId = wo.rows[0]!.id;
  await db.execute(sql`
    insert into dining_tables (tenant_id, location_id, label, tab_id)
    values (${tenantId}, ${locationId}, 'Mesa 1', ${tabId})`);
  await db.execute(sql`
    insert into dining_tables (tenant_id, location_id, label, tab_id)
    values (${tenantId}, ${locationId}, 'Mesa 2', null)`);
  // An INACTIVE table with an open tab — must be excluded from openTables.total AND .open.
  const inactiveWo = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, node_id, order_number, status)
    values (${tenantId}, ${tillId}, ${nodeId}, 2, 'open') returning id`);
  await db.execute(sql`
    insert into dining_tables (tenant_id, location_id, label, tab_id, active)
    values (${tenantId}, ${locationId}, 'Mesa 3 (baja)', ${inactiveWo.rows[0]!.id}, false)`);
}

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    // Default time_zone (Europe/Madrid) + day_cutover (06:00:00) — resolveVenueClock reads them back
    // and currentBusinessDay anchors the overview on the venue clock.
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
    // A SECOND node at the SAME location — no sales of its own. The venue-wide vs node-scoped test
    // below mounts report-api pointed at THIS node to prove the overview aggregates the other node's
    // sale (venue-wide) while the per-till daily-close scoped to this node stays empty.
    const node2 = await db.execute<{ id: string }>(sql`
      insert into nodes (tenant_id, location_id, name)
      values (${tenantId}, ${locationId}, 'Nodo 2') returning id`);
    secondNodeId = node2.rows[0]!.id;
    const series = await db.execute<{ id: string }>(sql`
      insert into invoice_series (tenant_id, node_id, code)
      values (${tenantId}, ${nodeId}, 'A') returning id`);
    seriesId = series.rows[0]!.id;

    await seedTodaySale(db);
    await seedDiningTables(db);

    // A MANAGER (role `manager`, holds report.view) and a STAFF person (holds nothing) as the app
    // role, each with a live management session so the route tests drive the gate through a real cookie.
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
  return app.request("/management-api/reports/overview", { method: "GET", headers });
}

interface OverviewBody {
  businessDay: string;
  takings: { tenderTotal: string; tipTotal: string; grossTotal: string };
  counts: { sales: number; corrections: number; voids: number };
  openTables: { open: number; total: number };
  topSellers: { descriptions: Record<string, string>; quantity: string; total: string }[];
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

    // The single seeded line, keyed on its frozen descriptions snapshot.
    expect(body.topSellers).toEqual([
      {
        descriptions: SEED.descriptions,
        quantity: SEED.lineQuantity,
        total: SEED.lineTotal,
      },
    ]);
  });

  it("overview is VENUE-WIDE (aggregates all nodes) while the per-till daily-close stays node-scoped", async () => {
    // Mount report-api pointed at `secondNodeId` — a node with NO sales — rather than the seeded sale's
    // node. The overview must STILL return the sale: it ignores `cfg.nodeId` for its money/counts/
    // top-sellers and aggregates the WHOLE venue (membership promotion R3a Part C). This is exactly the
    // mirror case, where `cfg.nodeId` (the data node id) differs from the replicated sale's node.
    const app = new Hono();
    mountReportApi(app, { db: suite.db, cfg: { tenantId, nodeId: secondNodeId } }, noopLog);

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

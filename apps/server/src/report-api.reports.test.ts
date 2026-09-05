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

// PGlite, not real Postgres: this suite proves the `/reports/daily-close` and `/reports/period` ROUTES
// — their request/response boundary, the `businessDay`/`from`/`to` screens (missing/malformed → 400),
// the `report.view` gate + STATUS map, and the value mapping from `computeDailyClose` /
// `computeVatSummaryForPeriod` / `computeTopSellers` onto the JSON — end to end in-process, the way
// `report-api.overview.test.ts` proves the overview route. Unlike the overview (which anchors on
// TODAY), these routes take an explicit day/range, so the fixtures seed sales on FIXED historical
// business days and query them by date — no dependence on the wall clock. The differential
// RLS-isolation proof is the real-Postgres suite (report-api.pg.test.ts), which PGlite cannot show
// because every PGlite connection is a superuser that bypasses grants + FORCE RLS (CLAUDE.md §4).
const noopLog: Logger = () => {};

let tenantId: string;
let tillId: string;
let nodeId: string;
let locationId: string;
let seriesId: string;
let managerCookie: string;
let supervisorCookie: string;
let staffCookie: string;

// Two FIXED business days of trade, seeded at midday UTC (≈14:00 Europe/Madrid CEST, well clear of the
// 06:00 venue cutover, so the business day equals the calendar date). Figures are DISTINCT per day and
// per rate so a mis-wired aggregation fails: DAY1 = 21% base 100 tax 21; DAY2 = 10% base 50 tax 5.
const DAY1 = "2026-06-10";
const DAY2 = "2026-06-11";
const SEED = {
  day1: {
    issuedAt: "2026-06-10T12:00:00Z",
    rate: "21.00",
    base: "100.00",
    tax: "21.00",
    total: "121.00",
    tenderAmount: "121.00",
    tipAmount: "3.00",
    line: { descriptions: { "es-ES": "Tortilla" }, quantity: "2.000", total: "10.00" },
  },
  day2: {
    issuedAt: "2026-06-11T12:00:00Z",
    rate: "10.00",
    base: "50.00",
    tax: "5.00",
    total: "55.00",
    tenderAmount: "55.00",
    tipAmount: "1.00",
    line: { descriptions: { "es-ES": "Agua" }, quantity: "1.000", total: "2.00" },
  },
} as const;

interface DaySeed {
  issuedAt: string;
  rate: string;
  base: string;
  tax: string;
  total: string;
  tenderAmount: string;
  tipAmount: string;
  line: { descriptions: Record<string, string>; quantity: string; total: string };
}

/** Seed one sale + its tender + one sale_line on a FIXED business day (issued/settled at a literal
 * midday-UTC instant). Superuser insert (RLS bypassed — pure setup, the demo idiom). */
async function seedDay(db: Database, invoiceNumber: number, d: DaySeed): Promise<void> {
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (
      tenant_id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes,
      total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${tenantId}, ${tillId}, ${nodeId}, ${seriesId}, ${invoiceNumber}, ${d.issuedAt}, 0,
      ${d.total}, ${JSON.stringify([{ rate: d.rate, base: d.base, tax: d.tax }])}::jsonb,
      'es-ES', array['es-ES'], 'fake', 'recorded'
    ) returning id`);
  const saleId = sale.rows[0]!.id;
  await db.execute(sql`
    insert into tenders (tenant_id, sale_id, method, amount, tip_amount, settled_at)
    values (${tenantId}, ${saleId}, 'cash', ${d.tenderAmount}, ${d.tipAmount}, ${d.issuedAt})`);
  await db.execute(sql`
    insert into sale_lines (tenant_id, sale_id, line_no, descriptions, quantity, unit_price, vat_rate, line_total)
    values (${tenantId}, ${saleId}, 1, ${JSON.stringify(d.line.descriptions)}::jsonb,
            ${d.line.quantity}, '3.50', ${d.rate}, ${d.line.total})`);
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
    const series = await db.execute<{ id: string }>(sql`
      insert into invoice_series (tenant_id, node_id, code)
      values (${tenantId}, ${nodeId}, 'A') returning id`);
    seriesId = series.rows[0]!.id;

    await seedDay(db, 1, SEED.day1);
    await seedDay(db, 2, SEED.day2);

    // A MANAGER (holds report.view AND report.export), a SUPERVISOR (holds report.view but NOT
    // report.export) and a STAFF person (holds neither) as the app role, each with a live management
    // session. The supervisor is what pins the routes to report.view specifically: a supervisor 200
    // proves they gate on report.view, not report.export (which the supervisor lacks).
    const sids = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mkPerson = async (name: string, role: string): Promise<string> => {
        const p = await tx.execute<{ id: string }>(sql`
          insert into persons (tenant_id, display_name, pin_hash, role)
          values (current_tenant_id(), ${name}, ${hashPin("1234")}, ${role}) returning id`);
        const session = await startManagementSession(tx, { tenantId, personId: p.rows[0]!.id });
        return session.id;
      };
      return {
        managerSid: await mkPerson("The Manager", "manager"),
        supervisorSid: await mkPerson("The Supervisor", "supervisor"),
        staffSid: await mkPerson("The Clerk", "staff"),
      };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${sids.managerSid}`;
    supervisorCookie = `${MANAGEMENT_COOKIE}=${sids.supervisorSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${sids.staffSid}`;
  },
});

function mountApp(): Hono {
  const app = new Hono();
  mountReportApi(app, { db: suite.db, cfg: { tenantId, nodeId } }, noopLog);
  return app;
}

/** GET helper with the manager cookie unless overridden (`cookie: null` sends none). */
async function get(
  app: Hono,
  path: string,
  opts: { cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request(path, { method: "GET", headers });
}

interface VatSummaryBody {
  byRate: { rate: string; base: string; tax: string }[];
  baseTotal: string;
  taxTotal: string;
  grossTotal: string;
}
interface DailyCloseBody {
  businessDay: string;
  vat: VatSummaryBody;
  cash: { byTill: { tillId: string }[]; tenderTotal: string; tipTotal: string };
  counts: { sales: number; corrections: number; voids: number };
  topSellers: { descriptions: Record<string, string>; quantity: string; total: string }[];
}
interface PeriodBody {
  from: string;
  to: string;
  vat: VatSummaryBody;
  topSellers: { descriptions: Record<string, string>; quantity: string; total: string }[];
}

describe("mountReportApi — /reports/daily-close", () => {
  it("200 returns the close (vat.byRate, cash.byTill, counts, topSellers) for the seeded day", async () => {
    const res = await get(mountApp(), `/management-api/reports/daily-close?businessDay=${DAY1}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DailyCloseBody;

    expect(body.businessDay).toBe(DAY1);
    // Only DAY1's 21% sale — DAY2 (10%) must not leak in.
    expect(body.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
    expect(body.vat.grossTotal).toBe("121.00");
    // One cash till, with the day's tender + tip totals (money as decimal STRINGS).
    expect(body.cash.byTill).toHaveLength(1);
    expect(body.cash.byTill[0]!.tillId).toBe(tillId);
    expect(body.cash.tenderTotal).toBe("121.00");
    expect(body.cash.tipTotal).toBe("3.00");
    // One ordinary sale on the day.
    expect(body.counts).toEqual({ sales: 1, corrections: 0, voids: 0 });
    // The single seeded line, keyed on its frozen descriptions snapshot.
    expect(body.topSellers).toEqual([
      { descriptions: SEED.day1.line.descriptions, quantity: "2.000", total: "10.00" },
    ]);
  });

  it("400 management.request_invalid on a missing businessDay", async () => {
    const res = await get(mountApp(), "/management-api/reports/daily-close");
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "businessDay" } },
    });
  });

  it("400 management.request_invalid on a malformed businessDay (not a real calendar date)", async () => {
    const res = await get(mountApp(), "/management-api/reports/daily-close?businessDay=2026-02-30");
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "businessDay" } },
    });
  });

  it("403 for a staff-role session (holds no report.view)", async () => {
    const res = await get(mountApp(), `/management-api/reports/daily-close?businessDay=${DAY1}`, {
      cookie: staffCookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });

  it("200 for a SUPERVISOR session — proving the route gates on report.view, not report.export", async () => {
    const res = await get(mountApp(), `/management-api/reports/daily-close?businessDay=${DAY1}`, {
      cookie: supervisorCookie,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DailyCloseBody;
    expect(body.businessDay).toBe(DAY1);
  });
});

describe("mountReportApi — /reports/period", () => {
  it("200 returns the range VAT summary + top sellers over from..to", async () => {
    const res = await get(mountApp(), `/management-api/reports/period?from=${DAY1}&to=${DAY2}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PeriodBody;

    expect(body.from).toBe(DAY1);
    expect(body.to).toBe(DAY2);
    // Both days aggregate: 10% (base 50 tax 5) sorted before 21% (base 100 tax 21).
    expect(body.vat.byRate).toEqual([
      { rate: "10.00", base: "50.00", tax: "5.00" },
      { rate: "21.00", base: "100.00", tax: "21.00" },
    ]);
    expect(body.vat.baseTotal).toBe("150.00");
    expect(body.vat.taxTotal).toBe("26.00");
    expect(body.vat.grossTotal).toBe("176.00");
    // Both lines, ranked by quantity desc: Tortilla (2.000) before Agua (1.000).
    expect(body.topSellers).toEqual([
      { descriptions: SEED.day1.line.descriptions, quantity: "2.000", total: "10.00" },
      { descriptions: SEED.day2.line.descriptions, quantity: "1.000", total: "2.00" },
    ]);
  });

  it("200 restricts to a single day when from == to", async () => {
    const res = await get(mountApp(), `/management-api/reports/period?from=${DAY2}&to=${DAY2}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PeriodBody;
    expect(body.vat.byRate).toEqual([{ rate: "10.00", base: "50.00", tax: "5.00" }]);
    expect(body.topSellers).toEqual([
      { descriptions: SEED.day2.line.descriptions, quantity: "1.000", total: "2.00" },
    ]);
  });

  it.each([
    ["missing from", `?to=${DAY2}`, "from"],
    ["missing to", `?from=${DAY1}`, "to"],
    ["missing both", "", "from"],
    ["malformed from", `?from=not-a-date&to=${DAY2}`, "from"],
    ["malformed to", `?from=${DAY1}&to=2026-13-01`, "to"],
  ])("400 management.request_invalid: %s", async (_label, qs, field) => {
    const res = await get(mountApp(), `/management-api/reports/period${qs}`);
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  it("400 management.request_invalid on from > to (inverted range)", async () => {
    const res = await get(mountApp(), `/management-api/reports/period?from=${DAY2}&to=${DAY1}`);
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "range" } },
    });
  });

  it("403 for a staff-role session (holds no report.view)", async () => {
    const res = await get(mountApp(), `/management-api/reports/period?from=${DAY1}&to=${DAY2}`, {
      cookie: staffCookie,
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

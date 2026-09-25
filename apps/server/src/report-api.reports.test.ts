import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  nodes,
  saleLines,
  sales,
  tenders,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { stringToBasisPoints, stringToCents, stringToThousandths } from "@waitron/shared";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  personRole,
  persons,
  startManagementSession,
} from "@waitron/identity";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// The `/reports/daily-close` and `/reports/period` routes end to end: the date screens, the
// `report.view` gate and the mapping onto the JSON. They take an explicit day or range, so the
// fixtures seed FIXED historical business days and nothing depends on the wall clock.
const noopLog: Logger = () => {};

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
// A third day whose only sale is two variants of one product, queried on its own so the DAY1/DAY2
// figures above are untouched.
const DAY3 = "2026-06-12";
const SEED = {
  day1: {
    issuedAt: "2026-06-10T12:00:00Z",
    rate: "21.00",
    base: "100.00",
    tax: "21.00",
    total: "121.00",
    tenderAmount: "121.00",
    tipAmount: "3.00",
    // `name` (staff) and `descriptions` (customer text) are deliberately distinct — a sales report
    // shows the staff name (see `docs/developers/products.md`), so a test reading the customer
    // text instead of the staff name would fail here.
    line: {
      name: "Tortilla",
      descriptions: { "es-ES": "Tortilla francesa" },
      quantity: "2.000",
      total: "10.00",
    },
  },
  day2: {
    issuedAt: "2026-06-11T12:00:00Z",
    rate: "10.00",
    base: "50.00",
    tax: "5.00",
    total: "55.00",
    tenderAmount: "55.00",
    tipAmount: "1.00",
    line: {
      name: "Agua",
      descriptions: { "es-ES": "Agua mineral" },
      quantity: "1.000",
      total: "2.00",
    },
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
  line: { name: string; descriptions: Record<string, string>; quantity: string; total: string };
}

/** Seed one sale + its tender + one sale_line on a FIXED business day (issued/settled at a literal
 * midday-UTC instant). */
async function seedDay(db: Database, invoiceNumber: number, d: DaySeed): Promise<void> {
  // The DaySeed figures are the amounts the response carries; each scaled column (cents,
  // thousandths, basis points) is converted on the way into the row by its own converter. Through
  // the table definitions: every id is a `$defaultFn` generator, and the JSON and array columns are
  // encoded by their own write mappings.
  const [sale] = await db
    .insert(sales)
    .values({
      tillId,
      nodeId,
      seriesId,
      invoiceNumber,
      issuedAt: d.issuedAt,
      issuedOffsetMinutes: 0,
      total: stringToCents(d.total),
      vatBreakdown: [{ rate: d.rate, base: d.base, tax: d.tax }],
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
    amount: stringToCents(d.tenderAmount),
    tipAmount: stringToCents(d.tipAmount),
    settledAt: d.issuedAt,
  });
  await db.insert(saleLines).values({
    saleId,
    lineNo: 1,
    name: d.line.name,
    descriptions: d.line.descriptions,
    quantity: stringToThousandths(d.line.quantity),
    unitPrice: stringToCents("3.50"),
    vatRate: stringToBasisPoints(d.rate),
    lineTotal: stringToCents(d.line.total),
  });
}

/** Seed DAY3's sale: "Wine by the glass" sold as two variants, each line freezing the parent's three
 * names beside the variant's own three, all six different. */
async function seedVariantDay(db: Database, invoiceNumber: number): Promise<void> {
  const [sale] = await db
    .insert(sales)
    .values({
      tillId,
      nodeId,
      seriesId,
      invoiceNumber,
      issuedAt: "2026-06-12T12:00:00Z",
      issuedOffsetMinutes: 0,
      total: stringToCents("26.95"),
      vatBreakdown: [{ rate: "10.00", base: "24.50", tax: "2.45" }],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  const parent = {
    name: "Wine by the glass",
    descriptions: { "es-ES": "Vino por copas" },
    kitchenName: "VINO",
  };
  await db.insert(saleLines).values([
    {
      saleId: sale!.id,
      lineNo: 1,
      ...parent,
      variantName: "Wine 125",
      variantDescriptions: { "es-ES": "Copa pequeña" },
      variantKitchenName: "V125",
      quantity: stringToThousandths("2.000"),
      unitPrice: stringToCents("4.00"),
      vatRate: stringToBasisPoints("10.00"),
      lineTotal: stringToCents("8.00"),
    },
    {
      saleId: sale!.id,
      lineNo: 2,
      ...parent,
      variantName: "Wine 175",
      variantDescriptions: { "es-ES": "Copa grande" },
      variantKitchenName: "V175",
      quantity: stringToThousandths("3.000"),
      unitPrice: stringToCents("5.50"),
      vatRate: stringToBasisPoints("10.00"),
      lineTotal: stringToCents("16.50"),
    },
  ]);
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
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "A" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;

    await seedDay(db, 1, SEED.day1);
    await seedDay(db, 2, SEED.day2);
    await seedVariantDay(db, 3);

    // A MANAGER (holds report.view AND report.export), a SUPERVISOR (holds report.view but NOT
    // report.export) and a STAFF person (holds neither), each with a live management session. The
    // supervisor is what pins the routes to report.view specifically: a supervisor 200 proves they
    // gate on report.view, not report.export (which the supervisor lacks).
    const sids = await withTransaction(db, async (tx) => {
      const mkPerson = async (
        name: string,
        role: (typeof personRole.enumValues)[number],
      ): Promise<string> => {
        const [p] = await tx
          .insert(persons)
          .values({ displayName: name, pinHash: hashPin("1234"), role })
          .returning({ id: persons.id });
        const session = await startManagementSession(tx, { personId: p!.id });
        return session.token;
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
  mountReportApi(app, { db: suite.db, cfg: { nodeId } }, noopLog);
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
interface TopSellerBody {
  name: string;
  quantity: string;
  total: string;
  variants: { name: string; quantity: string; total: string }[];
}
interface DailyCloseBody {
  businessDay: string;
  vat: VatSummaryBody;
  cash: { byTill: { tillId: string }[]; tenderTotal: string; tipTotal: string };
  counts: { sales: number; corrections: number; voids: number };
  topSellers: TopSellerBody[];
}
interface PeriodBody {
  from: string;
  to: string;
  vat: VatSummaryBody;
  topSellers: TopSellerBody[];
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
    // The single seeded line, keyed on its frozen STAFF name — never the customer-facing text.
    expect(body.topSellers).toEqual([
      { name: SEED.day1.line.name, quantity: "2.000", total: "10.00", variants: [] },
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
      { name: SEED.day1.line.name, quantity: "2.000", total: "10.00", variants: [] },
      { name: SEED.day2.line.name, quantity: "1.000", total: "2.00", variants: [] },
    ]);
  });

  it("200 restricts to a single day when from == to", async () => {
    const res = await get(mountApp(), `/management-api/reports/period?from=${DAY2}&to=${DAY2}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PeriodBody;
    expect(body.vat.byRate).toEqual([{ rate: "10.00", base: "50.00", tax: "5.00" }]);
    expect(body.topSellers).toEqual([
      { name: SEED.day2.line.name, quantity: "1.000", total: "2.00", variants: [] },
    ]);
  });

  it("200 carries a product's variants nested under it, with every amount a decimal string", async () => {
    const res = await get(mountApp(), `/management-api/reports/period?from=${DAY3}&to=${DAY3}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PeriodBody;
    // The parent's STAFF name and its roll-up, then each variant's own staff name — never the
    // customer text or a kitchen name.
    expect(body.topSellers).toEqual([
      {
        name: "Wine by the glass",
        quantity: "5.000",
        total: "24.50",
        variants: [
          { name: "Wine 175", quantity: "3.000", total: "16.50" },
          { name: "Wine 125", quantity: "2.000", total: "8.00" },
        ],
      },
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

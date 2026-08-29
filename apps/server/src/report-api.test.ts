import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  purchaseInvoiceVat,
  purchaseInvoices,
  sales,
  withTenant,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { addDecimal, decimal } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { BOX_27, packAeatNumeric } from "./testing/dr303.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the modelo 303 export ROUTE — the request/response
// boundary, the year/period/declarationType screens, the permission gate and STATUS map, and the
// ISO-8859-1 fixed-layout body — end to end in-process, the same way `purchasing-api.test.ts` proves
// the purchase-invoice routes. It seeds sales + received invoices DIRECTLY as the PGlite superuser
// (RLS bypassed — pure setup, the `modelo-303-demo.ts` seed idiom), never through the fiscal write
// path: the route (and `computeVatReturn` beneath it) only READS the filed `sales.vat_breakdown` and
// the purchase tables. The differential RLS-isolation proof and the gate-by-DELETION proof are the
// real-Postgres suite (Task 2d), which PGlite cannot show because it connects as a superuser that
// bypasses FORCE RLS (CLAUDE.md §4).
const noopLog: Logger = () => {};

let tenantId: string;
let tillId: string;
let nodeId: string;
let seriesId: string;
let managerCookie: string;
let staffCookie: string;

// The seeded August 2026 devengado (output VAT), issued at midday with the snapshot offset 0 — so the
// filed *fecha de expedición* (the civil-local date via that offset) is the UTC calendar date, and
// each sale lands in August. Box 27 ("Total cuota devengada") is Σ of these cuotas, DERIVED from this
// same array below (never a hardcoded packed string), so a formatter bug cannot self-mask.
const AUGUST_SALES = [
  {
    invoiceNumber: 1,
    issuedAt: "2026-08-10T12:00:00Z",
    rate: "21.00",
    base: "200.00",
    tax: "42.00",
  },
  {
    invoiceNumber: 2,
    issuedAt: "2026-08-15T12:00:00Z",
    rate: "10.00",
    base: "210.00",
    tax: "21.00",
  },
] as const;
// A Q1 (February) sale, so the quarterly período (1T) carries real trade rather than a nil return.
const Q1_SALE = {
  invoiceNumber: 3,
  issuedAt: "2026-02-15T12:00:00Z",
  rate: "21.00",
  base: "100.00",
  tax: "21.00",
} as const;

type SeededSale = (typeof AUGUST_SALES)[number];

// Box 27 = Σ cuota devengada for the seeded month (mapModelo303 sets box 27 = vatReturn.taxTotal).
// Summed with addDecimal (exact), then packed — 42.00 + 21.00 = 63.00 → "00000000000006300".
const expectedBox27 = packAeatNumeric(
  AUGUST_SALES.reduce((acc, s) => addDecimal(acc, decimal(s.tax)), decimal("0.00")),
  BOX_27.len,
);

// Q1's box 27 = Σ cuota devengada over the Q1 seed — only Q1_SALE (February) falls in the quarter, so
// 21.00 → "00000000000002100". Derived with addDecimal + the shared packer (never hardcoded), and it
// is DISTINCT from August's 63.00 and the whole-year 84.00, so a route that aggregated the wrong
// período would fail this assertion.
const expectedBox27Q1 = packAeatNumeric(
  addDecimal(decimal("0.00"), decimal(Q1_SALE.tax)),
  BOX_27.len,
);

/** Seeds one sale directly (superuser bypasses RLS — pure setup), with a single-rate filed desglose on
 * `sales.vat_breakdown` — the only column the reporting aggregate reads. */
async function seedSale(db: Database, s: SeededSale | typeof Q1_SALE): Promise<void> {
  await db.insert(sales).values({
    tenantId,
    tillId,
    nodeId,
    seriesId,
    invoiceNumber: s.invoiceNumber,
    issuedAt: s.issuedAt,
    issuedOffsetMinutes: 0,
    total: addDecimal(decimal(s.base), decimal(s.tax)),
    vatBreakdown: [{ rate: s.rate, base: s.base, tax: s.tax }],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    fiscalState: "recorded",
  });
}

/** Seeds one received supplier invoice (the IVA deducible side) directly, so the route exercises the
 * input-VAT half of the pipeline too. General régimen, corriente → casilla 28/29. */
async function seedPurchase(db: Database): Promise<void> {
  const [row] = await db
    .insert(purchaseInvoices)
    .values({
      tenantId,
      supplierTaxId: "B11111111",
      supplierName: "Café del Puerto SL",
      supplierInvoiceNumber: "2026/501",
      issuedOn: "2026-08-01",
      receivedOn: "2026-08-05",
      total: "121.00",
      regime: "general",
    })
    .returning({ id: purchaseInvoices.id });
  await db.insert(purchaseInvoiceVat).values({
    tenantId,
    purchaseInvoiceId: row!.id,
    rate: "21.00",
    base: "100.00",
    tax: "21.00",
    kind: "ordinary",
  });
}

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    // seedTenant supplies the tax_id + legal_name the route reads back as the obligado identity.
    tenantId = await seedTenant(db);
    // The one venue's location/till/node/series, seeded directly as the superuser (the demo idiom).
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Sala principal', array['es-ES'], 'Venta en establecimiento') returning id`);
    const locationId = loc.rows[0]!.id;
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

    // A known month (August) + quarter (Q1, via the February sale) of trade, plus one August purchase.
    for (const s of AUGUST_SALES) await seedSale(db, s);
    await seedSale(db, Q1_SALE);
    await seedPurchase(db);

    // A MANAGER (role `manager`, holds `report.export`) and a STAFF person (holds nothing) as the app
    // role, then a live management session for each so the route tests drive the gate through a real
    // cookie. `pin_hash` is NOT NULL, so a value is supplied though these sessions are minted directly.
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

/** GET helper with the manager cookie unless overridden (`cookie: null` sends none). */
async function send(
  app: Hono,
  method: "GET",
  path: string,
  opts: { cookie?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookie = opts.cookie === undefined ? managerCookie : opts.cookie;
  if (cookie !== null) headers["cookie"] = cookie;
  return app.request(path, { method, headers });
}

describe("mountReportApi — modelo 303 DR303 export", () => {
  it("GET …/reports/modelo-303?year&period=08 → 200 ISO-8859-1 attachment of 2944 bytes", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/reports/modelo-303?year=2026&period=08&declarationType=I",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=ISO-8859-1");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="modelo-303-2026-08.txt"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(2944);
    // Box 27 (Σ cuota devengada for August) at its documented offset — the expected packed value is
    // DERIVED from the seeded month (packAeatNumeric over Σ AUGUST_SALES.tax), not hardcoded.
    const box27 = Buffer.from(bytes).toString("latin1", BOX_27.offset, BOX_27.offset + BOX_27.len);
    expect(box27).toBe(expectedBox27);
  });

  it("accepts a quarterly período (period=1T) → 200 with the trimestre envelope + filename", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/reports/modelo-303?year=2026&period=1T&declarationType=I",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="modelo-303-2026-1T.txt"',
    );
    const bytes = Buffer.from(new Uint8Array(await res.arrayBuffer()));
    expect(bytes.toString("latin1", 0, 17)).toBe("<T303020261T0000>");
    // Box 27 (Σ cuota devengada for Q1) at its documented offset == the Q1 seed's OWN cuota, DERIVED
    // from the seed — so the route's QUARTERLY aggregation amount is verified end-to-end, not just its
    // status/filename/envelope. A route that summed August (63.00) or the year (84.00) fails here.
    const box27 = bytes.toString("latin1", BOX_27.offset, BOX_27.offset + BOX_27.len);
    expect(box27).toBe(expectedBox27Q1);
  });

  it("produces a valid all-zeros nil return for an empty period → 200, 2944 bytes", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/reports/modelo-303?year=2099&period=01&declarationType=N",
    );
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(2944);
  });
});

describe("mountReportApi — request screens + auth", () => {
  it.each([
    ["missing year", "?period=08&declarationType=I", "year"],
    ["bad year", "?year=20&period=08&declarationType=I", "year"],
    // A leading-zero 4-digit year below 1000 must be REFUSED at the screen (400), not passed to
    // computeVatReturn where validatePeriod's 1000..9999 bound throws a plain Error → opaque 500.
    ["out-of-range year (leading zeros)", "?year=0999&period=08&declarationType=I", "year"],
    ["bad period", "?year=2026&period=13&declarationType=I", "period"],
    [
      "annual period (no modelo 303 annual file)",
      "?year=2026&period=0A&declarationType=I",
      "period",
    ],
    ["missing declarationType", "?year=2026&period=08", "declarationType"],
  ])("400 management.request_invalid: %s", async (_label, qs, field) => {
    const res = await send(mountApp(), "GET", `/management-api/reports/modelo-303${qs}`);
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  it("401 with no session cookie", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/reports/modelo-303?year=2026&period=08&declarationType=I",
      { cookie: null },
    );
    expect(res.status).toBe(401);
  });

  it("403 for a staff-role session (holds no report.export)", async () => {
    const res = await send(
      mountApp(),
      "GET",
      "/management-api/reports/modelo-303?year=2026&period=08&declarationType=I",
      { cookie: staffCookie },
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

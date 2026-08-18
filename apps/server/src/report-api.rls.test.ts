import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, purchaseInvoiceVat, purchaseInvoices, sales, withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { addDecimal, decimal } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountReportApi } from "./report-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import { startRealPostgres } from "./testing/postgres.js";
import { BOX_27, packAeatNumeric } from "./testing/dr303.js";
import "./errors.js";

// Real Postgres, not PGlite: this suite proves the modelo 303 export ROUTE's tenant isolation and its
// `report.export` gate DIFFERENTIALLY, which PGlite cannot do — every PGlite connection is a superuser
// that bypasses FORCE RLS (CLAUDE.md §4), so a "cross-tenant read returned only my rows" on PGlite
// would be a FALSE pass. The route mechanics (year/period/declarationType screens, STATUS map, the
// 2944-byte ISO-8859-1 body) are already proven in-process on PGlite (`report-api.test.ts`), which
// explicitly DEFERS the differential isolation + gate-by-deletion proofs to this suite. Here every DB
// touch under test goes through the route's own `withTenant` + `asAppUser` (`suite.admin` is the
// superuser the harness hands out).
//
// A finding this suite RECORDS rather than assumes (§1 — the brief's premise did not survive the
// experiment): the modelo 303 route isolates tenants with TWO independent layers — an explicit
// `tenant_id = ${cfg.tenantId}` predicate on every query (`aggregateVatByRate`/`computeInputVat` call
// it "belt-and-suspenders over RLS"; the route's `tenants` read is `where id = cfg.tenantId`) AND the
// RLS that `asAppUser` activates. Either layer alone confines the read to one tenant, so removing
// `asAppUser` ALONE does not flip test 1 (see its recorded guard-by-deletion receipt). The gate, by
// contrast, has a single owner (`authorizeManager`), so its deletion flips test 2 cleanly.
const LOCALE = "es-ES";

const suite = useRealPostgres({
  start: startRealPostgres,
  timeoutMs: 180_000,
});

/** A no-op logger: only the HTTP responses and the produced bytes matter here. */
const noopLog: Logger = () => {};

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** One seeded sale — its filed per-rate desglose lands on `sales.vat_breakdown` (the only column the
 * reporting aggregate reads). Issued at midday +120 (CEST) so the filed *fecha de expedición* is the
 * UTC calendar day and the sale falls in August 2026. */
interface SeedSale {
  invoiceNumber: number;
  issuedAt: string;
  rate: string;
  base: string;
  tax: string;
}

// Venue A and venue B carry DIFFERENT figures, so a cross-tenant leak (A summing A+B) would change A's
// box 27. A's Σ cuota = 63.00 + 10.00 = 73.00; B's = 105.00; A+B = 178.00 — all three distinct, so the
// box-27 assertion below is a genuine differential, not a value that holds either way.
const A_SALES: readonly SeedSale[] = [
  {
    invoiceNumber: 1,
    issuedAt: "2026-08-10T10:00:00Z",
    rate: "21.00",
    base: "300.00",
    tax: "63.00",
  },
  {
    invoiceNumber: 2,
    issuedAt: "2026-08-15T10:00:00Z",
    rate: "10.00",
    base: "100.00",
    tax: "10.00",
  },
];
const B_SALES: readonly SeedSale[] = [
  {
    invoiceNumber: 1,
    issuedAt: "2026-08-12T10:00:00Z",
    rate: "21.00",
    base: "500.00",
    tax: "105.00",
  },
];

/** One received supplier invoice per venue (the IVA deducible / input side, casilla 28/29). Seeded so
 * the route exercises the input half too; different figures per venue, isolated the same way. */
interface SeedPurchase {
  number: string;
  base: string;
  tax: string;
  receivedOn: string;
}
const A_PURCHASE: SeedPurchase = {
  number: "A/501",
  base: "100.00",
  tax: "21.00",
  receivedOn: "2026-08-05",
};
const B_PURCHASE: SeedPurchase = {
  number: "B/501",
  base: "200.00",
  tax: "42.00",
  receivedOn: "2026-08-06",
};

interface Venue {
  tenantId: string;
  /** This venue's obligado NIF — stored on `tenants.tax_id`, read back into the file's identificación. */
  taxId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
  /** A live MANAGEMENT session cookie for a `manager` (holds `report.export`). */
  managerCookie: string;
  /** A live MANAGEMENT session cookie for a `staff` person (holds nothing — the gate refuses it). */
  staffCookie: string;
}

/**
 * Stand up a fresh provisioned venue (as the owner), then — as the app role under the tenant, so RLS
 * is exercised on the write side too — seed a MANAGER (role `manager`, holds `report.export`) and a
 * STAFF person (role `staff`, holds nothing) and mint a live management session for each. Each test
 * gets its OWN tenant(s), so its reads are that test's alone and order-independent (CLAUDE.md §4).
 */
async function setupVenue(): Promise<Venue> {
  const taxId = nextNif();
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId,
      legalName: "Deli Test SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "A",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );

  const { managerSid, staffSid } = await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: venue.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });

  return {
    tenantId: venue.tenantId,
    taxId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    // Any of the tenant's series satisfies the sale FK; the reporting aggregate does not filter by
    // series. The plan emits the standard series first, so seriesIds[0] is it.
    seriesId: venue.seriesIds[0]!,
    managerCookie: `${MANAGEMENT_COOKIE}=${managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${staffSid}`,
  };
}

/** Seeds this venue's month of sales directly as the superuser (RLS bypassed — pure setup, the
 * `modelo-303-demo.ts` seed idiom), each with its filed single-rate desglose on `sales.vat_breakdown`. */
async function seedSales(v: Venue, seeds: readonly SeedSale[]): Promise<void> {
  for (const s of seeds) {
    await suite.admin.insert(sales).values({
      tenantId: v.tenantId,
      tillId: v.tillId,
      nodeId: v.nodeId,
      seriesId: v.seriesId,
      invoiceNumber: s.invoiceNumber,
      issuedAt: s.issuedAt,
      issuedOffsetMinutes: 120,
      total: addDecimal(decimal(s.base), decimal(s.tax)),
      vatBreakdown: [{ rate: s.rate, base: s.base, tax: s.tax }],
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      fiscalBackend: "fake",
      fiscalState: "recorded",
    });
  }
}

/** Seeds one received supplier invoice (general régimen, ordinary → casilla 28/29) directly. */
async function seedPurchase(v: Venue, p: SeedPurchase): Promise<void> {
  const [row] = await suite.admin
    .insert(purchaseInvoices)
    .values({
      tenantId: v.tenantId,
      supplierTaxId: "B11111111",
      supplierName: "Café del Puerto SL",
      supplierInvoiceNumber: p.number,
      issuedOn: p.receivedOn,
      receivedOn: p.receivedOn,
      total: addDecimal(decimal(p.base), decimal(p.tax)),
      regime: "general",
    })
    .returning({ id: purchaseInvoices.id });
  await suite.admin.insert(purchaseInvoiceVat).values({
    tenantId: v.tenantId,
    purchaseInvoiceId: row!.id,
    rate: "21.00",
    base: p.base,
    tax: p.tax,
    kind: "ordinary",
  });
}

/** One Hono app per tenant — `mountReportApi` binds ONE tenant via `cfg.tenantId`, so each venue's
 * route needs its own app (mirrors `purchasing-api.rls.test.ts`). */
function mountApp(tenantId: string): Hono {
  const app = new Hono();
  mountReportApi(app, { db: suite.admin, cfg: { tenantId } }, noopLog);
  return app;
}

/** GET the modelo 303 file for a period, carrying `cookie`. */
async function download(
  app: Hono,
  cookie: string,
  year: string,
  period: string,
  declarationType: string,
): Promise<Response> {
  return app.request(
    `/management-api/reports/modelo-303?year=${year}&period=${period}&declarationType=${declarationType}`,
    { method: "GET", headers: { cookie } },
  );
}

/** Σ cuota devengada over a venue's seeded month, packed at box 27's width — the DERIVED expectation
 * (never a hardcoded packed string; a formatter bug cannot self-mask). */
function expectedBox27(seeds: readonly SeedSale[]): string {
  return packAeatNumeric(
    seeds.reduce((acc, s) => addDecimal(acc, decimal(s.tax)), decimal("0.00")),
    BOX_27.len,
  );
}

describe("mountReportApi — modelo 303 export over real Postgres (RLS end-to-end)", () => {
  it("a tenant's DR303 file reflects only its OWN sales/purchases and its OWN NIF (RLS)", async () => {
    // Differential cross-tenant isolation. Two independent provisioned venues, DIFFERENT figures. A's
    // box 27 (Σ cuota devengada) must equal A's OWN sum (73.00), not A+B (178.00), and A's file must
    // carry A's NIF and never B's — proving the route confines the read to `cfg.tenantId`.
    //
    // GUARD-BY-DELETION (asAppUser), run 2026-08-18 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true). Removing `await asAppUser(tx);` from `report-api.ts`'s
    // `gated` helper runs the read on the admin SUPERUSER (RLS bypassed) — yet this test STAYED GREEN
    // (`git diff report-api.ts` clean afterwards). That is the truthful, recorded result: it is NOT
    // the flip the brief predicted, and the reason is architectural, not a weak assertion. Every query
    // the route issues also carries an EXPLICIT `tenant_id = ${cfg.tenantId}` predicate
    // (`aggregateVatByRate`/`computeInputVat` call it "belt-and-suspenders over RLS"; the `tenants`
    // read is `where id = cfg.tenantId`), so dropping RLS alone still confines the read. Isolation
    // here is DOUBLE-guarded (explicit predicate AND RLS); the RLS layer on its own is proven in
    // `packages/reporting/{vat-return,input-vat}.rls.test.ts`.
    //
    // DECISIVE CONTROL (proves this assertion is NOT vacuous), run in the SAME session: with
    // `asAppUser` removed AND the explicit `where s.tenant_id = ${scope.tenantId}` deleted from
    // `aggregateVatByRate` (packages/reporting/src/vat-summary.ts) — i.e. BOTH isolation layers gone —
    // A's file summed A+B and box 27 read '00000000000017800' (178.00) instead of '00000000000007300'
    // (73.00), so the box-27 assertion below flipped GREEN→RED deterministically. Both edits were then
    // reverted; `git diff` of report-api.ts AND vat-summary.ts is clean. So this test genuinely
    // catches a cross-tenant leak once the guards are removed — the box-value/NIF proof the brief
    // attributed to `asAppUser` alone is really the joint work of the explicit predicate AND RLS. The
    // single-owner GATE deletion (test 2) is the clean single-line flip.
    const a = await setupVenue();
    const b = await setupVenue();
    await seedSales(a, A_SALES);
    await seedSales(b, B_SALES);
    await seedPurchase(a, A_PURCHASE);
    await seedPurchase(b, B_PURCHASE);

    // A's file: box 27 == A's OWN Σ cuota, A's NIF present, B's NIF absent.
    const fileA = await download(mountApp(a.tenantId), a.managerCookie, "2026", "08", "I");
    expect(fileA.status).toBe(200);
    const bytesA = Buffer.from(new Uint8Array(await fileA.arrayBuffer()));
    expect(bytesA.toString("latin1", BOX_27.offset, BOX_27.offset + BOX_27.len)).toBe(
      expectedBox27(A_SALES),
    );
    expect(bytesA.toString("latin1")).toContain(a.taxId);
    expect(bytesA.toString("latin1")).not.toContain(b.taxId);

    // The reverse direction: B's file carries B's OWN figures + NIF, never A's — the isolation is
    // symmetric, not an artefact of which tenant was provisioned first.
    const fileB = await download(mountApp(b.tenantId), b.managerCookie, "2026", "08", "I");
    expect(fileB.status).toBe(200);
    const bytesB = Buffer.from(new Uint8Array(await fileB.arrayBuffer()));
    expect(bytesB.toString("latin1", BOX_27.offset, BOX_27.offset + BOX_27.len)).toBe(
      expectedBox27(B_SALES),
    );
    expect(bytesB.toString("latin1")).toContain(b.taxId);
    expect(bytesB.toString("latin1")).not.toContain(a.taxId);
  });

  it("refuses the export to a staff-role session — 403 (gate by deletion)", async () => {
    // Prove the `report.export` gate BY DELETION. A `staff`-role management session holds no
    // `report.export`, so `authorizeManager` (inside `gated`) throws `authorization.not_permitted`
    // before any read runs — a 403.
    //
    // GUARD-BY-DELETION (authorizeManager), run 2026-08-18 against postgres:18 via Testcontainers
    // (TESTCONTAINERS_RYUK_DISABLED=true): removed the
    //   `await authorizeManager(tx, { managementSessionId: sessionId, permission: REPORT_EXPORT_PERMISSION });`
    // call from `report-api.ts`'s `gated` helper. This test then FAILED — the staff request returned
    // 200 (the file) instead of 403, so the `toBe(403)` assertion flipped GREEN→RED. Restored the line
    // and the test passed again; `git diff report-api.ts` is clean afterwards.
    const v = await setupVenue();
    const res = await download(mountApp(v.tenantId), v.staffCookie, "2026", "08", "I");
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
  });
});

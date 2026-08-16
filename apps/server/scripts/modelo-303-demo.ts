// Self-contained, human-checkable demonstration of `@waitron/reporting`'s two date-range roll-ups
// over the filed VAT desglose: `computeVatSummaryForPeriod` (a business-day range summary, scope 3)
// and `computeVatReturn` (the modelo 303 output-VAT / *IVA devengado* aggregate for one month,
// scope 4). Modelled on `daily-close-demo.ts`: it boots an in-memory PGlite (a WASM PostgreSQL),
// applies `@waitron/db`'s CORE + `@waitron/identity`'s migrations, and rings up a whole MONTH of
// trade through the REAL write path (`recordSale` / `recordCorrection` from `@waitron/core`) against
// the fake `FiscalBackend` from `@waitron/fiscal` — no external Postgres, no AEAT, no SIF
// registration. Both functions read only `sales.vat_breakdown` (a queryable copy of the filed
// desglose, migration 0032), so CORE_MIGRATIONS alone suffices; the fiscal chain is never read.
//
// It then produces the SUBMITTABLE output end-to-end: `mapModelo303` maps the reconciled aggregate
// onto the modelo 303 casillas and `toDr303Record` serializes it to the AEAT sede "por fichero"
// fixed-layout file, whose bytes the demo SELF-VALIDATES (length 2944, a known box at its documented
// offset, and — this month is a net credit — the 'N' sign prefix on the negative resultado).
//
// apps/* is exempt from the english-only guard, so the printed labels use the fiscal vocabulary
// (IVA devengado, base imponible, cuota, tipo).
//
// Run it:
//   pnpm --filter @waitron/server exec tsx scripts/modelo-303-demo.ts
//   # or, via the package script:
//   pnpm --filter @waitron/server demo:modelo-303
//
// What it rings up — a month of August 2026 sales across TWO nodes and TWO VAT rates, plus one
// rectificativa. Every sale is issued at 12:00 Europe/Madrid (10:00Z, +02:00 CEST), so its
// operational business day (05:00 cutover) and its filed civil date are the same calendar day — the
// two roll-ups therefore see the identical set here:
//   Nodo 1:  03 Aug  base 100.00 @ 21%   cuota 21.00
//            10 Aug  base  50.00 @ 10%   cuota  5.00
//            17 Aug  base 200.00 @ 21%   cuota 42.00
//   Nodo 2:  05 Aug  base  80.00 @ 10%   cuota  8.00
//            12 Aug  base  40.00 @ 21%   cuota  8.40
//            24 Aug  base  30.00 @ 10%   cuota  3.00
//   Rectificativa (Nodo 1, corrects the 03 Aug sale): 18 Aug  base -5.00 @ 21%  cuota -1.05
//
// So the monthly *IVA devengado*, corrections netted, should read (both roll-ups aggregate across
// the two nodes):
//   21%: base imponible 335.00 (100 + 200 + 40 − 5),  cuota 70.35 (21 + 42 + 8.40 − 1.05)
//   10%: base imponible 160.00 (50 + 80 + 30),        cuota 16.00 (5 + 8 + 3)
//   base imponible total 495.00 ; cuota (IVA devengado) total 86.35
// The script recomputes that 86.35 independently from the seeded figures (`addDecimal`, not a JS
// number) and asserts it equals `computeVatReturn`'s summed cuota — printing OK or throwing.
import { sql } from "drizzle-orm";
import {
  computeVatReturn,
  computeVatSummaryForPeriod,
  mapModelo303,
  toDr303Record,
} from "@waitron/reporting";
import type { Dr303Options, Modelo303, VatRateLine, VatSummary } from "@waitron/reporting";
import { recordCorrection, recordSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock } from "@waitron/fiscal";
import { CORE_MIGRATIONS, asAppUser, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import {
  addDecimal,
  compareDecimal,
  decimal,
  subtractDecimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import type { InputVatRateLine } from "@waitron/reporting";

const LOCALE = "es-ES";
const TIME_ZONE = "Europe/Madrid";
const CUTOVER = "05:00";
const YEAR = 2026;
const MONTH = 8; // August

// One row per ordinary sale. `node` indexes `venue.nodes`. `base`/`tax` are the FILED per-rate
// figures — passed to `recordSale` as an explicit `vatBreakdown` so what is filed equals what is
// seeded, and summed here (below) to form the independent expectation. `total` is always base + tax.
interface SeedSale {
  node: 0 | 1;
  /** Civil calendar date "YYYY-MM-DD" in August 2026. */
  day: string;
  rate: string;
  base: string;
  tax: string;
  description: string;
}

const ORDINARY_SALES: readonly SeedSale[] = [
  {
    node: 0,
    day: "2026-08-03",
    rate: "21.00",
    base: "100.00",
    tax: "21.00",
    description: "Menú del día",
  },
  {
    node: 0,
    day: "2026-08-10",
    rate: "10.00",
    base: "50.00",
    tax: "5.00",
    description: "Cesta de productos",
  },
  {
    node: 0,
    day: "2026-08-17",
    rate: "21.00",
    base: "200.00",
    tax: "42.00",
    description: "Catering evento",
  },
  {
    node: 1,
    day: "2026-08-05",
    rate: "10.00",
    base: "80.00",
    tax: "8.00",
    description: "Jamón cortado",
  },
  {
    node: 1,
    day: "2026-08-12",
    rate: "21.00",
    base: "40.00",
    tax: "8.40",
    description: "Botella de vino",
  },
  {
    node: 1,
    day: "2026-08-24",
    rate: "10.00",
    base: "30.00",
    tax: "3.00",
    description: "Pan artesano",
  },
];

// The rectificativa nets the first Nodo-1 sale down by 5.00 base @ 21%. `recordCorrection` derives
// its desglose from the line (base −5.00 @ 21% → cuota −1.05 via `percentOf`), so those are the
// filed figures the expectation below folds in.
const RECTIFICATIVA = {
  correctsIndex: 0,
  day: "2026-08-18",
  rate: "21.00",
  base: "-5.00",
  tax: "-1.05",
  description: "Rectificación menú del día",
} as const;

// Received supplier invoices (facturas recibidas) — the IVA DEDUCIBLE / soportado side. `base`/`tax`
// are the FILED per-rate figures (the supplier's own cuota, which may round by the difference method).
// `regime` general is deductible and on the 303; recargo de equivalencia is NON-deductible and off the
// 303, so it must NOT appear in the deducible aggregate. `kind` corriente (ordinary) → casilla 28/29,
// bienes de inversión (capital) → casilla 30/31.
interface SeedPurchase {
  supplierName: string;
  supplierTaxId: string;
  number: string;
  /** The supplier's *fecha de expedición* ("YYYY-MM-DD") — distinct from `receivedOn`: an invoice is
   * expedida by the supplier some days before we receive it. It does NOT drive the deduction period. */
  issuedOn: string;
  /** Civil date "YYYY-MM-DD" the invoice was received — the deduction period. */
  receivedOn: string;
  regime: "general" | "equivalence_surcharge";
  rate: string;
  base: string;
  tax: string;
  kind: "ordinary" | "capital";
  description: string;
}

const PURCHASE_INVOICES: readonly SeedPurchase[] = [
  {
    supplierName: "Café del Puerto SL",
    supplierTaxId: "B11111111",
    number: "2026/501",
    issuedOn: "2026-08-01",
    receivedOn: "2026-08-04",
    regime: "general",
    rate: "21.00",
    base: "200.00",
    tax: "41.99", // difference method: round(200 × 21%) would be 42.00; we file 41.99 verbatim
    kind: "ordinary",
    description: "Café y suministros (operación interior corriente)",
  },
  {
    supplierName: "Distribuciones Norte SL",
    supplierTaxId: "B22222222",
    number: "F-88",
    issuedOn: "2026-08-06",
    receivedOn: "2026-08-09",
    regime: "general",
    rate: "10.00",
    base: "100.00",
    tax: "10.00",
    kind: "ordinary",
    description: "Producto fresco al 10% (corriente)",
  },
  {
    supplierName: "Fríos Industriales SA",
    supplierTaxId: "A33333333",
    number: "INV-7",
    issuedOn: "2026-08-11",
    receivedOn: "2026-08-14",
    regime: "general",
    rate: "21.00",
    base: "1000.00",
    tax: "210.00",
    kind: "capital",
    description: "Cámara frigorífica (bien de inversión)",
  },
  {
    supplierName: "Kiosco Minorista SL",
    supplierTaxId: "B44444444",
    number: "T-3",
    issuedOn: "2026-08-17",
    receivedOn: "2026-08-20",
    regime: "equivalence_surcharge",
    rate: "21.00",
    base: "50.00",
    tax: "10.50",
    kind: "ordinary",
    description: "Prensa en recargo de equivalencia — NO deducible, fuera del 303",
  },
];

/**
 * A `TrustedClock` fixed at `instant`/`offsetMinutes`. `recordSale`/`recordCorrection` read `now()`
 * exactly once (for `issued_at` + the offset snapshot) and never touch `anchor`/`currentAnchor`, so
 * both are stubs — the identical shape `daily-close-demo.ts`'s `fixedClock` documents.
 */
function clockAt(instant: Date, offsetMinutes: number): TrustedClock {
  return {
    now: () => ({
      instant,
      offsetMinutes,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("modelo-303-demo: anchor() is not used by recordSale/recordCorrection");
    },
    currentAnchor: () => null,
  };
}

// 12:00 Europe/Madrid = 10:00Z in August (CEST, +02:00). Issuing at midday keeps every sale's
// business day (05:00 cutover) and its filed civil date on the same calendar day `day`.
function issuanceAt(day: string): { instant: Date; offsetMinutes: number } {
  return { instant: new Date(`${day}T10:00:00Z`), offsetMinutes: 120 };
}

interface SeededNode {
  nodeId: NodeId;
  seriesId: SeriesId;
  rectificativeSeriesId: SeriesId;
}
interface Venue {
  tenantId: TenantId;
  tillId: TillId;
  nodes: SeededNode[];
  // The supervisor (holds `sale.rectify`) whose session authorises the rectificativa.
  authorizerId: string;
}

/**
 * Seeds tenant → location → till → supervisor → TWO nodes, each with a standard and a rectificative
 * series, as the PGlite superuser (which bypasses RLS), exactly as `daily-close-demo.ts` does —
 * `app_user` holds no INSERT on `tenants` deliberately (a running POS cannot create tenants).
 */
async function seedVenue(db: Database): Promise<Venue> {
  const t = await db.execute<{ id: string }>(
    sql`insert into tenants (country, tax_id, legal_name) values ('ES', '50000000K', 'Deli Demo SL') returning id`,
  );
  const tenantId = brandTenantId(t.rows[0]!.id);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala principal', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`,
  );
  const tillId = brandTillId(till.rows[0]!.id);

  const nodes: SeededNode[] = [];
  for (let i = 1; i <= 2; i++) {
    const node = await db.execute<{ id: string }>(
      sql`insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, ${`Nodo ${i}`}) returning id`,
    );
    const nodeId = brandNodeId(node.rows[0]!.id);
    // Codes are unique per (tenant, node, code), so 'A'/'R' can repeat across the two nodes.
    const series = await db.execute<{ id: string }>(
      sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
    );
    const rSeries = await db.execute<{ id: string }>(sql`
      insert into invoice_series (tenant_id, node_id, code, purpose)
      values (${tenantId}, ${nodeId}, 'R', 'rectificative') returning id`);
    nodes.push({
      nodeId,
      seriesId: brandSeriesId(series.rows[0]!.id),
      rectificativeSeriesId: brandSeriesId(rSeries.rows[0]!.id),
    });
  }

  // A supervisor (holds `sale.rectify`), PIN "1234", inserted as the superuser like everything else
  // — the authorizer the rectificativa's gate requires.
  const person = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Supervisora', ${hashPin("1234")}, 'supervisor') returning id`);
  const authorizerId = person.rows[0]!.id;

  return { tenantId, tillId, nodes, authorizerId };
}

/** The expected *IVA devengado* per rate, summed independently from the seeded figures (corrections
 * netted). This is the check's left-hand side: pure `addDecimal` over the constants above, never a
 * read-back of the DB the roll-ups query. Sorted numerically, matching the roll-ups' `byRate` order. */
function expectedByRate(): VatRateLine[] {
  const byRate = new Map<Decimal, { base: Decimal; tax: Decimal }>();
  const add = (rate: string, base: string, tax: string): void => {
    const key = decimal(rate);
    const cur = byRate.get(key) ?? { base: decimal("0.00"), tax: decimal("0.00") };
    byRate.set(key, {
      base: addDecimal(cur.base, decimal(base)),
      tax: addDecimal(cur.tax, decimal(tax)),
    });
  };
  for (const s of ORDINARY_SALES) add(s.rate, s.base, s.tax);
  add(RECTIFICATIVA.rate, RECTIFICATIVA.base, RECTIFICATIVA.tax);
  return [...byRate.entries()]
    .map(([rate, v]) => ({ rate, base: v.base, tax: v.tax }))
    .sort((a, b) => compareDecimal(a.rate, b.rate));
}

function sumTax(lines: readonly VatRateLine[]): Decimal {
  return lines.reduce((acc, l) => addDecimal(acc, l.tax), decimal("0.00"));
}
function sumBase(lines: readonly VatRateLine[]): Decimal {
  return lines.reduce((acc, l) => addDecimal(acc, l.base), decimal("0.00"));
}

function printRateTable(lines: readonly VatRateLine[]): void {
  console.log("    tipo      base imponible        cuota");
  for (const l of lines) {
    console.log(`    ${`${l.rate}%`.padEnd(8)}  ${l.base.padStart(12)}  ${l.tax.padStart(12)}`);
  }
}

function printPeriodSummary(label: string, summary: VatSummary): void {
  console.log(`  ${label}`);
  printRateTable(summary.byRate);
  console.log(
    `    ${"totales".padEnd(8)}  ${summary.baseTotal.padStart(12)}  ${summary.taxTotal.padStart(12)}   (bruto ${summary.grossTotal})`,
  );
  console.log("");
}

/** Seeds the received supplier invoices directly (as the PGlite superuser, RLS bypassed), exactly as
 * seedVenue seeds the tenant — a received invoice is a plain accounting record, no fiscal write path. */
async function seedPurchaseInvoices(db: Database, tenantId: TenantId): Promise<void> {
  for (const p of PURCHASE_INVOICES) {
    const total = addDecimal(decimal(p.base), decimal(p.tax));
    const inv = await db.execute<{ id: string }>(sql`
      insert into purchase_invoices
        (tenant_id, supplier_tax_id, supplier_name, supplier_invoice_number, issued_on, received_on, total, regime)
      values (${tenantId}, ${p.supplierTaxId}, ${p.supplierName}, ${p.number}, ${p.issuedOn}, ${p.receivedOn}, ${total}, ${p.regime})
      returning id`);
    const id = inv.rows[0]!.id;
    await db.execute(sql`
      insert into purchase_invoice_vat (tenant_id, purchase_invoice_id, rate, base, tax, kind)
      values (${tenantId}, ${id}, ${p.rate}, ${p.base}, ${p.tax}, ${p.kind})`);
  }
}

/** The expected IVA deducible per (rate, kind), summed independently from the seeded figures — general
 * invoices only (recargo de equivalencia excluded), sorted rate asc then corriente before inversión,
 * matching computeInputVat. This is the check's left-hand side: pure addDecimal, not a DB read-back. */
function expectedDeducibleByRate(): InputVatRateLine[] {
  const kindOrder = { ordinary: 0, capital: 1 } as const;
  const byKey = new Map<string, InputVatRateLine>();
  for (const p of PURCHASE_INVOICES) {
    if (p.regime !== "general") continue; // recargo de equivalencia is off the 303
    const key = `${p.rate}:${p.kind}`;
    const cur = byKey.get(key);
    if (cur === undefined) {
      byKey.set(key, {
        rate: decimal(p.rate),
        base: decimal(p.base),
        tax: decimal(p.tax),
        kind: p.kind,
      });
    } else {
      cur.base = addDecimal(cur.base, decimal(p.base));
      cur.tax = addDecimal(cur.tax, decimal(p.tax));
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const r = compareDecimal(a.rate, b.rate);
    return r !== 0 ? r : kindOrder[a.kind] - kindOrder[b.kind];
  });
}

function printDeducibleTable(lines: readonly InputVatRateLine[]): void {
  console.log("    tipo      clase          base imponible        cuota");
  for (const l of lines) {
    const clase = l.kind === "capital" ? "inversión" : "corriente";
    console.log(
      `    ${`${l.rate}%`.padEnd(8)}  ${clase.padEnd(12)}  ${l.base.padStart(12)}  ${l.tax.padStart(12)}`,
    );
  }
}

/** Throws with a diff if the deducible aggregate's per-(rate,kind) figures or totals differ from the
 * independently-summed expectation. Checks `kind` too — the casilla 28/29-vs-30/31 split. */
function reconcileDeducible(
  actual: { byRate: readonly InputVatRateLine[]; baseTotal: Decimal; taxTotal: Decimal },
  expected: readonly InputVatRateLine[],
): void {
  const expBase = expected.reduce((a, l) => addDecimal(a, l.base), decimal("0.00"));
  const expTax = expected.reduce((a, l) => addDecimal(a, l.tax), decimal("0.00"));
  const problems: string[] = [];
  if (compareDecimal(actual.baseTotal, expBase) !== 0) {
    problems.push(`deducible baseTotal ${actual.baseTotal} != expected ${expBase}`);
  }
  if (compareDecimal(actual.taxTotal, expTax) !== 0) {
    problems.push(`deducible taxTotal (cuota) ${actual.taxTotal} != expected ${expTax}`);
  }
  if (actual.byRate.length !== expected.length) {
    problems.push(
      `deducible byRate has ${actual.byRate.length} lines, expected ${expected.length}`,
    );
  } else {
    for (let i = 0; i < expected.length; i++) {
      const a = actual.byRate[i]!;
      const e = expected[i]!;
      if (
        a.kind !== e.kind ||
        compareDecimal(a.rate, e.rate) !== 0 ||
        compareDecimal(a.base, e.base) !== 0 ||
        compareDecimal(a.tax, e.tax) !== 0
      ) {
        problems.push(
          `deducible ${a.rate}/${a.kind}: base ${a.base}/cuota ${a.tax} != expected base ${e.base}/cuota ${e.tax} (${e.kind})`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `modelo-303-demo: IVA deducible did not reconcile:\n  ${problems.join("\n  ")}`,
    );
  }
}

async function main(): Promise<void> {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    // IDENTITY_MIGRATIONS after CORE: identity's `persons`/`sessions` carry a foreign key onto core's
    // `tenants`/`tills`. recordCorrection's `sale.rectify` gate reads both.
    await runMigrations(db, IDENTITY_MIGRATIONS);
    await FakeFiscalBackend.install(db);
    const venue = await seedVenue(db);
    const backend = new FakeFiscalBackend(db);

    // Register both nodes once (a one-time admin action recordSale itself never performs), as
    // app_user in its own committed transaction so the later write transactions see them.
    for (const node of venue.nodes) {
      await withTenant(db, venue.tenantId, async (tx) => {
        await asAppUser(tx);
        await backend.registerNode(tx, node.nodeId, { tenantId: venue.tenantId });
      });
    }

    // Ring up the month. Each ordinary sale is filed with an explicit `vatBreakdown` (its seeded
    // per-rate figures), so `sales.vat_breakdown` holds exactly those cuotas. Deferred (invoice-only)
    // — the roll-ups read the filed desglose, never the settlement.
    const saleIds: SaleId[] = [];
    for (const s of ORDINARY_SALES) {
      const node = venue.nodes[s.node]!;
      const { instant, offsetMinutes } = issuanceAt(s.day);
      const total = addDecimal(decimal(s.base), decimal(s.tax));
      const input: RecordSaleInput = {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        nodeId: node.nodeId,
        seriesId: node.seriesId,
        locale: LOCALE,
        invoiceLocales: [LOCALE],
        total,
        lines: [
          {
            lineNo: 1,
            descriptions: { [LOCALE]: s.description },
            quantity: "1",
            unitPrice: s.base,
            vatRate: s.rate,
            lineTotal: s.base,
          },
        ],
        vatBreakdown: [{ rate: decimal(s.rate), base: decimal(s.base), tax: decimal(s.tax) }],
        fiscalBackend: "fake",
        clock: clockAt(instant, offsetMinutes),
        settlement: { kind: "deferred" },
      };
      const { saleId } = await withTenant(db, venue.tenantId, async (tx) => {
        await asAppUser(tx);
        return recordSale(tx, backend, input);
      });
      saleIds.push(saleId);
    }

    // Open the supervisor's shift session — the authorizer the rectificativa's `sale.rectify` gate
    // requires — exactly as a till would at the start of a shift.
    const authorizerSession = await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return loginWithPin(tx, {
        tenantId: venue.tenantId,
        tillId: venue.tillId,
        personId: venue.authorizerId,
        pin: "1234",
      });
    });

    // The rectificativa, on Nodo 1's rectificative series, correcting the first Nodo-1 sale.
    const node0 = venue.nodes[0]!;
    const rect = issuanceAt(RECTIFICATIVA.day);
    const correctionInput: RecordCorrectionInput = {
      tenantId: venue.tenantId,
      tillId: venue.tillId,
      nodeId: node0.nodeId,
      seriesId: node0.rectificativeSeriesId,
      correctsSaleId: saleIds[RECTIFICATIVA.correctsIndex]!,
      total: addDecimal(decimal(RECTIFICATIVA.base), decimal(RECTIFICATIVA.tax)),
      lines: [
        {
          lineNo: 1,
          descriptions: { [LOCALE]: RECTIFICATIVA.description },
          quantity: "1",
          unitPrice: RECTIFICATIVA.base,
          vatRate: RECTIFICATIVA.rate,
          lineTotal: RECTIFICATIVA.base,
        },
      ],
      fiscalBackend: "fake",
      clock: clockAt(rect.instant, rect.offsetMinutes),
      authz: { sessionId: authorizerSession.id },
    };
    await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      await recordCorrection(tx, backend, correctionInput);
    });

    // The IVA DEDUCIBLE side: received supplier invoices (facturas recibidas). A plain accounting
    // record — no fiscal write path — so seeded directly like the tenant itself.
    await seedPurchaseInvoices(db, venue.tenantId);

    // The reads: RLS-safe, as the application role, exactly as a report consumer would call them.
    const monthLabel = `${YEAR}-${String(MONTH).padStart(2, "0")}`;
    const period = { fromBusinessDay: `${monthLabel}-01`, toBusinessDay: `${monthLabel}-31` };
    const { periodAll, periodNode1, periodNode2, weekOne, vatReturn } = await withTenant(
      db,
      venue.tenantId,
      async (tx) => {
        await asAppUser(tx);
        const base = {
          tenantId: venue.tenantId,
          timeZone: TIME_ZONE,
          dayCutover: CUTOVER,
          ...period,
        };
        return {
          periodAll: await computeVatSummaryForPeriod(tx, base),
          periodNode1: await computeVatSummaryForPeriod(tx, {
            ...base,
            nodeId: venue.nodes[0]!.nodeId,
          }),
          periodNode2: await computeVatSummaryForPeriod(tx, {
            ...base,
            nodeId: venue.nodes[1]!.nodeId,
          }),
          // A single week, to show the range clause genuinely narrows (03–09 Aug excludes the later sales).
          weekOne: await computeVatSummaryForPeriod(tx, {
            ...base,
            fromBusinessDay: `${monthLabel}-03`,
            toBusinessDay: `${monthLabel}-09`,
          }),
          vatReturn: await computeVatReturn(tx, {
            tenantId: venue.tenantId,
            year: YEAR,
            month: MONTH,
          }),
        };
      },
    );

    console.log(
      `modelo-303-demo: a month of trade over ${venue.nodes.length} nodes, two VAT rates\n`,
    );

    console.log("computeVatSummaryForPeriod — VAT roll-up over business days (issuance-anchored)");
    printPeriodSummary(
      `Nodo 1 only, ${period.fromBusinessDay} … ${period.toBusinessDay}`,
      periodNode1,
    );
    printPeriodSummary(
      `Nodo 2 only, ${period.fromBusinessDay} … ${period.toBusinessDay}`,
      periodNode2,
    );
    printPeriodSummary(
      `all nodes, ${period.fromBusinessDay} … ${period.toBusinessDay} (Nodo 1 + Nodo 2)`,
      periodAll,
    );
    printPeriodSummary(`all nodes, one week ${monthLabel}-03 … ${monthLabel}-09`, weekOne);

    console.log(`computeVatReturn — modelo 303, ${monthLabel} (obligado ${venue.tenantId})`);
    console.log("  IVA DEVENGADO (output side, casilla 27) — régimen general, corrections netted:");
    printRateTable(vatReturn.byRate);
    console.log(
      `    ${"totales".padEnd(8)}  ${vatReturn.baseTotal.padStart(12)}  ${vatReturn.taxTotal.padStart(12)}`,
    );
    console.log("");

    console.log(
      "  IVA DEDUCIBLE (input side, casilla 45) — régimen general, recargo de equivalencia",
    );
    console.log("  excluded; bienes de inversión split out from operaciones corrientes:");
    printDeducibleTable(vatReturn.deductible.byRate);
    console.log(
      `    ${"totales".padEnd(8)}  ${" ".repeat(12)}  ${vatReturn.deductible.baseTotal.padStart(12)}  ${vatReturn.deductible.taxTotal.padStart(12)}`,
    );
    console.log("");
    console.log(
      `  RESULTADO régimen general (casilla 46 = 27 − 45) = ${vatReturn.taxTotal} − ${vatReturn.deductible.taxTotal} = ${vatReturn.result}`,
    );
    console.log("");

    // The check: the printed cuota total (`computeVatReturn`, read from the DB) must equal the cuota
    // summed independently from the seeded figures. Value comparison via `compareDecimal`.
    const expected = expectedByRate();
    reconcile("modelo 303 monthly IVA devengado", vatReturn, expected);
    // The month-covering period roll-up sees the same set here, so it must reconcile too — a second
    // witness that the two functions agree over this month.
    reconcile("period roll-up over the whole month", periodAll, expected);

    // The deducible side and the net result reconcile end-to-end: Σ filed deducible cuotas
    // (general only), and result = devengado − deducible (casilla 46 = 27 − 45).
    const expectedDeducible = expectedDeducibleByRate();
    reconcileDeducible(vatReturn.deductible, expectedDeducible);
    const expectedResult = subtractDecimal(sumTax(expected), sumTax(expectedDeducible));
    if (compareDecimal(vatReturn.result, expectedResult) !== 0) {
      throw new Error(
        `modelo-303-demo: resultado ${vatReturn.result} != expected ${expectedResult} (devengado − deducible)`,
      );
    }

    console.log(
      `OK — IVA devengado ${vatReturn.taxTotal} − IVA deducible ${vatReturn.deductible.taxTotal} = resultado ${vatReturn.result}, reconciled against the summed filed figures.`,
    );
    console.log("");

    // ── The submittable output: the DR303 fixed-layout file the sede "por fichero" path uploads. Map
    //    the reconciled aggregate onto the modelo 303 casillas, serialize to the AEAT record, and
    //    SELF-VALIDATE the produced bytes (this month's resultado is a NET CREDIT, so box 46/71 must
    //    carry the 'N' sign). The `tipo de declaración` is an operator/asesor input, not computed —
    //    "C" (a compensar) is illustrative here for the net-credit month.
    const modelo = mapModelo303(vatReturn);
    const dr303Options: Dr303Options = {
      taxId: "50000000K",
      name: "Deli Demo SL",
      year: YEAR,
      period: String(MONTH).padStart(2, "0"),
      declarationType: "C",
    };
    const record = toDr303Record(modelo, dr303Options);
    validateDr303Record(record, modelo);

    console.log("DR303 — modelo 303 fixed-layout file (AEAT sede 'por fichero')");
    console.log(
      `  ${record.length} bytes: envelope + común + página 1 + página 3 (página 2 régimen simplificado omitted, out of scope)`,
    );
    const shown = boxAt(record, "46");
    console.log(
      `  casilla 46 (resultado régimen general ${modelo.boxes["46"]}) at byte offset ${shown.offset}: ${shown.bytes}  ← 'N' sign prefix for the net credit`,
    );
    console.log(
      `OK — DR303 file self-validated: length 2944, box 27 (${modelo.boxes["27"]}) at its documented offset, negative resultado rendered with the N prefix.`,
    );
  } finally {
    await db.close();
  }
}

// Fixed 0-based byte offsets of the two casillas this demo reads back out of the produced record;
// both are 17-char money boxes on página 1. These are the SAME offsets the serializer's own test
// pins (packages/reporting/src/dr303.test.ts's OFFSET table: box 27 at 1023, box 46 at 1346), where
// they are derived from the layout and asserted to match — a layout shift turns that test red.
// Hardcoding them keeps the demo on the public @waitron/reporting barrel, with no deep import into
// the internal dr303-layout.ts.
const DR303_BOX_OFFSETS: Readonly<Record<string, { offset: number; len: number }>> = {
  "27": { offset: 1023, len: 17 },
  "46": { offset: 1346, len: 17 },
};

/** Reads a casilla's raw bytes back out of the record at its FIXED offset (see DR303_BOX_OFFSETS). */
function boxAt(record: Buffer, casilla: string): { offset: number; len: number; bytes: string } {
  const box = DR303_BOX_OFFSETS[casilla];
  if (box === undefined) {
    throw new Error(`modelo-303-demo: casilla ${casilla} has no fixed offset in this demo`);
  }
  return {
    offset: box.offset,
    len: box.len,
    bytes: record.toString("latin1", box.offset, box.offset + box.len),
  };
}

/** Independently packs a Decimal into an AEAT fixed-width numeric field — the demo's OWN witness, NOT
 * the serializer's `formatNumericField`: magnitude in cents, right-aligned and zero-filled, a negative
 * value taking an 'N' in position 1 (manual_uso.txt). Used only to cross-check `toDr303Record`'s bytes. */
function packAeatNumeric(value: Decimal, width: number): string {
  const negative = value.startsWith("-");
  const magnitude = (negative ? value.slice(1) : value).replace(".", "");
  return negative ? "N" + magnitude.padStart(width - 1, "0") : magnitude.padStart(width, "0");
}

/** Throws unless the produced DR303 file self-validates: total length 2944, box 27 (a positive money
 * box) landing at its documented offset with the expected bytes, and box 46 (this month's NEGATIVE
 * resultado) carrying the 'N' sign prefix. Expected bytes come from `packAeatNumeric` — a second,
 * independent encoder — so a bug in the serializer's own formatter cannot mask itself. */
function validateDr303Record(record: Buffer, modelo: Modelo303): void {
  const problems: string[] = [];
  if (record.length !== 2944) {
    problems.push(
      `record is ${record.length} bytes, expected 2944 (común 328 + página1 1581 + página3 1017 + envelope close 18)`,
    );
  }
  const at27 = boxAt(record, "27");
  const want27 = packAeatNumeric(modelo.boxes["27"]!, at27.len);
  if (at27.bytes !== want27) {
    problems.push(
      `box 27 at offset ${at27.offset}: bytes ${JSON.stringify(at27.bytes)} != expected ${JSON.stringify(want27)}`,
    );
  }
  const at46 = boxAt(record, "46");
  const want46 = packAeatNumeric(modelo.boxes["46"]!, at46.len);
  if (at46.bytes !== want46) {
    problems.push(
      `box 46 at offset ${at46.offset}: bytes ${JSON.stringify(at46.bytes)} != expected ${JSON.stringify(want46)}`,
    );
  }
  if (!at46.bytes.startsWith("N")) {
    problems.push(
      `box 46 (resultado ${modelo.boxes["46"]}) should carry the N sign prefix for a negative value, got ${JSON.stringify(at46.bytes)}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `modelo-303-demo: DR303 file did not self-validate:\n  ${problems.join("\n  ")}`,
    );
  }
}

/** Throws with a diff if `actual`'s per-rate figures and cuota/base totals differ from `expected`. */
function reconcile(
  label: string,
  actual: { byRate: readonly VatRateLine[]; baseTotal: Decimal; taxTotal: Decimal },
  expected: readonly VatRateLine[],
): void {
  const expBase = sumBase(expected);
  const expTax = sumTax(expected);
  const problems: string[] = [];
  if (compareDecimal(actual.baseTotal, expBase) !== 0) {
    problems.push(`baseTotal ${actual.baseTotal} != expected ${expBase}`);
  }
  if (compareDecimal(actual.taxTotal, expTax) !== 0) {
    problems.push(`taxTotal (cuota) ${actual.taxTotal} != expected ${expTax}`);
  }
  if (actual.byRate.length !== expected.length) {
    problems.push(`byRate has ${actual.byRate.length} rates, expected ${expected.length}`);
  } else {
    for (let i = 0; i < expected.length; i++) {
      const a = actual.byRate[i]!;
      const e = expected[i]!;
      if (
        compareDecimal(a.rate, e.rate) !== 0 ||
        compareDecimal(a.base, e.base) !== 0 ||
        compareDecimal(a.tax, e.tax) !== 0
      ) {
        problems.push(
          `rate ${a.rate}: base ${a.base}/cuota ${a.tax} != expected base ${e.base}/cuota ${e.tax}`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`modelo-303-demo: ${label} did not reconcile:\n  ${problems.join("\n  ")}`);
  }
}

main().catch((error: unknown) => {
  console.error("modelo-303-demo: failed");
  console.error(error);
  process.exit(1);
});

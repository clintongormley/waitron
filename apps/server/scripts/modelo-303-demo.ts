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
import { computeVatReturn, computeVatSummaryForPeriod } from "@waitron/reporting";
import type { VatRateLine, VatSummary } from "@waitron/reporting";
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
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";

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
    console.log("  IVA DEVENGADO (OUTPUT side only). NOT the IVA deducible/soportado side; no");
    console.log("  recargo de equivalencia and no casilla mapping — spec §4/D6.");
    printRateTable(vatReturn.byRate);
    console.log(
      `    ${"totales".padEnd(8)}  ${vatReturn.baseTotal.padStart(12)}  ${vatReturn.taxTotal.padStart(12)}`,
    );
    console.log("");

    // The check: the printed cuota total (`computeVatReturn`, read from the DB) must equal the cuota
    // summed independently from the seeded figures. Value comparison via `compareDecimal`.
    const expected = expectedByRate();
    reconcile("modelo 303 monthly IVA devengado", vatReturn, expected);
    // The month-covering period roll-up sees the same set here, so it must reconcile too — a second
    // witness that the two functions agree over this month.
    reconcile("period roll-up over the whole month", periodAll, expected);

    const expectedTax = sumTax(expected);
    console.log(
      `OK — cuota (IVA devengado) total ${vatReturn.taxTotal} equals the summed filed figures ${expectedTax}.`,
    );
  } finally {
    await db.close();
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

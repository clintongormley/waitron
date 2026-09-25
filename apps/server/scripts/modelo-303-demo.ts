// Demonstrates `@waitron/reporting`'s VAT roll-ups and the DR303 "por fichero" file over a month of
// sales rung up through the real write path against the fake `FiscalBackend`, in a throwaway venue
// directory. Each figure is checked against an expectation summed independently from the seeded
// constants; a mismatch throws.
//
// apps/* is exempt from the english-only guard, so the printed labels use the fiscal vocabulary.
//
// Run it: pnpm --filter @waitron/server demo:modelo-303
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeVatReturn,
  computeVatSummaryForPeriod,
  mapModelo303,
  toDr303Record,
} from "@waitron/reporting";
import type {
  Dr303Options,
  LiquidationPeriod,
  Modelo303,
  VatRateLine,
  VatReturn,
  VatSummary,
} from "@waitron/reporting";
import { recordCorrection, recordSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock } from "@waitron/fiscal";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  purchaseInvoiceVat,
  purchaseInvoices,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  addDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  stringToBasisPoints,
  stringToCents,
  subtractDecimal,
  sumDecimals,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import type { InputVatRateLine } from "@waitron/reporting";

/** identity holds the supervisor who authorises the rectificativa. */
const SETS = ["core", "identity"];

const LOCALE = "es-ES";
const TIME_ZONE = "Europe/Madrid";
const CUTOVER = "05:00";
const YEAR = 2026;
const MONTH = 8;

// `node` indexes `venue.nodes`. `base`/`tax` are filed verbatim as the sale's `vatBreakdown`, so
// what is filed equals what the expectation sums.
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

// `recordCorrection` derives its desglose from the line, so these are the figures it files.
const RECTIFICATIVA = {
  correctsIndex: 0,
  day: "2026-08-18",
  rate: "21.00",
  base: "-5.00",
  tax: "-1.05",
  description: "Rectificación menú del día",
} as const;

// The IVA deducible side. `base`/`tax` are the supplier's own filed figures. Recargo de equivalencia
// is non-deductible and off the 303. `kind` ordinary → casilla 28/29, capital → casilla 30/31.
interface SeedPurchase {
  supplierName: string;
  supplierTaxId: string;
  number: string;
  /** The supplier's *fecha de expedición* ("YYYY-MM-DD"); it does not drive the deduction period. */
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

// 12:00 Europe/Madrid in August. Midday keeps a sale's business day (05:00 cutover) and its filed
// civil date on the same day, so both roll-ups see the same set.
function issuanceAt(day: string): { instant: Date; offsetMinutes: number } {
  return { instant: new Date(`${day}T10:00:00Z`), offsetMinutes: 120 };
}

interface SeededNode {
  nodeId: NodeId;
  seriesId: SeriesId;
  rectificativeSeriesId: SeriesId;
}
interface Venue {
  tillId: TillId;
  nodes: SeededNode[];
  authorizerId: string;
}

/**
 * Drizzle inserts, not raw SQL: the `id` values come from `$defaultFn`, which raw SQL does not run
 * (`packages/db/src/schema/columns.ts`).
 */
async function seedVenue(db: Database): Promise<Venue> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "50000000K", legalName: "Deli Demo SL" });
  const [loc] = await db
    .insert(locations)
    .values({
      name: "Sala principal",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const tillId = brandTillId(till!.id);

  const seeded: SeededNode[] = [];
  for (let i = 1; i <= 2; i++) {
    const [node] = await db
      .insert(nodes)
      .values({ locationId, name: `Nodo ${i}` })
      .returning({ id: nodes.id });
    const nodeId = brandNodeId(node!.id);
    // Codes are unique per (node_id, code), so 'A'/'R' can repeat across the two nodes.
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "A" })
      .returning({ id: invoiceSeries.id });
    const [rSeries] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "R", purpose: "rectificative" })
      .returning({ id: invoiceSeries.id });
    seeded.push({
      nodeId,
      seriesId: brandSeriesId(series!.id),
      rectificativeSeriesId: brandSeriesId(rSeries!.id),
    });
  }

  const [person] = await db
    .insert(persons)
    .values({
      displayName: "Supervisora",
      email: "supervisor@modelo-303.demo",
      pinHash: hashPin("1234"),
      role: "supervisor",
    })
    .returning({ id: persons.id });
  const authorizerId = person!.id;

  return { tillId, nodes: seeded, authorizerId };
}

/** Summed from the constants above, never read back from the database the roll-ups query. */
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

/** A received invoice is a plain accounting record with no fiscal write path. */
async function seedPurchaseInvoices(db: Database): Promise<void> {
  // Amount columns store whole cents; `rate` stores basis points (2100 is 21%).
  for (const p of PURCHASE_INVOICES) {
    const total = addDecimal(decimal(p.base), decimal(p.tax));
    const [inv] = await db
      .insert(purchaseInvoices)
      .values({
        supplierTaxId: p.supplierTaxId,
        supplierName: p.supplierName,
        supplierInvoiceNumber: p.number,
        issuedOn: p.issuedOn,
        receivedOn: p.receivedOn,
        total: decimalToCents(total),
        regime: p.regime,
      })
      .returning({ id: purchaseInvoices.id });
    await db.insert(purchaseInvoiceVat).values({
      purchaseInvoiceId: inv!.id,
      rate: stringToBasisPoints(p.rate),
      base: stringToCents(p.base),
      tax: stringToCents(p.tax),
      kind: p.kind,
    });
  }
}

/** General-regime invoices only, summed from the constants, never read back from the database. */
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

/** Checks `kind` too — the casilla 28/29-vs-30/31 split. */
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
  const venueDir = await mkdtemp(join(tmpdir(), "modelo-303-demo-"));
  const sets = manifestSets().filter((set) => SETS.includes(set.name));
  await applyMigrations(venueDir, migrationOptionsFor(sets, null));
  const store = await openVenueDatabase(venueDir);
  const db = store.venue;
  try {
    await FakeFiscalBackend.install(db);
    const venue = await seedVenue(db);
    const backend = new FakeFiscalBackend(db);

    // A one-time admin action recordSale never performs.
    for (const node of venue.nodes) {
      await withTransaction(db, async (tx) => {
        await backend.registerNode(tx, node.nodeId);
      });
    }

    // Deferred (invoice-only): the roll-ups read the filed desglose, never the settlement.
    const saleIds: SaleId[] = [];
    for (const s of ORDINARY_SALES) {
      const node = venue.nodes[s.node]!;
      const { instant, offsetMinutes } = issuanceAt(s.day);
      const total = addDecimal(decimal(s.base), decimal(s.tax));
      const input: RecordSaleInput = {
        tillId: venue.tillId,
        nodeId: node.nodeId,
        seriesId: node.seriesId,
        locale: LOCALE,
        invoiceLocales: [LOCALE],
        total,
        lines: [
          {
            lineNo: 1,
            name: s.description,
            descriptions: { [LOCALE]: s.description },
            quantity: "1",
            unitPrice: s.base,
            vatRate: s.rate,
            lineTotal: s.base,
          },
        ],
        vatBreakdown: [{ rate: decimal(s.rate), base: decimal(s.base), tax: decimal(s.tax) }],
        clock: clockAt(instant, offsetMinutes),
        settlement: { kind: "deferred" },
      };
      const { saleId } = await withTransaction(db, async (tx) => {
        return recordSale(tx, backend, input);
      });
      saleIds.push(saleId);
    }

    // The rectificativa's `sale.rectify` gate needs a supervisor session.
    const authorizerSession = await withTransaction(db, async (tx) => {
      return loginWithPin(tx, {
        tillId: venue.tillId,
        personId: venue.authorizerId,
        pin: "1234",
      });
    });

    // The rectificativa, on Nodo 1's rectificative series, correcting the first Nodo-1 sale.
    const node0 = venue.nodes[0]!;
    const rect = issuanceAt(RECTIFICATIVA.day);
    const correctionInput: RecordCorrectionInput = {
      tillId: venue.tillId,
      nodeId: node0.nodeId,
      seriesId: node0.rectificativeSeriesId,
      correctsSaleId: saleIds[RECTIFICATIVA.correctsIndex]!,
      total: addDecimal(decimal(RECTIFICATIVA.base), decimal(RECTIFICATIVA.tax)),
      lines: [
        {
          lineNo: 1,
          name: RECTIFICATIVA.description,
          descriptions: { [LOCALE]: RECTIFICATIVA.description },
          quantity: "1",
          unitPrice: RECTIFICATIVA.base,
          vatRate: RECTIFICATIVA.rate,
          lineTotal: RECTIFICATIVA.base,
        },
      ],
      clock: clockAt(rect.instant, rect.offsetMinutes),
      authz: { sessionId: authorizerSession.id },
    };
    await withTransaction(db, async (tx) => {
      await recordCorrection(tx, backend, correctionInput);
    });

    await seedPurchaseInvoices(db);

    const monthLabel = `${YEAR}-${String(MONTH).padStart(2, "0")}`;
    const period = { fromBusinessDay: `${monthLabel}-01`, toBusinessDay: `${monthLabel}-31` };
    const { periodAll, periodNode1, periodNode2, weekOne, vatReturn } = await withTransaction(
      db,
      async (tx) => {
        const base = {
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
            year: YEAR,
            period: { kind: "month", month: MONTH },
          }),
        };
      },
    );

    // Only August carries trade, so the quarter and year equal the month; the reconciliation still
    // exercises the wider civil-date bounds.
    const quarter = qOf(MONTH);
    const [qm1, qm2, qm3] = monthsOfQuarter(quarter);
    const { monthlyReturns, quarterReturn, annualReturn } = await withTransaction(
      db,
      async (tx) => {
        const forPeriod = (period: LiquidationPeriod): Promise<VatReturn> =>
          computeVatReturn(tx, { year: YEAR, period });
        return {
          monthlyReturns: [
            await forPeriod({ kind: "month", month: qm1 }),
            await forPeriod({ kind: "month", month: qm2 }),
            await forPeriod({ kind: "month", month: qm3 }),
          ],
          quarterReturn: await forPeriod({ kind: "quarter", quarter }),
          annualReturn: await forPeriod({ kind: "year" }),
        };
      },
    );

    console.log(
      `modelo-303-demo: a month of trade over ${venue.nodes.length} nodes, two VAT rates\n`,
    );

    console.log(
      "computeVatSummaryForPeriod — VAT roll-up over business days (sales on their issue day, voids on their own day)",
    );
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

    console.log(`computeVatReturn — modelo 303, ${monthLabel}`);
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

    const expected = expectedByRate();
    reconcile("modelo 303 monthly IVA devengado", vatReturn, expected);
    reconcile("period roll-up over the whole month", periodAll, expected);

    // Casilla 46 = 27 − 45.
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

    // The quarter is the exact sum of its three months, never a re-rounded round(Σ base × rate).
    reconcileQuarterEqualsMonths(
      `modelo 303 quarter ${quarter}T equals the sum of months ${qm1}/${qm2}/${qm3}`,
      quarterReturn,
      monthlyReturns,
    );
    console.log(
      `computeVatReturn — quarterly & annual roll-ups (${quarter}T and año ${YEAR}, same filed rows):`,
    );
    console.log(
      `  ${quarter}T ${YEAR}: IVA devengado ${quarterReturn.taxTotal}, deducible ${quarterReturn.deductible.taxTotal}, resultado ${quarterReturn.result}`,
    );
    console.log(
      `    (= the addDecimal sum of months ${qm1}/${qm2}/${qm3}; only ${MONTH} carries trade in this demo)`,
    );
    console.log(`  año ${YEAR}: IVA devengado — régimen general, corrections netted:`);
    printRateTable(annualReturn.byRate);
    console.log(
      `    ${"totales".padEnd(8)}  ${annualReturn.baseTotal.padStart(12)}  ${annualReturn.taxTotal.padStart(12)}   (deducible ${annualReturn.deductible.taxTotal}, resultado ${annualReturn.result})`,
    );
    console.log(
      `OK — ${quarter}T reconciled against the addDecimal sum of its three months; annual aggregate printed (no modelo 303 annual file — that is modelo 390).`,
    );
    console.log("");

    // The `tipo de declaración` is an operator/asesor input, not computed; "C" (a compensar) is
    // illustrative for this net-credit month.
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
    console.log("");

    // No annual file: `toDr303Record` refuses {kind:"year"} (the annual resumen is modelo 390).
    const quarterToken = `${quarter}T`;
    const quarterModelo = mapModelo303(quarterReturn);
    const quarterRecord = toDr303Record(quarterModelo, {
      taxId: "50000000K",
      name: "Deli Demo SL",
      year: YEAR,
      period: quarterToken,
      declarationType: "C",
    });
    validateDr303QuarterPeriod(quarterRecord, quarterModelo, quarterToken);
    const env = boxAt(quarterRecord, "período");
    console.log("DR303 — quarterly modelo 303 file (envelope período = trimestre)");
    console.log(
      `  ${quarterRecord.length} bytes; envelope período at byte offset ${env.offset}: ${JSON.stringify(env.bytes)}  ← the trimestre ${quarterToken}`,
    );
    console.log(
      `OK — quarterly DR303 file self-validated: length 2944, envelope período ${quarterToken} at its documented offset.`,
    );
  } finally {
    await store.close();
    await rm(venueDir, { recursive: true, force: true });
  }
}

// 0-based offsets, hardcoded to keep the demo on the public barrel; the serializer's own test pins
// the same ones (`OFFSET` in packages/reporting/src/dr303.test.ts).
const DR303_BOX_OFFSETS: Readonly<Record<string, { offset: number; len: number }>> = {
  "27": { offset: 1023, len: 17 },
  "46": { offset: 1346, len: 17 },
  // The envelope opens "<T3030" + EEEE + PP + "0000>".
  período: { offset: 10, len: 2 },
};

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

/** An encoder independent of the serializer's own, so a bug there cannot mask itself: cents,
 * right-aligned and zero-filled, a negative value taking an 'N' in position 1. */
function packAeatNumeric(value: Decimal, width: number): string {
  const negative = value.startsWith("-");
  const magnitude = (negative ? value.slice(1) : value).replace(".", "");
  return negative ? "N" + magnitude.padStart(width - 1, "0") : magnitude.padStart(width, "0");
}

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

function validateDr303QuarterPeriod(record: Buffer, modelo: Modelo303, token: string): void {
  const problems: string[] = [];
  if (record.length !== 2944) {
    problems.push(`record is ${record.length} bytes, expected 2944`);
  }
  if (modelo.period.kind !== "quarter") {
    problems.push(`aggregate period kind is ${modelo.period.kind}, expected "quarter"`);
  }
  const env = boxAt(record, "período");
  if (env.bytes !== token) {
    problems.push(
      `envelope período at offset ${env.offset}: ${JSON.stringify(env.bytes)} != expected ${JSON.stringify(token)}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `modelo-303-demo: quarterly DR303 file did not self-validate:\n  ${problems.join("\n  ")}`,
    );
  }
}

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

function qOf(month: number): number {
  return Math.ceil(month / 3);
}

function monthsOfQuarter(quarter: number): [number, number, number] {
  const first = 3 * (quarter - 1) + 1;
  return [first, first + 1, first + 2];
}

function mergeDevengado(returns: readonly VatReturn[]): VatRateLine[] {
  const byRate = new Map<Decimal, { base: Decimal; tax: Decimal }>();
  for (const r of returns) {
    for (const l of r.byRate) {
      const cur = byRate.get(l.rate) ?? { base: decimal("0.00"), tax: decimal("0.00") };
      byRate.set(l.rate, { base: addDecimal(cur.base, l.base), tax: addDecimal(cur.tax, l.tax) });
    }
  }
  return [...byRate.entries()]
    .map(([rate, v]) => ({ rate, base: v.base, tax: v.tax }))
    .sort((a, b) => compareDecimal(a.rate, b.rate));
}

function reconcileQuarterEqualsMonths(
  label: string,
  quarter: VatReturn,
  months: readonly VatReturn[],
): void {
  reconcile(label, quarter, mergeDevengado(months));
  const sumDeducible = sumDecimals(months.map((r) => r.deductible.taxTotal));
  const sumResult = sumDecimals(months.map((r) => r.result));
  const problems: string[] = [];
  if (compareDecimal(quarter.deductible.taxTotal, sumDeducible) !== 0) {
    problems.push(`deducible cuota ${quarter.deductible.taxTotal} != Σ months ${sumDeducible}`);
  }
  if (compareDecimal(quarter.result, sumResult) !== 0) {
    problems.push(`resultado ${quarter.result} != Σ months ${sumResult}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `modelo-303-demo: ${label} — deducible/resultado did not reconcile:\n  ${problems.join("\n  ")}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("modelo-303-demo: failed");
  console.error(error);
  process.exit(1);
});

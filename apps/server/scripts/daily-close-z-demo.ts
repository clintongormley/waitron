// Exercises the frozen daily close (cierre Z): `recordDailyClose` snapshots a day rung up through the
// real write path, reconciles the per-till cash counts and appends a hash-chained `daily_closes` row;
// `verifyDailyCloseChain` re-walks the chain. Runs in a throwaway venue directory against the fake
// `FiscalBackend`. Two closers at once: `packages/reporting/src/record-daily-close.concurrency.test.ts`.
//
// The day it rings up — business day 2026-08-04, Europe/Madrid, across TWO tills at one node:
//   Caja 1: base 100.00 @ 21% → 121.00 CASH  ;  base 40.00 @ 10% → 44.00 CARD
//   Caja 2: base  50.00 @ 10% →  55.00 CASH  ;  base 20.00 @ 21% → 24.20 CARD
// so the VAT summary reads 21%: base 120.00 tax 25.20 ; 10%: base 90.00 tax 9.00 (gross 244.20), and
// the cash-up carries per-till cash takings 121.00 (Caja 1) and 55.00 (Caja 2). The supplied cash
// counts are crafted so the descuadre is visibly non-zero and of both signs:
//   Caja 1 counted 172.50 vs expected 50.00 + 121.00 − 0.00 = 171.00  →  +1.50 (over)
//   Caja 2 counted  83.00 vs expected 30.00 +  55.00 − 0.00 =  85.00  →  −2.00 (short)
//   node_variance = 1.50 − 2.00 = −0.50
// Then: verify the chain (ok), attempt a SECOND close of the same day (rejected `close.already_closed`),
// and close a second business day 2026-08-05 (one 80.00 @ 21% cash sale, counted exact) to show the
// `sequence_no` advancing 1 → 2 while the chain still verifies.
//
// Run it: pnpm --filter @waitron/server demo:daily-close-z
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { recordDailyClose, verifyDailyCloseChain } from "@waitron/reporting";
import type { CashCountInput, DailyCloseRecord } from "@waitron/reporting";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock } from "@waitron/fiscal";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hasCode, isAppError } from "@waitron/shared";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";

const SETS = ["core"];

const LOCALE = "es-ES";
const TIME_ZONE = "Europe/Madrid";
const DAY_CUTOVER = "05:00";
const DAY_ONE = "2026-08-04";
const DAY_TWO = "2026-08-05";

// `recordDailyClose` takes `closedBy` as an opaque person id; this demo applies no identity set.
const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

// 12:00 Madrid, after the 05:00 cutover.
const DAY_ONE_AT = new Date("2026-08-04T10:00:00Z");
const DAY_TWO_AT = new Date("2026-08-05T10:00:00Z");

function fixedClock(instant: Date): TrustedClock {
  return {
    now: () => ({
      instant,
      offsetMinutes: 120,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("daily-close-z-demo: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

interface Venue {
  nodeId: NodeId;
  seriesId: SeriesId;
  caja1: TillId;
  caja2: TillId;
  /** tillId → display name, for the print only. */
  tillNames: Map<string, string>;
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
  const [till1] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const caja1 = brandTillId(till1!.id);
  const [till2] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 2" })
    .returning({ id: tills.id });
  const caja2 = brandTillId(till2!.id);
  const [node] = await db
    .insert(nodes)
    .values({ locationId, name: "Nodo 1" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  const seriesId = brandSeriesId(series!.id);
  const tillNames = new Map<string, string>([
    [caja1, "Caja 1"],
    [caja2, "Caja 2"],
  ]);
  return { nodeId, seriesId, caja1, caja2, tillNames };
}

interface SaleSpec {
  till: TillId;
  base: string;
  vatRate: string;
  total: string;
  method: string;
  description: string;
  at: Date;
}

async function ringSale(
  db: Database,
  venue: Venue,
  backend: FakeFiscalBackend,
  spec: SaleSpec,
): Promise<void> {
  const input: RecordSaleInput = {
    tillId: spec.till,
    nodeId: venue.nodeId,
    seriesId: venue.seriesId,
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    total: spec.total,
    lines: [
      {
        lineNo: 1,
        name: spec.description,
        descriptions: { [LOCALE]: spec.description },
        quantity: "1",
        unitPrice: spec.base,
        vatRate: spec.vatRate,
        lineTotal: spec.base,
      },
    ],
    clock: fixedClock(spec.at),
    settlement: {
      kind: "immediate",
      tenders: [{ method: spec.method, amount: spec.total, tipAmount: "0.00", settledAt: spec.at }],
    },
  };
  await withTransaction(db, async (tx) => {
    await recordSale(tx, backend, input);
  });
}

function closeDay(
  db: Database,
  venue: Venue,
  businessDay: string,
  cashCounts: CashCountInput[],
): Promise<DailyCloseRecord> {
  return withTransaction(db, async (tx) => {
    return recordDailyClose(tx, {
      nodeId: venue.nodeId,
      businessDay,
      timeZone: TIME_ZONE,
      dayCutover: DAY_CUTOVER,
      closedBy: CLOSED_BY,
      cashCounts,
    });
  });
}

function verifyChain(db: Database, venue: Venue) {
  return withTransaction(db, async (tx) => {
    return verifyDailyCloseChain(tx, venue.nodeId);
  });
}

/** Right-signs a money variance: "-2.00" stays, "0.00" stays, "1.50" → "+1.50". */
function signed(v: string): string {
  if (v.startsWith("-") || v === "0.00") return v;
  return `+${v}`;
}

function label(v: string): string {
  if (v.startsWith("-")) return "short";
  if (v === "0.00") return "exact";
  return "over";
}

function printRecord(venue: Venue, rec: DailyCloseRecord): void {
  const close = rec.snapshot.close;
  console.log(`Business day ${rec.businessDay} closed for node ${venue.nodeId}`);
  console.log(`  sequence_no     : ${rec.sequenceNo}`);
  console.log(`  prev_entry_hash : ${rec.prevEntryHash === "" ? "(genesis)" : rec.prevEntryHash}`);
  console.log(`  entry_hash      : ${rec.entryHash}`);

  console.log("  VAT summary (from the frozen snapshot):");
  for (const r of close.vat.byRate) {
    console.log(`    ${r.rate}%  base ${r.base}  tax ${r.tax}`);
  }
  console.log(
    `    total base ${close.vat.baseTotal}  tax ${close.vat.taxTotal}  gross ${close.vat.grossTotal}`,
  );
  console.log(
    `  counts: sales ${close.counts.sales}, corrections ${close.counts.corrections}, voids ${close.counts.voids}`,
  );

  console.log("  Cash-up (per till):");
  for (const t of close.cash.byTill) {
    const name = venue.tillNames.get(t.tillId) ?? t.tillId;
    const methods = t.byMethod.map((m) => `${m.method} ${m.amount}`).join("  ");
    console.log(`    ${name}: ${methods}  | cashTakings ${t.cashTakings}`);
  }
  console.log(`    tenderTotal ${close.cash.tenderTotal}  tipTotal ${close.cash.tipTotal}`);

  console.log("  Cash reconciliation (descuadre):");
  for (const r of rec.snapshot.cashReconciliation.byTill) {
    const name = venue.tillNames.get(r.tillId) ?? r.tillId;
    const parts = `opening ${r.openingFloat}  takings ${r.cashTakings}  payouts ${r.payouts}`;
    const counted = `counted ${r.countedCash}`;
    console.log(
      `    ${name}: ${parts}  ${counted}  →  ${signed(r.cashVariance)} (${label(r.cashVariance)})`,
    );
  }
  console.log(`    node_variance: ${rec.snapshot.cashReconciliation.nodeVariance}`);
}

async function main(): Promise<void> {
  const venueDir = await mkdtemp(join(tmpdir(), "daily-close-z-demo-"));
  const sets = manifestSets().filter((set) => SETS.includes(set.name));
  await applyMigrations(venueDir, migrationOptionsFor(sets, null));
  const store = await openVenueDatabase(venueDir);
  const db = store.venue;
  try {
    await FakeFiscalBackend.install(db);
    const venue = await seedVenue(db);
    const backend = new FakeFiscalBackend(db);

    // A one-time admin action recordSale never performs.
    await withTransaction(db, async (tx) => {
      await backend.registerNode(tx, venue.nodeId);
    });

    const c1 = venue.caja1;
    const c2 = venue.caja2;
    const day1: SaleSpec[] = [
      {
        till: c1,
        base: "100.00",
        vatRate: "21.00",
        total: "121.00",
        method: "cash",
        description: "Menú del día",
        at: DAY_ONE_AT,
      },
      {
        till: c1,
        base: "40.00",
        vatRate: "10.00",
        total: "44.00",
        method: "card",
        description: "Cesta de productos",
        at: DAY_ONE_AT,
      },
      {
        till: c2,
        base: "50.00",
        vatRate: "10.00",
        total: "55.00",
        method: "cash",
        description: "Tabla de quesos",
        at: DAY_ONE_AT,
      },
      {
        till: c2,
        base: "20.00",
        vatRate: "21.00",
        total: "24.20",
        method: "card",
        description: "Vino de la casa",
        at: DAY_ONE_AT,
      },
    ];
    for (const spec of day1) await ringSale(db, venue, backend, spec);

    console.log("=== Frozen daily close (cierre Z) demo ===\n");

    const rec1 = await closeDay(db, venue, DAY_ONE, [
      { tillId: venue.caja1, openingFloat: "50.00", payouts: "0.00", countedCash: "172.50" }, // 50+121−0=171 → +1.50
      { tillId: venue.caja2, openingFloat: "30.00", payouts: "0.00", countedCash: "83.00" }, //  30+55−0=85  → −2.00
    ]);
    printRecord(venue, rec1);

    const v1 = await verifyChain(db, venue);
    console.log(`\nverifyDailyCloseChain → ok: ${v1.ok}`);

    // One close per day.
    console.log("\nAttempting a second close of the same day…");
    try {
      await closeDay(db, venue, DAY_ONE, [
        { tillId: venue.caja1, openingFloat: "50.00", payouts: "0.00", countedCash: "172.50" },
        { tillId: venue.caja2, openingFloat: "30.00", payouts: "0.00", countedCash: "83.00" },
      ]);
      throw new Error("demo invariant: the second close should have been rejected");
    } catch (error) {
      if (isAppError(error) && hasCode(error, "close.already_closed")) {
        console.log(`  rejected: ${error.code} (businessDay ${error.params.businessDay})`);
      } else {
        throw error;
      }
    }

    await ringSale(db, venue, backend, {
      till: venue.caja1,
      base: "80.00",
      vatRate: "21.00",
      total: "96.80",
      method: "cash",
      description: "Menú del día",
      at: DAY_TWO_AT,
    });
    console.log("");
    const rec2 = await closeDay(db, venue, DAY_TWO, [
      { tillId: venue.caja1, openingFloat: "100.00", payouts: "0.00", countedCash: "196.80" }, // 100+96.80 → 0.00 exact
    ]);
    printRecord(venue, rec2);

    const v2 = await verifyChain(db, venue);
    console.log(`\nverifyDailyCloseChain → ok: ${v2.ok}`);
  } finally {
    await store.close();
    await rm(venueDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("daily-close-z-demo: failed");
  console.error(error);
  process.exit(1);
});

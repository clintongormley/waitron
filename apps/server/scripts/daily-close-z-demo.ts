// Self-contained, human-checkable demonstration of `@waitron/reporting`'s FROZEN daily close (cierre
// Z, design 8b), modelled on its sibling `daily-close-demo.ts` (#56, the derived VAT-exact close).
// Where that demo prints the DERIVED close (`computeDailyClose`, a pure read), this one exercises the
// WRITE path: `recordDailyClose` snapshots the day, reconciles the physical cash counts per till,
// appends one immutable hash-chained `daily_closes` row, and `verifyDailyCloseChain` re-walks the
// chain. It boots an in-memory PGlite (a WASM PostgreSQL), applies `@waitron/db`'s CORE_MIGRATIONS
// (whose 0033 creates `daily_closes` + `daily_close_chain`), and rings a real day of trade through
// the REAL write path (`recordSale` from `@waitron/core`) against the fake `FiscalBackend` from
// `@waitron/fiscal` — no external Postgres, no AEAT, no SIF registration.
//
// PGlite is the right target for a demo: everything shown here is deterministic logic over immutable
// commercial rows (the snapshot, the per-till variance arithmetic, the hash chain). The non-superuser
// deployment role, FORCE RLS and two-writer contention — the three things PGlite cannot show — are
// covered by `record-daily-close.rls.test.ts` on real Postgres, not by a demo.
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
// Run it:
//   pnpm --filter @waitron/server exec tsx scripts/daily-close-z-demo.ts
//   # or, via the package script:
//   pnpm --filter @waitron/server demo:daily-close-z
import { sql } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { recordDailyClose, verifyDailyCloseChain } from "@waitron/reporting";
import type { CashCountInput, DailyCloseRecord } from "@waitron/reporting";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock } from "@waitron/fiscal";
import { CORE_MIGRATIONS, asAppUser, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { hasCode, isAppError } from "@waitron/shared";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";

const LOCALE = "es-ES";
const TIME_ZONE = "Europe/Madrid";
const DAY_CUTOVER = "05:00";
const DAY_ONE = "2026-08-04";
const DAY_TWO = "2026-08-05";

// The counting actor. A plain uuid string: `recordDailyClose` takes `closedBy` as an opaque identity
// person id and deliberately does NOT depend on the identity schema (a later slice).
const CLOSED_BY = "cccccccc-0000-4000-8000-000000000001";

// Each business day's issuance instant, 12:00 Madrid (10:00Z, +02:00 CEST), after the 05:00 cutover.
const DAY_ONE_AT = new Date("2026-08-04T10:00:00Z");
const DAY_TWO_AT = new Date("2026-08-05T10:00:00Z");

/**
 * A `TrustedClock` fixed at `instant`. `recordSale` reads `now()` exactly once (for `issued_at`) and
 * never touches `anchor`/`currentAnchor`, so both are stubs — the shape the sibling demo documents.
 */
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
  tenantId: TenantId;
  nodeId: NodeId;
  seriesId: SeriesId;
  caja1: TillId;
  caja2: TillId;
  /** tillId → display name, for the print only. */
  tillNames: Map<string, string>;
}

/**
 * Seeds tenant → location → two tills → node → standard series as the PGlite superuser (which
 * bypasses RLS), exactly as the package's own fixtures do — `app_user` holds no INSERT on `tenants`,
 * deliberately (a running POS cannot create tenants).
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
  const till1 = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`,
  );
  const caja1 = brandTillId(till1.rows[0]!.id);
  const till2 = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 2') returning id`,
  );
  const caja2 = brandTillId(till2.rows[0]!.id);
  const node = await db.execute<{ id: string }>(
    sql`insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Nodo 1') returning id`,
  );
  const nodeId = brandNodeId(node.rows[0]!.id);
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  const tillNames = new Map<string, string>([
    [caja1, "Caja 1"],
    [caja2, "Caja 2"],
  ]);
  return { tenantId, nodeId, seriesId, caja1, caja2, tillNames };
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

/** Rings one immediate-settlement sale through the real `recordSale` write path. */
async function ringSale(
  db: Database,
  venue: Venue,
  backend: FakeFiscalBackend,
  spec: SaleSpec,
): Promise<void> {
  const input: RecordSaleInput = {
    tenantId: venue.tenantId,
    tillId: spec.till,
    nodeId: venue.nodeId,
    seriesId: venue.seriesId,
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    total: spec.total,
    lines: [
      {
        lineNo: 1,
        descriptions: { [LOCALE]: spec.description },
        quantity: "1",
        unitPrice: spec.base,
        vatRate: spec.vatRate,
        lineTotal: spec.base,
      },
    ],
    fiscalBackend: "fake",
    clock: fixedClock(spec.at),
    settlement: {
      kind: "immediate",
      tenders: [{ method: spec.method, amount: spec.total, tipAmount: "0.00", settledAt: spec.at }],
    },
  };
  await withTenant(db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    await recordSale(tx, backend, input);
  });
}

/** `recordDailyClose` for one business day, run RLS-safe as the application role. */
function closeDay(
  db: Database,
  venue: Venue,
  businessDay: string,
  cashCounts: CashCountInput[],
): Promise<DailyCloseRecord> {
  return withTenant(db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return recordDailyClose(tx, {
      tenantId: venue.tenantId,
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
  return withTenant(db, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    return verifyDailyCloseChain(tx, venue.tenantId, venue.nodeId);
  });
}

// ---- Printing helpers (source kept short so the whole file stays prettier-clean) ----

/** Right-signs a money variance: "-2.00" stays, "0.00" stays, "1.50" → "+1.50". */
function signed(v: string): string {
  if (v.startsWith("-") || v === "0.00") return v;
  return `+${v}`;
}

/** over / short / exact, from the variance sign. */
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
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    await FakeFiscalBackend.install(db);
    const venue = await seedVenue(db);
    const backend = new FakeFiscalBackend(db);

    // Register the node once (a one-time admin action recordSale itself never performs), as app_user
    // in its own committed transaction so the later write transactions see it.
    await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      await backend.registerNode(tx, venue.nodeId, { tenantId: venue.tenantId });
    });

    // Ring the day's trade across the two tills — a cash and a card tender at each.
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

    // Close day one with per-till counts crafted for an over (Caja 1) and a short (Caja 2).
    const rec1 = await closeDay(db, venue, DAY_ONE, [
      { tillId: venue.caja1, openingFloat: "50.00", payouts: "0.00", countedCash: "172.50" }, // 50+121−0=171 → +1.50
      { tillId: venue.caja2, openingFloat: "30.00", payouts: "0.00", countedCash: "83.00" }, //  30+55−0=85  → −2.00
    ]);
    printRecord(venue, rec1);

    const v1 = await verifyChain(db, venue);
    console.log(`\nverifyDailyCloseChain → ok: ${v1.ok}`);

    // A second close of the SAME day is rejected — the day is already closed (one close per day).
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

    // Close a SECOND business day to show sequence_no advancing 1 → 2, the chain still verifying.
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
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("daily-close-z-demo: failed");
  console.error(error);
  process.exit(1);
});

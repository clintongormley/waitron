// Rings up a day of trade through the real write path against the fake `FiscalBackend`, in a
// throwaway venue directory, and prints `@waitron/reporting`'s `DailyClose` for a human to check.
//
// Run it: pnpm --filter @waitron/server demo:daily-close
//
// The day it rings up (all on business day 2026-08-04, Europe/Madrid):
//   - Sale A: base 100.00 @ 21%, total 121.00, settled IMMEDIATELY in cash (121.00);
//   - Sale B: base  50.00 @ 10%, total  55.00, recorded DEFERRED then settled later by CARD (55.00);
//   - a rectificativa correcting Sale A by −5.00 base @ 21% (total −6.05).
//
// So the printed close should read:
//   vat.byRate      → 10%: base 50.00, tax 5.00 ; 21%: base 95.00, tax 19.95 (100 − 5, netted)
//   vat.grossTotal  → 169.95  (= 121.00 + 55.00 − 6.05: sales totals net of the correction)
//   cash.byTill[0]  → cashTakings 121.00 (only the cash tender), tenderTotal 176.00 (cash 121 + card 55)
//   counts          → sales 2, corrections 1, voids 0
// grossTotal (169.95) deliberately differs from tenderTotal (176.00): a correction lowers declared
// VAT, but the cash was collected before it and a refund is a separate payments action, never a
// negative tender (design §5).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeDailyClose } from "@waitron/reporting";
import { recordCorrection, recordSale, settleSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
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
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";

/** identity holds the supervisor who authorises the rectificativa. */
const SETS = ["core", "identity"];

const LOCALE = "es-ES";
const TIME_ZONE = "Europe/Madrid";
const BUSINESS_DAY = "2026-08-04";

// 2026-08-04 12:00 Madrid, so every write lands on business day 2026-08-04.
const ISSUED_AT = new Date("2026-08-04T10:00:00Z");
// 18:00 Madrid, the same business day.
const SETTLED_LATER = new Date("2026-08-04T16:00:00Z");

function fixedClock(): TrustedClock {
  return {
    now: () => ({
      instant: ISSUED_AT,
      offsetMinutes: 120,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("daily-close-demo: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

interface Venue {
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
  rectificativeSeriesId: SeriesId;
  // `recordCorrection` gates on `sale.rectify`, which a supervisor holds.
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
  const [rSeries] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "R", purpose: "rectificative" })
    .returning({ id: invoiceSeries.id });
  const rectificativeSeriesId = brandSeriesId(rSeries!.id);
  const [person] = await db
    .insert(persons)
    .values({
      displayName: "Supervisora",
      email: "supervisor@daily-close.demo",
      pinHash: hashPin("1234"),
      role: "supervisor",
    })
    .returning({ id: persons.id });
  const authorizerId = person!.id;
  return { tillId, nodeId, seriesId, rectificativeSeriesId, authorizerId };
}

async function main(): Promise<void> {
  const venueDir = await mkdtemp(join(tmpdir(), "daily-close-demo-"));
  const sets = manifestSets().filter((set) => SETS.includes(set.name));
  await applyMigrations(venueDir, migrationOptionsFor(sets, null));
  const store = await openVenueDatabase(venueDir);
  const db = store.venue;
  try {
    await FakeFiscalBackend.install(db);
    const venue = await seedVenue(db);
    const backend = new FakeFiscalBackend(db);
    const clock = fixedClock();

    // A one-time admin action recordSale never performs.
    await withTransaction(db, async (tx) => {
      await backend.registerNode(tx, venue.nodeId);
    });

    // Sale A — immediate cash settlement, base 100.00 @ 21%.
    const saleAInput: RecordSaleInput = {
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: "121.00",
      lines: [
        {
          lineNo: 1,
          name: "Menú del día",
          descriptions: { [LOCALE]: "Menú del día" },
          quantity: "1",
          unitPrice: "100.00",
          vatRate: "21.00",
          lineTotal: "100.00",
        },
      ],
      clock,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "121.00", tipAmount: "0.00", settledAt: ISSUED_AT }],
      },
    };
    const saleA = await withTransaction(db, async (tx) => {
      return recordSale(tx, backend, saleAInput);
    });

    // Sale B — deferred (invoice-first), base 50.00 @ 10%.
    const saleBInput: RecordSaleInput = {
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: "55.00",
      lines: [
        {
          lineNo: 1,
          name: "Cesta de productos",
          descriptions: { [LOCALE]: "Cesta de productos" },
          quantity: "1",
          unitPrice: "50.00",
          vatRate: "10.00",
          lineTotal: "50.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
    };
    const saleB = await withTransaction(db, async (tx) => {
      return recordSale(tx, backend, saleBInput);
    });

    // Settle Sale B later the same day, by card.
    await withTransaction(db, async (tx) => {
      await settleSale(tx, {
        saleId: saleB.saleId,
        tenders: [{ method: "card", amount: "55.00", tipAmount: "0.00", settledAt: SETTLED_LATER }],
      });
    });

    const authorizerSession = await withTransaction(db, async (tx) => {
      return loginWithPin(tx, {
        tillId: venue.tillId,
        personId: venue.authorizerId,
        pin: "1234",
      });
    });

    // Corrects Sale A by −5.00 base @ 21% (total −6.05).
    const correctionInput: RecordCorrectionInput = {
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.rectificativeSeriesId,
      correctsSaleId: saleA.saleId,
      total: "-6.05",
      lines: [
        {
          lineNo: 1,
          name: "Rectificación menú del día",
          descriptions: { [LOCALE]: "Rectificación menú del día" },
          quantity: "1",
          unitPrice: "-5.00",
          vatRate: "21.00",
          lineTotal: "-5.00",
        },
      ],
      clock,
      authz: { sessionId: authorizerSession.id },
    };
    await withTransaction(db, async (tx) => {
      await recordCorrection(tx, backend, correctionInput);
    });

    const close = await withTransaction(db, async (tx) => {
      return computeDailyClose(tx, {
        nodeId: venue.nodeId,
        businessDay: BUSINESS_DAY,
        timeZone: TIME_ZONE,
        dayCutover: "05:00",
      });
    });

    console.log(JSON.stringify(close, null, 2));
  } finally {
    await store.close();
    await rm(venueDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("daily-close-demo: failed");
  console.error(error);
  process.exit(1);
});

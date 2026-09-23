// Self-contained, human-checkable demonstration of `@waitron/reporting`'s daily close (design D9,
// modelled on `record-one-sale.ts`). It makes a throwaway venue directory under the OS temp dir,
// applies the `core` and `identity` migration sets to it through `applyMigrations` (the entry
// point `dev-setup.ts` also uses), and rings up a real day of trade through the REAL write path
// (`recordSale` / `settleSale` / `recordCorrection` from `@waitron/core`) against the fake
// `FiscalBackend` from `@waitron/fiscal` — no AEAT and no SIF registration. It then prints the
// `DailyClose` for that day so a human can eyeball that the numbers reconcile, and removes the
// directory.
//
// `computeDailyClose` reads only the commercial tables (`sales`, `sale_lines`, `tenders`,
// `sale_voids`, `sale_substitutions`), all of which the `core` set creates — the fiscal chain is
// never read. The `identity` set is here for the supervisor whose session authorises the
// rectificativa, nothing else.
//
// SQLite has no roles and no grants: nothing below demonstrates who may write.
//
// Run it:
//   pnpm --filter @waitron/server exec tsx scripts/daily-close-demo.ts
//   # or, via the package script:
//   pnpm --filter @waitron/server demo:daily-close
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

/** The migration sets this demo applies, in manifest order — core carries the commercial tables
 * the close reads, identity the supervisor who authorises the rectificativa. */
const SETS = ["core", "identity"];

const LOCALE = "es-ES";
const TIME_ZONE = "Europe/Madrid";
const BUSINESS_DAY = "2026-08-04";

// Every write's issuance instant: 2026-08-04 12:00 Madrid (10:00Z, +02:00 CEST). One fixed clock,
// so all three writes land on business day 2026-08-04.
const ISSUED_AT = new Date("2026-08-04T10:00:00Z");
// The deferred sale's card payment, later the same business day (18:00 Madrid).
const SETTLED_LATER = new Date("2026-08-04T16:00:00Z");

/**
 * A `TrustedClock` whose `now()` is fixed at `ISSUED_AT`. `recordSale`/`recordCorrection` read
 * `now()` exactly once (for `issued_at`) and never touch `anchor`/`currentAnchor`, so both are
 * stubs — the identical shape `record-one-sale.ts`'s own `systemClock` documents.
 */
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
  // The person who authorises the rectificativa. `recordCorrection` now gates on `sale.rectify`
  // (Task 10); a supervisor holds it. Task 13's venue-seed comes later, so this demo seeds its own.
  authorizerId: string;
}

/**
 * Seeds tenant → location → till → node → standard series → rectificative series → supervisor.
 *
 * Drizzle inserts rather than the raw SQL that was here: these `id` columns no longer carry a SQL
 * DEFAULT — the value comes from `$defaultFn(newId)`, which drizzle's insert builder runs and raw
 * SQL does not (`packages/db/src/schema/columns.ts`) — and `invoice_locales` is a JSON array in a
 * text column, not the PostgreSQL `array['es-ES']` this used to write.
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
  // A supervisor (holds `sale.rectify`), whose PIN is "1234" — the authorizer the rectificativa's
  // gate requires.
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
  // A throwaway venue directory: the two SQLite files plus their write-ahead sidecars, removed at
  // the end. `applyMigrations` takes the DIRECTORY and opens it itself; it applies identity AFTER
  // core, the order the manifest states, because identity's `persons`/`sessions` carry a foreign
  // key onto core's `tenants`/`tills` — recordCorrection's `sale.rectify` gate reads both.
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

    // Register the node once (a one-time admin action recordSale itself never performs), in its own
    // committed transaction so the later write transactions see it.
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

    // Open the supervisor's shift session — the authorizer the rectificativa's `sale.rectify` gate
    // requires — exactly as a till would at the start of a shift.
    const authorizerSession = await withTransaction(db, async (tx) => {
      return loginWithPin(tx, {
        tillId: venue.tillId,
        personId: venue.authorizerId,
        pin: "1234",
      });
    });

    // A rectificativa correcting Sale A by −5.00 base @ 21% (total −6.05), authorised by the
    // supervisor session opened above.
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

    // The read, exactly as a till/report consumer would call it.
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

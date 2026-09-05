// Self-contained, human-checkable demonstration of `@waitron/reporting`'s daily close (design D9,
// modelled on `record-one-sale.ts`). It boots an in-memory PGlite (a WASM PostgreSQL), applies
// `@waitron/db`'s CORE_MIGRATIONS, and rings up a real day of trade through the REAL write path
// (`recordSale` / `settleSale` / `recordCorrection` from `@waitron/core`) against the fake
// `FiscalBackend` from `@waitron/fiscal` — no external Postgres, no AEAT, no SIF registration. It
// then prints the `DailyClose` for that day so a human can eyeball that the numbers reconcile.
//
// Because `computeDailyClose` reads only the commercial tables (`sales`, `sale_lines`, `tenders`,
// `sale_voids`, `sale_substitutions`), CORE_MIGRATIONS alone suffices — the fiscal chain is never
// read.
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
import { sql } from "drizzle-orm";
import { computeDailyClose } from "@waitron/reporting";
import { recordCorrection, recordSale, settleSale } from "@waitron/core";
import type { RecordCorrectionInput, RecordSaleInput } from "@waitron/core";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { TrustedClock } from "@waitron/fiscal";
import { CORE_MIGRATIONS, asAppUser, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";

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
  tenantId: TenantId;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
  rectificativeSeriesId: SeriesId;
  // The person who authorises the rectificativa. `recordCorrection` now gates on `sale.rectify`
  // (Task 10); a supervisor holds it. Task 13's venue-seed comes later, so this demo seeds its own.
  authorizerId: string;
}

/**
 * Seeds tenant → location → till → node → standard series → rectificative series as the PGlite
 * superuser (which bypasses RLS), exactly as the package's own test fixtures do — `app_user` holds
 * no INSERT on `tenants`, deliberately (a running POS cannot create tenants).
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
  const node = await db.execute<{ id: string }>(
    sql`insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Nodo 1') returning id`,
  );
  const nodeId = brandNodeId(node.rows[0]!.id);
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  const rSeries = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose)
    values (${tenantId}, ${nodeId}, 'R', 'rectificative') returning id`);
  const rectificativeSeriesId = brandSeriesId(rSeries.rows[0]!.id);
  // A supervisor (holds `sale.rectify`), whose PIN is "1234", inserted as the PGlite superuser like
  // everything else here — the authorizer the rectificativa's gate requires.
  const person = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role)
    values (${tenantId}, 'Supervisora', ${hashPin("1234")}, 'supervisor') returning id`);
  const authorizerId = person.rows[0]!.id;
  return { tenantId, tillId, nodeId, seriesId, rectificativeSeriesId, authorizerId };
}

async function main(): Promise<void> {
  const db = await createPgliteDb();
  try {
    await runMigrations(db, CORE_MIGRATIONS);
    // IDENTITY_MIGRATIONS after CORE: identity's `persons`/`sessions` carry a foreign key onto
    // core's `tenants`/`tills`. recordCorrection's `sale.rectify` gate reads both.
    await runMigrations(db, IDENTITY_MIGRATIONS);
    await FakeFiscalBackend.install(db);
    const venue = await seedVenue(db);
    const backend = new FakeFiscalBackend(db);
    const clock = fixedClock();

    // Register the node once (a one-time admin action recordSale itself never performs), as app_user
    // in its own committed transaction so the later write transactions see it.
    await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      await backend.registerNode(tx, venue.nodeId, { tenantId: venue.tenantId });
    });

    // Sale A — immediate cash settlement, base 100.00 @ 21%.
    const saleAInput: RecordSaleInput = {
      tenantId: venue.tenantId,
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: "121.00",
      lines: [
        {
          lineNo: 1,
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
    const saleA = await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, saleAInput);
    });

    // Sale B — deferred (invoice-first), base 50.00 @ 10%.
    const saleBInput: RecordSaleInput = {
      tenantId: venue.tenantId,
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.seriesId,
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      total: "55.00",
      lines: [
        {
          lineNo: 1,
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
    const saleB = await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, saleBInput);
    });

    // Settle Sale B later the same day, by card.
    await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      await settleSale(tx, {
        tenantId: venue.tenantId,
        saleId: saleB.saleId,
        tenders: [{ method: "card", amount: "55.00", tipAmount: "0.00", settledAt: SETTLED_LATER }],
      });
    });

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

    // A rectificativa correcting Sale A by −5.00 base @ 21% (total −6.05), authorised by the
    // supervisor session opened above.
    const correctionInput: RecordCorrectionInput = {
      tenantId: venue.tenantId,
      tillId: venue.tillId,
      nodeId: venue.nodeId,
      seriesId: venue.rectificativeSeriesId,
      correctsSaleId: saleA.saleId,
      total: "-6.05",
      lines: [
        {
          lineNo: 1,
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
    await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      await recordCorrection(tx, backend, correctionInput);
    });

    // The read: RLS-safe, as the application role, exactly as a till/report consumer would call it.
    const close = await withTenant(db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return computeDailyClose(tx, {
        tenantId: venue.tenantId,
        nodeId: venue.nodeId,
        businessDay: BUSINESS_DAY,
        timeZone: TIME_ZONE,
        dayCutover: "05:00",
      });
    });

    console.log(JSON.stringify(close, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("daily-close-demo: failed");
  console.error(error);
  process.exit(1);
});

// Self-contained, human-checkable demonstration of the catalogue slice's central seam: a real sale,
// chained through the REAL Veri*Factu backend, whose lines / total / VAT desglose come ENTIRELY from
// catalogue data. Modelled on `daily-close-demo.ts` (self-migrating, tsx-run) and `record-one-sale.ts`
// (real `VerifactuBackend` construction), it:
//
//   1. connects to a FRESH postgres (via `DATABASE_URL`) and applies the core, identity and fiscal
//      migrations itself — so it runs against a blank `postgres:18-alpine` with nothing pre-seeded;
//   2. stands up a real chained venue + registered SIF with `applyVenue` (@waitron/provisioning);
//   3. seeds a catalogue — one `each` product, one `weight` product (Spanish names are fine: apps/*
//      is out of the english-only guard's scope);
//   4. reads the sellable products with `listAvailableProducts`, prices a basket with `priceBasket`;
//   5. rings the sale with `recordSale`, handing it the priced `{ lines, total, vatBreakdown }`;
//   6. prints the sale id, total and desglose so a human can eyeball that total == Σ(base + tax).
//
// Unlike `daily-close-demo.ts` (which boots an in-memory PGlite) this uses a real PostgreSQL, because
// the whole point is to chain through the real `VerifactuBackend` — a huella-chained, append-only
// `registros_facturacion` row that PGlite's superuser-only connection cannot prove the app role is
// permitted to write. `resolveClient` is supplied but never called: `recordSale` never contacts AEAT
// (that is `drain`'s job), so the stub below throws if it is ever reached.
//
// Run it against a throwaway database (NEVER a real one — it creates a tenant and chains a real
// fiscal record, and a pre-production stamp on a production chain is unrecoverable, see §5):
//
//   docker run --rm -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:18-alpine
//   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres WAITRON_ENV=preproduction \
//     pnpm --filter @waitron/server demo:catalogue
//
// `WAITRON_ENV` defaults to `preproduction` (the safe reading of "unset", config.ts), which is the
// only environment this demo should ever run in.
import { randomUUID } from "node:crypto";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { FISCAL_MIGRATIONS } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  asAppUser,
  createPostgresDb,
  runMigrations,
  withTenant,
} from "@waitron/db";
import { IDENTITY_MIGRATIONS, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
  priceBasket,
} from "@waitron/catalogue";
import { deploymentEnvironment } from "../src/config.js";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";

const LOCALE = "es-ES";

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical shape `record-one-sale.ts`'s `systemClock` documents. `recordSale` reads `now()` exactly
 * once and touches neither `anchor` nor `currentAnchor`, so both are stubs.
 */
function systemClock(): TrustedClock {
  return {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("catalogue-demo: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("catalogue-demo: DATABASE_URL must be set in the environment");
    process.exit(1);
  }

  const db = await createPostgresDb(databaseUrl);
  try {
    // Self-migrate a blank database, exactly as daily-close-demo self-migrates PGlite. CORE first
    // (identity's persons FK onto core's tenants/tills; the fiscal chain reads core's sales), then
    // identity (applyVenue's seed-admin needs `persons`), then fiscal (registerSif needs
    // `registro_sif`/`cadenas`; recordSale's chain needs `registros_facturacion`).
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, IDENTITY_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // Stand up a real chained venue + registered SIF via the production provisioning path. Run as the
    // connection owner (this superuser owns the tables it just migrated) — applyVenue inserts the
    // tenant and registers the SIF, neither of which the app role may do.
    const venue = await applyVenue(
      planVenue({
        country: "ES",
        taxId: "50000000K",
        legalName: "Deli Demo SL",
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
        // The initial admin (PIN "1234"), hashed at this boundary — a plaintext PIN never enters the
        // plan or any action.
        admin: { displayName: "Administradora", pinHash: hashPin("1234") },
      }),
      { db },
    );

    const tenantId = brandTenantId(venue.tenantId);
    const tillId = brandTillId(venue.tillId);
    const nodeId = brandNodeId(venue.nodeId);
    // planVenue emits the standard series first, then the rectificative one; applyVenue returns them
    // in that order, so the ordinary sale draws from seriesIds[0].
    const seriesId = brandSeriesId(venue.seriesIds[0]!);

    // Seed a catalogue as the application role (not the owner): one weight-priced product, one
    // each-priced product, in two categories, then assign it to the venue's location. Spanish names
    // are fine here — apps/* is out of the english-only guard's scope.
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const comida = await createCategory(tx, { name: "Comida" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { [LOCALE]: "Jamón cortado" },
        pricingUnit: "weight",
        unitPrice: "24.90", // €/kg, gross (VAT-inclusive)
        vatClass: "reduced",
      });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { [LOCALE]: "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50", // €/item, gross
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    });

    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db,
      // Which QR-validation host `verificationUrl` names, and — separately — which environment this
      // registro is generated FOR (the `entorno` stamp `drain` later checks). Both from the same
      // resolver, defaulting to the safe `preproduction`. See record-one-sale.ts for why the two are
      // distinct fields sharing one value here.
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      // Never invoked by `recordSale` (see this file's header) — a rejection here surfaces a bug in
      // this script or the backend, never a real AEAT contact.
      resolveClient: () =>
        Promise.reject(
          new Error("catalogue-demo: resolveClient must never be called by recordSale"),
        ),
    });

    // The seam under proof: read the sellable products, price a basket, ring the sale — every fiscal
    // figure originating in the catalogue. Run as the application role, in one transaction.
    const { saleId, priced } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const available = await listAvailableProducts(tx, venue.locationId);
      // 0.320 kg of ham + 2 waters — quantities a till would capture (a scale reading and a count).
      const priced = priceBasket([
        { product: available.find((p) => p.pricingUnit === "weight")!, quantity: "0.320" },
        { product: available.find((p) => p.pricingUnit === "each")!, quantity: "2" },
      ]);
      const input: RecordSaleInput = {
        tenantId,
        tillId,
        nodeId,
        seriesId,
        workingOrderId: brandWorkingOrderId(randomUUID()),
        locale: LOCALE,
        invoiceLocales: [LOCALE],
        total: priced.total,
        lines: priced.lines,
        // The catalogue's gross-inclusive difference-method desglose, filed verbatim.
        vatBreakdown: priced.vatBreakdown,
        fiscalBackend: "verifactu",
        clock,
        // Invoice-first: no tender, so the demo stays on the catalogue → pricing → fiscal seam and
        // needs no settlement wiring. The invoice is the fiscal event; payment is separate.
        settlement: { kind: "deferred" },
      };
      const result = await recordSale(tx, backend, input);
      return { saleId: result.saleId, priced };
    });

    console.log("catalogue-demo: a sale rung entirely from catalogue data");
    console.log(`  saleId:   ${saleId}`);
    console.log(`  total:    ${priced.total}`);
    console.log("  desglose (VAT breakdown):");
    for (const line of priced.vatBreakdown) {
      console.log(`    rate ${line.rate}%  base ${line.base}  tax ${line.tax}`);
    }
    console.log("  lines:");
    for (const line of priced.lines) {
      console.log(
        `    ${line.descriptions[LOCALE]!}  qty ${line.quantity}  base ${line.lineTotal}  vat ${line.vatRate}%`,
      );
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("catalogue-demo: failed");
  console.error(error);
  process.exit(1);
});

// Self-contained, human-checkable demonstration of park & retrieve (Counter POS, sub-project 7b): a
// counter parks an order on ONE register and a DIFFERENT register on the same node lists it, retrieves
// it and pays it — the held list is shared across every till on the node, not owned by the one that
// parked it. Modelled on `till-demo.ts` / `catalogue-demo.ts` (self-migrating, tsx-run, a real
// `VerifactuBackend`), it:
//
//   1. connects to a FRESH postgres (via `DATABASE_URL`) and applies the core, identity and fiscal
//      migrations itself — so it runs against a blank `postgres:18-alpine` with nothing pre-seeded;
//   2. stands up a real chained venue + registered SIF with `applyVenue` (@waitron/provisioning) whose
//      first till is "Caja 1", then adds a SECOND till "Caja 2" on the same node/location;
//   3. seeds a catalogue (one `weight` product, one `each` product) — Spanish names are fine, apps/* is
//      out of the english-only guard's scope;
//   4. rings a walk-up cash sale on Caja 1 (so the node's chain already has a link), then PARKS an
//      order on Caja 1, LISTS + RETRIEVES + PAYS it on Caja 2, and confirms the huella chain across
//      BOTH sales is intact (`checkIntegrity`);
//   5. prints the parked order's number/label, the held list Caja 2 sees, and the ticket Caja 2's pay
//      produced (invoice number, total, per-rate desglose, change and QR), so a human can eyeball that
//      an order parked on one register was retrieved and filed on another.
//
// Like `till-demo.ts` (and unlike `daily-close-demo.ts`'s in-memory PGlite) this uses a real
// PostgreSQL, because the whole point is to file genuine huella-chained, append-only
// `registros_facturacion` rows AS THE APP ROLE UNDER RLS — which PGlite's superuser-only connection
// cannot prove. `applyVenue` and the extra till run as the connection OWNER (which those inserts need);
// the park/list/retrieve/pay functions drop to `app_user` via `withTenant` + `asAppUser` internally,
// the same as the deployed host. `resolveClient` is supplied but never reached: `recordSale` never
// contacts AEAT (that is `drain`'s job), so the stub below throws if it is ever called.
//
// Run it against a throwaway database (NEVER a real one — it creates a tenant and chains real fiscal
// records, and a pre-production stamp on a production chain is unrecoverable, see CLAUDE.md §5):
//
//   docker run --rm -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:18-alpine
//   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres WAITRON_ENV=preproduction \
//     pnpm --filter @waitron/server demo:park-retrieve
//
// `WAITRON_ENV` defaults to `preproduction` (the safe reading of "unset", config.ts), which is the
// only environment this demo should ever run in.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "../src/config.js";
import type { TillConfig } from "../src/till-config.js";
import { getHeldOrder, listHeldOrders, parkOrder } from "../src/working-order.js";
import { payWorkingOrder, recordTillSale } from "../src/till-sale.js";

const LOCALE = "es-ES";

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `till-demo.ts`/`catalogue-demo.ts` document. `recordSale` reads `now()` once
 * and touches neither `anchor` nor `currentAnchor`, so both are stubs.
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
      throw new Error("park-retrieve-demo: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("park-retrieve-demo: DATABASE_URL must be set in the environment");
    process.exit(1);
  }

  const db = await createPostgresDb(databaseUrl);
  try {
    // Self-migrate a blank database, exactly as till-demo does. CORE first (identity's persons FK onto
    // core's tenants/tills; the fiscal chain reads core's sales), then identity (applyVenue's
    // seed-admin needs `persons`), then fiscal (registerSif needs `registro_sif`/`cadenas`;
    // recordSale's chain needs `registros_facturacion`).
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, IDENTITY_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // Stand up a real chained venue + registered SIF via the production provisioning path. Run as the
    // connection owner (this superuser owns the tables it just migrated) — applyVenue inserts the
    // tenant and registers the SIF, neither of which the app role may do. The first till is "Caja 1".
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

    // Caja 1 — the register the order is parked on. `seriesIds[0]` is the standard series (planVenue
    // emits it before the rectificative one).
    const caja1: TillConfig = {
      tenantId: brandTenantId(venue.tenantId),
      tillId: brandTillId(venue.tillId),
      nodeId: brandNodeId(venue.nodeId),
      seriesId: brandSeriesId(venue.seriesIds[0]!),
      locationId: brandLocationId(venue.locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
    };

    // Caja 2 — a SECOND register on the SAME node/location, differing only in `till_id`. Inserted as
    // the owner (a till insert is a provisioning write). This is the register that retrieves and pays
    // the order Caja 1 parked, so the held list has to be shared across the two.
    const caja2TillId = randomUUID();
    await withTenant(db, caja1.tenantId, async (tx) => {
      await tx.execute(sql`
        insert into tills (id, tenant_id, location_id, name)
        values (${caja2TillId}, ${caja1.tenantId}, ${caja1.locationId}, 'Caja 2')`);
    });
    const caja2: TillConfig = { ...caja1, tillId: brandTillId(caja2TillId) };

    // Seed a catalogue as the application role (not the owner): one weight-priced product, one
    // each-priced product, in two categories, assigned to the venue's location. Spanish names are fine
    // — apps/* is out of the english-only guard's scope. Read the sellable products back so the park /
    // sale requests carry real product ids (the till never invents one).
    const available = await withTenant(db, caja1.tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const comida = await createCategory(tx, { name: "Comida" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: comida.id,
        descriptions: { [LOCALE]: "Jamón cortado" },
        pricingUnit: "weight",
        unitPrice: "24.90", // €/kg, gross (VAT-inclusive), reduced (10%)
        vatClass: "reduced",
      });
      await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { [LOCALE]: "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.50", // €/item, gross, general (21%)
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      return listAvailableProducts(tx, caja1.locationId);
    });
    const jamon = available.find((p) => p.pricingUnit === "weight")!;
    const agua = available.find((p) => p.pricingUnit === "each")!;

    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db,
      // Which QR-validation host `verificationUrl` names, and — separately — which environment this
      // registro is generated FOR (the `entorno` stamp `drain` later checks). Both from the same
      // resolver, defaulting to the safe `preproduction`.
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      // Never invoked by `recordSale` (see this file's header) — a rejection here surfaces a bug in
      // this script or the backend, never a real AEAT contact.
      resolveClient: () =>
        Promise.reject(
          new Error("park-retrieve-demo: resolveClient must never be called by recordSale"),
        ),
    });
    const deps = { db, backend, clock };

    // Sale 1 (A/1): a walk-up cash sale on Caja 1, so the node's huella chain already carries a link
    // before the parked order is paid — `checkIntegrity` at the end verifies a chain of TWO spanning
    // both tills.
    const walkUp = await recordTillSale(deps, caja1, {
      lines: [{ productId: agua.id, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    });

    // PARK on Caja 1: 0.250 kg jamón + 1 agua, labelled "Mesa 7". The server prices authoritatively at
    // add-time and LOCKS the gross unit onto each line (the request carries no price); that lock is what
    // the pay below files. `id` is client-minted (the till's idempotency key).
    const orderId = randomUUID();
    const parked = await parkOrder({ db }, caja1, {
      id: orderId,
      lines: [
        { productId: jamon.id, quantity: "0.250" },
        { productId: agua.id, quantity: "1" },
      ],
      label: "Mesa 7",
    });

    // LIST on Caja 2: the OTHER register sees the order Caja 1 parked — the held list is node-scoped,
    // not register-owned.
    const heldOnCaja2 = await listHeldOrders({ db }, caja2);

    // RETRIEVE on Caja 2: rebuild the basket from the parked order's pricing inputs.
    const retrieved = await getHeldOrder({ db }, caja2, orderId);

    // PAY on Caja 2 (Sale 2, A/2): file the retrieved order from its STORED locked lines by cash — NOT a
    // re-price (design §2, line-add snapshot); `retrieved.lines` is passed only to mirror the real till
    // round-trip. A FRESH file (not an idempotent replay), so the ticket carries its verification QR. The
    // series is per-node, so this continues Caja 1's chain.
    const ticket = await payWorkingOrder(deps, caja2, {
      id: orderId,
      lines: retrieved.lines,
      tender: { method: "cash", amount: "20.00" },
    });

    // CONFIRM THE CHAIN: both sales on this node verify as one intact huella chain.
    const integrity = await withTenant(db, caja1.tenantId, (tx) =>
      backend.checkIntegrity(tx, caja1.tenantId, caja1.nodeId),
    );

    const describe = (productId: string): string =>
      available.find((p) => p.id === productId)?.descriptions[LOCALE] ?? productId;

    console.log(
      "park-retrieve-demo: an order parked on one register, retrieved and paid on another",
    );
    console.log("");
    console.log(`  walk-up on Caja 1:  invoice ${walkUp.invoiceNumber}, total ${walkUp.total}`);
    console.log("");
    console.log(`  PARKED on Caja 1:   order #${parked.orderNumber} "Mesa 7"`);
    console.log("");
    console.log(`  HELD LIST as seen from Caja 2 (${heldOnCaja2.length} order(s)):`);
    for (const held of heldOnCaja2) {
      console.log(
        `    #${held.orderNumber}  ${held.label ?? "(no label)"}  items ${held.itemCount}  base ${held.total}`,
      );
    }
    console.log("");
    console.log(
      `  RETRIEVED on Caja 2: order #${retrieved.orderNumber} "${retrieved.label ?? ""}"`,
    );
    for (const line of retrieved.lines) {
      console.log(`    ${describe(line.productId)}  qty ${line.quantity}`);
    }
    console.log("");
    console.log("  PAID on Caja 2 — ticket:");
    console.log(`    invoiceNumber: ${ticket.invoiceNumber}`);
    console.log(`    issuedAt:      ${ticket.issuedAt}`);
    console.log(`    total:         ${ticket.total}`);
    console.log(`    change:        ${ticket.change}`);
    console.log("    desglose (VAT breakdown):");
    for (const line of ticket.vatBreakdown) {
      console.log(`      rate ${line.rate}%  base ${line.base}  tax ${line.tax}`);
    }
    console.log(`    qr:            ${ticket.qr}`);
    console.log("");
    console.log(
      `  CHAIN INTEGRITY: ok=${integrity.ok}, checked=${integrity.checked}, issues=${integrity.issues.length}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("park-retrieve-demo: failed");
  console.error(error);
  process.exit(1);
});

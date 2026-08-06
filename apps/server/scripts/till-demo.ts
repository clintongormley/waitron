// Self-contained, human-checkable demonstration of the Counter POS till's walk-up sale — driven
// through the till's OWN HTTP surface exactly as the browser does, both by CASH and by a manual CARD
// tender (the "datáfono" case, sub-project 7 slice 3). Modelled on `catalogue-demo.ts`
// (self-migrating, tsx-run, a real `VerifactuBackend`) and on `till-api.rls.test.ts` (which mounts
// `mountTillApi` on a `new Hono()` and drives it with `app.request(...)`), it:
//
//   1. connects to a FRESH postgres (via `DATABASE_URL`) and applies the core, identity and fiscal
//      migrations itself — so it runs against a blank `postgres:18-alpine` with nothing pre-seeded;
//   2. stands up a real chained venue + registered SIF with `applyVenue` (@waitron/provisioning);
//   3. seeds a catalogue (one `weight` product, one `each` product) and a staff person with a known
//      PIN — Spanish names are fine, apps/* is out of the english-only guard's scope;
//   4. mounts the till API on an in-process Hono app and drives the operator's whole journey over
//      HTTP: `POST /api/session` (log in) → `GET /api/products` (read the menu) → `POST /api/sales`
//      (ring a mixed-rate basket, cash) — the browser never invents a product id or a price;
//   5. prints the ticket payload the till would render, so a human can eyeball the invoice number,
//      total, per-rate desglose and change;
//   6. rings a SECOND sale over the same HTTP surface, this time tendered by manual CARD (the
//      operator ran the card on a separate bank terminal — `recordManualCardPayment` makes no network
//      call, `manual.ts:36-42`), then reads back the filed `tenders` row (`method = 'card'`) and the
//      linked `payments` row (`provider = 'manual'`, `state = 'captured'`) directly from the database
//      as the connection owner (bypassing RLS, the same read shape `working-order.rls.test.ts` uses),
//      so a human can see the captured-payment ledger a card tender adds beside the tender itself.
//
// Like `catalogue-demo.ts` (and unlike `daily-close-demo.ts`'s in-memory PGlite) this uses a real
// PostgreSQL, because the whole point is to file a genuine huella-chained, append-only
// `registros_facturacion` row AS THE APP ROLE UNDER RLS — which PGlite's superuser-only connection
// cannot prove. The demo drives the app as the connection owner (`secureCookies: false`, so the
// session cookie rides the non-TLS `app.request`), while the routes themselves drop to `app_user`
// via `withTenant` + `asAppUser`, the same as the deployed host. `resolveClient` is supplied but
// never reached: `recordTillSale`/`recordSale` never contact AEAT (that is `drain`'s job), so the
// stub below throws if it is ever called.
//
// Run it against a throwaway database (NEVER a real one — it creates a tenant and chains a real
// fiscal record, and a pre-production stamp on a production chain is unrecoverable, see CLAUDE.md §5):
//
//   docker run --rm -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:18-alpine
//   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres WAITRON_ENV=preproduction \
//     pnpm --filter @waitron/server demo:till
//
// `WAITRON_ENV` defaults to `preproduction` (the safe reading of "unset", config.ts), which is the
// only environment this demo should ever run in.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
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
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { mountTillApi } from "../src/till-api.js";
import type { TillConfig } from "../src/till-config.js";
import type { TillSaleResult } from "../src/till-sale.js";

const LOCALE = "es-ES";

/** A no-op logger: the demo cares about the HTTP responses and the printed ticket, not the routes'
 * structured lines (the hermetic suite already asserts those). */
const noopLog: Logger = () => {};

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `catalogue-demo.ts`/`till-api.rls.test.ts` document. `recordSale` reads
 * `now()` once and touches neither `anchor` nor `currentAnchor`, so both are stubs.
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
      throw new Error("till-demo: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("till-demo: DATABASE_URL must be set in the environment");
    process.exit(1);
  }

  const db = await createPostgresDb(databaseUrl);
  try {
    // Self-migrate a blank database, exactly as catalogue-demo does. CORE first (identity's persons
    // FK onto core's tenants/tills; the fiscal chain reads core's sales), then identity (applyVenue's
    // seed-admin needs `persons`, and the login route verifies a person's PIN), then fiscal
    // (registerSif needs `registro_sif`/`cadenas`; recordSale's chain needs `registros_facturacion`),
    // then payments (a manual card tender's `recordManualCardPayment` needs the `payments` table) —
    // the same order the production manifest runs them in
    // (`packages/migrations/migrations.manifest.json`: core, identity, …, fiscal, payments). Omitted
    // before this slice because a cash-only walk-up never touched `payments`; a card sale does.
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, IDENTITY_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);

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

    // The till's identity, the exact shape `boot.ts` resolves from `WAITRON_TILL_*` and hands the API.
    // planVenue emits the standard series first, then the rectificative one, so seriesIds[0] is the
    // ordinary sale's series.
    const cfg: TillConfig = {
      tenantId: brandTenantId(venue.tenantId),
      tillId: brandTillId(venue.tillId),
      nodeId: brandNodeId(venue.nodeId),
      seriesId: brandSeriesId(venue.seriesIds[0]!),
      locationId: brandLocationId(venue.locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
    };

    // Seed a catalogue and a staff person as the application role (not the owner): one weight-priced
    // product, one each-priced product, in two categories, assigned to the venue's location; and a
    // cashier with a KNOWN PIN ("5555") the login route can verify. Spanish names are fine — apps/* is
    // out of the english-only guard's scope.
    await withTenant(db, cfg.tenantId, async (tx) => {
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
      await tx.execute(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'Cajera', ${hashPin("5555")}, 'staff')`);
    });

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
        Promise.reject(new Error("till-demo: resolveClient must never be called by recordSale")),
    });

    // Mount the till API on an in-process Hono app and drive it over HTTP — the same surface the Vite
    // dev server proxies to. `secureCookies: false` so the session cookie rides the non-TLS
    // `app.request` (a `Secure` cookie is never sent back over plain HTTP).
    const app = new Hono();
    mountTillApi(app, { db, backend, clock, cfg, secureCookies: false }, noopLog);

    // 1. Log in. The lock screen would POST the operator's chosen personId + PIN; the roster route
    //    (GET /api/staff) is how the browser learns the personId, but the demo knows the seeded name.
    const staffRes = await app.request("/api/staff");
    const staff = (await staffRes.json()) as { personId: string; displayName: string }[];
    const cajera = staff.find((s) => s.displayName === "Cajera")!;
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: cajera.personId, pin: "5555" }),
    });
    if (login.status !== 200) {
      throw new Error(`till-demo: login failed with status ${login.status}`);
    }
    const cookie = login.headers.get("set-cookie")!;

    // 2. Read the menu. The sale lines are built FROM this response — the till never invents ids.
    const productsRes = await app.request("/api/products", { headers: { cookie } });
    const products = (await productsRes.json()) as {
      id: string;
      pricingUnit: "each" | "weight";
      descriptions: Record<string, string>;
    }[];
    const jamon = products.find((p) => p.pricingUnit === "weight")!; // 24.90 €/kg reduced(10%)
    const agua = products.find((p) => p.pricingUnit === "each")!; // 1.50 general(21%)

    // 3. Ring a MIXED-rate cash basket: 0.200 kg jamón (4.98 gross @10%) + 2 × agua (3.00 gross @21%)
    //    = 7.98, tendered 10.00 → 2.02 change. The server re-prices authoritatively; the request
    //    carries no price.
    const saleRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [
          { productId: jamon.id, quantity: "0.200" },
          { productId: agua.id, quantity: "2" },
        ],
        tender: { method: "cash", amount: "10.00" },
      }),
    });
    if (saleRes.status !== 200) {
      throw new Error(
        `till-demo: sale failed with status ${saleRes.status}: ${await saleRes.text()}`,
      );
    }
    const ticket = (await saleRes.json()) as TillSaleResult;

    console.log("till-demo: a walk-up cash sale rung over the till's HTTP API");
    console.log(`  operator:      Cajera (${cajera.personId})`);
    console.log(`  invoiceNumber: ${ticket.invoiceNumber}`);
    console.log(`  issuedAt:      ${ticket.issuedAt}`);
    console.log(`  total:         ${ticket.total}`);
    console.log(`  change:        ${ticket.change}`);
    console.log("  desglose (VAT breakdown):");
    for (const line of ticket.vatBreakdown) {
      console.log(`    rate ${line.rate}%  base ${line.base}  tax ${line.tax}`);
    }
    console.log(`  qr:            ${ticket.qr}`);

    // 4. Ring a SECOND sale, this time a manual CARD tender: 1 × agua (1.50 gross @21%). The till
    //    mints its own `workingOrderId` (optional on `TillSaleRequest`, `till-sale.ts:63`) so this
    //    script can read the filed `tenders`/`payments` rows back by it below — `recordTillSale` would
    //    otherwise mint one internally and never report it. `amount` (5.00) DELIBERATELY disagrees with
    //    the total (1.50): a manual card tender charges the EXACT total on a separate bank terminal, so
    //    the server ignores the sent amount and settles at the total (`payWorkingOrder`'s
    //    `covered`/`settledAmount` normalization in `till-sale.ts`) — a client over-send can never move
    //    the filed figure. `externalRef` is the hand-keyed acquirer / terminal operation number, a
    //    human reconciliation hook.
    const cardWorkingOrderId = randomUUID();
    const cardSaleRes = await app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        lines: [{ productId: agua.id, quantity: "1" }],
        tender: { method: "card", amount: "5.00", externalRef: "OP-12345" },
        workingOrderId: cardWorkingOrderId,
      }),
    });
    if (cardSaleRes.status !== 200) {
      throw new Error(
        `till-demo: card sale failed with status ${cardSaleRes.status}: ${await cardSaleRes.text()}`,
      );
    }
    const cardTicket = (await cardSaleRes.json()) as TillSaleResult;

    // Read the filed `tenders` row back as the connection OWNER (bypasses RLS) — the same join shape
    // `working-order.rls.test.ts`'s `tendersFor` uses: `tenders` links to `sales`, not directly to
    // `working_orders`, so the join goes through `sales.working_order_id`.
    const { rows: cardTenders } = await db.execute<{ method: string; amount: string }>(sql`
      select t.method, t.amount
      from tenders t
      join sales s on s.id = t.sale_id
      where s.working_order_id = ${cardWorkingOrderId}`);
    const tender = cardTenders[0];
    if (cardTenders.length !== 1 || tender === undefined || tender.method !== "card") {
      throw new Error(
        `till-demo: expected exactly one card tender for the card sale, got ${JSON.stringify(cardTenders)}`,
      );
    }

    // Read the linked `payments` row back the same way — `paymentsFor`'s shape in the same test file:
    // `payments.working_order_id` is direct, so `linked` compares its `sale_id` against the ONE sale
    // filed from this working order.
    const { rows: cardPayments } = await db.execute<{
      provider: string;
      state: string;
      amount: string;
      linked: boolean;
    }>(sql`
      select p.provider, p.state, p.amount, (p.sale_id is not null and p.sale_id = s.id) as linked
      from payments p
      join sales s on s.working_order_id = p.working_order_id
      where p.working_order_id = ${cardWorkingOrderId}`);
    const payment = cardPayments[0];
    if (
      cardPayments.length !== 1 ||
      payment === undefined ||
      payment.provider !== "manual" ||
      payment.state !== "captured" ||
      !payment.linked
    ) {
      throw new Error(
        `till-demo: expected exactly one captured manual payment linked to the card sale, got ${JSON.stringify(cardPayments)}`,
      );
    }

    console.log("");
    console.log("till-demo: a second sale, tendered by manual CARD (datáfono), over the same API");
    console.log(`  operator:      Cajera (${cajera.personId})`);
    console.log(`  invoiceNumber: ${cardTicket.invoiceNumber}`);
    console.log(`  issuedAt:      ${cardTicket.issuedAt}`);
    console.log(`  total:         ${cardTicket.total}`);
    console.log(`  change:        ${cardTicket.change}`); // "0.00" — a card charges the exact total
    console.log("  desglose (VAT breakdown):");
    for (const line of cardTicket.vatBreakdown) {
      console.log(`    rate ${line.rate}%  base ${line.base}  tax ${line.tax}`);
    }
    console.log(`  qr:            ${cardTicket.qr}`);
    console.log(`  tenders row:   method=${tender.method} amount=${tender.amount}`);
    console.log(
      `  payments row:  provider=${payment.provider} state=${payment.state} amount=${payment.amount} linkedToSale=${payment.linked}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("till-demo: failed");
  console.error(error);
  process.exit(1);
});

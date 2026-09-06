// Self-contained, human-checkable demonstration of the INTEGRATED card terminal (sub-project 7,
// "integrated card terminal" branch): a walk-up basket driven through `payWorkingOrderIntegrated`'s
// split-transaction P1 (price/commit) → P2 (collect — the reader tap) → P3 (file+associate+settle)
// flow, over a `StripeTerminalProvider` wired to `FakeStripe` (the deterministic reader double,
// `@waitron/payments-stripe/src/testing/fake-stripe.js`). Modelled on `till-demo.ts` (self-migrating,
// tsx-run, a real `VerifactuBackend`) and on `till-sale-integrated.pg.test.ts`'s `integratedDeps`
// helper (the exact provider-construction shape this script mirrors), it:
//
//   1. connects to a FRESH postgres (via `DATABASE_URL`) and applies the core, identity, fiscal and
//      payments migrations itself — so it runs against a blank `postgres:18-alpine` with nothing
//      pre-seeded (a card sale touches `payments`, which a cash-only demo never needs);
//   2. stands up a real chained venue + registered SIF with `applyVenue` (@waitron/provisioning),
//      configured `cardProvider: "stripe_terminal"` (the per-node config `loadTillConfig` would
//      resolve from `WAITRON_TILL_CARD_PROVIDER`/`WAITRON_TILL_STRIPE_READER_ID` at real boot);
//   3. seeds one `each`-priced product;
//   4. wraps `FakeStripe` in a thin narrating client so the ACTUAL reader calls `collect` makes
//      (`createPaymentIntent`, `processPaymentIntent`, `readerOutcome`) print to stdout as they
//      happen — the "P2 (collect)" narration is not scripted commentary, it is the real call
//      sequence `provider.ts:100-186` drives;
//   5. rings a walk-up basket through `payWorkingOrderIntegrated` to a CAPTURE, printing the
//      resulting `TillSaleResult` ticket (invoice number, total, AEAT QR) and reading back the
//      linked `payments` row (provider `stripe`, state `captured`, external ref `pi_…`) as the
//      connection owner — bypassing RLS, the same read shape `till-demo.ts`'s card-tender section
//      uses — so a human can see the captured-payment ledger an integrated card pay adds;
//   6. rings a SECOND walk-up basket with `FakeStripe.declineNext()`: the reader declines, and the
//      script shows the fiscal invariant CLAUDE.md §5 names — "nothing may block a sale on anything
//      but the sale itself" — by reading back that the order is left OPEN (not settled, not voided)
//      and NO sale/registro was filed, then retrying the SAME order id by CASH (the till's own
//      switch-tender path, `payWorkingOrder`) to show the order is still sellable.
//
// Like `till-demo.ts` (and unlike `daily-close-demo.ts`'s in-memory PGlite) this uses a real
// PostgreSQL, because the whole point is to file a genuine huella-chained, append-only
// `registros_facturacion` row AS THE APP ROLE UNDER RLS — which PGlite's superuser-only connection
// cannot prove (CLAUDE.md §4). `applyVenue` runs as the connection owner (this superuser owns the
// tables it just migrated). `payWorkingOrderIntegrated`'s own P1/P3 phases drop to `app_user` via
// `withTenant` + `asAppUser` internally, the same as the deployed host (`till-sale.ts:644-645` for
// P1, inside the function itself; `821-822` for P3, inside `finalizeCapture`, which it calls). The
// PROVIDER's own writes do not, here: `collect`'s T1/T2 (`insertAttempting`/`captureAttempting`/
// `failAttempting`) go through `StripeTerminalProvider`'s private `inTenant`, which calls only
// `withTenant(this.opts.db, …)` — never `asAppUser` (`provider.ts:97-98`). `this.opts.db` is the
// plain connection-owner `db` this script passes into the provider's constructor below, so in THIS
// demo those particular writes run as the connection owner, not as `app_user`. This demo therefore
// proves the fiscal record and `payWorkingOrderIntegrated`'s own writes under the real app role, but
// does NOT exercise the provider's writes under it — `stripe.test.ts` in @waitron/payments-stripe
// (a non-superuser probe role that is a member of `app_user`) is what proves those.
// `resolveClient` is supplied but never reached: `recordSale` never contacts AEAT (that is `drain`'s
// job), so the stub below throws if it is ever called.
//
// Run it against a throwaway database (NEVER a real one — it creates a tenant and chains real fiscal
// records, and a pre-production stamp on a production chain is unrecoverable, see CLAUDE.md §5):
//
//   docker run --rm -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:18-alpine
//   DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres WAITRON_ENV=preproduction \
//     pnpm --filter @waitron/server demo:card
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
import type { Database } from "@waitron/db";
import { IDENTITY_MIGRATIONS, hashPassword, hashPin } from "@waitron/identity";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import type { StripeClient } from "@waitron/payments-stripe";
import type { Decimal } from "@waitron/shared";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { ALL_MODULES } from "../src/modules.js";
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
import type { IntegratedPayDeps, TillSaleResult } from "../src/till-sale.js";
import { payWorkingOrder, payWorkingOrderIntegrated } from "../src/till-sale.js";
import type { TillConfig } from "../src/till-config.js";

const LOCALE = "es-ES";
const READER_ID = "reader_1";

/**
 * Wraps a `StripeClient` and prints each call as it happens, so the P2 narration below is the REAL
 * sequence `StripeTerminalProvider.collect` drives (`provider.ts:100-186`) — not commentary written
 * around it. Delegates every call unchanged to `inner` (the `FakeStripe` double).
 */
class NarratingStripeClient implements StripeClient {
  constructor(
    private readonly inner: StripeClient,
    private readonly label: string,
  ) {}

  async createPaymentIntent(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    console.log(
      `    [P2] ${this.label}: createPaymentIntent  amount=${params.amount} ${params.currency}`,
    );
    return this.inner.createPaymentIntent(params);
  }
  async processPaymentIntent(readerId: string, paymentIntentId: string): Promise<void> {
    console.log(
      `    [P2] ${this.label}: processPaymentIntent  reader=${readerId} intent=${paymentIntentId}  (the reader tap)`,
    );
    return this.inner.processPaymentIntent(readerId, paymentIntentId);
  }
  async readerOutcome(
    readerId: string,
  ): Promise<{ status: "in_progress" | "succeeded" | "failed"; failureCode?: string }> {
    const outcome = await this.inner.readerOutcome(readerId);
    console.log(`    [P2] ${this.label}: readerOutcome  status=${outcome.status}`);
    return outcome;
  }
  async cancelReaderAction(readerId: string): Promise<void> {
    console.log(`    [P2] ${this.label}: cancelReaderAction  reader=${readerId}`);
    return this.inner.cancelReaderAction(readerId);
  }
  async refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }> {
    console.log(`    [P2] ${this.label}: refund  intent=${params.paymentIntentId}`);
    return this.inner.refund(params);
  }
}

/**
 * The wall clock at the moment this process runs, reported as already confident and anchored — the
 * identical stub shape `till-demo.ts`/`park-retrieve-demo.ts` document. `recordSale` reads `now()`
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
      throw new Error("integrated-card-demo: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

/** Read the `payments` row this working order's card collect filed — the same owner-bypass join
 *  shape `till-demo.ts` and `till-sale-integrated.pg.test.ts`'s `paymentsFor` use. */
async function paymentFor(
  db: Database,
  workingOrderId: string,
): Promise<
  { provider: string; state: string; externalRef: string | null; linkedToSale: boolean }[]
> {
  const { rows } = await db.execute<{
    provider: string;
    state: string;
    external_ref: string | null;
    linked: boolean;
  }>(sql`
    select p.provider, p.state, p.external_ref,
           (p.sale_id is not null and p.sale_id = s.id) as linked
    from payments p join sales s on s.working_order_id = p.working_order_id
    where p.working_order_id = ${workingOrderId}
    order by p.provider, p.external_ref
  `);
  return rows.map((r) => ({
    provider: r.provider,
    state: r.state,
    externalRef: r.external_ref,
    linkedToSale: r.linked,
  }));
}

async function orderState(db: Database, id: string): Promise<{ status: string }> {
  const { rows } = await db.execute<{ status: string }>(
    sql`select status from working_orders where id = ${id}`,
  );
  return { status: rows[0]!.status };
}

async function saleCount(db: Database, workingOrderId: string): Promise<number> {
  const { rows } = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from sales where working_order_id = ${workingOrderId}`,
  );
  return Number(rows[0]!.count);
}

function printTicket(ticket: TillSaleResult): void {
  console.log(`    invoiceNumber: ${ticket.invoiceNumber}`);
  console.log(`    issuedAt:      ${ticket.issuedAt}`);
  console.log(`    total:         ${ticket.total}`);
  console.log(`    change:        ${ticket.change}`); // "0.00" — a card is charged the exact total
  console.log("    desglose (VAT breakdown):");
  for (const line of ticket.vatBreakdown) {
    console.log(`      rate ${line.rate}%  base ${line.base}  tax ${line.tax}`);
  }
  console.log(`    qr:            ${ticket.qr || "(none)"}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("integrated-card-demo: DATABASE_URL must be set in the environment");
    process.exit(1);
  }

  const db = await createPostgresDb(databaseUrl);
  try {
    // Self-migrate a blank database, exactly as till-demo does, PLUS payments (a card collect's
    // `insertAttempting`/`captureAttempting` need the `payments` table — see till-demo.ts's header
    // for the full ordering rationale: core → identity → fiscal → payments).
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, IDENTITY_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);
    await runMigrations(db, PAYMENTS_MIGRATIONS);

    // Stand up a real chained venue + registered SIF via the production provisioning path. Run as the
    // connection owner (this superuser owns the tables it just migrated) — applyVenue inserts the
    // core rows and runs every module's seed for the node (the fiscal seed registers the SIF), and
    // the app role may do neither.
    const venue = await applyVenue(
      planVenue(
        {
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
          admin: {
            displayName: "Administradora",
            pinHash: hashPin("1234"),
            passwordHash: hashPassword("dashPass123"),
          },
        },
        ALL_MODULES,
      ),
      { db, modules: ALL_MODULES },
    );

    // The till's identity, WITH an integrated Stripe terminal configured — the shape `loadTillConfig`
    // would resolve from `WAITRON_TILL_CARD_PROVIDER=stripe_terminal` /
    // `WAITRON_TILL_STRIPE_READER_ID=reader_1` at real boot (`till-config.ts:122-173`).
    const cfg: TillConfig = {
      tenantId: brandTenantId(venue.tenantId),
      tillId: brandTillId(venue.tillId),
      nodeId: brandNodeId(venue.nodeId),
      seriesId: brandSeriesId(venue.seriesIds[0]!),
      locationId: brandLocationId(venue.locationId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      cardProvider: "stripe_terminal",
      stripeReaderId: READER_ID,
      tipsEnabled: false,
      // The venue's default pay-timing mode (design §3); this demo drives the prepay walk-up path.
      orderFlow: "prepay",
    };

    // Seed one each-priced product as the application role (not the owner). Spanish names are fine —
    // apps/* is out of the english-only guard's scope.
    const cafe = await withTenant(db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const cat = await createCatalogue(tx, { name: "Delicatessen" });
      const bebidas = await createCategory(tx, { name: "Bebidas" });
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: bebidas.id,
        descriptions: { [LOCALE]: "Café" },
        pricingUnit: "each",
        unitPrice: "1.50", // €/item, gross (VAT-inclusive), general (21%)
        vatClass: "general",
      });
      await assignCatalogueToLocation(tx, venue.locationId, cat.id);
      return product;
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
        Promise.reject(
          new Error("integrated-card-demo: resolveClient must never be called by recordSale"),
        ),
    });

    console.log("integrated-card-demo: a walk-up basket paid through the INTEGRATED card terminal");
    console.log("");

    // ---- Pass 1: a CAPTURE ---------------------------------------------------------------------
    console.log("PASS 1 — capture");
    console.log(
      "  [P1] price the walk-up basket and commit the order OPEN, before any network call",
    );
    const capturedId = randomUUID();
    const capturedClient = new FakeStripe();
    const capturedProvider = new StripeTerminalProvider({
      client: new NarratingStripeClient(capturedClient, "reader"),
      db,
      tenantId: cfg.tenantId,
      nodeId: cfg.nodeId,
      // Ignores its args and always returns the one configured reader — the exact shape
      // `boot.ts`'s production wiring uses (`buildCardProvider`, `till-sale-integrated.pg.test.ts`'s
      // `integratedDeps`) — a real per-tenant resolver would look the reader id up from `cfg`.
      resolveReader: () => Promise.resolve(READER_ID),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const capturedDeps: IntegratedPayDeps = {
      db,
      backend,
      clock,
      provider: capturedProvider,
    };

    const captured = await payWorkingOrderIntegrated(capturedDeps, cfg, {
      id: capturedId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    console.log("  [P3] file + associate + settle — ticket:");
    if (captured.outcome !== "captured") {
      throw new Error(`integrated-card-demo: expected a capture, got ${captured.outcome}`);
    }
    printTicket(captured.ticket);

    const capturedPayment = (await paymentFor(db, capturedId))[0];
    console.log(
      `    linked payment: provider=${capturedPayment?.provider} state=${capturedPayment?.state} ` +
        `externalRef=${capturedPayment?.externalRef} linkedToSale=${capturedPayment?.linkedToSale}`,
    );
    console.log(`    order status:   ${(await orderState(db, capturedId)).status}`);
    console.log("");

    // ---- Pass 2: a DECLINE, then switch-tender by cash ------------------------------------------
    // Demonstrates the fiscal invariant CLAUDE.md §5 names: "nothing may block a sale on anything but
    // the sale itself" — a declined card leaves the order OPEN and files nothing, so the till can
    // retry the SAME order id with any other tender (here: cash) rather than the sale being stuck.
    console.log("PASS 2 — a DECLINE, then switch-tender by cash");
    console.log("  [P1] price a second walk-up basket and commit the order OPEN");
    const declinedId = randomUUID();
    const declinedClient = new FakeStripe();
    declinedClient.declineNext();
    const declinedProvider = new StripeTerminalProvider({
      client: new NarratingStripeClient(declinedClient, "reader"),
      db,
      tenantId: cfg.tenantId,
      nodeId: cfg.nodeId,
      resolveReader: () => Promise.resolve(READER_ID),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const declinedDeps: IntegratedPayDeps = {
      db,
      backend,
      clock,
      provider: declinedProvider,
    };

    const declined = await payWorkingOrderIntegrated(declinedDeps, cfg, {
      id: declinedId,
      lines: [{ productId: cafe.id, quantity: "1" }],
    });

    console.log(`  outcome: ${declined.outcome}`);
    console.log(
      `  filed:   saleCount=${await saleCount(db, declinedId)}  ` +
        `orderStatus=${(await orderState(db, declinedId)).status}  (nothing filed, order still open)`,
    );

    console.log("  [switch tender] the operator rings the SAME order by cash instead:");
    const cashTicket = await payWorkingOrder({ db, backend, clock }, cfg, {
      id: declinedId,
      lines: [],
      tender: { method: "cash", amount: "2.00" },
    });
    printTicket(cashTicket);
    console.log(`    order status:   ${(await orderState(db, declinedId)).status}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error("integrated-card-demo: failed");
  console.error(error);
  process.exit(1);
});

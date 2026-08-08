import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import type { Database } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
// A real test-double backend that writes through the caller's transaction but whose records carry NO
// `verificationUrl` — the one way to exercise the ticket's empty-QR default (VerifactuBackend always
// sets one). Same double `till-sale.test.ts` uses for `fileImmediateSale`'s identical branch.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { asAppUser, withTenant } from "@waitron/db";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { insertCapturedPayment } from "@waitron/payments";
import type { PaymentProvider, PaymentResult, PaymentResultState } from "@waitron/payments";
import { listOutstandingSales } from "@waitron/core";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { deploymentEnvironment } from "./config.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import { createOpenOrder, parkOrder, placeOrder } from "./working-order.js";
import { collectOrder, payWorkingOrder, payWorkingOrderIntegrated } from "./till-sale.js";
import type { IntegratedPayDeps } from "./till-sale.js";
import { startRealPostgres } from "./testing/postgres.js";
import "./errors.js";

// Real Postgres, not PGlite (CLAUDE.md §4). The split flow's P3 writes (recordSale + associate +
// settle) run as the deployment role under RLS, and the P1(commit)→collect→P3 ordering plus the
// FK-before-attempting invariant (the provider's `insertAttempting` FKs `working_orders`, which the
// walk-up's tx A must COMMIT before the network `collect`) are exactly what a superuser, single-backend
// PGlite cannot show — a false pass, not a weak one. `FakeStripe` drives the reader deterministically.
//
// A non-superuser LOGIN role that inherits `app_user`'s grants — being non-superuser is what makes
// FORCE ROW LEVEL SECURITY apply to it (the provider's own `collect` does NOT `SET ROLE app_user`; it
// runs as whatever role holds the handle). Mirrors `payments-stripe`'s `stripe.rls.test.ts`.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";
const LOCALE = "es-ES";

// The accountable operator a placing amendment is attributed to — a fixed fixture uuid standing in for
// the session's `personId` (no FK on `order_amendments.actor_id`), the shape `working-order.rls.test.ts` uses.
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: 180_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored — the stub `working-order.rls.test.ts` uses. */
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
      throw new Error("till-sale-integrated.rls.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each venue needs its own NIF.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "stripe_terminal",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

interface SeededVenue {
  cfg: TillConfig;
  cafe: AvailableProduct;
}

/** A fresh chained venue + registered SIF (as the owner), with one "Café" (each, 1.50 gross,
 * general 21%) product seeded as the app role. Each test gets its OWN tenant so counts are
 * order-independent (CLAUDE.md §4). */
async function setupVenue(): Promise<SeededVenue> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Deli Test SL",
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
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return listAvailableProducts(tx, cfg.locationId);
  });
  const cafe = available.find((p) => p.descriptions[LOCALE] === "Café")!;
  return { cfg, cafe };
}

/** Flip the location's `order_flow` (as the owner) AND the in-memory cfg to `mode`, the way boot wires
 * them — so `placeOrder`/`payWorkingOrderIntegrated` dispatch on the same value the DB carries. */
async function modeVenue(mode: OrderFlow): Promise<SeededVenue> {
  const venue = await setupVenue();
  await suite.admin.execute(
    sql`update locations set order_flow = ${mode} where id = ${venue.cfg.locationId}`,
  );
  return { ...venue, cfg: { ...venue.cfg, orderFlow: mode } };
}

/** Build the split-flow deps + a real `StripeTerminalProvider` over `FakeStripe`, sharing ONE
 * app-role handle for both the provider's writes and the orchestrator's P1/P3 (CLAUDE.md §4 — the
 * provider's writes run under a real RLS-subject role, not a superuser). Tips are driven by
 * `cfg.tipsEnabled` (the sibling `TillConfig` every caller passes to `payWorkingOrderIntegrated`
 * alongside these deps), not a deps-level flag — `IntegratedPayDeps` carries no `tipsEnabled` of its
 * own; a "tips on" test overrides `cfg` instead (see the two below). */
function integratedDeps(
  cfg: TillConfig,
  app: Database,
  client = new FakeStripe(),
): { deps: IntegratedPayDeps; client: FakeStripe } {
  const provider = new StripeTerminalProvider({
    client,
    db: app,
    tenantId: cfg.tenantId,
    resolveReader: () => Promise.resolve("reader_1"),
    poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
  });
  return { deps: { db: app, backend, clock, provider }, client };
}

/** A provider that runs `onCollect` (to simulate a concurrent settle) then returns a canned result —
 * for the finalize-time backstop tests, where the point is the DB state at P3, not the reader. */
function cannedProvider(
  onCollect: () => Promise<void>,
  state: PaymentResultState,
): PaymentProvider {
  return {
    provider: "stripe",
    capabilities: { partialRefund: true },
    async collect(params): Promise<PaymentResult> {
      await onCollect();
      return {
        provider: "stripe",
        paymentRef: randomUUID(),
        state,
        amount: params.amount,
        settledAt: state === "captured" || state === "accepted_offline" ? new Date() : null,
      };
    },
    forward: () =>
      Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }),
    void: () => Promise.reject(new Error("cannedProvider: void unused")),
    refund: () => Promise.reject(new Error("cannedProvider: refund unused")),
    partialRefund: () => Promise.reject(new Error("cannedProvider: partialRefund unused")),
  };
}

// --- owner reads (bypass RLS — verification, not the isolation assertion) --------------------------

async function saleCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(
    sql`select count(*)::text as count from sales where working_order_id = ${workingOrderId}`,
  );
  return Number(rows[0]!.count);
}

async function registroCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(sql`
    select count(*)::text as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  const { rows } = await suite.admin.execute<{ status: string; settled: boolean }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled };
}

/** The tender(s) filed for this order's sale — method, amount, tip. */
async function tendersFor(
  workingOrderId: string,
): Promise<{ method: string; amount: string; tipAmount: string }[]> {
  const { rows } = await suite.admin.execute<{ method: string; amount: string; tip: string }>(sql`
    select t.method, t.amount, t.tip_amount as tip
    from tenders t join sales s on s.id = t.sale_id
    where s.working_order_id = ${workingOrderId}
    order by t.method
  `);
  return rows.map((r) => ({ method: r.method, amount: r.amount, tipAmount: r.tip }));
}

/** The filed `sales.total` (ex-tip) for this order's sale. */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ total: string }>(
    sql`select total from sales where working_order_id = ${workingOrderId}`,
  );
  return rows[0]!.total;
}

/** The `payments` rows for this order — provider/state/external_ref, plus whether `sale_id` points at
 *  the filed sale (the association witness). */
async function paymentsFor(
  workingOrderId: string,
): Promise<
  { provider: string; state: string; externalRef: string | null; linkedToSale: boolean }[]
> {
  const { rows } = await suite.admin.execute<{
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

async function paymentCount(workingOrderId: string): Promise<number> {
  const { rows } = await suite.admin.execute<{ count: string }>(
    sql`select count(*)::text as count from payments where working_order_id = ${workingOrderId}`,
  );
  return Number(rows[0]!.count);
}

/** The `sales.id` filed for this order — the witness that `listOutstandingSales` lists (or no longer
 *  lists) the invoice-first sale, and the seed target for a lost-T2 recovery. */
async function saleIdFor(workingOrderId: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(
    sql`select id from sales where working_order_id = ${workingOrderId}`,
  );
  return rows[0]!.id;
}

/** This tenant's outstanding (issued-but-unsettled) sales, read as the app role — the "what is owed?"
 *  list a decline must leave intact. Each test owns its tenant, so it lists only this test's sales. */
async function outstandingSalesFor(
  cfg: TillConfig,
): Promise<{ saleId: string; amountDue: string }[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await listOutstandingSales(tx, cfg.tenantId);
    return rows.map((r) => ({ saleId: String(r.saleId), amountDue: String(r.amountDue) }));
  });
}

/** Every `payments` row for this order — state + whether it carries a `sale_id` — WITHOUT the sales
 *  join `paymentsFor` uses, so a declined pay (which files no sale) is still visible. */
async function rawPaymentsFor(
  workingOrderId: string,
): Promise<{ state: string; hasSale: boolean }[]> {
  const { rows } = await suite.admin.execute<{ state: string; has_sale: boolean }>(sql`
    select state, (sale_id is not null) as has_sale
    from payments where working_order_id = ${workingOrderId}
    order by state
  `);
  return rows.map((r) => ({ state: r.state, hasSale: r.has_sale }));
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("till-sale-integrated.rls.test: resolveClient must never be called"),
      ),
  });
});

describe("payWorkingOrderIntegrated (split-transaction integrated pay, ordering 2)", () => {
  it("walk-up: captures, files an immediate card sale, links the payment, settles the order", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps } = integratedDeps(cfg, app);
      const id = randomUUID();

      const out = await payWorkingOrderIntegrated(deps, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
      });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.invoiceNumber).toBe("A/1");
      expect(out.ticket.total).toBe("1.50");
      expect(out.ticket.change).toBe("0.00"); // a card is charged the exact total — nothing to hand back

      // Settled, exactly one sale + registro; one card tender at the total; one captured stripe
      // payment carrying the PaymentIntent id and linked to the filed sale.
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.provider).toBe("stripe");
      expect(payments[0]!.state).toBe("captured");
      expect(payments[0]!.linkedToSale).toBe(true);
      expect(payments[0]!.externalRef).toMatch(/^pi_/);
    } finally {
      await app.close();
    }
  });

  it("a declined card files nothing and leaves the order open (retryable)", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const client = new FakeStripe();
      client.declineNext();
      const { deps } = integratedDeps(cfg, app, client);
      const id = randomUUID();

      const out = await payWorkingOrderIntegrated(deps, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
      });

      expect(out.outcome).toBe("declined");
      // No sale filed; the working order exists and is still `open` (retryable); a `failed` audit row
      // exists (the provider's T2 wrote it) but is unlinked.
      expect(await saleCount(id)).toBe(0);
      expect(await registroCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
      // The provider's T2 wrote a `failed` audit row (no sale to link to).
      expect(await rawPaymentsFor(id)).toEqual([{ state: "failed", hasSale: false }]);
    } finally {
      await app.close();
    }
  });

  it("a settled order replays its ticket without re-collecting", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app);
      const id = randomUUID();
      const req = { id, lines: [{ productId: cafe.id, quantity: "1" }] };

      const first = await payWorkingOrderIntegrated(deps, cfg, req);
      expect(first.outcome).toBe("captured");
      if (first.outcome !== "captured") throw new Error("unreachable");

      // Pay again with the SAME id → replays the same ticket, files nothing, and never re-collects:
      // the reader's PaymentIntent creation fired exactly once, and there is still one payment row.
      const firstIntent = client.lastCreateIntent;
      const second = await payWorkingOrderIntegrated(deps, cfg, req);
      expect(second.outcome).toBe("captured");
      if (second.outcome !== "captured") throw new Error("unreachable");
      expect(second.ticket.invoiceNumber).toBe(first.ticket.invoiceNumber);
      expect(second.ticket.qr).toBe(first.ticket.qr);
      expect(client.lastCreateIntent).toBe(firstIntent); // no second createPaymentIntent
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await paymentCount(id)).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("tips on: charges total+tip, files the sale at the total, records the tip on the tender", async () => {
    const { cfg: baseCfg, cafe } = await setupVenue();
    // Tips are read off `cfg.tipsEnabled` (the single source), not a deps-level flag — override it
    // here rather than passing a `tipsEnabled` argument to `integratedDeps`.
    const cfg = { ...baseCfg, tipsEnabled: true };
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app);
      const id = randomUUID();

      const out = await payWorkingOrderIntegrated(deps, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tip: "0.30",
      });

      expect(out.outcome).toBe("captured");
      // The reader was charged the GROSS 1.80 (total + tip)…
      expect(client.lastCreateIntent?.amount).toBe("1.80");
      // …while the FISCAL sale.total is the ex-tip 1.50, and the tender carries amount 1.80 / tip 0.30
      // (the coverage identity sum(amount) = total + sum(tip) holds).
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
    } finally {
      await app.close();
    }
  });

  it("tips off: a client-supplied tip is clamped to 0 — charges and settles at the exact total", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app); // cfg.tipsEnabled: false (setupVenue's default)
      const id = randomUUID();

      const out = await payWorkingOrderIntegrated(deps, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        tip: "5.00", // ignored — tips are disabled on this till
      });

      expect(out.outcome).toBe("captured");
      expect(client.lastCreateIntent?.amount).toBe("1.50"); // the tip was NOT added
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
    } finally {
      await app.close();
    }
  });

  it("retrieved (open) order: files the STORED locked lines at pay, links the payment, settles", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = randomUUID();
      await parkOrder({ db: suite.admin }, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "2" }],
        label: "Mesa 4",
      });

      const { deps } = integratedDeps(cfg, app);
      // No client basket — a retrieved order files from its stored lock (2 × 1.50 = 3.00).
      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.total).toBe("3.00");
      expect(await filedSaleTotal(id)).toBe("3.00");
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "3.00", tipAmount: "0.00" }]);
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.linkedToSale).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("placed (ticket_then_pay) order: ISSUES the invoice AT PAY from the frozen lines (ordering 2)", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = randomUUID();
      await parkOrder({ db: suite.admin }, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
      });
      // Place it: open → placed, NO fiscal document filed yet (ticket_then_pay issues at pay).
      await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
      expect(await saleCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });

      const { deps } = integratedDeps(cfg, app);
      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      // Issue-at-pay: exactly one sale now exists, filed at pay from the frozen lines, and placed → settled.
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.linkedToSale).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("refuses an ABANDONED order (working_order.not_open) and never touches the reader", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = randomUUID();
      await parkOrder({ db: suite.admin }, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
      });
      await suite.admin.execute(
        sql`update working_orders set status = 'abandoned' where id = ${id}`,
      );

      const { deps, client } = integratedDeps(cfg, app);
      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
        code: "working_order.not_open",
        params: { workingOrderId: id },
      });

      // Refused in P1, before P2: no sale, no payment, and the reader was never driven.
      expect(await saleCount(id)).toBe(0);
      expect(await paymentCount(id)).toBe(0);
      expect(client.lastCreateIntent).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("refuses an empty walk-up basket (sale.empty_basket) before any DB write or collect", async () => {
    const { cfg } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app);
      const id = randomUUID();

      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
        code: "sale.empty_basket",
      });

      expect(await paymentCount(id)).toBe(0);
      expect(client.lastCreateIntent).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("concurrent winner: a sale filed between collect and finalize makes P3 REPLAY, filing nothing (23505 backstop)", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = randomUUID();
      await parkOrder({ db: suite.admin }, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
      });

      // The provider, mid-`collect` (i.e. AFTER P1 committed tx A and read the order `open`, BEFORE P3),
      // simulates a concurrent winner paying this same id by cash — settling it and filing its sale.
      // P3's `recordSale` then collides on `sales_working_order_id_key` (23505) and REPLAYS the winner's
      // ticket rather than filing a second unrepairable record.
      const provider = cannedProvider(async () => {
        await payWorkingOrder({ db: suite.admin, backend, clock }, cfg, {
          id,
          lines: [],
          tender: { method: "cash", amount: "5.00" },
        });
      }, "captured");
      const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      // Replayed the winner's CASH ticket (total 1.50; a replay's `change` is the "0.00" default — the
      // drawer was settled at the winner's own sale). STILL exactly one sale + registro, one CASH tender.
      expect(out.ticket.total).toBe("1.50");
      expect(out.ticket.change).toBe("0.00");
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50", tipAmount: "0.00" }]);
    } finally {
      await app.close();
    }
  });

  it("a capture whose payment cannot be associated rolls back the whole sale (P3 is atomic)", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = randomUUID();
      // A provider that reports `captured` but wrote NO `payments` row — so `associatePaymentWithSale`
      // finds nothing and throws the domain `payment.not_found` (a non-unique error). P3 must re-raise
      // it, NOT swallow it as a replay, and the sale it half-filed must roll back with the transaction.
      const provider = cannedProvider(() => Promise.resolve(), "captured");
      const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

      await expect(
        payWorkingOrderIntegrated(deps, cfg, {
          id,
          lines: [{ productId: cafe.id, quantity: "1" }],
        }),
      ).rejects.toMatchObject({ code: "payment.not_found" });

      // The sale + settle rolled back; the walk-up order row created in tx A remains `open` (retryable).
      expect(await saleCount(id)).toBe(0);
      expect(await registroCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    } finally {
      await app.close();
    }
  });

  it("returns an empty qr when the fiscal backend offers no verification url", async () => {
    // `TillSaleResult.qr` defaults to "" when the regime offers no verification link
    // (`FiscalRecordRef.verificationUrl` is optional). `VerifactuBackend` always sets one, so — exactly
    // as `till-sale.test.ts` does for `fileImmediateSale` — this drives the SAME `recordSale` write path
    // through a `FakeFiscalBackend` whose records carry none, so the integrated ticket's empty-QR default
    // is exercised rather than assumed.
    const { cfg, cafe } = await setupVenue();
    await FakeFiscalBackend.install(suite.admin);
    const fake = new FakeFiscalBackend(suite.admin);
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await fake.registerNode(tx, cfg.nodeId, { tenantId: cfg.tenantId });
    });
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const provider = new StripeTerminalProvider({
        client: new FakeStripe(),
        db: app,
        tenantId: cfg.tenantId,
        resolveReader: () => Promise.resolve("reader_1"),
        poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
      });
      const deps: IntegratedPayDeps = { db: app, backend: fake, clock, provider };

      const out = await payWorkingOrderIntegrated(deps, cfg, {
        id: randomUUID(),
        lines: [{ productId: cafe.id, quantity: "1" }],
      });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.qr).toBe("");
    } finally {
      await app.close();
    }
  });
});

// The §4 capture-idempotency guard: a lost-response retry where `collect` COMMITTED its capture (T2)
// but P3 never ran (the sale was never filed) must NOT re-charge. Real Postgres, not PGlite (§4): the
// recovery files the sale as the deployment role under RLS, and the two concurrency proofs need
// TWO DISTINCT app-role connections racing one order — a superuser, single-backend PGlite is a false
// pass, not a weak one. The lost-T2 state is seeded directly (`createOpenOrder` + `insertCapturedPayment`
// with `sale_id` NULL), exactly the row `provider.collect`'s T2 leaves behind before P3.
describe("payWorkingOrderIntegrated — capture idempotency (recovery window + concurrency)", () => {
  /** Seed the lost-T2 state: an OPEN order with a locked café line, plus a captured stripe payment for
   *  it whose `sale_id` is still NULL (collect committed, P3 never ran). `amount` is the GROSS the card
   *  was charged (total, or total+tip). Returns the order id. Written as the app role — the same role
   *  `provider.collect` runs as. */
  async function seedLostCapture(
    cfg: TillConfig,
    cafe: AvailableProduct,
    quantity: string,
    capturedAmount: string,
  ): Promise<{ id: string; externalRef: string }> {
    const id = randomUUID();
    // `payments_provider_ref_key` is tenant-scoped but `payments_provider_external_ref_key` is GLOBAL
    // per provider, and the shared container accumulates every test's rows, so both refs are made
    // unique per seed (mirrors `nextNif`'s reason for per-venue NIFs).
    const externalRef = `pi_lost_${randomUUID()}`;
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createOpenOrder(tx, cfg, id, [{ productId: cafe.id, quantity }], null);
      await insertCapturedPayment(tx, {
        tenantId: cfg.tenantId,
        workingOrderId: id,
        provider: "stripe",
        paymentRef: `pi-ref-${randomUUID()}`,
        amount: decimal(capturedAmount),
        settledAt: new Date(),
        externalRef,
      });
    });
    return { id, externalRef };
  }

  it("recovers a lost-T2 captured payment: files from locked lines, no re-charge, links the existing row", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app);
      // Locked total 1.50; the captured charge was exactly the total (no tip).
      const { id, externalRef } = await seedLostCapture(cfg, cafe, "1", "1.50");

      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      // Recovered at the locked total — filed, NOT re-charged.
      expect(out.ticket.total).toBe("1.50");
      // collect was NEVER driven (recovery skips P2 entirely): no PaymentIntent was created, so there
      // is no second charge, and there is still exactly ONE payment row — the lost capture, now linked.
      expect(client.lastCreateIntent).toBeUndefined();
      expect(await paymentCount(id)).toBe(1);
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.state).toBe("captured");
      expect(payments[0]!.externalRef).toBe(externalRef); // the EXISTING row, not a fresh one
      expect(payments[0]!.linkedToSale).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("recovers with a reconstructed tip when the captured amount exceeds the locked total", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app);
      // Locked total 1.50, captured 1.80 → the tip is reconstructed as 1.80 − 1.50 = 0.30.
      const { id } = await seedLostCapture(cfg, cafe, "1", "1.80");

      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      expect(client.lastCreateIntent).toBeUndefined(); // no re-charge
      // The FISCAL total stays ex-tip (1.50); the tender carries the whole 1.80 charge with tip 0.30
      // (the coverage identity sum(amount) = total + sum(tip) holds).
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
      expect(await paymentCount(id)).toBe(1);
      expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("a captured amount BELOW the locked total is corruption: files nothing, leaves the payment for reconcile", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { deps, client } = integratedDeps(cfg, app);
      // Captured 1.00 against a locked total 1.50 — the charge cannot even cover the total. There is no
      // honest fiscal figure to file, so recovery files NOTHING and throws (→ server.internal 500),
      // leaving the captured payment (sale_id NULL) as reconcile's orphan class (Decision 2 / §5).
      const { id } = await seedLostCapture(cfg, cafe, "1", "1.00");

      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toBeDefined();

      expect(client.lastCreateIntent).toBeUndefined(); // never re-charged
      // No sale, no registro; the order stays open; the captured payment is untouched (still an orphan).
      expect(await saleCount(id)).toBe(0);
      expect(await registroCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
      expect(await rawPaymentsFor(id)).toEqual([{ state: "captured", hasSale: false }]);
    } finally {
      await app.close();
    }
  });

  it("two concurrent pays for one parked order file ONE sale; the loser replays (one sale/settlement)", async () => {
    const { cfg, cafe } = await setupVenue();
    const appA = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    const appB = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const id = randomUUID();
      await parkOrder({ db: suite.admin }, cfg, {
        id,
        lines: [{ productId: cafe.id, quantity: "1" }],
        label: "Mesa 7",
      });

      // Two DISTINCT app-role connections, each its own reader, drive the SAME parked order id. P1's
      // FOR UPDATE serialises them; both reach `collect` and capture, and P3's `sales_working_order_id_key`
      // 23505 backstop makes exactly one file — the loser replays the winner's ticket. (The one-CHARGE
      // guarantee across the network sub-window is the Stripe idempotency key, proven in the sandbox,
      // Task 1 — not the FakeStripe here, which captures per-reader.)
      const { deps: depsA } = integratedDeps(cfg, appA);
      const { deps: depsB } = integratedDeps(cfg, appB);
      const req = { id, lines: [] };

      const [a, b] = await Promise.allSettled([
        payWorkingOrderIntegrated(depsA, cfg, req),
        payWorkingOrderIntegrated(depsB, cfg, req),
      ]);

      if (a.status !== "fulfilled" || b.status !== "fulfilled") {
        throw new Error(`both pays should settle: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
      }
      expect(a.value.outcome).toBe("captured");
      expect(b.value.outcome).toBe("captured");
      if (a.value.outcome !== "captured" || b.value.outcome !== "captured") {
        throw new Error("unreachable");
      }
      // Both captured, ONE invoice number, ONE sale + registro.
      expect(a.value.ticket.invoiceNumber).toBe(b.value.ticket.invoiceNumber);
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
    } finally {
      await appA.close();
      await appB.close();
    }
  });

  it("two concurrent recoveries of one lost capture file ONE sale; the loser replays", async () => {
    const { cfg, cafe } = await setupVenue();
    const appA = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    const appB = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // ONE lost capture, TWO retries. Both P1s pass the pre-check (sale_id NULL) and dispatch to
      // recovery; finalizeRecovery's FOR UPDATE fully serialises them (the order always exists), so one
      // files + associates the existing row + settles, and the other blocks, re-reads `settled`, and
      // REPLAYS — the recovery path's own idempotency, with no double-file and no double-associate.
      const { id } = await seedLostCapture(cfg, cafe, "1", "1.50");

      const { deps: depsA } = integratedDeps(cfg, appA);
      const { deps: depsB } = integratedDeps(cfg, appB);
      const req = { id, lines: [] };

      const [a, b] = await Promise.allSettled([
        payWorkingOrderIntegrated(depsA, cfg, req),
        payWorkingOrderIntegrated(depsB, cfg, req),
      ]);

      if (a.status !== "fulfilled" || b.status !== "fulfilled") {
        throw new Error(
          `both recoveries should settle: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
        );
      }
      expect(a.value.outcome).toBe("captured");
      expect(b.value.outcome).toBe("captured");
      if (a.value.outcome !== "captured" || b.value.outcome !== "captured") {
        throw new Error("unreachable");
      }
      expect(a.value.ticket.invoiceNumber).toBe(b.value.ticket.invoiceNumber);
      // Exactly one sale, one registro; the SINGLE lost capture is the linked payment (no second row).
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await paymentCount(id)).toBe(1);
      expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
    } finally {
      await appA.close();
      await appB.close();
    }
  });
});

// ORDERING 1 (invoice-first): the sale/invoice is issued (chained, filed) AT PLACING and sits
// OUTSTANDING; the integrated card collect must SETTLE that already-issued invoice (`settleSale`, NOT a
// second `recordSale`) and associate the captured payment. The real hazard this closes is NOT a
// double-file (`sales_working_order_id_key` UNIQUE 23505s a second file for one order) — it is an
// ORPHANED captured payment beside an UNSETTLED issued invoice (money taken, invoice left outstanding).
// A decline files/voids nothing: the issued invoice stays outstanding, retryable (§5). Real Postgres,
// not PGlite (§4): the settle writes as the deployment role under RLS, and the double-settle replay and
// the concurrent recovery need distinct app-role connections racing one order.
describe("payWorkingOrderIntegrated — ordering 1 (invoice-first settle path)", () => {
  /** Arrange an OUTSTANDING invoice-first sale: park, then `placeOrder` issues the DEFERRED invoice at
   *  placing (open → placed), leaving one chained-but-unsettled sale. Returns the order id + its saleId. */
  async function placeInvoiceFirst(
    cfg: TillConfig,
    cafe: AvailableProduct,
    quantity = "1",
  ): Promise<{ id: string; saleId: string }> {
    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: cafe.id, quantity }],
    });
    await placeOrder({ db: suite.admin, backend, clock }, cfg, id, OPERATOR);
    return { id, saleId: await saleIdFor(id) };
  }

  it("settles the already-issued outstanding invoice on capture (settleSale, not recordSale)", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { id, saleId } = await placeInvoiceFirst(cfg, cafe);
      // The deferred invoice is issued at placing: one sale + registro, order placed, OUTSTANDING.
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
      expect(await outstandingSalesFor(cfg)).toEqual([{ saleId, amountDue: "1.50" }]);

      const { deps, client } = integratedDeps(cfg, app);
      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.invoiceNumber).toBe("A/1"); // the SAME invoice, read back
      expect(out.ticket.total).toBe("1.50");
      expect(out.ticket.change).toBe("0.00");
      // NO second sale/registro — the invoice was SETTLED, not re-filed. The card charged the exact
      // invoice total; the captured stripe payment links to the ISSUED sale; the order is now settled
      // and no longer outstanding.
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await outstandingSalesFor(cfg)).toEqual([]);
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.state).toBe("captured");
      expect(payments[0]!.linkedToSale).toBe(true);
      expect(payments[0]!.externalRef).toMatch(/^pi_/);
      expect(client.lastCreateIntent?.amount).toBe("1.50");
    } finally {
      await app.close();
    }
  });

  it("tips on: charges amountDue+tip, settles the invoice at the total, records the tip on the tender", async () => {
    const { cfg: baseCfg, cafe } = await modeVenue("invoice_first");
    // Tips are read off `cfg.tipsEnabled` (the single source) — override it rather than passing a
    // `tipsEnabled` argument to `integratedDeps`. `placeInvoiceFirst` only dispatches on `orderFlow`,
    // so placing under this overridden cfg is unaffected.
    const cfg = { ...baseCfg, tipsEnabled: true };
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { id } = await placeInvoiceFirst(cfg, cafe);
      const { deps, client } = integratedDeps(cfg, app);

      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [], tip: "0.30" });

      expect(out.outcome).toBe("captured");
      // The reader was charged the GROSS 1.80 (amount due 1.50 + tip 0.30)…
      expect(client.lastCreateIntent?.amount).toBe("1.80");
      // …while the FISCAL total stays the ex-tip invoice total 1.50 (a settle files nothing new), and the
      // tender carries amount 1.80 / tip 0.30 (coverage identity sum(amount) = total + sum(tip) holds).
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    } finally {
      await app.close();
    }
  });

  it("a decline leaves the invoice OUTSTANDING — nothing re-filed or voided; listOutstandingSales still lists it", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { id, saleId } = await placeInvoiceFirst(cfg, cafe);

      const client = new FakeStripe();
      client.declineNext();
      const { deps } = integratedDeps(cfg, app, client);
      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("declined");
      // A decline files/voids NOTHING (§5): still one sale + registro, the order stays PLACED (not
      // settled), the invoice is still unsettled and STILL LISTED as outstanding — retryable.
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
      expect(await outstandingSalesFor(cfg)).toEqual([{ saleId, amountDue: "1.50" }]);
      // No tender was written (nothing settled); the provider's T2 wrote a `failed` audit row, unlinked.
      expect(await tendersFor(id)).toEqual([]);
      expect(await rawPaymentsFor(id)).toEqual([{ state: "failed", hasSale: false }]);
    } finally {
      await app.close();
    }
  });

  it("a concurrent collect that settles the invoice first makes finalizeSettle REPLAY via sale.already_settled", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { id } = await placeInvoiceFirst(cfg, cafe);

      // Mid-`collect` (AFTER P1 detected settle, BEFORE P3), a concurrent CASH collect settles the
      // already-issued invoice and moves placed → settled. finalizeSettle's `settleSale` then trips
      // `sale.already_settled` (the sale_settlements UNIQUE / post-settlement trigger) and REPLAYS the
      // settled ticket in a fresh transaction rather than double-settling.
      const provider = cannedProvider(async () => {
        await collectOrder({ db: suite.admin, backend, clock }, cfg, {
          id,
          lines: [],
          tender: { method: "cash", amount: "1.50" },
        });
      }, "captured");
      const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.total).toBe("1.50");
      // Replayed the CONCURRENT winner's CASH settlement: still one sale + registro, one settlement, one
      // CASH tender — the integrated pay filed/settled nothing of its own.
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50", tipAmount: "0.00" }]);
    } finally {
      await app.close();
    }
  });

  it("a settle whose payment cannot be associated rolls back — the invoice stays OUTSTANDING (P3 is atomic)", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const { id, saleId } = await placeInvoiceFirst(cfg, cafe);

      // A provider that reports `captured` but wrote NO `payments` row — so `associatePaymentWithSale`
      // throws the domain `payment.not_found` (a non-`already_settled` error). finalizeSettle must
      // re-raise it, NOT swallow it as a replay, and the settlement it half-wrote must roll back with the
      // transaction — leaving the invoice unsettled and outstanding.
      const provider = cannedProvider(() => Promise.resolve(), "captured");
      const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
        code: "payment.not_found",
      });

      // The settlement rolled back: no tender, the order stays PLACED, the invoice is still outstanding.
      expect(await tendersFor(id)).toEqual([]);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
      expect(await outstandingSalesFor(cfg)).toEqual([{ saleId, amountDue: "1.50" }]);
    } finally {
      await app.close();
    }
  });

  // A lost-T2 capture on an invoice-first order: `collect`'s T2 committed a captured payment (sale_id
  // NULL) but P3 never ran. A naive retry must NOT re-charge AND must NOT `recordSale` (which would
  // 23505 against the issued invoice) — it RECOVERS by SETTLING the existing invoice.
  describe("lost-T2 recovery settles (never re-files)", () => {
    /** Seed the lost-T2 state on an already-placed invoice-first order: a captured stripe payment for it
     *  whose sale_id is NULL. `capturedAmount` is the GROSS the card was charged (amount due, or +tip). */
    async function seedLostCaptureOnPlaced(
      cfg: TillConfig,
      id: string,
      capturedAmount: string,
    ): Promise<string> {
      const externalRef = `pi_lost_${randomUUID()}`;
      await withTenant(suite.admin, cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await insertCapturedPayment(tx, {
          tenantId: cfg.tenantId,
          workingOrderId: id,
          provider: "stripe",
          paymentRef: `pi-ref-${randomUUID()}`,
          amount: decimal(capturedAmount),
          settledAt: new Date(),
          externalRef,
        });
      });
      return externalRef;
    }

    it("recovers by settling the issued invoice: no re-charge, no second file, links the existing row", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
      try {
        const { id } = await placeInvoiceFirst(cfg, cafe);
        const externalRef = await seedLostCaptureOnPlaced(cfg, id, "1.50"); // charged exactly the total

        const { deps, client } = integratedDeps(cfg, app);
        const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

        expect(out.outcome).toBe("captured");
        // collect was NEVER driven (recovery skips P2): no PaymentIntent created, no re-charge.
        expect(client.lastCreateIntent).toBeUndefined();
        // Still ONE sale + registro (SETTLED, not re-filed) and ONE payment — the lost capture, now linked.
        expect(await saleCount(id)).toBe(1);
        expect(await registroCount(id)).toBe(1);
        expect(await paymentCount(id)).toBe(1);
        expect(await filedSaleTotal(id)).toBe("1.50");
        expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
        expect(await outstandingSalesFor(cfg)).toEqual([]);
        expect(await tendersFor(id)).toEqual([
          { method: "card", amount: "1.50", tipAmount: "0.00" },
        ]);
        const payments = await paymentsFor(id);
        expect(payments).toHaveLength(1);
        expect(payments[0]!.externalRef).toBe(externalRef); // the EXISTING lost row, not a fresh one
        expect(payments[0]!.linkedToSale).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("reconstructs a tip when the captured amount exceeds the amount due", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
      try {
        const { id } = await placeInvoiceFirst(cfg, cafe);
        await seedLostCaptureOnPlaced(cfg, id, "1.80"); // amount due 1.50 → tip reconstructed as 0.30

        const { deps, client } = integratedDeps(cfg, app);
        const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

        expect(out.outcome).toBe("captured");
        expect(client.lastCreateIntent).toBeUndefined(); // no re-charge
        // The FISCAL total stays the ex-tip invoice total 1.50; the tender carries the whole 1.80 with
        // tip 0.30 (coverage identity holds).
        expect(await filedSaleTotal(id)).toBe("1.50");
        expect(await tendersFor(id)).toEqual([
          { method: "card", amount: "1.80", tipAmount: "0.30" },
        ]);
        expect(await paymentCount(id)).toBe(1);
        expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("a captured amount BELOW the amount due is corruption: settles nothing, leaves the payment for reconcile", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const app = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
      try {
        const { id, saleId } = await placeInvoiceFirst(cfg, cafe);
        await seedLostCaptureOnPlaced(cfg, id, "1.00"); // below the 1.50 amount due — cannot even cover it

        const { deps, client } = integratedDeps(cfg, app);
        await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toBeDefined();

        expect(client.lastCreateIntent).toBeUndefined(); // never re-charged
        // Nothing settled: no tender, the order stays placed, the invoice is still outstanding, and the
        // captured payment is untouched (still a sale_id-NULL orphan for reconcile).
        expect(await tendersFor(id)).toEqual([]);
        expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
        expect(await outstandingSalesFor(cfg)).toEqual([{ saleId, amountDue: "1.50" }]);
        expect(await rawPaymentsFor(id)).toEqual([{ state: "captured", hasSale: false }]);
      } finally {
        await app.close();
      }
    });

    it("two concurrent recoveries settle the invoice ONCE; the loser replays", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const appA = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
      const appB = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
      try {
        const { id } = await placeInvoiceFirst(cfg, cafe);
        await seedLostCaptureOnPlaced(cfg, id, "1.50");

        // ONE lost capture, TWO retries. Both P1s pass the pre-check (sale_id NULL) with an outstanding
        // invoice → recover-settle; finalizeSettleRecovery's FOR UPDATE fully serialises them, so one
        // settles + associates + moves placed → settled, and the other blocks, re-reads `settled`, and
        // REPLAYS — one settlement, no double-associate.
        const { deps: depsA } = integratedDeps(cfg, appA);
        const { deps: depsB } = integratedDeps(cfg, appB);
        const req = { id, lines: [] };

        const [a, b] = await Promise.allSettled([
          payWorkingOrderIntegrated(depsA, cfg, req),
          payWorkingOrderIntegrated(depsB, cfg, req),
        ]);

        if (a.status !== "fulfilled" || b.status !== "fulfilled") {
          throw new Error(
            `both recoveries should settle: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
          );
        }
        expect(a.value.outcome).toBe("captured");
        expect(b.value.outcome).toBe("captured");
        if (a.value.outcome !== "captured" || b.value.outcome !== "captured") {
          throw new Error("unreachable");
        }
        expect(a.value.ticket.invoiceNumber).toBe(b.value.ticket.invoiceNumber);
        // Exactly one sale + registro; ONE settlement (one tender); the SINGLE lost capture is linked.
        expect(await saleCount(id)).toBe(1);
        expect(await registroCount(id)).toBe(1);
        expect(await tendersFor(id)).toEqual([
          { method: "card", amount: "1.50", tipAmount: "0.00" },
        ]);
        expect(await paymentCount(id)).toBe(1);
        expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
      } finally {
        await appA.close();
        await appB.close();
      }
    });
  });
});
